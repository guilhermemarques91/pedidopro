<?php

namespace App\Modules\Requests;

use App\Core\Db;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Request;
use PDO;

final class RequestsController
{
    public static function list(Request $req): void
    {
        $own = !$req->isAdmin();
        $where = $own ? 'WHERE pr.created_by = ?' : '';
        $params = $own ? [$req->userId()] : [];
        Http::json(Db::query(
            "SELECT pr.*, u.name AS created_by_name, COUNT(pri.id) AS item_count
               FROM purchase_requests pr
               JOIN users u ON u.id = pr.created_by
               LEFT JOIN purchase_request_items pri ON pri.request_id = pr.id
               {$where}
              GROUP BY pr.id, u.name
              ORDER BY pr.created_at DESC",
            $params
        ));
    }

    public static function getById(Request $req): void
    {
        $id = $req->intParam('id');
        $header = Db::queryOne(
            'SELECT pr.*, u.name AS created_by_name
               FROM purchase_requests pr JOIN users u ON u.id = pr.created_by
              WHERE pr.id = ?',
            [$id]
        );
        if (!$header) {
            throw HttpError::notFound('Lista de compras não encontrada');
        }
        if (!$req->isAdmin() && (int) $header['created_by'] !== $req->userId()) {
            throw HttpError::forbidden('Você não tem acesso a esta lista');
        }

        $items = Db::query(
            "SELECT pri.*, p.name AS product_name, c.id AS category_id, c.name AS category_name
               FROM purchase_request_items pri
               LEFT JOIN products p ON p.id = pri.product_id
               LEFT JOIN categories c ON c.id = p.category_id
              WHERE pri.request_id = ?
              ORDER BY COALESCE(c.name, 'zzz'), COALESCE(p.name, pri.free_text)",
            [$id]
        );

        // Ofertas-guia por produto canônico.
        $productIds = [];
        foreach ($items as $it) {
            if ($it['product_id'] !== null) {
                $productIds[(int) $it['product_id']] = true;
            }
        }
        $offersByProduct = [];
        if ($productIds) {
            $ids = array_keys($productIds);
            $place = Db::inClause($ids);
            $offers = Db::query(
                "SELECT i.product_id, i.id AS item_id, i.supplier_id, s.name AS supplier_name,
                        i.name, i.unit, i.base_price
                   FROM items i JOIN suppliers s ON s.id = i.supplier_id
                  WHERE i.active = 1 AND i.product_id IN ({$place})
                  ORDER BY (i.base_price IS NULL), i.base_price ASC, s.name",
                $ids
            );
            foreach ($offers as $o) {
                $offersByProduct[(int) $o['product_id']][] = $o;
            }
        }
        foreach ($items as &$it) {
            $pid = $it['product_id'] !== null ? (int) $it['product_id'] : null;
            $it['offers'] = ($pid !== null && isset($offersByProduct[$pid])) ? $offersByProduct[$pid] : [];
        }
        unset($it);

        $header['items'] = $items;
        Http::json($header);
    }

    public static function create(Request $req): void
    {
        $in = $req->input();
        $title = $in->string('title') ?: ('Lista ' . date('d/m/Y'));
        $notes = $in->string('notes');
        $items = self::parseItems($in->array('items', true));

        $id = Db::transaction(function (PDO $pdo) use ($title, $notes, $items, $req) {
            $stmt = $pdo->prepare('INSERT INTO purchase_requests (title, notes, created_by) VALUES (?, ?, ?)');
            $stmt->execute([$title, $notes, $req->userId()]);
            $rid = (int) $pdo->lastInsertId();
            self::insertItems($pdo, $rid, $items);
            return $rid;
        });
        Http::json(self::row($id), 201);
    }

    public static function update(Request $req): void
    {
        $id = $req->intParam('id');
        $r = self::row($id);
        if ((int) $r['created_by'] !== $req->userId() && !$req->isAdmin()) {
            throw HttpError::forbidden('Lista de outro usuário');
        }
        if ($r['status'] !== 'draft') {
            throw HttpError::badRequest('Apenas listas em rascunho podem ser editadas');
        }
        $in = $req->input();
        $items = self::parseItems($in->array('items', true));
        $title = $in->string('title');
        $notes = $in->string('notes');

        Db::transaction(function (PDO $pdo) use ($id, $title, $notes, $items) {
            $pdo->prepare('UPDATE purchase_requests SET title = COALESCE(?, title), notes = ? WHERE id = ?')
                ->execute([$title, $notes, $id]);
            $pdo->prepare('DELETE FROM purchase_request_items WHERE request_id = ?')->execute([$id]);
            self::insertItems($pdo, $id, $items);
        });
        Http::json(self::row($id));
    }

