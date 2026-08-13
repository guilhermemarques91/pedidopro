<?php

namespace App\Services;

use App\Core\Db;
use PDO;

/**
 * Baixa de estoque por ficha técnica nos pedidos de DELIVERY (iFood/99Food).
 *
 * O item do pedido (`delivery_order_items`) só tem NOME em texto — a ponte com o ERP é o
 * cardápio: casa o nome com um item do cardápio (`menu_items`) e segue o de-para
 * `menu_items.erp_product_id` até o produto, cuja ficha técnica é explodida (ver Recipe).
 * O MESMO vale para os complementos (proteína, acompanhamento), que vêm no JSON
 * `options` do item e casam com `menu_options` — sem eles a baixa erraria justamente
 * no que varia de pedido pra pedido.
 *
 * Item sem vínculo simplesmente não movimenta (degradação segura) — a baixa é opt-in:
 * só acontece para o que o operador mapeou a um produto.
 *
 * Idempotência é do carimbo `delivery_orders.stock_consumed_at`, conferido sob
 * `SELECT ... FOR UPDATE` — espelha o Production do Marmitex, mas o gatilho aqui é o
 * ciclo do pedido: sync() decide pelo status atual (baixa a partir de confirmado;
 * estorna ao cancelar), então qualquer caminho que mude o status — painel, aceite
 * automático, reconciliação, varredura — dá a mesma baixa. Estorno nunca deleta
 * movimento: lança a entrada compensatória (ver Stock::apply).
 */
final class DeliveryStock
{
    /** A partir daqui o pedido está em produção: os insumos já saíram da despensa. */
    private const CONSUMING = ['confirmed', 'preparing', 'ready', 'dispatched', 'concluded'];

    /**
     * O que o pedido consome, já resolvido a insumo.
     *
     * @return array{items: array<int,float>, unlinked: string[]}
     *         items    = product_id => quantidade (insumos, receita explodida)
     *         unlinked = nomes (itens e complementos) sem produto vinculado (não movimentam)
     */
    public static function demand(PDO $pdo, int $orgId, int $orderId): array
    {
        $menu = self::menuIndex($pdo, $orgId);
        $sold = [];     // product_id do ERP => unidades vendidas
        $unlinked = [];

        $st = $pdo->prepare('SELECT name, quantity, options FROM delivery_order_items WHERE order_id = ?');
        $st->execute([$orderId]);
        foreach ($st->fetchAll() as $it) {
            $qty = (float) $it['quantity'];
            if ($qty <= 0) {
                continue;
            }
            $name = (string) $it['name'];
            $menuItem = $menu['items'][self::key($name)] ?? null;
            if ($menuItem !== null && $menuItem['product_id'] !== null) {
                $pid = $menuItem['product_id'];
                $sold[$pid] = ($sold[$pid] ?? 0) + $qty * $menuItem['qty'];
            } else {
                $unlinked[] = $name;
            }

            // Complementos: quantidade da opção é POR unidade do item — multiplica.
            foreach (self::flattenOptions($it['options']) as $opt) {
                $link = self::resolveOption($menu, $menuItem['id'] ?? null, $opt['name']);
                if ($link === null) {
                    $unlinked[] = $opt['name'];
                    continue;
                }
                $pid = $link['product_id'];
                $sold[$pid] = ($sold[$pid] ?? 0) + $qty * $opt['quantity'] * $link['qty'];
            }
        }

        $items = [];
        foreach ($sold as $productId => $qty) {
            foreach (Recipe::explode($pdo, $orgId, $productId, $qty) as $componentId => $need) {
                $items[$componentId] = ($items[$componentId] ?? 0) + $need;
            }
        }
        return ['items' => $items, 'unlinked' => array_values(array_unique($unlinked))];
    }

