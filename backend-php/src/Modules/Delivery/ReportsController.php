<?php

namespace App\Modules\Delivery;

use App\Core\Db;
use App\Core\Http;
use App\Core\Request;
use App\Services\Costing;
use App\Services\DeliveryStock;

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

    // ------------------------------------------------- engenharia de cardápio

    /**
     * Popularidade × margem: quais pratos sustentam a operação e quais só ocupam a cozinha.
     *
     * A aba "mais vendidos" agrupa por texto e para por aí — vê quanto vendeu, nunca quanto
     * sobrou. Aqui o nome do item do pedido é resolvido até o item do cardápio (mesma
     * normalização que a baixa de estoque usa, DeliveryStock::key) e daí até o custo da
     * ficha técnica, então dá para comparar o que entra com o que a comida custou.
     *
     * A receita vem LÍQUIDA da comissão do canal, calculada linha a linha: cada pedido sabe
     * de que canal veio, e é o líquido que paga o insumo. Um prato campeão de vendas no
     * iFood pode perder do mesmo prato no 99Food só pela comissão.
     *
     * Classificação clássica, contra a MEDIANA do próprio período (não há régua absoluta —
     * "vender bem" num restaurante é vender bem comparado ao resto do cardápio dele):
     *   estrela        alta popularidade + alta margem  -> proteger, nunca mexer no preço à toa
     *   cavalo         alta popularidade + baixa margem -> renegociar insumo ou subir preço
     *   quebra_cabeca  baixa popularidade + alta margem -> vale empurrar (destaque, foto)
     *   abacaxi        baixa popularidade + baixa margem -> candidato a sair do cardápio
     */
    public static function menuEngineering(Request $req): void
    {
        $f = self::filters($req);
        $orgId = $f['orgId'];

        // Líquido por linha: a comissão é do canal do pedido, não uma média do período.
        $rows = Db::query(
            "SELECT i.name,
                    COALESCE(SUM(i.quantity), 0) AS qty,
                    COALESCE(SUM(i.total), 0) AS revenue,
                    COALESCE(SUM(i.total * (1 - COALESCE(ch.commission_rate, 0) / 100)), 0) AS net_revenue,
                    COUNT(DISTINCT o.id) AS orders
               FROM delivery_order_items i
               JOIN delivery_orders o ON o.id = i.order_id
               LEFT JOIN channels ch ON ch.id = o.channel_id
              WHERE {$f['where']}
              GROUP BY i.name",
            $f['params']
        );

        $menu = self::menuByKey($orgId);
        $pdo = Db::pdo();

        $items = [];
        $unmatched = [];
        foreach ($rows as $r) {
            $qty = (float) $r['qty'];
            if ($qty <= 0) {
                continue;
            }
            $name = (string) $r['name'];
            $revenue = round((float) $r['revenue'], 2);
            $net = round((float) $r['net_revenue'], 2);

            $link = $menu[DeliveryStock::key($name)] ?? null;
            if ($link === null) {
                // Vendeu e o cardápio mestre não conhece: também não baixou estoque.
                $unmatched[] = ['name' => $name, 'qty' => $qty, 'revenue' => $revenue];
                continue;
            }

            $c = Costing::menuCost($pdo, $orgId, $link['erp_product_id'], $link['erp_qty']);
            $costUnit = $c['cost'];
            $costTotal = $costUnit !== null ? round($costUnit * $qty, 2) : null;
            $marginTotal = $costTotal !== null ? round($net - $costTotal, 2) : null;

            $items[] = [
                'name' => $name,
                'menu_item_id' => $link['id'],
                'menu_item_name' => $link['name'],
                'qty' => $qty,
                'orders' => (int) $r['orders'],
                'revenue' => $revenue,
                'net_revenue' => $net,
                'avg_price' => round($revenue / $qty, 2),
                'cost_unit' => $costUnit !== null ? round($costUnit, 4) : null,
                'cost_total' => $costTotal,
                'cost_source' => $c['cost_source'],
                'margin_total' => $marginTotal,
                'margin_unit' => $marginTotal !== null ? round($marginTotal / $qty, 4) : null,
                'margin_pct' => ($marginTotal !== null && $net > 0) ? round($marginTotal / $net * 100, 2) : null,
                'quadrant' => null,
            ];
        }

        // Medianas só entre quem TEM custo: incluir item sem ficha puxaria a régua para
        // baixo e promoveria a estrela qualquer prato cujo custo ninguém cadastrou.
        $costed = array_values(array_filter($items, static fn ($i) => $i['margin_unit'] !== null));
        $medQty = self::median(array_column($costed, 'qty'));
        $medMargin = self::median(array_column($costed, 'margin_unit'));

        foreach ($items as &$i) {
            if ($i['margin_unit'] === null) {
                continue;
            }
            $popular = $i['qty'] >= $medQty;
            $profitable = $i['margin_unit'] >= $medMargin;
            $i['quadrant'] = $popular
                ? ($profitable ? 'estrela' : 'cavalo')
                : ($profitable ? 'quebra_cabeca' : 'abacaxi');
        }
        unset($i);

        usort($items, static fn ($a, $b) => ($b['margin_total'] ?? -INF) <=> ($a['margin_total'] ?? -INF));
        usort($unmatched, static fn ($a, $b) => $b['revenue'] <=> $a['revenue']);

        // Os totais somam APENAS os itens com custo conhecido. Incluir os outros contaria a
        // receita deles com custo zero e devolveria uma margem alta que não existe — o erro
        // que a lista de "sem custo" existe justamente para não deixar passar. A receita que
        // ficou de fora vai separada, para o número ser lido com a régua certa.
        $totRevenue = round(array_sum(array_column($costed, 'revenue')), 2);
        $totNet = round(array_sum(array_column($costed, 'net_revenue')), 2);
        $totCost = round(array_sum(array_column($costed, 'cost_total')), 2);
        $totMargin = round($totNet - $totCost, 2);
        $outRevenue = round(
            array_sum(array_column($items, 'revenue')) - $totRevenue + array_sum(array_column($unmatched, 'revenue')),
            2
        );

        Http::json([
            'from' => $f['from'],
            'to' => $f['to'],
            'median_qty' => $medQty,
            'median_margin_unit' => $medMargin,
            'items' => $items,
            'unmatched' => $unmatched,
            'totals' => [
                'revenue' => $totRevenue,
                'net_revenue' => $totNet,
                'cost' => $totCost,
                'margin' => $totMargin,
                'margin_pct' => $totNet > 0 ? round($totMargin / $totNet * 100, 2) : null,
                'costed_items' => count($costed),
                'uncosted_items' => count($items) - count($costed),
                'unmatched_items' => count($unmatched),
                'uncovered_revenue' => $outRevenue,
            ],
        ]);
    }

    /**
     * Cardápio indexado pela chave de casamento de nomes.
     *
     * Homônimos são resolvidos como em DeliveryStock::menuIndex — primeiro o que tem
     * vínculo com o ERP, depois o ativo, depois o mais antigo — para que o relatório e a
     * baixa de estoque escolham SEMPRE o mesmo item do cardápio.
     *
     * @return array<string,array{id:int,name:string,erp_product_id:?int,erp_qty:float}>
     */
    private static function menuByKey(int $orgId): array
    {
        $out = [];
        $rows = Db::query(
            'SELECT id, name, erp_product_id, erp_qty FROM menu_items WHERE org_id = ?
              ORDER BY (erp_product_id IS NOT NULL) DESC, active DESC, id',
            [$orgId]
        );
        foreach ($rows as $r) {
            $qty = (float) ($r['erp_qty'] ?? 1);
            $out[DeliveryStock::key((string) $r['name'])] ??= [
                'id' => (int) $r['id'],
                'name' => (string) $r['name'],
                'erp_product_id' => $r['erp_product_id'] !== null ? (int) $r['erp_product_id'] : null,
                'erp_qty' => $qty > 0 ? $qty : 1.0,
            ];
        }
        return $out;
    }

    /** @param array<int,float> $values */
    private static function median(array $values): float
    {
        if (!$values) {
            return 0.0;
        }
        sort($values);
        $n = count($values);
        $mid = intdiv($n, 2);
        return $n % 2 === 1 ? (float) $values[$mid] : (float) (($values[$mid - 1] + $values[$mid]) / 2);
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
