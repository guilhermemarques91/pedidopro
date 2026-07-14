<?php

namespace App\Modules\Vendas;

use App\Core\Db;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Request;
use App\Services\Sale;
use App\Services\SalesNumbering;
use PDO;

/**
 * Painel único de vendas: balcão, retirada, mesa e comanda — mais os pedidos de
 * delivery integrado (iFood/99Food, lidos de delivery_orders) exibidos juntos, atrás
 * de um filtro de origem. Colunas do Kanban: Enviado -> Pronto -> Aguardando
 * pagamento -> Concluído.
 *
 * Pagamento por origem: balcão paga na criação (já nasce 'paid'); retirada fica
 * pendente até o cliente retirar; mesa/comanda paga só no fechamento da conta
 * ("Fechar conta" -> Pagar). Mesa/comanda pode receber vários "rounds" de itens
 * (a cada "Enviar pedido" na mesma mesa aberta) — cada round já baixa estoque na
 * hora pela ficha técnica (Sale::consumeRound); o cancelamento estorna tudo de
 * uma vez (Sale::revert), recalculado a partir de todos os rounds.
 */
final class VendasController
{
    private const PAYMENT_METHODS = ['dinheiro', 'debito', 'credito', 'pix', 'outro'];
    private const MANUAL_ORIGINS = ['mesa', 'comanda', 'balcao', 'retirada'];
    private const PLATFORMS = ['ifood', '99food'];

    /** GET /vendas/board?origin= — dados do Kanban (sales + delivery_orders mesclados). */
    public static function board(Request $req): void
    {
        $orgId = $req->orgId();
        $origin = $req->query('origin');

        $cards = [];
        if ($origin === null || in_array($origin, self::MANUAL_ORIGINS, true)) {
            $where = ['o.org_id = ?'];
            $params = [$orgId];
            if ($origin !== null) {
                $where[] = 'o.origin = ?';
                $params[] = $origin;
            }
            $where[] = "(o.status NOT IN ('completed', 'cancelled') OR DATE(o.created_at) = CURDATE())";
            $clause = implode(' AND ', $where);
            $rows = Db::query(
                "SELECT o.*, s.kind AS station_kind, s.number AS station_number, s.label AS station_label,
                        (SELECT COUNT(*) FROM sale_items i WHERE i.sale_id = o.id) AS items_count
                   FROM sales o
                   LEFT JOIN sales_stations s ON s.id = o.station_id
                  WHERE {$clause}
                  ORDER BY o.created_at DESC",
                $params
            );
            foreach ($rows as $r) {
                $cards[] = self::mapSaleCard($r);
            }
        }
        if ($origin === null || in_array($origin, self::PLATFORMS, true)) {
            $where = ['d.org_id = ?'];
            $params = [$orgId];
            if ($origin !== null) {
                $where[] = 'd.platform = ?';
                $params[] = $origin;
            }
            $where[] = "(d.status NOT IN ('concluded', 'cancelled') OR d.created_at >= (NOW() - INTERVAL 1 DAY))";
            $clause = implode(' AND ', $where);
            $rows = Db::query(
                "SELECT d.*, (SELECT COUNT(*) FROM delivery_order_items i WHERE i.order_id = d.id) AS items_count
                   FROM delivery_orders d
                  WHERE {$clause}
                  ORDER BY d.created_at DESC",
                $params
            );
            foreach ($rows as $r) {
                $cards[] = self::mapDeliveryCard($r);
            }
        }
        Http::json(['cards' => $cards]);
    }

    public static function getById(Request $req): void
    {
        Http::json(self::loadSale($req->intParam('id'), $req->orgId()));
    }

