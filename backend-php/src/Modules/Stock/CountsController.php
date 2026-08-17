<?php

namespace App\Modules\Stock;

use App\Core\Db;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Request;
use App\Services\Replenishment;
use App\Services\Stock;
use PDO;

/**
 * Contagem de estoque (inventário) e a compra sugerida a partir dela.
 *
 * Ciclo de uma folha:
 *   1. create()          — abre a folha com os produtos comprados e o saldo atual do sistema (snapshot).
 *   2. update()          — o funcionário salva o que contou (pode voltar depois; fica em rascunho).
 *   3. apply()           — conclui: corrige o saldo (movimento `adjust`, ref `count:N`) e trava a folha.
 *   4. generateRequest() — vira lista de compras (purchase_requests) com as quantidades sugeridas.
 *
 * A sugestão é sempre recalculada na leitura (App\Services\Replenishment) e só é
 * congelada em order_qty quando o usuário digita um número diferente.
 */
final class CountsController
{
    /** Tipos que entram na folha — lista única em App\Services\Replenishment. */
    private const COUNTABLE_TIPOS = Replenishment::COUNTABLE_TIPOS;

    /**
     * GET /stock/counts/scopes
     *
     * Os recortes possíveis para abrir uma folha, com quantos itens cada um traz e
     * há quantos dias foi contado. É o que substitui os três selects genéricos da
     * criação: em vez de adivinhar, o usuário vê "EMBALAGENS · 22 itens · contado
     * há 2 dias" e escolhe.
     *
     * Sub-classe com 0 itens compráveis continua na lista (desabilitada na tela) —
     * sumir daria a entender que o grupo não existe.
     */
    public static function scopes(Request $req): void
    {
        $place = Db::inClause(self::COUNTABLE_TIPOS);
        Http::json(Db::query(
            "SELECT sub.id   AS sub_classe_id,
                    sub.name AS sub_classe_name,
                    t.id     AS type_id,
                    t.name   AS type_name,
                    COUNT(p.id) AS product_count,
                    (SELECT MAX(sc.created_at)
                       FROM stock_counts sc
                      WHERE sc.org_id = sub.org_id AND sc.scope_sub_classe_id = sub.id) AS last_counted_at
               FROM product_subclasses sub
               LEFT JOIN product_types t ON t.id = sub.type_id
               LEFT JOIN products p
                      ON p.sub_classe_id = sub.id
                     AND p.org_id = sub.org_id
                     AND p.active = 1
                     AND p.tipo IN ({$place})
              WHERE sub.org_id = ? AND sub.active = 1
              GROUP BY sub.id, sub.name, t.id, t.name, sub.sort_order, sub.org_id
              ORDER BY sub.sort_order, sub.name",
            array_merge(self::COUNTABLE_TIPOS, [$req->orgId()])
        ));
    }

    /** GET /stock/counts */
    public static function list(Request $req): void
    {
        Http::json(Db::query(
            "SELECT sc.*, u.name AS created_by_name,
                    COUNT(sci.id) AS item_count,
                    SUM(CASE WHEN sci.counted_qty IS NOT NULL THEN 1 ELSE 0 END) AS counted_count
               FROM stock_counts sc
               JOIN users u ON u.id = sc.created_by
               LEFT JOIN stock_count_items sci ON sci.count_id = sc.id
              WHERE sc.org_id = ?
              GROUP BY sc.id, u.name
              ORDER BY sc.created_at DESC",
            [$req->orgId()]
        ));
    }

