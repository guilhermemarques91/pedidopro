<?php

namespace App\Modules\Stock;

use App\Core\Db;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Request;
use App\Services\AiExtractor;
use App\Services\Receiving;
use PDO;

/**
 * Entradas de mercadoria: a tela onde o pedido enviado vira estoque.
 *
 * A entrada nasce do pedido (aguardando) e é confirmada por um documento — NF-e, nota do
 * fornecedor lida pela IA, ou a conferência digitada. Ver App\Services\Receiving para o
 * porquê do desenho e para as regras de casamento.
 */
final class ReceiptsController
{
    /** GET /stock/receipts?status=aguardando */
    public static function list(Request $req): void
    {
        $where = ['r.org_id = ?'];
        $params = [$req->orgId()];
        $status = $req->query('status');
        if ($status !== null && $status !== '') {
            $where[] = 'r.status = ?';
            $params[] = $status;
        }
        $limit = max(1, min((int) ($req->query('limit') ?? 100), 200));

        Http::json(Db::query(
            'SELECT r.*, s.name AS supplier_name,
                    (SELECT COUNT(*) FROM stock_receipt_items ri WHERE ri.receipt_id = r.id) AS line_count,
                    (SELECT COUNT(*) FROM stock_receipt_items ri WHERE ri.receipt_id = r.id AND ri.status = ?) AS pending_count,
                    (SELECT COUNT(*) FROM stock_receipt_items ri WHERE ri.receipt_id = r.id AND ri.status = ?) AS diverging_count
               FROM stock_receipts r
               LEFT JOIN suppliers s ON s.id = r.supplier_id
              WHERE ' . implode(' AND ', $where) . "
              ORDER BY r.id DESC LIMIT {$limit}",
            array_merge([Receiving::LINE_PENDENTE, Receiving::LINE_DIVERGENTE], $params)
        ));
    }

    /** GET /stock/receipts/:id — cabeçalho + linhas (esperado × recebido). */
    public static function getById(Request $req): void
    {
        $receipt = self::find($req->intParam('id'), $req->orgId());
        $items = Db::query(
            'SELECT ri.*, p.name AS product_name, p.unit AS product_unit, p.stock_qty,
                    it.package_size, it.package_unit
               FROM stock_receipt_items ri
               LEFT JOIN products p ON p.id = ri.product_id
               LEFT JOIN items it ON it.id = ri.item_id
              WHERE ri.receipt_id = ?
              ORDER BY ri.sort_order, ri.id',
            [$receipt['id']]
        );
        // Prévia de quanto vai de fato entrar no estoque — a tela mostra isso ANTES de
        // confirmar, pra conversão de unidade não ser uma surpresa depois do fato.
        foreach ($items as &$it) {
            $qty = $it['qty_received'] !== null ? (float) $it['qty_received'] : null;
            $it['stock_qty_preview'] = $qty === null ? null : Receiving::convert(
                $qty, null, $it['doc_unit'],
                $it['package_size'] !== null ? (float) $it['package_size'] : null,
                $it['package_unit']
            )['qty'];
        }
        unset($it);
        $receipt['items'] = $items;
        Http::json($receipt);
    }

    /** POST /stock/receipts { supplier_id } — entrada avulsa: sem pedido, sem documento. */
    public static function create(Request $req): void
    {
        $supplierId = $req->input()->integer('supplier_id', true);
        $supplier = Db::queryOne('SELECT id FROM suppliers WHERE id = ? AND org_id = ?', [$supplierId, $req->orgId()]);
        if (!$supplier) {
            throw HttpError::badRequest('Fornecedor informado não existe');
        }
        $id = Db::transaction(
            fn (PDO $pdo) => Receiving::createManual($pdo, $req->orgId(), $supplierId, $req->userId())
        );
        Http::json(self::find($id, $req->orgId()), 201);
    }

    /**
     * POST /stock/receipts/:id/items — lança uma linha na mão (entrada avulsa, ou item que o
     * fornecedor mandou a mais e não estava no pedido/documento original).
     * Body: { product_id, doc_name?, doc_unit?, qty_received, price_received? }.
     */
    public static function addLine(Request $req): void
    {
        $receipt = self::find($req->intParam('id'), $req->orgId());
        self::assertOpen($receipt);
        $in = $req->input();
        $productId = $in->integer('product_id', true);
        $qty = (float) $in->number('qty_received', true);
        if ($qty <= 0) {
            throw HttpError::badRequest('Quantidade deve ser maior que zero');
        }
        $product = Db::queryOne('SELECT name FROM products WHERE id = ? AND org_id = ?', [$productId, $req->orgId()]);
        if (!$product) {
            throw HttpError::notFound('Produto não encontrado');
        }
        $docName = $in->string('doc_name') ?: $product['name'];
        $price = $in->number('price_received');

        Db::transaction(fn (PDO $pdo) => Receiving::addLine(
            $pdo, $req->orgId(), (int) $receipt['id'], $productId,
            $docName, $in->string('doc_unit'), $qty, $price !== null ? (float) $price : null
        ));
        Http::json(self::find($receipt['id'], $req->orgId()), 201);
    }

