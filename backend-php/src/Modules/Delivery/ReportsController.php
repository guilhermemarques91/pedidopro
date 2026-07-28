<?php

namespace App\Modules\Delivery;

use App\Core\Db;
use App\Core\Http;
use App\Core\Request;

/**
 * Relatórios operacionais de delivery (dados já capturados em delivery_orders).
 * Margem é ESTIMADA pela comissão (%) configurada no canal — a conciliação de
 * repasses reais virá da API Financeira (etapa futura).
 *
 * Quatro endpoints, um por aba da tela: summary (financeiro + modo de entrega),
 * customers (ranking/recorrência), items (mais vendidos) e performance
 * (evolução diária, horário de pico e tempos de operação).
 *
 * Filtros compartilhados: from, to, platform, delivery_mode. Todos escopados por
 * org_id — relatório é leitura de dados do restaurante, não pode cruzar org.
 */
final class ReportsController
{
    /** Modos de entrega conhecidos: quem faz a entrega (e portanto quem fica com a taxa). */
    private const MODE_OWN = 'own';         // entrega própria: a taxa é NOSSA receita
    private const MODE_PARTNER = 'partner'; // entrega da plataforma: a taxa é dela

    // ---------------------------------------------------------------- summary

    public static function summary(Request $req): void
    {
        $f = self::filters($req);

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
              WHERE {$f['where']}
              GROUP BY o.platform",
            $f['params']
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
        $totals['avg_ticket'] = $totals['orders'] > 0 ? round($totals['customer_paid'] / $totals['orders'], 2) : 0.0;

        Http::json([
            'from' => $f['from'],
            'to' => $f['to'],
            'platform' => $f['platform'],
            'delivery_mode' => $f['mode'],
            'totals' => $totals,
            'by_platform' => $byPlatform,
            'by_delivery_mode' => self::byDeliveryMode($f),
            'cancellations' => self::cancellations($f),
            'customers' => self::customerCounts($f),
            'top_regions' => self::topRegions($f),
        ]);
    }

    /**
     * Entrega PRÓPRIA × PARCEIRA. A distinção não é cosmética: na entrega própria a
     * taxa entra como receita nossa; na parceira a plataforma fica com ela (e de fato
     * grava delivery_fee NULL nesses pedidos), por isso a taxa só é somada no modo own.
     */
    private static function byDeliveryMode(array $f): array
    {
        $rows = Db::query(
            "SELECT COALESCE(o.delivery_mode, 'unknown') AS mode,
                    COUNT(*) AS orders,
                    COALESCE(SUM(o.customer_paid), 0) AS customer_paid,
                    COALESCE(SUM(o.items_amount), 0) AS items_amount,
                    COALESCE(SUM(o.delivery_fee), 0) AS delivery_fee,
                    COUNT(o.delivery_fee) AS orders_with_fee
               FROM delivery_orders o
              WHERE {$f['where']}
              GROUP BY mode
              ORDER BY orders DESC",
            $f['params']
        );

        $out = [];
        foreach ($rows as $r) {
            $orders = (int) $r['orders'];
            $fee = round((float) $r['delivery_fee'], 2);
            $withFee = (int) $r['orders_with_fee'];
            $out[] = [
                'mode' => (string) $r['mode'],
                'orders' => $orders,
                'customer_paid' => round((float) $r['customer_paid'], 2),
                'items_amount' => round((float) $r['items_amount'], 2),
                // Receita de taxa: só existe de fato na entrega própria.
                'delivery_fee' => $fee,
                'is_own_fee' => $r['mode'] === self::MODE_OWN,
                'orders_with_fee' => $withFee,
                'avg_fee' => $withFee > 0 ? round($fee / $withFee, 2) : 0.0,
                'avg_ticket' => $orders > 0 ? round((float) $r['customer_paid'] / $orders, 2) : 0.0,
            ];
        }
        return $out;
    }

    /** Cancelados ficam FORA do faturamento — aqui viram um indicador próprio (perda). */
    private static function cancellations(array $f): array
    {
        $c = self::filters($f['req'], true);
        $row = Db::queryOne(
            "SELECT COUNT(*) AS orders, COALESCE(SUM(o.customer_paid), 0) AS lost_amount
               FROM delivery_orders o
              WHERE {$c['where']}",
            $c['params']
        ) ?? [];

        $cancelled = (int) ($row['orders'] ?? 0);
        // Denominador = válidos + cancelados, para a taxa refletir o total que entrou.
        $valid = (int) (Db::queryOne(
            "SELECT COUNT(*) AS n FROM delivery_orders o WHERE {$f['where']}",
            $f['params']
        )['n'] ?? 0);
        $total = $valid + $cancelled;

        return [
            'orders' => $cancelled,
            'lost_amount' => round((float) ($row['lost_amount'] ?? 0), 2),
            'rate' => $total > 0 ? round($cancelled * 100 / $total, 2) : 0.0,
        ];
    }

