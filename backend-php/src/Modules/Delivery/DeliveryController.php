<?php

namespace App\Modules\Delivery;

use App\Core\Db;
use App\Core\Env;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Request;
use App\Services\Integrations\IngestService;
use App\Services\Integrations\IfoodClient;
use App\Services\Integrations\NineNineClient;
use App\Services\DeliveryStock;
use App\Services\GeoService;

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
        // Painel do dia: sempre mostra os pedidos que ainda exigem ação da loja
        // (placed/confirmed/preparing/ready — qualquer data, p/ não perder pedido em
        // aberto na virada). Os demais (a caminho, concluídos, cancelados) só aparecem
        // se forem de HOJE. Ao virar o dia (meia-noite local — o MySQL roda em
        // America/Sao_Paulo), os de ontem saem sozinhos da tela.
        if ($req->query('all') === null && !$conditions) {
            $conditions[] = "(o.status IN ('placed','confirmed','preparing','ready') OR DATE(o.created_at) = CURDATE())";
        }
        $conditions[] = 'o.org_id = ?';
        $params[] = $req->orgId();
        $where = 'WHERE ' . implode(' AND ', $conditions);
        $rows = Db::query(
            "SELECT o.*, (SELECT COUNT(*) FROM delivery_order_items i WHERE i.order_id = o.id) AS items_count
               FROM delivery_orders o
               {$where}
               ORDER BY o.created_at DESC",
            $params
        );
        Http::json(array_map([self::class, 'hydrate'], $rows));
    }

    public static function getOrder(Request $req): void
    {
        $id = $req->intParam('id');
        // Gate de tenant antes do detalhe.
        if (!Db::queryOne('SELECT id FROM delivery_orders WHERE id = ? AND org_id = ?', [$id, $req->orgId()])) {
            throw HttpError::notFound('Pedido não encontrado');
        }
        Http::json(self::detailed($id));
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

        // Baixa de estoque pela ficha técnica: confirmar consome os insumos (do prato E
        // dos complementos escolhidos); cancelar estorna. Idempotente, opt-in (só mexe
        // no que está mapeado a um produto) e best-effort — o sync nunca lança, para a
        // transição de status não falhar por causa do estoque (ver DeliveryStock).
        DeliveryStock::sync($req->orgId(), $id, $req->userId());

        Http::json(self::detailed($id));
    }

    public static function confirm(Request $req): void  { self::command($req, 'confirm'); }
    public static function ready(Request $req): void    { self::command($req, 'ready'); }
    public static function dispatch(Request $req): void { self::command($req, 'dispatch'); }
    public static function cancel(Request $req): void   { self::command($req, 'cancel'); }

    /**
     * POST /delivery/orders/:id/conclude — fecha o pedido no painel (status 'concluded').
     * É LOCAL, não chama a plataforma: o iFood não expõe comando de "concluir" (o
     * CONCLUDED é status que a própria plataforma emite) e, na entrega própria, esse
     * evento nem sempre chega — deixando o pedido preso em 'A caminho' aqui e em
     * 'Pronto' no painel de Vendas. Espelha a rede de segurança do autoConcludeSweep,
     * só que acionada na hora pelo operador. Não regride estado terminal.
     */
    public static function conclude(Request $req): void
    {
        $id = $req->intParam('id');
        if (!Db::queryOne('SELECT id FROM delivery_orders WHERE id = ? AND org_id = ?', [$id, $req->orgId()])) {
            throw HttpError::notFound('Pedido não encontrado');
        }
        Db::execute(
            "UPDATE delivery_orders SET status = 'concluded', concluded_at = COALESCE(concluded_at, NOW())
              WHERE id = ? AND status NOT IN ('concluded', 'cancelled')",
            [$id]
        );
        Http::json(self::detailed($id));
    }

    /**
     * POST /delivery/orders/:id/printed — reivindica a impressão da comanda.
     * Atômico: só o primeiro cliente a chamar "reivindica" (claimed=true); os demais
     * (ex.: painel aberto em 2 telas) recebem claimed=false e não reimprimem.
     */
    public static function markPrinted(Request $req): void
    {
        $id = $req->intParam('id');
        self::row($id); // 404 se não existir
        $claimed = Db::execute('UPDATE delivery_orders SET printed_at = NOW() WHERE id = ? AND printed_at IS NULL', [$id]) > 0;
        Http::json(['claimed' => $claimed]);
    }

    /**
     * POST /delivery/orders/:id/print-reset — desfaz a reivindicação de impressão.
     * O auto-print RESERVA o pedido (markPrinted) ANTES de mandar pra impressora; se a
     * impressão falhar (QZ offline etc.), este reset libera o pedido pra nova tentativa,
     * sem deixá-lo marcado como impresso sem ter saído papel.
     */
    public static function resetPrinted(Request $req): void
    {
        $id = $req->intParam('id');
        self::row($id); // 404 se não existir
        Db::execute('UPDATE delivery_orders SET printed_at = NULL WHERE id = ?', [$id]);
        Http::json(['ok' => true]);
    }

    /**
     * PATCH /delivery/orders/:id/address — corrige o bairro do pedido depois de ver
     * a localização real no mapa. Preserva o valor original (1ª correção) para auditoria.
     */
    /**
     * PATCH /delivery/orders/:id/address — corrige o endereço de entrega.
     *
     * Aceita o bairro (uso original), os demais campos do endereço e ainda `lat`/`lng`
     * para o operador FIXAR o ponto à mão. O pin manual é a saída para os endereços que
     * o OpenStreetMap simplesmente não conhece: sem ele o pedido ficava sem coordenada
     * para sempre, e sem coordenada não havia marcador — logo, não havia como editar.
     */
    public static function updateAddress(Request $req): void
    {
        $id = $req->intParam('id');
        $order = self::row($id);
        $in = $req->input();

        $addr = json_decode((string) ($order['delivery_address'] ?? 'null'), true);
        if (!is_array($addr)) {
            // Endereço ausente deixa de ser beco sem saída: começa um do zero.
            $addr = [];
        }

        if ($in->has('neighborhood')) {
            $neighborhood = $in->requireString('neighborhood', 1, 120);
            if (!isset($addr['neighborhood_original']) && ($addr['neighborhood'] ?? null) !== null) {
                $addr['neighborhood_original'] = $addr['neighborhood'];
            }
            $addr['neighborhood'] = $neighborhood;
            $addr['neighborhood_corrected_at'] = date('c');
            if (isset($addr['suggested_neighborhood']) && is_string($addr['suggested_neighborhood'])
                && mb_strtolower(trim($neighborhood)) === mb_strtolower(trim($addr['suggested_neighborhood']))) {
                $addr['neighborhood_mismatch'] = false;
            }
        }

        // Grava na MESMA grafia que já existe no pedido, para não acabar com `street` e
        // `streetName` convivendo no mesmo JSON e a leitura pegar o valor velho.
        $addressChanged = false;
        foreach ([
            'street' => ['street', 'streetName', 'street_name'],
            'number' => ['number', 'streetNumber', 'street_number'],
            'complement' => ['complement'],
            'city' => ['city'],
            'state' => ['state'],
        ] as $field => $keys) {
            if (!$in->has($field)) {
                continue;
            }
            $value = trim((string) $in->string($field));
            $target = $keys[0];
            foreach ($keys as $k) {
                if (array_key_exists($k, $addr)) {
                    $target = $k;
                    break;
                }
            }
            if ((string) ($addr[$target] ?? '') !== $value) {
                $addressChanged = true;
            }
            $addr[$target] = $value !== '' ? $value : null;
        }

        // Pin manual: coordenada dada pelo operador vence qualquer geocodificação e não
        // pode ser sobrescrita pelo backfill (por isso `geocode_source = manual`).
        $pinned = false;
        if ($in->has('lat') && $in->has('lng')) {
            $lat = (float) $in->number('lat');
            $lng = (float) $in->number('lng');
            if ($lat < -90 || $lat > 90 || $lng < -180 || $lng > 180) {
                throw HttpError::badRequest('Coordenada inválida');
            }
            $addr['lat'] = $lat;
            $addr['lng'] = $lng;
            $addr['geocode_source'] = 'manual';
            $addr['geocode_precision'] = 'manual';
            $addr['geocoded_at'] = date('c');
            unset($addr['geocode_failed']);
            $pinned = true;
        } elseif ($addressChanged) {
            // Endereço novo merece nova tentativa: sem limpar o carimbo, o backfill
            // continuaria pulando este pedido para sempre.
            unset($addr['geocode_failed']);
        }

        Db::execute('UPDATE delivery_orders SET delivery_address = ? WHERE id = ?', [
            json_encode($addr, JSON_UNESCAPED_UNICODE), $id,
        ]);

        // Com o ponto fixado à mão, o bairro sugerido vem da coordenada real.
        if ($pinned && !$in->has('neighborhood')) {
            GeoService::suggestNeighborhood($id, $addr, (float) $addr['lat'], (float) $addr['lng']);
        }

        Http::json(self::detailed($id));
    }

    /** POST /delivery/orders/:id/geocode — tenta localizar UM pedido agora. */
    public static function geocodeOrder(Request $req): void
    {
        $id = $req->intParam('id');
        self::row($id); // valida existência/organização
        Http::json(GeoService::geocodeOrder($id, $req->orgId()));
    }

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

    // ---- alertas (solicitações de cancelamento do cliente) ----

    public static function listAlerts(Request $req): void
    {
        // Casa o pedido por FK OU por (plataforma, id da plataforma) — o alerta pode
        // chegar antes do pedido (order_id nulo). Esconde alertas cujo pedido já está
        // cancelado/concluído: a solicitação virou sem sentido (ex.: resolvida no app).
        Http::json(Db::query(
            "SELECT a.*, o.display_id, o.customer_name, o.customer_paid
               FROM delivery_alerts a
               LEFT JOIN delivery_orders o
                 ON o.id = a.order_id
                 OR (o.platform = a.platform AND o.platform_order_id = a.platform_order_id)
              WHERE a.status = 'pending'
                AND a.org_id = ?
                AND (o.id IS NULL OR o.status NOT IN ('cancelled', 'concluded'))
              ORDER BY a.created_at DESC",
            [$req->orgId()]
        ));
    }

    public static function acceptAlert(Request $req): void { self::resolveAlert($req, true); }
    public static function rejectAlert(Request $req): void { self::resolveAlert($req, false); }

    private static function resolveAlert(Request $req, bool $accept): void
    {
        $id = $req->intParam('id');
        $a = Db::queryOne('SELECT * FROM delivery_alerts WHERE id = ? AND org_id = ?', [$id, $req->orgId()]);
        if (!$a) {
            throw HttpError::notFound('Alerta não encontrado');
        }
        if ($a['status'] !== 'pending') {
            throw HttpError::badRequest('Este alerta já foi resolvido');
        }
        $platform = (string) $a['platform'];
        $reason = $req->input()->string('reason') ?? '';

        $order = Db::queryOne('SELECT * FROM delivery_orders WHERE platform = ? AND platform_order_id = ?', [$platform, $a['platform_order_id']]);
        $channel = $order ? self::channelFor($order) : IngestService::findChannel($platform);
        if (!$channel) {
            throw HttpError::badRequest('Nenhum canal ativo para esta plataforma');
        }

        if ($platform === '99food') {
            NineNineClient::resolveCancellation($channel, (string) $a['platform_order_id'], (string) $a['external_id'], $accept, $reason);
        } else {
            IfoodClient::resolveDispute($channel, (string) $a['external_id'], $accept, $reason);
        }

        Db::execute(
            'UPDATE delivery_alerts SET status = ?, resolved_at = NOW() WHERE id = ?',
            [$accept ? 'accepted' : 'rejected', $id]
        );
        Http::json(['ok' => true, 'status' => $accept ? 'accepted' : 'rejected']);
    }

    // ---- canais (integrações) ----

    public static function listChannels(Request $req): void
    {
        $rows = Db::query('SELECT * FROM channels WHERE org_id = ? ORDER BY platform, name', [$req->orgId()]);
        Http::json(array_map([self::class, 'maskChannel'], $rows));
    }

    public static function createChannel(Request $req): void
    {
        $in = $req->input();
        $platform = $in->enum('platform', ['ifood', '99food'], true);
        $name = $in->requireString('name', 1, 150);
        $id = Db::insertReturning(
            'INSERT INTO channels (org_id, platform, name, merchant_id, client_id, client_secret, webhook_secret, active, auto_confirm, commission_rate, extra)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                $req->orgId(), $platform, $name,
                $in->string('merchant_id'), $in->string('client_id'),
                $in->string('client_secret'), $in->string('webhook_secret'),
                $in->boolean('active', true) ? 1 : 0,
                $in->boolean('auto_confirm', false) ? 1 : 0,
                (float) ($in->number('commission_rate') ?? 0),
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
        if ($in->has('commission_rate')) {
            $fields[] = 'commission_rate = ?';
            $values[] = (float) ($in->number('commission_rate') ?? 0);
        }
        if (!$fields) {
            throw HttpError::badRequest('Nada para atualizar');
        }
        $values[] = $id;
        Db::execute('UPDATE channels SET ' . implode(', ', $fields) . ' WHERE id = ?', $values);
        // Trocar credenciais/loja invalida o token em cache (senão reusa o token antigo).
        if ($in->has('client_id') || $in->has('client_secret') || $in->has('merchant_id')) {
            Db::execute('DELETE FROM channel_tokens WHERE channel_id = ?', [$id]);
        }
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

    /** POST /delivery/channels/:id/authorization-url — link de autorização/bind da loja (99food). */
    public static function authorizationUrl(Request $req): void
    {
        $channel = self::channelRow($req->intParam('id'));
        if ((string) $channel['platform'] !== '99food') {
            throw HttpError::badRequest('Link de autorização disponível apenas para canais 99Food');
        }
        Http::json(['url' => NineNineClient::authorizationUrl($channel)]);
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
        $order = self::hydrate(self::row($id));
        $items = Db::query('SELECT * FROM delivery_order_items WHERE order_id = ? ORDER BY id', [$id]);
        // options é JSON armazenado como texto; decodifica p/ o frontend receber os
        // complementos como objeto (mesmo motivo do delivery_address em hydrate()).
        foreach ($items as &$it) {
            if (isset($it['options']) && is_string($it['options'])) {
                $decoded = json_decode($it['options'], true);
                $it['options'] = is_array($decoded) ? $decoded : null;
            }
        }
        unset($it);
        $order['items'] = $items;
        return $order;
    }

    /**
     * A coluna delivery_address é JSON armazenado como texto; sem decodificar, o
     * Http::json reencoda e o frontend recebe uma STRING escapada em vez do objeto.
     * Decodifica aqui pro endereço chegar como objeto.
     */
    private static function hydrate(array $order): array
    {
        if (isset($order['delivery_address']) && is_string($order['delivery_address'])) {
            $decoded = json_decode($order['delivery_address'], true);
            $order['delivery_address'] = is_array($decoded) ? $decoded : null;
        }
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