    /** POST /vendas — cria pedido, ou anexa um novo round a mesa/comanda já aberta. */
    public static function create(Request $req): void
    {
        $in = $req->input();
        $origin = $in->enum('origin', self::MANUAL_ORIGINS, true);
        $rawItems = $in->array('items', true);
        $orgId = $req->orgId();
        $userId = $req->userId();

        $saleId = Db::transaction(function (PDO $pdo) use ($origin, $rawItems, $in, $orgId, $userId) {
            $items = self::parseItems($pdo, $orgId, $rawItems);

            if ($origin === 'mesa' || $origin === 'comanda') {
                $stationId = (int) $in->integer('station_id', true);
                self::lockStation($pdo, $stationId, $orgId, $origin);
                $open = self::openSaleForStation($pdo, $stationId);
                if ($open) {
                    $saleId = (int) $open['id'];
                    $round = (int) $open['max_round'] + 1;
                    $added = self::insertItemsRound($pdo, $saleId, $round, $items);
                    $pdo->prepare("UPDATE sales SET total_amount = total_amount + ?, status = 'sent' WHERE id = ?")
                        ->execute([$added, $saleId]);
                } else {
                    $saleId = self::insertSale($pdo, $orgId, $origin, $stationId, null, null, $userId);
                    $round = 1;
                    $added = self::insertItemsRound($pdo, $saleId, $round, $items);
                    $pdo->prepare('UPDATE sales SET total_amount = ? WHERE id = ?')->execute([$added, $saleId]);
                }
            } else {
                $dailyNumber = SalesNumbering::nextDailyNumber($pdo, $orgId);
                $paymentMethod = $origin === 'balcao'
                    ? $in->enum('payment_method', self::PAYMENT_METHODS, true)
                    : null;
                $saleId = self::insertSale($pdo, $orgId, $origin, null, $dailyNumber, $paymentMethod, $userId);
                $round = 1;
                $added = self::insertItemsRound($pdo, $saleId, $round, $items);
                $pdo->prepare('UPDATE sales SET total_amount = ? WHERE id = ?')->execute([$added, $saleId]);
                if ($origin === 'balcao') {
                    $pdo->prepare("UPDATE sales SET payment_status = 'paid', paid_at = NOW() WHERE id = ?")
                        ->execute([$saleId]);
                }
            }

            Sale::consumeRound($pdo, $orgId, $saleId, $round, $userId);
            return $saleId;
        });

        Http::json(self::loadSale($saleId, $orgId), 201);
    }

    /**
     * POST /vendas/:id/ready — cozinha marca pronto. Retirada não tem "fechar conta"
     * manual (não recebe rounds extras): fica pronta já significa aguardando o
     * cliente vir buscar e pagar, então pula direto para 'awaiting_payment'.
     */
    public static function ready(Request $req): void
    {
        $id = $req->intParam('id');
        $orgId = $req->orgId();
        Db::transaction(function (PDO $pdo) use ($id, $orgId) {
            $sale = self::lockSale($pdo, $id, $orgId);
            if ($sale['status'] !== 'sent') {
                throw HttpError::badRequest('Pedido não está aguardando preparo');
            }
            $next = $sale['origin'] === 'retirada' ? 'awaiting_payment' : 'ready';
            $pdo->prepare('UPDATE sales SET status = ?, ready_at = NOW() WHERE id = ?')->execute([$next, $id]);
        });
        Http::json(self::loadSale($id, $orgId));
    }

    /** POST /vendas/:id/close — "Fechar conta" (só mesa/comanda): pede o pagamento. */
    public static function close(Request $req): void
    {
        $id = $req->intParam('id');
        $orgId = $req->orgId();
        Db::transaction(function (PDO $pdo) use ($id, $orgId) {
            $sale = self::lockSale($pdo, $id, $orgId);
            if (!in_array($sale['origin'], ['mesa', 'comanda'], true)) {
                throw HttpError::badRequest('Só mesas e comandas fecham conta por aqui');
            }
            if (!in_array($sale['status'], ['sent', 'ready'], true)) {
                throw HttpError::badRequest('Pedido não pode ser fechado neste estado');
            }
            $pdo->prepare("UPDATE sales SET status = 'awaiting_payment' WHERE id = ?")->execute([$id]);
        });
        Http::json(self::loadSale($id, $orgId));
    }

