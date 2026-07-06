<?php

namespace App\Core;

/**
 * Emissão/validação de JWT (HS256, sem dependências externas) e helpers de
 * autorização. Payload: { id, email, role, iat, exp }. O token é auto-emitido
 * — o frontend só o reenvia, não o decodifica.
 */
final class Auth
{
    /** Secret default do docker-compose — aceitável só em dev. */
    private const DEV_DEFAULT_SECRET = 'troque-esta-chave-por-uma-bem-grande-0123456789';

    private static function secret(): string
    {
        $s = (string) Env::get('JWT_SECRET', '');
        if (strlen($s) < 16) {
            throw new \RuntimeException('JWT_SECRET ausente ou muito curto (>=16 chars).');
        }
        // Em produção, recusa o secret default (qualquer um conseguiria forjar tokens).
        if ($s === self::DEV_DEFAULT_SECRET && Env::get('APP_ENV') === 'production') {
            throw new \RuntimeException('JWT_SECRET default não é permitido em produção. Defina um valor próprio no .env.');
        }
        return $s;
    }

    public static function sign(int $id, ?string $email, string $role, ?int $companyId = null, int $orgId = 1): string
    {
        $days = Env::int('JWT_EXPIRES_DAYS', 7);
        $now = time();
        $header = self::b64(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
        $payload = self::b64(json_encode([
            'id' => $id,
            'email' => $email,
            'role' => $role,
            'company_id' => $companyId, // null para staff; preenchido p/ login de empresa (Marmitex)
            'org_id' => $orgId,         // tenant do ERP (organização dona dos dados); 1 = org padrão
            'iat' => $now,
            'exp' => $now + $days * 86400,
        ]));
        $sig = self::b64(hash_hmac('sha256', "{$header}.{$payload}", self::secret(), true));
        return "{$header}.{$payload}.{$sig}";
    }

    /**
     * Lê o header Authorization, valida o token e retorna { id, email, role, company_id, org_id }.
     * @return array{id:int,email:string,role:string,company_id:?int,org_id:int}
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
            'company_id' => isset($claims['company_id']) && $claims['company_id'] !== null
                ? (int) $claims['company_id'] : null,
            // Tokens antigos (pré-multi-tenant) não têm org_id → org padrão (1).
            'org_id' => isset($claims['org_id']) && $claims['org_id'] !== null
                ? (int) $claims['org_id'] : 1,
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

    /**
     * Guard da rota. Cada item do guard é uma PERMISSÃO (`modulo:acao`) ou, por
     * compatibilidade, um PAPEL (sem `:`). Passa se o usuário satisfizer qualquer
     * um dos itens. Guard vazio = qualquer autenticado.
     */
    public static function authorize(array $user, array $guard): void
    {
        if (empty($guard)) {
            return; // qualquer autenticado
        }
        $role = (string) ($user['role'] ?? '');
        $perms = null; // permissões efetivas do usuário (carregadas sob demanda)
        foreach ($guard as $need) {
            if (str_contains($need, ':')) {
                $perms ??= Permissions::effectiveForUser((int) ($user['id'] ?? 0));
                if (in_array($need, $perms, true)) {
                    return;
                }
            } elseif ($role === $need) { // papel legado (compat)
                return;
            }
        }
        throw HttpError::forbidden('Você não tem permissão para esta ação');
    }

    /** Checagem fina dentro de um handler: o usuário autenticado tem a permissão? */
    public static function can(array $user, string $perm): bool
    {
        return in_array($perm, Permissions::effectiveForUser((int) ($user['id'] ?? 0)), true);
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
