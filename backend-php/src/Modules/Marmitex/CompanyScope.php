<?php

namespace App\Modules\Marmitex;

use App\Core\HttpError;
use App\Core\Request;

/**
 * Resolve a empresa-alvo de uma requisição, garantindo o escopo multi-tenant:
 *  - login 'company' fica preso à própria empresa (company_id do token);
 *  - staff (admin) precisa informar a empresa explicitamente.
 */
trait CompanyScope
{
    private static function scopeCompany(Request $req, ?int $requested): int
    {
        if ($req->isCompany()) {
            $cid = $req->companyId();
            if (!$cid) {
                throw HttpError::forbidden('Seu login não está vinculado a uma empresa');
            }
            if ($requested !== null && $requested !== $cid) {
                throw HttpError::forbidden('Você não tem acesso a esta empresa');
            }
            return $cid;
        }
        if ($requested === null || $requested <= 0) {
            throw HttpError::badRequest('Informe a empresa (company_id)');
        }
        return $requested;
    }
}
