<?php

namespace App\Modules\Stock;

use App\Core\Db;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Request;
use App\Services\Stock;
use PDO;

/** Movimentações de estoque por produto (entrada/saída/ajuste). */
final class StockController
{
    /** GET /stock/moves?product_id=N (últimas primeiro; limit/offset opcionais). */
    public static function moves(Request $req): void
    {
        $where = ['m.org_id = ?'];
        $params = [$req->orgId()];
        $pid = $req->query('product_id');
        if ($pid !== null && ctype_digit($pid)) {
            $where[] = 'm.product_id = ?';
            $params[] = (int) $pid;
        }
        $limit = max(1, min((int) ($req->query('limit') ?? 50), 200));
        $offset = max(0, (int) ($req->query('offset') ?? 0));
        Http::json(Db::query(
            'SELECT m.*, p.name AS product_name, p.unit, u.name AS user_name
               FROM stock_moves m
               JOIN products p ON p.id = m.product_id
               LEFT JOIN users u ON u.id = m.created_by
              WHERE ' . implode(' AND ', $where) . "
              ORDER BY m.id DESC LIMIT {$limit} OFFSET {$offset}",
            $params
        ));
    }

    /** POST /stock/moves { product_id, type: in|out|adjust, quantity, unit_cost?, notes? } */
    public static function create(Request $req): void
    {
        $in = $req->input();
        $productId = $in->integer('product_id', true);
        $type = $in->enum('type', ['in', 'out', 'adjust'], true);
        $qty = (float) ($in->number('quantity', true) ?? 0);
        if ($qty < 0 || ($type !== 'adjust' && $qty <= 0)) {
            throw HttpError::badRequest('Quantidade inválida');
        }
        $unitCost = $in->number('unit_cost');
        $notes = $in->string('notes');

        $product = Db::queryOne('SELECT id FROM products WHERE id = ? AND org_id = ? AND active = 1', [$productId, $req->orgId()]);
        if (!$product) {
            throw HttpError::notFound('Produto não encontrado');
        }

        $result = Db::transaction(
            fn (PDO $pdo) => Stock::apply(
                $pdo, $req->orgId(), $productId, $type, $qty,
                $unitCost !== null ? (float) $unitCost : null,
                'manual', $notes, $req->userId()
            )
        );
        $row = Db::queryOne('SELECT stock_qty, avg_cost FROM products WHERE id = ?', [$productId]);
        Http::json(['ok' => true, 'move' => $result, 'stock_qty' => $row['stock_qty'], 'avg_cost' => $row['avg_cost']], 201);
    }
}
