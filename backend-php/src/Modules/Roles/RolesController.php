<?php

namespace App\Modules\Roles;

use App\Core\Db;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Permissions;
use App\Core\Request;

/**
 * Papéis (roles) customizáveis pelo admin. Papéis do sistema (is_system=1) não
 * podem ser excluídos; o papel `admin` é superusuário e não é editável.
 */
final class RolesController
{
    /** Catálogo de permissões (agrupado por módulo) para montar os checkboxes. */
    public static function catalog(Request $req): void
    {
        Http::json(['catalog' => Permissions::CATALOG]);
    }

    public static function list(Request $req): void
    {
        $rows = Db::query(
            'SELECT id, `key`, label, permissions, is_system FROM roles WHERE org_id = ? ORDER BY is_system DESC, label',
            [$req->orgId()]
        );
        foreach ($rows as &$r) {
            $r['permissions'] = json_decode((string) $r['permissions'], true) ?: [];
            $r['is_system'] = (bool) $r['is_system'];
        }
        Http::json($rows);
    }

    public static function create(Request $req): void
    {
        $in = $req->input();
        $label = $in->requireString('label', 2, 80);
        $perms = Permissions::sanitize($in->array('permissions'));
        $key = self::uniqueKey(self::slug($label), $req->orgId());

        Db::execute(
            'INSERT INTO roles (org_id, `key`, label, permissions, is_system) VALUES (?, ?, ?, ?, 0)',
            [$req->orgId(), $key, $label, json_encode($perms)]
        );
        Http::json(self::find(Db::lastInsertId(), $req->orgId()), 201);
    }

    public static function update(Request $req): void
    {
        $id = $req->intParam('id');
        $role = self::find($id, $req->orgId());
        if ($role['key'] === 'admin') {
            throw HttpError::badRequest('O papel Administrador é superusuário e não pode ser editado');
        }
        $in = $req->input();
        $fields = [];
        $values = [];
        if ($in->has('label')) {
            $fields[] = 'label = ?';
            $values[] = $in->requireString('label', 2, 80);
        }
        if ($in->has('permissions')) {
            $fields[] = 'permissions = ?';
            $values[] = json_encode(Permissions::sanitize($in->array('permissions')));
        }
        if (!$fields) {
            throw HttpError::badRequest('Nada para atualizar');
        }
        $values[] = $id;
        $values[] = $req->orgId();
        Db::execute('UPDATE roles SET ' . implode(', ', $fields) . ' WHERE id = ? AND org_id = ?', $values);
        Http::json(self::find($id, $req->orgId()));
    }

    public static function remove(Request $req): void
    {
        $id = $req->intParam('id');
        $role = self::find($id, $req->orgId());
        if ($role['is_system']) {
            throw HttpError::badRequest('Papéis do sistema não podem ser excluídos');
        }
        $inUse = Db::queryOne('SELECT id FROM users WHERE role = ? AND org_id = ? LIMIT 1', [$role['key'], $req->orgId()]);
        if ($inUse) {
            throw HttpError::badRequest('Há usuários com este papel. Troque o papel deles antes de excluir.');
        }
        Db::execute('DELETE FROM roles WHERE id = ? AND org_id = ?', [$id, $req->orgId()]);
        Http::noContent();
    }

    /** @return array<string,mixed> */
    private static function find(int $id, int $orgId): array
    {
        $row = Db::queryOne('SELECT id, `key`, label, permissions, is_system FROM roles WHERE id = ? AND org_id = ?', [$id, $orgId]);
        if (!$row) {
            throw HttpError::notFound('Papel não encontrado');
        }
        $row['permissions'] = json_decode((string) $row['permissions'], true) ?: [];
        $row['is_system'] = (bool) $row['is_system'];
        return $row;
    }

    /** Gera slug ASCII a partir do label (a-z, 0-9, _). */
    private static function slug(string $label): string
    {
        $s = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $label) ?: $label;
        $s = strtolower($s);
        $s = preg_replace('/[^a-z0-9]+/', '_', $s) ?? '';
        $s = trim($s, '_');
        return $s === '' ? 'papel' : substr($s, 0, 32);
    }

    /** Garante unicidade do key na org (sufixa _2, _3... se colidir). */
    private static function uniqueKey(string $base, int $orgId): string
    {
        $key = $base;
        $n = 1;
        while (Db::queryOne('SELECT id FROM roles WHERE org_id = ? AND `key` = ?', [$orgId, $key])) {
            $n++;
            $key = $base . '_' . $n;
        }
        return $key;
    }
}
