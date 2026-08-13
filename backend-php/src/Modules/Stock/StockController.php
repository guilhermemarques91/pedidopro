<?php

namespace App\Modules\Stock;

use App\Core\Db;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Request;
use App\Services\Costing;
use App\Services\Stock;
use PDO;

/** Movimentações de estoque por produto (entrada/saída/ajuste). */
final class StockController
{
    /**
     * Motivos de um lançamento manual. Existe porque `notes` era texto livre e `ref` era
     * sempre 'manual': perda por vencimento, quebra na cozinha e consumo interno ficavam
     * todos indistinguíveis, e sem isso não há relatório de perdas possível.
     *
     * Fonte ÚNICA da lista; o espelho do frontend fica em frontend/src/config/estoque.ts.
     */
    public const REASONS = [
        'compra' => 'Compra / entrada de nota',
        'devolucao' => 'Devolução de cliente',
        'perda_vencimento' => 'Perda — vencimento',
        'perda_quebra' => 'Perda — quebra ou avaria',
        'perda_preparo' => 'Perda — preparo (queimou, errou)',
        'consumo_interno' => 'Consumo interno (equipe)',
        'degustacao' => 'Degustação / cortesia',
        'acerto_inventario' => 'Acerto de inventário',
        'transferencia' => 'Transferência',
    ];