    /**
     * POST /stock/counts { title?, coverage_days?, category_id?, type_id?, tipo? }
     * Abre a folha congelando o saldo atual de cada produto comprado.
     */
    public static function create(Request $req): void
    {
        $in = $req->input();
        $title = $in->string('title') ?: ('Contagem ' . date('d/m/Y'));
        $coverage = max(1, min((int) ($in->integer('coverage_days') ?? Replenishment::DEFAULT_COVERAGE_DAYS), 90));
        $notes = $in->string('notes');

        $where = ['p.org_id = ?', 'p.active = 1'];
        $params = [$req->orgId()];
        // Sem filtro de tipo, a folha traz todos os tipos compráveis.
        $tipo = $in->string('tipo');
        if ($tipo !== null) {
            if (!in_array($tipo, self::COUNTABLE_TIPOS, true)) {
                throw HttpError::badRequest('Tipo não entra em contagem de compra');
            }
            $where[] = 'p.tipo = ?';
            $params[] = $tipo;
        } else {
            $where[] = 'p.tipo IN (' . Db::inClause(self::COUNTABLE_TIPOS) . ')';
            $params = array_merge($params, self::COUNTABLE_TIPOS);
        }
        if (($cat = $in->integer('category_id')) !== null) {
            $where[] = 'p.category_id = ?';
            $params[] = $cat;
        }
        if (($typeId = $in->integer('type_id')) !== null) {
            $where[] = 'p.type_id = ?';
            $params[] = $typeId;
        }
        // Sub-classe é o recorte que corresponde à prateleira (EMBALAGENS, LIMPEZA…)
        // e é o único eixo preenchido em 100% do cadastro — sem ele a folha nascia
        // com o catálogo inteiro.
        if (($subId = $in->integer('sub_classe_id')) !== null) {
            $where[] = 'p.sub_classe_id = ?';
            $params[] = $subId;
        }

        $products = Db::query(
            'SELECT p.id, p.stock_qty, p.unit
               FROM products p
              WHERE ' . implode(' AND ', $where) . '
              ORDER BY p.name',
            $params
        );
        if (!$products) {
            throw HttpError::badRequest('Nenhum produto de compra encontrado com esses filtros');
        }

        // Escopo pedido, guardado para a lista de contagens poder filtrar e para o
        // histórico dizer o que foi contado mesmo que a sub-classe mude depois.
        $scope = ['sub' => $subId, 'type' => $typeId, 'cat' => $cat, 'tipo' => $tipo];

        $id = Db::transaction(function (PDO $pdo) use ($req, $title, $coverage, $notes, $products, $scope) {
            $pdo->prepare(
                'INSERT INTO stock_counts
                    (org_id, title, coverage_days, notes, created_by,
                     scope_sub_classe_id, scope_type_id, scope_category_id, scope_tipo)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
            )->execute([
                $req->orgId(), $title, $coverage, $notes, $req->userId(),
                $scope['sub'], $scope['type'], $scope['cat'], $scope['tipo'],
            ]);
            $cid = (int) $pdo->lastInsertId();
            // A unidade gravada é sempre a de ESTOQUE (a que o saldo/system_qty realmente
            // significa) — nunca a de compra (`purchase_unit`, texto livre tipo "CX", sem
            // fator numérico cadastrado em lugar nenhum). Rotular o saldo em UN como se
            // fosse caixa fazia a folha mostrar "Sistema: 240 CX" quando eram 240 unidades:
            // um erro de ~1 caixa (24un) virava a leitura de 240 caixas.
            $stmt = $pdo->prepare('INSERT INTO stock_count_items (count_id, product_id, system_qty, unit) VALUES (?, ?, ?, ?)');
            foreach ($products as $p) {
                $stmt->execute([$cid, (int) $p['id'], (float) $p['stock_qty'], $p['unit']]);
            }
            return $cid;
        });
        Http::json(self::detail($id, $req->orgId()), 201);
    }

    /** GET /stock/counts/:id — cabeçalho + linhas com saldo, contagem e sugestão calculada. */
    public static function getById(Request $req): void
    {
        Http::json(self::detail($req->intParam('id'), $req->orgId()));
    }

