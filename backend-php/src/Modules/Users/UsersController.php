<?php

namespace App\Modules\Users;

use App\Core\Db;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Permissions;
use App\Core\Request;

final class UsersController
{
    private const PUBLIC_COLS = 'id, name, username, email, role, active, company_id, permissions_json, created_at';

    public static function list(Request $req): void
    {
        $rows = Db::query(
            'SELECT u.' . str_replace(', ', ', u.', self::PUBLIC_COLS) . ', mc.name AS company_name
               FROM users u LEFT JOIN marmitex_companies mc ON mc.id = u.company_id
              WHERE u.org_id = ?
              ORDER BY u.name',
            [$req->orgId()]
        );
        Http::json(array_map([self::class, 'shape'], $rows));
    }

    public static function create(Request $req): void
    {
        $in = $req->input();
        $name = $in->requireString('name');
        $username = self::normalizeUsername($in->requireString('username', 3, 80));
        $email = $in->string('email'); // opcional
        $password = $in->requireString('password', 6);
        $role = self::requireRole($in->string('role'), $req->orgId());
        // Login de empresa (Marmitex) precisa estar vinculado a uma empresa.
        $companyId = $role === 'company' ? self::requireCompany($in->integer('company_id')) : null;
        $permissions = self::permissionsInput($in, $role);

        if (Db::queryOne('SELECT id FROM users WHERE username = ?', [$username])) {
            throw HttpError::badRequest('Já existe um usuário com este nome de usuário');
        }
        $hash = password_hash($password, PASSWORD_BCRYPT);
        Db::execute(
            'INSERT INTO users (name, username, email, password_hash, role, company_id, org_id, permissions_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [$name, $username, $email, $hash, $role, $companyId, $req->orgId(), $permissions]
        );
        Http::json(self::find(Db::lastInsertId()), 201);
    }

    /** Normaliza o username: minúsculas, sem espaços, só letras/dígitos/._- */
    private static function normalizeUsername(string $raw): string
    {
        $u = strtolower(trim($raw));
        $u = preg_replace('/\s+/', '', $u) ?? $u;
        if (!preg_match('/^[a-z0-9._-]{3,80}$/', $u)) {
            throw HttpError::badRequest('Nome de usuário inválido (use letras, números, ponto, hífen ou _)');
        }
        return $u;
    }

    /** Valida que o papel existe (na org); devolve a `key`. */
    private static function requireRole(?string $key, int $orgId): string
    {
        if (!$key || !Db::queryOne('SELECT id FROM roles WHERE `key` = ? AND org_id = ?', [$key, $orgId])) {
            throw HttpError::badRequest('Papel inválido');
        }
        return $key;
    }

    /**
     * Override de permissões do usuário. Retorna JSON (string) para gravar, ou null
     * (= herda do papel). Ignorado para admin (superusuário).
     */
    private static function permissionsInput($in, string $role): ?string
    {
        if ($role === 'admin' || !$in->has('permissions')) {
            return null;
        }
        $raw = $in->raw('permissions');
        if ($raw === null) {
            return null; // explicitamente "usar o papel"
        }
        return json_encode(Permissions::sanitize($in->array('permissions')));
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
        // Papel efetivo após a edição (usado p/ validar permissões e vínculo de empresa).
        $current = self::find($id);
        $in = $req->input();

        $fields = [];
        $values = [];
        if ($in->has('name')) {
            $fields[] = 'name = ?';
            $values[] = $in->requireString('name');
        }
        $role = $current['role'];
        if ($in->has('role')) {
            $role = self::requireRole($in->string('role'), $req->orgId());
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
        if ($in->has('permissions')) {
            $fields[] = 'permissions_json = ?';
            $values[] = self::permissionsInput($in, $role);
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
        Permissions::forget($id); // invalida cache após escrita
        return self::shape($row);
    }

    /**
     * Normaliza a linha para a API: `permissions` = override (array) ou null (herda
     * do papel); `effective_permissions` = o que o usuário realmente pode fazer.
     * @param array<string,mixed> $row
     * @return array<string,mixed>
     */
    private static function shape(array $row): array
    {
        $override = isset($row['permissions_json']) && $row['permissions_json'] !== null
            ? json_decode((string) $row['permissions_json'], true) : null;
        unset($row['permissions_json']);
        $row['permissions'] = is_array($override) ? $override : null;
        $row['effective_permissions'] = Permissions::effectiveForUser((int) $row['id']);
        return $row;
    }
}
