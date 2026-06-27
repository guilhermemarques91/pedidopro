<?php

namespace App\Modules\Users;

use App\Core\Db;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Request;

final class UsersController
{
    private const PUBLIC_COLS = 'id, name, email, role, active, company_id, created_at';
    private const ROLES = ['admin', 'buyer', 'approver', 'requester', 'company'];

    public static function list(Request $req): void
    {
        Http::json(Db::query(
            'SELECT u.' . str_replace(', ', ', u.', self::PUBLIC_COLS) . ', mc.name AS company_name
               FROM users u LEFT JOIN marmitex_companies mc ON mc.id = u.company_id
              ORDER BY u.name'
        ));
    }

    public static function create(Request $req): void
    {
        $in = $req->input();
        $name = $in->requireString('name');
        $email = $in->email('email');
        $password = $in->requireString('password', 6);
        $role = $in->enum('role', self::ROLES, true);
        // Login de empresa (Marmitex) precisa estar vinculado a uma empresa.
        $companyId = $role === 'company' ? self::requireCompany($in->integer('company_id')) : null;

        if (Db::queryOne('SELECT id FROM users WHERE email = ?', [$email])) {
            throw HttpError::badRequest('Já existe um usuário com este e-mail');
        }
        $hash = password_hash($password, PASSWORD_BCRYPT);
        Db::execute(
            'INSERT INTO users (name, email, password_hash, role, company_id) VALUES (?, ?, ?, ?, ?)',
            [$name, $email, $hash, $role, $companyId]
        );
        Http::json(self::find(Db::lastInsertId()), 201);
    }

    /** Valida que a empresa informada existe; lança erro caso ausente/inválida. */
    private static function requireCompany(?int $companyId): int
    {
        if (!$companyId || !Db::queryOne('SELECT id FROM marmitex_companies WHERE id = ?', [$companyId])) {
            throw HttpError::badRequest('Selecione a empresa do login (módulo Marmitex)');
        }
        return $companyId;
    }

    public static function update(Request $req): void
    {
        $id = $req->intParam('id');
        self::find($id);
        $in = $req->input();

        $fields = [];
        $values = [];
        if ($in->has('name')) {
            $fields[] = 'name = ?';
            $values[] = $in->requireString('name');
        }
        if ($in->has('role')) {
            $role = $in->enum('role', self::ROLES, true);
            // Evita lockout: admin não pode rebaixar o próprio papel.
            if ($id === $req->userId() && $role !== 'admin') {
                throw HttpError::badRequest('Você não pode rebaixar o seu próprio papel');
            }
            $fields[] = 'role = ?';
            $values[] = $role;
            // Vínculo com empresa acompanha o papel: company exige empresa; demais zeram.
            $fields[] = 'company_id = ?';
            $values[] = $role === 'company' ? self::requireCompany($in->integer('company_id')) : null;
        } elseif ($in->has('company_id')) {
            $fields[] = 'company_id = ?';
            $values[] = $in->integer('company_id');
        }
        if ($in->has('password') && $in->string('password') !== null) {
            $fields[] = 'password_hash = ?';
            $values[] = password_hash($in->requireString('password', 6), PASSWORD_BCRYPT);
        }
        if (!$fields) {
            throw HttpError::badRequest('Nada para atualizar');
        }
        $values[] = $id;
        Db::execute('UPDATE users SET ' . implode(', ', $fields) . ' WHERE id = ?', $values);
        Http::json(self::find($id));
    }

    public static function setActive(Request $req): void
    {
        $id = $req->intParam('id');
        self::find($id);
        $active = $req->input()->boolean('active');
        if ($active === null) {
            throw HttpError::badRequest("Campo 'active' é obrigatório");
        }
        // Evita lockout: admin não pode se auto-desativar.
        if ($id === $req->userId() && !$active) {
            throw HttpError::badRequest('Você não pode desativar o seu próprio acesso');
        }
        Db::execute('UPDATE users SET active = ? WHERE id = ?', [$active ? 1 : 0, $id]);
        Http::json(self::find($id));
    }

    public static function remove(Request $req): void
    {
        $id = $req->intParam('id');
        self::find($id);
        if ($id === $req->userId()) {
            throw HttpError::badRequest('Você não pode excluir o seu próprio usuário');
        }
        try {
            Db::execute('DELETE FROM users WHERE id = ?', [$id]);
        } catch (\Throwable) {
            // Usuário referenciado em pedidos/cotações/listas → integridade.
            throw HttpError::badRequest('Usuário com registros vinculados. Bloqueie o acesso em vez de excluir.');
        }
        Http::noContent();
    }

    private static function find(int $id): array
    {
        $row = Db::queryOne('SELECT ' . self::PUBLIC_COLS . ' FROM users WHERE id = ?', [$id]);
        if (!$row) {
            throw HttpError::notFound('Usuário não encontrado');
        }
        return $row;
    }
}
