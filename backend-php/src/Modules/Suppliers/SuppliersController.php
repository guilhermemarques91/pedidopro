<?php

namespace App\Modules\Suppliers;

use App\Core\Db;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Input;
use App\Core\Request;

final class SuppliersController
{
    private const COLUMNS = [
        'name', 'contact_name', 'phone', 'email', 'category_id',
        'order_type', 'portal_url', 'whatsapp_number', 'notes',
    ];

    public static function list(Request $req): void
    {
        $where = $req->query('includeInactive') === 'true' ? '' : 'WHERE s.active = 1';
        Http::json(Db::query(
            "SELECT s.*, c.name AS category_name
               FROM suppliers s
               LEFT JOIN categories c ON c.id = s.category_id
               {$where}
               ORDER BY s.name"
        ));
    }

    public static function getById(Request $req): void
    {
        Http::json(self::find($req->intParam('id')));
    }

    public static function create(Request $req): void
    {
        $in = $req->input();
        $in->requireString('name');
        $in->enum('order_type', ['portal', 'whatsapp'], true);
        self::assertCategory($in);

        $values = array_map(static fn ($c) => self::col($in, $c), self::COLUMNS);
        $placeholders = implode(', ', array_fill(0, count(self::COLUMNS), '?'));
        $row = Db::insertReturning(
            'INSERT INTO suppliers (' . implode(', ', self::COLUMNS) . ") VALUES ({$placeholders})",
            $values,
            'suppliers'
        );
        Http::json($row, 201);
    }

    public static function update(Request $req): void
    {
        $id = $req->intParam('id');
        self::find($id);
        $in = $req->input();
        if ($in->has('category_id')) {
            self::assertCategory($in);
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
        Db::execute('UPDATE suppliers SET ' . implode(', ', $fields) . ' WHERE id = ?', $values);
        Http::json(self::find($id));
    }

    public static function remove(Request $req): void
    {
        $id = $req->intParam('id');
        self::find($id);
        Db::execute('UPDATE suppliers SET active = 0 WHERE id = ?', [$id]);
        Http::noContent();
    }

    private static function col(Input $in, string $col): mixed
    {
        if ($col === 'category_id') {
            return $in->integer($col);
        }
        return $in->string($col);
    }

    private static function assertCategory(Input $in): void
    {
        $catId = $in->integer('category_id');
        if ($catId === null) {
            return;
        }
        $cat = Db::queryOne('SELECT id FROM categories WHERE id = ? AND active = 1', [$catId]);
        if (!$cat) {
            throw HttpError::badRequest('Categoria informada não existe ou está inativa');
        }
    }

    private static function find(int $id): array
    {
        $row = Db::queryOne(
            'SELECT s.*, c.name AS category_name
               FROM suppliers s LEFT JOIN categories c ON c.id = s.category_id
              WHERE s.id = ?',
            [$id]
        );
        if (!$row) {
            throw HttpError::notFound('Fornecedor não encontrado');
        }
        return $row;
    }
}
