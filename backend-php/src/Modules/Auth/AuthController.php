<?php

namespace App\Modules\Auth;

use App\Core\Auth;
use App\Core\Db;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Permissions;
use App\Core\Request;

final class AuthController
{
    private const PUBLIC_COLS = 'id, name, username, email, role, active, company_id, org_id, created_at';

    public static function login(Request $req): void
    {
        $in = $req->input();
        // Credencial = username; aceita 'email' por compatibilidade com clientes antigos.
        $username = $in->string('username') ?? $in->string('email');
        if ($username === null) {
            throw HttpError::badRequest("Campo 'username' é obrigatório");
        }
        $password = $in->requireString('password');

        $user = Db::queryOne('SELECT * FROM users WHERE username = ?', [$username]);
        // Mensagem genérica para não revelar se o usuário existe.
        if (!$user || !$user['active'] || !password_verify($password, $user['password_hash'])) {
            throw HttpError::unauthorized('Credenciais inválidas');
        }

        $companyId = isset($user['company_id']) && $user['company_id'] !== null ? (int) $user['company_id'] : null;
        $orgId = isset($user['org_id']) && $user['org_id'] !== null ? (int) $user['org_id'] : 1;
        $token = Auth::sign((int) $user['id'], $user['email'], $user['role'], $companyId, $orgId);
        unset($user['password_hash']);
        // Permissões efetivas (papel + override) — o frontend usa para exibir/ocultar ações.
        Http::json(['token' => $token, 'user' => $user, 'permissions' => Permissions::effectiveForUser((int) $user['id'])]);
    }

    public static function me(Request $req): void
    {
        $user = Db::queryOne(
            'SELECT ' . self::PUBLIC_COLS . ' FROM users WHERE id = ? AND active = 1',
            [$req->userId()]
        );
        if (!$user) {
            throw HttpError::notFound('Usuário não encontrado');
        }
        $user['permissions'] = Permissions::effectiveForUser((int) $user['id']);
        Http::json($user);
    }
}
