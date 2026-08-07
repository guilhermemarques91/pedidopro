<?php

namespace App\Modules\Financeiro;

use App\Core\Db;

/**
 * Totais das plataformas, mesclando as duas granularidades importadas.
 *
 * O 99Food exporta por DIA; o iFood exporta pedidos/nota por dia (relatório de
 * qualidade) mas o faturamento só no agregado do MÊS (relatório de vendas).
 *
 * Regra da mescla, por plataforma e por métrica: **o diário vence quando
 * existe; o mensal preenche o que o diário não traz.** Assim o iFood soma os
 * pedidos do relatório diário com o faturamento do mensal sem contar duas
 * vezes, e o 99Food (que só tem diário) não muda em nada.
 */
final class PlatformTotals
{
    /** Métricas mescladas entre as duas fontes. */
    private const METRICS = [
        'orders', 'gross_revenue', 'delivery_fee', 'commission',
        'offers_cost', 'payment_fee', 'new_customers',
    ];

    /** Totais do mês (AAAA-MM), por plataforma. @return array<string,array<string,float|null>> */
    public static function byPlatformForMonth(int $orgId, string $month): array
    {
        $daily = self::dailyRows(
            $orgId,
            "DATE_FORMAT(stat_date, '%Y-%m') = ?",
            [$month]
        );
        $monthly = self::monthlyRows($orgId, 'ref_month = ?', [$month]);
        return self::merge($daily, $monthly);
    }

    /**
     * Totais de um intervalo de datas, por plataforma. Linhas mensais só entram
     * quando o mês inteiro cabe no intervalo — meio mês de um total agregado
     * seria chute.
     * @return array<string,array<string,float|null>>
     */
    public static function byPlatformForRange(int $orgId, string $from, string $to): array
    {
        $daily = self::dailyRows($orgId, 'stat_date BETWEEN ? AND ?', [$from, $to]);
        $monthly = self::monthlyRows(
            $orgId,
            "DATE_FORMAT(?, '%Y-%m-%d') <= CONCAT(ref_month, '-01')
             AND LAST_DAY(CONCAT(ref_month, '-01')) <= DATE_FORMAT(?, '%Y-%m-%d')",
            [$from, $to]
        );
        return self::merge($daily, $monthly);
    }

    /** Soma consolidada de todas as plataformas no mês. @return array<string,float> */
    public static function forMonth(int $orgId, string $month): array
    {
        return self::flatten(self::byPlatformForMonth($orgId, $month));
    }

    // ---- consultas ----

    private static function dailyRows(int $orgId, string $where, array $params): array
    {
        return Db::query(
            "SELECT platform,
                    SUM(orders) AS orders,
                    SUM(gross_revenue) AS gross_revenue,
                    SUM(delivery_fee) AS delivery_fee,
                    SUM(commission) AS commission,
                    SUM(offers_cost) AS offers_cost,
                    SUM(payment_fee) AS payment_fee,
                    SUM(new_customers) AS new_customers,
                    SUM(cancelled_orders) AS cancelled_orders,
                    SUM(cancelled_value) AS cancelled_value,
                    SUM(platform_rewards) AS platform_rewards,
                    SUM(visitors) AS visitors,
                    SUM(returning_customers) AS returning_customers,
                    AVG(NULLIF(rating, 0)) AS rating,
                    AVG(NULLIF(prep_time_avg, 0)) AS prep_time_avg,
                    COUNT(*) AS days
               FROM fin_platform_daily
              WHERE org_id = ? AND {$where}
              GROUP BY platform",
            array_merge([$orgId], $params)
        );
    }

    private static function monthlyRows(int $orgId, string $where, array $params): array
    {
        return Db::query(
            "SELECT platform,
                    SUM(orders) AS orders,
                    SUM(gross_revenue) AS gross_revenue,
                    SUM(delivery_fee) AS delivery_fee,
                    SUM(commission) AS commission,
                    SUM(offers_cost) AS offers_cost,
                    SUM(payment_fee) AS payment_fee,
                    SUM(new_customers) AS new_customers
               FROM fin_platform_monthly
              WHERE org_id = ? AND {$where}
              GROUP BY platform",
            array_merge([$orgId], $params)
        );
    }