    /**
     * Cardápio da org indexado por nome normalizado, numa tacada só (o cardápio é
     * pequeno; consultar por nome item a item seria N queries por pedido).
     *
     * @return array{items: array<string,array{id:int,product_id:?int,qty:float}>,
     *               optionsByItem: array<int,array<string,array{product_id:int,qty:float}>>,
     *               options: array<string,array{product_id:int,qty:float}>}
     */
    private static function menuIndex(PDO $pdo, int $orgId): array
    {
        // Homônimos existem de verdade no cardápio (import repetido, edição em massa).
        // A ordenação decide qual deles representa o nome: primeiro o que TEM vínculo
        // (senão mapear o item não teria efeito), depois o ativo, depois o mais antigo.
        $items = [];
        $st = $pdo->prepare(
            'SELECT id, name, erp_product_id, erp_qty FROM menu_items WHERE org_id = ?
              ORDER BY (erp_product_id IS NOT NULL) DESC, active DESC, id'
        );
        $st->execute([$orgId]);
        foreach ($st->fetchAll() as $r) {
            $items[self::key((string) $r['name'])] ??= [
                'id' => (int) $r['id'],
                'product_id' => $r['erp_product_id'] !== null ? (int) $r['erp_product_id'] : null,
                'qty' => self::factor($r['erp_qty'] ?? null),
            ];
        }

        // Complementos vinculados: indexados por item (resolução preferencial) e por
        // nome global (o pedido nem sempre permite saber de qual item veio a opção).
        $optionsByItem = [];
        $options = [];
        // A classe de complementos é compartilhada: o caminho até o item passa pelo
        // vínculo (menu_item_option_groups), e a mesma opção pode aparecer em N itens.
        $st = $pdo->prepare(
            'SELECT o.name, o.erp_product_id, o.erp_qty, l.item_id
               FROM menu_options o
               JOIN menu_option_groups g ON g.id = o.group_id
               JOIN menu_item_option_groups l ON l.group_id = g.id
               JOIN menu_items i ON i.id = l.item_id
              WHERE i.org_id = ? AND o.erp_product_id IS NOT NULL
              ORDER BY o.active DESC, o.id'
        );
        $st->execute([$orgId]);
        foreach ($st->fetchAll() as $r) {
            $k = self::key((string) $r['name']);
            $link = ['product_id' => (int) $r['erp_product_id'], 'qty' => self::factor($r['erp_qty'] ?? null)];
            $optionsByItem[(int) $r['item_id']][$k] ??= $link;
            $options[$k] ??= $link;
        }

        return ['items' => $items, 'optionsByItem' => $optionsByItem, 'options' => $options];
    }

    /**
     * Complemento → produto do ERP. Procura primeiro entre os complementos DO ITEM
     * pedido (mesmo nome pode significar coisas diferentes em pratos diferentes) e,
     * se o item não foi reconhecido ou não tem essa opção, cai no cardápio inteiro.
     *
     * @param  array{optionsByItem:array<int,array<string,array{product_id:int,qty:float}>>,options:array<string,array{product_id:int,qty:float}>} $menu
     * @return array{product_id:int,qty:float}|null
     */
    private static function resolveOption(array $menu, ?int $itemId, string $name): ?array
    {
        $k = self::key($name);
        if ($itemId !== null && isset($menu['optionsByItem'][$itemId][$k])) {
            return $menu['optionsByItem'][$itemId][$k];
        }
        return $menu['options'][$k] ?? null;
    }

    /**
     * Achata o JSON `options` do item do pedido numa lista {nome, quantidade}.
     * Cobre os dois formatos (iFood `options`/`garnishItems`, 99Food `sub_item_list`)
     * e complementos aninhados — a quantidade do filho multiplica a do pai.
     * Espelha o parseOptions do frontend (utils/format.ts).
     *
     * @return array<int,array{name:string,quantity:float}>
     */
    private static function flattenOptions(mixed $raw, int $depth = 0): array
    {
        if (is_string($raw)) {
            $raw = json_decode($raw, true);
        }
        if (!is_array($raw) || $depth > 5) {
            return [];
        }
        $out = [];
        foreach ($raw as $o) {
            if (!is_array($o)) {
                continue;
            }
            $name = self::firstStr($o, ['name', 'sub_item_name', 'itemName', 'complementName', 'description']);
            $qty = self::firstNum($o, ['quantity', 'amount', 'count']) ?? 1.0;
            $qty = $qty > 0 ? $qty : 1.0;
            if ($name !== null) {
                $out[] = ['name' => $name, 'quantity' => $qty];
            }
            foreach (['sub_item_list', 'options', 'garnishItems', 'customizations', 'subItems'] as $childKey) {
                foreach (self::flattenOptions($o[$childKey] ?? null, $depth + 1) as $child) {
                    $child['quantity'] *= $qty;
                    $out[] = $child;
                }
            }
        }
        return $out;
    }

