<?php

namespace App\Modules\Import;

use App\Core\Db;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Request;
use PDO;

final class ImportController
{
    public static function preview(Request $req): void
    {
        [$path, $filename] = self::file($req);
        $parsed = ImportParser::parse($path);
        $valid = $parsed['valid'];

        $existingSuppliers = self::nameSet('suppliers');
        $existingCategories = self::nameSet('categories');
        $existingItems = self::itemKeySet();

        $newSuppliers = [];
        $newCategories = [];
        $newItems = 0;
        $updatedItems = 0;
        foreach ($valid as $row) {
            if (!isset($existingSuppliers[self::norm($row['fornecedor'])])) {
                $newSuppliers[$row['fornecedor']] = true;
            }
            if ($row['categoria'] && !isset($existingCategories[self::norm($row['categoria'])])) {
                $newCategories[$row['categoria']] = true;
            }
            $key = self::norm($row['fornecedor']) . '|' . self::norm($row['item']);
            if (isset($existingItems[$key])) {
                $updatedItems++;
            } else {
                $newItems++;
            }
        }

        Http::json([
            'filename' => $filename,
            'totalRows' => $parsed['totalRows'],
            'validRows' => count($valid),
            'errorRows' => count($parsed['errors']),
            'newSuppliers' => array_keys($newSuppliers),
            'newCategories' => array_keys($newCategories),
            'newItems' => $newItems,
            'updatedItems' => $updatedItems,
            'errors' => $parsed['errors'],
            'sample' => array_slice($valid, 0, 10),
        ]);
    }

    public static function commit(Request $req): void
    {
        [$path, $filename] = self::file($req);
        $parsed = ImportParser::parse($path);
        $valid = $parsed['valid'];
        $errors = $parsed['errors'];

        $result = Db::transaction(function (PDO $pdo) use ($valid, $errors, $parsed, $filename, $req) {
            $supplierCache = [];
            $categoryCache = [];
            $stats = ['suppliersCreated' => 0, 'categoriesCreated' => 0, 'itemsCreated' => 0, 'itemsUpdated' => 0];

            foreach ($valid as $row) {
                $categoryId = $row['categoria']
                    ? self::findOrCreateCategory($pdo, $row['categoria'], $categoryCache, $stats)
                    : null;
                $supplierId = self::findOrCreateSupplier($pdo, $row['fornecedor'], $row['whatsapp'], $categoryId, $supplierCache, $stats);
                self::upsertItem($pdo, $supplierId, $row, $stats);
            }

            $pdo->prepare(
                "INSERT INTO imports (filename, status, total_rows, imported_rows, error_rows, error_log, created_by)
                 VALUES (?, 'done', ?, ?, ?, ?, ?)"
            )->execute([
                $filename, $parsed['totalRows'], count($valid), count($errors),
                json_encode($errors, JSON_UNESCAPED_UNICODE), $req->userId(),
            ]);

            return array_merge([
                'importId' => (int) $pdo->lastInsertId(),
                'totalRows' => $parsed['totalRows'],
                'importedRows' => count($valid),
                'errorRows' => count($errors),
            ], $stats, ['errors' => $errors]);
        });

        Http::json($result, 201);
    }

    // ---- helpers ----

    /** @return array{0:string,1:string} caminho temporário + nome original */
    private static function file(Request $req): array
    {
        $f = $req->file('file');
        if (!$f) {
            throw HttpError::badRequest('Envie a planilha no campo "file"');
        }
        return [$f['tmp_name'], $f['name']];
    }

    private static function norm(string $s): string
    {
        return mb_strtolower(trim($s));
    }

    private static function nameSet(string $table): array
    {
        $set = [];
        foreach (Db::query("SELECT name FROM {$table}") as $r) {
            $set[self::norm($r['name'])] = true;
        }
        return $set;
    }

    private static function itemKeySet(): array
    {
        $set = [];
        $rows = Db::query('SELECT i.name, s.name AS supplier_name FROM items i JOIN suppliers s ON s.id = i.supplier_id');
        foreach ($rows as $r) {
            $set[self::norm($r['supplier_name']) . '|' . self::norm($r['name'])] = true;
        }
        return $set;
    }

    private static function findOrCreateCategory(PDO $pdo, string $name, array &$cache, array &$stats): int
    {
        $key = self::norm($name);
        if (isset($cache[$key])) {
            return $cache[$key];
        }
        $stmt = $pdo->prepare('SELECT id FROM categories WHERE LOWER(name) = ? LIMIT 1');
        $stmt->execute([$key]);
        $existing = $stmt->fetch();
        if ($existing) {
            return $cache[$key] = (int) $existing['id'];
        }
        $pdo->prepare('INSERT INTO categories (name) VALUES (?)')->execute([$name]);
        $stats['categoriesCreated']++;
        return $cache[$key] = (int) $pdo->lastInsertId();
    }

    private static function findOrCreateSupplier(PDO $pdo, string $name, ?string $whatsapp, ?int $categoryId, array &$cache, array &$stats): int
    {
        $key = self::norm($name);
        if (isset($cache[$key])) {
            return $cache[$key];
        }
        $stmt = $pdo->prepare('SELECT id FROM suppliers WHERE LOWER(name) = ? LIMIT 1');
        $stmt->execute([$key]);
        $existing = $stmt->fetch();
        if ($existing) {
            return $cache[$key] = (int) $existing['id'];
        }
        $pdo->prepare("INSERT INTO suppliers (name, order_type, whatsapp_number, category_id) VALUES (?, 'whatsapp', ?, ?)")
            ->execute([$name, $whatsapp, $categoryId]);
        $stats['suppliersCreated']++;
        return $cache[$key] = (int) $pdo->lastInsertId();
    }

    private static function upsertItem(PDO $pdo, int $supplierId, array $row, array &$stats): void
    {
        $stmt = $pdo->prepare('SELECT id FROM items WHERE supplier_id = ? AND LOWER(name) = ? LIMIT 1');
        $stmt->execute([$supplierId, self::norm($row['item'])]);
        $existing = $stmt->fetch();
        if ($existing) {
            $pdo->prepare(
                'UPDATE items SET unit = ?, package_size = ?, package_unit = ?,
                        base_price = COALESCE(?, base_price), active = 1
                 WHERE id = ?'
            )->execute([$row['unidade'], $row['embalagem_qtd'], $row['embalagem_unidade'], $row['preco'], $existing['id']]);
            $stats['itemsUpdated']++;
            return;
        }
        $pdo->prepare(
            'INSERT INTO items (supplier_id, name, unit, package_size, package_unit, base_price)
             VALUES (?, ?, ?, ?, ?, ?)'
        )->execute([$supplierId, $row['item'], $row['unidade'], $row['embalagem_qtd'], $row['embalagem_unidade'], $row['preco']]);
        $stats['itemsCreated']++;
    }
}
