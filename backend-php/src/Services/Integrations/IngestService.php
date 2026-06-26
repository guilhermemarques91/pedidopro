<?php

namespace App\Services\Integrations;

use App\Core\Db;
use App\Core\Env;
use PDO;

/**
 * Núcleo idempotente de ingestão. Recebe eventos (webhook OU polling),
 * deduplica em channel_events e faz upsert em delivery_orders.
 *
 * Idempotência: UNIQUE(platform, event_id) em channel_events. Se o mesmo evento
 * chegar pelos dois caminhos (webhook e polling), o segundo é ignorado.
 */
final class IngestService
{
    /** @return class-string<IfoodClient>|class-string<NineNineClient>|null */
    public static function clientFor(string $platform): ?string
    {
        return $platform === 'ifood' ? IfoodClient::class : ($platform === '99food' ? NineNineClient::class : null);
    }

    /** Canal ativo da plataforma (opcionalmente por merchant). */
    public static function findChannel(string $platform, ?string $merchantId = null): ?array
    {
        if ($merchantId) {
            $c = Db::queryOne('SELECT * FROM channels WHERE platform = ? AND merchant_id = ? AND active = 1', [$platform, $merchantId]);
            if ($c) {
                return $c;
            }
        }
        return Db::queryOne('SELECT * FROM channels WHERE platform = ? AND active = 1 ORDER BY id LIMIT 1', [$platform]);
    }

    /**
     * Processa o corpo de um webhook: extrai os eventos e ingere cada um.
     * @return array{processed:int,duplicated:int}
     */
    public static function handleWebhook(string $platform, array $body, array $channel): array
    {
        $events = self::extractEvents($body);
        $processed = 0;
        $duplicated = 0;
        foreach ($events as $event) {
            $r = self::ingestEvent($platform, $event, $channel, 'webhook');
            $r === 'duplicate' ? $duplicated++ : $processed++;
        }
        return ['processed' => $processed, 'duplicated' => $duplicated];
    }

    /**
     * Ingere um único evento. Retorna 'ingested' ou 'duplicate'.
     */
    public static function ingestEvent(string $platform, array $event, array $channel, string $source): string
    {
        [$eventId, $orderId, $statusRaw, $fullOrder] = self::extract($platform, $event);
        if ($orderId === '') {
            return 'ingested'; // evento sem pedido (keepalive/etc.) — nada a fazer
        }

        // Dedup: INSERT IGNORE; rowCount 0 = já visto.
        $inserted = Db::execute(
            'INSERT IGNORE INTO channel_events (platform, event_id, order_id, type, source, payload)
             VALUES (?, ?, ?, ?, ?, ?)',
            [$platform, $eventId, $orderId, $statusRaw, $source, json_encode($event, JSON_UNESCAPED_UNICODE)]
        );
        if ($inserted === 0) {
            return 'duplicate';
        }

        // Garante o detalhe completo do pedido quando o evento não o traz.
        if ($fullOrder === null) {
            $client = self::clientFor($platform);
            if ($client !== null) {
                $fullOrder = $client::getOrder($channel, $orderId);
            }
        }

        if (is_array($fullOrder) && !empty($fullOrder)) {
            $normalized = OrderNormalizer::normalize($platform, $fullOrder);
        } else {
            // Sem detalhe (ex.: mock ou status-only): grava o mínimo do evento.
            $normalized = [
                'order' => [
                    'platform_order_id' => $orderId,
                    'platform_status' => $statusRaw,
                    'status' => OrderNormalizer::mapStatus($platform, $statusRaw),
                ],
                'items' => [],
                'customer' => [],
            ];
        }

        // O evento é a autoridade da transição de status (essencial p/ 99Food, cujo
        // status no detalhe é numérico/ambíguo). Só sobrescreve quando reconhecido.
        $eventStatus = OrderNormalizer::statusFromRaw($platform, $statusRaw);
        if ($eventStatus !== null) {
            $normalized['order']['status'] = $eventStatus;
        }

        self::upsert($platform, $channel, $normalized, $fullOrder ?? $event);

        // Aceite automático: confirma pedidos novos assim que chegam, se o canal pedir.
        if (($normalized['order']['status'] ?? null) === 'placed') {
            self::maybeAutoConfirm($platform, $channel, $orderId);
        }

        Db::execute('UPDATE channel_events SET processed_at = NOW() WHERE platform = ? AND event_id = ?', [$platform, $eventId]);
        return 'ingested';
    }

