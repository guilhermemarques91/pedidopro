<?php

namespace App\Core;

/**
 * Emissão/validação de JWT (HS256, sem dependências externas) e helpers de
 * autorização. Payload: { id, email, role, iat, exp }. O token é auto-emitido
 * — o frontend só o reenvia, não o decodifica.
 */
final class Auth
{
    private static function secret(): string
    {
        $s = Env::get('JWT_SECRET', '');
        if (strlen((string) $s) < 16) {
            throw new \RuntimeException('JWT_SECRET ausente ou muito curto (>=16 chars).');
        }
        return $s;
    }

    public static function sign(int $id, string $email, string $role): string
    {
        $days = Env::int('JWT_EXPIRES_DAYS', 7);
        $now = time();
        $header = self::b64(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
        $payload = self::b64(json_encode([
            'id' => $id,
            'email' => $email,
            'role' => $role,
            'iat' => $now,
            'exp' => $now + $days * 86400,
        ]));
        $sig = self::b64(hash_hmac('sha256', "{$header}.{$payload}", self::secret(), true));
        return "{$header}.{$payload}.{$sig}";
    }

    /**
     * Lê o header Authorization, valida o token e retorna { id, email, role }.
     * @return array{id:int,email:string,role:string}
     */
    public static function authenticate(): array
    {
        $header = self::authHeader();
        if (!$header || stripos($header, 'Bearer ') !== 0) {
            throw HttpError::unauthorized('Token de autenticação ausente');
        }
        $claims = self::verify(trim(substr($header, 7)));
        if ($claims === null) {
            throw HttpError::unauthorized('Token inválido ou expirado');
        }
        return [
            'id' => (int) ($claims['id'] ?? 0),
            'email' => (string) ($claims['email'] ?? ''),
            'role' => (string) ($claims['role'] ?? ''),
        ];
    }

    /** Valida assinatura + expiração. Retorna claims ou null. */
    private static function verify(string $token): ?array
    {
        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            return null;
        }
        [$h, $p, $sig] = $parts;
        $expected = self::b64(hash_hmac('sha256', "{$h}.{$p}", self::secret(), true));
        if (!hash_equals($expected, $sig)) {
            return null;
        }
        $claims = json_decode(self::b64decode($p), true);
        if (!is_array($claims)) {
            return null;
        }
        if (isset($claims['exp']) && time() >= (int) $claims['exp']) {
            return null;
        }
        return $claims;
    }

    private static function b64(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    private static function b64decode(string $data): string
    {
        return base64_decode(strtr($data, '-_', '+/')) ?: '';
    }

    /** Garante que o papel do usuário esteja entre os permitidos. */
    public static function authorize(array $user, array $roles): void
    {
        if (empty($roles)) {
            return; // qualquer autenticado
        }
        if (!in_array($user['role'] ?? '', $roles, true)) {
            throw HttpError::forbidden('Você não tem permissão para esta ação');
        }
    }

    private static function authHeader(): ?string
    {
        $h = $_SERVER['HTTP_AUTHORIZATION']
            ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
            ?? null;
        if (!$h && function_exists('apache_request_headers')) {
            $headers = apache_request_headers();
            foreach ($headers as $k => $v) {
                if (strcasecmp($k, 'Authorization') === 0) {
                    return $v;
                }
            }
        }
        return $h;
    }
}
