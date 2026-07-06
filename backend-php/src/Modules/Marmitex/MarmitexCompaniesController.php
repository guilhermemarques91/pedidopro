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
              WHERE c.org_id = ?
              ORDER BY c.active DESC, c.name",
            [$req->orgId()]
        ));
    }

    public static function getById(Request $req): void
    {
        $cid = self::scopeCompany($req, $req->intParam('id'));
        $row = Db::queryOne('SELECT * FROM marmitex_companies WHERE id = ? AND org_id = ?', [$cid, $req->orgId()]);
        if (!$row) {
            throw HttpError::notFound('Empresa não encontrada');
        }
        Http::json($row);
    }

    public static function create(Request $req): void
    {
        $in = $req->input();
        $row = Db::insertReturning(
            'INSERT INTO marmitex_companies (org_id, name, cnpj, contact_name, phone, email, notes, order_cutoff_time, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                $req->orgId(),
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
        if (!Db::queryOne('SELECT id FROM marmitex_companies WHERE id = ? AND org_id = ?', [$id, $req->orgId()])) {
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

    /** GET /marmitex/companies/:id/contract — cardápio base com o estado do contrato. */
    public static function contract(Request $req): void
    {
        $id = $req->intParam('id');
        self::requireCompanyRow($id, $req->orgId());
        Http::json(self::contractShape($id, $req->orgId()));
    }

    /**
     * PUT /marmitex/companies/:id/contract — substitui o contrato inteiro.
     * Body: { prices: [{size_id, price}], hidden: { sizes: [], proteins: [], sides: [], observations: [] } }
     */
    public static function updateContract(Request $req): void
    {
        $id = $req->intParam('id');
        self::requireCompanyRow($id, $req->orgId());
        $in = $req->input();
        $prices = $in->array('prices');
        $hidden = (array) ($req->body['hidden'] ?? []);

        Db::transaction(function ($pdo) use ($id, $prices, $hidden): void {
            $pdo->prepare('DELETE FROM marmitex_company_prices WHERE company_id = ?')->execute([$id]);
            $pdo->prepare('DELETE FROM marmitex_company_hidden WHERE company_id = ?')->execute([$id]);
            $insP = $pdo->prepare('INSERT INTO marmitex_company_prices (company_id, size_id, price) VALUES (?, ?, ?)');
            foreach ($prices as $p) {
                $sizeId = (int) ($p['size_id'] ?? 0);
                $price = $p['price'] ?? null;
                if ($sizeId > 0 && $price !== null && $price !== '' && (float) $price >= 0) {
                    $insP->execute([$id, $sizeId, (float) $price]);
                }
            }
            $insH = $pdo->prepare('INSERT INTO marmitex_company_hidden (company_id, item_type, item_id) VALUES (?, ?, ?)');
            foreach (MarmitexContract::TYPES as $type) {
                foreach ((array) ($hidden[$type] ?? []) as $itemId) {
                    if ((int) $itemId > 0) {
                        $insH->execute([$id, $type, (int) $itemId]);
                    }
                }
            }
        });
        Http::json(self::contractShape($id, $req->orgId()));
    }

    /** Cardápio base anotado com o contrato (enabled + contract_price). */
    private static function contractShape(int $companyId, int $orgId): array
    {
        $hidden = MarmitexContract::hidden($companyId);
        $prices = MarmitexContract::prices($companyId);
        $shape = static function (array $rows, string $type) use ($hidden): array {
            return array_map(static fn ($r) => $r + ['enabled' => !isset($hidden[$type][(int) $r['id']])], $rows);
        };
        $sizes = Db::query('SELECT id, name, price AS base_price FROM marmitex_sizes WHERE org_id = ? AND active = 1 ORDER BY sort_order, name', [$orgId]);
        foreach ($sizes as &$sz) {
            $sz['contract_price'] = $prices[(int) $sz['id']] ?? null;
        }
        unset($sz);
        return [
            'sizes' => $shape($sizes, 'sizes'),
            'proteins' => $shape(Db::query('SELECT id, name FROM marmitex_proteins WHERE org_id = ? AND active = 1 ORDER BY sort_order, name', [$orgId]), 'proteins'),
            'sides' => $shape(Db::query('SELECT id, name FROM marmitex_sides WHERE org_id = ? AND active = 1 ORDER BY sort_order, name', [$orgId]), 'sides'),
            'observations' => $shape(Db::query('SELECT id, name FROM marmitex_observations WHERE org_id = ? AND active = 1 ORDER BY sort_order, name', [$orgId]), 'observations'),
        ];
    }

    private static function requireCompanyRow(int $id, int $orgId): void
    {
        if (!Db::queryOne('SELECT id FROM marmitex_companies WHERE id = ? AND org_id = ?', [$id, $orgId])) {
            throw HttpError::notFound('Empresa não encontrada');
        }
    }
}
