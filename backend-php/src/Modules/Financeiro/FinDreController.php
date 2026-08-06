<?php

namespace App\Modules\Financeiro;

use App\Core\Db;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Request;

/**
 * DRE mensal: árvore de contas com análise vertical (% da venda bruta) e
 * horizontal (variação contra o mês de comparação).
 *
 * mode=gerencial (padrão) desconsidera as contas marcadas como fora do DRE;
 * mode=original reproduz exatamente o que veio do AllFood, para conferência.
 */
final class FinDreController
{
    public static function months(Request $req): void
    {
        // `lines` é palavra reservada no MySQL (LOAD DATA ... LINES TERMINATED BY):
        // sem alias diferente, o SELECT não compila.
        $rows = Db::query(
            'SELECT ref_month, COUNT(*) AS line_count
               FROM fin_dre_lines
              WHERE org_id = ?
              GROUP BY ref_month
              ORDER BY ref_month DESC',
            [$req->orgId()]
        );
        Http::json([
            'months' => array_map(static fn ($r) => [
                'ref_month' => $r['ref_month'],
                'lines' => (int) $r['line_count'],
            ], $rows),
        ]);
    }

    public static function dre(Request $req): void
    {
        $orgId = $req->orgId();
        $month = self::month($req->query('month') ?? self::latestMonth($orgId));
        if ($month === null) {
            Http::json(['month' => null, 'lines' => [], 'totals' => null, 'empty' => true]);
        }

        $managerial = ($req->query('mode') ?? 'gerencial') !== 'original';
        $compare = $req->query('compare');
        $compare = $compare !== null ? self::month($compare) : self::previousMonth($orgId, $month);

        $current = DreCalculator::build($orgId, $month, $managerial);
        if (!$current['lines']) {
            throw HttpError::notFound("Nenhum DRE importado para {$month}.");
        }

        $compareData = $compare !== null ? DreCalculator::build($orgId, $compare, $managerial) : null;
        $compareByCode = [];
        if ($compareData) {
            foreach ($compareData['lines'] as $l) {
                $compareByCode[$l['code']] = $l['amount'];
            }
        }

        $lines = array_map(static function (array $l) use ($compareByCode, $compareData) {
            $prev = $compareData ? ($compareByCode[$l['code']] ?? null) : null;
            $l['compare_amount'] = $prev;
            $l['delta'] = $prev === null ? null : round($l['amount'] - $prev, 2);
            // Variação % só faz sentido com base diferente de zero.
            $l['delta_pct'] = ($prev === null || abs($prev) < 0.005)
                ? null
                : round(($l['amount'] - $prev) / abs($prev), 4);
            return $l;
        }, $current['lines']);

        Http::json([
            'month' => $month,
            'compare' => $compare,
            'mode' => $managerial ? 'gerencial' : 'original',
            'lines' => $lines,
            'totals' => $current['totals'],
            'compare_totals' => $compareData['totals'] ?? null,
            'groups' => $current['groups'],
            'warnings' => $current['warnings'],
            'excluded' => $current['excluded'],
        ]);
    }

    // ---- helpers ----

    private static function month(?string $raw): ?string
    {
        if ($raw === null) {
            return null;
        }
        if (!preg_match('/^\d{4}-\d{2}$/', $raw)) {
            throw HttpError::badRequest('Mês inválido — use AAAA-MM.');
        }
        return $raw;
    }

    private static function latestMonth(int $orgId): ?string
    {
        $row = Db::queryOne('SELECT MAX(ref_month) AS m FROM fin_dre_lines WHERE org_id = ?', [$orgId]);
        return $row['m'] ?? null;
    }

    /** Mês importado imediatamente anterior (nem sempre é o mês calendário anterior). */
    private static function previousMonth(int $orgId, string $month): ?string
    {
        $row = Db::queryOne(
            'SELECT MAX(ref_month) AS m FROM fin_dre_lines WHERE org_id = ? AND ref_month < ?',
            [$orgId, $month]
        );
        return $row['m'] ?? null;
    }
}
