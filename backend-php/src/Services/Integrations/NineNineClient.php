<?php

namespace App\Services\Integrations;

use App\Core\Db;
use App\Core\Env;
use App\Core\HttpError;

/**
 * Cliente da API do 99Food / DiDi Food (openapi.didi-food.com).
 *
 * Modelo de auth (DIFERENTE de OAuth client_credentials):
 *  - Credenciais do app: app_id + app_secret (guardadas no canal como client_id/client_secret).
 *  - Por loja: você define um app_shop_id (guardado como merchant_id) e vincula a loja
 *    real via página de autorização (auth/authorizationpage/getUrl).
 *  - Token por loja: GET /v1/auth/authtoken/get → auth_token (+ token_expiration_time).
 *    Se não existir/expirou: GET /v1/auth/authtoken/refresh e então /get de novo.
 *  - Todas as chamadas de pedido/loja usam auth_token (query no GET, corpo no POST).
 *
 * Pedidos chegam por CALLBACK (orderNew/orderFinish/orderCancel) → buscamos o
 * detalhe com order/order/detail. Não há polling de pedidos (pollEvents = []).
 *
 * Resposta padrão: { errno:0, errmsg:'ok', requestId, time, data }. Sucesso = errno 0.
 *
 * @phpstan-type Channel array{id:int,merchant_id:?string,client_id:?string,client_secret:?string}
 */
final class NineNineClient
{
    /** Comando unificado → reason_id padrão de cancelamento (enum DiDi). */
    private const CANCEL_REASON_ID = 1010;

    private static function base(): string
    {
        return rtrim((string) Env::get('NINE_NINE_API_BASE', 'https://openapi.didi-food.com'), '/');
    }

    private static function mock(): bool
    {
        return Env::bool('INTEGRATIONS_MOCK', false);
    }

    /** Credenciais do canal mapeadas para os nomes do DiDi. */
    private static function creds(array $channel): array
    {
        return [
            'app_id' => (string) ($channel['client_id'] ?? ''),
            'app_secret' => (string) ($channel['client_secret'] ?? ''),
            'app_shop_id' => (string) ($channel['merchant_id'] ?? ''),
        ];
    }

    /**
     * Chama a API e interpreta o StandardResponse.
     * @return array{ok:bool,errno:int,errmsg:string,data:mixed,status:int}
     */
    private static function call(string $method, string $path, array $query = [], ?array $body = null): array
    {
        $url = self::base() . $path;
        if ($query) {
            $url .= '?' . http_build_query($query);
        }
        $r = HttpClient::request($method, $url, ['Accept: application/json'], $body);
        $data = is_array($r['data']) ? $r['data'] : [];
        $errno = (int) ($data['errno'] ?? ($r['status'] >= 400 ? -1 : 0));
        return [
            'ok' => $r['status'] < 400 && $errno === 0,
            'errno' => $errno,
            'errmsg' => (string) ($data['errmsg'] ?? $r['error'] ?? ''),
            'data' => $data['data'] ?? null,
            'status' => $r['status'],
        ];
    }

    /** auth_token válido da loja (cacheado em channel_tokens; renova quando expira). */
    public static function token(array $channel): string
    {
        if (self::mock()) {
            return 'mock-token';
        }
        $cid = (int) $channel['id'];
        $row = Db::queryOne('SELECT access_token, expires_at FROM channel_tokens WHERE channel_id = ?', [$cid]);
        if ($row && $row['expires_at'] !== null && strtotime((string) $row['expires_at']) - 60 > time()) {
            return (string) $row['access_token'];
        }

        $token = self::fetchToken($channel);
        // Sem token ou expirado no servidor → força refresh e busca de novo.
        if ($token === null) {
            self::call('GET', '/v1/auth/authtoken/refresh', self::creds($channel));
            $token = self::fetchToken($channel);
        }
        if ($token === null) {
            throw new HttpError(502, 'Falha ao obter auth_token do 99Food (confira app_id/app_secret/app_shop_id e o vínculo da loja).');
        }
        return $token;
    }