    /**
     * POST /vendas/:id/pay — conclui o pedido. Retirada/mesa/comanda pendentes exigem
     * `payment_method`; balcão já nasce pago (POST /vendas), então aqui só falta
     * marcar como concluído/entregue — sem pedir forma de pagamento de novo.
     */
    public static function pay(Request $req): void
    {
        $id = $req->intParam('id');
        $orgId = $req->orgId();
        $in = $req->input();
        Db::transaction(function (PDO $pdo) use ($id, $orgId, $in) {
            $sale = self::lockSale($pdo, $id, $orgId);
            if (!in_array($sale['status'], ['ready', 'awaiting_payment'], true)) {
                throw HttpError::badRequest('Pedido não está pronto para concluir');
            }
            if ($sale['payment_status'] === 'paid') {
                $pdo->prepare("UPDATE sales SET status = 'completed', completed_at = NOW() WHERE id = ?")
                    ->execute([$id]);
                return;
            }
            $method = $in->enum('payment_method', self::PAYMENT_METHODS, true);
            $pdo->prepare(
                "UPDATE sales SET payment_method = ?, payment_status = 'paid', paid_at = NOW(),
                        status = 'completed', completed_at = NOW() WHERE id = ?"
            )->execute([$method, $id]);
        });
        Http::json(self::loadSale($id, $orgId));
    }

    /** POST /vendas/:id/cancel — estorna a baixa de todos os rounds e cancela. */
    public static function cancel(Request $req): void
    {
        $id = $req->intParam('id');
        $orgId = $req->orgId();
        $userId = $req->userId();
        Db::transaction(function (PDO $pdo) use ($id, $orgId, $userId) {
            $sale = self::lockSale($pdo, $id, $orgId);
            if (in_array($sale['status'], ['completed', 'cancelled'], true)) {
                throw HttpError::badRequest('Pedido já foi finalizado');
            }
            Sale::revert($pdo, $orgId, $id, $userId);
            $pdo->prepare("UPDATE sales SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = ? WHERE id = ?")
                ->execute([$userId, $id]);
        });
        Http::json(self::loadSale($id, $orgId));
    }

    /** PUT /vendas/:id/items/:itemId — troca a quantidade de um item já enviado (ajusta a baixa). */
    public static function updateItem(Request $req): void
    {
        $id = $req->intParam('id');
        $itemId = $req->intParam('itemId');
        $orgId = $req->orgId();
        $userId = $req->userId();
        $qty = (float) $req->input()->number('quantity', true);
        if ($qty <= 0) {
            throw HttpError::badRequest('Quantidade deve ser maior que zero (use remover para excluir o item)');
        }
        Db::transaction(function (PDO $pdo) use ($id, $itemId, $orgId, $userId, $qty) {
            $sale = self::lockSale($pdo, $id, $orgId);
            self::assertEditable($sale);
            $item = self::lockItem($pdo, $itemId, $id);
            $delta = $qty - (float) $item['quantity'];
            if (abs($delta) > 0.0001) {
                Sale::adjustItem($pdo, $orgId, (int) $item['product_id'], $delta, $id, $itemId, $userId);
            }
            $newSubtotal = round((float) $item['unit_price'] * $qty, 2);
            $subtotalDelta = $newSubtotal - (float) $item['subtotal'];
            $pdo->prepare('UPDATE sale_items SET quantity = ?, subtotal = ? WHERE id = ?')
                ->execute([$qty, $newSubtotal, $itemId]);
            $pdo->prepare('UPDATE sales SET total_amount = total_amount + ? WHERE id = ?')
                ->execute([$subtotalDelta, $id]);
        });
        Http::json(self::loadSale($id, $orgId));
    }

