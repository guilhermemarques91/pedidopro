<?php

namespace App\Modules\Quotations;

use App\Core\Db;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Request;
use App\Services\AiExtractor;
use App\Services\QuotationWriter;
use PDO;

final class QuotationsController
{
    private const SOURCES = ['manual', 'excel', 'pdf', 'image', 'whatsapp'];

    public static function list(Request $req): void
    {
        $params = [];
        $where = '';
        if ($req->query('status') !== null) {
            $where = 'WHERE q.status = ?';
            $params[] = $req->query('status');
        }
        Http::json(Db::query(
            "SELECT q.*, u.name AS created_by_name, COUNT(qi.id) AS item_count
               FROM quotations q
               JOIN users u ON u.id = q.created_by
               LEFT JOIN quotation_items qi ON qi.quotation_id = q.id
               {$where}
              GROUP BY q.id, u.name
              ORDER BY q.created_at DESC",
            $params
        ));
    }

    public static function getById(Request $req): void
    {
        $id = $req->intParam('id');
        $q = self::row($id);
        $q['items'] = Db::query(
            'SELECT qi.*, i.name AS item_name, i.unit, s.name AS supplier_name
               FROM quotation_items qi
               JOIN items i ON i.id = qi.item_id
               JOIN suppliers s ON s.id = qi.supplier_id
              WHERE qi.quotation_id = ?
              ORDER BY i.name, s.name',
            [$id]
        );
        Http::json($q);
    }

    public static function create(Request $req): void
    {
        $title = $req->input()->requireString('title', 1, 200);
        $row = Db::insertReturning(
            'INSERT INTO quotations (title, created_by) VALUES (?, ?)',
            [$title, $req->userId()],
            'quotations'
        );
        Http::json($row, 201);
    }

    public static function update(Request $req): void
    {
        $id = $req->intParam('id');
        $q = self::row($id);
        if ($q['status'] === 'closed') {
            throw HttpError::badRequest('Cotação fechada não pode ser editada');
        }
        $in = $req->input();
        $fields = [];
        $values = [];
        if ($in->has('title')) {
            $fields[] = 'title = ?';
            $values[] = $in->requireString('title', 1, 200);
        }
        if ($in->has('status')) {
            $fields[] = 'status = ?';
            $values[] = $in->enum('status', ['draft', 'active'], true);
        }
        if (!$fields) {
            throw HttpError::badRequest('Nada para atualizar');
        }
        $values[] = $id;
        Db::execute('UPDATE quotations SET ' . implode(', ', $fields) . ' WHERE id = ?', $values);
        Http::json(self::row($id));
    }

    public static function remove(Request $req): void
    {
        $id = $req->intParam('id');
        self::row($id);
        Db::transaction(function (PDO $pdo) use ($id) {
            $pdo->prepare('UPDATE orders SET quotation_id = NULL WHERE quotation_id = ?')->execute([$id]);
            $pdo->prepare('DELETE FROM quotation_items WHERE quotation_id = ?')->execute([$id]);
            $pdo->prepare('DELETE FROM quotations WHERE id = ?')->execute([$id]);
        });
        Http::noContent();
    }

    public static function close(Request $req): void
    {
        $id = $req->intParam('id');
        $q = self::row($id);
        if ($q['status'] === 'closed') {
            throw HttpError::badRequest('Cotação já está fechada');
        }
        Db::transaction(function (PDO $pdo) use ($id) {
            $pdo->prepare(
                'INSERT INTO price_history (item_id, supplier_id, price, quotation_id)
                 SELECT item_id, supplier_id, price, quotation_id
                   FROM quotation_items
                  WHERE quotation_id = ? AND price IS NOT NULL'
            )->execute([$id]);
            $pdo->prepare("UPDATE quotations SET status = 'closed', closed_at = NOW() WHERE id = ?")->execute([$id]);
        });
        Http::json(self::row($id));
    }

    public static function comparison(Request $req): void
    {
        $id = $req->intParam('id');
        self::row($id);
        $rows = Db::query(
            'SELECT qi.*, i.name AS item_name, i.unit, s.name AS supplier_name,
                    i.product_id, p.name AS product_name
               FROM quotation_items qi
               JOIN items i ON i.id = qi.item_id
               JOIN suppliers s ON s.id = qi.supplier_id
               LEFT JOIN products p ON p.id = i.product_id
              WHERE qi.quotation_id = ? AND qi.price IS NOT NULL
              ORDER BY LOWER(COALESCE(p.name, i.name))',
            [$id]
        );

        $groups = [];
        foreach ($rows as $r) {
            $key = $r['product_id'] ? ('p' . $r['product_id']) : ('n:' . strtolower(trim($r['item_name'])));
            if (!isset($groups[$key])) {
                $groups[$key] = [
                    'item' => $r['product_name'] ?? $r['item_name'],
                    'unit' => $r['unit'],
                    'offers' => [],
                ];
            }
            $groups[$key]['offers'][] = [
                'supplier' => $r['supplier_name'],
                'price' => (float) $r['price'],
                'qiId' => (int) $r['id'],
                'itemName' => $r['item_name'],
            ];
        }

        $out = [];
        foreach ($groups as $g) {
            $prices = array_column($g['offers'], 'price');
            $best = min($prices);
            usort($g['offers'], static fn ($a, $b) => $a['price'] <=> $b['price']);
            $offers = array_map(static function ($o) use ($best) {
                $o['isBest'] = $o['price'] === $best;
                return $o;
            }, $g['offers']);
            $out[] = [
                'item' => $g['item'],
                'unit' => $g['unit'],
                'bestPrice' => $best,
                'offers' => $offers,
            ];
        }
        Http::json($out);
    }

