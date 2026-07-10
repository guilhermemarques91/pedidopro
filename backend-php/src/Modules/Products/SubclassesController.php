<?php

namespace App\Modules\Products;

use App\Core\Db;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Request;

/** Sub-classes de item (filhas de uma Classe = product_type). Ex.: Refeição -> Executivo. */
final class SubclassesController
{
    public static function list(Request $req): void
    {
        $where = ['sc.org_id = ?', 'sc.active = 1'];
        $params = [$req->orgId()];
        $v = $req->query('type_id');
        if ($v !== null && ctype_digit($v)) {
            $where[] = 'sc.type_id = ?';
            $params[] = (int) $v;
        }
        Http::json(Db::query(
            'SELECT sc.id, sc.name, sc.type_id, sc.sort_order, t.name AS type_name
               FROM product_subclasses sc
               LEFT JOIN product_types t ON t.id = sc.type_id
              WHERE ' . implode(' AND ', $where) . '
              ORDER BY sc.sort_order, sc.name',
            $params
        ));
    }

    public static function create(Request $req): void
    {
        $in = $req->input();
        $name = $in->requireString('name', 1, 80);
        Db::execute(
            'INSERT INTO product_subclasses (org_id, type_id, name, sort_order) VALUES (?, ?, ?, ?)',
            [$req->orgId(), $in->integer('type_id'), $name, $in->integer('sort_order') ?? 0]
        );
        Http::json(self::find(Db::lastInsertId(), $req->orgId()), 201);
    }

    public static function update(Request $req): void
    {
        $id = $req->intParam('id');
        self::find($id, $req->orgId());
        $in = $req->input();
        $fields = [];
        $values = [];
        if ($in->has('name')) {
            $fields[] = 'name = ?';
            $values[] = $in->requireString('name', 1, 80);
        }
        if ($in->has('type_id')) {
            $fields[] = 'type_id = ?';
            $values[] = $in->integer('type_id');
        }
        if ($in->has('sort_order')) {
            $fields[] = 'sort_order = ?';
            $values[] = $in->integer('sort_order') ?? 0;
        }
        if (!$fields) {
            throw HttpError::badRequest('Nada para atualizar');
        }
        $values[] = $id;
        $values[] = $req->orgId();
        Db::execute('UPDATE product_subclasses SET ' . implode(', ', $fields) . ' WHERE id = ? AND org_id = ?', $values);
        Http::json(self::find($id, $req->orgId()));
    }

    public static function remove(Request $req): void
    {
        $id = $req->intParam('id');
        self::find($id, $req->orgId());
        // products.sub_classe_id tem ON DELETE SET NULL — produtos ficam sem sub-classe.
        Db::execute('DELETE FROM product_subclasses WHERE id = ? AND org_id = ?', [$id, $req->orgId()]);
        Http::noContent();
    }

    private static function find(int $id, int $orgId): array
    {
        $row = Db::queryOne(
            'SELECT sc.id, sc.name, sc.type_id, sc.sort_order, t.name AS type_name
               FROM product_subclasses sc
               LEFT JOIN product_types t ON t.id = sc.type_id
              WHERE sc.id = ? AND sc.org_id = ?',
            [$id, $orgId]
        );
        if (!$row) {
            throw HttpError::notFound('Sub-classe não encontrada');
        }
        return $row;
    }
}
