<?php

namespace App\Modules\Financeiro;

use App\Core\Db;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Request;

/**
 * Análises derivadas das planilhas: rentabilidade por canal, margem por produto,
 * evolução de CMV/custos e ponto de equilíbrio.
 */
final class FinAnalyticsController
{
    // ---- Rentabilidade por canal ----

    /**
     * Consolida fin_platform_daily por plataforma. O take-rate efetivo
     * (comissão + ofertas + taxa de pagamento sobre a receita bruta) é o número
     * que mostra quanto de cada real vendido fica na plataforma.
     */
    public static function canais(Request $req): void
    {
        [$from, $to] = self::range($req);
        $orgId = $req->orgId();

        $rows = Db::query(
            "SELECT platform,
                    SUM(orders) AS orders,
                    SUM(cancelled_orders) AS cancelled_orders,
                    SUM(gross_revenue) AS gross_revenue,
                    SUM(commission) AS commission,
                    SUM(offers_cost) AS offers_cost,
                    SUM(payment_fee) AS payment_fee,
                    SUM(platform_rewards) AS platform_rewards,
                    SUM(net_revenue) AS net_revenue,
                    SUM(cancelled_value) AS cancelled_value,
                    SUM(visitors) AS visitors,
                    SUM(new_customers) AS new_customers,
                    SUM(returning_customers) AS returning_customers,
                    AVG(NULLIF(rating, 0)) AS rating,
                    AVG(NULLIF(prep_time_avg, 0)) AS prep_time_avg,
                    COUNT(*) AS days
               FROM fin_platform_daily
              WHERE org_id = ? AND stat_date BETWEEN ? AND ?
              GROUP BY platform
              ORDER BY SUM(gross_revenue) DESC",
            [$orgId, $from, $to]
        );

        $platforms = array_map([self::class, 'channelRow'], $rows);
        $totals = self::channelTotals($platforms);

        $daily = Db::query(
            "SELECT stat_date, platform,
                    COALESCE(gross_revenue, 0) AS gross_revenue,
                    COALESCE(commission, 0) + COALESCE(offers_cost, 0) + COALESCE(payment_fee, 0) AS platform_cost,
                    COALESCE(net_revenue, 0) AS net_revenue,
                    COALESCE(orders, 0) AS orders
               FROM fin_platform_daily
              WHERE org_id = ? AND stat_date BETWEEN ? AND ?
              ORDER BY stat_date",
            [$orgId, $from, $to]
        );
        foreach ($daily as &$d) {
            $d['gross_revenue'] = round((float) $d['gross_revenue'], 2);
            $d['platform_cost'] = round((float) $d['platform_cost'], 2);
            $d['net_revenue'] = round((float) $d['net_revenue'], 2);
            $d['orders'] = (int) $d['orders'];
        }

        Http::json(['from' => $from, 'to' => $to, 'platforms' => $platforms, 'totals' => $totals, 'daily' => $daily]);
    }

    private static function channelRow(array $r): array
    {
        $gross = round((float) $r['gross_revenue'], 2);
        $commission = round((float) $r['commission'], 2);
        $offers = round((float) $r['offers_cost'], 2);
        $paymentFee = round((float) $r['payment_fee'], 2);
        $platformCost = round($commission + $offers + $paymentFee, 2);
        $orders = (int) $r['orders'];

        return [
            'platform' => $r['platform'],
            'days' => (int) $r['days'],
            'orders' => $orders,
            'cancelled_orders' => (int) $r['cancelled_orders'],
            'gross_revenue' => $gross,
            'commission' => $commission,
            'offers_cost' => $offers,
            'payment_fee' => $paymentFee,
            'platform_cost' => $platformCost,
            'platform_rewards' => round((float) $r['platform_rewards'], 2),
            'net_revenue' => round((float) $r['net_revenue'], 2),
            'cancelled_value' => round((float) $r['cancelled_value'], 2),
            'visitors' => (int) $r['visitors'],
            'new_customers' => (int) $r['new_customers'],
            'returning_customers' => (int) $r['returning_customers'],
            'rating' => $r['rating'] === null ? null : round((float) $r['rating'], 2),
            'prep_time_avg' => $r['prep_time_avg'] === null ? null : round((float) $r['prep_time_avg'], 1),
            'take_rate' => $gross > 0 ? round($platformCost / $gross, 4) : null,
            'avg_ticket' => $orders > 0 ? round($gross / $orders, 2) : null,
        ];
    }

