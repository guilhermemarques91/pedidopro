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
        $sql = $req->query('includeInactive') === 'true'
            ? 'SELECT * FROM categories ORDER BY name'
            : 'SELECT * FROM categories WHERE active = 1 ORDER BY name';
        Http::json(Db::query($sql));
    }

    public static function getById(Request $req): void
    {
        Http::json(self::find($req->intParam('id')));
    }

    public static function create(Request $req): void
    {
        $in = $req->input();
        $name = $in->requireString('name');
        $row = Db::insertReturning(
            'INSERT INTO categories (name, color, icon) VALUES (?, ?, ?)',
            [$name, $in->string('color'), $in->string('icon')],
            'categories'
        );
        Http::json($row, 201);
    }

    public static function update(Request $req): void
    {
        $id = $req->intParam('id');
        self::find($id);
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
        Http::json(self::find($id));
    }

    public static function remove(Request $req): void
    {
        $id = $req->intParam('id');
        self::find($id);
        Db::execute('UPDATE categories SET active = 0 WHERE id = ?', [$id]);
        Http::noContent();
    }

    private static function find(int $id): array
    {
        $row = Db::queryOne('SELECT * FROM categories WHERE id = ?', [$id]);
        if (!$row) {
            throw HttpError::notFound('Categoria não encontrada');
        }
        return $row;
    }
}
