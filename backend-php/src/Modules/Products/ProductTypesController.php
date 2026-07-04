<?php

namespace App\Modules\Products;

use App\Core\Db;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Request;

/** Tipos de produto (eixo gerenciável do cadastro: matéria-prima, cardápio, bebida...). */
final class ProductTypesController
{
    public static function list(Request $req): void
    {
        Http::json(Db::query(
            'SELECT id, name, sort_order FROM product_types WHERE org_id = ? AND active = 1 ORDER BY sort_order, name',
            [$req->orgId()]
        ));
    }

    public static function create(Request $req): void
    {
        $in = $req->input();
        $name = $in->requireString('name', 1, 80);
        if (Db::queryOne('SELECT id FROM product_types WHERE org_id = ? AND name = ?', [$req->orgId(), $name])) {
            throw HttpError::badRequest('Já existe um tipo com este nome');
        }
        Db::execute(
            'INSERT INTO product_types (org_id, name, sort_order) VALUES (?, ?, ?)',
            [$req->orgId(), $name, $in->integer('sort_order') ?? 0]
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
        if ($in->has('sort_order')) {
            $fields[] = 'sort_order = ?';
            $values[] = $in->integer('sort_order') ?? 0;
        }
        if (!$fields) {
            throw HttpError::badRequest('Nada para atualizar');
        }
        $values[] = $id;
        $values[] = $req->orgId();
        Db::execute('UPDATE product_types SET ' . implode(', ', $fields) . ' WHERE id = ? AND org_id = ?', $values);
        Http::json(self::find($id, $req->orgId()));
    }

    public static function remove(Request $req): void
    {
        $id = $req->intParam('id');
        self::find($id, $req->orgId());
        // products.type_id tem ON DELETE SET NULL — produtos ficam sem tipo, não somem.
        Db::execute('DELETE FROM product_types WHERE id = ? AND org_id = ?', [$id, $req->orgId()]);
        Http::noContent();
    }

    private static function find(int $id, int $orgId): array
    {
        $row = Db::queryOne('SELECT id, name, sort_order FROM product_types WHERE id = ? AND org_id = ?', [$id, $orgId]);
        if (!$row) {
            throw HttpError::notFound('Tipo não encontrado');
        }
        return $row;
    }
}
