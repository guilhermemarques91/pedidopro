<?php

namespace App\Services;

use App\Core\Env;
use App\Core\HttpError;

/** Cliente HTTP do Ollama (no PC, exposto pelo Cloudflare tunnel). */
final class Ollama
{
    /**
     * Chama POST {OLLAMA_URL}/api/chat (stream=false). Retorna o conteúdo da mensagem.
     *
     * @param array<int,array<string,mixed>> $messages
     * @param array<string,mixed>|null       $format   JSON schema p/ saída estruturada
     */
    public static function chat(string $model, array $messages, ?array $format = null, int $timeout = 300): string
    {
        $payload = [
            'model' => $model,
            'stream' => false,
            'options' => ['temperature' => 0],
            'messages' => $messages,
        ];
        if ($format !== null) {
            $payload['format'] = $format;
        }

        $url = rtrim((string) Env::get('OLLAMA_URL', ''), '/') . '/api/chat';
        $headers = ['Content-Type: application/json'];
        // Cloudflare Access (service token), se o ollama.* estiver protegido.
        $cfId = Env::get('OLLAMA_CF_ACCESS_CLIENT_ID');
        $cfSecret = Env::get('OLLAMA_CF_ACCESS_CLIENT_SECRET');
        if ($cfId && $cfSecret) {
            $headers[] = 'CF-Access-Client-Id: ' . $cfId;
            $headers[] = 'CF-Access-Client-Secret: ' . $cfSecret;
        }

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
            CURLOPT_TIMEOUT => $timeout,
        ]);
        $body = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);

        if ($body === false) {
            throw HttpError::unprocessable('IA local indisponível (' . $err . ').');
        }
        if ($status >= 400) {
            throw new HttpError(502, "Falha na IA local (HTTP {$status}). Verifique o Ollama e o modelo \"{$model}\".");
        }
        $data = json_decode((string) $body, true);
        $content = $data['message']['content'] ?? null;
        if (!is_string($content) || $content === '') {
            throw new HttpError(502, 'A IA local não retornou conteúdo.');
        }
        return $content;
    }
}
