<?php

namespace App\Services;

use App\Core\Db;
use App\Core\Env;

/** Sincroniza preços recebidos por WhatsApp para a fila de revisão (inbox_prices). */
final class WhatsappSync
{
    /** @return array{suppliers:int,messagesScanned:int,candidates:int,itemsAdded:int} */
    public static function run(): array
    {
        $suppliers = Db::query(
            "SELECT id, name, whatsapp_number FROM suppliers
              WHERE active = 1 AND order_type = 'whatsapp'
                AND whatsapp_number IS NOT NULL AND whatsapp_number <> ''"
        );

        $sinceMs = (time() - Env::int('INBOX_SYNC_DAYS', 2) * 86400) * 1000;
        $result = ['suppliers' => count($suppliers), 'messagesScanned' => 0, 'candidates' => 0, 'itemsAdded' => 0];

        foreach ($suppliers as $sup) {
            $jid = self::digits($sup['whatsapp_number']) . '@s.whatsapp.net';
            $messages = Evolution::fetchMessages($jid);
            $result['messagesScanned'] += count($messages);

            foreach ($messages as $m) {
                if (!empty($m['key']['fromMe'])) {
                    continue; // só recebidas
                }
                $tsMs = ((int) ($m['messageTimestamp'] ?? 0)) * 1000;
                if ($tsMs && $tsMs < $sinceMs) {
                    continue; // só janela recente
                }
                $key = $m['key']['id'] ?? null;
                if (!$key) {
                    continue;
                }
                $text = Evolution::messageText($m);
                if (!self::looksLikePrice($text)) {
                    continue;
                }
                $result['candidates']++;

                // dedup: já processada?
                if (Db::queryOne('SELECT id FROM inbox_prices WHERE message_key = ? LIMIT 1', [$key])) {
                    continue;
                }
                try {
                    $rows = AiExtractor::fromText($text);
                } catch (\Throwable) {
                    continue; // extração falhou; segue
                }
                $received = $tsMs ? date('Y-m-d H:i:s', (int) ($tsMs / 1000)) : null;
                foreach ($rows as $r) {
                    Db::execute(
                        'INSERT INTO inbox_prices
                            (supplier_id, message_key, raw_message, item_name, unit, price, quantity, notes, received_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        [$sup['id'], $key, $text, $r['name'], $r['unit'], $r['price'], $r['quantity'], $r['notes'], $received]
                    );
                    $result['itemsAdded']++;
                }
            }
        }
        return $result;
    }

    private static function digits(?string $s): string
    {
        return preg_replace('/\D/', '', (string) $s);
    }

    private static function looksLikePrice(string $text): bool
    {
        if (mb_strlen($text) < 4) {
            return false;
        }
        return (bool) (preg_match('/r\$\s*\d/i', $text) || preg_match('/\d+[.,]\d{2}\b/', $text));
    }
}
