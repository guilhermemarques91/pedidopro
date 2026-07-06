<?php

namespace App\Services;

use App\Core\Db;
use PDO;

/**
 * Movimentações de estoque (saldo vive no product — ver nota no README).
 * apply() insere o movimento e atualiza stock_qty/avg_cost NA MESMA transação.
 * Custo médio ponderado nas entradas; saldo negativo é permitido (realidade de
 * cozinha), a UI sinaliza.
 */
final class Stock
{
    /**
     * @param string $type in|out|adjust  (adjust: $qty = novo saldo ABSOLUTO)
     * @return array{qty_delta: float, balance_after: float}
     */
    public static function apply(
        PDO $pdo,
        int $orgId,
        int $productId,
        string $type,
        float $qty,
        ?float $unitCost,
        ?string $ref,
        ?string $notes,
        ?int $userId
    ): array {
        // Trava a linha do produto p/ serializar movimentos concorrentes.
        $st = $pdo->prepare('SELECT stock_qty, avg_cost FROM products WHERE id = ? FOR UPDATE');
        $st->execute([$productId]);
        $p = $st->fetch();
        $current = (float) ($p['stock_qty'] ?? 0);
        $avg = $p['avg_cost'] !== null ? (float) $p['avg_cost'] : null;

        $delta = match ($type) {
            'in' => $qty,
            'out' => -$qty,
            'adjust' => $qty - $current,
        };
        $after = $current + $delta;

        // Custo médio ponderado só em entradas com custo informado.
        if ($type === 'in' && $unitCost !== null) {
            $avg = ($current > 0 && $avg !== null)
                ? (($current * $avg) + ($qty * $unitCost)) / ($current + $qty)
                : $unitCost;
        }

        $pdo->prepare(
            'INSERT INTO stock_moves (org_id, product_id, type, qty_delta, unit_cost, balance_after, ref, notes, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )->execute([$orgId, $productId, $type, $delta, $unitCost, $after, $ref, $notes, $userId]);

        $pdo->prepare('UPDATE products SET stock_qty = ?, avg_cost = ? WHERE id = ?')
            ->execute([$after, $avg, $productId]);

        return ['qty_delta' => $delta, 'balance_after' => $after];
    }
}
