<?php

namespace App\Modules\Requests;

use App\Core\Db;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Request;
use PDO;

final class RequestsController
{
    public static function list(Request $req): void
    {
        $own = !$req->isAdmin();
        $where = 'WHERE pr.org_id = ?' . ($own ? ' AND pr.created_by = ?' : '');
        $params = $own ? [$req->orgId(), $req->userId()] : [$req->orgId()];
        // stock_count_id: o inverso do que Contagens.tsx já mostra (chip "Lista #N" a
        // partir da contagem) — fecha o círculo sem tabela nova, é o mesmo vínculo.
        Http::json(Db::query(
            "SELECT pr.*, u.name AS created_by_name, COUNT(DISTINCT pri.id) AS item_count, sc.id AS stock_count_id
               FROM purchase_requests pr
               JOIN users u ON u.id = pr.created_by
               LEFT JOIN purchase_request_items pri ON pri.request_id = pr.id
               LEFT JOIN stock_counts sc ON sc.request_id = pr.id
               {$where}
              GROUP BY pr.id, u.name, sc.id
              ORDER BY pr.created_at DESC",
            $params
        ));
    }

    public static function getById(Request $req): void
    {
        $id = $req->intParam('id');
        $header = Db::queryOne(
            'SELECT pr.*, u.name AS created_by_name
               FROM purchase_requests pr JOIN users u ON u.id = pr.created_by
              WHERE pr.id = ? AND pr.org_id = ?',
            [$id, $req->orgId()]
        );
        if (!$header) {
            throw HttpError::notFound('Lista de compras não encontrada');
        }
        if (!$req->isAdmin() && (int) $header['created_by'] !== $req->userId()) {
            throw HttpError::forbidden('Você não tem acesso a esta lista');
        }

        $items = Db::query(
            "SELECT pri.*, p.name AS product_name, c.id AS category_id, c.name AS category_name,
                    p.avg_cost, p.cost_price
               FROM purchase_request_items pri
               LEFT JOIN products p ON p.id = pri.product_id
               LEFT JOIN categories c ON c.id = p.category_id
              WHERE pri.request_id = ?
              ORDER BY COALESCE(c.name, 'zzz'), COALESCE(p.name, pri.free_text)",
            [$id]
        );
        foreach ($items as &$it) {
            // Custo de referência do produto (mesma fonte do "Custo estimado" da
            // contagem de estoque) — é contra ele que a alocação compara o preço
            // escolhido, pra pegar preço digitado errado ou custo de referência
            // desatualizado antes de virar pedido de verdade.
            $it['ref_cost'] = $it['avg_cost'] ?? $it['cost_price'];
        }
        unset($it);

        // Ofertas-guia por produto canônico.
        $productIds = [];
        foreach ($items as $it) {
            if ($it['product_id'] !== null) {
                $productIds[(int) $it['product_id']] = true;
            }
        }
        // Fornecedor padrão: o "Fornecedor principal" já cadastrado no produto
        // (products.supplier_id, editável na ficha do produto). Existe desde sempre mas
        // nada o usava — a alocação sempre pré-selecionava o MAIS BARATO cadastrado, nunca
        // o que o usuário registrou como o de sempre. Isso também cobre o caso mais comum
        // de todos: produto sem NENHUM item de fornecedor vinculado (a maioria — só 16 dos
        // 145 itens de fornecedor estão ligados a um produto) continua sem oferta com
        // preço, mas passa a vir com o fornecedor já certo, faltando só completar o resto.
        $defaultSupplierByProduct = [];
        $supplierNameById = [];
        if ($productIds) {
            $ids = array_keys($productIds);
            $place = Db::inClause($ids);
            foreach (Db::query("SELECT id, supplier_id FROM products WHERE id IN ({$place})", $ids) as $p) {
                if ($p['supplier_id'] !== null) {
                    $defaultSupplierByProduct[(int) $p['id']] = (int) $p['supplier_id'];
                }
            }
            if ($defaultSupplierByProduct) {
                $sids = array_values(array_unique($defaultSupplierByProduct));
                $splace = Db::inClause($sids);
                foreach (Db::query("SELECT id, name FROM suppliers WHERE id IN ({$splace})", $sids) as $s) {
                    $supplierNameById[(int) $s['id']] = $s['name'];
                }
            }
        }
        $offersByProduct = [];
        if ($productIds) {
            $ids = array_keys($productIds);
            $place = Db::inClause($ids);
            // Fornecedores JÁ RELACIONADOS: origem do item + vínculos extras (item_suppliers).
            $offers = Db::query(
                "SELECT i.product_id, i.id AS item_id, i.supplier_id, s.name AS supplier_name,
                        i.name, i.unit, i.base_price
                   FROM items i JOIN suppliers s ON s.id = i.supplier_id
                  WHERE i.active = 1 AND i.product_id IN ({$place})",
                $ids
            );
            $extras = Db::query(
                "SELECT i.product_id, i.id AS item_id, x.supplier_id, s.name AS supplier_name,
                        i.name, i.unit, COALESCE(x.base_price, i.base_price) AS base_price
                   FROM items i
                   JOIN item_suppliers x ON x.item_id = i.id AND x.active = 1 AND x.supplier_id <> i.supplier_id
                   JOIN suppliers s ON s.id = x.supplier_id
                  WHERE i.active = 1 AND i.product_id IN ({$place})",
                $ids
            );
            foreach (array_merge($offers, $extras) as $o) {
                $offersByProduct[(int) $o['product_id']][] = $o;
            }
            foreach ($offersByProduct as $pid => &$list) {
                self::sortOffers($list, $defaultSupplierByProduct[$pid] ?? null);
            }
            unset($list);
        }
        // Ofertas para itens sem produto canônico mas com referência ao item escolhido (não agrupado).
        $sourceIds = [];
        foreach ($items as $it) {
            if ($it['product_id'] === null && $it['source_item_id'] !== null) {
                $sourceIds[(int) $it['source_item_id']] = true;
            }
        }
        $offerBySourceItem = [];
        if ($sourceIds) {
            $ids = array_keys($sourceIds);
            $place = Db::inClause($ids);
            $rows = Db::query(
                "SELECT i.id AS item_id, i.product_id, i.supplier_id, s.name AS supplier_name,
                        i.name, i.unit, i.base_price
                   FROM items i JOIN suppliers s ON s.id = i.supplier_id
                  WHERE i.id IN ({$place})",
                $ids
            );
            $extras = Db::query(
                "SELECT i.id AS item_id, i.product_id, x.supplier_id, s.name AS supplier_name,
                        i.name, i.unit, COALESCE(x.base_price, i.base_price) AS base_price
                   FROM items i
                   JOIN item_suppliers x ON x.item_id = i.id AND x.active = 1 AND x.supplier_id <> i.supplier_id
                   JOIN suppliers s ON s.id = x.supplier_id
                  WHERE i.id IN ({$place})",
                $ids
            );
            foreach (array_merge($rows, $extras) as $o) {
                $offerBySourceItem[(int) $o['item_id']][] = $o;
            }
            foreach ($offerBySourceItem as &$list) {
                self::sortOffers($list);
            }
            unset($list);
        }

        // Itens digitados livres: casa por nome com itens cadastrados p/ sugerir fornecedores.
        $freeNames = [];
        foreach ($items as $it) {
            if ($it['product_id'] === null && $it['source_item_id'] === null && $it['free_text']) {
                $freeNames[mb_strtolower(trim($it['free_text']))] = true;
            }
        }
        $offersByName = [];
        if ($freeNames) {
            $names = array_keys($freeNames);
            $place = Db::inClause($names);
            $rows = Db::query(
                "SELECT LOWER(TRIM(i.name)) AS match_name, i.product_id, i.id AS item_id, x.supplier_id,
                        s.name AS supplier_name, i.name, i.unit, COALESCE(x.base_price, i.base_price) AS base_price
                   FROM items i
                   JOIN item_suppliers x ON x.item_id = i.id AND x.active = 1
                   JOIN suppliers s ON s.id = x.supplier_id
                  WHERE i.active = 1 AND LOWER(TRIM(i.name)) IN ({$place})",
                $names
            );
            foreach ($rows as $o) {
                $key = $o['match_name'];
                unset($o['match_name']);
                $offersByName[$key][] = $o;
            }
            foreach ($offersByName as &$list) {
                self::sortOffers($list);
            }
            unset($list);
        }

        foreach ($items as &$it) {
            $pid = $it['product_id'] !== null ? (int) $it['product_id'] : null;
            $sid = $it['source_item_id'] !== null ? (int) $it['source_item_id'] : null;
            if ($pid !== null && isset($offersByProduct[$pid])) {
                $it['offers'] = $offersByProduct[$pid];
            } elseif ($sid !== null && isset($offerBySourceItem[$sid])) {
                $it['offers'] = $offerBySourceItem[$sid];
            } elseif ($it['free_text'] && isset($offersByName[mb_strtolower(trim($it['free_text']))])) {
                $it['offers'] = $offersByName[mb_strtolower(trim($it['free_text']))];
            } else {
                $it['offers'] = [];
            }
            // Vai junto MESMO quando não há oferta nenhuma: é o que deixa o frontend
            // pré-selecionar o fornecedor cadastrado no produto ainda que ninguém tenha
            // vinculado um SKU dele — sem isso a linha nascia sempre em branco.
            $defaultId = $pid !== null ? ($defaultSupplierByProduct[$pid] ?? null) : null;
            $it['default_supplier_id'] = $defaultId;
            $it['default_supplier_name'] = $defaultId !== null ? ($supplierNameById[$defaultId] ?? null) : null;
        }
        unset($it);

        $header['items'] = $items;
        // Pedidos já gerados desta lista: torna persistente (sobrevive a F5) o que antes
        // só existia em estado local do frontend logo após "Gerar pedidos" — recarregar a
        // página perdia os links, sobrando só um texto solto avisando que a lista tinha
        // pedido, sem dizer qual.
        $header['order_ids'] = array_map(
            static fn ($r) => (int) $r['id'],
            Db::query('SELECT id FROM orders WHERE purchase_request_id = ? ORDER BY id', [$id])
        );
        Http::json($header);
    }

