<?php

namespace App\Modules\Import;

use App\Core\Db;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Request;
use PDO;

/**
 * Importa o cadastro de Produtos/Estoque a partir do relatório "Lista completa de itens
 * cadastrados" do sistema atual do usuário (AllFood). Cria/atualiza Classe (product_types) e
 * Sub-Classe (product_subclasses) conforme aparecem na planilha, e faz upsert em `products`
 * — casa pelo código interno (external_code) quando presente, senão pelo nome.
 */
final class ProductsImportController
{
    public static function preview(Request $req): void
    {
        [$path, $filename] = self::file($req);
        $parsed = ProductsImportParser::parse($path);
        $valid = $parsed['valid'];
        $orgId = $req->orgId();

        $existingByCode = self::codeSet($orgId);
        $existingByName = self::nameSet('products', $orgId);
        $existingClasses = self::nameSet('product_types', $orgId);
        $existingSubclasses = self::nameSet('product_subclasses', $orgId);

        $newClasses = [];
        $newSubclasses = [];
        $created = 0;
        $updated = 0;
        foreach ($valid as $row) {
            if ($row['classe'] && !isset($existingClasses[self::norm($row['classe'])])) {
                $newClasses[$row['classe']] = true;
            }
            if ($row['sub_classe'] && !isset($existingSubclasses[self::norm($row['sub_classe'])])) {
                $newSubclasses[$row['sub_classe']] = true;
            }
            $isUpdate = ($row['external_code'] !== null && isset($existingByCode[$row['external_code']]))
                || ($row['external_code'] === null && isset($existingByName[self::norm($row['name'])]));
            $isUpdate ? $updated++ : $created++;
        }

        Http::json([
            'filename' => $filename,
            'totalRows' => $parsed['totalRows'],
            'validRows' => count($valid),
            'errorRows' => count($parsed['errors']),
            'newClasses' => array_keys($newClasses),
            'newSubclasses' => array_keys($newSubclasses),
            'newProducts' => $created,
            'updatedProducts' => $updated,
            'errors' => $parsed['errors'],
            'sample' => array_slice($valid, 0, 10),
        ]);
    }

    public static function commit(Request $req): void
    {
        [$path, $filename] = self::file($req);
        $parsed = ProductsImportParser::parse($path);
        $valid = $parsed['valid'];
        $errors = $parsed['errors'];
        $orgId = $req->orgId();

        $result = Db::transaction(function (PDO $pdo) use ($valid, $errors, $parsed, $filename, $req, $orgId) {
            $classCache = [];
            $subclassCache = [];
            $stats = ['classesCreated' => 0, 'subclassesCreated' => 0, 'productsCreated' => 0, 'productsUpdated' => 0];

            foreach ($valid as $row) {
                $typeId = $row['classe'] ? self::findOrCreateClass($pdo, $orgId, $row['classe'], $classCache, $stats) : null;
                $subClasseId = $row['sub_classe']
                    ? self::findOrCreateSubclass($pdo, $orgId, $row['sub_classe'], $typeId, $subclassCache, $stats)
                    : null;
                self::upsertProduct($pdo, $orgId, $row, $typeId, $subClasseId, $stats);
            }

            $pdo->prepare(
                "INSERT INTO imports (org_id, filename, status, total_rows, imported_rows, error_rows, error_log, created_by)
                 VALUES (?, ?, 'done', ?, ?, ?, ?, ?)"
            )->execute([
                $orgId, $filename, $parsed['totalRows'], count($valid), count($errors),
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

    private static function codeSet(int $orgId): array
    {
        $set = [];
        foreach (Db::query('SELECT external_code FROM products WHERE org_id = ? AND external_code IS NOT NULL', [$orgId]) as $r) {
            $set[$r['external_code']] = true;
        }
        return $set;
    }

    private static function nameSet(string $table, int $orgId): array
    {
        $set = [];
        foreach (Db::query("SELECT name FROM {$table} WHERE org_id = ?", [$orgId]) as $r) {
            $set[self::norm($r['name'])] = true;
        }
        return $set;
    }

    private static function findOrCreateClass(PDO $pdo, int $orgId, string $name, array &$cache, array &$stats): int
    {
        $key = self::norm($name);
        if (isset($cache[$key])) {
            return $cache[$key];
        }
        $stmt = $pdo->prepare('SELECT id FROM product_types WHERE org_id = ? AND LOWER(name) = ? LIMIT 1');
        $stmt->execute([$orgId, $key]);
        $existing = $stmt->fetch();
        if ($existing) {
            return $cache[$key] = (int) $existing['id'];
        }
        $pdo->prepare('INSERT INTO product_types (org_id, name) VALUES (?, ?)')->execute([$orgId, $name]);
        $stats['classesCreated']++;
        return $cache[$key] = (int) $pdo->lastInsertId();
    }

    private static function findOrCreateSubclass(PDO $pdo, int $orgId, string $name, ?int $typeId, array &$cache, array &$stats): int
    {
        $key = $typeId . '|' . self::norm($name);
        if (isset($cache[$key])) {
            return $cache[$key];
        }
        $stmt = $pdo->prepare('SELECT id FROM product_subclasses WHERE org_id = ? AND LOWER(name) = ? AND type_id <=> ? LIMIT 1');
        $stmt->execute([$orgId, self::norm($name), $typeId]);
        $existing = $stmt->fetch();
        if ($existing) {
            return $cache[$key] = (int) $existing['id'];
        }
        $pdo->prepare('INSERT INTO product_subclasses (org_id, type_id, name) VALUES (?, ?, ?)')->execute([$orgId, $typeId, $name]);
        $stats['subclassesCreated']++;
        return $cache[$key] = (int) $pdo->lastInsertId();
    }

    private static function upsertProduct(PDO $pdo, int $orgId, array $row, ?int $typeId, ?int $subClasseId, array &$stats): void
    {
        $existing = null;
        if ($row['external_code'] !== null) {
            $stmt = $pdo->prepare('SELECT id FROM products WHERE org_id = ? AND external_code = ? LIMIT 1');
            $stmt->execute([$orgId, $row['external_code']]);
            $existing = $stmt->fetch();
        }
        if (!$existing) {
            $stmt = $pdo->prepare('SELECT id FROM products WHERE org_id = ? AND LOWER(name) = ? LIMIT 1');
            $stmt->execute([$orgId, self::norm($row['name'])]);
            $existing = $stmt->fetch();
        }

        if ($existing) {
            $pdo->prepare(
                'UPDATE products SET name = ?, external_code = ?, tipo = ?, type_id = ?, sub_classe_id = ?,
                        unit = ?, purchase_unit = ?, sale_price = COALESCE(?, sale_price),
                        cost_price = COALESCE(?, cost_price), active = 1
                 WHERE id = ?'
            )->execute([
                $row['name'], $row['external_code'], $row['tipo'], $typeId, $subClasseId,
                $row['unit'], $row['purchase_unit'], $row['sale_price'], $row['cost_price'], $existing['id'],
            ]);
            $stats['productsUpdated']++;
            return;
        }

        $pdo->prepare(
            'INSERT INTO products (org_id, name, external_code, tipo, type_id, sub_classe_id, unit, purchase_unit, sale_price, cost_price)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )->execute([
            $orgId, $row['name'], $row['external_code'], $row['tipo'], $typeId, $subClasseId,
            $row['unit'], $row['purchase_unit'], $row['sale_price'], $row['cost_price'],
        ]);
        $stats['productsCreated']++;
    }
}