    public static function submit(Request $req): void
    {
        $id = $req->intParam('id');
        $r = self::row($id);
        if ((int) $r['created_by'] !== $req->userId() && !$req->isAdmin()) {
            throw HttpError::forbidden('Lista de outro usuário');
        }
        if ($r['status'] !== 'draft') {
            throw HttpError::badRequest('Apenas listas em rascunho podem ser enviadas');
        }
        Db::execute("UPDATE purchase_requests SET status = 'submitted', submitted_at = NOW() WHERE id = ?", [$id]);
        Http::json(self::row($id));
    }

    public static function cancel(Request $req): void
    {
        $id = $req->intParam('id');
        $r = self::row($id);
        if ($r['status'] === 'ordered' || $r['status'] === 'cancelled') {
            throw HttpError::badRequest('Lista já finalizada ou cancelada não pode ser cancelada');
        }
        Db::execute("UPDATE purchase_requests SET status = 'cancelled' WHERE id = ?", [$id]);
        Http::json(self::row($id));
    }

    public static function remove(Request $req): void
    {
        $id = $req->intParam('id');
        $r = self::row($id);
        if (!$req->isAdmin()) {
            if ((int) $r['created_by'] !== $req->userId()) {
                throw HttpError::forbidden('Lista de outro usuário');
            }
            if ($r['status'] !== 'draft') {
                throw HttpError::badRequest('Apenas listas em rascunho podem ser excluídas');
            }
        }
        Db::transaction(function (PDO $pdo) use ($id) {
            $pdo->prepare('UPDATE orders SET purchase_request_id = NULL WHERE purchase_request_id = ?')->execute([$id]);
            // purchase_request_items é removido em cascata (ON DELETE CASCADE).
            $pdo->prepare('DELETE FROM purchase_requests WHERE id = ?')->execute([$id]);
        });
        Http::noContent();
    }

    public static function allocate(Request $req): void
    {
        $id = $req->intParam('id');
        $r = self::row($id);
        if (!in_array($r['status'], ['submitted', 'allocated'], true)) {
            throw HttpError::badRequest('A lista precisa estar enviada para ser alocada');
        }
        $allocations = self::parseAllocations($req->input()->array('allocations', true));

        Db::transaction(function (PDO $pdo) use ($id, $allocations) {
            foreach ($allocations as $a) {
                $check = $pdo->prepare('SELECT id FROM purchase_request_items WHERE id = ? AND request_id = ?');
                $check->execute([$a['id'], $id]);
                if (!$check->fetch()) {
                    throw HttpError::badRequest("Item {$a['id']} não pertence a esta lista");
                }
                $pdo->prepare(
                    'UPDATE purchase_request_items
                        SET alloc_supplier_id = ?, alloc_item_id = ?, alloc_name = ?, alloc_unit = ?, alloc_price = ?
                      WHERE id = ?'
                )->execute([$a['supplier_id'], $a['item_id'], $a['name'], $a['unit'], $a['price'], $a['id']]);
            }
            $pdo->prepare("UPDATE purchase_requests SET status = 'allocated' WHERE id = ?")->execute([$id]);
        });
        Http::json(self::row($id));
    }

