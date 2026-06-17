<?php

namespace App\Modules\Orders;

use App\Core\Db;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Request;
use App\Services\Evolution;
use PDO;

final class OrdersController
{
    public static function list(Request $req): void
    {
        $conditions = [];
        $params = [];
        if ($req->query('status') !== null) {
            $conditions[] = 'o.status = ?';
            $params[] = $req->query('status');
        }
        if ($req->query('supplier_id') !== null) {
            $conditions[] = 'o.supplier_id = ?';
            $params[] = (int) $req->query('supplier_id');
        }
        $where = $conditions ? 'WHERE ' . implode(' AND ', $conditions) : '';
        Http::json(Db::query(
            "SELECT o.*, s.name AS supplier_name, u.name AS created_by_name
               FROM orders o
               JOIN suppliers s ON s.id = o.supplier_id
               JOIN users u ON u.id = o.created_by
               {$where}
               ORDER BY o.created_at DESC",
            $params
        ));
    }

    public static function getById(Request $req): void
    {
        Http::json(self::detailed($req->intParam('id')));
    }

    public static function create(Request $req): void
    {
        $in = $req->input();
        $supplierId = $in->integer('supplier_id', true);
        $quotationId = $in->integer('quotation_id');
        $notes = $in->string('notes');
        $items = self::parseItems($in->array('items', true));

        $sup = Db::queryOne('SELECT id FROM suppliers WHERE id = ? AND active = 1', [$supplierId]);
        if (!$sup) {
            throw HttpError::badRequest('Fornecedor não existe ou está inativo');
        }
        foreach ($items as $it) {
            $item = Db::queryOne('SELECT supplier_id FROM items WHERE id = ?', [$it['item_id']]);
            if (!$item) {
                throw HttpError::badRequest("Item {$it['item_id']} não existe");
            }
            if ((int) $item['supplier_id'] !== $supplierId) {
                throw HttpError::badRequest("Item {$it['item_id']} não pertence ao fornecedor informado");
            }
        }

        $orderId = Db::transaction(function (PDO $pdo) use ($supplierId, $quotationId, $notes, $items, $req) {
            $o = $pdo->prepare('INSERT INTO orders (supplier_id, quotation_id, notes, created_by) VALUES (?, ?, ?, ?)');
            $o->execute([$supplierId, $quotationId, $notes, $req->userId()]);
            $id = (int) $pdo->lastInsertId();
            self::insertItem($pdo, $id, $items);
            self::recalc($pdo, $id);
            return $id;
        });
        Http::json(self::detailed($orderId), 201);
    }

    public static function update(Request $req): void
    {
        $id = $req->intParam('id');
        self::assertDraft(self::row($id));
        Db::execute('UPDATE orders SET notes = ? WHERE id = ?', [$req->input()->string('notes'), $id]);
        Http::json(self::detailed($id));
    }

    public static function remove(Request $req): void
    {
        $id = $req->intParam('id');
        self::row($id);
        Db::transaction(function (PDO $pdo) use ($id) {
            $pdo->prepare('DELETE FROM order_approvals WHERE order_id = ?')->execute([$id]);
            $pdo->prepare('DELETE FROM order_items WHERE order_id = ?')->execute([$id]);
            $pdo->prepare('DELETE FROM orders WHERE id = ?')->execute([$id]);
        });
        Http::noContent();
    }

    public static function addItem(Request $req): void
    {
        $orderId = $req->intParam('id');
        $o = self::row($orderId);
        self::assertDraft($o);
        $items = self::parseItems([$req->body]);
        $it = $items[0];
        $item = Db::queryOne('SELECT supplier_id FROM items WHERE id = ?', [$it['item_id']]);
        if (!$item) {
            throw HttpError::badRequest('Item não existe');
        }
        if ((int) $item['supplier_id'] !== (int) $o['supplier_id']) {
            throw HttpError::badRequest('Item não pertence ao fornecedor do pedido');
        }
        Db::transaction(function (PDO $pdo) use ($orderId, $it) {
            self::insertItem($pdo, $orderId, [$it]);
            self::recalc($pdo, $orderId);
        });
        Http::json(self::detailed($orderId));
    }

    public static function updateItem(Request $req): void
    {
        $orderId = $req->intParam('id');
        $itemRowId = $req->intParam('itemId');
        self::assertDraft(self::row($orderId));
        self::assertItemBelongs($orderId, $itemRowId);

        $in = $req->input();
        $fields = [];
        $values = [];
        if ($in->has('quantity')) {
            $fields[] = 'quantity = ?';
            $values[] = $in->number('quantity', true);
        }
        if ($in->has('unit_price')) {
            $fields[] = 'unit_price = ?';
            $values[] = $in->number('unit_price', true);
        }
        if ($in->has('notes')) {
            $fields[] = 'notes = ?';
            $values[] = $in->string('notes');
        }
        if (!$fields) {
            throw HttpError::badRequest('Informe ao menos um campo para atualizar');
        }
        $values[] = $itemRowId;
        Db::transaction(function (PDO $pdo) use ($fields, $values, $orderId) {
            $pdo->prepare('UPDATE order_items SET ' . implode(', ', $fields) . ' WHERE id = ?')->execute($values);
            self::recalc($pdo, $orderId);
        });
        Http::json(self::detailed($orderId));
    }