    /**
     * Duas leituras diferentes de "cliente recorrente", que respondem perguntas distintas:
     *  - `returning`: já comprava ANTES do período (retenção da base antiga);
     *  - `repeat`: tem mais de um pedido no HISTÓRICO (fidelização, medida do total).
     * `repeat` sai de delivery_orders, não do contador delivery_customers.orders_count —
     * o contador é denormalizado e só voltou a ser confiável agora.
     */
    private static function customerCounts(array $f): array
    {
        // Todas as contagens saem do MESMO conjunto (clientes que pediram no período,
        // respeitando os filtros ativos). Contar "novos" direto de delivery_customers
        // quebrava a soma: incluía quem só teve pedido cancelado e ignorava o filtro de
        // modo de entrega, produzindo novos > ativos.
        $row = Db::queryOne(
            "SELECT COUNT(*) AS active,
                    COALESCE(SUM(first_order_at >= ?), 0) AS new_customers,
                    COALESCE(SUM(first_order_at < ?), 0) AS returning_customers,
                    COALESCE(SUM(lifetime > 1), 0) AS repeat_customers
               FROM (
                    SELECT o.customer_id,
                           dc.first_order_at,
                           (SELECT COUNT(*) FROM delivery_orders x
                             WHERE x.customer_id = o.customer_id AND x.status <> 'cancelled') AS lifetime
                      FROM delivery_orders o
                      JOIN delivery_customers dc ON dc.id = o.customer_id
                     WHERE {$f['where']} AND o.customer_id IS NOT NULL
                     GROUP BY o.customer_id, dc.first_order_at
               ) t",
            array_merge([$f['from'], $f['from']], $f['params'])
        ) ?? [];

        $active = (int) ($row['active'] ?? 0);
        $repeat = (int) ($row['repeat_customers'] ?? 0);
        $returning = (int) ($row['returning_customers'] ?? 0);

        return [
            'new' => (int) ($row['new_customers'] ?? 0),
            'recurring' => $returning, // mantido: nome já consumido pelo front
            'returning' => $returning,
            'active' => $active,
            'repeat' => $repeat,
            'one_time' => max(0, $active - $repeat),
            'repeat_rate' => $active > 0 ? round($repeat * 100 / $active, 1) : 0.0,
        ];
    }

