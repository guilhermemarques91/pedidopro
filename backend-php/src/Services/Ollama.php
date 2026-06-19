<?php

namespace App\Services;

use App\Core\Env;
use App\Core\HttpError;

/** Cliente HTTP do Ollama (no PC, exposto pelo Cloudflare tunnel). */
final class Ollama
{
    /**
     * Chama POST {OLLAMA_URL}/api/chat em modo STREAMING e devolve o conteúdo
     * concatenado da mensagem.
     *
     * Por que streaming: o Ollama é exposto por um tunnel Cloudflare, que corta a
     * conexão em 100s (erro 524). Uma extração no modelo local (CPU) leva minutos;
     * com `stream:true` o Ollama envia tokens já nos primeiros segundos, mantendo a
     * conexão ativa, e a Cloudflare não derruba — mesmo durando vários minutos.
     *
     * @param array<int,array<string,mixed>> $messages
     * @param array<string,mixed>|null       $format   JSON schema p/ saída estruturada
     */
    public static function chat(string $model, array $messages, ?array $format = null, int $timeout = 600): string
    {
        $payload = [
            'model' => $model,
            'stream' => true,
            'options' => ['temperature' => 0],
            // Mantém o modelo carregado na RAM por 10min entre chamadas (sync processa
            // várias mensagens em sequência; evita recarregar o modelo a cada uma).
            'keep_alive' => '10m',
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

        // Acumula o conteúdo conforme os pedaços NDJSON chegam (mantém a conexão viva).
        $content = '';
        $streamError = null;
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_WRITEFUNCTION => function ($ch, string $data) use (&$content, &$streamError): int {
                // Cada linha é um objeto JSON: {"message":{"content":"..."},"done":false}
                foreach (preg_split('/\r?\n/', $data) as $line) {
                    $line = trim($line);
                    if ($line === '') {
                        continue;
                    }
                    $obj = json_decode($line, true);
                    if (!is_array($obj)) {
                        continue;
                    }
                    if (isset($obj['error'])) {
                        $streamError = is_string($obj['error']) ? $obj['error'] : 'erro desconhecido';
                    }
                    $content .= (string) ($obj['message']['content'] ?? '');
                }
                return strlen($data);
            },
        ]);
        $ok = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);

        if ($ok === false) {
            throw HttpError::unprocessable('IA local indisponível (' . $err . ').');
        }
        if ($status >= 400) {
            throw new HttpError(502, "Falha na IA local (HTTP {$status}). Verifique o Ollama e o modelo \"{$model}\".");
        }
        if ($streamError !== null) {
            throw new HttpError(502, 'Falha na IA local: ' . $streamError);
        }
        if ($content === '') {
            throw new HttpError(502, 'A IA local não retornou conteúdo.');
        }
        return $content;
    }
}
