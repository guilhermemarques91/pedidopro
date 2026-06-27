<?php

namespace App\Modules\Marmitex;

use App\Core\Db;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Request;

/**
 * Dados planos das marmitas de um dia para impressão de etiquetas (uma etiqueta por
 * marmita). A renderização/print é no frontend (Pimaco 6080 via window.print).
 */
final class MarmitexLabelsController
{
    use CompanyScope;

    public static function labels(Request $req): void
    {
        $companyId = self::scopeCompany(
            $req,
            $req->query('company_id') ? (int) $req->query('company_id') : null
        );
        $date = $req->query('date');
        if (!$date || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            throw HttpError::badRequest('Informe a data (AAAA-MM-DD)');
        }

        $marmitas = Db::query(
            'SELECT m.id, m.person_name, m.size_name, m.protein_name, m.sides_json, m.observation
               FROM marmitex_marmitas m
              WHERE m.company_id = ? AND m.service_date = ?
              ORDER BY COALESCE(m.person_name, ""), m.id',
            [$companyId, $date]
        );
        foreach ($marmitas as &$m) {
            // MySQL/PDO devolve colunas JSON como string; decodifica para o frontend.
            $m['sides_json'] = $m['sides_json'] ? json_decode($m['sides_json'], true) : [];
        }
        unset($m);
        Http::json([
            'company' => Db::queryOne('SELECT id, name FROM marmitex_companies WHERE id = ?', [$companyId]),
            'date' => $date,
            'marmitas' => $marmitas,
        ]);
    }
}
