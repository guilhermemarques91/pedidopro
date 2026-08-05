<?php

namespace App\Modules\Marmitex;

use App\Core\Db;
use App\Core\Env;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Request;
use App\Services\Production;
use PDO;

/**
 * Pedidos diários da empresa. Um pedido por empresa por dia (upsert por service_date).
 * Cada marmita é uma linha (nome + tamanho + proteína + acompanhamentos + obs), com
 * snapshot do nome/preço do catálogo no momento do envio. O login 'company' só altera
 * antes do horário de corte; admin não tem corte. Pedidos já faturados não mudam.
 *
 * Fechar a produção (status 'produced') baixa o estoque dos insumos pela ficha técnica e
 * congela o pedido: para editar, reabra — o que estorna a baixa.
 */
final class MarmitexOrdersController
{
    use CompanyScope;

    public static function list(Request $req): void
    {
        $where = [];
        $params = [];
        if ($req->isCompany()) {
            $where[] = 'o.company_id = ?';
            $params[] = self::scopeCompany($req, null);
        } elseif ($req->query('company_id')) {
            $where[] = 'o.company_id = ?';
            $params[] = (int) $req->query('company_id');
        }
        if ($req->query('date')) {
            $where[] = 'o.service_date = ?';
            $params[] = self::parseDate($req->query('date'));
        }
        $clause = $where ? 'WHERE ' . implode(' AND ', $where) : '';
        Http::json(Db::query(
            "SELECT o.*, c.name AS company_name,
                    COUNT(m.id) AS marmita_count,
                    COALESCE(SUM(m.unit_price), 0) AS total_amount,
                    SUM(m.billed_invoice_id IS NOT NULL) AS billed_count
               FROM marmitex_orders o
               JOIN marmitex_companies c ON c.id = o.company_id
               LEFT JOIN marmitex_marmitas m ON m.order_id = o.id
               {$clause}
              GROUP BY o.id, c.name
              ORDER BY o.service_date DESC, c.name",
            $params
        ));
    }

    public static function getById(Request $req): void
    {
        $order = self::loadOrder($req->intParam('id'));
        self::scopeCompany($req, (int) $order['company_id']); // garante posse (company) / valida (admin)
        Http::json($order);
    }

    /** POST /marmitex/orders — cria OU substitui o pedido do dia (upsert por empresa+data). */
    public static function save(Request $req): void
    {
        $in = $req->input();
        $companyId = self::scopeCompany($req, $in->integer('company_id'));
        $serviceDate = self::parseDate($in->requireString('service_date'));
        $notes = $in->string('notes');

        $company = Db::queryOne('SELECT * FROM marmitex_companies WHERE id = ? AND active = 1', [$companyId]);
        if (!$company) {
            throw HttpError::notFound('Empresa não encontrada ou inativa');
        }
        // Horário de corte vale apenas para o login da empresa; admin lança a qualquer hora.
        if ($req->isCompany()) {
            self::assertBeforeCutoff($serviceDate, $company['order_cutoff_time']);
        }

        $id = MarmitexOrderWriter::saveDay(
            $companyId,
            $serviceDate,
            $in->array('marmitas', true),
            $notes,
            $req->userId(),
            'manual'
        );
        Http::json(self::loadOrder($id), 201);
    }

    /** DELETE /marmitex/orders/:id — cancela (remove) o pedido do dia. */
    public static function remove(Request $req): void
    {
        $id = $req->intParam('id');
        $order = Db::queryOne(
            'SELECT o.*, c.order_cutoff_time
               FROM marmitex_orders o JOIN marmitex_companies c ON c.id = o.company_id
              WHERE o.id = ?',
            [$id]
        );
        if (!$order) {
            throw HttpError::notFound('Pedido não encontrado');
        }
        self::scopeCompany($req, (int) $order['company_id']);

        if ($order['status'] === 'produced') {
            throw HttpError::badRequest('Produção já fechada: reabra o pedido para cancelá-lo');
        }
        $billed = Db::queryOne('SELECT COUNT(*) AS n FROM marmitex_marmitas WHERE order_id = ? AND billed_invoice_id IS NOT NULL', [$id]);
        if ((int) $billed['n'] > 0) {
            throw HttpError::badRequest('Pedido já faturado não pode ser cancelado');
        }
        if ($req->isCompany()) {
            self::assertBeforeCutoff($order['service_date'], $order['order_cutoff_time']);
        }
        Db::execute('DELETE FROM marmitex_orders WHERE id = ?', [$id]); // marmitas em cascata
        Http::noContent();
    }

