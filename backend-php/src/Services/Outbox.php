<?php

namespace App\Services;

use App\Core\Db;

/**
 * Outbox de WhatsApp (offline-first). Envia via Evolution; se falhar (sem
 * internet/Evolution fora), enfileira em `whatsapp_outbox` em vez de estourar.
 * Quando um envio funciona (= estamos online), drena oportunisticamente a fila.
 * Também é drenada via POST /whatsapp/outbox/drain (UI/cron).
 */
final class Outbox
{
    private const MAX_ATTEMPTS = 10;

    /** Envia agora ou enfileira. Retorna true = entregue, false = ficou na fila. */
    public static function send(int $orgId, string $to, string $message, ?string $context = null): bool
    {
        try {
            Evolution::sendMessage($to, $message);
            Db::execute(
                "INSERT INTO whatsapp_outbox (org_id, to_number, message, context, status, attempts, sent_at)
                 VALUES (?, ?, ?, ?, 'sent', 1, NOW())",
                [$orgId, $to, $message, $context]
            );
            self::drain(3); // online: aproveita para esvaziar pendências
            return true;
        } catch (\Throwable $e) {
            Db::execute(
                "INSERT INTO whatsapp_outbox (org_id, to_number, message, context, status, attempts, last_error)
                 VALUES (?, ?, ?, ?, 'pending', 1, ?)",
                [$orgId, $to, $message, $context, mb_substr($e->getMessage(), 0, 500)]
            );
            return false;
        }
    }

    /** Tenta reenviar pendências (mais antigas primeiro). Retorna [sent, failed]. */
    public static function drain(int $limit = 20): array
    {
        $rows = Db::query(
            "SELECT * FROM whatsapp_outbox WHERE status = 'pending' ORDER BY id LIMIT " . max(1, $limit)
        );
        $sent = 0;
        $failed = 0;
        foreach ($rows as $r) {
            try {
                Evolution::sendMessage($r['to_number'], $r['message']);
                Db::execute("UPDATE whatsapp_outbox SET status = 'sent', sent_at = NOW(), attempts = attempts + 1 WHERE id = ?", [$r['id']]);
                $sent++;
            } catch (\Throwable $e) {
                $final = ((int) $r['attempts'] + 1) >= self::MAX_ATTEMPTS;
                Db::execute(
                    'UPDATE whatsapp_outbox SET attempts = attempts + 1, last_error = ?' . ($final ? ", status = 'failed'" : '') . ' WHERE id = ?',
                    [mb_substr($e->getMessage(), 0, 500), $r['id']]
                );
                $failed++;
                break; // se um falhou, provavelmente seguimos offline — para o lote
            }
        }
        return ['sent' => $sent, 'failed' => $failed];
    }
}