    /** Faz poll+ACK de todos os canais ativos. Rede de segurança do webhook. */
    public static function poll(): array
    {
        $summary = [];
        foreach (Db::query('SELECT * FROM channels WHERE active = 1') as $channel) {
            $platform = (string) $channel['platform'];
            $client = self::clientFor($platform);
            if ($client === null) {
                continue;
            }
            $events = $client::pollEvents($channel);
            $ids = [];
            $ingested = 0;
            $dup = 0;
            foreach ($events as $event) {
                $r = self::ingestEvent($platform, $event, $channel, 'polling');
                $r === 'duplicate' ? $dup++ : $ingested++;
                if (isset($event['id'])) {
                    $ids[] = $event['id'];
                }
            }
            $client::acknowledge($channel, $ids);
            // Rede de segurança: garante que todo pedido em 'placed' do canal seja confirmado.
            self::autoConfirmSweep($channel);
            $summary[] = ['channel' => $channel['name'], 'platform' => $platform, 'ingested' => $ingested, 'duplicated' => $dup];
        }
        // Conclusão automática (homologação) — local, gated por env.
        self::autoConcludeSweep();
        return $summary;
    }

    /** Aceite automático inline (no momento da ingestão de um pedido novo). */
    private static function maybeAutoConfirm(string $platform, array $channel, string $orderId): void
    {
        if (Env::bool('INTEGRATIONS_MOCK', false)) {
            return;
        }
        if (empty($channel['auto_confirm'])) {
            self::log("auto-confirm PULADO ({$platform} {$orderId}): auto_confirm desligado no canal");
            return;
        }
        self::confirmOne($platform, $channel, $orderId);
    }

    /**
     * Rede de segurança: confirma TODOS os pedidos ainda em 'placed' do canal (auto_confirm),
     * independentemente de qual evento os trouxe. Roda a cada ciclo de polling.
     */
    private static function autoConfirmSweep(array $channel): void
    {
        if (empty($channel['auto_confirm']) || Env::bool('INTEGRATIONS_MOCK', false)) {
            return;
        }
        $platform = (string) $channel['platform'];
        $pending = Db::query(
            "SELECT platform_order_id FROM delivery_orders
              WHERE channel_id = ? AND status = 'placed' AND created_at >= (NOW() - INTERVAL 6 HOUR)",
            [(int) $channel['id']]
        );
        foreach ($pending as $o) {
            self::confirmOne($platform, $channel, (string) $o['platform_order_id']);
        }
    }

    /**
     * Confirma um pedido na plataforma e marca confirmado localmente — só se ainda
     * estiver em 'placed' (evita reconfirmar). Best-effort: não interrompe a ingestão.
     */
    private static function confirmOne(string $platform, array $channel, string $orderId): void
    {
        $cur = Db::queryOne('SELECT status FROM delivery_orders WHERE platform = ? AND platform_order_id = ?', [$platform, $orderId]);
        if (($cur['status'] ?? null) !== 'placed') {
            return;
        }
        $client = self::clientFor($platform);
        if ($client === null) {
            return;
        }
        try {
            $client::command($channel, $orderId, 'confirm');
            Db::execute(
                "UPDATE delivery_orders SET status = 'confirmed', confirmed_at = COALESCE(confirmed_at, NOW())
                 WHERE platform = ? AND platform_order_id = ? AND status = 'placed'",
                [$platform, $orderId]
            );
            self::log("auto-confirm OK ({$platform} {$orderId})");
        } catch (\Throwable $e) {
            self::log("auto-confirm FALHOU ({$platform} {$orderId}): " . $e->getMessage());
            error_log('[delivery] auto-confirm falhou (' . $platform . ' ' . $orderId . '): ' . $e->getMessage());
        }
    }

    /**
     * Conclusão automática (homologação): move 'dispatched' → 'concluded' após
     * DELIVERY_AUTO_CONCLUDE_MIN minutos. É LOCAL (não chama a plataforma). 0 = off.
     * Em produção fica off — o evento CONCLUDED real do iFood conclui o pedido.
     */
    private static function autoConcludeSweep(): void
    {
        $min = Env::int('DELIVERY_AUTO_CONCLUDE_MIN', 0);
        if ($min <= 0) {
            return;
        }
        $n = Db::execute(
            "UPDATE delivery_orders SET status = 'concluded', concluded_at = COALESCE(concluded_at, NOW())
              WHERE status = 'dispatched' AND dispatched_at < (NOW() - INTERVAL ? MINUTE)",
            [$min]
        );
        if ($n > 0) {
            self::log("auto-conclude: {$n} pedido(s) despachado(s) há >{$min}min marcados como concluídos");
        }
    }

    /** Log visível no poll.log (apenas em CLI; em web iria corromper a resposta HTTP). */
    private static function log(string $msg): void
    {
        if (PHP_SAPI === 'cli') {
            fwrite(STDOUT, '[' . date('Y-m-d H:i:s') . '] ' . $msg . "\n");
        }
    }

    // ---- helpers ----