    /**
     * PUT /stock/receipts/:id — edita o cabeçalho (fornecedor, dados da nota). Só em
     * aguardando: depois de conferida, o vínculo com o que já baixou estoque tem que parar quieto.
     * Body: { supplier_id?, doc_number?, doc_date?, doc_total? }.
     */
    public static function update(Request $req): void
    {
        $receipt = self::find($req->intParam('id'), $req->orgId());
        self::assertOpen($receipt);
        $in = $req->input();

        $fields = [];
        $values = [];
        if ($in->has('supplier_id')) {
            $supplierId = $in->integer('supplier_id', true);
            $supplier = Db::queryOne('SELECT id FROM suppliers WHERE id = ? AND org_id = ?', [$supplierId, $req->orgId()]);
            if (!$supplier) {
                throw HttpError::badRequest('Fornecedor informado não existe');
            }
            $fields[] = 'supplier_id = ?';
            $values[] = $supplierId;
        }
        foreach (['doc_number' => 'string', 'doc_date' => 'string', 'doc_total' => 'number'] as $col => $kind) {
            if ($in->has($col)) {
                $fields[] = "{$col} = ?";
                $values[] = $kind === 'number' ? $in->number($col) : $in->string($col);
            }
        }
        if (!$fields) {
            throw HttpError::badRequest('Nada para atualizar');
        }
        $values[] = $receipt['id'];
        Db::execute('UPDATE stock_receipts SET ' . implode(', ', $fields) . ' WHERE id = ?', $values);
        Http::json(self::find($receipt['id'], $req->orgId()));
    }

    /**
     * PUT /stock/receipts/:id/items/:lineId — conferência digitada (o caso da nota de papel).
     * Body: { qty_received?, price_received? }. null zera a linha.
     */
    public static function updateLine(Request $req): void
    {
        $receipt = self::find($req->intParam('id'), $req->orgId());
        self::assertOpen($receipt);
        $line = self::line($receipt['id'], $req->intParam('lineId'));
        $in = $req->input();

        $qty = $in->has('qty_received') ? $in->number('qty_received') : ($line['qty_received'] ?? null);
        $price = $in->has('price_received') ? $in->number('price_received') : ($line['price_received'] ?? null);
        if ($qty !== null && $qty < 0) {
            throw HttpError::badRequest('Quantidade não pode ser negativa');
        }
        if ($price !== null && $price < 0) {
            throw HttpError::badRequest('Preço não pode ser negativo');
        }

        Db::execute(
            'UPDATE stock_receipt_items SET qty_received = ?, price_received = ?, status = ? WHERE id = ?',
            [$qty, $price, self::statusFor($line, $qty, $price), $line['id']]
        );
        Http::json(['ok' => true]);
    }

    /** POST /stock/receipts/:id/items/:lineId/link { product_id } — resolve a pendência e aprende. */
    public static function linkLine(Request $req): void
    {
        $receipt = self::find($req->intParam('id'), $req->orgId());
        self::assertOpen($receipt);
        $line = self::line($receipt['id'], $req->intParam('lineId'));
        $productId = $req->input()->integer('product_id', true);

        Db::transaction(fn (PDO $pdo) => Receiving::linkLine($pdo, $req->orgId(), (int) $line['id'], $productId));
        Http::json(['ok' => true]);
    }

    /** POST /stock/receipts/:id/confirm — dá entrada no estoque e fecha o pedido. */
    public static function confirm(Request $req): void
    {
        $receipt = self::find($req->intParam('id'), $req->orgId());
        $result = Db::transaction(
            fn (PDO $pdo) => Receiving::confirm($pdo, $req->orgId(), (int) $receipt['id'], $req->userId())
        );
        Http::json(['ok' => true] + $result);
    }

    /** POST /stock/receipts/:id/cancel — some da fila sem mexer no estoque. */
    public static function cancel(Request $req): void
    {
        $receipt = self::find($req->intParam('id'), $req->orgId());
        self::assertOpen($receipt);
        Db::execute('UPDATE stock_receipts SET status = ? WHERE id = ?', [Receiving::STATUS_CANCELADA, $receipt['id']]);
        Http::json(['ok' => true]);
    }

