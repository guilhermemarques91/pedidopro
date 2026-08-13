<?php

namespace App\Services;

use PDO;

/**
 * Custo de um produto a partir da ficha técnica. Só lê.
 *
 * Existe porque o custo vinha sendo somado na TELA de produtos, e lá ele estava errado de
 * duas formas: não dividia pelo rendimento (uma ficha que rende 10 porções gravava o custo
 * do lote inteiro contra um preço de venda unitário) e não era recursivo (lia o cost_price
 * congelado do componente em vez de recalcular a sub-receita). Aqui o custo é derivado da
 * MESMA explosão que baixa o estoque — ver Recipe::explode, que já atravessa sub-receitas,
 * já aplica yield_qty em cada nível e já detecta ciclo. Custo e baixa não podem divergir:
 * se divergirem, a margem mente sobre a comida que saiu da despensa.
 *
 * Custo do insumo = avg_cost (custo médio ponderado das entradas) e, na falta dele,
 * cost_price (o preço de compra cadastrado). Insumo sem nenhum dos dois não vira zero: vira
 * uma entrada em `missing`, para a tela poder dizer "esta margem está incompleta" em vez de
 * mostrar um lucro que não existe.
 */
final class Costing
{
    /** Cache por processo: um pedido/tela toca o mesmo insumo dezenas de vezes. */
    private static array $unitCache = [];

    /** @var array<string,array{cost:?float,missing:string[]}> */
    private static array $productCache = [];

    /**
     * Custo unitário de um insumo folha (não explode ficha).
     *
     * @return float|null null = insumo sem custo cadastrado.
     */
    public static function unitCost(PDO $pdo, int $orgId, int $productId): ?float
    {
        $key = $orgId . ':' . $productId;
        if (array_key_exists($key, self::$unitCache)) {
            return self::$unitCache[$key];
        }
        $st = $pdo->prepare('SELECT avg_cost, cost_price FROM products WHERE id = ? AND org_id = ?');
        $st->execute([$productId, $orgId]);
        $row = $st->fetch();

        $cost = null;
        if ($row) {
            foreach (['avg_cost', 'cost_price'] as $col) {
                if ($row[$col] !== null && (float) $row[$col] > 0) {
                    $cost = (float) $row[$col];
                    break;
                }
            }
        }
        return self::$unitCache[$key] = $cost;
    }

    /**
     * Custo de UMA unidade do produto, com a ficha explodida até a matéria-prima.
     *
     * Um produto sem ficha é folha e custa o próprio custo unitário (refrigerante comprado
     * pronto). Um produto com ficha custa a soma dos insumos que Recipe::explode devolve —
     * portanto já por porção, não por lote.
     *
     * @return array{cost: ?float, missing: string[]} missing = nomes dos insumos sem custo.
     *         cost é null só quando NADA do que compõe o produto tem custo; com custo
     *         parcial devolve o que dá para somar e a lista do que falta.
     */
    public static function productCost(PDO $pdo, int $orgId, int $productId): array
    {
        $key = $orgId . ':' . $productId;
        if (isset(self::$productCache[$key])) {
            return self::$productCache[$key];
        }

        $total = 0.0;
        $found = false;
        $missing = [];
        foreach (Recipe::explode($pdo, $orgId, $productId, 1.0) as $componentId => $qty) {
            $unit = self::unitCost($pdo, $orgId, (int) $componentId);
            if ($unit === null) {
                $missing[] = self::nameOf($pdo, (int) $componentId);
                continue;
            }
            $total += $unit * $qty;
            $found = true;
        }

        return self::$productCache[$key] = [
            'cost' => $found ? round($total, 4) : null,
            'missing' => $missing,
        ];
    }

    /**
     * Custo de um item do cardápio (ou de um complemento): o vínculo com o ERP carrega o
     * fator erp_qty — "Frango grelhado" no cardápio são 0,15 kg do produto "Filé de frango".
     *
     * @param  int|null $erpProductId  menu_items.erp_product_id / menu_options.erp_product_id
     * @param  float    $erpQty        menu_items.erp_qty / menu_options.erp_qty
     * @return array{cost: ?float, cost_source: string, missing: string[]}
     *         cost_source: ok | sem_vinculo (não mapeado ao ERP) | sem_ficha (mapeado, mas
     *         nem ele nem a ficha dele têm custo). Os dois últimos também não baixam estoque.
     */
    public static function menuCost(PDO $pdo, int $orgId, ?int $erpProductId, float $erpQty = 1.0): array
    {
        if ($erpProductId === null || $erpProductId <= 0) {
            return ['cost' => null, 'cost_source' => 'sem_vinculo', 'missing' => []];
        }
        $r = self::productCost($pdo, $orgId, $erpProductId);
        if ($r['cost'] === null) {
            return ['cost' => null, 'cost_source' => 'sem_ficha', 'missing' => $r['missing']];
        }
        $factor = $erpQty > 0 ? $erpQty : 1.0;
        return [
            'cost' => round($r['cost'] * $factor, 4),
            'cost_source' => 'ok',
            'missing' => $r['missing'],
        ];
    }

    /**
     * Margem sobre um preço de venda, líquida da comissão do canal — o número que decide se
     * vale a pena vender o prato ali. Um item a R$ 30 com 23% de comissão entrega R$ 23,10;
     * é contra ISSO que o custo tem que ser comparado, não contra o preço de vitrine.
     *
     * @param  float $commissionRate Percentual (23.00 = 23%), como vem de channels.commission_rate.
     * @return array{net_price: float, margin: ?float, margin_pct: ?float}
     */
    public static function margin(float $price, ?float $cost, float $commissionRate = 0.0): array
    {
        $net = round($price * (1 - max(0.0, $commissionRate) / 100), 4);
        if ($cost === null) {
            return ['net_price' => $net, 'margin' => null, 'margin_pct' => null];
        }
        $margin = round($net - $cost, 4);
        return [
            'net_price' => $net,
            'margin' => $margin,
            'margin_pct' => $net > 0 ? round($margin / $net * 100, 2) : null,
        ];
    }

    /** Zera os caches. Só faz sentido em worker de vida longa, entre pedidos. */
    public static function flush(): void
    {
        self::$unitCache = [];
        self::$productCache = [];
    }

    private static function nameOf(PDO $pdo, int $productId): string
    {
        $st = $pdo->prepare('SELECT name FROM products WHERE id = ?');
        $st->execute([$productId]);
        return (string) ($st->fetch()['name'] ?? "#{$productId}");
    }
}