    public static function removeItem(Request $req): void
    {
        $orderId = $req->intParam('id');
        $itemRowId = $req->intParam('itemId');
        self::assertDraft(self::row($orderId));
        self::assertItemBelongs($orderId, $itemRowId);
        Db::transaction(function (PDO $pdo) use ($orderId, $itemRowId) {
            $pdo->prepare('DELETE FROM order_items WHERE id = ?')->execute([$itemRowId]);
            self::recalc($pdo, $orderId);
        });
        Http::json(self::detailed($orderId));
    }

    public static function submit(Request $req): void
    {
        $id = $req->intParam('id');
        $o = self::row($id);
        if ($o['status'] !== 'draft') {
            throw HttpError::badRequest('Apenas pedidos em rascunho podem ser enviados para aprovação');
        }
        if (!self::items($id)) {
            throw HttpError::badRequest('Pedido sem itens não pode ser enviado para aprovação');
        }
        self::setStatus($id, 'pending_approval');
        Http::json(self::row($id));
    }

    public static function approve(Request $req): void
    {
        $id = $req->intParam('id');
        $o = self::row($id);
        if ($o['status'] !== 'pending_approval') {
            throw HttpError::badRequest('Pedido não está aguardando aprovação');
        }
        $comment = $req->input()->string('comment');
        Db::transaction(function (PDO $pdo) use ($id, $req, $comment) {
            $pdo->prepare("INSERT INTO order_approvals (order_id, action, user_id, comment) VALUES (?, 'approved', ?, ?)")
                ->execute([$id, $req->userId(), $comment]);
            $pdo->prepare("UPDATE orders SET status = 'approved', approved_by = ?, approved_at = NOW() WHERE id = ?")
                ->execute([$req->userId(), $id]);
        });
        Http::json(self::row($id));
    }

    public static function reject(Request $req): void
    {
        $id = $req->intParam('id');
        $o = self::row($id);
        if ($o['status'] !== 'pending_approval') {
            throw HttpError::badRequest('Pedido não está aguardando aprovação');
        }
        $comment = $req->input()->string('comment');
        Db::transaction(function (PDO $pdo) use ($id, $req, $comment) {
            $pdo->prepare("INSERT INTO order_approvals (order_id, action, user_id, comment) VALUES (?, 'rejected', ?, ?)")
                ->execute([$id, $req->userId(), $comment]);
            $pdo->prepare("UPDATE orders SET status = 'draft', approved_by = NULL, approved_at = NULL WHERE id = ?")
                ->execute([$id]);
        });
        Http::json(self::row($id));
    }

    public static function send(Request $req): void
    {
        $id = $req->intParam('id');
        $o = self::row($id);
        if ($o['status'] !== 'approved') {
            throw HttpError::badRequest('Apenas pedidos aprovados podem ser enviados');
        }
        $supplier = Db::queryOne(
            'SELECT order_type, whatsapp_number, name FROM suppliers WHERE id = ?',
            [$o['supplier_id']]
        );
        if (!$supplier) {
            throw HttpError::badRequest('Fornecedor do pedido não encontrado');
        }
        $whatsappSent = false;
        if ($supplier['order_type'] === 'whatsapp') {
            if (!$supplier['whatsapp_number']) {
                throw HttpError::badRequest('Fornecedor não tem número de WhatsApp cadastrado');
            }
            $items = self::items($id);
            $message = Evolution::formatOrderMessage(
                ['id' => $o['id'], 'total_amount' => (float) ($o['total_amount'] ?? 0), 'created_at' => $o['created_at']],
                array_map(static fn ($it) => [
                    'name' => $it['item_name'],
                    'quantity' => $it['quantity'],
                    'unit' => $it['unit'],
                    'unit_price' => $it['unit_price'],
                ], $items)
            );
            Evolution::sendMessage($supplier['whatsapp_number'], $message);
            $whatsappSent = true;
        }
        Db::execute("UPDATE orders SET status = 'sent', sent_at = NOW() WHERE id = ?", [$id]);
        Http::json(['order' => self::row($id), 'whatsappSent' => $whatsappSent]);
    }

