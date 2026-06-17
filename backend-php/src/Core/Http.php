<?php

namespace App\Core;

/** Helpers de resposta JSON. Mantém o contrato de erro esperado pelo frontend. */
final class Http
{
    /** Emite JSON e encerra. Datas MySQL viram ISO para o `new Date()` do frontend. */
    public static function json(mixed $data, int $status = 200): never
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(self::normalize($data), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }

    public static function noContent(): never
    {
        http_response_code(204);
        exit;
    }

    /** Resposta de erro no formato { error } (ou { details } quando houver). */
    public static function error(int $status, string $message, ?array $details = null): never
    {
        $body = $details ? ['error' => $message, 'details' => $details] : ['error' => $message];
        self::json($body, $status);
    }

    /**
     * Converte recursivamente "YYYY-MM-DD HH:MM:SS" (datetime do MySQL) para
     * "YYYY-MM-DDTHH:MM:SS", que o `new Date(...)` do navegador interpreta bem.
     */
    private static function normalize(mixed $data): mixed
    {
        if (is_array($data)) {
            $out = [];
            foreach ($data as $k => $v) {
                $out[$k] = self::normalize($v);
            }
            return $out;
        }
        if (is_string($data) && preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $data)) {
            return str_replace(' ', 'T', $data);
        }
        return $data;
    }
}