    private static function channelTotals(array $platforms): array
    {
        $sum = [
            'orders' => 0, 'cancelled_orders' => 0, 'gross_revenue' => 0.0, 'commission' => 0.0,
            'offers_cost' => 0.0, 'payment_fee' => 0.0, 'platform_cost' => 0.0,
            'platform_rewards' => 0.0, 'net_revenue' => 0.0, 'cancelled_value' => 0.0,
        ];
        foreach ($platforms as $p) {
            foreach ($sum as $k => $_) {
                $sum[$k] += $p[$k];
            }
        }
        foreach ($sum as $k => $v) {
            $sum[$k] = is_float($v) ? round($v, 2) : $v;
        }
        $sum['take_rate'] = $sum['gross_revenue'] > 0 ? round($sum['platform_cost'] / $sum['gross_revenue'], 4) : null;
        $sum['avg_ticket'] = $sum['orders'] > 0 ? round($sum['gross_revenue'] / $sum['orders'], 2) : null;
        return $sum;
    }

    // ---- Margem por produto ----

    /**
     * Margem por prato a partir do snapshot da ficha técnica.
     *
     * Com ?channel=, aplica o take-rate REAL daquela plataforma (calculado das
     * planilhas do período, ou o valor fixado em Configurações) sobre o preço de
     * venda — é o que revela o prato que dá lucro no balcão e prejuízo no app.
     */
    public static function produtos(Request $req): void
    {
        $orgId = $req->orgId();
        $snapshot = $req->query('snapshot') ?? self::latestSnapshot($orgId);
        if ($snapshot === null) {
            Http::json(['snapshot' => null, 'items' => [], 'empty' => true, 'channels' => []]);
        }
        self::assertDate($snapshot);

        $channels = self::channelTakeRates($orgId);
        $channel = $req->query('channel');
        $takeRate = 0.0;
        if ($channel !== null && $channel !== 'balcao') {
            if (!isset($channels[$channel])) {
                throw HttpError::badRequest("Canal desconhecido: {$channel}");
            }
            $takeRate = $channels[$channel];
        }

        $rows = Db::query(
            'SELECT classe, item_name, unit, cost_total, sale_price
               FROM fin_product_costs
              WHERE org_id = ? AND snapshot_date = ?
              ORDER BY item_name',
            [$orgId, $snapshot]
        );

        $items = [];
        $noCost = 0;
        foreach ($rows as $r) {
            $cost = round((float) $r['cost_total'], 4);
            $price = $r['sale_price'] === null ? null : round((float) $r['sale_price'], 2);
            // Custo zerado = item sem ficha técnica cadastrada, não item de graça.
            // Tratar como margem de 100% seria mentira: fica fora das estatísticas.
            $hasCost = $cost > 0;
            if (!$hasCost) {
                $noCost++;
            }
            $netPrice = $price === null ? null : round($price * (1 - $takeRate), 2);
            $margin = ($netPrice === null || !$hasCost) ? null : round($netPrice - $cost, 2);

            $items[] = [
                'item_name' => $r['item_name'],
                'classe' => $r['classe'],
                'unit' => $r['unit'],
                'cost' => $cost,
                'has_cost' => $hasCost,
                'sale_price' => $price,
                'net_price' => $netPrice,
                'margin' => $margin,
                'margin_pct' => ($margin !== null && $netPrice > 0) ? round($margin / $netPrice, 4) : null,
                'markup' => ($price !== null && $hasCost) ? round($price / $cost, 2) : null,
                'cost_pct' => ($price !== null && $price > 0 && $hasCost) ? round($cost / $price, 4) : null,
            ];
        }

        // Sem preço ou sem custo não dá para falar de margem — separa em vez de fingir zero.
        $priced = array_values(array_filter($items, static fn ($i) => $i['margin'] !== null));
        usort($priced, static fn ($a, $b) => $a['margin_pct'] <=> $b['margin_pct']);
        $negatives = array_values(array_filter($priced, static fn ($i) => $i['margin'] < 0));

        $marginPcts = array_column($priced, 'margin_pct');

        Http::json([
            'snapshot' => $snapshot,
            'snapshots' => self::snapshots($orgId),
            'channel' => $channel ?? 'balcao',
            'channels' => self::channelOptions($channels),
            'take_rate' => $takeRate,
            'items' => $items,
            'worst' => array_slice($priced, 0, 10),
            'best' => array_slice(array_reverse($priced), 0, 10),
            'negatives' => $negatives,
            'summary' => [
                'items' => count($items),
                'priced' => count($priced),
                'unpriced' => count($items) - count($priced),
                'no_cost' => $noCost,
                'negative' => count($negatives),
                'avg_margin_pct' => $marginPcts ? round(array_sum($marginPcts) / count($marginPcts), 4) : null,
                'median_margin_pct' => self::median($marginPcts),
            ],
            // O ranking é por margem UNITÁRIA: nenhuma das três planilhas traz
            // quantidade vendida por item, então não dá para fazer curva ABC.
            'note' => 'As planilhas importadas não trazem quantidade vendida por item — o ranking é por margem unitária, não por contribuição total.',
        ]);
    }