    /**
     * Chave de casamento de nomes: minúsculas, sem acento, espaços colapsados.
     * O casamento antigo era feito no MySQL (`LOWER(TRIM(...))` sob collation
     * accent-insensitive); dobrar o acento aqui mantém a mesma tolerância agora
     * que a comparação é em PHP.
     *
     * Pública porque o relatório de engenharia de cardápio precisa casar item do pedido
     * com item do cardápio EXATAMENTE como a baixa de estoque casa. Duas normalizações
     * diferentes dariam dois cardápios diferentes: um que consome e outro que reporta.
     */
    public static function key(string $name): string
    {
        $s = mb_strtolower(trim($name), 'UTF-8');
        $s = strtr($s, [
            'á' => 'a', 'à' => 'a', 'ã' => 'a', 'â' => 'a', 'ä' => 'a',
            'é' => 'e', 'è' => 'e', 'ê' => 'e', 'ë' => 'e',
            'í' => 'i', 'ì' => 'i', 'î' => 'i', 'ï' => 'i',
            'ó' => 'o', 'ò' => 'o', 'õ' => 'o', 'ô' => 'o', 'ö' => 'o',
            'ú' => 'u', 'ù' => 'u', 'û' => 'u', 'ü' => 'u',
            'ç' => 'c', 'ñ' => 'n',
        ]);
        return (string) preg_replace('/\s+/u', ' ', $s);
    }

    /** @param array<string,mixed> $src */
    private static function firstStr(array $src, array $keys): ?string
    {
        foreach ($keys as $k) {
            if (isset($src[$k]) && is_scalar($src[$k]) && trim((string) $src[$k]) !== '') {
                return trim((string) $src[$k]);
            }
        }
        return null;
    }

    /** @param array<string,mixed> $src */
    private static function firstNum(array $src, array $keys): ?float
    {
        foreach ($keys as $k) {
            if (isset($src[$k]) && is_numeric($src[$k])) {
                return (float) $src[$k];
            }
        }
        return null;
    }

    /** Fator de consumo do vínculo; 0/ausente vira 1 (cadastro antigo ou em branco). */
    private static function factor(mixed $v): float
    {
        $f = is_numeric($v) ? (float) $v : 0.0;
        return $f > 0 ? $f : 1.0;
    }

    // ---- gatilhos ----

    /**
     * Acerta a baixa pelo ESTADO ATUAL do pedido. É o único ponto que os chamadores
     * precisam conhecer: em produção (confirmado em diante) consome; cancelado estorna;
     * o resto não faz nada. Idempotente e best-effort — nunca lança, para não derrubar
     * uma transição de status nem a ingestão por causa do estoque.
     */
    public static function sync(int $orgId, int $orderId, ?int $userId = null): void
    {
        try {
            $row = Db::queryOne('SELECT status, stock_consumed_at FROM delivery_orders WHERE id = ? AND org_id = ?', [$orderId, $orgId]);
            if (!$row) {
                return;
            }
            $status = (string) $row['status'];
            $consumed = $row['stock_consumed_at'] !== null;
            if ($status === 'cancelled') {
                if ($consumed) {
                    self::revertOnce($orgId, $orderId, $userId);
                }
                return;
            }
            if (!$consumed && in_array($status, self::CONSUMING, true)) {
                self::consumeOnce($orgId, $orderId, $userId);
            }
        } catch (\Throwable $e) {
            error_log("[delivery stock] sync #{$orderId} falhou: " . $e->getMessage());
        }
    }

    /**
     * Mesmo que sync(), a partir da identidade do pedido na plataforma (caminho da
     * ingestão). Também não lança: é chamado no meio do processamento de eventos, e
     * uma falha aqui não pode abortar a ingestão do pedido.
     */
    public static function syncPlatformOrder(string $platform, string $platformOrderId, ?int $userId = null): void
    {
        try {
            $row = Db::queryOne(
                'SELECT id, org_id FROM delivery_orders WHERE platform = ? AND platform_order_id = ?',
                [$platform, $platformOrderId]
            );
        } catch (\Throwable $e) {
            error_log("[delivery stock] sync {$platform}/{$platformOrderId} falhou: " . $e->getMessage());
            return;
        }
        if ($row) {
            self::sync((int) $row['org_id'], (int) $row['id'], $userId);
        }
    }

