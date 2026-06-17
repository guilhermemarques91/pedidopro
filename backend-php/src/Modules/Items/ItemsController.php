<?php

namespace App\Modules\Items;

use App\Core\Db;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Input;
use App\Core\Request;

final class ItemsController
{
    private const COLUMNS = ['supplier_id', 'product_id', 'name', 'unit', 'package_size', 'package_unit', 'base_price'];

    public static function list(Request $req): void
    {
        $conditions = [];
        $params = [];
        if ($req->query('includeInactive') !== 'true') {
            $conditions[] = 'i.active = 1';
        }
        if ($req->query('supplier_id') !== null) {
            $conditions[] = 'i.supplier_id = ?';
            $params[] = (int) $req->query('supplier_id');
        }
        $where = $conditions ? 'WHERE ' . implode(' AND ', $conditions) : '';
        Http::json(Db::query(
            "SELECT i.*, s.name AS supplier_name, p.name AS product_name
               FROM items i
               JOIN suppliers s ON s.id = i.supplier_id
               LEFT JOIN products p ON p.id = i.product_id
               {$where}
               ORDER BY s.name, i.name",
            $params
        ));
    }

    public static function getById(Request $req): void
    {
        Http::json(self::find($req->intParam('id')));
    }

    public static function create(Request $req): void
    {
        $in = $req->input();
        $supplierId = $in->integer('supplier_id', true);
        $in->requireString('name');
        $in->requireString('unit');
        self::assertSupplier($supplierId);

        $values = array_map(static fn ($c) => self::col($in, $c), self::COLUMNS);
        $placeholders = implode(', ', array_fill(0, count(self::COLUMNS), '?'));
        $row = Db::insertReturning(
            'INSERT INTO items (' . implode(', ', self::COLUMNS) . ") VALUES ({$placeholders})",
            $values,
            'items'
        );
        Http::json($row, 201);
    }

    public static function update(Request $req): void
    {
        $id = $req->intParam('id');
        self::find($id);
        $in = $req->input();
        if ($in->has('supplier_id')) {
            self::assertSupplier($in->integer('supplier_id', true));
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
        Http::json(self::find($id));
    }

    public static function remove(Request $req): void
    {
        $id = $req->intParam('id');
        self::find($id);
        Db::execute('UPDATE items SET active = 0 WHERE id = ?', [$id]);
        Http::noContent();
    }

    private static function col(Input $in, string $col): mixed
    {
        return match ($col) {
            'supplier_id', 'product_id' => $in->integer($col),
            'package_size', 'base_price' => $in->number($col),
            default => $in->string($col),
        };
    }

    private static function assertSupplier(int $supplierId): void
    {
        $sup = Db::queryOne('SELECT id FROM suppliers WHERE id = ? AND active = 1', [$supplierId]);
        if (!$sup) {
            throw HttpError::badRequest('Fornecedor informado não existe ou está inativo');
        }
    }

    private static function find(int $id): array
    {
        $row = Db::queryOne(
            'SELECT i.*, s.name AS supplier_name, p.name AS product_name
               FROM items i
               JOIN suppliers s ON s.id = i.supplier_id
               LEFT JOIN products p ON p.id = i.product_id
              WHERE i.id = ?',
            [$id]
        );
        if (!$row) {
            throw HttpError::notFound('Item não encontrado');
        }
        return $row;
    }
}