    // ---- itens ----

    public static function addItem(Request $req): void
    {
        $id = $req->intParam('id');
        $q = self::row($id);
        if ($q['status'] === 'closed') {
            throw HttpError::badRequest('Cotação fechada não aceita novos preços');
        }
        $in = $req->input();
        $itemId = $in->integer('item_id', true);
        $item = Db::queryOne('SELECT id, supplier_id FROM items WHERE id = ?', [$itemId]);
        if (!$item) {
            throw HttpError::badRequest('Item informado não existe');
        }
        $supplierId = $in->integer('supplier_id') ?? (int) $item['supplier_id'];
        if (!Db::queryOne('SELECT id FROM suppliers WHERE id = ?', [$supplierId])) {
            throw HttpError::badRequest('Fornecedor informado não existe');
        }
        $source = $in->enum('source', self::SOURCES, false, 'manual');
        Db::execute(
            'INSERT INTO quotation_items (quotation_id, item_id, supplier_id, price, quantity, notes, source)
             VALUES (?, ?, ?, ?, ?, ?, ?)',
            [$id, $itemId, $supplierId, $in->number('price'), $in->number('quantity'), $in->string('notes'), $source]
        );
        Http::json(self::itemRow(Db::lastInsertId()), 201);
    }

    public static function updateItem(Request $req): void
    {
        $id = $req->intParam('id');
        $qiId = $req->intParam('itemId');
        self::assertItemBelongs($id, $qiId);
        $in = $req->input();
        $fields = [];
        $values = [];
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
        if ($in->has('reviewed')) {
            $fields[] = 'reviewed = ?';
            $values[] = $in->boolean('reviewed') ? 1 : 0;
        }
        if (!$fields) {
            throw HttpError::badRequest('Nada para atualizar');
        }
        $values[] = $qiId;
        Db::execute('UPDATE quotation_items SET ' . implode(', ', $fields) . ' WHERE id = ?', $values);
        Http::json(self::itemRow($qiId));
    }

    public static function removeItem(Request $req): void
    {
        $id = $req->intParam('id');
        $qiId = $req->intParam('itemId');
        self::assertItemBelongs($id, $qiId);
        Db::execute('DELETE FROM quotation_items WHERE id = ?', [$qiId]);
        Http::noContent();
    }

    // ---- extração por IA ----

    public static function extractText(Request $req): void
    {
        $id = $req->intParam('id');
        $in = $req->input();
        $supplierId = $in->integer('supplier_id', true);
        $text = $in->requireString('text');
        self::assertExtractable($id, $supplierId);
        $rows = AiExtractor::fromText($text);
        Http::json(self::addExtracted($id, $supplierId, $rows, 'whatsapp'), 201);
    }

    public static function extract(Request $req): void
    {
        $id = $req->intParam('id');
        $file = $req->file('file');
        if (!$file) {
            throw HttpError::badRequest('Envie o documento (PDF ou imagem) no campo "file"');
        }
        $supplierId = (int) ($req->body['supplier_id'] ?? 0);
        if ($supplierId <= 0) {
            throw HttpError::badRequest('Informe o supplier_id do fornecedor do documento');
        }
        self::assertExtractable($id, $supplierId);
        $mediaType = $file['type'] ?: 'application/octet-stream';
        $source = $mediaType === 'application/pdf' ? 'pdf' : 'image';
        $binary = (string) file_get_contents($file['tmp_name']);
        $rows = AiExtractor::fromDocument($binary, $mediaType);
        Http::json(self::addExtracted($id, $supplierId, $rows, $source), 201);
    }

    // ---- helpers ----

    private static function assertExtractable(int $quotationId, int $supplierId): void
    {
        $q = self::row($quotationId);
        if ($q['status'] === 'closed') {
            throw HttpError::badRequest('Cotação fechada não aceita novos preços');
        }
        if (!Db::queryOne('SELECT id FROM suppliers WHERE id = ?', [$supplierId])) {
            throw HttpError::badRequest('Fornecedor informado não existe');
        }
    }

    /** Grava as linhas extraídas (find-or-create do item + insert em quotation_items). */
    private static function addExtracted(int $quotationId, int $supplierId, array $rows, string $source): array
    {
        $ids = QuotationWriter::addExtracted($quotationId, $supplierId, $rows, $source);
        $items = array_map(static fn ($qid) => self::itemRow($qid), $ids);
        return ['extracted' => count($rows), 'added' => count($ids), 'rows' => $rows, 'items' => $items];
    }

    private static function row(int $id): array
    {
        $q = Db::queryOne('SELECT * FROM quotations WHERE id = ?', [$id]);
        if (!$q) {
            throw HttpError::notFound('Cotação não encontrada');
        }
        return $q;
    }

    private static function itemRow(int $qiId): array
    {
        $row = Db::queryOne(
            'SELECT qi.*, i.name AS item_name, i.unit, s.name AS supplier_name
               FROM quotation_items qi
               JOIN items i ON i.id = qi.item_id
               JOIN suppliers s ON s.id = qi.supplier_id
              WHERE qi.id = ?',
            [$qiId]
        );
        if (!$row) {
            throw HttpError::notFound('Item da cotação não encontrado');
        }
        return $row;
    }

    private static function assertItemBelongs(int $quotationId, int $qiId): void
    {
        $q = self::row($quotationId);
        if ($q['status'] === 'closed') {
            throw HttpError::badRequest('Cotação fechada não pode ser editada');
        }
        $row = Db::queryOne('SELECT id FROM quotation_items WHERE id = ? AND quotation_id = ?', [$qiId, $quotationId]);
        if (!$row) {
            throw HttpError::notFound('Item da cotação não encontrado nesta cotação');
        }
    }
}