    /**
     * DELETE /vendas/:id/items/:itemId — remove um item já enviado (estorna o que ele baixou).
     * Se era o último item da venda, cancela a venda inteira (não há sentido numa venda vazia
     * ficando "aberta" no painel).
     */
    public static function removeItem(Request $req): void
    {
        $id = $req->intParam('id');
        $itemId = $req->intParam('itemId');
        $orgId = $req->orgId();
        $userId = $req->userId();
        Db::transaction(function (PDO $pdo) use ($id, $itemId, $orgId, $userId) {
            $sale = self::lockSale($pdo, $id, $orgId);
            self::assertEditable($sale);
            $item = self::lockItem($pdo, $itemId, $id);
            Sale::adjustItem($pdo, $orgId, (int) $item['product_id'], -(float) $item['quantity'], $id, $itemId, $userId);
            $pdo->prepare('DELETE FROM sale_items WHERE id = ?')->execute([$itemId]);
            $pdo->prepare('UPDATE sales SET total_amount = total_amount - ? WHERE id = ?')
                ->execute([$item['subtotal'], $id]);
            $remaining = $pdo->prepare('SELECT COUNT(*) AS n FROM sale_items WHERE sale_id = ?');
            $remaining->execute([$id]);
            if ((int) $remaining->fetch()['n'] === 0) {
                $pdo->prepare("UPDATE sales SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = ? WHERE id = ?")
                    ->execute([$userId, $id]);
            }
        });
        Http::json(self::loadSale($id, $orgId));
    }

    // ---- helpers ----

    private static function assertEditable(array $sale): void
    {
        if (in_array($sale['status'], ['completed', 'cancelled'], true)) {
            throw HttpError::badRequest('Pedido já foi finalizado — não é possível editar');
        }
    }

    private static function lockItem(PDO $pdo, int $itemId, int $saleId): array
    {
        $st = $pdo->prepare('SELECT * FROM sale_items WHERE id = ? AND sale_id = ? FOR UPDATE');
        $st->execute([$itemId, $saleId]);
        $row = $st->fetch();
        if (!$row) {
            throw HttpError::notFound('Item não encontrado');
        }
        return $row;
    }

    /** Valida o carrinho contra products (não confia no client) e monta o snapshot. */
    private static function parseItems(PDO $pdo, int $orgId, array $raw): array
    {
        if (!$raw) {
            throw HttpError::badRequest('Inclua ao menos um item');
        }
        $out = [];
        foreach ($raw as $r) {
            $productId = isset($r['product_id']) ? (int) $r['product_id'] : 0;
            $qty = isset($r['quantity']) ? (float) $r['quantity'] : 0;
            if ($productId <= 0 || $qty <= 0) {
                throw HttpError::badRequest('Item de venda inválido');
            }
            $st = $pdo->prepare('SELECT name, sale_price FROM products WHERE id = ? AND org_id = ? AND active = 1');
            $st->execute([$productId, $orgId]);
            $p = $st->fetch();
            if (!$p) {
                throw HttpError::badRequest("Produto #{$productId} não encontrado ou inativo");
            }
            $unitPrice = (float) ($p['sale_price'] ?? 0);
            $out[] = [
                'product_id' => $productId,
                'name' => $p['name'],
                'unit_price' => $unitPrice,
                'quantity' => $qty,
                'subtotal' => round($unitPrice * $qty, 2),
            ];
        }
        return $out;
    }

    private static function lockStation(PDO $pdo, int $stationId, int $orgId, string $kind): array
    {
        $st = $pdo->prepare('SELECT * FROM sales_stations WHERE id = ? AND org_id = ? AND kind = ? AND active = 1 FOR UPDATE');
        $st->execute([$stationId, $orgId, $kind]);
        $row = $st->fetch();
        if (!$row) {
            throw HttpError::notFound('Mesa/comanda não encontrada');
        }
        return $row;
    }

    /** Venda ainda aberta para a estação (se houver), travada, com o maior round já enviado. */
    private static function openSaleForStation(PDO $pdo, int $stationId): ?array
    {
        $st = $pdo->prepare(
            "SELECT s.id, (SELECT COALESCE(MAX(round_no), 0) FROM sale_items WHERE sale_id = s.id) AS max_round
               FROM sales s
              WHERE s.station_id = ? AND s.status NOT IN ('completed', 'cancelled')
              FOR UPDATE"
        );
        $st->execute([$stationId]);
        $row = $st->fetch();
        return $row ?: null;
    }

