<?php

namespace App\Modules\Auth;

use App\Core\Auth;
use App\Core\Db;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Request;

final class AuthController
{
    private const PUBLIC_COLS = 'id, name, email, role, active, company_id, created_at';

    public static function login(Request $req): void
    {
        $in = $req->input();
        $email = $in->email('email');
        $password = $in->requireString('password');

        $user = Db::queryOne('SELECT * FROM users WHERE email = ?', [$email]);
        // Mensagem genérica para não revelar se o e-mail existe.
        if (!$user || !$user['active'] || !password_verify($password, $user['password_hash'])) {
            throw HttpError::unauthorized('Credenciais inválidas');
        }

        $companyId = isset($user['company_id']) && $user['company_id'] !== null ? (int) $user['company_id'] : null;
        $token = Auth::sign((int) $user['id'], $user['email'], $user['role'], $companyId);
        unset($user['password_hash']);
        Http::json(['token' => $token, 'user' => $user]);
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
        Http::json($user);
    }
}
