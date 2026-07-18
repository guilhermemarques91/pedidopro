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

            $customerName = $in->string('customer_name');
            $partySize = $in->integer('party_size');

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
                    $saleId = self::insertSale($pdo, $orgId, $origin, $stationId, null, null, $userId, $customerName, $partySize);
                    $round = 1;
                    $added = self::insertItemsRound($pdo, $saleId, $round, $items);
                    $pdo->prepare('UPDATE sales SET total_amount = ? WHERE id = ?')->execute([$added, $saleId]);
                }
            } else {
                $dailyNumber = SalesNumbering::nextDailyNumber($pdo, $orgId);
                $saleId = self::insertSale($pdo, $orgId, $origin, null, $dailyNumber, null, $userId, $customerName, $partySize);
                $round = 1;
                $added = self::insertItemsRound($pdo, $saleId, $round, $items);
                $pdo->prepare('UPDATE sales SET total_amount = ? WHERE id = ?')->execute([$added, $saleId]);
                if ($origin === 'balcao') {
                    // Balcão paga na criação — aceita pagamento dividido (payments[]) ou forma única.
                    $summary = self::registerPayments($pdo, $saleId, self::parsePayments($in, $added));
                    $pdo->prepare("UPDATE sales SET payment_method = ?, payment_status = 'paid', paid_at = NOW() WHERE id = ?")
                        ->execute([$summary, $saleId]);
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

    /**
     * POST /vendas/:id/reopen — reabre uma mesa/comanda que já estava "na conta"
     * (o cliente resolveu pedir mais): volta ao estado anterior ao fechamento.
     */
    public static function reopen(Request $req): void
    {
        $id = $req->intParam('id');
        $orgId = $req->orgId();
        Db::transaction(function (PDO $pdo) use ($id, $orgId) {
            $sale = self::lockSale($pdo, $id, $orgId);
            if (!in_array($sale['origin'], ['mesa', 'comanda'], true)) {
                throw HttpError::badRequest('Só mesas e comandas reabrem a conta');
            }
            if ($sale['status'] !== 'awaiting_payment') {
                throw HttpError::badRequest('Pedido não está aguardando pagamento');
            }
            $next = $sale['ready_at'] !== null ? 'ready' : 'sent';
            $pdo->prepare('UPDATE sales SET status = ? WHERE id = ?')->execute([$next, $id]);
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
            $summary = self::registerPayments($pdo, $id, self::parsePayments($in, (float) $sale['total_amount']));
            $pdo->prepare(
                "UPDATE sales SET payment_method = ?, payment_status = 'paid', paid_at = NOW(),
                        status = 'completed', completed_at = NOW() WHERE id = ?"
            )->execute([$summary, $id]);
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
                Sale::adjustItem($pdo, $orgId, $item, $delta, $id, $itemId, $userId);
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
            Sale::adjustItem($pdo, $orgId, $item, -(float) $item['quantity'], $id, $itemId, $userId);
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

    /**
     * Valida o carrinho contra products (não confia no client) e monta o snapshot.
     * Cada item pode trazer modificadores de preparo: notes (texto livre),
     * removed_component_ids (insumos tirados da ficha) e variation_option_ids
     * (opções escolhidas nos grupos de variação — ex.: a proteína do Executivo).
     */
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

            $notes = isset($r['notes']) ? trim((string) $r['notes']) : '';
            $notes = $notes === '' ? null : mb_substr($notes, 0, 255);

            // "Sem X": só insumos que realmente estão na ficha atual do produto.
            $removed = [];
            foreach ((array) ($r['removed_component_ids'] ?? []) as $cid) {
                $cid = (int) $cid;
                if ($cid <= 0) {
                    continue;
                }
                $st = $pdo->prepare(
                    'SELECT c.name FROM product_recipe pr JOIN products c ON c.id = pr.component_id
                      WHERE pr.product_id = ? AND pr.org_id = ? AND pr.component_id = ? LIMIT 1'
                );
                $st->execute([$productId, $orgId, $cid]);
                $line = $st->fetch();
                if (!$line) {
                    throw HttpError::badRequest("Insumo removido não pertence à ficha de \"{$p['name']}\"");
                }
                $removed[] = ['component_id' => $cid, 'name' => $line['name']];
            }

            [$variation, $priceDelta] = self::resolveVariations($pdo, $orgId, $productId, $p['name'], (array) ($r['variation_option_ids'] ?? []));
            $unitPrice += $priceDelta;

            $out[] = [
                'product_id' => $productId,
                'name' => $p['name'],
                'unit_price' => $unitPrice,
                'quantity' => $qty,
                'subtotal' => round($unitPrice * $qty, 2),
                'notes' => $notes,
                'removed_json' => $removed ? json_encode($removed, JSON_UNESCAPED_UNICODE) : null,
                'variation_json' => $variation ? json_encode($variation, JSON_UNESCAPED_UNICODE) : null,
            ];
        }
        return $out;
    }

    /**
     * Valida as opções escolhidas contra os grupos de variação do produto: no máximo
     * uma opção por grupo, grupo obrigatório exige escolha, opção estranha é erro.
     * @return array{0: array, 1: float} [snapshot da variação, soma dos price_delta]
     */
    private static function resolveVariations(PDO $pdo, int $orgId, int $productId, string $productName, array $chosenIds): array
    {
        $chosen = array_values(array_unique(array_map('intval', $chosenIds)));
        $st = $pdo->prepare(
            'SELECT g.id AS group_id, g.name AS group_name, g.required,
                    o.id AS option_id, o.name AS option_name, o.component_id, o.quantity, o.price_delta
               FROM product_variation_groups g
               JOIN product_variation_options o ON o.group_id = g.id
              WHERE g.product_id = ? AND g.org_id = ?
              ORDER BY g.sort_order, g.id, o.sort_order, o.id'
        );
        $st->execute([$productId, $orgId]);
        $rows = $st->fetchAll();

        $byGroup = [];
        $known = [];
        foreach ($rows as $row) {
            $byGroup[(int) $row['group_id']]['name'] = $row['group_name'];
            $byGroup[(int) $row['group_id']]['required'] = (bool) $row['required'];
            $byGroup[(int) $row['group_id']]['options'][(int) $row['option_id']] = $row;
            $known[(int) $row['option_id']] = (int) $row['group_id'];
        }
        foreach ($chosen as $optId) {
            if (!isset($known[$optId])) {
                throw HttpError::badRequest("Opção de variação inválida para \"{$productName}\"");
            }
        }

        $variation = [];
        $priceDelta = 0.0;
        foreach ($byGroup as $groupId => $g) {
            $picked = array_values(array_filter($chosen, static fn ($id) => $known[$id] === $groupId));
            if (count($picked) > 1) {
                throw HttpError::badRequest("Escolha apenas uma opção de \"{$g['name']}\" em \"{$productName}\"");
            }
            if (!$picked) {
                if ($g['required']) {
                    throw HttpError::badRequest("Escolha a opção de \"{$g['name']}\" de \"{$productName}\"");
                }
                continue;
            }
            $o = $g['options'][$picked[0]];
            $priceDelta += (float) $o['price_delta'];
            $variation[] = [
                'group_id' => $groupId,
                'group_name' => $g['name'],
                'option_id' => (int) $o['option_id'],
                'option_name' => $o['option_name'],
                'component_id' => $o['component_id'] !== null ? (int) $o['component_id'] : null,
                'quantity' => (float) $o['quantity'],
                'price_delta' => (float) $o['price_delta'],
            ];
        }
        return [$variation, $priceDelta];
    }

    /**
     * GET /vendas/products/:id/prep — dados da tela de observações de preparo do PDV:
     * ficha técnica (para o "sem X") + grupos de variação com opções.
     */
    public static function prep(Request $req): void
    {
        $productId = $req->intParam('id');
        $orgId = $req->orgId();
        $p = Db::queryOne('SELECT id, name, sale_price FROM products WHERE id = ? AND org_id = ? AND active = 1', [$productId, $orgId]);
        if (!$p) {
            throw HttpError::notFound('Produto não encontrado');
        }
        $recipe = Db::query(
            "SELECT pr.component_id, COALESCE(c.name, pr.component_name) AS name, pr.quantity, pr.unit
               FROM product_recipe pr
               LEFT JOIN products c ON c.id = pr.component_id
              WHERE pr.product_id = ? AND pr.org_id = ?
              ORDER BY pr.sort_order, pr.id",
            [$productId, $orgId]
        );
        $groups = Db::query(
            'SELECT id, name, required FROM product_variation_groups WHERE product_id = ? AND org_id = ? ORDER BY sort_order, id',
            [$productId, $orgId]
        );
        foreach ($groups as &$g) {
            $g['required'] = (bool) $g['required'];
            $g['options'] = Db::query(
                'SELECT id, name, price_delta FROM product_variation_options WHERE group_id = ? ORDER BY sort_order, id',
                [$g['id']]
            );
        }
        Http::json([
            'product_id' => (int) $p['id'],
            'name' => $p['name'],
            'sale_price' => (float) ($p['sale_price'] ?? 0),
            'recipe' => $recipe,
            'groups' => $groups,
        ]);
    }

    /**
     * Interpreta o pagamento do request: `payments` = lista [{method, amount}] (pagamento
     * dividido — a soma deve bater com o total) ou `payment_method` = forma única.
     */
    private static function parsePayments(\App\Core\Input $in, float $total): array
    {
        if (!$in->has('payments')) {
            $method = $in->enum('payment_method', self::PAYMENT_METHODS, true);
            return [['method' => $method, 'amount' => round($total, 2)]];
        }
        $out = [];
        $sum = 0.0;
        foreach ($in->array('payments', true) as $pay) {
            $method = is_array($pay) ? ($pay['method'] ?? '') : '';
            $amount = is_array($pay) && isset($pay['amount']) ? round((float) $pay['amount'], 2) : 0.0;
            if (!in_array($method, self::PAYMENT_METHODS, true)) {
                throw HttpError::badRequest('Forma de pagamento inválida');
            }
            if ($amount <= 0) {
                throw HttpError::badRequest('Cada pagamento precisa de um valor maior que zero');
            }
            $out[] = ['method' => $method, 'amount' => $amount];
            $sum += $amount;
        }
        if (!$out) {
            throw HttpError::badRequest('Informe ao menos uma forma de pagamento');
        }
        if (abs($sum - $total) > 0.01) {
            $sumF = number_format($sum, 2, ',', '.');
            $totalF = number_format($total, 2, ',', '.');
            throw HttpError::badRequest("A soma dos pagamentos (R$ {$sumF}) difere do total (R$ {$totalF})");
        }
        return $out;
    }

    /** Grava as formas recebidas e devolve o resumo para sales.payment_method. */
    private static function registerPayments(PDO $pdo, int $saleId, array $payments): string
    {
        $stmt = $pdo->prepare('INSERT INTO sale_payments (sale_id, method, amount) VALUES (?, ?, ?)');
        foreach ($payments as $p) {
            $stmt->execute([$saleId, $p['method'], $p['amount']]);
        }
        return count($payments) > 1 ? 'multi' : $payments[0]['method'];
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

    private static function insertSale(
        PDO $pdo, int $orgId, string $origin, ?int $stationId, ?int $dailyNumber, ?string $paymentMethod,
        ?int $userId, ?string $customerName = null, ?int $partySize = null
    ): int {
        $pdo->prepare(
            'INSERT INTO sales (org_id, origin, station_id, daily_number, payment_method, created_by, customer_name, party_size)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )->execute([$orgId, $origin, $stationId, $dailyNumber, $paymentMethod, $userId, $customerName, $partySize]);
        return (int) $pdo->lastInsertId();
    }

    /** @return float soma do round inserido (para acumular em sales.total_amount) */
    private static function insertItemsRound(PDO $pdo, int $saleId, int $round, array $items): float
    {
        $stmt = $pdo->prepare(
            'INSERT INTO sale_items (sale_id, product_id, product_name, unit_price, quantity, subtotal, round_no,
                                     notes, removed_json, variation_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $sum = 0.0;
        foreach ($items as $it) {
            $stmt->execute([
                $saleId, $it['product_id'], $it['name'], $it['unit_price'], $it['quantity'], $it['subtotal'], $round,
                $it['notes'] ?? null, $it['removed_json'] ?? null, $it['variation_json'] ?? null,
            ]);
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
        $sale['items'] = array_map(static function (array $it): array {
            $it['removed'] = json_decode($it['removed_json'] ?? '', true) ?: [];
            $it['variation'] = json_decode($it['variation_json'] ?? '', true) ?: [];
            unset($it['removed_json'], $it['variation_json']);
            return $it;
        }, Db::query('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY round_no, id', [$id]));
        $sale['payments'] = Db::query('SELECT id, method, amount FROM sale_payments WHERE sale_id = ? ORDER BY id', [$id]);
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
            'customer_name' => $r['customer_name'],
            'party_size' => $r['party_size'] !== null ? (int) $r['party_size'] : null,
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
