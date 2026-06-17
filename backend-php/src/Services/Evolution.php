<?php

namespace App\Services;

use App\Core\Env;
use App\Core\HttpError;

/** Cliente da Evolution API (WhatsApp), rodando no PC e exposta pelo tunnel. */
final class Evolution
{
    private static function base(): string
    {
        return rtrim((string) Env::get('EVOLUTION_API_URL', ''), '/');
    }

    private static function instance(): string
    {
        return (string) Env::get('EVOLUTION_INSTANCE', 'pedidopro');
    }

    /**
     * @param array<string,mixed>|null $body
     * @return array{status:int,data:mixed}
     */
    private static function call(string $method, string $path, ?array $body = null, int $timeout = 15): array
    {
        $ch = curl_init(self::base() . $path);
        $headers = ['apikey: ' . (string) Env::get('EVOLUTION_API_KEY', '')];
        $opts = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_TIMEOUT => $timeout,
        ];
        if ($body !== null) {
            $headers[] = 'Content-Type: application/json';
            $opts[CURLOPT_POSTFIELDS] = json_encode($body, JSON_UNESCAPED_UNICODE);
        }
        $opts[CURLOPT_HTTPHEADER] = $headers;
        curl_setopt_array($ch, $opts);
        $raw = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        $data = is_string($raw) ? json_decode($raw, true) : null;
        return ['status' => $status, 'data' => $data];
    }

    /** POST /message/sendText/{instance} */
    public static function sendMessage(string $to, string $message): void
    {
        $r = self::call('POST', '/message/sendText/' . self::instance(), [
            'number' => $to,
            'text' => $message,
        ]);
        if ($r['status'] >= 400 || $r['status'] === 0) {
            throw new HttpError(502, 'Falha ao enviar mensagem pelo WhatsApp');
        }
    }

    /** POST /chat/findMessages/{instance} → registros crus. */
    public static function fetchMessages(string $remoteJid): array
    {
        $r = self::call('POST', '/chat/findMessages/' . self::instance(), [
            'where' => ['key' => ['remoteJid' => $remoteJid]],
        ]);
        $data = $r['data'];
        $records = $data['messages']['records'] ?? $data['records'] ?? $data;
        return is_array($records) ? $records : [];
    }

    /** GET /instance/connectionState/{instance} → conectado? */
    public static function checkConnection(): bool
    {
        $r = self::call('GET', '/instance/connectionState/' . self::instance());
        $state = $r['data']['instance']['state'] ?? $r['data']['state'] ?? null;
        return $state === 'open';
    }

    /** Extrai o texto de um registro de mensagem da Evolution. */
    public static function messageText(array $m): string
    {
        $msg = $m['message'] ?? [];
        $text = $msg['conversation']
            ?? $msg['extendedTextMessage']['text']
            ?? $msg['imageMessage']['caption']
            ?? $msg['documentMessage']['caption']
            ?? '';
        return trim((string) $text);
    }

    /** Monta a mensagem de pedido formatada para WhatsApp. */
    public static function formatOrderMessage(array $order, array $items): string
    {
        $brl = static fn (float $v) => 'R$ ' . number_format($v, 2, ',', '.');
        $date = !empty($order['created_at'])
            ? date('d/m/Y', strtotime((string) $order['created_at']))
            : date('d/m/Y');
        $lines = [];
        foreach ($items as $it) {
            $lines[] = '• ' . $it['quantity'] . 'x ' . $it['name'] . ' (' . $it['unit'] . ') — '
                . $brl((float) $it['unit_price']) . '/un';
        }
        return implode("\n", array_merge(
            [
                "🛒 *Pedido #{$order['id']} — PedidoPro*",
                "📅 Data: {$date}",
                '',
            ],
            $lines,
            [
                '',
                '*Total: ' . $brl((float) $order['total_amount']) . '*',
                '',
                'Confirmar recebimento respondendo esta mensagem.',
            ]
        ));
    }
}
