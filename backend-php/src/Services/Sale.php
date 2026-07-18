<?php

namespace App\Services;

use PDO;

/**
 * Baixa/estorno de estoque das vendas (balcão, retirada, mesa, comanda) pela ficha
 * técnica — mesmo padrão de Production, mas por "round" de envio: mesa/comanda pode
 * enviar itens ao carrinho várias vezes ao longo do atendimento, e cada envio já baixa
 * na hora (a comida sai para o preparo). O estorno total (cancelamento) sempre
 * recalcula a partir de TODOS os rounds da venda.
 *
 * A demanda é POR ITEM (não mais agregada por produto): cada sale_item pode carregar
 * modificadores de preparo — insumos removidos da ficha (removed_json) e a variação
 * escolhida (variation_json, ex.: a proteína do Executivo) — que mudam o que baixa.
 *
 * Idempotência é do CHAMADOR (mesmo contrato de Production): travar a linha
 * (SELECT ... FOR UPDATE) e conferir o status antes de chamar.
 */
final class Sale
{
    private const ITEM_COLS = 'product_id, quantity, removed_json, variation_json';

    /** Baixa os insumos de um round recém-enviado. */
    public static function consumeRound(PDO $pdo, int $orgId, int $saleId, int $roundNo, ?int $userId): void
    {
        $st = $pdo->prepare('SELECT ' . self::ITEM_COLS . ' FROM sale_items WHERE sale_id = ? AND round_no = ?');
        $st->execute([$saleId, $roundNo]);
        foreach (self::demandForRows($pdo, $orgId, $st->fetchAll()) as $productId => $qty) {
            Stock::apply($pdo, $orgId, $productId, 'out', $qty, null, "vendas:{$saleId}:r{$roundNo}", null, $userId);
        }
    }

    /** Devolve ao estoque tudo que a venda (todos os rounds) baixou. */
    public static function revert(PDO $pdo, int $orgId, int $saleId, ?int $userId): void
    {
        $st = $pdo->prepare('SELECT ' . self::ITEM_COLS . ' FROM sale_items WHERE sale_id = ?');
        $st->execute([$saleId]);
        foreach (self::demandForRows($pdo, $orgId, $st->fetchAll()) as $productId => $qty) {
            Stock::apply($pdo, $orgId, $productId, 'in', $qty, null, "vendas:{$saleId}:estorno", null, $userId);
        }
    }

    /**
     * Ajusta o estoque por uma variação (+ ou -) de UM item já enviado (edição pós-envio):
     * $delta positivo = aumentou a quantidade (baixa mais); negativo = diminuiu/removeu
     * (devolve). $item é a linha de sale_items (preserva os modificadores do item).
     */
    public static function adjustItem(PDO $pdo, int $orgId, array $item, float $delta, int $saleId, int $itemId, ?int $userId): void
    {
        $type = $delta > 0 ? 'out' : 'in';
        $row = ['product_id' => $item['product_id'], 'quantity' => abs($delta),
                'removed_json' => $item['removed_json'] ?? null, 'variation_json' => $item['variation_json'] ?? null];
        foreach (self::demandForRows($pdo, $orgId, [$row]) as $componentId => $qty) {
            Stock::apply($pdo, $orgId, $componentId, $type, $qty, null, "vendas:{$saleId}:item{$itemId}:ajuste", null, $userId);
        }
    }

    // ---- demanda ----

    /** @return array<int,float> component_id => quantidade total a consumir */
    private static function demandForRows(PDO $pdo, int $orgId, array $rows): array
    {
        $out = [];
        foreach ($rows as $r) {
            foreach (self::demandForRow($pdo, $orgId, $r) as $componentId => $qty) {
                $out[$componentId] = ($out[$componentId] ?? 0) + $qty;
            }
        }
        // Arredondamento das remoções pode deixar resíduo <= 0: nunca movimentar nada disso.
        return array_filter($out, static fn ($q) => $q > 0.00001);
    }

    /** Explosão da ficha de um item, aplicando remoções e a variação escolhida. */
    private static function demandForRow(PDO $pdo, int $orgId, array $r): array
    {
        $productId = (int) $r['product_id'];
        $qty = (float) $r['quantity'];
        $out = Recipe::explode($pdo, $orgId, $productId, $qty);

        // "Sem X": subtrai exatamente a contribuição da linha removida da ficha.
        foreach (self::decode($r['removed_json'] ?? null) as $rm) {
            $componentId = (int) ($rm['component_id'] ?? 0);
            if ($componentId <= 0) {
                continue;
            }
            $st = $pdo->prepare(
                'SELECT SUM(quantity) AS qty FROM product_recipe
                  WHERE product_id = ? AND org_id = ? AND component_id = ? AND quantity > 0'
            );
            $st->execute([$productId, $orgId, $componentId]);
            $lineQty = (float) ($st->fetch()['qty'] ?? 0);
            if ($lineQty <= 0) {
                continue; // a ficha mudou desde o lançamento — nada a subtrair
            }
            $factor = $qty / self::yieldQty($pdo, $productId);
            foreach (Recipe::explode($pdo, $orgId, $componentId, $lineQty * $factor) as $cid => $need) {
                $out[$cid] = ($out[$cid] ?? 0) - $need;
            }
        }

        // Variação (ex.: proteína escolhida): consome o componente da opção por unidade vendida.
        foreach (self::decode($r['variation_json'] ?? null) as $v) {
            $componentId = (int) ($v['component_id'] ?? 0);
            $vQty = (float) ($v['quantity'] ?? 0);
            if ($componentId <= 0 || $vQty <= 0) {
                continue;
            }
            foreach (Recipe::explode($pdo, $orgId, $componentId, $vQty * $qty) as $cid => $need) {
                $out[$cid] = ($out[$cid] ?? 0) + $need;
            }
        }

        return $out;
    }

    /** @return array lista decodificada de um JSON de modificadores (ou vazia). */
    private static function decode(?string $json): array
    {
        if ($json === null || $json === '') {
            return [];
        }
        $data = json_decode($json, true);
        return is_array($data) ? $data : [];
    }

    private static function yieldQty(PDO $pdo, int $productId): float
    {
        $st = $pdo->prepare('SELECT yield_qty FROM products WHERE id = ?');
        $st->execute([$productId]);
        $y = (float) ($st->fetch()['yield_qty'] ?? 0);
        return $y > 0 ? $y : 1.0;
    }
}