    public static function create(Request $req): void
    {
        $in = $req->input();
        $title = $in->string('title') ?: ('Lista ' . date('d/m/Y'));
        $notes = $in->string('notes');
        $items = self::parseItems($in->array('items', true));

        $id = Db::transaction(function (PDO $pdo) use ($title, $notes, $items, $req) {
            $stmt = $pdo->prepare('INSERT INTO purchase_requests (org_id, title, notes, created_by) VALUES (?, ?, ?, ?)');
            $stmt->execute([$req->orgId(), $title, $notes, $req->userId()]);
            $rid = (int) $pdo->lastInsertId();
            self::insertItems($pdo, $rid, $items);
            return $rid;
        });
        Http::json(self::row($id), 201);
    }

    public static function update(Request $req): void
    {
        $id = $req->intParam('id');
        $r = self::row($id, $req->orgId());
        if ((int) $r['created_by'] !== $req->userId() && !$req->isAdmin()) {
            throw HttpError::forbidden('Lista de outro usuário');
        }
        // Funcionário (dono) edita enquanto a lista ainda não virou pedido (draft/submitted);
        // admin edita também depois de alocada. As alocações são PRESERVADAS: antes o
        // DELETE+INSERT abaixo as apagava, então corrigir a quantidade de uma linha
        // custava refazer o fornecedor de todas.
        $editable = $req->isAdmin()
            ? in_array($r['status'], ['draft', 'submitted', 'allocated'], true)
            : in_array($r['status'], ['draft', 'submitted'], true);
        if (!$editable) {
            throw HttpError::badRequest('Esta lista não pode mais ser editada');
        }
        $in = $req->input();
        $items = self::parseItems($in->array('items', true));
        $title = $in->string('title');
        $notes = $in->string('notes');

        Db::transaction(function (PDO $pdo) use ($id, $title, $notes, $items) {
            $pdo->prepare('UPDATE purchase_requests SET title = COALESCE(?, title), notes = ? WHERE id = ?')
                ->execute([$title, $notes, $id]);
            // Guarda a alocação antes do replace-all para devolvê-la às linhas equivalentes.
            $saved = self::snapshotAllocations($pdo, $id);
            $pdo->prepare('DELETE FROM purchase_request_items WHERE request_id = ?')->execute([$id]);
            self::insertItems($pdo, $id, $items);
            self::restoreAllocations($pdo, $id, $saved);
        });
        Http::json(self::row($id));
    }

