<?php

namespace App\Modules\Nfe;

use App\Core\Db;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Request;
use App\Services\NfeParser;
use App\Services\Stock;
use PDO;

/**
 * Entrada de estoque por NF-e (upload do XML).
 * preview: parseia e mostra o que será feito (fornecedor/produtos casados).
 * import:  cria/atualiza fornecedor (por CNPJ), produtos (por nome), itens
 *          (SKU do fornecedor) e dá ENTRADA no estoque — tudo numa transação.
 * A chave de acesso é única (nfe_imports): a mesma nota não entra duas vezes.
 */
final class NfeController
{
    public static function preview(Request $req): void
    {
        $nfe = self::parseUpload($req);
        Http::json(self::enrich($nfe, $req->orgId()));
    }

    public static function import(Request $req): void
    {
        $nfe = self::parseUpload($req);
        $orgId = $req->orgId();
        $data = self::enrich($nfe, $orgId);
        if ($data['duplicate']) {
            throw HttpError::badRequest("Esta NF-e já foi lançada (chave {$nfe['key']})");
        }
        // Itens desmarcados no preview (índices separados por vírgula).
        $rawSkip = array_filter(explode(',', (string) ($req->body['skip'] ?? '')), static fn ($x) => trim($x) !== '');
        $skip = array_flip(array_map('intval', $rawSkip));

        $result = Db::transaction(function (PDO $pdo) use ($nfe, $data, $orgId, $skip, $req) {
            // Fornecedor: casa por CNPJ/nome; cria se não existir.
            $supplierId = $data['supplier_match_id'];
            if ($supplierId === null) {
                $pdo->prepare('INSERT INTO suppliers (org_id, name, cnpj, order_type) VALUES (?, ?, ?, ?)')
                    ->execute([$orgId, $nfe['supplier']['name'], $nfe['supplier']['cnpj'], 'whatsapp']);
                $supplierId = (int) $pdo->lastInsertId();
            } elseif ($nfe['supplier']['cnpj'] !== '') {
                $pdo->prepare('UPDATE suppliers SET cnpj = COALESCE(cnpj, ?) WHERE id = ?')
                    ->execute([$nfe['supplier']['cnpj'], $supplierId]);
            }

            $imported = 0;
            $createdProducts = 0;
            foreach ($data['items'] as $i => $it) {
                if (isset($skip[$i])) {
                    continue;
                }
                // Produto (saldo vive nele): casa por nome; cria se preciso.
                $productId = $it['product_match_id'];
                if ($productId === null) {
                    $pdo->prepare('INSERT INTO products (org_id, name, supplier_id, unit, cost_price) VALUES (?, ?, ?, ?, ?)')
                        ->execute([$orgId, $it['name'], $supplierId, $it['unit'], $it['unit_price']]);
                    $productId = (int) $pdo->lastInsertId();
                    $createdProducts++;
                }
                // Item (SKU do fornecedor): por código, senão por nome; atualiza preço.
                $st = $pdo->prepare(
                    'SELECT id, product_id FROM items
                      WHERE org_id = ? AND supplier_id = ? AND (supplier_code = ? OR LOWER(TRIM(name)) = ?) LIMIT 1'
                );
                $st->execute([$orgId, $supplierId, $it['code'], mb_strtolower(trim($it['name']))]);
                $item = $st->fetch();
                if ($item) {
                    $pdo->prepare('UPDATE items SET base_price = ?, supplier_code = COALESCE(supplier_code, ?), product_id = COALESCE(product_id, ?) WHERE id = ?')
                        ->execute([$it['unit_price'], $it['code'], $productId, $item['id']]);
                    $pdo->prepare('UPDATE item_suppliers SET base_price = ? WHERE item_id = ? AND supplier_id = ?')
                        ->execute([$it['unit_price'], $item['id'], $supplierId]);
                } else {
                    $pdo->prepare('INSERT INTO items (org_id, supplier_id, product_id, name, supplier_code, unit, base_price) VALUES (?, ?, ?, ?, ?, ?, ?)')
                        ->execute([$orgId, $supplierId, $productId, $it['name'], $it['code'], $it['unit'], $it['unit_price']]);
                    $itemId = (int) $pdo->lastInsertId();
                    $pdo->prepare('INSERT INTO item_suppliers (item_id, supplier_id, supplier_code, base_price) VALUES (?, ?, ?, ?)')
                        ->execute([$itemId, $supplierId, $it['code'], $it['unit_price']]);
                }
                // ENTRADA no estoque com o custo da nota.
                Stock::apply($pdo, $orgId, $productId, 'in', $it['quantity'], $it['unit_price'], "nfe:{$nfe['number']}", null, $req->userId());
                $imported++;
            }

            $pdo->prepare(
                'INSERT INTO nfe_imports (org_id, access_key, number, supplier_cnpj, supplier_name, supplier_id, issued_at, total, item_count, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            )->execute([
                $orgId, $nfe['key'], $nfe['number'], $nfe['supplier']['cnpj'], $nfe['supplier']['name'],
                $supplierId, $nfe['issued_at'], $nfe['total'], $imported, $req->userId(),
            ]);
            return ['supplier_id' => $supplierId, 'items_imported' => $imported, 'products_created' => $createdProducts];
        });