    public static function generateOrders(Request $req): void
    {
        $id = $req->intParam('id');
        $r = self::row($id);
        if ($r['status'] !== 'allocated') {
            throw HttpError::badRequest('Aloque os itens antes de gerar os pedidos');
        }
        $items = Db::query(
            'SELECT pri.*, p.name AS product_name
               FROM purchase_request_items pri
               LEFT JOIN products p ON p.id = pri.product_id
              WHERE pri.request_id = ?',
            [$id]
        );
        if (!$items) {
            throw HttpError::badRequest('Lista sem itens');
        }
        $pending = 0;
        foreach ($items as $i) {
            $hasName = $i['alloc_item_id'] !== null
                || ($i['alloc_name'] ?? $i['free_text'] ?? $i['product_name']);
            if ($i['alloc_supplier_id'] === null || $i['alloc_price'] === null || !$hasName) {
                $pending++;
            }
        }
        if ($pending > 0) {
            throw HttpError::badRequest("{$pending} item(ns) sem alocação completa (fornecedor e preço)");
        }

        $orderIds = Db::transaction(function (PDO $pdo) use ($items, $id, $req) {
            $bySupplier = [];
            foreach ($items as $i) {
                $bySupplier[(int) $i['alloc_supplier_id']][] = $i;
            }
            $created = [];
            foreach ($bySupplier as $supplierId => $lines) {
                $o = $pdo->prepare(
                    'INSERT INTO orders (supplier_id, purchase_request_id, created_by, notes) VALUES (?, ?, ?, ?)'
                );
                $o->execute([$supplierId, $id, $req->userId(), "Gerado da lista #{$id}"]);
                $orderId = (int) $pdo->lastInsertId();

                foreach ($lines as $line) {
                    $itemId = $line['alloc_item_id'] !== null ? (int) $line['alloc_item_id'] : null;
                    if ($itemId === null) {
                        $name = trim((string) ($line['alloc_name'] ?: $line['free_text'] ?: $line['product_name']));
                        $unit = $line['alloc_unit'] ?: ($line['unit'] ?: 'un');
                        $ins = $pdo->prepare(
                            'INSERT INTO items (supplier_id, product_id, name, unit, base_price) VALUES (?, ?, ?, ?, ?)'
                        );
                        $ins->execute([$supplierId, $line['product_id'], $name, $unit, $line['alloc_price']]);
                        $itemId = (int) $pdo->lastInsertId();
                    }
                    $pdo->prepare(
                        'INSERT INTO order_items (order_id, item_id, quantity, unit_price, notes) VALUES (?, ?, ?, ?, ?)'
                    )->execute([$orderId, $itemId, $line['quantity'], $line['alloc_price'], $line['notes']]);
                }
                $pdo->prepare(
                    'UPDATE orders SET total_amount = COALESCE(
                        (SELECT SUM(subtotal) FROM order_items WHERE order_id = ?), 0) WHERE id = ?'
                )->execute([$orderId, $orderId]);
                $created[] = $orderId;
            }
            $pdo->prepare("UPDATE purchase_requests SET status = 'ordered' WHERE id = ?")->execute([$id]);
            return $created;
        });
        Http::json(['orderIds' => $orderIds]);
    }

    // ---- helpers ----

    private static function row(int $id): array
    {
        $r = Db::queryOne('SELECT * FROM purchase_requests WHERE id = ?', [$id]);
        if (!$r) {
            throw HttpError::notFound('Lista de compras não encontrada');
        }
        return $r;
    }

    /** Valida/normaliza os itens recebidos. */
    private static function parseItems(array $raw): array
    {
        if (!$raw) {
            throw HttpError::badRequest('Inclua ao menos um item');
        }
        $out = [];
        foreach ($raw as $r) {
            $productId = isset($r['product_id']) && $r['product_id'] !== null ? (int) $r['product_id'] : null;
            $freeText = isset($r['free_text']) && is_string($r['free_text']) ? trim($r['free_text']) : '';
            if ($productId === null && $freeText === '') {
                throw HttpError::badRequest('Cada item precisa de um produto do catálogo ou um texto livre');
            }
            $qty = isset($r['quantity']) && is_numeric($r['quantity']) ? (float) $r['quantity'] : 0;
            if ($qty <= 0) {
                throw HttpError::badRequest('Quantidade deve ser maior que zero');
            }
            $out[] = [
                'product_id' => $productId,
                'free_text' => $freeText !== '' ? $freeText : null,
                'quantity' => $qty,
                'unit' => isset($r['unit']) && is_string($r['unit']) && trim($r['unit']) !== '' ? trim($r['unit']) : 'un',
                'notes' => isset($r['notes']) && is_string($r['notes']) && trim($r['notes']) !== '' ? trim($r['notes']) : null,
            ];
        }
        return $out;
    }

    private static function insertItems(PDO $pdo, int $requestId, array $items): void
    {
        $stmt = $pdo->prepare(
            'INSERT INTO purchase_request_items (request_id, product_id, free_text, quantity, unit, notes)
             VALUES (?, ?, ?, ?, ?, ?)'
        );
        foreach ($items as $it) {
            $stmt->execute([$requestId, $it['product_id'], $it['free_text'], $it['quantity'], $it['unit'], $it['notes']]);
        }
    }

    private static function parseAllocations(array $raw): array
    {
        if (!$raw) {
            throw HttpError::badRequest('Nada para alocar');
        }
        $out = [];
        foreach ($raw as $a) {
            $lineId = (int) ($a['id'] ?? 0);
            $supplierId = (int) ($a['supplier_id'] ?? 0);
            if ($lineId <= 0 || $supplierId <= 0) {
                throw HttpError::badRequest('Alocação inválida (item/fornecedor)');
            }
            if (!isset($a['price']) || !is_numeric($a['price']) || (float) $a['price'] < 0) {
                throw HttpError::badRequest('Preço inválido');
            }
            $out[] = [
                'id' => $lineId,
                'supplier_id' => $supplierId,
                'item_id' => isset($a['item_id']) && $a['item_id'] !== null ? (int) $a['item_id'] : null,
                'name' => isset($a['name']) && is_string($a['name']) && trim($a['name']) !== '' ? trim($a['name']) : null,
                'unit' => isset($a['unit']) && is_string($a['unit']) && trim($a['unit']) !== '' ? trim($a['unit']) : null,
                'price' => (float) $a['price'],
            ];
        }
        return $out;
    }
}