    public static function submit(Request $req): void
    {
        $id = $req->intParam('id');
        $r = self::row($id, $req->orgId());
        if ((int) $r['created_by'] !== $req->userId() && !$req->isAdmin()) {
            throw HttpError::forbidden('Lista de outro usuário');
        }
        if ($r['status'] !== 'draft') {
            throw HttpError::badRequest('Apenas listas em rascunho podem ser enviadas');
        }
        Db::execute("UPDATE purchase_requests SET status = 'submitted', submitted_at = NOW() WHERE id = ?", [$id]);
        Http::json(self::row($id));
    }

    public static function cancel(Request $req): void
    {
        $id = $req->intParam('id');
        $r = self::row($id, $req->orgId());
        if ($r['status'] === 'ordered' || $r['status'] === 'cancelled') {
            throw HttpError::badRequest('Lista já finalizada ou cancelada não pode ser cancelada');
        }
        Db::execute("UPDATE purchase_requests SET status = 'cancelled' WHERE id = ?", [$id]);
        Http::json(self::row($id));
    }

    public static function remove(Request $req): void
    {
        $id = $req->intParam('id');
        $r = self::row($id, $req->orgId());
        if (!$req->isAdmin()) {
            if ((int) $r['created_by'] !== $req->userId()) {
                throw HttpError::forbidden('Lista de outro usuário');
            }
            if ($r['status'] !== 'draft') {
                throw HttpError::badRequest('Apenas listas em rascunho podem ser excluídas');
            }
        }
        Db::transaction(function (PDO $pdo) use ($id) {
            $pdo->prepare('UPDATE orders SET purchase_request_id = NULL WHERE purchase_request_id = ?')->execute([$id]);
            // purchase_request_items é removido em cascata (ON DELETE CASCADE).
            $pdo->prepare('DELETE FROM purchase_requests WHERE id = ?')->execute([$id]);
        });
        Http::noContent();
    }

