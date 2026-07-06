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
    private const PUBLIC_COLS = 'id, name, username, email, role, active, company_id, org_id, must_change_password, created_at';

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

    /** Troca a senha do próprio usuário (zera must_change_password). */
    public static function changePassword(Request $req): void
    {
        $in = $req->input();
        $current = $in->requireString('current_password');
        $new = $in->requireString('new_password', 8);
        $user = Db::queryOne('SELECT id, password_hash FROM users WHERE id = ?', [$req->userId()]);
        if (!$user || !password_verify($current, $user['password_hash'])) {
            throw HttpError::badRequest('Senha atual incorreta');
        }
        Db::execute(
            'UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?',
            [password_hash($new, PASSWORD_BCRYPT), $req->userId()]
        );
        Http::json(['ok' => true]);
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