    /** Normaliza o corpo do webhook numa lista de eventos. */
    private static function extractEvents(array $body): array
    {
        if (isset($body['events']) && is_array($body['events'])) {
            return $body['events'];
        }
        // Lista direta de eventos?
        if (array_is_list($body) && $body !== []) {
            return $body;
        }
        return [$body]; // evento/pedido único
    }

    /**
     * Extrai (eventId, orderId, statusRaw, fullOrder|null) de um evento.
     * @return array{0:string,1:string,2:?string,3:?array}
     */
    private static function extract(string $platform, array $event): array
    {
        if ($platform === '99food') {
            return self::extract99food($event);
        }

        $orderId = (string) ($event['orderId'] ?? $event['order']['id'] ?? '');
        if ($orderId === '' && isset($event['id'])) {
            // Webhook de pedido completo (ou evento sem orderId): o id é o do pedido.
            $orderId = (string) $event['id'];
        }
        $statusRaw = $event['fullCode'] ?? $event['code'] ?? $event['status'] ?? ($event['order']['status'] ?? null);
        $eventId = (string) ($event['id'] ?? ($orderId . ':' . ($statusRaw ?? '')));

        // Pedido completo embutido?
        $fullOrder = null;
        if (isset($event['order']) && is_array($event['order'])) {
            $fullOrder = $event['order'];
        } elseif (isset($event['items']) && is_array($event['items'])) {
            $fullOrder = $event; // o próprio payload é o pedido
        }

        return [$eventId, $orderId, $statusRaw !== null ? (string) $statusRaw : null, $fullOrder];
    }

    /**
     * Callback do 99Food/DiDi: { event: orderNew|orderFinish|orderCancel, order_id, app_shop_id }.
     * Sempre buscamos o detalhe via getOrder (o callback não traz o pedido completo).
     * @return array{0:string,1:string,2:?string,3:?array}
     */
    private static function extract99food(array $event): array
    {
        $orderId = (string) ($event['order_id'] ?? $event['orderId'] ?? ($event['data']['order_id'] ?? ''));
        $type = $event['event'] ?? $event['event_type'] ?? $event['type'] ?? null;
        $eventId = (string) ($event['id'] ?? $event['event_id'] ?? ($orderId . ':' . ($type ?? '')));
        return [$eventId, $orderId, $type !== null ? (string) $type : null, null];
    }

