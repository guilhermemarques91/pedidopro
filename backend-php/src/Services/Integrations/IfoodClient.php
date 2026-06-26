<?php

namespace App\Services\Integrations;

use App\Core\Db;
use App\Core\Env;
use App\Core\HttpError;

/**
 * Cliente da API do iFood (merchant-api). Autenticação client_credentials,
 * polling de eventos + acknowledgment, detalhe e comandos de pedido, tracking.
 *
 * Doc: https://developer.ifood.com.br/pt-BR/docs
 *  - Auth:   POST /authentication/v1.0/oauth/token (form: grantType/clientId/clientSecret)
 *  - Events: GET  /events/v1.0/events:polling (header x-polling-merchants)
 *            POST /events/v1.0/events/acknowledgment  (body: [{ "id": "..." }])
 *  - Order:  GET  /order/v1.0/orders/{id}
 *            POST /order/v1.0/orders/{id}/{confirm|startPreparation|readyToPickup|dispatch|requestCancellation}
 *            GET  /order/v1.0/orders/{id}/tracking
 *
 * @phpstan-type Channel array{id:int,merchant_id:?string,client_id:?string,client_secret:?string}
 */
final class IfoodClient
{
    /** Mapa comando unificado → ação do iFood. */
    private const ACTIONS = [
        'confirm' => 'confirm',
        'preparing' => 'startPreparation',
        'ready' => 'readyToPickup',
        'dispatch' => 'dispatch',
        'cancel' => 'requestCancellation',
    ];

    private static function base(): string
    {
        return rtrim((string) Env::get('IFOOD_API_BASE', 'https://merchant-api.ifood.com.br'), '/');
    }

    private static function mock(): bool
    {
        return Env::bool('INTEGRATIONS_MOCK', false);
    }

    /** Token de acesso válido (cacheado em channel_tokens; renova quando expira). */
    public static function token(array $channel): string
    {
        if (self::mock()) {
            return 'mock-token';
        }
        $cid = (int) $channel['id'];
        $row = Db::queryOne('SELECT access_token, expires_at FROM channel_tokens WHERE channel_id = ?', [$cid]);
        // Renova com 60s de folga antes do vencimento.
        if ($row && $row['expires_at'] !== null && strtotime((string) $row['expires_at']) - 60 > time()) {
            return (string) $row['access_token'];
        }

        $r = HttpClient::request(
            'POST',
            self::base() . '/authentication/v1.0/oauth/token',
            ['Content-Type: application/x-www-form-urlencoded', 'Accept: application/json'],
            HttpClient::form([
                'grantType' => 'client_credentials',
                'clientId' => (string) ($channel['client_id'] ?? ''),
                'clientSecret' => (string) ($channel['client_secret'] ?? ''),
            ])
        );
        $token = $r['data']['accessToken'] ?? null;
        if ($r['status'] >= 400 || !is_string($token)) {
            // Surfaça o motivo do iFood (ex.: invalid_client, grant type) p/ diagnóstico.
            $detail = $r['data']['error']['message']
                ?? $r['data']['error_description']
                ?? $r['data']['message']
                ?? (is_string($r['raw'] ?? null) ? substr((string) $r['raw'], 0, 300) : '');
            throw new HttpError(502, "Falha ao autenticar no iFood (HTTP {$r['status']})" . ($detail !== '' ? ": {$detail}" : '.'));
        }
        $expiresIn = (int) ($r['data']['expiresIn'] ?? 3600);
        Db::execute(
            'INSERT INTO channel_tokens (channel_id, access_token, expires_at) VALUES (?, ?, FROM_UNIXTIME(?))
             ON DUPLICATE KEY UPDATE access_token = VALUES(access_token), expires_at = VALUES(expires_at)',
            [$cid, $token, time() + $expiresIn]
        );
        return $token;
    }

    /** @return array<int,string> cabeçalhos com Bearer */
    private static function auth(array $channel): array
    {
        return ['Authorization: Bearer ' . self::token($channel), 'Accept: application/json'];
    }

    /**
     * GET /merchant/v1.0/merchants — lojas vinculadas ao app (para descobrir o merchantId).
     * @return array<int,array{id:string,name:string}>
     */
    public static function merchants(array $channel): array
    {
        if (self::mock()) {
            return [['id' => 'mock-merchant', 'name' => 'Loja Mock']];
        }
        $r = HttpClient::request('GET', self::base() . '/merchant/v1.0/merchants', self::auth($channel));
        if (!is_array($r['data'])) {
            return [];
        }
        return array_map(static fn ($m) => [
            'id' => (string) ($m['id'] ?? ''),
            'name' => (string) ($m['name'] ?? ($m['corporateName'] ?? '')),
        ], $r['data']);
    }

