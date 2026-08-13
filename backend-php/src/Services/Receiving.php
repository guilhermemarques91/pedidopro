<?php

namespace App\Services;

use App\Core\HttpError;
use PDO;

/**
 * Entrada de mercadoria: o documento que confirma o recebimento.
 *
 * O pedido gera uma entrada AGUARDANDO (o que esperamos receber) e é a NOTA — fiscal ou do
 * fornecedor — que confirma e sobrescreve. Antes disso o recebimento era um botão de
 * tudo-ou-nada que dava entrada da quantidade PEDIDA pelo preço PEDIDO: quando o fornecedor
 * mandava menos, ou cobrava outro preço, o conferente não tinha onde dizer isso, então não
 * lançava nada. Manter `qty_expected` ao lado de `qty_received` é o que permite MOSTRAR a
 * divergência em vez de sobrescrever em silêncio.
 *
 * A entrada também existe sem pedido: muita compra de restaurante chega direto, e barrar
 * isso só faria o operador deixar de lançar de novo.
 *
 * Sobre casar a linha do documento com o produto: a ordem é código do fornecedor → GTIN →
 * nome. O que não casa fica PENDENTE para uma pessoa decidir — este serviço nunca cria
 * produto sozinho. O import de NF-e antigo criava, e com descrições de nota ("COXAO MOLE BOV
 * RESF KG") isso duplicaria o cadastro em silêncio, espalhando o custo médio por produtos
 * gêmeos. Quando a pessoa resolve a pendência, o vínculo é GRAVADO no SKU do fornecedor, e a
 * próxima nota do mesmo fornecedor casa sozinha.
 */
final class Receiving
{
    public const STATUS_AGUARDANDO = 'aguardando';
    public const STATUS_CONFERIDA = 'conferida';
    public const STATUS_CANCELADA = 'cancelada';

    /** Situação da linha: casada, casada mas divergindo do pedido, sem produto, ou não veio. */
    public const LINE_OK = 'ok';
    public const LINE_DIVERGENTE = 'divergente';
    public const LINE_PENDENTE = 'pendente_vinculo';
    public const LINE_NAO_VEIO = 'nao_veio';

    /** Tolerância para comparar quantidade/preço — decimal(12,3) e float não fecham exato. */
    private const EPS = 0.0005;

    // ------------------------------------------------------------------ criação

    /**
     * Entrada nascida de um pedido enviado: registra o que ESPERAMOS receber, sem tocar no
     * estoque. Idempotente por pedido — reenviar o pedido não cria uma segunda entrada.
     */
    public static function fromOrder(PDO $pdo, int $orgId, int $orderId, ?int $userId): ?int
    {
        $st = $pdo->prepare('SELECT id FROM stock_receipts WHERE order_id = ? AND status <> ? LIMIT 1');
        $st->execute([$orderId, self::STATUS_CANCELADA]);
        if ($row = $st->fetch()) {
            return (int) $row['id'];
        }

        $st = $pdo->prepare('SELECT supplier_id FROM orders WHERE id = ? AND org_id = ?');
        $st->execute([$orderId, $orgId]);
        $order = $st->fetch();
        if (!$order) {
            return null;
        }

        $pdo->prepare(
            'INSERT INTO stock_receipts (org_id, supplier_id, order_id, status, source, created_by)
             VALUES (?, ?, ?, ?, ?, ?)'
        )->execute([$orgId, $order['supplier_id'], $orderId, self::STATUS_AGUARDANDO, 'pedido', $userId]);
        $receiptId = (int) $pdo->lastInsertId();

        $st = $pdo->prepare(
            'SELECT oi.id, oi.item_id, oi.quantity, oi.unit_price,
                    i.product_id, i.name, i.unit, i.supplier_code
               FROM order_items oi JOIN items i ON i.id = oi.item_id
              WHERE oi.order_id = ? ORDER BY oi.id'
        );
        $st->execute([$orderId]);
        $sort = 0;
        foreach ($st->fetchAll() as $l) {
            $pdo->prepare(
                'INSERT INTO stock_receipt_items
                   (receipt_id, order_item_id, item_id, product_id, doc_code, doc_name, doc_unit,
                    qty_expected, price_expected, status, sort_order)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            )->execute([
                $receiptId, $l['id'], $l['item_id'], $l['product_id'], $l['supplier_code'],
                $l['name'], $l['unit'], $l['quantity'], $l['unit_price'],
                $l['product_id'] !== null ? self::LINE_OK : self::LINE_PENDENTE, $sort++,
            ]);
        }
        return $receiptId;
    }