    /** GET /stock/moves — extrato. Filtros: product_id, type, reason, ref, from, to. */
    public static function moves(Request $req): void
    {
        [$where, $params] = self::filters($req);
        $limit = max(1, min((int) ($req->query('limit') ?? 50), 500));
        $offset = max(0, (int) ($req->query('offset') ?? 0));

        $rows = Db::query(
            'SELECT m.*, p.name AS product_name, p.unit, u.name AS user_name
               FROM stock_moves m
               JOIN products p ON p.id = m.product_id
               LEFT JOIN users u ON u.id = m.created_by
              WHERE ' . $where . "
              ORDER BY m.id DESC LIMIT {$limit} OFFSET {$offset}",
            $params
        );

        // Sem filtro nenhum além do produto o cliente antigo espera o array cru; o extrato
        // novo pede `totals=1` e recebe o envelope. Mantém o modal de produto funcionando.
        if ($req->query('totals') !== '1') {
            Http::json($rows);
            return;
        }
        // Valor = quantidade × custo do movimento. A saída passou a ser valorizada, então
        // isto é CMV de verdade no período, não uma estimativa.
        $t = Db::queryOne(
            'SELECT COUNT(*) AS moves,
                    COALESCE(SUM(CASE WHEN m.type = \'in\' THEN m.qty_delta ELSE 0 END), 0) AS qty_in,
                    COALESCE(SUM(CASE WHEN m.type = \'out\' THEN -m.qty_delta ELSE 0 END), 0) AS qty_out,
                    COALESCE(SUM(CASE WHEN m.type = \'in\' THEN m.qty_delta * COALESCE(m.unit_cost, 0) ELSE 0 END), 0) AS value_in,
                    COALESCE(SUM(CASE WHEN m.type = \'out\' THEN -m.qty_delta * COALESCE(m.unit_cost, 0) ELSE 0 END), 0) AS value_out
               FROM stock_moves m JOIN products p ON p.id = m.product_id WHERE ' . $where,
            $params
        );
        Http::json(['moves' => $rows, 'totals' => $t, 'reasons' => self::REASONS]);
    }

    /**
     * POST /stock/moves/batch { type, reason, notes?, lines: [{product_id, quantity, unit_cost?}] }
     *
     * Lançar a perda do dia era abrir um modal por produto. Aqui é uma transação só: ou tudo
     * entra, ou nada entra — meia perda lançada é pior que nenhuma, porque parece conferida.
     */
    public static function batch(Request $req): void
    {
        $in = $req->input();
        $type = $in->enum('type', ['in', 'out', 'adjust'], true);
        $reason = self::reason($in->string('reason'));
        $notes = $in->string('notes');
        $lines = $in->array('lines', true);
        if (count($lines) > 200) {
            throw HttpError::badRequest('Máximo de 200 linhas por lançamento');
        }

        $parsed = [];
        foreach ($lines as $l) {
            $productId = (int) ($l['product_id'] ?? 0);
            $qty = (float) ($l['quantity'] ?? 0);
            if ($productId <= 0) {
                throw HttpError::badRequest('Linha sem produto');
            }
            if ($qty < 0 || ($type !== 'adjust' && $qty <= 0)) {
                throw HttpError::badRequest('Quantidade inválida em uma das linhas');
            }
            if (!Db::queryOne('SELECT id FROM products WHERE id = ? AND org_id = ? AND active = 1', [$productId, $req->orgId()])) {
                throw HttpError::notFound("Produto #{$productId} não encontrado");
            }
            $cost = isset($l['unit_cost']) && $l['unit_cost'] !== null && $l['unit_cost'] !== '' ? (float) $l['unit_cost'] : null;
            $parsed[] = ['product_id' => $productId, 'quantity' => $qty, 'unit_cost' => $cost];
        }

        $applied = Db::transaction(function (PDO $pdo) use ($parsed, $type, $reason, $notes, $req) {
            $out = [];
            foreach ($parsed as $l) {
                // Saída valorizada pelo custo atual do insumo quando ninguém informou: é o
                // que faz uma perda virar dinheiro no relatório, e não só quantidade.
                $cost = $l['unit_cost'];
                if ($cost === null && $type === 'out') {
                    $cost = Costing::unitCost($pdo, $req->orgId(), $l['product_id']);
                }
                $r = Stock::apply(
                    $pdo, $req->orgId(), $l['product_id'], $type, $l['quantity'],
                    $cost, self::ref($reason), $notes, $req->userId(), $reason
                );
                $out[] = ['product_id' => $l['product_id']] + $r;
            }
            return $out;
        });

        Http::json(['ok' => true, 'moves' => $applied], 201);
    }

    /** POST /stock/moves { product_id, type: in|out|adjust, quantity, unit_cost?, notes?, reason? } */
    public static function create(Request $req): void
    {
        $in = $req->input();
        $productId = $in->integer('product_id', true);
        $type = $in->enum('type', ['in', 'out', 'adjust'], true);
        $qty = (float) ($in->number('quantity', true) ?? 0);
        if ($qty < 0 || ($type !== 'adjust' && $qty <= 0)) {
            throw HttpError::badRequest('Quantidade inválida');
        }
        $unitCost = $in->number('unit_cost');
        $notes = $in->string('notes');
        $reason = self::reason($in->string('reason'));

        $product = Db::queryOne('SELECT id FROM products WHERE id = ? AND org_id = ? AND active = 1', [$productId, $req->orgId()]);
        if (!$product) {
            throw HttpError::notFound('Produto não encontrado');
        }

        $result = Db::transaction(function (PDO $pdo) use ($req, $productId, $type, $qty, $unitCost, $notes, $reason) {
            $cost = $unitCost !== null ? (float) $unitCost : null;
            if ($cost === null && $type === 'out') {
                $cost = Costing::unitCost($pdo, $req->orgId(), $productId);
            }
            return Stock::apply(
                $pdo, $req->orgId(), $productId, $type, $qty, $cost,
                self::ref($reason), $notes, $req->userId(), $reason
            );
        });
        $row = Db::queryOne('SELECT stock_qty, avg_cost FROM products WHERE id = ?', [$productId]);
        Http::json(['ok' => true, 'move' => $result, 'stock_qty' => $row['stock_qty'], 'avg_cost' => $row['avg_cost']], 201);
    }

    // ---- helpers ----

    /** @return array{0:string,1:array} WHERE + params do extrato. */
    private static function filters(Request $req): array
    {
        $where = ['m.org_id = ?'];
        $params = [$req->orgId()];

        $pid = $req->query('product_id');
        if ($pid !== null && ctype_digit($pid)) {
            $where[] = 'm.product_id = ?';
            $params[] = (int) $pid;
        }
        $type = $req->query('type');
        if ($type !== null && in_array($type, ['in', 'out', 'adjust'], true)) {
            $where[] = 'm.type = ?';
            $params[] = $type;
        }
        $reason = $req->query('reason');
        if ($reason !== null && $reason !== '') {
            $where[] = 'm.reason = ?';
            $params[] = $reason;
        }
        // Origem: 'delivery', 'vendas', 'receipt'… casa pelo prefixo do ref.
        $ref = $req->query('ref');
        if ($ref !== null && $ref !== '') {
            $where[] = 'm.ref LIKE ?';
            $params[] = $ref . '%';
        }
        $from = $req->query('from');
        if ($from !== null && $from !== '') {
            $where[] = 'm.created_at >= ?';
            $params[] = $from . ' 00:00:00';
        }
        $to = $req->query('to');
        if ($to !== null && $to !== '') {
            $where[] = 'm.created_at < (? + INTERVAL 1 DAY)';
            $params[] = $to;
        }
        $q = trim((string) ($req->query('q') ?? ''));
        if ($q !== '') {
            $where[] = 'p.name LIKE ?';
            $params[] = '%' . $q . '%';
        }

        return [implode(' AND ', $where), $params];
    }

    private static function reason(?string $raw): ?string
    {
        $r = trim((string) $raw);
        if ($r === '') {
            return null;
        }
        if (!isset(self::REASONS[$r])) {
            throw HttpError::badRequest("Motivo desconhecido: {$r}");
        }
        return $r;
    }

    /** `manual` continua sendo o prefixo — o motivo entra na coluna própria e no ref. */
    private static function ref(?string $reason): string
    {
        return $reason === null ? 'manual' : "manual:{$reason}";
    }
}