    /** Take-rate efetivo por plataforma, com override das configurações. */
    private static function channelTakeRates(int $orgId): array
    {
        $out = [];
        $rows = Db::query(
            'SELECT platform,
                    SUM(gross_revenue) AS gross,
                    SUM(COALESCE(commission,0) + COALESCE(offers_cost,0) + COALESCE(payment_fee,0)) AS cost
               FROM fin_platform_daily
              WHERE org_id = ?
              GROUP BY platform',
            [$orgId]
        );
        foreach ($rows as $r) {
            $gross = (float) $r['gross'];
            if ($gross > 0) {
                $out[$r['platform']] = round((float) $r['cost'] / $gross, 4);
            }
        }

        $settings = FinAccountsController::load($orgId);
        foreach ((array) ($settings['channel_commission'] ?? []) as $platform => $pct) {
            if (is_numeric($pct)) {
                $out[$platform] = round((float) $pct / 100, 4);
            }
        }
        return $out;
    }

    private static function channelOptions(array $rates): array
    {
        $out = [['key' => 'balcao', 'label' => 'Balcão / retirada (sem comissão)', 'take_rate' => 0.0]];
        foreach ($rates as $key => $rate) {
            $out[] = [
                'key' => $key,
                'label' => $key === 'ifood' ? 'iFood' : ($key === '99food' ? '99Food' : $key),
                'take_rate' => $rate,
            ];
        }
        return $out;
    }

    // ---- CMV e evolução de custo ----