    public static function allocate(Request $req): void
    {
        $id = $req->intParam('id');
        $r = self::row($id, $req->orgId());
        if (!in_array($r['status'], ['submitted', 'allocated'], true)) {
            throw HttpError::badRequest('A lista precisa estar enviada para ser alocada');
        }
        $allocations = self::parseAllocations($req->input()->array('allocations', true));

        Db::transaction(function (PDO $pdo) use ($id, $allocations) {
            foreach ($allocations as $a) {
                $check = $pdo->prepare('SELECT id FROM purchase_request_items WHERE id = ? AND request_id = ?');
                $check->execute([$a['id'], $id]);
                if (!$check->fetch()) {
                    throw HttpError::badRequest("Item {$a['id']} não pertence a esta lista");
                }
                $pdo->prepare(
                    'UPDATE purchase_request_items
                        SET alloc_supplier_id = ?, alloc_item_id = ?, alloc_name = ?, alloc_unit = ?, alloc_price = ?
                      WHERE id = ?'
                )->execute([$a['supplier_id'], $a['item_id'], $a['name'], $a['unit'], $a['price'], $a['id']]);
            }
            $pdo->prepare("UPDATE purchase_requests SET status = 'allocated' WHERE id = ?")->execute([$id]);
        });
        Http::json(self::row($id));
    }