    /**
     * Varredura de segurança (roda a cada ciclo de polling): pega o que passou entre
     * os pingos — pedido cujo status avançou por um caminho que não chamou o sync,
     * ou que foi confirmado por um evento status-only, antes dos itens chegarem.
     * Janela de 1 dia para não reprocessar o histórico. Retorna quantos foram tratados.
     */
    public static function sweep(int $limit = 200): int
    {
        $consuming = "'" . implode("','", self::CONSUMING) . "'";
        $limit = max(1, min($limit, 1000)); // saneado: vai inline (placeholder em LIMIT é gotcha do MySQL)
        $rows = Db::query(
            "SELECT id, org_id FROM delivery_orders
              WHERE created_at >= (NOW() - INTERVAL 1 DAY)
                AND ((stock_consumed_at IS NULL AND status IN ({$consuming}))
                  OR (stock_consumed_at IS NOT NULL AND status = 'cancelled'))
              ORDER BY id LIMIT {$limit}"
        );
        foreach ($rows as $r) {
            self::sync((int) $r['org_id'], (int) $r['id'], null);
        }
        return count($rows);
    }

    /** Baixa idempotente: só consome se ainda não consumiu (trava a linha do pedido). */
    public static function consumeOnce(int $orgId, int $orderId, ?int $userId): void
    {
        Db::transaction(function (PDO $pdo) use ($orgId, $orderId, $userId): void {
            if (!self::claim($pdo, $orgId, $orderId, consumed: false)) {
                return; // pedido inexistente ou já baixado
            }
            // Sem itens ainda (evento status-only chegou antes do detalhe): NÃO carimba —
            // carimbar aqui daria o pedido por baixado e os insumos nunca sairiam. Deixa
            // para o próximo evento ou para o sweep.
            $demand = self::demand($pdo, $orgId, $orderId);
            if (!$demand['items'] && self::itemCount($pdo, $orderId) === 0) {
                return;
            }
            // A saída vai VALORIZADA (custo do insumo no momento em que ele saiu da despensa):
            // é o que transforma stock_moves em CMV real, em vez de só um contador de peso.
            // Em `out` o custo não mexe no custo médio — ver Stock::apply, que só recalcula
            // avg_cost em entradas —, então carimbar aqui é seguro.
            foreach ($demand['items'] as $productId => $qty) {
                $unitCost = Costing::unitCost($pdo, $orgId, (int) $productId);
                Stock::apply($pdo, $orgId, $productId, 'out', $qty, $unitCost, "delivery:{$orderId}", null, $userId);
            }
            if ($demand['unlinked']) {
                error_log("[delivery stock] pedido #{$orderId}: sem vínculo no cardápio (não baixou): " . implode(', ', $demand['unlinked']));
            }
            $pdo->prepare('UPDATE delivery_orders SET stock_consumed_at = NOW() WHERE id = ?')->execute([$orderId]);
        });
    }

    /** Estorno idempotente: só devolve se havia consumido. */
    public static function revertOnce(int $orgId, int $orderId, ?int $userId): void
    {
        Db::transaction(function (PDO $pdo) use ($orgId, $orderId, $userId): void {
            if (!self::claim($pdo, $orgId, $orderId, consumed: true)) {
                return; // pedido inexistente ou nada a estornar
            }
            // Sem unitCost de propósito: o estorno é uma entrada, e entrada COM custo entra
            // no cálculo do custo médio (Stock::apply). Devolver comida cancelada não é uma
            // compra — carimbar custo aqui contaminaria o avg_cost do insumo.
            foreach (self::demand($pdo, $orgId, $orderId)['items'] as $productId => $qty) {
                Stock::apply($pdo, $orgId, $productId, 'in', $qty, null, "delivery:{$orderId}:estorno", null, $userId);
            }
            $pdo->prepare('UPDATE delivery_orders SET stock_consumed_at = NULL WHERE id = ?')->execute([$orderId]);
        });
    }

    private static function itemCount(PDO $pdo, int $orderId): int
    {
        $st = $pdo->prepare('SELECT COUNT(*) FROM delivery_order_items WHERE order_id = ?');
        $st->execute([$orderId]);
        return (int) $st->fetchColumn();
    }

    /**
     * Trava a linha do pedido e confere o estado esperado do carimbo.
     * @param bool $consumed estado exigido: false = deve estar SEM baixa (p/ consumir);
     *                       true = deve estar COM baixa (p/ estornar).
     */
    private static function claim(PDO $pdo, int $orgId, int $orderId, bool $consumed): bool
    {
        $st = $pdo->prepare('SELECT stock_consumed_at FROM delivery_orders WHERE id = ? AND org_id = ? FOR UPDATE');
        $st->execute([$orderId, $orgId]);
        $row = $st->fetch();
        if (!$row) {
            return false;
        }
        $alreadyConsumed = $row['stock_consumed_at'] !== null;
        return $alreadyConsumed === $consumed;
    }
}
