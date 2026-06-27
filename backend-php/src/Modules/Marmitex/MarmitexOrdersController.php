<?php

namespace App\Modules\Marmitex;

use App\Core\Db;
use App\Core\Env;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Request;
use PDO;

/**
 * Pedidos diários da empresa. Um pedido por empresa por dia (upsert por service_date).
 * Cada marmita é uma linha (nome + tamanho + proteína + acompanhamentos + obs), com
 * snapshot do nome/preço do catálogo no momento do envio. O login 'company' só altera
 * antes do horário de corte; admin não tem corte. Pedidos já faturados não mudam.
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

        $marmitas = self::parseMarmitas($in->array('marmitas', true));

        $id = Db::transaction(function (PDO $pdo) use ($companyId, $serviceDate, $notes, $marmitas, $req) {
            $find = $pdo->prepare('SELECT id FROM marmitex_orders WHERE company_id = ? AND service_date = ?');
            $find->execute([$companyId, $serviceDate]);
            $existing = $find->fetch();

            if ($existing) {
                $orderId = (int) $existing['id'];
                $billed = $pdo->prepare('SELECT COUNT(*) AS n FROM marmitex_marmitas WHERE order_id = ? AND billed_invoice_id IS NOT NULL');
                $billed->execute([$orderId]);
                if ((int) $billed->fetch()['n'] > 0) {
                    throw HttpError::badRequest('Pedido já faturado não pode ser alterado');
                }
                $pdo->prepare("UPDATE marmitex_orders SET notes = ?, status = 'submitted' WHERE id = ?")
                    ->execute([$notes, $orderId]);
                $pdo->prepare('DELETE FROM marmitex_marmitas WHERE order_id = ?')->execute([$orderId]);
            } else {
                $pdo->prepare('INSERT INTO marmitex_orders (company_id, service_date, notes, created_by) VALUES (?, ?, ?, ?)')
                    ->execute([$companyId, $serviceDate, $notes, $req->userId()]);
                $orderId = (int) $pdo->lastInsertId();
            }
            self::insertMarmitas($pdo, $orderId, $companyId, $serviceDate, $marmitas);
            return $orderId;
        });
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

    // ---- helpers ----

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

    /** Valida cada marmita contra o catálogo ativo e gera o snapshot (nome/preço). */
    private static function parseMarmitas(array $raw): array
    {
        if (!$raw) {
            throw HttpError::badRequest('Inclua ao menos uma marmita');
        }
        $sizes = [];
        foreach (Db::query('SELECT id, name, price FROM marmitex_sizes WHERE active = 1') as $s) {
            $sizes[(int) $s['id']] = $s;
        }
        $proteins = [];
        foreach (Db::query('SELECT id, name FROM marmitex_proteins WHERE active = 1') as $p) {
            $proteins[(int) $p['id']] = $p['name'];
        }
        $sidesCat = [];
        foreach (Db::query('SELECT id, name FROM marmitex_sides WHERE active = 1') as $s) {
            $sidesCat[(int) $s['id']] = $s['name'];
        }

        $out = [];
        foreach ($raw as $r) {
            $sizeId = isset($r['size_id']) ? (int) $r['size_id'] : 0;
            if (!isset($sizes[$sizeId])) {
                throw HttpError::badRequest('Selecione um tamanho válido em cada marmita');
            }
            $size = $sizes[$sizeId];

            $proteinId = isset($r['protein_id']) && $r['protein_id'] ? (int) $r['protein_id'] : null;
            $proteinName = null;
            if ($proteinId !== null) {
                if (!isset($proteins[$proteinId])) {
                    throw HttpError::badRequest('Proteína inválida em uma das marmitas');
                }
                $proteinName = $proteins[$proteinId];
            }

            $sides = [];
            $sideIds = isset($r['side_ids']) && is_array($r['side_ids']) ? $r['side_ids'] : [];
            foreach ($sideIds as $sid) {
                $sid = (int) $sid;
                if (!isset($sidesCat[$sid])) {
                    throw HttpError::badRequest('Acompanhamento inválido em uma das marmitas');
                }
                $sides[] = ['id' => $sid, 'name' => $sidesCat[$sid]];
            }

            $person = isset($r['person_name']) && is_string($r['person_name']) ? trim($r['person_name']) : '';
            $obs = isset($r['observation']) && is_string($r['observation']) ? trim($r['observation']) : '';

            $out[] = [
                'person_name' => $person !== '' ? $person : null,
                'size_id' => $sizeId,
                'size_name' => $size['name'],
                'protein_id' => $proteinId,
                'protein_name' => $proteinName,
                'sides_json' => json_encode($sides, JSON_UNESCAPED_UNICODE),
                'observation' => $obs !== '' ? $obs : null,
                'unit_price' => (float) $size['price'],
            ];
        }
        return $out;
    }

    private static function insertMarmitas(PDO $pdo, int $orderId, int $companyId, string $serviceDate, array $marmitas): void
    {
        $stmt = $pdo->prepare(
            'INSERT INTO marmitex_marmitas
               (order_id, company_id, service_date, person_name, size_id, size_name, protein_id, protein_name, sides_json, observation, unit_price)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        foreach ($marmitas as $m) {
            $stmt->execute([
                $orderId, $companyId, $serviceDate, $m['person_name'], $m['size_id'], $m['size_name'],
                $m['protein_id'], $m['protein_name'], $m['sides_json'], $m['observation'], $m['unit_price'],
            ]);
        }
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
