<?php

namespace App\Services;

use PDO;

/**
 * Fecha a produção de um pedido do dia do Marmitex: cada marmita consome 1 unidade do
 * produto vinculado ao seu tamanho, à sua proteína e a cada acompanhamento; a ficha técnica
 * de cada um é explodida (ver Recipe) e os insumos sofrem saída de estoque.
 *
 * Idempotência é do CHAMADOR: quem chama consume()/revert() precisa ter travado o pedido
 * (SELECT ... FOR UPDATE) e conferido o status — stock_moves é log imutável e aceitaria a
 * mesma baixa duas vezes. Estorno nunca deleta movimento: lança a entrada compensatória.
 */
final class Production
{
    /**
     * O que o pedido consome, já resolvido a insumo.
     *
     * @return array{items: array<int,float>, unlinked: string[]}
     *         items    = product_id => quantidade (insumos, receita explodida)
     *         unlinked = nomes dos itens de cardápio sem produto vinculado (não movimentam)
     */
    public static function demand(PDO $pdo, int $orgId, int $orderId): array
    {
        $sold = [];     // product_id do CARDÁPIO => unidades vendidas
        $unlinked = [];

        $st = $pdo->prepare('SELECT size_id, protein_id, sides_json FROM marmitex_marmitas WHERE order_id = ?');
        $st->execute([$orderId]);
        foreach ($st->fetchAll() as $m) {
            self::tally($pdo, 'marmitex_sizes', (int) $m['size_id'], $sold, $unlinked);
            if ($m['protein_id'] !== null) {
                self::tally($pdo, 'marmitex_proteins', (int) $m['protein_id'], $sold, $unlinked);
            }
            foreach (json_decode((string) $m['sides_json'], true) ?: [] as $side) {
                self::tally($pdo, 'marmitex_sides', (int) $side['id'], $sold, $unlinked);
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

    /** Saída dos insumos. @return array<int,array{...}> resumo por insumo, p/ a UI. */
    public static function consume(PDO $pdo, int $orgId, int $orderId, ?int $userId): array
    {
        $demand = self::demand($pdo, $orgId, $orderId);
        $moves = [];
        foreach ($demand['items'] as $productId => $qty) {
            $r = Stock::apply($pdo, $orgId, $productId, 'out', $qty, null, "marmitex:{$orderId}", null, $userId);
            $moves[] = self::describe($pdo, $productId, $qty, $r['balance_after']);
        }
        return ['moves' => $moves, 'unlinked' => $demand['unlinked']];
    }

    /**
     * Devolve ao estoque o que a produção baixou. Recalcula a demanda a partir das marmitas
     * atuais — por isso o pedido não pode ser editado enquanto estiver 'produced'.
     * Sem unitCost de propósito: entrada com custo mexeria no custo médio (ver Stock::apply).
     */
    public static function revert(PDO $pdo, int $orgId, int $orderId, ?int $userId): void
    {
        foreach (self::demand($pdo, $orgId, $orderId)['items'] as $productId => $qty) {
            Stock::apply($pdo, $orgId, $productId, 'in', $qty, null, "marmitex:{$orderId}:estorno", null, $userId);
        }
    }

    /** @param array<int,float> $sold @param string[] $unlinked */
    private static function tally(PDO $pdo, string $table, int $id, array &$sold, array &$unlinked): void
    {
        $st = $pdo->prepare("SELECT name, product_id FROM {$table} WHERE id = ?");
        $st->execute([$id]);
        $row = $st->fetch();
        if (!$row) {
            return;
        }
        if ($row['product_id'] === null) {
            $unlinked[] = $row['name'];
            return;
        }
        $pid = (int) $row['product_id'];
        $sold[$pid] = ($sold[$pid] ?? 0) + 1;
    }

    private static function describe(PDO $pdo, int $productId, float $qty, float $balanceAfter): array
    {
        $st = $pdo->prepare('SELECT name, unit FROM products WHERE id = ?');
        $st->execute([$productId]);
        $p = $st->fetch() ?: ['name' => "#{$productId}", 'unit' => null];
        return [
            'product_id' => $productId,
            'product_name' => $p['name'],
            'unit' => $p['unit'],
            'quantity' => $qty,
            'balance_after' => $balanceAfter,
        ];
    }
}
