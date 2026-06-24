<?php

namespace App\Modules\Webhooks;

use App\Core\Env;
use App\Core\Http;
use App\Core\Request;
use App\Services\Integrations\IngestService;

/**
 * Recebe eventos de pedido das plataformas (rotas PÚBLICAS — sem JWT).
 * É o caminho de tempo real; o polling (cron) é só a rede de segurança.
 *
 * Segurança por plataforma:
 *  - iFood: assina cada requisição com HMAC-SHA256 do corpo CRU usando o
 *    client_secret, em hex, no header `X-IFood-Signature`. Validar é OBRIGATÓRIO
 *    na homologação (o iFood testa enviando assinaturas inválidas e o endpoint
 *    DEVE rejeitar). Ver: developer.ifood.com.br/.../webhook-signature.
 *  - 99food (e fallback): segredo compartilhado em `x-webhook-secret`/`?secret=`.
 *
 * Em INTEGRATIONS_MOCK a validação é pulada (testes locais com curl).
 */
final class WebhooksController
{
    public static function ifood(Request $req): void
    {
        self::handle('ifood', $req);
    }

    public static function nineFood(Request $req): void
    {
        self::handle('99food', $req);
    }

    private static function handle(string $platform, Request $req): void
    {
        // Corpo CRU para validar a assinatura (sem transformações).
        $raw = file_get_contents('php://input');
        $raw = is_string($raw) ? $raw : '';

        $body = $req->body;
        $merchantId = self::merchantFromBody($body);
        $channel = IngestService::findChannel($platform, $merchantId);

        // Sem canal cadastrado: responde 200 (não queremos reentrega) mas não processa.
        if (!$channel) {
            Http::json(['ok' => true, 'ignored' => 'no channel configured'], 200);
        }

        if (!self::signatureOk($platform, $req, $channel, $raw)) {
            Http::error(401, 'Assinatura do webhook inválida');
        }

        $result = IngestService::handleWebhook($platform, $body, $channel);
        Http::json(['ok' => true] + $result, 200);
    }

    private static function signatureOk(string $platform, Request $req, array $channel, string $raw): bool
    {
        if (Env::bool('INTEGRATIONS_MOCK', false)) {
            return true; // dev/local: dispensa assinatura
        }

        if ($platform === 'ifood') {
            // HMAC-SHA256(corpo_cru, client_secret) em hex == X-IFood-Signature.
            $secret = (string) ($channel['client_secret'] ?? '');
            $sig = $_SERVER['HTTP_X_IFOOD_SIGNATURE'] ?? '';
            if ($secret === '' || !is_string($sig) || $sig === '') {
                return false; // sem credencial ou sem assinatura → rejeita (exigido na homologação)
            }
            $expected = hash_hmac('sha256', $raw, $secret);
            return hash_equals($expected, strtolower(trim($sig)));
        }

        // 99food (e fallback): segredo compartilhado.
        $expected = (string) ($channel['webhook_secret'] ?? '');
        if ($expected === '') {
            return true; // canal sem segredo configurado: aceita
        }
        $got = $_SERVER['HTTP_X_WEBHOOK_SECRET'] ?? $req->query('secret');
        return is_string($got) && hash_equals($expected, $got);
    }

    /** Tenta achar o merchantId no payload (varia entre plataformas/eventos). */
    private static function merchantFromBody(array $body): ?string
    {
        $candidates = [
            $body['merchantId'] ?? null,
            $body['merchant']['id'] ?? null,
            $body['storeId'] ?? null,
            $body['events'][0]['merchantId'] ?? null,
        ];
        foreach ($candidates as $c) {
            if ($c) {
                return (string) $c;
            }
        }
        return null;
    }
}