    /** GET authtoken/get; cacheia e devolve o auth_token (ou null). */
    private static function fetchToken(array $channel): ?string
    {
        $r = self::call('GET', '/v1/auth/authtoken/get', self::creds($channel));
        $token = is_array($r['data']) ? ($r['data']['auth_token'] ?? null) : null;
        if (!is_string($token) || $token === '') {
            return null;
        }
        $exp = (int) ($r['data']['token_expiration_time'] ?? (time() + 3600));
        Db::execute(
            'INSERT INTO channel_tokens (channel_id, access_token, expires_at) VALUES (?, ?, FROM_UNIXTIME(?))
             ON DUPLICATE KEY UPDATE access_token = VALUES(access_token), expires_at = VALUES(expires_at)',
            [(int) $channel['id'], $token, $exp]
        );
        return $token;
    }

    /** 99Food entrega pedidos por callback — não há polling. */
    public static function pollEvents(array $channel): array
    {
        return [];
    }

    public static function acknowledge(array $channel, array $eventIds): void
    {
        // Sem ACK no modelo de callback do DiDi.
    }

    /** GET /v1/order/order/detail → OrderModel. */
    public static function getOrder(array $channel, string $orderId): ?array
    {
        if (self::mock()) {
            return null;
        }
        $r = self::call('GET', '/v1/order/order/detail', [
            'auth_token' => self::token($channel),
            'order_id' => $orderId,
        ]);
        return is_array($r['data']) ? $r['data'] : null;
    }

    /**
     * Envia comando de status. Mapeamento:
     *  confirm  → POST order/confirm
     *  ready    → GET  order/ready
     *  dispatch → GET  order/delivered (só entrega própria; concluído pela loja)
     *  cancel   → POST order/cancel (reason_id obrigatório)
     */
    public static function command(array $channel, string $orderId, string $command): void
    {
        if (self::mock()) {
            return;
        }
        $token = self::token($channel);
        $oid = (int) $orderId;

        $r = match ($command) {
            'confirm' => self::call('POST', '/v1/order/order/confirm', [], ['auth_token' => $token, 'order_id' => $oid]),
            'ready' => self::call('GET', '/v1/order/order/ready', ['auth_token' => $token, 'order_id' => $oid]),
            'dispatch' => self::call('GET', '/v1/order/order/delivered', ['auth_token' => $token, 'order_id' => $oid]),
            'cancel' => self::call('POST', '/v1/order/order/cancel', [], [
                'auth_token' => $token,
                'order_id' => $oid,
                'reason_id' => self::CANCEL_REASON_ID,
                'reason' => 'Cancelado pela loja',
            ]),
            default => throw HttpError::badRequest("Comando '{$command}' não suportado pelo 99Food"),
        };

        if (!$r['ok']) {
            throw new HttpError(502, "Falha ao enviar '{$command}' ao 99Food (errno {$r['errno']}: {$r['errmsg']}).");
        }
    }

    /** Sem endpoint simples de tracking do entregador na API atual. */
    public static function tracking(array $channel, string $orderId): ?array
    {
        return null;
    }

    /**
     * Verifica a autenticação e devolve a loja vinculada (para a tela de Integrações).
     * Usa shop/detail (shop/list exige assinatura 'sign'); retorna a loja deste canal.
     * @return array<int,array{id:string,name:string}>
     */
    public static function merchants(array $channel): array
    {
        if (self::mock()) {
            return [];
        }
        $r = self::call('GET', '/v1/shop/shop/detail', ['auth_token' => self::token($channel)]);
        if (!$r['ok'] || !is_array($r['data'])) {
            return [];
        }
        $shop = $r['data'];
        return [[
            'id' => (string) ($shop['app_shop_id'] ?? ($channel['merchant_id'] ?? '')),
            'name' => (string) ($shop['name'] ?? 'Loja'),
        ]];
    }
}