    public static function receive(Request $req): void
    {
        $id = $req->intParam('id');
        $o = self::row($id);
        if ($o['status'] !== 'sent') {
            throw HttpError::badRequest('Apenas pedidos enviados podem ser marcados como recebidos');
        }
        Db::execute("UPDATE orders SET status = 'received', received_at = NOW() WHERE id = ?", [$id]);
        Http::json(self::row($id));
    }

    public static function cancel(Request $req): void
    {
        $id = $req->intParam('id');
        $o = self::row($id);
        if ($o['status'] === 'received' || $o['status'] === 'cancelled') {
            throw HttpError::badRequest('Pedido recebido ou já cancelado não pode ser cancelado');
        }
        self::setStatus($id, 'cancelled');
        Http::json(self::row($id));
    }

    // ---- helpers ----

    private static function row(int $id): array
    {
        $o = Db::queryOne('SELECT * FROM orders WHERE id = ?', [$id]);
        if (!$o) {
            throw HttpError::notFound('Pedido não encontrado');
        }
        return $o;
    }

    private static function detailed(int $id): array
    {
        $order = Db::queryOne(
            'SELECT o.*, s.name AS supplier_name, s.order_type, s.whatsapp_number,
                    u.name AS created_by_name, a.name AS approved_by_name
               FROM orders o
               JOIN suppliers s ON s.id = o.supplier_id
               JOIN users u ON u.id = o.created_by
               LEFT JOIN users a ON a.id = o.approved_by
              WHERE o.id = ?',
            [$id]
        );
        if (!$order) {
            throw HttpError::notFound('Pedido não encontrado');
        }
        $order['items'] = self::items($id);
        $order['approvals'] = Db::query(
            'SELECT ap.*, u.name AS user_name
               FROM order_approvals ap JOIN users u ON u.id = ap.user_id
              WHERE ap.order_id = ? ORDER BY ap.created_at',
            [$id]
        );
        return $order;
    }

    private static function items(int $orderId): array
    {
        return Db::query(
            'SELECT oi.*, i.name AS item_name, i.unit
               FROM order_items oi JOIN items i ON i.id = oi.item_id
              WHERE oi.order_id = ? ORDER BY i.name',
            [$orderId]
        );
    }

    private static function assertDraft(array $o): void
    {
        if ($o['status'] !== 'draft') {
            throw HttpError::badRequest("Pedido em status \"{$o['status']}\" não pode ser editado (apenas rascunho)");
        }
    }

    private static function assertItemBelongs(int $orderId, int $itemRowId): void
    {
        $row = Db::queryOne('SELECT id FROM order_items WHERE id = ? AND order_id = ?', [$itemRowId, $orderId]);
        if (!$row) {
            throw HttpError::notFound('Item não encontrado neste pedido');
        }
    }

    private static function recalc(PDO $pdo, int $orderId): void
    {
        $pdo->prepare(
            'UPDATE orders SET total_amount = COALESCE(
                (SELECT SUM(subtotal) FROM order_items WHERE order_id = ?), 0) WHERE id = ?'
        )->execute([$orderId, $orderId]);
    }

    private static function setStatus(int $id, string $status): void
    {
        Db::execute('UPDATE orders SET status = ? WHERE id = ?', [$status, $id]);
    }

    private static function insertItem(PDO $pdo, int $orderId, array $items): void
    {
        $stmt = $pdo->prepare(
            'INSERT INTO order_items (order_id, item_id, quantity, unit_price, notes) VALUES (?, ?, ?, ?, ?)'
        );
        foreach ($items as $it) {
            $stmt->execute([$orderId, $it['item_id'], $it['quantity'], $it['unit_price'], $it['notes']]);
        }
    }

    private static function parseItems(array $raw): array
    {
        $out = [];
        foreach ($raw as $r) {
            $itemId = (int) ($r['item_id'] ?? 0);
            if ($itemId <= 0) {
                throw HttpError::badRequest('item_id obrigatório');
            }
            $qty = isset($r['quantity']) && is_numeric($r['quantity']) ? (float) $r['quantity'] : 0;
            if ($qty <= 0) {
                throw HttpError::badRequest('Quantidade deve ser positiva');
            }
            $price = isset($r['unit_price']) && is_numeric($r['unit_price']) ? (float) $r['unit_price'] : -1;
            if ($price < 0) {
                throw HttpError::badRequest('Preço unitário não pode ser negativo');
            }
            $out[] = [
                'item_id' => $itemId,
                'quantity' => $qty,
                'unit_price' => $price,
                'notes' => isset($r['notes']) && is_string($r['notes']) && trim($r['notes']) !== '' ? trim($r['notes']) : null,
            ];
        }
        if (!$out) {
            throw HttpError::badRequest('Inclua ao menos um item');
        }
        return $out;
    }
}