    /**
     * GET /marmitex/orders/:id/production — prévia do consumo, sem gravar nada.
     * Alimenta o modal de confirmação de "Fechar produção".
     */
    public static function productionPreview(Request $req): void
    {
        $id = $req->intParam('id');
        self::loadOrder($id); // 404 se não existir
        $demand = Production::demand(Db::pdo(), $req->orgId(), $id); // só leitura

        $moves = [];
        foreach ($demand['items'] as $productId => $qty) {
            $p = Db::queryOne('SELECT name, unit, stock_qty FROM products WHERE id = ?', [$productId]);
            $moves[] = [
                'product_id' => $productId,
                'product_name' => $p['name'] ?? "#{$productId}",
                'unit' => $p['unit'] ?? null,
                'quantity' => $qty,
                'stock_qty' => (float) ($p['stock_qty'] ?? 0),
                'balance_after' => (float) ($p['stock_qty'] ?? 0) - $qty,
            ];
        }
        Http::json(['moves' => $moves, 'unlinked' => $demand['unlinked']]);
    }

    /** POST /marmitex/orders/:id/produce — fecha a produção e baixa o estoque dos insumos. */
    public static function produce(Request $req): void
    {
        $id = $req->intParam('id');
        $result = Db::transaction(function (PDO $pdo) use ($id, $req) {
            $order = self::lockOrder($pdo, $id);
            if ($order['status'] !== 'submitted') {
                throw HttpError::badRequest(
                    $order['status'] === 'produced' ? 'Produção já fechada' : 'Pedido cancelado não produz'
                );
            }
            $summary = Production::consume($pdo, $req->orgId(), $id, $req->userId());
            $pdo->prepare("UPDATE marmitex_orders SET status = 'produced', produced_at = NOW(), produced_by = ? WHERE id = ?")
                ->execute([$req->userId(), $id]);
            return $summary;
        });
        Http::json($result + ['order' => self::loadOrder($id)]);
    }

    /** POST /marmitex/orders/:id/reopen — estorna a baixa e devolve o pedido para edição. */
    public static function reopen(Request $req): void
    {
        $id = $req->intParam('id');
        Db::transaction(function (PDO $pdo) use ($id, $req) {
            $order = self::lockOrder($pdo, $id);
            if ($order['status'] !== 'produced') {
                throw HttpError::badRequest('A produção deste pedido não está fechada');
            }
            $billed = $pdo->prepare('SELECT COUNT(*) AS n FROM marmitex_marmitas WHERE order_id = ? AND billed_invoice_id IS NOT NULL');
            $billed->execute([$id]);
            if ((int) $billed->fetch()['n'] > 0) {
                throw HttpError::badRequest('Pedido já faturado não pode ser reaberto');
            }
            Production::revert($pdo, $req->orgId(), $id, $req->userId());
            $pdo->prepare("UPDATE marmitex_orders SET status = 'submitted', produced_at = NULL, produced_by = NULL WHERE id = ?")
                ->execute([$id]);
        });
        Http::json(self::loadOrder($id));
    }

    // ---- helpers ----

    /** Trava o pedido: a guarda de dupla-baixa é o status, não o log de movimentos. */
    private static function lockOrder(PDO $pdo, int $id): array
    {
        $st = $pdo->prepare('SELECT id, status FROM marmitex_orders WHERE id = ? FOR UPDATE');
        $st->execute([$id]);
        $order = $st->fetch();
        if (!$order) {
            throw HttpError::notFound('Pedido não encontrado');
        }
        return $order;
    }

    private static function loadOrder(int $id): array
    {
        $order = Db::queryOne(
            'SELECT o.*, c.name AS company_name, c.order_cutoff_time
               FROM marmitex_orders o JOIN marmitex_companies c ON c.id = o.company_id
              WHERE o.id = ?',
            [$id]
        );
        if (!$order) {
            throw HttpError::notFound('Pedido não encontrado');
        }
        $marmitas = Db::query('SELECT * FROM marmitex_marmitas WHERE order_id = ? ORDER BY id', [$id]);
        foreach ($marmitas as &$m) {
            // MySQL/PDO devolve colunas JSON como string; decodifica para o frontend.
            $m['sides_json'] = $m['sides_json'] ? json_decode($m['sides_json'], true) : [];
        }
        unset($m);
        $order['marmitas'] = $marmitas;
        return $order;
    }

    /** Trava de edição por horário de corte (ou, sem corte, bloqueia datas passadas). */
    private static function assertBeforeCutoff(string $serviceDate, ?string $cutoff): void
    {
        $cutoff = $cutoff ?: Env::get('MARMITEX_DEFAULT_CUTOFF', '');
        if (!$cutoff) {
            if ($serviceDate < date('Y-m-d')) {
                throw HttpError::forbidden('Não é possível alterar pedidos de dias anteriores');
            }
            return;
        }
        $deadline = strtotime($serviceDate . ' ' . $cutoff);
        if ($deadline !== false && time() > $deadline) {
            throw HttpError::forbidden('O horário-limite para alterar o pedido deste dia já passou');
        }
    }

    private static function parseDate(string $v): string
    {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $v)) {
            throw HttpError::badRequest('Data inválida (use AAAA-MM-DD)');
        }
        return $v;
    }
}
