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
 * Idempotência é do CHAMADOR (mesmo contrato de Production): travar a linha
 * (SELECT ... FOR UPDATE) e conferir o status antes de chamar.
 */
final class Sale
{
    /** Soma quantidade por produto entre os itens informados. @return array<int,float> */
    private static function tallyItems(array $items): array
    {
        $sold = [];
        foreach ($items as $it) {
            $pid = (int) $it['product_id'];
            $sold[$pid] = ($sold[$pid] ?? 0) + (float) $it['quantity'];
        }
        return $sold;
    }

    /** @return array<int,float> component_id => quantidade total a consumir */
    private static function demandFor(PDO $pdo, int $orgId, array $items): array
    {
        $out = [];
        foreach (self::tallyItems($items) as $productId => $qty) {
            foreach (Recipe::explode($pdo, $orgId, $productId, $qty) as $componentId => $need) {
                $out[$componentId] = ($out[$componentId] ?? 0) + $need;
            }
        }
        return $out;
    }

    /** Baixa os insumos de um round recém-enviado. */
    public static function consumeRound(PDO $pdo, int $orgId, int $saleId, int $roundNo, ?int $userId): void
    {
        $st = $pdo->prepare('SELECT product_id, quantity FROM sale_items WHERE sale_id = ? AND round_no = ?');
        $st->execute([$saleId, $roundNo]);
        foreach (self::demandFor($pdo, $orgId, $st->fetchAll()) as $productId => $qty) {
            Stock::apply($pdo, $orgId, $productId, 'out', $qty, null, "vendas:{$saleId}:r{$roundNo}", null, $userId);
        }
    }

    /** Devolve ao estoque tudo que a venda (todos os rounds) baixou. */
    public static function revert(PDO $pdo, int $orgId, int $saleId, ?int $userId): void
    {
        $st = $pdo->prepare('SELECT product_id, quantity FROM sale_items WHERE sale_id = ?');
        $st->execute([$saleId]);
        foreach (self::demandFor($pdo, $orgId, $st->fetchAll()) as $productId => $qty) {
            Stock::apply($pdo, $orgId, $productId, 'in', $qty, null, "vendas:{$saleId}:estorno", null, $userId);
        }
    }

    /**
     * Ajusta o estoque por uma variação (+ ou -) de UM item já enviado (edição pós-envio):
     * $delta positivo = aumentou a quantidade (baixa mais); negativo = diminuiu/removeu (devolve).
     */
    public static function adjustItem(PDO $pdo, int $orgId, int $productId, float $delta, int $saleId, int $itemId, ?int $userId): void
    {
        $type = $delta > 0 ? 'out' : 'in';
        foreach (Recipe::explode($pdo, $orgId, $productId, abs($delta)) as $componentId => $qty) {
            Stock::apply($pdo, $orgId, $componentId, $type, $qty, null, "vendas:{$saleId}:item{$itemId}:ajuste", null, $userId);
        }
    }
}
