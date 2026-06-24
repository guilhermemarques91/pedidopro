<?php

namespace App\Services\Integrations;

/**
 * Wrapper cURL enxuto para as APIs das plataformas (iFood/99Food).
 * Espelha o padrão de Services\Evolution::call, mas genérico e reutilizável.
 */
final class HttpClient
{
    /**
     * @param array<int,string>          $headers cabeçalhos crus ("Nome: valor")
     * @param array<string,mixed>|string|null $body  array → JSON; string → enviado cru (ex.: form-urlencoded)
     * @return array{status:int,data:mixed,raw:string,error:string}
     */
    public static function request(string $method, string $url, ?array $headers = null, array|string|null $body = null, int $timeout = 20): array
    {
        $ch = curl_init($url);
        $opts = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_TIMEOUT => $timeout,
        ];
        $hdrs = $headers ?? [];
        if ($body !== null) {
            if (is_array($body)) {
                $hdrs[] = 'Content-Type: application/json';
                $opts[CURLOPT_POSTFIELDS] = json_encode($body, JSON_UNESCAPED_UNICODE);
            } else {
                $opts[CURLOPT_POSTFIELDS] = $body;
            }
        }
        $opts[CURLOPT_HTTPHEADER] = $hdrs;
        curl_setopt_array($ch, $opts);
        $raw = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);
        $rawStr = is_string($raw) ? $raw : '';
        $data = $rawStr !== '' ? json_decode($rawStr, true) : null;
        return ['status' => $status, 'data' => $data, 'raw' => $rawStr, 'error' => $error];
    }

    /** Codifica um array como application/x-www-form-urlencoded. */
    public static function form(array $fields): string
    {
        return http_build_query($fields);
    }
}