    /**
     * POST /stock/receipts/:id/scan — foto/PDF da nota do fornecedor lida pela IA.
     *
     * Devolve as linhas extraídas como RASCUNHO, sem gravar nada: a IA sugere, quem confirma
     * é o conferente. Mesmo caminho que as cotações já usam (AiExtractor + Ollama local).
     */
    public static function scan(Request $req): void
    {
        $receipt = self::find($req->intParam('id'), $req->orgId());
        self::assertOpen($receipt);
        $file = $req->file();
        if (!$file) {
            throw HttpError::badRequest('Envie a foto ou o PDF da nota (campo "file")');
        }
        $lines = AiExtractor::deliveryNote(
            (string) file_get_contents($file['tmp_name']),
            (string) ($file['type'] ?? 'application/octet-stream')
        );
        Http::json(['receipt_id' => (int) $receipt['id'], 'lines' => $lines]);
    }

    /**
     * POST /stock/receipts/:id/apply-scan — grava as linhas conferidas do rascunho da IA.
     * Body: { lines: [{ name, unit?, quantity, unit_price?, code? }] }.
     */
    public static function applyScan(Request $req): void
    {
        $receipt = self::find($req->intParam('id'), $req->orgId());
        self::assertOpen($receipt);
        $lines = [];
        foreach ($req->input()->array('lines', true) as $l) {
            $name = trim((string) ($l['name'] ?? ''));
            $qty = (float) ($l['quantity'] ?? 0);
            if ($name === '' || $qty <= 0) {
                continue;
            }
            $lines[] = [
                'code' => isset($l['code']) ? trim((string) $l['code']) : null,
                'ean' => null,
                'name' => $name,
                'unit' => isset($l['unit']) ? trim((string) $l['unit']) : null,
                'quantity' => $qty,
                'unit_price' => (float) ($l['unit_price'] ?? 0),
            ];
        }
        if (!$lines) {
            throw HttpError::badRequest('Nenhuma linha válida para lançar');
        }

        Db::transaction(fn (PDO $pdo) => Receiving::fromDocument($pdo, $req->orgId(), [
            'supplier_id' => $receipt['supplier_id'] !== null ? (int) $receipt['supplier_id'] : null,
            'source' => 'nota_ia',
            'number' => $req->input()->string('doc_number'),
            'key' => null,
            'date' => null,
            'total' => null,
            'nfe_import_id' => null,
            'lines' => $lines,
        ], $req->userId()));

        Http::json(['ok' => true, 'lines' => count($lines)]);
    }

    // ---- helpers ----

    private static function find(int $id, int $orgId): array
    {
        $r = Db::queryOne(
            'SELECT r.*, s.name AS supplier_name, o.status AS order_status
               FROM stock_receipts r
               LEFT JOIN suppliers s ON s.id = r.supplier_id
               LEFT JOIN orders o ON o.id = r.order_id
              WHERE r.id = ? AND r.org_id = ?',
            [$id, $orgId]
        );
        if (!$r) {
            throw HttpError::notFound('Entrada não encontrada');
        }
        return $r;
    }

    private static function line(int $receiptId, int $lineId): array
    {
        $l = Db::queryOne('SELECT * FROM stock_receipt_items WHERE id = ? AND receipt_id = ?', [$lineId, $receiptId]);
        if (!$l) {
            throw HttpError::notFound('Linha da entrada não encontrada');
        }
        return $l;
    }

    private static function assertOpen(array $receipt): void
    {
        if ($receipt['status'] !== Receiving::STATUS_AGUARDANDO) {
            throw HttpError::badRequest('Esta entrada já foi conferida ou cancelada');
        }
    }

    /** Mesma régua de divergência do serviço, aplicada à conferência digitada. */
    private static function statusFor(array $line, ?float $qty, ?float $price): string
    {
        if ($line['product_id'] === null) {
            return Receiving::LINE_PENDENTE;
        }
        if ($qty === null) {
            return Receiving::LINE_OK;
        }
        if ($qty <= 0) {
            return Receiving::LINE_NAO_VEIO;
        }
        $expQty = $line['qty_expected'] !== null ? (float) $line['qty_expected'] : null;
        $expPrice = $line['price_expected'] !== null ? (float) $line['price_expected'] : null;
        $diverge = ($expQty !== null && abs($qty - $expQty) > 0.0005)
            || ($expPrice !== null && $price !== null && abs($price - $expPrice) > 0.0005);
        return $diverge ? Receiving::LINE_DIVERGENTE : Receiving::LINE_OK;
    }
}
