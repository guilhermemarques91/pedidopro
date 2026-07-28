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

        // Solicitação de cancelamento do cliente (best-effort; não interrompe a ingestão).
        self::detectCancellationAlert($platform, $event, $orderId);

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
            // 99Food não tem polling de eventos: reconcilia o estado dos pedidos ativos
            // direto no order/detail (conclui/cancela pelos timestamps), pra callback
            // perdido não deixar pedido preso no painel.
            $reconciled = $platform === '99food' ? self::reconcile99food($channel) : 0;
            $summary[] = ['channel' => $channel['name'], 'platform' => $platform, 'ingested' => $ingested, 'duplicated' => $dup, 'reconciled' => $reconciled];
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
        // $min é inteiro saneado (Env::int); inline evita placeholder em INTERVAL (gotcha do MySQL).
        $n = Db::execute(
            "UPDATE delivery_orders SET status = 'concluded', concluded_at = COALESCE(concluded_at, NOW())
              WHERE status = 'dispatched' AND dispatched_at < (NOW() - INTERVAL {$min} MINUTE)",
            []
        );
        if ($n > 0) {
            self::log("auto-conclude: {$n} pedido(s) despachado(s) há >{$min}min marcados como concluídos");
        }
    }

    /**
     * Reconciliação de estado do 99Food (que não tem polling de eventos): busca o
     * order/detail de cada pedido ainda ativo e o conclui/cancela pelos timestamps
     * confiáveis do próprio pedido (complete_time/cancel_time). Assim, um callback
     * orderFinish/orderCancel perdido não deixa o pedido preso no painel.
     * Best-effort: nunca lança (não interrompe o poll). Retorna quantos mudaram.
     */
    private static function reconcile99food(array $channel): int
    {
        if (Env::bool('INTEGRATIONS_MOCK', false)) {
            return 0;
        }
        $active = Db::query(
            "SELECT platform_order_id, status FROM delivery_orders
              WHERE channel_id = ? AND status NOT IN ('concluded','cancelled')
                AND created_at >= (NOW() - INTERVAL 2 DAY)",
            [(int) $channel['id']]
        );
        $updated = 0;
        foreach ($active as $o) {
            $oid = (string) $o['platform_order_id'];
            $cur = (string) $o['status'];
            try {
                $detail = NineNineClient::getOrder($channel, $oid);
            } catch (\Throwable $e) {
                error_log('[delivery] reconcile99food getOrder falhou (' . $oid . '): ' . $e->getMessage());
                continue;
            }
            if (!is_array($detail)) {
                continue;
            }
            $new = self::statusFromDetail($detail);
            if ($new === null) {
                continue;
            }
            // Monotônico: nunca regride o pedido (o operador pode ter avançado por aqui).
            if ((self::STATUS_RANK[$new] ?? -1) <= (self::STATUS_RANK[$cur] ?? -1)) {
                continue;
            }
            $tsCol = self::STATUS_TS[$new] ?? null;
            $set = $tsCol ? ", {$tsCol} = COALESCE({$tsCol}, NOW())" : '';
            $n = Db::execute(
                "UPDATE delivery_orders SET status = ?{$set}
                  WHERE platform = '99food' AND platform_order_id = ? AND status NOT IN ('concluded','cancelled')",
                [$new, $oid]
            );
            if ($n > 0) {
                $updated++;
                self::log("reconcile 99food {$oid} status=" . (string) ($detail['status'] ?? '?') . " {$cur} -> {$new}");
            }
        }
        return $updated;
    }

    /** Ordem do fluxo (p/ avanço monotônico); terminais no topo. */
    private const STATUS_RANK = [
        'placed' => 0, 'confirmed' => 1, 'preparing' => 2, 'ready' => 3,
        'dispatched' => 4, 'concluded' => 5, 'cancelled' => 5,
    ];

    /** Coluna de carimbo por status alvo. */
    private const STATUS_TS = [
        'confirmed' => 'confirmed_at', 'ready' => 'ready_at', 'dispatched' => 'dispatched_at',
        'concluded' => 'concluded_at', 'cancelled' => 'cancelled_at',
    ];

    /**
     * Estado do pedido 99Food a partir do order/detail. Prioriza os timestamps
     * confiáveis (cancel_time/complete_time/shop_confirm_time) e usa o status
     * numérico do DiDi p/ detectar "saiu para entrega" (500) — 600=concluído
     * confirmado empiricamente. Retorna null se nada a mudar.
     */
    private static function statusFromDetail(array $detail): ?string
    {
        if ((int) ($detail['cancel_time'] ?? 0) > 0) {
            return 'cancelled';
        }
        if ((int) ($detail['complete_time'] ?? 0) > 0 || (int) ($detail['status'] ?? 0) === 600) {
            return 'concluded';
        }
        if ((int) ($detail['status'] ?? 0) === 500) {
            return 'dispatched'; // em rota de entrega no app do 99Food
        }
        if ((int) ($detail['shop_confirm_time'] ?? 0) > 0) {
            return 'confirmed';
        }
        return null;
    }

    /**
     * Detecta pedido de cancelamento do cliente no evento e registra um alerta pendente.
     * 99Food: `apply_id` no callback. iFood: id de disputa/handshake (a validar com evento real).
     * Best-effort: nunca lança (não interrompe a ingestão).
     */
    private static function detectCancellationAlert(string $platform, array $event, string $orderId): void
    {
        try {
            $externalId = null;
            $reason = null;
            if ($platform === '99food') {
                $externalId = $event['apply_id'] ?? ($event['data']['apply_id'] ?? null);
                $reason = $event['reason'] ?? ($event['data']['reason'] ?? null);
            } else { // ifood — marcadores de disputa/handshake
                $code = strtoupper((string) ($event['fullCode'] ?? $event['code'] ?? ''));
                $externalId = $event['disputeId']
                    ?? ($event['metadata']['disputeId'] ?? null)
                    ?? ($event['handshake']['disputeId'] ?? null);
                if ($externalId === null && in_array($code, ['HANDSHAKE_DISPUTE', 'CANCELLATION_REQUESTED'], true)) {
                    $externalId = $event['id'] ?? null;
                }
                $reason = $event['metadata']['reason'] ?? null;
            }
            if ($externalId === null) {
                return;
            }
            $orderRow = Db::queryOne('SELECT id FROM delivery_orders WHERE platform = ? AND platform_order_id = ?', [$platform, $orderId]);
            Db::execute(
                "INSERT INTO delivery_alerts (order_id, platform, platform_order_id, type, external_id, status, reason, payload)
                 VALUES (?, ?, ?, 'cancellation_request', ?, 'pending', ?, ?)
                 ON DUPLICATE KEY UPDATE order_id = VALUES(order_id), reason = COALESCE(VALUES(reason), reason)",
                [$orderRow['id'] ?? null, $platform, $orderId, (string) $externalId, $reason, json_encode($event, JSON_UNESCAPED_UNICODE)]
            );
            self::log("alerta de cancelamento ({$platform} pedido {$orderId} ext {$externalId})");
        } catch (\Throwable $e) {
            error_log('[delivery] detectCancellationAlert: ' . $e->getMessage());
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
                'customer_notes' => $o['customer_notes'] ?? null,
                'locator' => $o['locator'] ?? null,
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
                'customer_notes', 'locator',
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

            // Recontagem do histórico do cliente (base de "novos vs recorrentes").
            // RECONTA em vez de incrementar: este upsert roda a CADA evento do pedido
            // (transições de status, re-poll, callback reenviado), então um "+1" contaria
            // o mesmo pedido várias vezes. Derivar de delivery_orders é idempotente.
            // Precisa vir DEPOIS do insert do pedido, senão não conta o pedido atual.
            if ($customerId !== null && $orderRowId > 0) {
                $pdo->prepare(
                    'UPDATE delivery_customers dc
                        SET dc.orders_count = (
                              SELECT COUNT(*) FROM delivery_orders o
                               WHERE o.customer_id = dc.id AND o.status <> \'cancelled\'
                            )
                      WHERE dc.id = ?'
                )->execute([$customerId]);
            }
        });
    }

    /** Upsert do cliente (o contador orders_count é recalculado no fim do upsert do pedido). */
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