    /**
     * GET /events/v1.0/events:polling — eventos sem ACK do merchant do canal.
     * @return array<int,array<string,mixed>>
     */
    public static function pollEvents(array $channel): array
    {
        if (self::mock()) {
            return [];
        }
        $headers = self::auth($channel);
        $merchant = (string) ($channel['merchant_id'] ?? '');
        if ($merchant !== '') {
            $headers[] = 'x-polling-merchants: ' . $merchant;
        }
        $r = HttpClient::request('GET', self::base() . '/events/v1.0/events:polling', $headers);
        // 204 = sem eventos.
        if ($r['status'] === 204 || !is_array($r['data'])) {
            return [];
        }
        return $r['data'];
    }

    /** POST /events/v1.0/events/acknowledgment — confirma o consumo dos eventos. */
    public static function acknowledge(array $channel, array $eventIds): void
    {
        if (self::mock() || !$eventIds) {
            return;
        }
        $body = array_map(static fn ($id) => ['id' => (string) $id], $eventIds);
        HttpClient::request('POST', self::base() . '/events/v1.0/events/acknowledgment', self::auth($channel), $body);
    }

    /** GET /order/v1.0/orders/{id} — detalhe completo do pedido. */
    public static function getOrder(array $channel, string $orderId): ?array
    {
        if (self::mock()) {
            return null;
        }
        $r = HttpClient::request('GET', self::base() . '/order/v1.0/orders/' . rawurlencode($orderId), self::auth($channel));
        return is_array($r['data']) ? $r['data'] : null;
    }

    /** Envia um comando de status. Lança em falha. */
    public static function command(array $channel, string $orderId, string $command): void
    {
        $action = self::ACTIONS[$command] ?? null;
        if ($action === null) {
            throw HttpError::badRequest("Comando '{$command}' não suportado pelo iFood");
        }
        if (self::mock()) {
            return;
        }
        // Antes de "pronto", inicia o preparo (best-effort): alguns pedidos exigem
        // PREPARATION_STARTED antes de READY_TO_PICKUP. Ignora se já iniciado/recusado.
        if ($command === 'ready') {
            HttpClient::request(
                'POST',
                self::base() . '/order/v1.0/orders/' . rawurlencode($orderId) . '/startPreparation',
                self::auth($channel),
                null,
                10
            );
        }
        // requestCancellation EXIGE corpo { reason, cancellationCode } com um código
        // válido para AQUELE pedido (varia por pedido). Os demais comandos não têm corpo.
        $body = $command === 'cancel' ? self::cancellationBody($channel, $orderId) : null;

        // Timeout curto: falha rápido com erro legível em vez de estourar o gateway (502 cru).
        $r = HttpClient::request(
            'POST',
            self::base() . '/order/v1.0/orders/' . rawurlencode($orderId) . '/' . $action,
            self::auth($channel),
            $body,
            12
        );
        if ($r['status'] === 0) {
            // cURL falhou (timeout/conexão) — NÃO marca como sucesso.
            throw new HttpError(502, "iFood não respondeu a tempo ('{$command}'): " . ($r['error'] ?: 'timeout/conexão'));
        }
        if ($r['status'] >= 400) {
            $detail = $r['data']['error']['message'] ?? $r['data']['message'] ?? (is_string($r['raw'] ?? null) ? substr((string) $r['raw'], 0, 200) : '');
            throw new HttpError(502, "Falha ao enviar '{$command}' ao iFood (HTTP {$r['status']})" . ($detail !== '' ? ": {$detail}" : '.'));
        }
    }

    /** GET cancellationReasons → escolhe um código válido e monta o corpo do cancelamento. */
    private static function cancellationBody(array $channel, string $orderId): array
    {
        $r = HttpClient::request(
            'GET',
            self::base() . '/order/v1.0/orders/' . rawurlencode($orderId) . '/cancellationReasons',
            self::auth($channel)
        );
        $reasons = is_array($r['data']) ? $r['data'] : [];
        $first = $reasons[0] ?? [];
        $code = (string) ($first['cancelCodeId'] ?? $first['code'] ?? $first['id'] ?? '501');
        $desc = (string) ($first['description'] ?? 'Cancelado pela loja');
        return ['reason' => $desc, 'cancellationCode' => $code];
    }

    /** GET /order/v1.0/orders/{id}/tracking — posição/ETA do entregador (entrega própria). */
    public static function tracking(array $channel, string $orderId): ?array
    {
        if (self::mock()) {
            return null;
        }
        $r = HttpClient::request('GET', self::base() . '/order/v1.0/orders/' . rawurlencode($orderId) . '/tracking', self::auth($channel));
        return is_array($r['data']) ? $r['data'] : null;
    }
}