    /**
     * PUT /stock/counts/:id { title?, notes?, coverage_days?, items: [{ product_id, counted_qty?, order_qty? }] }
     * Salva o rascunho da contagem. counted_qty/order_qty null limpa o campo.
     */
    public static function update(Request $req): void
    {
        $id = $req->intParam('id');
        $count = self::row($id, $req->orgId());
        // Depois de concluída o saldo já foi corrigido: a contagem congela, mas a
        // quantidade de COMPRA continua editável até a lista ser gerada — é nesse
        // intervalo que se revisa a sugestão.
        $onlyOrder = $count['status'] === 'applied';
        if ($count['status'] !== 'draft' && !($onlyOrder && $count['request_id'] === null)) {
            throw HttpError::badRequest('Esta contagem já gerou a lista de compras e não pode mais ser editada');
        }
        $in = $req->input();
        $items = $in->array('items');
        $title = $onlyOrder ? null : $in->string('title');
        $notes = $onlyOrder ? null : $in->string('notes');
        $coverage = $onlyOrder ? null : $in->integer('coverage_days');

        Db::transaction(function (PDO $pdo) use ($id, $items, $title, $notes, $coverage, $onlyOrder) {
            if ($title !== null || $notes !== null || $coverage !== null) {
                $pdo->prepare(
                    'UPDATE stock_counts
                        SET title = COALESCE(?, title), notes = ?, coverage_days = COALESCE(?, coverage_days)
                      WHERE id = ?'
                )->execute([$title, $notes, $coverage !== null ? max(1, min($coverage, 90)) : null, $id]);
            }
            $stmt = $onlyOrder
                ? $pdo->prepare('UPDATE stock_count_items SET order_qty = ? WHERE count_id = ? AND product_id = ?')
                : $pdo->prepare('UPDATE stock_count_items SET counted_qty = ?, counted_via = ?, order_qty = ? WHERE count_id = ? AND product_id = ?');
            foreach ($items as $row) {
                $pid = isset($row['product_id']) ? (int) $row['product_id'] : 0;
                if ($pid <= 0) {
                    throw HttpError::badRequest('Linha da contagem sem produto');
                }
                $order = self::qty($row['order_qty'] ?? null, 'Quantidade de compra inválida');
                if ($onlyOrder) {
                    $stmt->execute([$order, $id, $pid]);
                    continue;
                }
                $counted = self::qty($row['counted_qty'] ?? null, 'Quantidade contada inválida');
                // 'sistema' marca o que veio do botão "Conferir resto" (aceitou o saldo do
                // sistema sem contar de verdade) — sem contagem não há via para gravar.
                $via = $counted !== null && ($row['counted_via'] ?? null) === 'sistema' ? 'sistema' : 'manual';
                $stmt->execute([$counted, $via, $order, $id, $pid]);
            }
        });
        Http::json(self::detail($id, $req->orgId()));
    }

    /**
     * POST /stock/counts/:id/apply — conclui a contagem.
     * Cada linha contada que diverge do saldo do sistema vira um movimento de
     * ajuste; o saldo passa a ser o que foi contado de verdade.
     */
    public static function apply(Request $req): void
    {
        $id = $req->intParam('id');
        $count = self::row($id, $req->orgId());
        if ($count['status'] !== 'draft') {
            throw HttpError::badRequest('Esta contagem já foi concluída');
        }
        $items = Db::query(
            'SELECT product_id, counted_qty FROM stock_count_items WHERE count_id = ? AND counted_qty IS NOT NULL',
            [$id]
        );
        if (!$items) {
            throw HttpError::badRequest('Lance ao menos uma contagem antes de concluir');
        }

        $adjusted = Db::transaction(function (PDO $pdo) use ($items, $id, $req) {
            $n = 0;
            foreach ($items as $it) {
                $productId = (int) $it['product_id'];
                $counted = (float) $it['counted_qty'];
                // apply() com 'adjust' recalcula o delta contra o saldo VIVO (não o
                // do snapshot): se o produto se moveu durante a contagem, o ajuste
                // ainda deixa o saldo exatamente no valor contado.
                $r = Stock::apply(
                    $pdo, $req->orgId(), $productId, 'adjust', $counted,
                    null, "count:{$id}", 'Contagem de estoque #' . $id, $req->userId()
                );
                if (abs($r['qty_delta']) > 0.0001) {
                    $n++;
                }
            }
            $pdo->prepare("UPDATE stock_counts SET status = 'applied', applied_at = NOW(), applied_by = ? WHERE id = ?")
                ->execute([$req->userId(), $id]);
            return $n;
        });
        Http::json(['ok' => true, 'adjusted' => $adjusted, 'count' => self::detail($id, $req->orgId())]);
    }

