<?php

namespace App\Modules\Categories;

use App\Core\Db;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Request;

final class CategoriesController
{
    public static function list(Request $req): void
    {
        $active = $req->query('includeInactive') === 'true' ? '' : ' AND active = 1';
        Http::json(Db::query(
            "SELECT * FROM categories WHERE org_id = ?{$active} ORDER BY name",
            [$req->orgId()]
        ));
    }

    public static function getById(Request $req): void
    {
        Http::json(self::find($req->intParam('id'), $req->orgId()));
    }

    public static function create(Request $req): void
    {
        $in = $req->input();
        $name = $in->requireString('name');
        $row = Db::insertReturning(
            'INSERT INTO categories (org_id, name, color, icon) VALUES (?, ?, ?, ?)',
            [$req->orgId(), $name, $in->string('color'), $in->string('icon')],
            'categories'
        );
        Http::json($row, 201);
    }

    public static function update(Request $req): void
    {
        $id = $req->intParam('id');
        self::find($id, $req->orgId());
        $in = $req->input();
        $fields = [];
        $values = [];
        foreach (['name', 'color', 'icon'] as $col) {
            if ($in->has($col)) {
                $fields[] = "{$col} = ?";
                $values[] = $in->string($col);
            }
        }
        if (!$fields) {
            throw HttpError::badRequest('Nada para atualizar');
        }
        $values[] = $id;
        Db::execute('UPDATE categories SET ' . implode(', ', $fields) . ' WHERE id = ?', $values);
        Http::json(self::find($id, $req->orgId()));
    }

    public static function remove(Request $req): void
    {
        $id = $req->intParam('id');
        self::find($id, $req->orgId());
        Db::execute('UPDATE categories SET active = 0 WHERE id = ?', [$id]);
        Http::noContent();
    }

    /** Gate de tenant: só devolve a linha se pertencer à org do usuário. */
    private static function find(int $id, int $orgId): array
    {
        $row = Db::queryOne('SELECT * FROM categories WHERE id = ? AND org_id = ?', [$id, $orgId]);
        if (!$row) {
            throw HttpError::notFound('Categoria não encontrada');
        }
        return $row;
    }
}
