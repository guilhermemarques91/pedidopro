<?php

namespace App\Modules\Marmitex;

use App\Core\Db;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Request;
use PDO;

/**
 * Relatório de consumo (para emissão da NF-e) e fechamento de período. O relatório
 * agrupa marmitas PENDENTES (não faturadas) por tamanho+proteína+preço. Fechar o
 * período cria uma fatura e marca as marmitas como faturadas (somem dos próximos
 * relatórios), tudo numa transação para evitar faturamento duplo. Apenas admin.
 */
final class MarmitexReportController
{
    /** GET /marmitex/report — agregado de pendentes por empresa + período (preview). */
    public static function report(Request $req): void
    {
        $companyId = (int) ($req->query('company_id') ?? 0);
        if ($companyId <= 0) {
            throw HttpError::badRequest('Informe a empresa');
        }
        $start = self::date($req->query('start'));
        $end = self::date($req->query('end'));

        $where = ['m.company_id = ?', 'm.billed_invoice_id IS NULL'];
        $params = [$companyId];
        if ($start) {
            $where[] = 'm.service_date >= ?';
            $params[] = $start;
        }
        if ($end) {
            $where[] = 'm.service_date <= ?';
            $params[] = $end;
        }
        $rows = self::aggregate(Db::pdo(), implode(' AND ', $where), $params);
        [$grand, $count] = self::totals($rows);

        Http::json([
            'company' => Db::queryOne('SELECT id, name, cnpj FROM marmitex_companies WHERE id = ?', [$companyId]),
            'period' => ['start' => $start, 'end' => $end],
            'rows' => $rows,
            'grand_total' => $grand,
            'marmita_count' => $count,
        ]);
    }

    /** POST /marmitex/report/close — fecha o período: cria fatura + marca faturadas. */
    public static function close(Request $req): void
    {
        $in = $req->input();
        $companyId = (int) $in->integer('company_id', true);
        $start = self::date($in->string('start'));
        $end = self::date($in->string('end'));
        if (!$start || !$end) {
            throw HttpError::badRequest('Informe o início e o fim do período');
        }
        if ($start > $end) {
            throw HttpError::badRequest('Período inválido (início depois do fim)');
        }

        $invoiceId = Db::transaction(function (PDO $pdo) use ($companyId, $start, $end, $req) {
            $rows = self::aggregate(
                $pdo,
                'm.company_id = ? AND m.billed_invoice_id IS NULL AND m.service_date BETWEEN ? AND ?',
                [$companyId, $start, $end]
            );
            if (!$rows) {
                throw HttpError::badRequest('Nenhuma marmita pendente neste período');
            }
            [$grand, $count] = self::totals($rows);
            $reportJson = json_encode(
                ['rows' => $rows, 'grand_total' => $grand, 'marmita_count' => $count],
                JSON_UNESCAPED_UNICODE
            );

            $pdo->prepare(
                'INSERT INTO marmitex_invoices
                   (company_id, period_start, period_end, total_amount, marmita_count, report_json, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?)'
            )->execute([$companyId, $start, $end, $grand, $count, $reportJson, $req->userId()]);
            $id = (int) $pdo->lastInsertId();

            $pdo->prepare(
                'UPDATE marmitex_marmitas SET billed_invoice_id = ?
                  WHERE company_id = ? AND billed_invoice_id IS NULL AND service_date BETWEEN ? AND ?'
            )->execute([$id, $companyId, $start, $end]);
            return $id;
        });
        Http::json(self::invoice($invoiceId), 201);
    }

    public static function invoices(Request $req): void
    {
        $cid = $req->query('company_id');
        $where = $cid ? 'WHERE i.company_id = ?' : '';
        $params = $cid ? [(int) $cid] : [];
        Http::json(Db::query(
            "SELECT i.*, c.name AS company_name
               FROM marmitex_invoices i JOIN marmitex_companies c ON c.id = i.company_id
               {$where}
              ORDER BY i.created_at DESC",
            $params
        ));
    }

    public static function getInvoice(Request $req): void
    {
        Http::json(self::invoice($req->intParam('id')));
    }

    /** POST /marmitex/invoices/:id/cancel — reabre as marmitas (volta a pendentes). */
    public static function cancelInvoice(Request $req): void
    {
        $id = $req->intParam('id');
        $inv = self::invoice($id);
        if ($inv['status'] === 'cancelled') {
            throw HttpError::badRequest('Faturamento já cancelado');
        }
        Db::transaction(function (PDO $pdo) use ($id) {
            $pdo->prepare('UPDATE marmitex_marmitas SET billed_invoice_id = NULL WHERE billed_invoice_id = ?')->execute([$id]);
            $pdo->prepare("UPDATE marmitex_invoices SET status = 'cancelled' WHERE id = ?")->execute([$id]);
        });
        Http::json(self::invoice($id));
    }

    // ---- helpers ----

    /** Agrega marmitas por (tamanho, proteína, preço). $clause sem o 'WHERE'. */
    private static function aggregate(PDO $pdo, string $clause, array $params): array
    {
        $stmt = $pdo->prepare(
            "SELECT m.size_name, m.protein_name, m.unit_price,
                    COUNT(*) AS quantity, SUM(m.unit_price) AS line_total
               FROM marmitex_marmitas m
              WHERE {$clause}
              GROUP BY m.size_name, m.protein_name, m.unit_price
              ORDER BY m.size_name, m.protein_name"
        );
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    /** @return array{0:float,1:int} total geral e contagem de marmitas */
    private static function totals(array $rows): array
    {
        $grand = 0.0;
        $count = 0;
        foreach ($rows as $r) {
            $grand += (float) $r['line_total'];
            $count += (int) $r['quantity'];
        }
        return [$grand, $count];
    }

    private static function invoice(int $id): array
    {
        $row = Db::queryOne(
            'SELECT i.*, c.name AS company_name, c.cnpj
               FROM marmitex_invoices i JOIN marmitex_companies c ON c.id = i.company_id
              WHERE i.id = ?',
            [$id]
        );
        if (!$row) {
            throw HttpError::notFound('Faturamento não encontrado');
        }
        return $row;
    }

    private static function date(?string $v): ?string
    {
        if ($v === null || $v === '') {
            return null;
        }
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $v)) {
            throw HttpError::badRequest('Data inválida (use AAAA-MM-DD)');
        }
        return $v;
    }
}
