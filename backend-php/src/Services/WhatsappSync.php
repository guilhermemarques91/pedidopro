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
            // Tenta variantes do número (9º dígito do celular BR) e junta as mensagens.
            $messages = [];
            $seenMsg = [];
            foreach (self::phoneVariants($sup['whatsapp_number']) as $num) {
                foreach (Evolution::fetchMessages($num . '@s.whatsapp.net') as $m) {
                    $id = $m['key']['id'] ?? null;
                    if ($id !== null && isset($seenMsg[$id])) {
                        continue;
                    }
                    if ($id !== null) {
                        $seenMsg[$id] = true;
                    }
                    $messages[] = $m;
                }
            }
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

    /**
     * Variantes do número para lidar com o 9º dígito do celular brasileiro:
     * muitas contas antigas do WhatsApp ainda usam o número SEM o 9 (8 dígitos
     * locais), enquanto o cadastro costuma ter o 9 (9 dígitos). Tentamos as duas
     * para que o JID case independente de como a conta foi registrada.
     *
     * @return string[] só dígitos (sem `@s.whatsapp.net`), sem duplicatas
     */
    private static function phoneVariants(?string $raw): array
    {
        $d = self::digits($raw);
        if ($d === '') {
            return [];
        }
        $out = [$d];
        // BR: 55 + DDD(2) + local. Local com 9 dígitos começando em 9 → também sem o 9.
        if (str_starts_with($d, '55') && strlen($d) === 13 && $d[4] === '9') {
            $out[] = substr($d, 0, 4) . substr($d, 5); // remove o 9º dígito
        } elseif (str_starts_with($d, '55') && strlen($d) === 12) {
            $out[] = substr($d, 0, 4) . '9' . substr($d, 4); // adiciona o 9º dígito
        }
        return array_values(array_unique($out));
    }

    private static function looksLikePrice(string $text): bool
    {
        if (mb_strlen($text) < 4) {
            return false;
        }
        return (bool) (preg_match('/r\$\s*\d/i', $text) || preg_match('/\d+[.,]\d{2}\b/', $text));
    }
}
