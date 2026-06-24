<?php

namespace App\Services\Integrations;

use App\Core\Db;
use App\Core\Env;
use App\Core\HttpError;

/**
 * Cliente da API do 99Food (developer-food.99app.com). Autenticação OAuth2
 * client_credentials; pedidos chegam por webhook; comandos atualizam o status.
 *
 * Entrega HÍBRIDA: até ~2km a entrega é própria, fora é parceira. O modo vem no
 * payload do pedido e é normalizado para delivery_mode = own|partner.
 *
 * NOTA: os caminhos abaixo seguem a convenção documentada (OAuth2 + status
 * RECEIVED/READY_FOR_PICKUP/DISPATCHED/CANCELED). Ajuste BASE/paths conforme o
 * OpenAPI oficial (https://developer-food.99app.com/pt-BR/openapi) se divergir.
 *
 * @phpstan-type Channel array{id:int,merchant_id:?string,client_id:?string,client_secret:?string}
 */
final class NineNineClient
{
    /** Mapa comando unificado → status do 99Food. */
    private const STATUS = [
        'confirm' => 'CONFIRMED',
        'preparing' => 'PREPARING',
        'ready' => 'READY_FOR_PICKUP',
        'dispatch' => 'DISPATCHED',
        'cancel' => 'CANCELED',
    ];

    private static function base(): string
    {
        return rtrim((string) Env::get('NINE_NINE_API_BASE', 'https://api-food.99app.com'), '/');
    }

    private static function mock(): bool
    {
        return Env::bool('INTEGRATIONS_MOCK', false);
    }

    /** Token OAuth2 (cacheado em channel_tokens). */
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

        $r = HttpClient::request(
            'POST',
            self::base() . '/oauth/token',
            ['Content-Type: application/x-www-form-urlencoded', 'Accept: application/json'],
            HttpClient::form([
                'grant_type' => 'client_credentials',
                'client_id' => (string) ($channel['client_id'] ?? ''),
                'client_secret' => (string) ($channel['client_secret'] ?? ''),
            ])
        );
        $token = $r['data']['access_token'] ?? null;
        if ($r['status'] >= 400 || !is_string($token)) {
            throw new HttpError(502, 'Falha ao autenticar no 99Food (HTTP ' . $r['status'] . ').');
        }
        $expiresIn = (int) ($r['data']['expires_in'] ?? 3600);
        Db::execute(
            'INSERT INTO channel_tokens (channel_id, access_token, expires_at) VALUES (?, ?, FROM_UNIXTIME(?))
             ON DUPLICATE KEY UPDATE access_token = VALUES(access_token), expires_at = VALUES(expires_at)',
            [$cid, $token, time() + $expiresIn]
        );
        return $token;
    }

    /** @return array<int,string> */
    private static function auth(array $channel): array
    {
        return ['Authorization: Bearer ' . self::token($channel), 'Accept: application/json'];
    }

    /**
     * Polling de pedidos (rede de segurança; o caminho principal é o webhook).
     * @return array<int,array<string,mixed>>
     */
    public static function pollEvents(array $channel): array
    {
        if (self::mock()) {
            return [];
        }
        $merchant = (string) ($channel['merchant_id'] ?? '');
        $r = HttpClient::request(
            'GET',
            self::base() . '/orders/v1/events?merchantId=' . rawurlencode($merchant),
            self::auth($channel)
        );
        if ($r['status'] === 204 || !is_array($r['data'])) {
            return [];
        }
        // Aceita { events: [...] } ou lista direta.
        return $r['data']['events'] ?? $r['data'];
    }

    /** ACK dos eventos consumidos (se a plataforma exigir). */
    public static function acknowledge(array $channel, array $eventIds): void
    {
        if (self::mock() || !$eventIds) {
            return;
        }
        HttpClient::request(
            'POST',
            self::base() . '/orders/v1/events/acknowledgment',
            self::auth($channel),
            array_map(static fn ($id) => ['id' => (string) $id], $eventIds)
        );
    }

    public static function getOrder(array $channel, string $orderId): ?array
    {
        if (self::mock()) {
            return null;
        }
        $r = HttpClient::request('GET', self::base() . '/orders/v1/orders/' . rawurlencode($orderId), self::auth($channel));
        return is_array($r['data']) ? $r['data'] : null;
    }

    /** Atualiza o status do pedido (comando unificado → status 99Food). */
    public static function command(array $channel, string $orderId, string $command): void
    {
        $status = self::STATUS[$command] ?? null;
        if ($status === null) {
            throw HttpError::badRequest("Comando '{$command}' não suportado pelo 99Food");
        }
        if (self::mock()) {
            return;
        }
        $r = HttpClient::request(
            'POST',
            self::base() . '/orders/v1/orders/' . rawurlencode($orderId) . '/status',
            self::auth($channel),
            ['status' => $status]
        );
        if ($r['status'] >= 400) {
            throw new HttpError(502, "Falha ao enviar '{$command}' ao 99Food (HTTP {$r['status']}).");
        }
    }

    public static function tracking(array $channel, string $orderId): ?array
    {
        if (self::mock()) {
            return null;
        }
        $r = HttpClient::request('GET', self::base() . '/orders/v1/orders/' . rawurlencode($orderId) . '/tracking', self::auth($channel));
        return is_array($r['data']) ? $r['data'] : null;
    }
}