    /** UPSERT do pedido normalizado (+ itens + cliente) numa transação. */
    private static function upsert(string $platform, array $channel, array $normalized, mixed $raw): void
    {
        $o = $normalized['order'];
        $status = $o['status'] ?? 'placed';

        Db::transaction(function (PDO $pdo) use ($platform, $channel, $normalized, $o, $status, $raw): void {
            // Cliente (para "novos vs recorrentes").
            $customerId = self::upsertCustomer($pdo, $platform, $normalized['customer'] ?? []);

            // Carimbo de tempo da transição de status atual.
            $tsCol = [
                'confirmed' => 'confirmed_at', 'preparing' => 'ready_at', 'ready' => 'ready_at',
                'dispatched' => 'dispatched_at', 'concluded' => 'concluded_at', 'cancelled' => 'cancelled_at',
            ][$status] ?? null;

            $cols = [
                'channel_id' => (int) $channel['id'],
                'platform' => $platform,
                'platform_order_id' => (string) $o['platform_order_id'],
                'display_id' => $o['display_id'] ?? null,
                'merchant_id' => $o['merchant_id'] ?? ($channel['merchant_id'] ?? null),
                'status' => $status,
                'platform_status' => $o['platform_status'] ?? null,
                'order_type' => $o['order_type'] ?? 'delivery',
                'delivery_mode' => $o['delivery_mode'] ?? null,
                'delivery_address' => isset($o['delivery_address']) ? json_encode($o['delivery_address'], JSON_UNESCAPED_UNICODE) : null,
                'delivery_distance_m' => $o['delivery_distance_m'] ?? null,
                'eta' => $o['eta'] ?? null,
                'customer_id' => $customerId,
                'customer_name' => $o['customer_name'] ?? null,
                'customer_phone' => $o['customer_phone'] ?? null,
                'items_amount' => $o['items_amount'] ?? null,
                'delivery_fee' => $o['delivery_fee'] ?? null,
                'discount_merchant' => $o['discount_merchant'] ?? null,
                'discount_platform' => $o['discount_platform'] ?? null,
                'customer_paid' => $o['customer_paid'] ?? null,
                'commission' => $o['commission'] ?? null,
                'net_amount' => $o['net_amount'] ?? null,
                'placed_at' => $o['placed_at'] ?? null,
                'raw' => json_encode($raw, JSON_UNESCAPED_UNICODE),
            ];

            // Campos "ricos" não devem ser sobrescritos por null em eventos status-only.
            $coalesce = [
                'display_id', 'merchant_id', 'order_type', 'delivery_mode', 'delivery_address',
                'delivery_distance_m', 'eta', 'customer_id', 'customer_name', 'customer_phone',
                'items_amount', 'delivery_fee', 'discount_merchant', 'discount_platform',
                'customer_paid', 'commission', 'net_amount', 'placed_at',
            ];
            // Status é MONOTÔNICO: só avança (placed→…→concluded). Evita que um evento
            // reenviado/fora de ordem jogue o pedido pra trás (ex.: confirmado→novos).
            // 'cancelled' é terminal e sempre vence; estado terminal atual não muda.
            $ord = "'placed','confirmed','preparing','ready','dispatched','concluded'";
            $statusExpr = 'status = CASE'
                . " WHEN status IN ('cancelled','concluded') THEN status"
                . " WHEN VALUES(status) = 'cancelled' THEN 'cancelled'"
                . " WHEN FIELD(VALUES(status), {$ord}) > 0 AND FIELD(VALUES(status), {$ord}) >= FIELD(status, {$ord}) THEN VALUES(status)"
                . ' ELSE status END';

            $names = array_keys($cols);
            $place = implode(', ', array_fill(0, count($names), '?'));
            $updates = [];
            foreach ($names as $n) {
                if (in_array($n, ['platform', 'platform_order_id'], true)) {
                    continue;
                }
                if ($n === 'status') {
                    $updates[] = $statusExpr;
                    continue;
                }
                $updates[] = in_array($n, $coalesce, true)
                    ? "{$n} = COALESCE(VALUES({$n}), {$n})"
                    : "{$n} = VALUES({$n})";
            }
            if ($tsCol !== null) {
                $updates[] = "{$tsCol} = COALESCE({$tsCol}, NOW())";
            }

            $sql = 'INSERT INTO delivery_orders (' . implode(', ', $names) . ') VALUES (' . $place . ')'
                 . ' ON DUPLICATE KEY UPDATE ' . implode(', ', $updates);
            $stmt = $pdo->prepare($sql);
            $stmt->execute(array_values($cols));

            $orderRowId = (int) $pdo->lastInsertId();
            if ($orderRowId === 0) {
                $row = Db::queryOne('SELECT id FROM delivery_orders WHERE platform = ? AND platform_order_id = ?', [$platform, $cols['platform_order_id']]);
                $orderRowId = (int) ($row['id'] ?? 0);
            }
            // Carimbo da transição também no INSERT inicial (quando aplicável).
            if ($tsCol !== null && $orderRowId > 0) {
                $pdo->prepare("UPDATE delivery_orders SET {$tsCol} = COALESCE({$tsCol}, NOW()) WHERE id = ?")->execute([$orderRowId]);
            }

            // Itens: só substitui quando o payload trouxe itens (não apaga em status-only).
            $items = $normalized['items'] ?? [];
            if ($items && $orderRowId > 0) {
                $pdo->prepare('DELETE FROM delivery_order_items WHERE order_id = ?')->execute([$orderRowId]);
                $ins = $pdo->prepare('INSERT INTO delivery_order_items (order_id, name, quantity, unit_price, total, observations, options) VALUES (?, ?, ?, ?, ?, ?, ?)');
                foreach ($items as $it) {
                    $ins->execute([
                        $orderRowId,
                        $it['name'],
                        $it['quantity'],
                        $it['unit_price'],
                        $it['total'],
                        $it['observations'] ?? null,
                        isset($it['options']) ? json_encode($it['options'], JSON_UNESCAPED_UNICODE) : null,
                    ]);
                }
            }
        });
    }

    /** Upsert do cliente; incrementa orders_count na primeira vez que o pedido aparece. */
    private static function upsertCustomer(PDO $pdo, string $platform, array $c): ?int
    {
        $pid = $c['platform_customer_id'] ?? null;
        if (!$pid) {
            return null;
        }
        $pdo->prepare(
            'INSERT INTO delivery_customers (platform, platform_customer_id, name, phone, first_order_at, last_order_at, orders_count)
             VALUES (?, ?, ?, ?, NOW(), NOW(), 1)
             ON DUPLICATE KEY UPDATE
               name = COALESCE(VALUES(name), name),
               phone = COALESCE(VALUES(phone), phone),
               last_order_at = NOW()'
        )->execute([$platform, $pid, $c['name'] ?? null, $c['phone'] ?? null]);
        $row = Db::queryOne('SELECT id FROM delivery_customers WHERE platform = ? AND platform_customer_id = ?', [$platform, $pid]);
        return $row ? (int) $row['id'] : null;
    }
}
