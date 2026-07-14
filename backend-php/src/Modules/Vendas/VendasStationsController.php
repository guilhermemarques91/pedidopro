<?php

namespace App\Modules\Vendas;

use App\Core\Db;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Request;

/** Cadastro fixo de mesas e comandas — evita digitação livre e mostra ocupação. */
final class VendasStationsController
{
    public static function list(Request $req): void
    {
        $where = ['s.org_id = ?'];
        $params = [$req->orgId()];
        if (($kind = $req->query('kind')) !== null) {
            $where[] = 's.kind = ?';
            $params[] = $kind;
        }
        if ($req->query('includeInactive') !== 'true') {
            $where[] = 's.active = 1';
        }
        $clause = implode(' AND ', $where);
        Http::json(Db::query(
            "SELECT s.*,
                    EXISTS(
                      SELECT 1 FROM sales o
                       WHERE o.station_id = s.id AND o.status NOT IN ('completed', 'cancelled')
                    ) AS has_open_sale
               FROM sales_stations s
              WHERE {$clause}
              ORDER BY s.kind, s.number",
            $params
        ));
    }

    public static function create(Request $req): void
    {
        $in = $req->input();
        $kind = $in->enum('kind', ['mesa', 'comanda'], true);
        $number = $in->requireString('number', 1, 10);
        $row = Db::insertReturning(
            'INSERT INTO sales_stations (org_id, kind, number, label) VALUES (?, ?, ?, ?)',
            [$req->orgId(), $kind, $number, $in->string('label')],
            'sales_stations'
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
        if ($in->has('number')) {
            $fields[] = 'number = ?';
            $values[] = $in->requireString('number', 1, 10);
        }
        if ($in->has('label')) {
            $fields[] = 'label = ?';
            $values[] = $in->string('label');
        }
        if ($in->has('active')) {
            $fields[] = 'active = ?';
            $values[] = $in->boolean('active', true) ? 1 : 0;
        }
        if (!$fields) {
            throw HttpError::badRequest('Nada para atualizar');
        }
        $values[] = $id;
        Db::execute('UPDATE sales_stations SET ' . implode(', ', $fields) . ' WHERE id = ?', $values);
        Http::json(self::find($id, $req->orgId()));
    }

    public static function remove(Request $req): void
    {
        $id = $req->intParam('id');
        self::find($id, $req->orgId());
        $open = Db::queryOne(
            "SELECT id FROM sales WHERE station_id = ? AND status NOT IN ('completed', 'cancelled')",
            [$id]
        );
        if ($open) {
            throw HttpError::badRequest('Esta mesa/comanda tem um pedido em aberto');
        }
        Db::execute('UPDATE sales_stations SET active = 0 WHERE id = ?', [$id]);
        Http::noContent();
    }

    private static function find(int $id, int $orgId): array
    {
        $row = Db::queryOne('SELECT * FROM sales_stations WHERE id = ? AND org_id = ?', [$id, $orgId]);
        if (!$row) {
            throw HttpError::notFound('Mesa/comanda não encontrada');
        }
        return $row;
    }
}
