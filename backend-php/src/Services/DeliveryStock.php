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
 * Item sem vínculo simplesmente não movimenta (degradação segura) — a baixa é opt-in:
 * só acontece para os itens que o operador mapeou a um produto.
 *
 * Idempotência é do carimbo `delivery_orders.stock_consumed_at`, conferido sob
 * `SELECT ... FOR UPDATE` — espelha o Production do Marmitex, mas o gatilho aqui é o
 * ciclo do pedido (baixa ao confirmar; estorno ao cancelar). Estorno nunca deleta
 * movimento: lança a entrada compensatória (ver Stock::apply).
 */
final class DeliveryStock
{
    /**
     * O que o pedido consome, já resolvido a insumo.
     *
     * @return array{items: array<int,float>, unlinked: string[]}
     *         items    = product_id => quantidade (insumos, receita explodida)
     *         unlinked = nomes de itens do pedido sem produto vinculado (não movimentam)
     */
    public static function demand(PDO $pdo, int $orgId, int $orderId): array
    {
        $sold = [];     // product_id do CARDÁPIO => unidades vendidas
        $unlinked = [];

        $st = $pdo->prepare('SELECT name, quantity FROM delivery_order_items WHERE order_id = ?');
        $st->execute([$orderId]);
        foreach ($st->fetchAll() as $it) {
            $qty = (float) $it['quantity'];
            if ($qty <= 0) {
                continue;
            }
            $productId = self::mapToProduct($pdo, $orgId, (string) $it['name']);
            if ($productId === null) {
                $unlinked[] = (string) $it['name'];
                continue;
            }
            $sold[$productId] = ($sold[$productId] ?? 0) + $qty;
        }

        $items = [];
        foreach ($sold as $productId => $qty) {
            foreach (Recipe::explode($pdo, $orgId, $productId, $qty) as $componentId => $need) {
                $items[$componentId] = ($items[$componentId] ?? 0) + $need;
            }
        }
        return ['items' => $items, 'unlinked' => array_values(array_unique($unlinked))];
    }

    /** Nome do item do pedido → produto do ERP via cardápio (casamento por nome, sem acento-fold). */
    private static function mapToProduct(PDO $pdo, int $orgId, string $name): ?int
    {
        $st = $pdo->prepare(
            'SELECT erp_product_id FROM menu_items
              WHERE org_id = ? AND erp_product_id IS NOT NULL
                AND LOWER(TRIM(name)) = LOWER(TRIM(?))
              LIMIT 1'
        );
        $st->execute([$orgId, $name]);
        $v = $st->fetchColumn();
        return ($v !== false && $v !== null) ? (int) $v : null;
    }

    /** Baixa idempotente: só consome se ainda não consumiu (trava a linha do pedido). */
    public static function consumeOnce(int $orgId, int $orderId, ?int $userId): void
    {
        Db::transaction(function (PDO $pdo) use ($orgId, $orderId, $userId): void {
            if (!self::claim($pdo, $orgId, $orderId, consumed: false)) {
                return; // pedido inexistente ou já baixado
            }
            foreach (self::demand($pdo, $orgId, $orderId)['items'] as $productId => $qty) {
                Stock::apply($pdo, $orgId, $productId, 'out', $qty, null, "delivery:{$orderId}", null, $userId);
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
            foreach (self::demand($pdo, $orgId, $orderId)['items'] as $productId => $qty) {
                Stock::apply($pdo, $orgId, $productId, 'in', $qty, null, "delivery:{$orderId}:estorno", null, $userId);
            }
            $pdo->prepare('UPDATE delivery_orders SET stock_consumed_at = NULL WHERE id = ?')->execute([$orderId]);
        });
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