    /**
     * Entrada nascida de um documento (NF-e ou nota do fornecedor lida pela IA). Se houver
     * pedido aguardando do mesmo fornecedor, as linhas do documento são casadas com as dele.
     *
     * @param array{supplier_id:?int,source:string,number:?string,key:?string,date:?string,total:?float,nfe_import_id:?int,lines:array} $doc
     */
    public static function fromDocument(PDO $pdo, int $orgId, array $doc, ?int $userId): int
    {
        $supplierId = $doc['supplier_id'] ?? null;
        $receiptId = self::openForSupplier($pdo, $orgId, $supplierId);

        if ($receiptId === null) {
            $pdo->prepare(
                'INSERT INTO stock_receipts (org_id, supplier_id, status, source, doc_number, doc_key, doc_date, doc_total, nfe_import_id, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            )->execute([
                $orgId, $supplierId, self::STATUS_AGUARDANDO, $doc['source'],
                $doc['number'] ?? null, $doc['key'] ?? null, $doc['date'] ?? null,
                $doc['total'] ?? null, $doc['nfe_import_id'] ?? null, $userId,
            ]);
            $receiptId = (int) $pdo->lastInsertId();
        } else {
            $pdo->prepare(
                'UPDATE stock_receipts SET source = ?, doc_number = ?, doc_key = ?, doc_date = ?, doc_total = ?, nfe_import_id = ?
                  WHERE id = ?'
            )->execute([
                $doc['source'], $doc['number'] ?? null, $doc['key'] ?? null, $doc['date'] ?? null,
                $doc['total'] ?? null, $doc['nfe_import_id'] ?? null, $receiptId,
            ]);
        }