    // ---- mescla ----

    private static function merge(array $daily, array $monthly): array
    {
        $out = [];

        foreach ($daily as $d) {
            $out[$d['platform']] = [
                'platform' => $d['platform'],
                'days' => (int) $d['days'],
                'cancelled_orders' => (int) $d['cancelled_orders'],
                'cancelled_value' => round((float) $d['cancelled_value'], 2),
                'platform_rewards' => round((float) $d['platform_rewards'], 2),
                'visitors' => (int) $d['visitors'],
                'returning_customers' => (int) $d['returning_customers'],
                'rating' => $d['rating'] === null ? null : round((float) $d['rating'], 2),
                'prep_time_avg' => $d['prep_time_avg'] === null ? null : round((float) $d['prep_time_avg'], 1),
                'sources' => ['diario'],
            ];
            foreach (self::METRICS as $m) {
                $out[$d['platform']][$m] = self::num($d[$m] ?? null);
            }
        }

        foreach ($monthly as $mo) {
            $p = $mo['platform'];
            if (!isset($out[$p])) {
                $out[$p] = [
                    'platform' => $p, 'days' => 0, 'cancelled_orders' => 0, 'cancelled_value' => 0.0,
                    'platform_rewards' => 0.0, 'visitors' => 0, 'returning_customers' => 0,
                    'rating' => null, 'prep_time_avg' => null, 'sources' => [],
                ];
                foreach (self::METRICS as $m) {
                    $out[$p][$m] = null;
                }
            }
            $out[$p]['sources'][] = 'mensal';
            foreach (self::METRICS as $m) {
                // O diário só "vence" se realmente trouxe o número; zero ou NULL
                // significa que aquele relatório não cobre essa métrica.
                $current = $out[$p][$m] ?? null;
                if ($current === null || $current == 0.0) {
                    $out[$p][$m] = self::num($mo[$m] ?? null);
                }
            }
        }

        foreach ($out as $p => $row) {
            $gross = (float) ($row['gross_revenue'] ?? 0);
            $fee = (float) ($row['delivery_fee'] ?? 0);
            $cost = (float) ($row['commission'] ?? 0)
                + (float) ($row['offers_cost'] ?? 0)
                + (float) ($row['payment_fee'] ?? 0);
            // Na entrega própria a taxa é dinheiro da loja, então entra na receita.
            $out[$p]['revenue_total'] = round($gross + $fee, 2);
            $out[$p]['platform_cost'] = round($cost, 2);
            $out[$p]['net_revenue'] = round($gross + $fee - $cost, 2);
            $out[$p]['take_rate'] = $gross > 0 ? round($cost / $gross, 4) : null;
            $orders = (int) ($row['orders'] ?? 0);
            $out[$p]['orders'] = $orders;
            $out[$p]['avg_ticket'] = $orders > 0 ? round($gross / $orders, 2) : null;
            // Sem comissão importada não dá para dizer que o take-rate é zero.
            $out[$p]['commission_known'] = $row['commission'] !== null;
        }

        return $out;
    }

    /** @return array<string,float> */
    private static function flatten(array $byPlatform): array
    {
        $sum = [
            'gross_revenue' => 0.0, 'delivery_fee' => 0.0, 'revenue_total' => 0.0,
            'commission' => 0.0, 'offers_cost' => 0.0, 'payment_fee' => 0.0,
            'platform_cost' => 0.0, 'net_revenue' => 0.0, 'orders' => 0,
        ];
        $missingCommission = [];
        foreach ($byPlatform as $p) {
            foreach ($sum as $k => $_) {
                $sum[$k] += (float) ($p[$k] ?? 0);
            }
            if (!$p['commission_known'] && ($p['gross_revenue'] ?? 0) > 0) {
                $missingCommission[] = $p['platform'];
            }
        }
        foreach ($sum as $k => $v) {
            $sum[$k] = round($v, 2);
        }
        $sum['orders'] = (int) $sum['orders'];
        $sum['platforms'] = count($byPlatform);
        $sum['missing_commission'] = $missingCommission;
        return $sum;
    }

    private static function num(mixed $v): ?float
    {
        return $v === null ? null : round((float) $v, 2);
    }
}
