<?php

namespace App\Modules\Orders;

use App\Core\Db;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Request;
use App\Services\Evolution;
use App\Services\Outbox;
use App\Services\Receiving;
use PDO;

final class OrdersController
{
    public static function list(Request $req): void
    {
        $conditions = ['o.org_id = ?'];
        $params = [$req->orgId()];
        if ($req->query('status') !== null) {
            $conditions[] = 'o.status = ?';
            $params[] = $req->query('status');
        }
        if ($req->query('supplier_id') !== null) {
            $conditions[] = 'o.supplier_id = ?';
            $params[] = (int) $req->query('supplier_id');
        }
        $where = 'WHERE ' . implode(' AND ', $conditions);
        Http::json(Db::query(
            "SELECT o.*, s.name AS supplier_name, u.name AS created_by_name,
                    -- Pedido com item a R$0 passava por aprovação/envio/recebimento sem
                    -- ninguém notar (preço não é obrigatório na alocação da lista de
                    -- compras) — esse flag alimenta o aviso na listagem e no detalhe.
                    EXISTS(
                      SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.unit_price <= 0
                    ) AS has_zero_price
               FROM orders o
               JOIN suppliers s ON s.id = o.supplier_id
               JOIN users u ON u.id = o.created_by
               {$where}
               ORDER BY o.created_at DESC" . self::pagination($req),
            $params
        ));
    }

    public static function getById(Request $req): void
    {
        Http::json(self::detailed($req->intParam('id'), $req->orgId()));
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
            $item = Db::queryOne('SELECT id FROM items WHERE id = ?', [$it['item_id']]);
            if (!$item) {
                throw HttpError::badRequest("Item {$it['item_id']} não existe");
            }
            if (!self::itemAvailableForSupplier((int) $it['item_id'], $supplierId)) {
                throw HttpError::badRequest("Item {$it['item_id']} não pertence ao fornecedor informado");
            }
        }