    public static function generateOrders(Request $req): void
    {
        $id = $req->intParam('id');
        $r = self::row($id, $req->orgId());
        if ($r['status'] !== 'allocated') {
            throw HttpError::badRequest('Aloque os itens antes de gerar os pedidos');
        }
        $items = Db::query(
            'SELECT pri.*, p.name AS product_name
               FROM purchase_request_items pri
               LEFT JOIN products p ON p.id = pri.product_id
              WHERE pri.request_id = ?',
            [$id]
        );
        if (!$items) {
            throw HttpError::badRequest('Lista sem itens');
        }
        // Preço é opcional (só consulta); para gerar o pedido basta fornecedor + nome do item.
        $pending = 0;
        foreach ($items as $i) {
            $hasName = $i['alloc_item_id'] !== null
                || ($i['alloc_name'] ?? $i['free_text'] ?? $i['product_name']);
            if ($i['alloc_supplier_id'] === null || !$hasName) {
                $pending++;
            }
        }
        if ($pending > 0) {
            throw HttpError::badRequest("{$pending} item(ns) sem fornecedor alocado");
        }

        $orderIds = Db::transaction(function (PDO $pdo) use ($items, $id, $req) {
            $bySupplier = [];
            foreach ($items as $i) {
                $bySupplier[(int) $i['alloc_supplier_id']][] = $i;
            }
            $touched = [];
            foreach ($bySupplier as $supplierId => $lines) {
                // Junta com um pedido já aberto (não enviado) do mesmo fornecedor, se existir,
                // para não gerar pedidos separados de listas diferentes (#7).
                // org_id no filtro: sem ele, uma org podia anexar linhas ao pedido
                // aberto de outra (todas as outras consultas do arquivo já escopam).
                $open = $pdo->prepare(
                    "SELECT id, status FROM orders
                      WHERE org_id = ? AND supplier_id = ? AND status IN ('draft', 'pending_approval')
                      ORDER BY created_at DESC LIMIT 1"
                );
                $open->execute([$req->orgId(), $supplierId]);
                $existing = $open->fetch();

                if ($existing) {
                    $orderId = (int) $existing['id'];
                    // Itens novos precisam de nova aprovação: volta o pedido para rascunho.
                    if ($existing['status'] === 'pending_approval') {
                        $pdo->prepare("UPDATE orders SET status = 'draft', approved_by = NULL, approved_at = NULL WHERE id = ?")
                            ->execute([$orderId]);
                    }
                } else {
                    $pdo->prepare(
                        'INSERT INTO orders (org_id, supplier_id, purchase_request_id, created_by, notes) VALUES (?, ?, ?, ?, ?)'
                    )->execute([$req->orgId(), $supplierId, $id, $req->userId(), "Gerado da lista #{$id}"]);
                    $orderId = (int) $pdo->lastInsertId();
                }

                foreach ($lines as $line) {
                    self::insertOrderLine($pdo, $req->orgId(), $orderId, $supplierId, $line);
                }
                $pdo->prepare(
                    'UPDATE orders SET total_amount = COALESCE(
                        (SELECT SUM(subtotal) FROM order_items WHERE order_id = ?), 0) WHERE id = ?'
                )->execute([$orderId, $orderId]);
                $touched[$orderId] = true;
            }
            $pdo->prepare("UPDATE purchase_requests SET status = 'ordered' WHERE id = ?")->execute([$id]);
            return array_keys($touched);
        });
        Http::json(['orderIds' => $orderIds]);
    }

    // ---- helpers ----

    /**
     * Insere uma linha alocada como item de pedido, criando o item no catálogo do
     * fornecedor SÓ se ele ainda não existir.
     *
     * A busca antes do INSERT é a garantia de verdade: mesmo que o cliente mande
     * `alloc_item_id` nulo (foi o que aconteceu por um bug na tela de alocação, que
     * gerou 21 itens duplicados), o mesmo par (fornecedor, nome) é reaproveitado em
     * vez de virar uma linha nova a cada geração de pedido.
     */
    private static function insertOrderLine(PDO $pdo, int $orgId, int $orderId, int $supplierId, array $line): void
    {
        $itemId = $line['alloc_item_id'] !== null ? (int) $line['alloc_item_id'] : null;
        if ($itemId === null) {
            $name = trim((string) ($line['alloc_name'] ?: $line['free_text'] ?: $line['product_name']));
            $unit = $line['alloc_unit'] ?: ($line['unit'] ?: 'un');

            $found = $pdo->prepare(
                'SELECT id FROM items
                  WHERE org_id = ? AND supplier_id = ? AND LOWER(TRIM(name)) = LOWER(TRIM(?)) AND active = 1
                  ORDER BY id LIMIT 1'
            );
            $found->execute([$orgId, $supplierId, $name]);
            $hit = $found->fetch();

            if ($hit) {
                $itemId = (int) $hit['id'];
            } else {
                // org_id era omitido aqui: a coluna existe desde a migration 009 e caía
                // no default 1, carimbando itens de qualquer tenant na org 1.
                $pdo->prepare(
                    'INSERT INTO items (org_id, supplier_id, product_id, name, unit, base_price) VALUES (?, ?, ?, ?, ?, ?)'
                )->execute([$orgId, $supplierId, $line['product_id'], $name, $unit, $line['alloc_price']]);
                $itemId = (int) $pdo->lastInsertId();
            }
        }
        $pdo->prepare(
            'INSERT INTO order_items (order_id, item_id, quantity, unit_price, notes) VALUES (?, ?, ?, ?, ?)'
        )->execute([$orderId, $itemId, $line['quantity'], $line['alloc_price'] ?? 0, $line['notes']]);
    }

    /**
     * Identidade de uma linha para efeito de preservar alocação entre edições.
     * Usa o que define "o mesmo item pedido": produto canônico, item de origem ou
     * o texto livre digitado.
     */
    private static function allocKey(array $row): string
    {
        return ($row['product_id'] ?? '') . '|' . ($row['source_item_id'] ?? '')
            . '|' . mb_strtolower(trim((string) ($row['free_text'] ?? '')));
    }

    /**
     * Alocações atuais indexadas por allocKey().
     * Chave ambígua (duas linhas do mesmo produto) é DESCARTADA: sem saber para qual
     * linha a alocação volta, devolver ao acaso seria pior do que pedir de novo.
     * @return array<string,array>
     */
    private static function snapshotAllocations(PDO $pdo, int $requestId): array
    {
        $rows = $pdo->prepare(
            'SELECT product_id, source_item_id, free_text, alloc_supplier_id, alloc_item_id, alloc_name, alloc_unit, alloc_price
               FROM purchase_request_items WHERE request_id = ? AND alloc_supplier_id IS NOT NULL'
        );
        $rows->execute([$requestId]);

        $out = [];
        $ambiguas = [];
        foreach ($rows->fetchAll() as $r) {
            $k = self::allocKey($r);
            if (isset($out[$k])) {
                $ambiguas[$k] = true;
                continue;
            }
            $out[$k] = $r;
        }
        foreach (array_keys($ambiguas) as $k) {
            unset($out[$k]);
        }
        return $out;
    }

    /** Devolve as alocações guardadas às linhas recém-inseridas de mesma identidade. */
    private static function restoreAllocations(PDO $pdo, int $requestId, array $saved): void
    {
        if (!$saved) {
            return;
        }
        $rows = $pdo->prepare('SELECT id, product_id, source_item_id, free_text FROM purchase_request_items WHERE request_id = ?');
        $rows->execute([$requestId]);

        $upd = $pdo->prepare(
            'UPDATE purchase_request_items
                SET alloc_supplier_id = ?, alloc_item_id = ?, alloc_name = ?, alloc_unit = ?, alloc_price = ?
              WHERE id = ?'
        );
        foreach ($rows->fetchAll() as $r) {
            $a = $saved[self::allocKey($r)] ?? null;
            if ($a) {
                $upd->execute([$a['alloc_supplier_id'], $a['alloc_item_id'], $a['alloc_name'], $a['alloc_unit'], $a['alloc_price'], $r['id']]);
            }
        }
    }

    /** Gate de tenant quando $orgId é informado (entradas públicas); null = uso interno já gated. */
    private static function row(int $id, ?int $orgId = null): array
    {
        $r = $orgId === null
            ? Db::queryOne('SELECT * FROM purchase_requests WHERE id = ?', [$id])
            : Db::queryOne('SELECT * FROM purchase_requests WHERE id = ? AND org_id = ?', [$id, $orgId]);
        if (!$r) {
            throw HttpError::notFound('Lista de compras não encontrada');
        }
        return $r;
    }

    /** Valida/normaliza os itens recebidos. */
    private static function parseItems(array $raw): array
    {
        if (!$raw) {
            throw HttpError::badRequest('Inclua ao menos um item');
        }
        $out = [];
        foreach ($raw as $r) {
            $productId = isset($r['product_id']) && $r['product_id'] !== null ? (int) $r['product_id'] : null;
            $freeText = isset($r['free_text']) && is_string($r['free_text']) ? trim($r['free_text']) : '';
            if ($productId === null && $freeText === '') {
                throw HttpError::badRequest('Cada item precisa de um produto do catálogo ou um texto livre');
            }
            $qty = isset($r['quantity']) && is_numeric($r['quantity']) ? (float) $r['quantity'] : 0;
            if ($qty <= 0) {
                throw HttpError::badRequest('Quantidade deve ser maior que zero');
            }
            // Item de catálogo ainda não agrupado: guarda a referência para puxar o fornecedor na aprovação.
            $sourceItemId = $productId === null && isset($r['source_item_id']) && $r['source_item_id'] !== null
                ? (int) $r['source_item_id'] : null;
            $out[] = [
                'product_id' => $productId,
                'source_item_id' => $sourceItemId,
                'free_text' => $freeText !== '' ? $freeText : null,
                'quantity' => $qty,
                'unit' => isset($r['unit']) && is_string($r['unit']) && trim($r['unit']) !== '' ? trim($r['unit']) : 'un',
                'notes' => isset($r['notes']) && is_string($r['notes']) && trim($r['notes']) !== '' ? trim($r['notes']) : null,
            ];
        }
        return $out;
    }

    private static function insertItems(PDO $pdo, int $requestId, array $items): void
    {
        $stmt = $pdo->prepare(
            'INSERT INTO purchase_request_items (request_id, product_id, source_item_id, free_text, quantity, unit, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        foreach ($items as $it) {
            $stmt->execute([$requestId, $it['product_id'], $it['source_item_id'], $it['free_text'], $it['quantity'], $it['unit'], $it['notes']]);
        }
    }

    private static function parseAllocations(array $raw): array
    {
        if (!$raw) {
            throw HttpError::badRequest('Nada para alocar');
        }
        $out = [];
        foreach ($raw as $a) {
            $lineId = (int) ($a['id'] ?? 0);
            $supplierId = (int) ($a['supplier_id'] ?? 0);
            if ($lineId <= 0 || $supplierId <= 0) {
                throw HttpError::badRequest('Alocação inválida (item/fornecedor)');
            }
            // Preço é opcional ao salvar a alocação; só rejeita se vier negativo.
            // (A exigência de preço fica no generate-orders.)
            $price = null;
            if (isset($a['price']) && $a['price'] !== null && $a['price'] !== '') {
                if (!is_numeric($a['price']) || (float) $a['price'] < 0) {
                    throw HttpError::badRequest('Preço inválido');
                }
                $price = (float) $a['price'];
            }
            $out[] = [
                'id' => $lineId,
                'supplier_id' => $supplierId,
                'item_id' => isset($a['item_id']) && $a['item_id'] !== null ? (int) $a['item_id'] : null,
                'name' => isset($a['name']) && is_string($a['name']) && trim($a['name']) !== '' ? trim($a['name']) : null,
                'unit' => isset($a['unit']) && is_string($a['unit']) && trim($a['unit']) !== '' ? trim($a['unit']) : null,
                'price' => $price,
            ];
        }
        return $out;
    }

    /** Ordena ofertas: com preço primeiro (mais barato), depois por fornecedor. */
    /**
     * Ordena ofertas: o fornecedor PADRÃO do produto primeiro (se informado e presente
     * entre as ofertas), depois preço (mais barato primeiro), por fim nome. O padrão
     * ganha de qualquer preço de propósito — é uma escolha registrada, não um achado
     * automático, e o usuário não deveria ter que trocar de volta toda lista.
     */
    private static function sortOffers(array &$list, ?int $defaultSupplierId = null): void
    {
        usort($list, static function ($a, $b) use ($defaultSupplierId) {
            if ($defaultSupplierId !== null) {
                $da = (int) $a['supplier_id'] === $defaultSupplierId;
                $db = (int) $b['supplier_id'] === $defaultSupplierId;
                if ($da !== $db) {
                    return $da ? -1 : 1;
                }
            }
            $pa = $a['base_price'];
            $pb = $b['base_price'];
            if (($pa === null) !== ($pb === null)) {
                return $pa === null ? 1 : -1;
            }
            if ($pa !== null && $pb !== null && (float) $pa !== (float) $pb) {
                return (float) $pa <=> (float) $pb;
            }
            return strcasecmp((string) $a['supplier_name'], (string) $b['supplier_name']);
        });
    }
}
