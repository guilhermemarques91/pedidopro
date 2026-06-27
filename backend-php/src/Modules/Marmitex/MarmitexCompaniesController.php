<?php

namespace App\Modules\Marmitex;

use App\Core\Db;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Input;
use App\Core\Request;

/**
 * Empresas-cliente do módulo Marmitex (tenants). CRUD restrito a admin; a empresa
 * só consegue ler a própria (getById) para exibir cabeçalho/horário de corte.
 */
final class MarmitexCompaniesController
{
    use CompanyScope;

    public static function list(Request $req): void
    {
        Http::json(Db::query(
            "SELECT c.*,
                    (SELECT COUNT(*) FROM marmitex_marmitas m
                      WHERE m.company_id = c.id AND m.billed_invoice_id IS NULL) AS pending_count
               FROM marmitex_companies c
              ORDER BY c.active DESC, c.name"
        ));
    }

    public static function getById(Request $req): void
    {
        $cid = self::scopeCompany($req, $req->intParam('id'));
        $row = Db::queryOne('SELECT * FROM marmitex_companies WHERE id = ?', [$cid]);
        if (!$row) {
            throw HttpError::notFound('Empresa não encontrada');
        }
        Http::json($row);
    }

    public static function create(Request $req): void
    {
        $in = $req->input();
        $row = Db::insertReturning(
            'INSERT INTO marmitex_companies (name, cnpj, contact_name, phone, email, notes, order_cutoff_time, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [
                $in->requireString('name'),
                $in->string('cnpj'),
                $in->string('contact_name'),
                $in->string('phone'),
                $in->string('email'),
                $in->string('notes'),
                self::cutoff($in),
                $req->userId(),
            ],
            'marmitex_companies'
        );
        Http::json($row, 201);
    }

    public static function update(Request $req): void
    {
        $id = $req->intParam('id');
        if (!Db::queryOne('SELECT id FROM marmitex_companies WHERE id = ?', [$id])) {
            throw HttpError::notFound('Empresa não encontrada');
        }
        $in = $req->input();

        $map = [
            'name' => fn () => $in->requireString('name'),
            'cnpj' => fn () => $in->string('cnpj'),
            'contact_name' => fn () => $in->string('contact_name'),
            'phone' => fn () => $in->string('phone'),
            'email' => fn () => $in->string('email'),
            'notes' => fn () => $in->string('notes'),
            'order_cutoff_time' => fn () => self::cutoff($in),
        ];
        $fields = [];
        $values = [];
        foreach ($map as $col => $resolver) {
            if ($in->has($col)) {
                $fields[] = "{$col} = ?";
                $values[] = $resolver();
            }
        }
        if ($in->has('active')) {
            $fields[] = 'active = ?';
            $values[] = $in->boolean('active') ? 1 : 0;
        }
        if (!$fields) {
            throw HttpError::badRequest('Nada para atualizar');
        }
        $values[] = $id;
        Db::execute('UPDATE marmitex_companies SET ' . implode(', ', $fields) . ' WHERE id = ?', $values);
        Http::json(Db::queryOne('SELECT * FROM marmitex_companies WHERE id = ?', [$id]));
    }

    /** Normaliza/valida o horário de corte (TIME 'HH:MM' ou 'HH:MM:SS'); null = sem corte. */
    private static function cutoff(Input $in): ?string
    {
        $v = $in->string('order_cutoff_time');
        if ($v === null) {
            return null;
        }
        if (!preg_match('/^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/', $v)) {
            throw HttpError::badRequest('Horário de corte inválido (use HH:MM)');
        }
        return strlen($v) === 5 ? $v . ':00' : $v;
    }
}
