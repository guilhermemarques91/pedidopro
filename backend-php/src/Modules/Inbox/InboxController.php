<?php

namespace App\Modules\Inbox;

use App\Core\Db;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Request;
use App\Services\QuotationWriter;
use App\Services\WhatsappSync;

final class InboxController
{
    public static function list(Request $req): void
    {
        Http::json(Db::query(
            "SELECT ip.*, s.name AS supplier_name
               FROM inbox_prices ip
               JOIN suppliers s ON s.id = ip.supplier_id
              WHERE ip.status = 'pending'
              ORDER BY s.name, ip.received_at DESC, ip.id"
        ));
    }

    public static function count(Request $req): void
    {
        $r = Db::queryOne("SELECT COUNT(*) AS n FROM inbox_prices WHERE status = 'pending'");
        Http::json(['count' => (int) ($r['n'] ?? 0)]);
    }

    public static function sync(Request $req): void
    {
        Http::json(WhatsappSync::run());
    }

    public static function update(Request $req): void
    {
        $id = $req->intParam('id');
        $row = Db::queryOne('SELECT id, status FROM inbox_prices WHERE id = ?', [$id]);
        if (!$row) {
            throw HttpError::notFound('Item da caixa de entrada não encontrado');
        }
        if ($row['status'] !== 'pending') {
            throw HttpError::badRequest('Item já revisado não pode ser editado');
        }
        $in = $req->input();
        $fields = [];
        $values = [];
        if ($in->has('item_name')) {
            $fields[] = 'item_name = ?';
            $values[] = $in->requireString('item_name');
        }
        if ($in->has('unit')) {
            $fields[] = 'unit = ?';
            $values[] = $in->requireString('unit');
        }
        if ($in->has('price')) {
            $fields[] = 'price = ?';
            $values[] = $in->number('price');
        }
        if ($in->has('quantity')) {
            $fields[] = 'quantity = ?';
            $values[] = $in->number('quantity');
        }
        if ($in->has('notes')) {
            $fields[] = 'notes = ?';
            $values[] = $in->string('notes');
        }
        if (!$fields) {
            throw HttpError::badRequest('Nada para atualizar');
        }
        $values[] = $id;
        Db::execute('UPDATE inbox_prices SET ' . implode(', ', $fields) . ' WHERE id = ?', $values);
        Http::json(Db::queryOne(
            'SELECT ip.*, s.name AS supplier_name FROM inbox_prices ip JOIN suppliers s ON s.id = ip.supplier_id WHERE ip.id = ?',
            [$id]
        ));
    }

    public static function approve(Request $req): void
    {
        $in = $req->input();
        $ids = $in->intArray('ids', true);
        $quotationId = $in->integer('quotation_id', true);
        if (!$ids) {
            throw HttpError::badRequest('Selecione ao menos um item');
        }
        $q = Db::queryOne('SELECT status FROM quotations WHERE id = ?', [$quotationId]);
        if (!$q) {
            throw HttpError::notFound('Cotação não encontrada');
        }
        if ($q['status'] === 'closed') {
            throw HttpError::badRequest('Cotação fechada não aceita novos preços');
        }

        $place = Db::inClause($ids);
        $rows = Db::query("SELECT * FROM inbox_prices WHERE id IN ({$place}) AND status = 'pending'", $ids);
        if (!$rows) {
            throw HttpError::badRequest('Nenhum item pendente selecionado');
        }

        $bySupplier = [];
        foreach ($rows as $r) {
            $bySupplier[(int) $r['supplier_id']][] = [
                'name' => $r['item_name'],
                'unit' => $r['unit'],
                'price' => $r['price'] !== null ? (float) $r['price'] : null,
                'quantity' => $r['quantity'] !== null ? (float) $r['quantity'] : null,
                'notes' => $r['notes'],
            ];
        }
        $added = 0;
        foreach ($bySupplier as $supplierId => $list) {
            $added += count(QuotationWriter::addExtracted($quotationId, $supplierId, $list, 'whatsapp'));
        }

        $approvedIds = array_map(static fn ($r) => (int) $r['id'], $rows);
        $place2 = Db::inClause($approvedIds);
        Db::execute(
            "UPDATE inbox_prices SET status = 'approved', reviewed_at = NOW(), reviewed_by = ? WHERE id IN ({$place2})",
            array_merge([$req->userId()], $approvedIds)
        );
        Http::json(['approved' => count($approvedIds), 'added' => $added]);
    }

    public static function discard(Request $req): void
    {
        $ids = $req->input()->intArray('ids', true);
        if (!$ids) {
            throw HttpError::badRequest('Selecione ao menos um item');
        }
        $place = Db::inClause($ids);
        $n = Db::execute(
            "UPDATE inbox_prices SET status = 'discarded', reviewed_at = NOW(), reviewed_by = ?
              WHERE id IN ({$place}) AND status = 'pending'",
            array_merge([$req->userId()], $ids)
        );
        Http::json(['discarded' => $n]);
    }
}
