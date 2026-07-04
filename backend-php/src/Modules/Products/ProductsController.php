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
        // Cadastro de estoque: filtros de categoria (topo) + laterais (nome, tipo,
        // fornecedor, data, faixas de preço de compra/venda).
        $where = ['p.active = 1', 'p.org_id = ?'];
        $params = [$req->orgId()];
        $eq = [
            'category_id' => 'p.category_id',
            'type_id' => 'p.type_id',
            'supplier_id' => 'p.supplier_id',
        ];
        foreach ($eq as $q => $col) {
            $v = $req->query($q);
            if ($v !== null && ctype_digit($v)) {
                $where[] = "{$col} = ?";
                $params[] = (int) $v;
            }
        }
        if (($v = $req->query('q')) !== null) {
            $where[] = 'p.name LIKE ?';
            $params[] = '%' . $v . '%';
        }
        if (($v = $req->query('created_from')) !== null) {
            $where[] = 'p.created_at >= ?';
            $params[] = $v . ' 00:00:00';
        }
        if (($v = $req->query('created_to')) !== null) {
            $where[] = 'p.created_at <= ?';
            $params[] = $v . ' 23:59:59';
        }
        $ranges = [
            'cost_min' => ['p.cost_price', '>='], 'cost_max' => ['p.cost_price', '<='],
            'sale_min' => ['p.sale_price', '>='], 'sale_max' => ['p.sale_price', '<='],
        ];
        foreach ($ranges as $q => [$col, $op]) {
            $v = $req->query($q);
            if ($v !== null && is_numeric($v)) {
                $where[] = "{$col} {$op} ?";
                $params[] = (float) $v;
            }
        }

        $sql = "SELECT p.*, c.name AS category_name, t.name AS type_name, s.name AS supplier_name,
                       COALESCE(SUM(i.active = 1), 0) AS item_count,
                       (SELECT i2.unit FROM items i2
                         WHERE i2.product_id = p.id AND i2.active = 1
                         ORDER BY (i2.base_price IS NULL), i2.base_price ASC, i2.id
                         LIMIT 1) AS default_unit
                  FROM products p
                  LEFT JOIN categories c ON c.id = p.category_id
                  LEFT JOIN product_types t ON t.id = p.type_id
                  LEFT JOIN suppliers s ON s.id = p.supplier_id
                  LEFT JOIN items i ON i.product_id = p.id
                 WHERE " . implode(' AND ', $where) . "
                 GROUP BY p.id, c.name, t.name, s.name
                 ORDER BY p.name";
        Http::json(Db::query($sql, $params));
    }

    public static function unmapped(Request $req): void
    {
        // No catálogo da lista de compras (?for_catalog=1) escondemos itens soltos cujo nome já é
        // coberto por um item agrupado num produto — evita o produto aparecer junto com duplicatas.
        $extra = $req->query('for_catalog')
            ? ' AND NOT EXISTS (SELECT 1 FROM items g
                                 WHERE g.product_id IS NOT NULL
                                   AND LOWER(TRIM(g.name)) = LOWER(TRIM(i.name)))'
            : '';
        Http::json(Db::query(
            "SELECT i.id, i.name, i.unit, s.name AS supplier_name
               FROM items i JOIN suppliers s ON s.id = i.supplier_id
              WHERE i.active = 1 AND i.product_id IS NULL{$extra}
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
        Db::execute(
            'INSERT INTO products (org_id, name, category_id, type_id, supplier_id, unit, cost_price, sale_price)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [
                $req->orgId(), $name, $in->integer('category_id'), $in->integer('type_id'),
                $in->integer('supplier_id'), $in->string('unit'), $in->number('cost_price'), $in->number('sale_price'),
            ]
        );
        Http::json(self::find(Db::lastInsertId()), 201);
    }

    public static function update(Request $req): void
    {
        $id = $req->intParam('id');
        self::find($id);
        $in = $req->input();
        // Campos escalares opcionais: só atualiza os enviados.
        $map = [
            'name' => fn () => $in->requireString('name', 1, 200),
            'category_id' => fn () => $in->integer('category_id'),
            'type_id' => fn () => $in->integer('type_id'),
            'supplier_id' => fn () => $in->integer('supplier_id'),
            'unit' => fn () => $in->string('unit'),
            'cost_price' => fn () => $in->number('cost_price'),
            'sale_price' => fn () => $in->number('sale_price'),
        ];
        $fields = [];
        $values = [];
        foreach ($map as $key => $resolve) {
            if ($in->has($key)) {
                $fields[] = "{$key} = ?";
                $values[] = $resolve();
            }
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
