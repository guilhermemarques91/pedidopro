<?php

namespace App\Core;

/**
 * Trilha de auditoria. Registra automaticamente as MUTAÇÕES autenticadas
 * (POST/PUT/PATCH/DELETE) — chamado pelo Router após o guard, antes do handler.
 *
 * Como `Http::json()` encerra a requisição com exit, a gravação é adiada para o
 * shutdown (register_shutdown_function), quando o status HTTP final já está
 * definido. Falhas ao auditar são engolidas: nunca devem quebrar a resposta.
 */
final class Audit
{
    private const MUTATIONS = ['POST', 'PUT', 'PATCH', 'DELETE'];

    public static function maybeSchedule(Request $req, string $method, string $path): void
    {
        if (!in_array($method, self::MUTATIONS, true) || $req->user === null) {
            return;
        }
        $userId = (int) ($req->user['id'] ?? 0);
        $orgId = (int) ($req->user['org_id'] ?? 1);

        // entity = 1º segmento da rota; entity_id = param :id (senão, 2º segmento numérico).
        $segments = explode('/', trim($path, '/'));
        $entity = $segments[0] ?? null;
        $entityId = $req->params['id'] ?? (isset($segments[1]) && ctype_digit($segments[1]) ? $segments[1] : null);
        $ip = $_SERVER['REMOTE_ADDR'] ?? null;

        register_shutdown_function(static function () use ($orgId, $userId, $method, $path, $entity, $entityId, $ip): void {
            try {
                $status = http_response_code();
                $username = null;
                if ($userId > 0) {
                    $row = Db::queryOne('SELECT username FROM users WHERE id = ?', [$userId]);
                    $username = $row['username'] ?? null;
                }
                Db::execute(
                    'INSERT INTO audit_log (org_id, user_id, username, method, path, entity, entity_id, status, ip)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [$orgId, $userId ?: null, $username, $method, $path, $entity, $entityId, is_int($status) ? $status : null, $ip]
                );
            } catch (\Throwable) {
                // Auditoria é best-effort; nunca deve afetar a requisição.
            }
        });
    }
}