    /** Top 10 bairros/cidades de entrega (best-effort do JSON do endereço). */
    private static function topRegions(array $f): array
    {
        return Db::query(
            "SELECT COALESCE(
                      NULLIF(JSON_UNQUOTE(JSON_EXTRACT(o.delivery_address, '$.neighborhood')), 'null'),
                      NULLIF(JSON_UNQUOTE(JSON_EXTRACT(o.delivery_address, '$.district')), 'null'),
                      NULLIF(JSON_UNQUOTE(JSON_EXTRACT(o.delivery_address, '$.city')), 'null'),
                      '—'
                    ) AS region,
                    COUNT(*) AS orders,
                    COALESCE(SUM(o.customer_paid), 0) AS customer_paid
               FROM delivery_orders o
              WHERE {$f['where']} AND o.delivery_address IS NOT NULL
              GROUP BY region
              ORDER BY orders DESC
              LIMIT 10",
            $f['params']
        );
    }

    // -------------------------------------------------------------- customers

    /**
     * Ranking de clientes do período: quantos pedidos, quanto gastaram e há quanto
     * tempo não voltam. `orders_total` (histórico completo, de delivery_customers) é o
     * que diz se o cliente é RECORRENTE de verdade — `orders` sozinho é só a janela.
     */
    public static function customers(Request $req): void
    {
        $f = self::filters($req);
        $limit = max(1, min((int) ($req->query('limit') ?? 50), 200));
        // Ordenação no BANCO (e não na tela) para que "A–Z" percorra todos os clientes,
        // não apenas os que sobraram depois do corte por valor.
        $sort = match ($req->query('sort')) {
            'orders' => 'orders DESC',
            'name' => 'name ASC',
            'recent' => 'last_order_at DESC',
            default => 'spent DESC',
        };

        // Recorrente = mais de um pedido no histórico (não "voltou dentro da janela"):
        // um cliente que pediu 5x na semana passada e 1x nesta é recorrente de qualquer forma.
        $having = $req->query('recurring') === '1' ? 'HAVING orders_total > 1' : '';

        $where = $f['where'] . ' AND o.customer_id IS NOT NULL';
        $params = $f['params'];
        $q = trim((string) ($req->query('q') ?? ''));
        if ($q !== '') {
            $where .= ' AND (dc.name LIKE ? OR dc.phone LIKE ? OR o.customer_name LIKE ?)';
            $like = '%' . $q . '%';
            array_push($params, $like, $like, $like);
        }

        $rows = Db::query(
            // GROUP BY só por dc.id: é a PK, então as demais colunas de dc são
            // funcionalmente dependentes e passam no only_full_group_by. Os campos que
            // vêm do PEDIDO (fallback de nome/telefone) precisam de agregação explícita.
            "SELECT dc.id,
                    COALESCE(dc.name, MAX(o.customer_name)) AS name,
                    COALESCE(dc.phone, MAX(o.customer_phone)) AS phone,
                    dc.platform,
                    dc.first_order_at,
                    dc.last_order_at,
                    (SELECT COUNT(*) FROM delivery_orders x
                      WHERE x.customer_id = dc.id AND x.status <> 'cancelled') AS orders_total,
                    COUNT(o.id) AS orders,
                    COALESCE(SUM(o.customer_paid), 0) AS spent,
                    DATEDIFF(CURDATE(), DATE(dc.last_order_at)) AS days_since_last
               FROM delivery_orders o
               JOIN delivery_customers dc ON dc.id = o.customer_id
              WHERE {$where}
              GROUP BY dc.id
              {$having}
              ORDER BY {$sort}
              LIMIT {$limit}",
            $params
        );

        $out = [];
        foreach ($rows as $r) {
            $orders = (int) $r['orders'];
            $spent = round((float) $r['spent'], 2);
            $out[] = [
                'id' => (int) $r['id'],
                'name' => $r['name'],
                'phone' => $r['phone'],
                'platform' => $r['platform'],
                'orders' => $orders,
                'orders_total' => (int) $r['orders_total'],
                'spent' => $spent,
                'avg_ticket' => $orders > 0 ? round($spent / $orders, 2) : 0.0,
                'first_order_at' => $r['first_order_at'],
                'last_order_at' => $r['last_order_at'],
                'days_since_last' => $r['days_since_last'] !== null ? (int) $r['days_since_last'] : null,
                'is_recurring' => (int) $r['orders_total'] > 1,
            ];
        }

        Http::json(['from' => $f['from'], 'to' => $f['to'], 'customers' => $out]);
    }

    // ------------------------------------------------------------------ items

    /** Itens mais vendidos no período (quantidade e receita), do delivery_order_items. */
    public static function items(Request $req): void
    {
        $f = self::filters($req);
        $limit = max(1, min((int) ($req->query('limit') ?? 50), 200));
        $sort = match ($req->query('sort')) {
            'revenue' => 'revenue DESC',
            'name' => 'name ASC',
            default => 'qty DESC',
        };

        $where = $f['where'];
        $params = $f['params'];
        $q = trim((string) ($req->query('q') ?? ''));
        if ($q !== '') {
            $where .= ' AND i.name LIKE ?';
            $params[] = '%' . $q . '%';
        }

        $rows = Db::query(
            "SELECT i.name,
                    COALESCE(SUM(i.quantity), 0) AS qty,
                    COALESCE(SUM(i.total), 0) AS revenue,
                    COUNT(DISTINCT o.id) AS orders
               FROM delivery_order_items i
               JOIN delivery_orders o ON o.id = i.order_id
              WHERE {$where}
              GROUP BY i.name
              ORDER BY {$sort}
              LIMIT {$limit}",
            $params
        );

        $out = array_map(static function (array $r): array {
            $qty = (float) $r['qty'];
            $revenue = round((float) $r['revenue'], 2);
            return [
                'name' => (string) $r['name'],
                'qty' => $qty,
                'orders' => (int) $r['orders'],
                'revenue' => $revenue,
                'avg_price' => $qty > 0 ? round($revenue / $qty, 2) : 0.0,
            ];
        }, $rows);

        Http::json(['from' => $f['from'], 'to' => $f['to'], 'items' => $out]);
    }

    // ------------------------------------------------------------ performance

    /** Evolução diária, horário de pico, dia da semana e tempos de operação. */
    public static function performance(Request $req): void
    {
        $f = self::filters($req);

        $daily = Db::query(
            "SELECT DATE(o.created_at) AS day,
                    COUNT(*) AS orders,
                    COALESCE(SUM(o.customer_paid), 0) AS revenue
               FROM delivery_orders o
              WHERE {$f['where']}
              GROUP BY day
              ORDER BY day",
            $f['params']
        );

        // Horário do pedido: placed_at é o carimbo da plataforma; created_at é quando
        // o ingest capturou. Sem placed_at o created_at é a melhor aproximação.
        $hourly = Db::query(
            "SELECT HOUR(COALESCE(o.placed_at, o.created_at)) AS hour,
                    COUNT(*) AS orders,
                    COALESCE(SUM(o.customer_paid), 0) AS revenue
               FROM delivery_orders o
              WHERE {$f['where']}
              GROUP BY hour
              ORDER BY hour",
            $f['params']
        );

        // DAYOFWEEK: 1=domingo … 7=sábado (normalizado para 0..6 no retorno).
        $weekday = Db::query(
            "SELECT DAYOFWEEK(COALESCE(o.placed_at, o.created_at)) AS dow,
                    COUNT(*) AS orders,
                    COALESCE(SUM(o.customer_paid), 0) AS revenue
               FROM delivery_orders o
              WHERE {$f['where']}
              GROUP BY dow
              ORDER BY dow",
            $f['params']
        );

        Http::json([
            'from' => $f['from'],
            'to' => $f['to'],
            'daily' => array_map(static fn(array $r): array => [
                'day' => (string) $r['day'],
                'orders' => (int) $r['orders'],
                'revenue' => round((float) $r['revenue'], 2),
            ], $daily),
            'hourly' => array_map(static fn(array $r): array => [
                'hour' => (int) $r['hour'],
                'orders' => (int) $r['orders'],
                'revenue' => round((float) $r['revenue'], 2),
            ], $hourly),
            'weekday' => array_map(static fn(array $r): array => [
                'dow' => ((int) $r['dow']) - 1,
                'orders' => (int) $r['orders'],
                'revenue' => round((float) $r['revenue'], 2),
            ], $weekday),
            'timings' => self::timings($f),
        ]);
    }

    /**
     * Tempos médios de cada etapa, em minutos. Só conta transições com os DOIS
     * carimbos presentes e em ordem; o filtro de 0..24h descarta pedido esquecido
     * aberto de um dia pro outro, que sozinho distorceria a média.
     */
    private static function timings(array $f): array
    {
        $leg = static fn(string $a, string $b): string =>
            "AVG(CASE WHEN o.{$a} IS NOT NULL AND o.{$b} IS NOT NULL
                       AND o.{$b} > o.{$a}
                       AND TIMESTAMPDIFF(MINUTE, o.{$a}, o.{$b}) <= 1440
                      THEN TIMESTAMPDIFF(MINUTE, o.{$a}, o.{$b}) END)";

        $row = Db::queryOne(
            "SELECT {$leg('placed_at', 'confirmed_at')} AS to_confirm,
                    {$leg('confirmed_at', 'ready_at')} AS to_ready,
                    {$leg('ready_at', 'dispatched_at')} AS to_dispatch,
                    {$leg('dispatched_at', 'concluded_at')} AS to_conclude,
                    {$leg('placed_at', 'concluded_at')} AS total,
                    COUNT(o.concluded_at) AS concluded
               FROM delivery_orders o
              WHERE {$f['where']}",
            $f['params']
        ) ?? [];

        $min = static fn(?string $v): ?float => $v === null ? null : round((float) $v, 1);
        return [
            'to_confirm_min' => $min($row['to_confirm'] ?? null),
            'to_ready_min' => $min($row['to_ready'] ?? null),
            'to_dispatch_min' => $min($row['to_dispatch'] ?? null),
            'to_conclude_min' => $min($row['to_conclude'] ?? null),
            'total_min' => $min($row['total'] ?? null),
            'concluded' => (int) ($row['concluded'] ?? 0),
        ];
    }

    // ---------------------------------------------------------------- helpers

    /**
     * Monta o WHERE compartilhado por todos os relatórios.
     * $cancelled=false → só pedidos válidos (faturamento); true → só os cancelados.
     *
     * @return array{where:string,params:array,from:string,to:string,platform:?string,mode:?string,orgId:int,req:Request}
     */
    private static function filters(Request $req, bool $cancelled = false): array
    {
        $to = $req->query('to') ?? date('Y-m-d');
        $from = $req->query('from') ?? date('Y-m-d', strtotime('-29 days'));
        $platform = $req->query('platform');
        $mode = $req->query('delivery_mode');
        $orgId = $req->orgId();

        $where = 'o.org_id = ? AND o.created_at >= ? AND o.created_at < (? + INTERVAL 1 DAY)'
            . ($cancelled ? " AND o.status = 'cancelled'" : " AND o.status <> 'cancelled'");
        $params = [$orgId, $from, $to];

        if ($platform !== null && $platform !== '') {
            $where .= ' AND o.platform = ?';
            $params[] = $platform;
        }
        if ($mode !== null && $mode !== '') {
            // 'unknown' = pedido sem modo gravado (retirada/balcão ou payload antigo).
            if ($mode === 'unknown') {
                $where .= ' AND o.delivery_mode IS NULL';
            } else {
                $where .= ' AND o.delivery_mode = ?';
                $params[] = $mode;
            }
        }

        return [
            'where' => $where, 'params' => $params, 'from' => $from, 'to' => $to,
            'platform' => $platform ?: null, 'mode' => $mode ?: null, 'orgId' => $orgId, 'req' => $req,
        ];
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
}