    public static function cmv(Request $req): void
    {
        $orgId = $req->orgId();

        // Série mensal de CMV a partir dos DREs importados.
        $months = Db::query(
            'SELECT DISTINCT ref_month FROM fin_dre_lines WHERE org_id = ? ORDER BY ref_month',
            [$orgId]
        );
        $series = [];
        foreach ($months as $m) {
            $built = DreCalculator::build($orgId, $m['ref_month'], true);
            $t = $built['totals'];
            $series[] = [
                'ref_month' => $m['ref_month'],
                'receita_liquida' => $t['receita_liquida'],
                'cmv' => $t['cmv'],
                'cmv_pct' => $t['cmv_pct'],
                'custos' => $t['custos'],
                'lucro_bruto' => $t['lucro_bruto'],
                'margem_bruta' => $t['margem_bruta'],
            ];
        }

        // Evolução do custo unitário de cada insumo entre os snapshots da ficha
        // técnica. O agrupamento é por component_key (nome normalizado), senão
        // "Arroz Branco" e "ARROZ BRANCO" viram dois insumos e a variação some.
        $rows = Db::query(
            'SELECT component_key, MAX(component_name) AS component_name,
                    snapshot_date, AVG(unit_cost) AS unit_cost
               FROM fin_product_components
              WHERE org_id = ? AND unit_cost IS NOT NULL AND unit_cost > 0
              GROUP BY component_key, snapshot_date
              ORDER BY component_key, snapshot_date',
            [$orgId]
        );

        // Acumula por CHAVE e só no fim troca pelo nome de exibição — a grafia
        // do MAX() pode variar entre snapshots do mesmo insumo.
        $byKey = [];
        $displayName = [];
        foreach ($rows as $r) {
            $key = $r['component_key'];
            $displayName[$key] ??= $r['component_name'];
            $byKey[$key][] = [
                'snapshot_date' => $r['snapshot_date'],
                'unit_cost' => round((float) $r['unit_cost'], 4),
            ];
        }
        $components = [];
        foreach ($byKey as $key => $points) {
            $components[$displayName[$key]] = $points;
        }

        $movers = [];
        foreach ($components as $name => $points) {
            if (count($points) < 2) {
                continue;
            }
            $first = $points[0];
            $last = $points[count($points) - 1];
            if ($first['unit_cost'] <= 0) {
                continue;
            }
            $movers[] = [
                'component_name' => $name,
                'from_date' => $first['snapshot_date'],
                'to_date' => $last['snapshot_date'],
                'from_cost' => $first['unit_cost'],
                'to_cost' => $last['unit_cost'],
                'delta' => round($last['unit_cost'] - $first['unit_cost'], 4),
                'delta_pct' => round(($last['unit_cost'] - $first['unit_cost']) / $first['unit_cost'], 4),
                'points' => count($points),
            ];
        }
        usort($movers, static fn ($a, $b) => abs($b['delta_pct']) <=> abs($a['delta_pct']));

        Http::json([
            'series' => $series,
            'components' => $components,
            'movers' => array_slice($movers, 0, 30),
            'snapshots' => self::snapshots($orgId),
        ]);
    }

    // ---- Ponto de equilíbrio ----

    public static function breakeven(Request $req): void
    {
        $orgId = $req->orgId();
        $month = $req->query('month') ?? self::latestDreMonth($orgId);
        if ($month === null) {
            Http::json(['month' => null, 'empty' => true]);
        }
        if (!preg_match('/^\d{4}-\d{2}$/', $month)) {
            throw HttpError::badRequest('Mês inválido — use AAAA-MM.');
        }

        $built = DreCalculator::build($orgId, $month, true);
        if (!$built['lines']) {
            throw HttpError::notFound("Nenhum DRE importado para {$month}.");
        }

        $totals = $built['totals'];
        $behavior = DreCalculator::behaviorTotals($built['lines']);
        $fixed = round($behavior['fixo'] ?? 0.0, 2);
        $variable = round($behavior['variavel'] ?? 0.0, 2);
        $unclassified = round($behavior['nao_classificado'] ?? 0.0, 2);

        $receitaLiquida = $totals['receita_liquida'];
        // Margem de contribuição: sobra de cada real vendido depois dos custos
        // que só existem porque houve venda (CMV, comissão, taxa de cartão).
        $contributionMargin = round($receitaLiquida - $variable, 2);
        $cmPct = $receitaLiquida > 0 ? round($contributionMargin / $receitaLiquida, 6) : null;

        $breakeven = ($cmPct !== null && $cmPct > 0) ? round($fixed / $cmPct, 2) : null;
        $daysInMonth = (int) date('t', strtotime($month . '-01'));
        $dailyAvg = $receitaLiquida > 0 ? round($receitaLiquida / $daysInMonth, 2) : 0.0;

        Http::json([
            'month' => $month,
            'receita_liquida' => $receitaLiquida,
            'receita_bruta' => $totals['receita_bruta'],
            'custo_fixo' => $fixed,
            'custo_variavel' => $variable,
            'custo_nao_classificado' => $unclassified,
            'margem_contribuicao' => $contributionMargin,
            'margem_contribuicao_pct' => $cmPct,
            'ponto_equilibrio' => $breakeven,
            // Quanto a receita pode cair antes de dar prejuízo.
            'margem_seguranca' => $breakeven !== null ? round($receitaLiquida - $breakeven, 2) : null,
            'margem_seguranca_pct' => ($breakeven !== null && $receitaLiquida > 0)
                ? round(($receitaLiquida - $breakeven) / $receitaLiquida, 4)
                : null,
            'dias_no_mes' => $daysInMonth,
            'receita_media_diaria' => $dailyAvg,
            'dias_para_equilibrio' => ($breakeven !== null && $dailyAvg > 0) ? round($breakeven / $dailyAvg, 1) : null,
            'resultado_liquido' => $totals['resultado_liquido'],
            'atingiu' => $breakeven !== null ? $receitaLiquida >= $breakeven : null,
            'warnings' => $built['warnings'],
            'nao_classificado_alerta' => $unclassified != 0.0,
        ]);
    }

