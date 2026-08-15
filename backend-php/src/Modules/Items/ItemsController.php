<?php

namespace App\Modules\Items;

use App\Core\Db;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Input;
use App\Core\Request;
use PDO;

final class ItemsController
{
    private const COLUMNS = [
        'supplier_id', 'product_id', 'name', 'supplier_code', 'unit', 'package_size', 'package_unit', 'base_price',
        // Dados tributários de entrada
        'ncm', 'cest', 'cfop', 'origem', 'cst_csosn', 'gtin',
    ];

    public static function list(Request $req): void
    {
        $supplierId = $req->query('supplier_id') !== null ? (int) $req->query('supplier_id') : null;
        $includeInactive = $req->query('includeInactive') === 'true';

        $joinParams = [];
        $join = '';
        $priceSel = 'i.base_price, i.supplier_code';
        $conditions = ['i.org_id = ?'];
        $whereParams = [$req->orgId()];

        if (!$includeInactive) {
            $conditions[] = 'i.active = 1';
        }
        // Filtros por classe (tipo) e categoria: via produto vinculado ao item.
        foreach (['type_id' => 'p.type_id', 'category_id' => 'p.category_id'] as $q => $col) {
            $v = $req->query($q);
            if ($v !== null && ctype_digit((string) $v)) {
                $conditions[] = "{$col} = ?";
                $whereParams[] = (int) $v;
            }
        }
        if ($supplierId !== null) {
            // Disponível ao fornecedor = item de origem OU vínculo ativo em item_suppliers.
            // Quando filtrado, preço/código vêm do vínculo do fornecedor (fallback p/ os do item).
            $join = 'LEFT JOIN item_suppliers x ON x.item_id = i.id AND x.supplier_id = ? AND x.active = 1';
            $joinParams[] = $supplierId;
            $priceSel = 'COALESCE(x.base_price, i.base_price) AS base_price, COALESCE(x.supplier_code, i.supplier_code) AS supplier_code';
            $conditions[] = '(i.supplier_id = ? OR x.id IS NOT NULL)';
            $whereParams[] = $supplierId;
        }
        $where = 'WHERE ' . implode(' AND ', $conditions);
        $params = array_merge($joinParams, $whereParams); // ordem = posição dos ? no SQL

        Http::json(Db::query(
            "SELECT i.id, i.supplier_id, i.product_id, i.name, i.unit,
                    i.package_size, i.package_unit, i.active, i.created_at,
                    COALESCE(s.name, (
                        SELECT su.name FROM item_suppliers xs JOIN suppliers su ON su.id = xs.supplier_id
                         WHERE xs.item_id = i.id AND xs.active = 1 ORDER BY su.name LIMIT 1
                    )) AS supplier_name,
                    p.name AS product_name,
                    (SELECT COUNT(*) FROM item_suppliers xs WHERE xs.item_id = i.id AND xs.active = 1) AS supplier_count,
                    {$priceSel}
               FROM items i
               LEFT JOIN suppliers s ON s.id = i.supplier_id
               LEFT JOIN products p ON p.id = i.product_id
               {$join}
               {$where}
               ORDER BY supplier_name, i.name" . self::pagination($req),
            $params
        ));
    }

    public static function getById(Request $req): void
    {
        $id = $req->intParam('id');
        $item = self::find($id, $req->orgId());
        $item['suppliers'] = self::suppliersOf($id);
        Http::json($item);
    }