    private static function insertSale(PDO $pdo, int $orgId, string $origin, ?int $stationId, ?int $dailyNumber, ?string $paymentMethod, ?int $userId): int
    {
        $pdo->prepare(
            'INSERT INTO sales (org_id, origin, station_id, daily_number, payment_method, created_by)
             VALUES (?, ?, ?, ?, ?, ?)'
        )->execute([$orgId, $origin, $stationId, $dailyNumber, $paymentMethod, $userId]);
        return (int) $pdo->lastInsertId();
    }

    /** @return float soma do round inserido (para acumular em sales.total_amount) */
    private static function insertItemsRound(PDO $pdo, int $saleId, int $round, array $items): float
    {
        $stmt = $pdo->prepare(
            'INSERT INTO sale_items (sale_id, product_id, product_name, unit_price, quantity, subtotal, round_no)
             VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        $sum = 0.0;
        foreach ($items as $it) {
            $stmt->execute([$saleId, $it['product_id'], $it['name'], $it['unit_price'], $it['quantity'], $it['subtotal'], $round]);
            $sum += $it['subtotal'];
        }
        return $sum;
    }

    private static function lockSale(PDO $pdo, int $id, int $orgId): array
    {
        $st = $pdo->prepare('SELECT * FROM sales WHERE id = ? AND org_id = ? FOR UPDATE');
        $st->execute([$id, $orgId]);
        $row = $st->fetch();
        if (!$row) {
            throw HttpError::notFound('Pedido não encontrado');
        }
        return $row;
    }

    private static function loadSale(int $id, int $orgId): array
    {
        $sale = Db::queryOne(
            "SELECT o.*, s.kind AS station_kind, s.number AS station_number, s.label AS station_label
               FROM sales o
               LEFT JOIN sales_stations s ON s.id = o.station_id
              WHERE o.id = ? AND o.org_id = ?",
            [$id, $orgId]
        );
        if (!$sale) {
            throw HttpError::notFound('Pedido não encontrado');
        }
        $sale['items'] = Db::query('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY round_no, id', [$id]);
        return $sale;
    }

    private static function mapSaleCard(array $r): array
    {
        $column = match ($r['status']) {
            'sent' => 'enviado',
            'ready' => 'pronto',
            'awaiting_payment' => 'aguardando_pagamento',
            'completed' => 'concluido',
            default => null, // cancelled
        };
        return [
            'source' => 'vendas',
            'id' => (int) $r['id'],
            'origin' => $r['origin'],
            'column' => $column,
            'status' => $r['status'],
            'payment_status' => $r['payment_status'],
            'payment_method' => $r['payment_method'],
            'daily_number' => $r['daily_number'] !== null ? (int) $r['daily_number'] : null,
            'station' => $r['station_id'] !== null ? [
                'id' => (int) $r['station_id'],
                'kind' => $r['station_kind'],
                'number' => $r['station_number'],
                'label' => $r['station_label'],
            ] : null,
            'total_amount' => (float) $r['total_amount'],
            'items_count' => (int) $r['items_count'],
            'created_at' => $r['created_at'],
            'ready_at' => $r['ready_at'],
        ];
    }

    private static function mapDeliveryCard(array $r): array
    {
        $column = match ($r['status']) {
            'placed', 'confirmed', 'preparing' => 'enviado',
            'ready', 'dispatched' => 'pronto',
            'concluded' => 'concluido',
            default => null, // cancelled
        };
        return [
            'source' => 'delivery',
            'id' => (int) $r['id'],
            'origin' => $r['platform'],
            'column' => $column,
            'status' => $r['status'],
            'payment_status' => 'paid', // pedido integrado já vem pago pela plataforma
            'payment_method' => null,
            'daily_number' => null,
            'display_id' => $r['display_id'],
            'customer_name' => $r['customer_name'],
            'station' => null,
            'total_amount' => (float) ($r['items_amount'] ?? 0),
            'items_count' => (int) $r['items_count'],
            'created_at' => $r['created_at'],
            'ready_at' => $r['ready_at'] ?? null,
        ];
    }
}