    // ---- Visão geral ----

    public static function overview(Request $req): void
    {
        $orgId = $req->orgId();
        $months = Db::query(
            'SELECT DISTINCT ref_month FROM fin_dre_lines WHERE org_id = ? ORDER BY ref_month',
            [$orgId]
        );
        if (!$months) {
            Http::json(['empty' => true, 'series' => [], 'current' => null, 'previous' => null]);
        }

        $series = [];
        foreach ($months as $m) {
            $t = DreCalculator::build($orgId, $m['ref_month'], true)['totals'];
            $series[] = array_merge(['ref_month' => $m['ref_month']], $t);
        }

        $current = $series[count($series) - 1];
        $previous = count($series) > 1 ? $series[count($series) - 2] : null;

        Http::json([
            'series' => $series,
            'current' => $current,
            'previous' => $previous,
            'warnings' => DreCalculator::build($orgId, $current['ref_month'], true)['warnings'],
        ]);
    }

    // ---- helpers ----

    /** @return array{0:string,1:string} */
    private static function range(Request $req): array
    {
        $to = $req->query('to') ?? date('Y-m-d');
        $from = $req->query('from') ?? date('Y-m-d', strtotime('-29 days'));
        self::assertDate($from);
        self::assertDate($to);
        return [$from, $to];
    }

    private static function assertDate(string $d): void
    {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $d)) {
            throw HttpError::badRequest('Data inválida — use AAAA-MM-DD.');
        }
    }

    private static function latestSnapshot(int $orgId): ?string
    {
        $row = Db::queryOne('SELECT MAX(snapshot_date) AS d FROM fin_product_costs WHERE org_id = ?', [$orgId]);
        return $row['d'] ?? null;
    }

    private static function snapshots(int $orgId): array
    {
        return array_column(
            Db::query(
                'SELECT DISTINCT snapshot_date FROM fin_product_costs WHERE org_id = ? ORDER BY snapshot_date DESC',
                [$orgId]
            ),
            'snapshot_date'
        );
    }

    private static function latestDreMonth(int $orgId): ?string
    {
        $row = Db::queryOne('SELECT MAX(ref_month) AS m FROM fin_dre_lines WHERE org_id = ?', [$orgId]);
        return $row['m'] ?? null;
    }

    private static function median(array $values): ?float
    {
        if (!$values) {
            return null;
        }
        sort($values);
        $n = count($values);
        $mid = intdiv($n, 2);
        return round($n % 2 ? $values[$mid] : ($values[$mid - 1] + $values[$mid]) / 2, 4);
    }
}