        Http::json(['ok' => true] + $result, 201);
    }

    /** Notas já lançadas (histórico). */
    public static function history(Request $req): void
    {
        Http::json(Db::query(
            'SELECT n.*, u.name AS user_name FROM nfe_imports n LEFT JOIN users u ON u.id = n.created_by
              WHERE n.org_id = ? ORDER BY n.id DESC LIMIT 50',
            [$req->orgId()]
        ));
    }

    // ---- helpers ----

    private static function parseUpload(Request $req): array
    {
        $file = $req->file();
        if (!$file) {
            throw HttpError::badRequest('Envie o arquivo XML da NF-e (campo "file")');
        }
        return NfeParser::parse((string) file_get_contents($file['tmp_name']));
    }

    /** Anexa casamentos (fornecedor por CNPJ/nome; produto por nome) e flag de duplicidade. */
    private static function enrich(array $nfe, int $orgId): array
    {
        $dup = Db::queryOne('SELECT id, created_at FROM nfe_imports WHERE access_key = ?', [$nfe['key']]);
        $sup = null;
        if ($nfe['supplier']['cnpj'] !== '') {
            $sup = Db::queryOne('SELECT id, name FROM suppliers WHERE org_id = ? AND cnpj = ?', [$orgId, $nfe['supplier']['cnpj']]);
        }
        $sup ??= Db::queryOne(
            'SELECT id, name FROM suppliers WHERE org_id = ? AND LOWER(TRIM(name)) = ?',
            [$orgId, mb_strtolower(trim($nfe['supplier']['name']))]
        );

        $items = [];
        foreach ($nfe['items'] as $it) {
            $p = Db::queryOne(
                'SELECT id, name, stock_qty FROM products WHERE org_id = ? AND active = 1 AND LOWER(TRIM(name)) = ?',
                [$orgId, mb_strtolower(trim($it['name']))]
            );
            $it['product_match_id'] = $p ? (int) $p['id'] : null;
            $it['product_match_name'] = $p['name'] ?? null;
            $items[] = $it;
        }

        return [
            'key' => $nfe['key'],
            'number' => $nfe['number'],
            'issued_at' => $nfe['issued_at'],
            'total' => $nfe['total'],
            'supplier' => $nfe['supplier'],
            'supplier_match_id' => $sup ? (int) $sup['id'] : null,
            'supplier_match_name' => $sup['name'] ?? null,
            'duplicate' => $dup !== null,
            'items' => $items,
        ];
    }
}