        self::applyDocumentLines($pdo, $orgId, $receiptId, $supplierId, $doc['lines']);
        return $receiptId;
    }

    /** Entrada aguardando mais antiga deste fornecedor — a que a nota vem fechar. */
    private static function openForSupplier(PDO $pdo, int $orgId, ?int $supplierId): ?int
    {
        if ($supplierId === null) {
            return null;
        }
        $st = $pdo->prepare(
            'SELECT id FROM stock_receipts
              WHERE org_id = ? AND supplier_id = ? AND status = ? ORDER BY id LIMIT 1'
        );
        $st->execute([$orgId, $supplierId, self::STATUS_AGUARDANDO]);
        $row = $st->fetch();
        return $row ? (int) $row['id'] : null;
    }

    /**
     * A nota SOBRESCREVE o pedido: cada linha do documento entra com sua quantidade e seu
     * preço. Linha que casa com uma já existente na entrada atualiza a existente; linha nova
     * é acrescentada; linha do pedido que o documento não trouxe vira `nao_veio` — some do
     * estoque, mas não some da tela, senão a falta passa despercebida.
     *
     * @param array<int,array{code:?string,ean:?string,name:string,unit:?string,quantity:float,unit_price:float}> $lines
     */
    private static function applyDocumentLines(PDO $pdo, int $orgId, int $receiptId, ?int $supplierId, array $lines): void
    {
        $st = $pdo->prepare('SELECT * FROM stock_receipt_items WHERE receipt_id = ? ORDER BY sort_order, id');
        $st->execute([$receiptId]);
        $existing = $st->fetchAll();
        $index = self::buildIndex($pdo, $orgId, $supplierId);

        $touched = [];
        $sort = count($existing);
        foreach ($lines as $line) {
            $match = self::matchLine($index, $line);
            $target = self::pickExisting($existing, $touched, $line, $match);

            $qty = (float) $line['quantity'];
            $price = (float) $line['unit_price'];

            if ($target !== null) {
                $touched[(int) $target['id']] = true;
                $expectedQty = $target['qty_expected'] !== null ? (float) $target['qty_expected'] : null;
                $expectedPrice = $target['price_expected'] !== null ? (float) $target['price_expected'] : null;
                $productId = $target['product_id'] !== null ? (int) $target['product_id'] : $match['product_id'];
                $status = self::lineStatus($productId, $qty, $price, $expectedQty, $expectedPrice);
                $pdo->prepare(
                    'UPDATE stock_receipt_items
                        SET item_id = COALESCE(item_id, ?), product_id = ?, doc_code = COALESCE(?, doc_code),
                            doc_name = ?, doc_unit = COALESCE(?, doc_unit),
                            qty_received = ?, price_received = ?, status = ?
                      WHERE id = ?'
                )->execute([
                    $match['item_id'], $productId, $line['code'] ?: null, $line['name'],
                    $line['unit'] ?: null, $qty, $price, $status, $target['id'],
                ]);
            } else {
                $status = self::lineStatus($match['product_id'], $qty, $price, null, null);
                $pdo->prepare(
                    'INSERT INTO stock_receipt_items
                       (receipt_id, item_id, product_id, doc_code, doc_name, doc_unit, qty_received, price_received, status, sort_order)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
                )->execute([
                    $receiptId, $match['item_id'], $match['product_id'], $line['code'] ?: null,
                    $line['name'], $line['unit'] ?: null, $qty, $price, $status, $sort++,
                ]);
            }

            if ($match['product_id'] !== null && !empty($line['ean'])) {
                self::learnGtin($pdo, $orgId, $match['product_id'], (string) $line['ean']);
            }
        }

        // Sobrou linha do pedido que o documento não trouxe.
        foreach ($existing as $e) {
            if (!isset($touched[(int) $e['id']]) && $e['qty_received'] === null) {
                $pdo->prepare('UPDATE stock_receipt_items SET status = ? WHERE id = ?')
                    ->execute([self::LINE_NAO_VEIO, $e['id']]);
            }
        }
    }

    /**
     * Linha da entrada que esta linha do documento vem preencher: mesmo produto, senão mesmo
     * código de fornecedor, senão mesmo nome. Sem match, é linha nova.
     *
     * O casamento por NOME não é luxo: a linha do pedido nasce do SKU do fornecedor, que
     * frequentemente ainda não tem produto vinculado nem código cadastrado (hoje, 129 dos 145
     * SKUs). Sem ele o item pedido virava "não veio" e o mesmo item da nota entrava como uma
     * segunda linha — a conferência mostrava duas COSTELINHAS onde só houve uma.
     *
     * @param array<int,true> $touched
     */
    private static function pickExisting(array $existing, array $touched, array $line, array $match): ?array
    {
        $free = static fn (array $e): bool => !isset($touched[(int) $e['id']]);

        if ($match['product_id'] !== null) {
            foreach ($existing as $e) {
                if ($free($e) && (int) ($e['product_id'] ?? 0) === $match['product_id']) {
                    return $e;
                }
            }
        }
        $code = trim((string) ($line['code'] ?? ''));
        if ($code !== '') {
            foreach ($existing as $e) {
                if ($free($e) && trim((string) ($e['doc_code'] ?? '')) === $code) {
                    return $e;
                }
            }
        }
        $key = DeliveryStock::key((string) $line['name']);
        foreach ($existing as $e) {
            if ($free($e) && DeliveryStock::key((string) ($e['doc_name'] ?? '')) === $key) {
                return $e;
            }
        }
        return null;
    }

    private static function lineStatus(?int $productId, float $qty, float $price, ?float $expectedQty, ?float $expectedPrice): string
    {
        if ($productId === null) {
            return self::LINE_PENDENTE;
        }
        $divergeQty = $expectedQty !== null && abs($qty - $expectedQty) > self::EPS;
        $divergePrice = $expectedPrice !== null && abs($price - $expectedPrice) > self::EPS;
        return ($divergeQty || $divergePrice) ? self::LINE_DIVERGENTE : self::LINE_OK;
    }

    // ------------------------------------------------------------- casamento

    /**
     * Índice do catálogo para casar as linhas do documento sem uma consulta por linha.
     * O catálogo é pequeno (centenas de produtos), então vale carregar de uma vez.
     *
     * @return array{byCode:array<string,array{item_id:int,product_id:?int}>,
     *               byGtin:array<string,int>,
     *               byItemName:array<string,array{item_id:int,product_id:?int}>,
     *               byProductName:array<string,int>}
     */
    private static function buildIndex(PDO $pdo, int $orgId, ?int $supplierId): array
    {
        $byCode = [];
        $byItemName = [];
        if ($supplierId !== null) {
            $st = $pdo->prepare(
                'SELECT id, product_id, name, supplier_code FROM items
                  WHERE org_id = ? AND supplier_id = ? AND active = 1
                  ORDER BY (product_id IS NOT NULL) DESC, id'
            );
            $st->execute([$orgId, $supplierId]);
            foreach ($st->fetchAll() as $r) {
                $link = ['item_id' => (int) $r['id'], 'product_id' => $r['product_id'] !== null ? (int) $r['product_id'] : null];
                $code = trim((string) $r['supplier_code']);
                if ($code !== '') {
                    $byCode[$code] ??= $link;
                }
                $byItemName[DeliveryStock::key((string) $r['name'])] ??= $link;
            }
        }

        $byGtin = [];
        $byProductName = [];
        $st = $pdo->prepare('SELECT id, name, gtin FROM products WHERE org_id = ? AND active = 1 ORDER BY id');
        $st->execute([$orgId]);
        foreach ($st->fetchAll() as $r) {
            $gtin = trim((string) $r['gtin']);
            if ($gtin !== '') {
                $byGtin[$gtin] ??= (int) $r['id'];
            }
            $byProductName[DeliveryStock::key((string) $r['name'])] ??= (int) $r['id'];
        }

        return ['byCode' => $byCode, 'byGtin' => $byGtin, 'byItemName' => $byItemName, 'byProductName' => $byProductName];
    }

    /**
     * Linha do documento → SKU do fornecedor e produto do ERP.
     *
     * Ordem: código do fornecedor (o mais confiável — é o que o fornecedor usa para se
     * referir ao próprio item), código de barras, nome do SKU e por fim nome do produto.
     * Nada casou = pendente; NUNCA cria produto.
     *
     * @return array{item_id:?int,product_id:?int}
     */
    private static function matchLine(array $index, array $line): array
    {
        $code = trim((string) ($line['code'] ?? ''));
        if ($code !== '' && isset($index['byCode'][$code])) {
            $hit = $index['byCode'][$code];
            if ($hit['product_id'] !== null) {
                return $hit;
            }
        }
        $ean = trim((string) ($line['ean'] ?? ''));
        if ($ean !== '' && isset($index['byGtin'][$ean])) {
            return ['item_id' => $index['byCode'][$code]['item_id'] ?? null, 'product_id' => $index['byGtin'][$ean]];
        }
        $key = DeliveryStock::key((string) $line['name']);
        if (isset($index['byItemName'][$key]) && $index['byItemName'][$key]['product_id'] !== null) {
            return $index['byItemName'][$key];
        }
        if (isset($index['byProductName'][$key])) {
            return [
                'item_id' => $index['byCode'][$code]['item_id'] ?? ($index['byItemName'][$key]['item_id'] ?? null),
                'product_id' => $index['byProductName'][$key],
            ];
        }
        return [
            'item_id' => $index['byCode'][$code]['item_id'] ?? ($index['byItemName'][$key]['item_id'] ?? null),
            'product_id' => null,
        ];
    }

    /**
     * Casa as linhas de um documento SEM gravar nada — para a tela de conferência mostrar,
     * antes de qualquer decisão, o que vai casar sozinho e o que vai exigir uma pessoa.
     *
     * @param  array<int,array{code:?string,ean:?string,name:string}> $lines
     * @return array<int,array{item_id:?int,product_id:?int,product_name:?string}>
     */
    public static function previewLines(PDO $pdo, int $orgId, ?int $supplierId, array $lines): array
    {
        $index = self::buildIndex($pdo, $orgId, $supplierId);
        $names = [];
        $st = $pdo->prepare('SELECT id, name FROM products WHERE org_id = ?');
        $st->execute([$orgId]);
        foreach ($st->fetchAll() as $r) {
            $names[(int) $r['id']] = (string) $r['name'];
        }

        $out = [];
        foreach ($lines as $line) {
            $m = self::matchLine($index, $line);
            $out[] = $m + ['product_name' => $m['product_id'] !== null ? ($names[$m['product_id']] ?? null) : null];
        }
        return $out;
    }

    /** A nota preenche o código de barras que o cadastro não tinha (nunca sobrescreve). */
    private static function learnGtin(PDO $pdo, int $orgId, int $productId, string $gtin): void
    {
        $pdo->prepare("UPDATE products SET gtin = ? WHERE id = ? AND org_id = ? AND (gtin IS NULL OR gtin = '')")
            ->execute([$gtin, $productId, $orgId]);
    }

    // --------------------------------------------------- resolver pendência

    /**
     * Vincula uma linha pendente a um produto — e APRENDE: grava o código do fornecedor no
     * SKU, para a próxima nota do mesmo fornecedor casar sozinha. É o que ataca o cadastro
     * incompleto aos poucos, no momento em que a mercadoria está na mão, em vez de exigir
     * uma força-tarefa de cadastro antes de o módulo servir para alguma coisa.
     */
    public static function linkLine(PDO $pdo, int $orgId, int $lineId, int $productId): void
    {
        $st = $pdo->prepare(
            'SELECT ri.*, r.org_id, r.supplier_id, r.status
               FROM stock_receipt_items ri JOIN stock_receipts r ON r.id = ri.receipt_id
              WHERE ri.id = ?'
        );
        $st->execute([$lineId]);
        $line = $st->fetch();
        if (!$line || (int) $line['org_id'] !== $orgId) {
            throw HttpError::notFound('Linha da entrada não encontrada');
        }
        if ($line['status'] === self::STATUS_CONFERIDA) {
            throw HttpError::badRequest('Entrada já conferida — não dá para mudar o vínculo');
        }
        $st = $pdo->prepare('SELECT id, gtin FROM products WHERE id = ? AND org_id = ?');
        $st->execute([$productId, $orgId]);
        if (!$st->fetch()) {
            throw HttpError::notFound('Produto não encontrado');
        }

        $itemId = $line['item_id'] !== null ? (int) $line['item_id'] : null;
        $supplierId = $line['supplier_id'] !== null ? (int) $line['supplier_id'] : null;
        $code = trim((string) ($line['doc_code'] ?? ''));

        if ($itemId !== null) {
            $pdo->prepare('UPDATE items SET product_id = ?, supplier_code = COALESCE(NULLIF(supplier_code, ?), ?) WHERE id = ?')
                ->execute([$productId, '', $code !== '' ? $code : null, $itemId]);
        } elseif ($supplierId !== null) {
            // Sem SKU ainda: cria o de-para do fornecedor agora, com o código da nota.
            $pdo->prepare(
                'INSERT INTO items (org_id, supplier_id, product_id, name, supplier_code, unit, base_price)
                 VALUES (?, ?, ?, ?, ?, ?, ?)'
            )->execute([
                $orgId, $supplierId, $productId, (string) $line['doc_name'],
                $code !== '' ? $code : null, $line['doc_unit'], $line['price_received'],
            ]);
            $itemId = (int) $pdo->lastInsertId();
        }

        $qty = $line['qty_received'] !== null ? (float) $line['qty_received'] : null;
        $price = $line['price_received'] !== null ? (float) $line['price_received'] : null;
        $status = $qty === null
            ? self::LINE_OK
            : self::lineStatus(
                $productId,
                $qty,
                $price ?? 0.0,
                $line['qty_expected'] !== null ? (float) $line['qty_expected'] : null,
                $line['price_expected'] !== null ? (float) $line['price_expected'] : null
            );

        $pdo->prepare('UPDATE stock_receipt_items SET product_id = ?, item_id = ?, status = ? WHERE id = ?')
            ->execute([$productId, $itemId, $status, $lineId]);
    }

    // ------------------------------------------------------------ confirmação

    /**
     * Dá entrada no estoque com o que a NOTA diz e fecha o pedido.
     *
     * Linha sem produto vinculado não movimenta — vai na lista `skipped` para a tela avisar.
     * Não bloqueamos a confirmação por causa dela: travar a entrada inteira por um item que
     * ninguém cadastrou é exatamente o que fazia o operador desistir de lançar.
     *
     * @return array{moved:int,skipped:array<int,string>,order_status:?string}
     */
    public static function confirm(PDO $pdo, int $orgId, int $receiptId, ?int $userId): array
    {
        $st = $pdo->prepare('SELECT * FROM stock_receipts WHERE id = ? AND org_id = ? FOR UPDATE');
        $st->execute([$receiptId, $orgId]);
        $receipt = $st->fetch();
        if (!$receipt) {
            throw HttpError::notFound('Entrada não encontrada');
        }
        if ($receipt['status'] === self::STATUS_CONFERIDA) {
            throw HttpError::badRequest('Esta entrada já foi conferida');
        }
        if ($receipt['status'] === self::STATUS_CANCELADA) {
            throw HttpError::badRequest('Entrada cancelada');
        }

        $st = $pdo->prepare('SELECT * FROM stock_receipt_items WHERE receipt_id = ? ORDER BY sort_order, id');
        $st->execute([$receiptId]);
        $lines = $st->fetchAll();

        $moved = 0;
        $skipped = [];
        $partial = false;
        foreach ($lines as $l) {
            $qty = $l['qty_received'] !== null ? (float) $l['qty_received'] : null;
            $expected = $l['qty_expected'] !== null ? (float) $l['qty_expected'] : null;

            if ($qty === null || $qty <= 0) {
                if ($expected !== null && $expected > 0) {
                    $partial = true;
                }
                continue;
            }
            if ($l['product_id'] === null) {
                $skipped[] = (string) $l['doc_name'];
                $partial = true;
                continue;
            }
            if ($expected !== null && $qty + self::EPS < $expected) {
                $partial = true;
            }

            $price = $l['price_received'] !== null ? (float) $l['price_received'] : null;
            Stock::apply($pdo, $orgId, (int) $l['product_id'], 'in', $qty, $price, "receipt:{$receiptId}", null, $userId);
            $moved++;

            // O preço da nota é o preço mais recente que temos deste SKU.
            if ($l['item_id'] !== null && $price !== null) {
                $pdo->prepare('UPDATE items SET base_price = ? WHERE id = ?')->execute([$price, $l['item_id']]);
            }
        }

        $orderStatus = null;
        if ($receipt['order_id'] !== null) {
            $orderStatus = self::closeOrder($pdo, (int) $receipt['order_id'], $lines, $partial);
        }

        $pdo->prepare('UPDATE stock_receipts SET status = ?, confirmed_at = NOW(), confirmed_by = ? WHERE id = ?')
            ->execute([self::STATUS_CONFERIDA, $userId, $receiptId]);

        return ['moved' => $moved, 'skipped' => $skipped, 'order_status' => $orderStatus];
    }

    /**
     * A nota sobrescreve o pedido: as linhas do pedido passam a valer o que foi recebido, e o
     * pedido fica `received` ou `partially_received`. Sem isso o histórico de compra
     * continuaria contando a versão que o fornecedor não cumpriu.
     */
    private static function closeOrder(PDO $pdo, int $orderId, array $lines, bool $partial): string
    {
        foreach ($lines as $l) {
            if ($l['order_item_id'] === null) {
                continue;
            }
            if ($l['qty_received'] === null) {
                // A nota não trouxe este item. Zerar é o que faz o total do pedido bater com
                // o que foi realmente cobrado; o que se esperava continua registrado em
                // stock_receipt_items.qty_expected, então o histórico não se perde.
                $pdo->prepare('UPDATE order_items SET quantity = 0 WHERE id = ?')->execute([$l['order_item_id']]);
                continue;
            }
            $pdo->prepare('UPDATE order_items SET quantity = ?, unit_price = ? WHERE id = ?')->execute([
                (float) $l['qty_received'],
                $l['price_received'] !== null ? (float) $l['price_received'] : 0,
                $l['order_item_id'],
            ]);
        }
        $status = $partial ? 'partially_received' : 'received';
        $pdo->prepare('UPDATE orders SET status = ?, received_at = NOW() WHERE id = ?')->execute([$status, $orderId]);
        $pdo->prepare(
            'UPDATE orders SET total_amount = (SELECT COALESCE(SUM(subtotal), 0) FROM order_items WHERE order_id = ?) WHERE id = ?'
        )->execute([$orderId, $orderId]);
        return $status;
    }
}