    /**
     * POST /stock/counts/:id/generate-request — gera a lista de compras.
     * Entram as linhas com quantidade final > 0 (a digitada, ou a sugerida).
     */
    public static function generateRequest(Request $req): void
    {
        $id = $req->intParam('id');
        $count = self::row($id, $req->orgId());
        if ($count['status'] !== 'applied') {
            throw HttpError::badRequest('Conclua a contagem antes de gerar a lista de compras');
        }
        if ($count['request_id'] !== null) {
            throw HttpError::badRequest('Esta contagem já gerou a lista #' . $count['request_id']);
        }

        $lines = [];
        foreach (self::lines($id, (int) $count['coverage_days'], $req->orgId()) as $l) {
            $qty = self::buyQty($l);
            if ($qty > 0) {
                $lines[] = ['product_id' => (int) $l['product_id'], 'quantity' => $qty, 'unit' => $l['unit'] ?: 'un'];
            }
        }
        if (!$lines) {
            throw HttpError::badRequest('Nenhum item com quantidade a comprar');
        }

        $requestId = Db::transaction(function (PDO $pdo) use ($lines, $count, $id, $req) {
            $pdo->prepare('INSERT INTO purchase_requests (org_id, title, notes, status, submitted_at, created_by) VALUES (?, ?, ?, ?, NOW(), ?)')
                ->execute([
                    $req->orgId(),
                    'Reposição — ' . $count['title'],
                    "Gerada da contagem de estoque #{$id}",
                    'submitted',
                    $req->userId(),
                ]);
            $rid = (int) $pdo->lastInsertId();
            $stmt = $pdo->prepare(
                'INSERT INTO purchase_request_items (request_id, product_id, quantity, unit) VALUES (?, ?, ?, ?)'
            );
            foreach ($lines as $l) {
                $stmt->execute([$rid, $l['product_id'], $l['quantity'], $l['unit']]);
            }
            $pdo->prepare('UPDATE stock_counts SET request_id = ? WHERE id = ?')->execute([$rid, $id]);
            return $rid;
        });
        Http::json(['request_id' => $requestId, 'items' => count($lines)], 201);
    }

    /** DELETE /stock/counts/:id — só rascunho (concluída já mexeu no saldo). */
    public static function remove(Request $req): void
    {
        $id = $req->intParam('id');
        $count = self::row($id, $req->orgId());
        if ($count['status'] !== 'draft') {
            throw HttpError::badRequest('Contagem concluída não pode ser excluída');
        }
        // stock_count_items sai em cascata.
        Db::execute('DELETE FROM stock_counts WHERE id = ?', [$id]);
        Http::noContent();
    }

    // ---- helpers ----

    private static function row(int $id, int $orgId): array
    {
        $r = Db::queryOne('SELECT * FROM stock_counts WHERE id = ? AND org_id = ?', [$id, $orgId]);
        if (!$r) {
            throw HttpError::notFound('Contagem não encontrada');
        }
        return $r;
    }

