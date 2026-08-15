<?php

namespace App\Modules\Purchases;

use App\Core\Db;
use App\Core\Http;
use App\Core\Request;

/**
 * Curva ABC de compras: ranking de gasto por produto ou por fornecedor, com % acumulado.
 *
 * Fonte HÍBRIDA, decidida depois de checar o banco real: só 1 `stock_receipts`
 * confirmada existe hoje contra 5 pedidos já `received`/`partially_received` — a
 * maioria passou pela rota antiga que dava entrada pelo preço do pedido, sem nunca
 * criar uma entrada de mercadoria. Uma curva ABC que só olhasse `stock_receipts`
 * nasceria praticamente vazia. Por isso: prefere o preço da NOTA (`stock_receipts`,
 * quando existe entrada confirmada pro pedido) e cai para `order_items` (o que foi
 * pedido) nos pedidos recebidos que não têm entrada confirmada. Conforme a Entrada de
 * Mercadoria for mais usada, a fonte migra sozinha pro lado mais correto.
 */
final class PurchasesReportController
{
    private const CLASS_A_PCT = 0.80;
    private const CLASS_B_PCT = 0.95;

    /** GET /purchases/abc?from=&to=&dimension=product|supplier */
    public static function abc(Request $req): void
    {
        $orgId = $req->orgId();
        $to = $req->query('to') ?: date('Y-m-d');
        $from = $req->query('from') ?: date('Y-m-d', strtotime($to . ' -90 days'));
        $dimension = $req->query('dimension') === 'supplier' ? 'supplier' : 'product';

        $rows = $dimension === 'supplier'
            ? self::bySupplier($orgId, $from, $to)
            : self::byProduct($orgId, $from, $to);

        usort($rows, static fn ($a, $b) => $b['spend'] <=> $a['spend']);
        $total = array_sum(array_column($rows, 'spend'));

        $cum = 0.0;
        foreach ($rows as &$r) {
            $cum += $r['spend'];
            $r['pct'] = $total > 0 ? round($r['spend'] / $total, 4) : 0.0;
            $cumPct = $total > 0 ? $cum / $total : 0.0;
            $r['cum_pct'] = round($cumPct, 4);
            $r['class'] = $cumPct <= self::CLASS_A_PCT ? 'A' : ($cumPct <= self::CLASS_B_PCT ? 'B' : 'C');
            $r['spend'] = round($r['spend'], 2);
        }
        unset($r);

        Http::json([
            'from' => $from,
            'to' => $to,
            'dimension' => $dimension,
            'total_spend' => round($total, 2),
            'rows' => $rows,
        ]);
    }

    /**
     * Mescla as duas fontes por chave (product_id ou supplier_id), somando gasto e
     * quantidade quando a mesma chave aparece nas duas — evita contar duas vezes quando um
     * pedido tem parte recebida por entrada confirmada e parte sem.
     * @return array<int,array{id:int|null,name:string,spend:float,qty:float,source:string}>
     */
    private static function merge(array $fromReceipts, array $fromOrders): array
    {
        $out = [];
        foreach ([$fromReceipts, $fromOrders] as $source) {
            foreach ($source as $row) {
                $key = $row['id'] ?? 'null';
                if (!isset($out[$key])) {
                    $out[$key] = $row;
                    continue;
                }
                $out[$key]['spend'] += $row['spend'];
                $out[$key]['qty'] += $row['qty'];
                if ($out[$key]['source'] !== $row['source']) {
                    $out[$key]['source'] = 'mixed';
                }
            }
        }
        return array_values($out);
    }

    private static function byProduct(int $orgId, string $from, string $to): array
    {
        $receipts = Db::query(
            "SELECT ri.product_id AS id, p.name,
                    SUM(ri.qty_received * ri.price_received) AS spend,
                    SUM(ri.qty_received) AS qty,
                    'receipt' AS source
               FROM stock_receipt_items ri
               JOIN stock_receipts r ON r.id = ri.receipt_id
               JOIN products p ON p.id = ri.product_id
              WHERE r.org_id = ? AND r.status = 'conferida'
                AND ri.product_id IS NOT NULL AND ri.qty_received > 0 AND ri.price_received IS NOT NULL
                AND r.confirmed_at BETWEEN ? AND ?
              GROUP BY ri.product_id, p.name",
            [$orgId, $from . ' 00:00:00', $to . ' 23:59:59']
        );

        $orders = Db::query(
            "SELECT i.product_id AS id, p.name,
                    SUM(oi.quantity * oi.unit_price) AS spend,
                    SUM(oi.quantity) AS qty,
                    'order' AS source
               FROM order_items oi
               JOIN orders o ON o.id = oi.order_id
               JOIN items i ON i.id = oi.item_id
               JOIN products p ON p.id = i.product_id
              WHERE o.org_id = ? AND o.status IN ('received', 'partially_received')
                AND oi.unit_price > 0 AND oi.quantity > 0 AND i.product_id IS NOT NULL
                AND o.received_at BETWEEN ? AND ?
                AND NOT EXISTS (
                  SELECT 1 FROM stock_receipts r2 WHERE r2.order_id = o.id AND r2.status = 'conferida'
                )
              GROUP BY i.product_id, p.name",
            [$orgId, $from . ' 00:00:00', $to . ' 23:59:59']
        );

        return self::cast(self::merge($receipts, $orders));
    }

    private static function bySupplier(int $orgId, string $from, string $to): array
    {
        $receipts = Db::query(
            "SELECT r.supplier_id AS id, COALESCE(s.name, 'Sem fornecedor') AS name,
                    SUM(ri.qty_received * ri.price_received) AS spend,
                    SUM(ri.qty_received) AS qty,
                    'receipt' AS source
               FROM stock_receipt_items ri
               JOIN stock_receipts r ON r.id = ri.receipt_id
               LEFT JOIN suppliers s ON s.id = r.supplier_id
              WHERE r.org_id = ? AND r.status = 'conferida'
                AND ri.qty_received > 0 AND ri.price_received IS NOT NULL
                AND r.confirmed_at BETWEEN ? AND ?
              GROUP BY r.supplier_id, s.name",
            [$orgId, $from . ' 00:00:00', $to . ' 23:59:59']
        );

        $orders = Db::query(
            "SELECT o.supplier_id AS id, s.name,
                    SUM(oi.quantity * oi.unit_price) AS spend,
                    SUM(oi.quantity) AS qty,
                    'order' AS source
               FROM order_items oi
               JOIN orders o ON o.id = oi.order_id
               JOIN suppliers s ON s.id = o.supplier_id
              WHERE o.org_id = ? AND o.status IN ('received', 'partially_received')
                AND oi.unit_price > 0 AND oi.quantity > 0
                AND o.received_at BETWEEN ? AND ?
                AND NOT EXISTS (
                  SELECT 1 FROM stock_receipts r2 WHERE r2.order_id = o.id AND r2.status = 'conferida'
                )
              GROUP BY o.supplier_id, s.name",
            [$orgId, $from . ' 00:00:00', $to . ' 23:59:59']
        );

        return self::cast(self::merge($receipts, $orders));
    }

    private static function cast(array $rows): array
    {
        return array_map(static fn ($r) => [
            'id' => $r['id'] !== null ? (int) $r['id'] : null,
            'name' => $r['name'],
            'spend' => (float) $r['spend'],
            'qty' => (float) $r['qty'],
            'source' => $r['source'],
        ], $rows);
    }
}
