<?php

namespace App\Services;

use App\Core\Db;

/**
 * Sugestão de compra a partir do saldo em mãos (ver migration 037).
 *
 * A conta é sempre a mesma — "quanto falta para chegar no alvo?" — o que muda é
 * de onde vem o alvo:
 *   - max_stock cadastrado no produto  → alvo = max_stock            (base "minmax")
 *   - sem max_stock, mas com histórico → alvo = consumo/dia × dias   (base "consumo")
 *   - sem nenhum dos dois              → sem sugestão                (base "sem_parametro")
 *
 * O consumo/dia vem SÓ dos movimentos `out` (venda/produção/perda). Ajustes de
 * inventário são correção de saldo, não consumo, e entrariam como ruído.
 */
final class Replenishment
{
    /**
     * Tipos que se COMPRAM de fornecedor — os que entram em contagem e em reposição.
     * Produto/Combo/Adicional são montados por ficha técnica (baixam pelos insumos) e
     * Ativo imobilizado não se repõe.
     *
     * Fonte ÚNICA da lista: antes estava copiada em CountsController, ParamsController
     * e em duas telas, então incluir um tipo novo exigia lembrar de quatro lugares.
     * O espelho do frontend fica em frontend/src/config/compras.ts.
     */
    public const COUNTABLE_TIPOS = ['Mercadoria', 'Matéria-prima', 'Uso e consumo', 'Item intermediário'];

    /** Dias de cobertura padrão de uma folha de contagem (compra semanal). */
    public const DEFAULT_COVERAGE_DAYS = 7;

    /** Janela de histórico usada para estimar o consumo diário. */
    public const HISTORY_DAYS = 30;

    /**
     * Fração do alvo tratada como ponto de pedido quando o produto não tem
     * min_stock cadastrado: abaixo de 30% do alvo o item é crítico.
     */
    private const CRITICAL_FRACTION = 0.30;

    /**
     * Consumo médio diário por produto, a partir das saídas da janela.
     *
     * A média divide pelo período em que o produto REALMENTE teve movimento
     * (do primeiro `out` da janela até hoje), não pela janela inteira: um item
     * cadastrado há 3 dias não pode ser diluído por 30.
     *
     * @param int[] $productIds
     * @return array<int,float> product_id => consumo médio diário
     */
    public static function dailyUsage(int $orgId, array $productIds, int $historyDays = self::HISTORY_DAYS): array
    {
        if (!$productIds) {
            return [];
        }
        $place = Db::inClause($productIds);
        $rows = Db::query(
            "SELECT product_id,
                    SUM(-qty_delta) AS total_out,
                    GREATEST(1, LEAST(?, DATEDIFF(NOW(), MIN(created_at)) + 1)) AS span_days
               FROM stock_moves
              WHERE org_id = ?
                AND type = 'out'
                AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
                AND product_id IN ({$place})
              GROUP BY product_id",
            array_merge([$historyDays, $orgId, $historyDays], $productIds)
        );
        $out = [];
        foreach ($rows as $r) {
            $total = (float) $r['total_out'];
            $span = max(1.0, (float) $r['span_days']);
            if ($total > 0) {
                $out[(int) $r['product_id']] = $total / $span;
            }
        }
        return $out;
    }

    /**
     * O que já foi comprado e ainda não chegou: soma das entradas de mercadoria AGUARDANDO.
     *
     * Sem isto, `suggest()` enxerga só o saldo físico e manda comprar de novo aquilo que já
     * está a caminho — o erro que o "Projected Qty" do ERPNext e o "Forecast" do Odoo
     * existem para evitar. Só conta o que ainda falta receber da linha (o parcial já entrou
     * no saldo).
     *
     * @param  int[] $productIds
     * @return array<int,float> product_id => quantidade a caminho
     */
    public static function incoming(int $orgId, array $productIds): array
    {
        if (!$productIds) {
            return [];
        }
        $place = Db::inClause($productIds);
        $rows = Db::query(
            "SELECT ri.product_id,
                    SUM(GREATEST(COALESCE(ri.qty_expected, 0) - COALESCE(ri.qty_received, 0), 0)) AS pendente
               FROM stock_receipt_items ri
               JOIN stock_receipts r ON r.id = ri.receipt_id
              WHERE r.org_id = ? AND r.status = 'aguardando'
                AND ri.product_id IN ({$place})
              GROUP BY ri.product_id",
            array_merge([$orgId], $productIds)
        );
        $out = [];
        foreach ($rows as $r) {
            $qty = (float) $r['pendente'];
            if ($qty > 0) {
                $out[(int) $r['product_id']] = $qty;
            }
        }
        return $out;
    }