    /** Cabeçalho + linhas + resumo do que precisa ser comprado. */
    private static function detail(int $id, int $orgId): array
    {
        $header = Db::queryOne(
            'SELECT sc.*, u.name AS created_by_name, a.name AS applied_by_name
               FROM stock_counts sc
               JOIN users u ON u.id = sc.created_by
               LEFT JOIN users a ON a.id = sc.applied_by
              WHERE sc.id = ? AND sc.org_id = ?',
            [$id, $orgId]
        );
        if (!$header) {
            throw HttpError::notFound('Contagem não encontrada');
        }
        $items = self::lines($id, (int) $header['coverage_days'], $orgId);

        $toBuy = 0;
        $critical = 0;
        $counted = 0;
        foreach ($items as $it) {
            if (self::buyQty($it) > 0) {
                $toBuy++;
            }
            // Só conta como crítico o que foi conferido: sem contagem o status vem do
            // saldo do sistema e a folha nasceria inteira em vermelho.
            if ($it['counted_qty'] !== null && $it['status'] === 'critico') {
                $critical++;
            }
            if ($it['counted_qty'] !== null) {
                $counted++;
            }
        }
        $header['items'] = $items;
        $header['summary'] = [
            'total' => count($items), 'counted' => $counted, 'to_buy' => $toBuy, 'critical' => $critical,
        ];
        return $header;
    }

    /**
     * Linhas da folha com a sugestão recalculada.
     * Base do cálculo = o que foi contado; enquanto não houver contagem, o saldo do sistema.
     */
    private static function lines(int $id, int $coverageDays, int $orgId): array
    {
        $rows = Db::query(
            'SELECT sci.*, p.name AS product_name, p.min_stock, p.max_stock, p.pack_size,
                    p.purchase_unit, p.avg_cost, p.cost_price, p.stock_qty AS current_qty,
                    c.name AS category_name, s.name AS supplier_name,
                    sub.id AS sub_classe_id, sub.name AS sub_classe_name
               FROM stock_count_items sci
               JOIN products p ON p.id = sci.product_id
               LEFT JOIN categories c ON c.id = p.category_id
               LEFT JOIN product_subclasses sub ON sub.id = p.sub_classe_id
               LEFT JOIN suppliers s ON s.id = p.supplier_id
              WHERE sci.count_id = ?
              ORDER BY COALESCE(sub.sort_order, 9999), COALESCE(sub.name, \'zzz\'), p.name',
            [$id]
        );
        if (!$rows) {
            return [];
        }
        $ids = array_map(static fn ($r) => (int) $r['product_id'], $rows);
        $usage = Replenishment::dailyUsage($orgId, $ids);
        // O que já foi comprado e ainda não chegou desconta da sugestão — senão a folha
        // manda comprar de novo o que está na doca do fornecedor.
        $incoming = Replenishment::incoming($orgId, $ids);

        foreach ($rows as &$r) {
            $onHand = $r['counted_qty'] !== null ? (float) $r['counted_qty'] : (float) $r['system_qty'];
            $calc = Replenishment::suggest(
                $r, $onHand, $coverageDays,
                $usage[(int) $r['product_id']] ?? null,
                $incoming[(int) $r['product_id']] ?? 0.0
            );
            $r = array_merge($r, $calc);
            $r['on_hand'] = $onHand;
            // Custo de referência da linha (custo médio de compra, com queda para o preço cadastrado).
            $r['unit_cost'] = $r['avg_cost'] ?? $r['cost_price'];
        }
        unset($r);
        return $rows;
    }

    /**
     * Quanto comprar de uma linha.
     *
     * A sugestão só vale quando o item FOI CONTADO: sem contagem o saldo em mãos é
     * o do sistema, que é exatamente o número que não se confia — comprar por ele
     * seria pedir às cegas. Item não contado só entra na lista se alguém digitar a
     * quantidade à mão (aí a decisão é humana e explícita).
     */
    private static function buyQty(array $line): float
    {
        if ($line['order_qty'] !== null) {
            return (float) $line['order_qty'];
        }
        if ($line['counted_qty'] === null) {
            return 0.0;
        }
        return (float) ($line['suggested'] ?? 0);
    }

    /** Quantidade opcional de uma linha: null limpa, negativo é erro. */
    private static function qty(mixed $v, string $message): ?float
    {
        if ($v === null || $v === '') {
            return null;
        }
        if (!is_numeric($v) || (float) $v < 0) {
            throw HttpError::badRequest($message);
        }
        return (float) $v;
    }
}
