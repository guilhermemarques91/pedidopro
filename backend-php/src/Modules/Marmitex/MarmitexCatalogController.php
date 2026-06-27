<?php

namespace App\Modules\Marmitex;

use App\Core\Db;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Request;

/**
 * Cadastro gerencial do cardápio (tamanhos, proteínas, acompanhamentos, observações).
 * Preço fica apenas no tamanho (decisão de negócio). CRUD restrito a admin; a leitura
 * do catálogo (catalog) é liberada à empresa para montar o formulário do pedido.
 */
final class MarmitexCatalogController
{
    private const TABLES = [
        'sizes' => 'marmitex_sizes',
        'proteins' => 'marmitex_proteins',
        'sides' => 'marmitex_sides',
        'observations' => 'marmitex_observations',
    ];

    /** Catálogo completo (todas as listas) para a tela de pedido e o cadastro. */
    public static function catalog(Request $req): void
    {
        Http::json([
            'sizes' => Db::query('SELECT * FROM marmitex_sizes ORDER BY sort_order, name'),
            'proteins' => Db::query('SELECT * FROM marmitex_proteins ORDER BY sort_order, name'),
            'sides' => Db::query('SELECT * FROM marmitex_sides ORDER BY sort_order, name'),
            'observations' => Db::query('SELECT * FROM marmitex_observations ORDER BY sort_order, name'),
        ]);
    }

    public static function create(Request $req): void
    {
        $table = self::table($req);
        $in = $req->input();
        $name = $in->requireString('name');
        $sort = $in->integer('sort_order') ?? 0;

        if ($table === 'marmitex_sizes') {
            $price = (float) ($in->number('price') ?? 0);
            $row = Db::insertReturning(
                "INSERT INTO {$table} (name, price, sort_order) VALUES (?, ?, ?)",
                [$name, $price, $sort],
                $table
            );
        } else {
            $row = Db::insertReturning(
                "INSERT INTO {$table} (name, sort_order) VALUES (?, ?)",
                [$name, $sort],
                $table
            );
        }
        Http::json($row, 201);
    }

    public static function update(Request $req): void
    {
        $table = self::table($req);
        $id = $req->intParam('id');
        $in = $req->input();

        $fields = [];
        $values = [];
        if ($in->has('name')) {
            $fields[] = 'name = ?';
            $values[] = $in->requireString('name');
        }
        if ($in->has('sort_order')) {
            $fields[] = 'sort_order = ?';
            $values[] = $in->integer('sort_order') ?? 0;
        }
        if ($in->has('active')) {
            $fields[] = 'active = ?';
            $values[] = $in->boolean('active') ? 1 : 0;
        }
        if ($table === 'marmitex_sizes' && $in->has('price')) {
            $fields[] = 'price = ?';
            $values[] = (float) ($in->number('price') ?? 0);
        }
        if (!$fields) {
            throw HttpError::badRequest('Nada para atualizar');
        }
        $values[] = $id;
        Db::execute("UPDATE {$table} SET " . implode(', ', $fields) . ' WHERE id = ?', $values);

        $row = Db::queryOne("SELECT * FROM {$table} WHERE id = ?", [$id]);
        if (!$row) {
            throw HttpError::notFound('Registro não encontrado');
        }
        Http::json($row);
    }

    public static function remove(Request $req): void
    {
        $table = self::table($req);
        $id = $req->intParam('id');
        try {
            Db::execute("DELETE FROM {$table} WHERE id = ?", [$id]);
            Http::noContent();
        } catch (\Throwable) {
            // Referenciado em marmitas (snapshot preserva o nome, mas a FK trava o DELETE):
            // desativa em vez de excluir, mantendo o histórico intacto.
            Db::execute("UPDATE {$table} SET active = 0 WHERE id = ?", [$id]);
            $row = Db::queryOne("SELECT * FROM {$table} WHERE id = ?", [$id]);
            Http::json($row ?? ['id' => $id, 'active' => 0]);
        }
    }

    private static function table(Request $req): string
    {
        $type = $req->param('type');
        if (!isset(self::TABLES[$type])) {
            throw HttpError::notFound('Catálogo inválido');
        }
        return self::TABLES[$type];
    }
}
