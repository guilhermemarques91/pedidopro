<?php

namespace App\Modules\Products;

use App\Core\Db;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Request;

/** Impressoras de produção (ex.: Cozinha, Bar). Usadas p/ direcionar impressão de pedidos. */
final class PrintersController
{
    public static function list(Request $req): void
    {
        Http::json(Db::query(
            'SELECT id, name, sort_order FROM production_printers
              WHERE org_id = ? AND active = 1
              ORDER BY sort_order, name',
            [$req->orgId()]
        ));
    }

    public static function create(Request $req): void
    {
        $in = $req->input();
        $name = $in->requireString('name', 1, 80);
        Db::execute(
            'INSERT INTO production_printers (org_id, name, sort_order) VALUES (?, ?, ?)',
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
        Db::execute('UPDATE production_printers SET ' . implode(', ', $fields) . ' WHERE id = ? AND org_id = ?', $values);
        Http::json(self::find($id, $req->orgId()));
    }

    public static function remove(Request $req): void
    {
        $id = $req->intParam('id');
        self::find($id, $req->orgId());
        // products.production_printer_id tem ON DELETE SET NULL.
        Db::execute('DELETE FROM production_printers WHERE id = ? AND org_id = ?', [$id, $req->orgId()]);
        Http::noContent();
    }

    private static function find(int $id, int $orgId): array
    {
        $row = Db::queryOne(
            'SELECT id, name, sort_order FROM production_printers WHERE id = ? AND org_id = ?',
            [$id, $orgId]
        );
        if (!$row) {
            throw HttpError::notFound('Impressora não encontrada');
        }
        return $row;
    }
}
