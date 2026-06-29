<?php

namespace App\Modules\Delivery;

use App\Core\Db;
use App\Core\Http;
use App\Core\Request;

/**
 * Relatórios operacionais de delivery (dados já capturados em delivery_orders).
 * Margem é ESTIMADA pela comissão (%) configurada no canal — a conciliação de
 * repasses reais virá da API Financeira (etapa futura).
 */
final class ReportsController
{
    public static function summary(Request $req): void
    {
        [$from, $to] = self::range($req);
        $platform = $req->query('platform');

        $cond = "o.created_at >= ? AND o.created_at < (? + INTERVAL 1 DAY) AND o.status <> 'cancelled'";
        $params = [$from, $to];
        if ($platform !== null) {
            $cond .= ' AND o.platform = ?';
            $params[] = $platform;
        }

        // Agregados por plataforma (comissão estimada via channels.commission_rate).
        $rows = Db::query(
            "SELECT o.platform,
                    COUNT(*) AS orders,
                    COALESCE(SUM(o.items_amount), 0) AS items_amount,
                    COALESCE(SUM(o.delivery_fee), 0) AS delivery_fee,
                    COALESCE(SUM(CASE WHEN o.delivery_mode = 'own' THEN o.delivery_fee ELSE 0 END), 0) AS own_delivery_fee,
                    COALESCE(SUM(o.discount_merchant), 0) AS discount_merchant,
                    COALESCE(SUM(o.discount_platform), 0) AS discount_platform,
                    COALESCE(SUM(o.customer_paid), 0) AS customer_paid,
                    COALESCE(SUM(o.items_amount * COALESCE(c.commission_rate, 0) / 100), 0) AS commission_est
               FROM delivery_orders o
               LEFT JOIN channels c ON c.id = o.channel_id
              WHERE {$cond}
              GROUP BY o.platform",
            $params
        );

        $byPlatform = [];
        $totals = self::zero();
        foreach ($rows as $r) {
            $p = self::platformRow($r);
            $byPlatform[] = $p;
            foreach (self::zero() as $k => $_) {
                $totals[$k] += $p[$k];
            }
        }

        Http::json([
            'from' => $from,
            'to' => $to,
            'platform' => $platform,
            'totals' => $totals,
            'by_platform' => $byPlatform,
            'customers' => self::customers($from, $to, $platform),
            'top_regions' => self::topRegions($cond, $params),
        ]);
    }

    // ---- helpers ----

    /** @return array{0:string,1:string} [from, to] em Y-m-d */
    private static function range(Request $req): array
    {
        $to = $req->query('to') ?? date('Y-m-d');
        $from = $req->query('from') ?? date('Y-m-d', strtotime('-29 days'));
        return [$from, $to];
    }

    private static function zero(): array
    {
        return [
            'orders' => 0, 'items_amount' => 0.0, 'delivery_fee' => 0.0, 'own_delivery_fee' => 0.0,
            'discount_merchant' => 0.0, 'discount_platform' => 0.0, 'customer_paid' => 0.0,
            'commission_est' => 0.0, 'margin_est' => 0.0,
        ];
    }

    private static function platformRow(array $r): array
    {
        $orders = (int) $r['orders'];
        $items = (float) $r['items_amount'];
        $commission = round((float) $r['commission_est'], 2);
        $ownFee = (float) $r['own_delivery_fee'];
        $discMerchant = (float) $r['discount_merchant'];
        // Margem estimada: receita de itens - comissão - descontos da loja + taxa de entrega própria.
        $margin = round($items - $commission - $discMerchant + $ownFee, 2);
        return [
            'platform' => (string) $r['platform'],
            'orders' => $orders,
            'items_amount' => round($items, 2),
            'delivery_fee' => round((float) $r['delivery_fee'], 2),
            'own_delivery_fee' => round($ownFee, 2),
            'discount_merchant' => round($discMerchant, 2),
            'discount_platform' => round((float) $r['discount_platform'], 2),
            'customer_paid' => round((float) $r['customer_paid'], 2),
            'commission_est' => $commission,
            'margin_est' => $margin,
            'avg_ticket' => $orders > 0 ? round((float) $r['customer_paid'] / $orders, 2) : 0.0,
        ];
    }

    /** Clientes novos (1º pedido no período) vs. recorrentes (já compravam antes). */
    private static function customers(string $from, string $to, ?string $platform): array
    {
        $pNew = [$from, $to];
        $newCond = 'first_order_at >= ? AND first_order_at < (? + INTERVAL 1 DAY)';
        if ($platform !== null) {
            $newCond .= ' AND platform = ?';
            $pNew[] = $platform;
        }
        $new = (int) (Db::queryOne("SELECT COUNT(*) AS n FROM delivery_customers WHERE {$newCond}", $pNew)['n'] ?? 0);

        $pRec = [$from, $to, $from];
        $recCond = "o.created_at >= ? AND o.created_at < (? + INTERVAL 1 DAY) AND o.customer_id IS NOT NULL AND dc.first_order_at < ?";
        if ($platform !== null) {
            $recCond .= ' AND o.platform = ?';
            $pRec[] = $platform;
        }
        $recurring = (int) (Db::queryOne(
            "SELECT COUNT(DISTINCT o.customer_id) AS n
               FROM delivery_orders o JOIN delivery_customers dc ON dc.id = o.customer_id
              WHERE {$recCond}",
            $pRec
        )['n'] ?? 0);

        return ['new' => $new, 'recurring' => $recurring];
    }

    /** Top 10 bairros/cidades de entrega (best-effort do JSON do endereço). */
    private static function topRegions(string $cond, array $params): array
    {
        return Db::query(
            "SELECT COALESCE(
                      NULLIF(JSON_UNQUOTE(JSON_EXTRACT(o.delivery_address, '$.neighborhood')), 'null'),
                      NULLIF(JSON_UNQUOTE(JSON_EXTRACT(o.delivery_address, '$.district')), 'null'),
                      NULLIF(JSON_UNQUOTE(JSON_EXTRACT(o.delivery_address, '$.city')), 'null'),
                      '—'
                    ) AS region,
                    COUNT(*) AS orders
               FROM delivery_orders o
              WHERE {$cond} AND o.delivery_address IS NOT NULL
              GROUP BY region
              ORDER BY orders DESC
              LIMIT 10",
            $params
        );
    }
}
