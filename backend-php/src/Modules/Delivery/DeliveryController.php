<?php

namespace App\Modules\Delivery;

use App\Core\Db;
use App\Core\Env;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Request;
use App\Services\Integrations\IngestService;

/**
 * Painel unificado de pedidos de delivery (iFood + 99Food): listar, detalhar,
 * enviar comandos de status às plataformas, acompanhar entregador e gerir os
 * canais (integrações).
 */
final class DeliveryController
{
    /** Comando de rota → status unificado resultante (e carimbo de tempo). */
    private const RESULT_STATUS = [
        'confirm' => 'confirmed',
        'ready' => 'ready',
        'dispatch' => 'dispatched',
        'cancel' => 'cancelled',
    ];

    // ---- pedidos ----

    public static function listOrders(Request $req): void
    {
        $conditions = [];
        $params = [];
        if (($s = $req->query('status')) !== null) {
            $conditions[] = 'o.status = ?';
            $params[] = $s;
        }
        if (($p = $req->query('platform')) !== null) {
            $conditions[] = 'o.platform = ?';
            $params[] = $p;
        }
        if (($d = $req->query('date')) !== null) {
            $conditions[] = 'DATE(o.created_at) = ?';
            $params[] = $d;
        }
        // Por padrão, esconde finalizados/cancelados antigos do painel operacional.
        if ($req->query('all') === null && !$conditions) {
            $conditions[] = "(o.status NOT IN ('concluded','cancelled') OR o.created_at >= (NOW() - INTERVAL 1 DAY))";
        }
        $where = $conditions ? 'WHERE ' . implode(' AND ', $conditions) : '';
        Http::json(Db::query(
            "SELECT o.*, (SELECT COUNT(*) FROM delivery_order_items i WHERE i.order_id = o.id) AS items_count
               FROM delivery_orders o
               {$where}
               ORDER BY o.created_at DESC",
            $params
        ));
    }

    public static function getOrder(Request $req): void
    {
        Http::json(self::detailed($req->intParam('id')));
    }

    /** POST /delivery/orders/:id/{confirm|ready|dispatch|cancel} */
    public static function command(Request $req, string $command): void
    {
        $id = $req->intParam('id');
        $order = self::row($id);
        $newStatus = self::RESULT_STATUS[$command] ?? null;
        if ($newStatus === null) {
            throw HttpError::badRequest('Comando inválido');
        }

        $channel = self::channelFor($order);
        $client = IngestService::clientFor((string) $order['platform']);
        if ($client === null) {
            throw HttpError::badRequest('Plataforma não suportada');
        }
        // Envia o comando à plataforma (no-op em modo mock).
        $client::command($channel, (string) $order['platform_order_id'], $command);

        // Atualiza estado local + carimbo de tempo da transição.
        $tsCol = ['confirmed' => 'confirmed_at', 'ready' => 'ready_at', 'dispatched' => 'dispatched_at', 'cancelled' => 'cancelled_at'][$newStatus];
        Db::execute("UPDATE delivery_orders SET status = ?, {$tsCol} = COALESCE({$tsCol}, NOW()) WHERE id = ?", [$newStatus, $id]);
        Http::json(self::detailed($id));
    }

    public static function confirm(Request $req): void  { self::command($req, 'confirm'); }
    public static function ready(Request $req): void    { self::command($req, 'ready'); }
    public static function dispatch(Request $req): void { self::command($req, 'dispatch'); }
    public static function cancel(Request $req): void   { self::command($req, 'cancel'); }

    /** GET /delivery/orders/:id/tracking — posição/ETA do entregador. */
    public static function tracking(Request $req): void
    {
        $order = self::row($req->intParam('id'));
        $channel = self::channelFor($order);
        $client = IngestService::clientFor((string) $order['platform']);
        if ($client === null) {
            throw HttpError::badRequest('Plataforma não suportada');
        }
        $data = $client::tracking($channel, (string) $order['platform_order_id']);
        Http::json($data ?? ['available' => false]);
    }

    // ---- canais (integrações) ----

    public static function listChannels(Request $req): void
    {
        $rows = Db::query('SELECT * FROM channels ORDER BY platform, name');
        Http::json(array_map([self::class, 'maskChannel'], $rows));
    }

