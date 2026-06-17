<?php

namespace App\Modules\Products;

use App\Core\Db;
use App\Core\Env;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Request;
use App\Services\Ollama;

final class ProductsController
{
    public static function list(Request $req): void
    {
        // FILTER (WHERE i.active) → SUM(i.active = 1).
        Http::json(Db::query(
            "SELECT p.*, c.name AS category_name,
                    COALESCE(SUM(i.active = 1), 0) AS item_count
               FROM products p
               LEFT JOIN categories c ON c.id = p.category_id
               LEFT JOIN items i ON i.product_id = p.id
              WHERE p.active = 1
              GROUP BY p.id, c.name
              ORDER BY p.name"
        ));
    }

    public static function unmapped(Request $req): void
    {
        Http::json(Db::query(
            "SELECT i.id, i.name, i.unit, s.name AS supplier_name
               FROM items i JOIN suppliers s ON s.id = i.supplier_id
              WHERE i.active = 1 AND i.product_id IS NULL
              ORDER BY LOWER(i.name)"
        ));
    }

    public static function getById(Request $req): void
    {
        $product = self::find($req->intParam('id'));
        $product['items'] = Db::query(
            "SELECT i.id, i.name, i.unit, i.base_price, s.name AS supplier_name
               FROM items i JOIN suppliers s ON s.id = i.supplier_id
              WHERE i.product_id = ? AND i.active = 1
              ORDER BY s.name, i.name",
            [$product['id']]
        );
        Http::json($product);
    }

    public static function create(Request $req): void
    {
        $in = $req->input();
        $name = $in->requireString('name', 1, 200);
        $row = Db::insertReturning(
            'INSERT INTO products (name, category_id) VALUES (?, ?)',
            [$name, $in->integer('category_id')],
            'products'
        );
        Http::json($row, 201);
    }

    public static function update(Request $req): void
    {
        $id = $req->intParam('id');
        self::find($id);
        $in = $req->input();
        $fields = [];
        $values = [];
        if ($in->has('name')) {
            $fields[] = 'name = ?';
            $values[] = $in->requireString('name', 1, 200);
        }
        if ($in->has('category_id')) {
            $fields[] = 'category_id = ?';
            $values[] = $in->integer('category_id');
        }
        if (!$fields) {
            throw HttpError::badRequest('Informe ao menos um campo');
        }
        $values[] = $id;
        Db::execute('UPDATE products SET ' . implode(', ', $fields) . ' WHERE id = ?', $values);
        Http::json(self::find($id));
    }

    public static function remove(Request $req): void
    {
        $id = $req->intParam('id');
        self::find($id);
        // Soft delete: desvincula itens e desativa.
        Db::execute('UPDATE items SET product_id = NULL WHERE product_id = ?', [$id]);
        Db::execute('UPDATE products SET active = 0 WHERE id = ?', [$id]);
        Http::noContent();
    }

    public static function assign(Request $req): void
    {
        $id = $req->intParam('id');
        self::find($id);
        $itemIds = $req->input()->intArray('item_ids', true);
        if (!$itemIds) {
            throw HttpError::badRequest('Selecione ao menos um item');
        }
        $place = Db::inClause($itemIds);
        $n = Db::execute(
            "UPDATE items SET product_id = ? WHERE id IN ({$place})",
            array_merge([$id], $itemIds)
        );
        Http::json(['assigned' => $n]);
    }

    public static function unassign(Request $req): void
    {
        $itemIds = $req->input()->intArray('item_ids', true);
        if (!$itemIds) {
            throw HttpError::badRequest('Selecione ao menos um item');
        }
        $place = Db::inClause($itemIds);
        $n = Db::execute("UPDATE items SET product_id = NULL WHERE id IN ({$place})", $itemIds);
        Http::json(['unassigned' => $n]);
    }

    /** Sugere agrupamentos dos itens não-mapeados via IA local (apenas sugestão). */
    public static function suggest(Request $req): void
    {
        $items = Db::query(
            "SELECT i.id, i.name, s.name AS supplier_name
               FROM items i JOIN suppliers s ON s.id = i.supplier_id
              WHERE i.active = 1 AND i.product_id IS NULL
              ORDER BY LOWER(i.name)"
        );
        if (count($items) < 2) {
            Http::json([]);
        }
        $batch = array_slice($items, 0, 60);
        $byId = [];
        $valid = [];
        $lines = [];
        foreach ($batch as $it) {
            $byId[(int) $it['id']] = $it;
            $valid[(int) $it['id']] = true;
            $lines[] = "{$it['id']}: {$it['name']}";
        }

        $schema = [
            'type' => 'object',
            'properties' => [
                'groups' => [
                    'type' => 'array',
                    'items' => [
                        'type' => 'object',
                        'properties' => [
                            'name' => ['type' => 'string'],
                            'item_ids' => ['type' => 'array', 'items' => ['type' => 'number']],
                        ],
                        'required' => ['name', 'item_ids'],
                    ],
                ],
            ],
            'required' => ['groups'],
        ];
        $system = 'Você agrupa produtos de açougue/alimentos que são EQUIVALENTES (mesmo produto com nomes '
            . 'diferentes ou sinônimos do setor, ex.: "acém" = "acém completo"). Agrupe apenas itens que sejam '
            . 'claramente o mesmo produto. NÃO invente itens nem IDs. Itens sem equivalente devem ficar de fora. '
            . 'Responda só com o JSON.';

        try {
            $content = Ollama::chat(Env::get('OLLAMA_MODEL', 'qwen2.5:3b'), [
                ['role' => 'system', 'content' => $system],
                ['role' => 'user', 'content' => "Itens (id: nome):\n" . implode("\n", $lines) . "\n\nAgrupe os equivalentes."],
            ], $schema);
        } catch (\Throwable) {
            throw HttpError::badRequest('IA local indisponível para sugerir agrupamentos. Verifique o Ollama.');
        }

        $parsed = json_decode($content, true);
        $groups = is_array($parsed) ? ($parsed['groups'] ?? []) : [];
        $out = [];
        foreach ($groups as $g) {
            $ids = [];
            foreach (($g['item_ids'] ?? []) as $rawId) {
                $iid = (int) $rawId;
                if (isset($valid[$iid])) {
                    $ids[] = $iid;
                }
            }
            if (count($ids) < 2) {
                continue; // só grupos com 2+ itens são úteis
            }
            $out[] = [
                'suggested_name' => trim((string) ($g['name'] ?? '')) ?: 'Produto',
                'item_ids' => $ids,
                'items' => array_map(static fn ($iid) => $byId[$iid], $ids),
            ];
        }
        Http::json($out);
    }

    private static function find(int $id): array
    {
        $row = Db::queryOne('SELECT * FROM products WHERE id = ?', [$id]);
        if (!$row) {
            throw HttpError::notFound('Produto não encontrado');
        }
        return $row;
    }
}
