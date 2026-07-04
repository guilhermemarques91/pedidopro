<?php

namespace App\Modules\Audit;

use App\Core\Db;
use App\Core\Http;
use App\Core\Request;

/** Leitura da trilha de auditoria (registro é automático, via Core\Audit no Router). */
final class AuditController
{
    public static function list(Request $req): void
    {
        $where = ['org_id = ?'];
        $params = [$req->orgId()];

        $entity = $req->query('entity');
        if ($entity !== null) {
            $where[] = 'entity = ?';
            $params[] = $entity;
        }
        $user = $req->query('user');
        if ($user !== null) {
            $where[] = 'username LIKE ?';
            $params[] = '%' . $user . '%';
        }

        // Paginação simples (limite 1..200).
        $limit = max(1, min((int) ($req->query('limit') ?? 100), 200));
        $offset = max(0, (int) ($req->query('offset') ?? 0));

        $sql = 'SELECT id, user_id, username, method, path, entity, entity_id, status, ip, created_at
                  FROM audit_log
                 WHERE ' . implode(' AND ', $where) . '
                 ORDER BY id DESC
                 LIMIT ' . $limit . ' OFFSET ' . $offset;
        Http::json(Db::query($sql, $params));
    }
}