    public static function createChannel(Request $req): void
    {
        $in = $req->input();
        $platform = $in->enum('platform', ['ifood', '99food'], true);
        $name = $in->requireString('name', 1, 150);
        $id = Db::insertReturning(
            'INSERT INTO channels (platform, name, merchant_id, client_id, client_secret, webhook_secret, active, auto_confirm, extra)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                $platform, $name,
                $in->string('merchant_id'), $in->string('client_id'),
                $in->string('client_secret'), $in->string('webhook_secret'),
                $in->boolean('active', true) ? 1 : 0,
                $in->boolean('auto_confirm', false) ? 1 : 0,
                $in->has('extra') ? json_encode($in->raw('extra'), JSON_UNESCAPED_UNICODE) : null,
            ],
            'channels'
        );
        Http::json(self::maskChannel($id), 201);
    }

    public static function updateChannel(Request $req): void
    {
        $id = $req->intParam('id');
        self::channelRow($id);
        $in = $req->input();
        $fields = [];
        $values = [];
        // client_secret só atualiza quando enviado (não-vazio) — preserva o atual.
        $map = [
            'name' => 'string', 'merchant_id' => 'string', 'client_id' => 'string',
            'client_secret' => 'string', 'webhook_secret' => 'string',
        ];
        foreach ($map as $key => $_) {
            if ($in->has($key)) {
                $val = $in->string($key);
                if ($key === 'client_secret' && $val === null) {
                    continue; // não apaga o segredo
                }
                $fields[] = "{$key} = ?";
                $values[] = $val;
            }
        }
        if ($in->has('active')) {
            $fields[] = 'active = ?';
            $values[] = $in->boolean('active', true) ? 1 : 0;
        }
        if ($in->has('auto_confirm')) {
            $fields[] = 'auto_confirm = ?';
            $values[] = $in->boolean('auto_confirm', false) ? 1 : 0;
        }
        if (!$fields) {
            throw HttpError::badRequest('Nada para atualizar');
        }
        $values[] = $id;
        Db::execute('UPDATE channels SET ' . implode(', ', $fields) . ' WHERE id = ?', $values);
        Http::json(self::maskChannel($id));
    }

    /** POST /delivery/channels/:id/test — testa autenticação na plataforma. */
    public static function testChannel(Request $req): void
    {
        $channel = self::channelRow($req->intParam('id'));
        $client = IngestService::clientFor((string) $channel['platform']);
        if ($client === null) {
            throw HttpError::badRequest('Plataforma não suportada');
        }
        try {
            $token = $client::token($channel);
            // Lista as lojas para o usuário descobrir/conferir o merchantId.
            $merchants = method_exists($client, 'merchants') ? $client::merchants($channel) : [];
            Http::json(['ok' => $token !== '', 'authenticated' => true, 'merchants' => $merchants]);
        } catch (\Throwable $e) {
            Http::json(['ok' => false, 'authenticated' => false, 'error' => $e->getMessage()]);
        }
    }

    /** POST /delivery/sync — poll+ACK sob demanda pela UI (admin). Útil sem cron/deploy. */
    public static function sync(Request $req): void
    {
        Http::json(['ok' => true, 'channels' => IngestService::poll()]);
    }

    /** POST /delivery/poll — dispara poll+ACK. Protegido por token interno (cron). */
    public static function poll(Request $req): void
    {
        $expected = (string) Env::get('DELIVERY_POLL_TOKEN', '');
        $got = $_SERVER['HTTP_X_POLL_TOKEN'] ?? $req->query('token');
        if ($expected === '' || !is_string($got) || !hash_equals($expected, $got)) {
            throw HttpError::unauthorized('Token de polling inválido');
        }
        Http::json(['ok' => true, 'channels' => IngestService::poll()]);
    }

    // ---- helpers ----

    private static function row(int $id): array
    {
        $o = Db::queryOne('SELECT * FROM delivery_orders WHERE id = ?', [$id]);
        if (!$o) {
            throw HttpError::notFound('Pedido não encontrado');
        }
        return $o;
    }

    private static function detailed(int $id): array
    {
        $order = self::row($id);
        $order['items'] = Db::query('SELECT * FROM delivery_order_items WHERE order_id = ? ORDER BY id', [$id]);
        return $order;
    }

    private static function channelFor(array $order): array
    {
        if ($order['channel_id']) {
            $c = Db::queryOne('SELECT * FROM channels WHERE id = ?', [$order['channel_id']]);
            if ($c) {
                return $c;
            }
        }
        $c = IngestService::findChannel((string) $order['platform'], $order['merchant_id'] ?? null);
        if (!$c) {
            throw HttpError::badRequest('Nenhum canal ativo configurado para esta plataforma');
        }
        return $c;
    }

    private static function channelRow(int $id): array
    {
        $c = Db::queryOne('SELECT * FROM channels WHERE id = ?', [$id]);
        if (!$c) {
            throw HttpError::notFound('Canal não encontrado');
        }
        return $c;
    }

    /** Não expõe o client_secret; indica se há um configurado. */
    private static function maskChannel(array|int $channel): array
    {
        if (is_int($channel)) {
            $channel = Db::queryOne('SELECT * FROM channels WHERE id = ?', [$channel]) ?? [];
        }
        $channel['has_client_secret'] = !empty($channel['client_secret']);
        unset($channel['client_secret']);
        return $channel;
    }
}