    /**
     * GET /items/:id/price-history — evolução de preço por fornecedor, a partir do que
     * price_history acumula a cada cotação fechada (QuotationsController::close). Ninguém lia
     * isso até agora; os dados já existiam.
     *
     * Quando o item tem produto vinculado, o histórico junta TODOS os itens (SKUs de
     * fornecedores diferentes) com o mesmo product_id — é o mesmo agrupamento que o
     * comparativo de cotação já usa, então "histórico do produto" e "comparativo da cotação"
     * nunca discordam sobre o que é o mesmo insumo.
     */
    public static function priceHistory(Request $req): void
    {
        $item = self::find($req->intParam('id'), $req->orgId());
        $productId = $item['product_id'] !== null ? (int) $item['product_id'] : null;

        $points = $productId !== null
            ? Db::query(
                'SELECT ph.supplier_id, s.name AS supplier_name, ph.price, ph.recorded_at, ph.quotation_id,
                        i2.id AS item_id, i2.name AS item_name
                   FROM price_history ph
                   JOIN items i2 ON i2.id = ph.item_id
                   JOIN suppliers s ON s.id = ph.supplier_id
                  WHERE i2.org_id = ? AND i2.product_id = ?
                  ORDER BY ph.recorded_at ASC',
                [$req->orgId(), $productId]
            )
            : Db::query(
                'SELECT ph.supplier_id, s.name AS supplier_name, ph.price, ph.recorded_at, ph.quotation_id,
                        i2.id AS item_id, i2.name AS item_name
                   FROM price_history ph
                   JOIN items i2 ON i2.id = ph.item_id
                   JOIN suppliers s ON s.id = ph.supplier_id
                  WHERE i2.org_id = ? AND i2.id = ?
                  ORDER BY ph.recorded_at ASC',
                [$req->orgId(), $item['id']]
            );

        Http::json([
            'item_id' => (int) $item['id'],
            'product_id' => $productId,
            'product_name' => $item['product_name'] ?? null,
            'item_name' => $item['name'],
            'points' => $points,
        ]);
    }

    public static function create(Request $req): void
    {
        $in = $req->input();
        // Fornecedor é opcional: o item é catálogo puro e ganha fornecedores em item_suppliers
        // (via lançamento da NF-e de entrada ou manualmente na tela do item).
        $supplierId = $in->integer('supplier_id');
        $in->requireString('name');
        $in->requireString('unit');
        if ($supplierId !== null) {
            self::assertSupplier($supplierId, $req->orgId());
        }

        $values = array_map(static fn ($c) => self::col($in, $c), self::COLUMNS);
        $placeholders = implode(', ', array_fill(0, count(self::COLUMNS), '?'));
        $supplierCode = $in->string('supplier_code');
        $basePrice = $in->number('base_price');

        $values[] = $req->orgId();
        $id = Db::transaction(function (PDO $pdo) use ($values, $placeholders, $supplierId, $supplierCode, $basePrice) {
            $pdo->prepare('INSERT INTO items (' . implode(', ', self::COLUMNS) . ", org_id) VALUES ({$placeholders}, ?)")
                ->execute($values);
            $itemId = (int) $pdo->lastInsertId();
            // Vínculo de origem em item_suppliers só quando um fornecedor foi informado.
            if ($supplierId !== null) {
                $pdo->prepare('INSERT INTO item_suppliers (item_id, supplier_id, supplier_code, base_price) VALUES (?, ?, ?, ?)')
                    ->execute([$itemId, $supplierId, $supplierCode, $basePrice]);
            }
            return $itemId;
        });

        $item = self::find($id, $req->orgId());
        $item['suppliers'] = self::suppliersOf($id);
        Http::json($item, 201);
    }

    public static function update(Request $req): void
    {
        $id = $req->intParam('id');
        self::find($id, $req->orgId());
        $in = $req->input();
        if ($in->has('supplier_id')) {
            $sid = $in->integer('supplier_id');
            if ($sid !== null) {
                self::assertSupplier($sid, $req->orgId());
            }
        }
        $fields = [];
        $values = [];
        foreach (self::COLUMNS as $col) {
            if ($in->has($col)) {
                $fields[] = "{$col} = ?";
                $values[] = self::col($in, $col);
            }
        }
        if (!$fields) {
            throw HttpError::badRequest('Nada para atualizar');
        }
        $values[] = $id;
        Db::execute('UPDATE items SET ' . implode(', ', $fields) . ' WHERE id = ?', $values);
        // Mantém o vínculo de origem alinhado a preço/código do item.
        Db::execute(
            'UPDATE item_suppliers x JOIN items i ON i.id = x.item_id AND i.supplier_id = x.supplier_id
                SET x.supplier_code = i.supplier_code, x.base_price = i.base_price
              WHERE x.item_id = ?',
            [$id]
        );
        $item = self::find($id, $req->orgId());
        $item['suppliers'] = self::suppliersOf($id);
        Http::json($item);
    }