        $orderId = Db::transaction(function (PDO $pdo) use ($supplierId, $quotationId, $notes, $items, $req) {
            $o = $pdo->prepare('INSERT INTO orders (org_id, supplier_id, quotation_id, notes, created_by) VALUES (?, ?, ?, ?, ?)');
            $o->execute([$req->orgId(), $supplierId, $quotationId, $notes, $req->userId()]);
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
        self::assertDraft(self::row($id, $req->orgId()));
        Db::execute('UPDATE orders SET notes = ? WHERE id = ?', [$req->input()->string('notes'), $id]);
        Http::json(self::detailed($id));
    }

    public static function remove(Request $req): void
    {
        $id = $req->intParam('id');
        self::row($id, $req->orgId());
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
        $o = self::row($orderId, $req->orgId());
        self::assertDraft($o);
        $items = self::parseItems([$req->body]);
        $it = $items[0];
        $item = Db::queryOne('SELECT id FROM items WHERE id = ?', [$it['item_id']]);
        if (!$item) {
            throw HttpError::badRequest('Item não existe');
        }
        if (!self::itemAvailableForSupplier((int) $it['item_id'], (int) $o['supplier_id'])) {
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
        self::assertDraft(self::row($orderId, $req->orgId()));
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
        self::assertDraft(self::row($orderId, $req->orgId()));
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
        $o = self::row($id, $req->orgId());
        if ($o['status'] !== 'draft') {
            throw HttpError::badRequest('Apenas pedidos em rascunho podem ser enviados para aprovação');
        }
        if (!self::items($id)) {
            throw HttpError::badRequest('Pedido sem itens não pode ser enviado para aprovação');
        }
        self::setStatus($id, 'pending_approval');
        Http::json(self::row($id, $req->orgId()));
    }

    public static function approve(Request $req): void
    {
        $id = $req->intParam('id');
        $o = self::row($id, $req->orgId());
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
        Http::json(self::row($id, $req->orgId()));
    }

    public static function reject(Request $req): void
    {
        $id = $req->intParam('id');
        $o = self::row($id, $req->orgId());
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
        Http::json(self::row($id, $req->orgId()));
    }

    public static function send(Request $req): void
    {
        $id = $req->intParam('id');
        $o = self::row($id, $req->orgId());
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
            // Offline-first: se a Evolution estiver fora, fica na outbox e é reenviado depois.
            $whatsappSent = Outbox::send($req->orgId(), $supplier['whatsapp_number'], self::buildMessage($o), "order:{$id}");
        }
        // Pedido enviado passa a esperar mercadoria: nasce a ENTRADA aguardando, com o que
        // esperamos receber. Nada de estoque ainda — quem movimenta é a nota, na conferência
        // (ver Services\Receiving). Idempotente: reenviar não cria uma segunda entrada.
        Db::transaction(function (PDO $pdo) use ($id, $req): void {
            $pdo->prepare("UPDATE orders SET status = 'sent', sent_at = NOW() WHERE id = ?")->execute([$id]);
            Receiving::fromOrder($pdo, $req->orgId(), $id, $req->userId());
        });
        Http::json(['order' => self::row($id, $req->orgId()), 'whatsappSent' => $whatsappSent]);
    }

    /**
     * Retorna a mensagem do pedido formatada (mesma do envio), sem enviar.
     * Permite copiar/colar manualmente no WhatsApp caso a Evolution esteja indisponível.
     */
    public static function message(Request $req): void
    {
        $id = $req->intParam('id');
        $o = self::row($id, $req->orgId());
        $supplier = Db::queryOne(
            'SELECT order_type, whatsapp_number FROM suppliers WHERE id = ?',
            [$o['supplier_id']]
        );
        if (!$supplier) {
            throw HttpError::badRequest('Fornecedor do pedido não encontrado');
        }
        Http::json([
            'message' => self::buildMessage($o),
            'whatsapp_number' => $supplier['whatsapp_number'],
            'order_type' => $supplier['order_type'],
        ]);
    }

    /** Monta a mensagem de WhatsApp do pedido a partir dos seus itens. */
    private static function buildMessage(array $o): string
    {
        $items = self::items((int) $o['id']);
        return Evolution::formatOrderMessage(
            ['id' => $o['id'], 'total_amount' => (float) ($o['total_amount'] ?? 0), 'created_at' => $o['created_at']],
            array_map(static fn ($it) => [
                'name' => $it['item_name'],
                'code' => $it['supplier_code'] ?? null,
                'quantity' => $it['quantity'],
                'unit' => $it['unit'],
                'unit_price' => $it['unit_price'],
            ], $items)
        );
    }

    public static function cancel(Request $req): void
    {
        $id = $req->intParam('id');
        $o = self::row($id, $req->orgId());
        if ($o['status'] === 'received' || $o['status'] === 'cancelled') {
            throw HttpError::badRequest('Pedido recebido ou já cancelado não pode ser cancelado');
        }
        self::setStatus($id, 'cancelled');
        Http::json(self::row($id, $req->orgId()));
    }

    // ---- helpers ----

    /** Gate de tenant quando $orgId é informado (entradas públicas); null = uso interno já gated. */
    private static function row(int $id, ?int $orgId = null): array
    {
        $o = $orgId === null
            ? Db::queryOne('SELECT * FROM orders WHERE id = ?', [$id])
            : Db::queryOne('SELECT * FROM orders WHERE id = ? AND org_id = ?', [$id, $orgId]);
        if (!$o) {
            throw HttpError::notFound('Pedido não encontrado');
        }
        return $o;
    }

    private static function detailed(int $id, ?int $orgId = null): array
    {
        if ($orgId !== null) {
            self::row($id, $orgId); // gate de tenant
        }
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
        // supplier_code do fornecedor do pedido (vínculo) com fallback p/ o do item.
        return Db::query(
            'SELECT oi.*, i.name AS item_name, i.unit,
                    COALESCE(x.supplier_code, i.supplier_code) AS supplier_code
               FROM order_items oi
               JOIN items i ON i.id = oi.item_id
               JOIN orders o ON o.id = oi.order_id
               LEFT JOIN item_suppliers x ON x.item_id = oi.item_id AND x.supplier_id = o.supplier_id
              WHERE oi.order_id = ? ORDER BY i.name',
            [$orderId]
        );
    }

    /** Item disponível ao fornecedor = item de origem OU vínculo ativo em item_suppliers. */
    private static function itemAvailableForSupplier(int $itemId, int $supplierId): bool
    {
        $row = Db::queryOne(
            'SELECT 1 FROM items i
              WHERE i.id = ?
                AND (i.supplier_id = ?
                     OR EXISTS (SELECT 1 FROM item_suppliers x
                                 WHERE x.item_id = i.id AND x.supplier_id = ? AND x.active = 1))',
            [$itemId, $supplierId, $supplierId]
        );
        return $row !== null;
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

    /** Paginação opcional: ?limit=N(&offset=M). Sem limit = tudo (compatível). */
    private static function pagination(\App\Core\Request $req): string
    {
        $limit = (int) ($req->query('limit') ?? 0);
        if ($limit < 1) {
            return '';
        }
        $limit = min($limit, 500);
        $offset = max(0, (int) ($req->query('offset') ?? 0));
        return " LIMIT {$limit} OFFSET {$offset}";
    }
}