    /**
     * Calcula a linha de sugestão de um produto.
     *
     * @param array $product      linha de products (min_stock, max_stock, pack_size)
     * @param float $onHand       saldo em mãos (o contado, quando houver)
     * @param float|null $daily   consumo médio diário; null/0 = sem histórico
     * @param float $incoming     já comprado e ainda não recebido — desconta da sugestão,
     *                            mas NÃO entra no saldo: a folha de contagem tem que
     *                            continuar mostrando o físico, senão o conferente acha
     *                            que o sistema errou a conta dele.
     * @return array{target:?float,reorder_point:?float,daily_usage:?float,days_left:?float,suggested:?float,status:string,basis:string,incoming:float}
     */
    public static function suggest(array $product, float $onHand, int $coverageDays, ?float $daily, float $incoming = 0.0): array
    {
        $max = self::num($product['max_stock'] ?? null);
        $min = self::num($product['min_stock'] ?? null);
        $pack = self::num($product['pack_size'] ?? null);
        $daily = ($daily !== null && $daily > 0) ? $daily : null;

        // Alvo: o cadastro manda; o histórico é o plano B.
        if ($max !== null && $max > 0) {
            $target = $max;
            $basis = 'minmax';
        } elseif ($daily !== null) {
            $target = $daily * $coverageDays;
            $basis = 'consumo';
        } else {
            $target = null;
            $basis = 'sem_parametro';
        }

        $incoming = max(0.0, $incoming);

        if ($target === null) {
            // Sem alvo não dá para sugerir número, mas ainda vale avisar que zerou.
            return [
                'target' => null, 'reorder_point' => $min, 'daily_usage' => $daily,
                'days_left' => null, 'suggested' => null,
                'status' => ($onHand + $incoming) <= 0 ? 'critico' : 'sem_parametro',
                'basis' => $basis, 'incoming' => round($incoming, 3),
            ];
        }

        $reorder = $min !== null ? $min : $target * self::CRITICAL_FRACTION;
        // A falta é contra o PREVISTO (o que tenho mais o que vem), não contra o físico.
        $falta = $target - ($onHand + $incoming);
        $suggested = $falta > 0 ? self::roundToPack($falta, $pack) : 0.0;

        // O status também olha o previsto: item zerado com carga a caminho não é crítico,
        // é só um item que ainda não chegou — e tratá-lo como crítico gera compra duplicada.
        $projected = $onHand + $incoming;
        if ($projected <= $reorder) {
            $status = 'critico';
        } elseif ($projected < $target) {
            $status = 'repor';
        } else {
            $status = 'ok';
        }

        return [
            'target' => round($target, 3),
            'reorder_point' => round($reorder, 3),
            'daily_usage' => $daily !== null ? round($daily, 3) : null,
            'days_left' => $daily !== null ? round($projected / $daily, 1) : null,
            'suggested' => round($suggested, 3),
            'status' => $status,
            'basis' => $basis,
            'incoming' => round($incoming, 3),
        ];
    }

    /** Arredonda a quantidade PARA CIMA no múltiplo de compra (não se compra meia caixa). */
    private static function roundToPack(float $qty, ?float $pack): float
    {
        if ($pack === null || $pack <= 0) {
            return $qty;
        }
        return ceil($qty / $pack) * $pack;
    }

    private static function num(mixed $v): ?float
    {
        return ($v === null || $v === '') ? null : (float) $v;
    }
}