    public static function remove(Request $req): void
    {
        $id = $req->intParam('id');
        self::find($id, $req->orgId());
        Db::execute('UPDATE items SET active = 0 WHERE id = ?', [$id]);
        Http::noContent();
    }

    /** Vincula um item a um fornecedor (além do de origem). POST /items/:id/suppliers */
    public static function linkSupplier(Request $req): void
    {
        $itemId = $req->intParam('id');
        self::find($itemId, $req->orgId());
        $in = $req->input();
        $supplierId = $in->integer('supplier_id', true);
        self::assertSupplier($supplierId, $req->orgId());

        Db::execute(
            'INSERT INTO item_suppliers (item_id, supplier_id, supplier_code, base_price)
                  VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE active = 1,
                  supplier_code = VALUES(supplier_code),
                  base_price = VALUES(base_price)',
            [$itemId, $supplierId, $in->string('supplier_code'), $in->number('base_price')]
        );

        $item = self::find($itemId, $req->orgId());
        $item['suppliers'] = self::suppliersOf($itemId);
        Http::json($item, 201);
    }

    /** Remove o vínculo de um fornecedor (não o de origem). DELETE /items/:id/suppliers/:supplierId */
    public static function unlinkSupplier(Request $req): void
    {
        $itemId = $req->intParam('id');
        $supplierId = $req->intParam('supplierId');
        $item = self::find($itemId, $req->orgId());
        Db::execute('DELETE FROM item_suppliers WHERE item_id = ? AND supplier_id = ?', [$itemId, $supplierId]);
        // Se era o fornecedor de origem (legado), desvincula do item para virar catálogo puro.
        if ((int) $item['supplier_id'] === $supplierId) {
            Db::execute('UPDATE items SET supplier_id = NULL WHERE id = ?', [$itemId]);
        }
        $item['suppliers'] = self::suppliersOf($itemId);
        Http::json($item);
    }

    private static function col(Input $in, string $col): mixed
    {
        return match ($col) {
            'supplier_id', 'product_id' => $in->integer($col),
            'package_size', 'base_price' => $in->number($col),
            default => $in->string($col),
        };
    }

    private static function assertSupplier(int $supplierId, int $orgId): void
    {
        $sup = Db::queryOne('SELECT id FROM suppliers WHERE id = ? AND active = 1 AND org_id = ?', [$supplierId, $orgId]);
        if (!$sup) {
            throw HttpError::badRequest('Fornecedor informado não existe ou está inativo');
        }
    }

    /** Fornecedores vinculados a um item (origem + extras). */
    private static function suppliersOf(int $itemId): array
    {
        return Db::query(
            'SELECT x.supplier_id, su.name AS supplier_name, x.supplier_code, x.base_price, x.active
               FROM item_suppliers x
               JOIN suppliers su ON su.id = x.supplier_id
              WHERE x.item_id = ? AND x.active = 1
              ORDER BY su.name',
            [$itemId]
        );
    }

    /** Gate de tenant: só devolve a linha se pertencer à org do usuário. */
    private static function find(int $id, int $orgId): array
    {
        $row = Db::queryOne(
            'SELECT i.*, s.name AS supplier_name, p.name AS product_name,
                    (SELECT COUNT(*) FROM item_suppliers xs WHERE xs.item_id = i.id AND xs.active = 1) AS supplier_count
               FROM items i
               LEFT JOIN suppliers s ON s.id = i.supplier_id
               LEFT JOIN products p ON p.id = i.product_id
              WHERE i.id = ? AND i.org_id = ?',
            [$id, $orgId]
        );
        if (!$row) {
            throw HttpError::notFound('Item não encontrado');
        }
        return $row;
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
