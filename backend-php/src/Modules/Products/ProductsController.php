<?php

namespace App\Modules\Products;

use App\Core\Db;
use App\Core\Env;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Request;
use App\Services\Ollama;
use App\Services\Replenishment;

final class ProductsController
{
    public static function list(Request $req): void
    {
        // Cadastro de estoque: filtros de categoria (topo) + laterais (nome, tipo,
        // fornecedor, data, faixas de preço de compra/venda).
        $where = ['p.org_id = ?'];
        $params = [$req->orgId()];
        if ($req->query('includeInactive') !== 'true') {
            $where[] = 'p.active = 1';
        }
        $eq = [
            'category_id' => 'p.category_id',
            'type_id' => 'p.type_id',
            'sub_classe_id' => 'p.sub_classe_id',
            'supplier_id' => 'p.supplier_id',
        ];
        foreach ($eq as $q => $col) {
            $v = $req->query($q);
            if ($v !== null && ctype_digit($v)) {
                $where[] = "{$col} = ?";
                $params[] = (int) $v;
            }
        }
        // Tipo (eixo fixo das abas de topo) é texto, não id.
        if (($v = $req->query('tipo')) !== null && $v !== '') {
            $where[] = 'p.tipo = ?';
            $params[] = $v;
        }
        if (($v = $req->query('q')) !== null) {
            // Busca por descrição ou código interno (id).
            if (ctype_digit($v)) {
                $where[] = '(p.name LIKE ? OR p.id = ?)';
                $params[] = '%' . $v . '%';
                $params[] = (int) $v;
            } else {
                $where[] = 'p.name LIKE ?';
                $params[] = '%' . $v . '%';
            }
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

        $sql = "SELECT p.*, c.name AS category_name, t.name AS type_name,
                       sc.name AS sub_classe_name, s.name AS supplier_name,
                       pp.name AS production_printer_name,
                       COALESCE(SUM(i.active = 1), 0) AS item_count,
                       (SELECT i2.unit FROM items i2
                         WHERE i2.product_id = p.id AND i2.active = 1
                         ORDER BY (i2.base_price IS NULL), i2.base_price ASC, i2.id
                         LIMIT 1) AS default_unit
                  FROM products p
                  LEFT JOIN categories c ON c.id = p.category_id
                  LEFT JOIN product_types t ON t.id = p.type_id
                  LEFT JOIN product_subclasses sc ON sc.id = p.sub_classe_id
                  LEFT JOIN suppliers s ON s.id = p.supplier_id
                  LEFT JOIN production_printers pp ON pp.id = p.production_printer_id
                  LEFT JOIN items i ON i.product_id = p.id
                 WHERE " . implode(' AND ', $where) . "
                 GROUP BY p.id, c.name, t.name, sc.name, s.name, pp.name
                 ORDER BY p.name" . self::pagination($req);
        $rows = Db::query($sql, $params);

        // Situação do estoque ao lado de cada linha. A tela se chama "Produtos / Estoque" e
        // não mostrava saldo nenhum: para saber quanto tinha de um item era preciso abrir o
        // modal dele, um por um — e os produtos com saldo negativo ficavam invisíveis.
        // Reusa o MESMO motor da contagem e da lista de compras (Replenishment), para as
        // três telas não discordarem sobre o que é crítico.
        $countable = [];
        foreach ($rows as $r) {
            if (in_array($r['tipo'] ?? '', Replenishment::COUNTABLE_TIPOS, true)) {
                $countable[] = (int) $r['id'];
            }
        }
        $usage = $countable ? Replenishment::dailyUsage($req->orgId(), $countable) : [];
        $incoming = $countable ? Replenishment::incoming($req->orgId(), $countable) : [];
        $countableSet = array_flip($countable);

        foreach ($rows as &$r) {
            $id = (int) $r['id'];
            $onHand = (float) ($r['stock_qty'] ?? 0);
            $r['incoming'] = $incoming[$id] ?? 0.0;
            if (!isset($countableSet[$id])) {
                // Prato/combo não se compra: o saldo dele é consequência da ficha técnica,
                // e classificá-lo como "a repor" mandaria comprar o que se produz.
                $r['stock_status'] = null;
                $r['daily_usage'] = null;
                continue;
            }
            $calc = Replenishment::suggest(
                $r, $onHand, Replenishment::DEFAULT_COVERAGE_DAYS,
                $usage[$id] ?? null, $r['incoming']
            );
            $r['stock_status'] = $calc['status'];
            $r['daily_usage'] = $calc['daily_usage'];
            $r['days_left'] = $calc['days_left'];
        }
        unset($r);

        Http::json($rows);
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
               FROM items i LEFT JOIN suppliers s ON s.id = i.supplier_id
              WHERE i.active = 1 AND i.product_id IS NULL{$extra}
              ORDER BY LOWER(i.name)"
        ));
    }

    public static function getById(Request $req): void
    {
        $product = self::find($req->intParam('id'), $req->orgId());
        $product['items'] = Db::query(
            "SELECT i.id, i.name, i.unit, i.base_price, s.name AS supplier_name
               FROM items i LEFT JOIN suppliers s ON s.id = i.supplier_id
              WHERE i.product_id = ? AND i.active = 1
              ORDER BY s.name, i.name",
            [$product['id']]
        );
        // Ficha técnica: insumos da receita (com custo do componente, quando cadastrado).
        $product['recipe'] = Db::query(
            "SELECT r.id, r.component_id, r.component_name, r.quantity, r.unit, r.sort_order,
                    c.name AS component_product_name, c.cost_price AS component_cost
               FROM product_recipe r
               LEFT JOIN products c ON c.id = r.component_id
              WHERE r.product_id = ?
              ORDER BY r.sort_order, r.id",
            [$product['id']]
        );
        // Variações de ficha técnica (grupos de escolha do PDV, ex.: "Proteína" do Executivo).
        $groups = Db::query(
            'SELECT id, name, required, sort_order FROM product_variation_groups WHERE product_id = ? ORDER BY sort_order, id',
            [$product['id']]
        );
        foreach ($groups as &$g) {
            $g['required'] = (bool) $g['required'];
            $g['options'] = Db::query(
                "SELECT o.id, o.name, o.component_id, o.quantity, o.price_delta, o.sort_order,
                        c.name AS component_product_name
                   FROM product_variation_options o
                   LEFT JOIN products c ON c.id = o.component_id
                  WHERE o.group_id = ?
                  ORDER BY o.sort_order, o.id",
                [$g['id']]
            );
        }
        unset($g);
        $product['variation_groups'] = $groups;
        Http::json($product);
    }

    /** Colunas escalares do produto além de name (taxonomia + fiscais + ficha técnica livre). */
    private const SCALAR = [
        'tipo' => 'str', 'category_id' => 'int', 'type_id' => 'int', 'sub_classe_id' => 'int',
        'production_printer_id' => 'int',
        'supplier_id' => 'int', 'unit' => 'str', 'purchase_unit' => 'str',
        'cost_price' => 'num', 'sale_price' => 'num',
        // Parâmetros de reposição (contagem de estoque → compra sugerida).
        'min_stock' => 'num', 'max_stock' => 'num', 'pack_size' => 'num',
        'ncm' => 'str', 'cest' => 'str', 'cfop' => 'str', 'cfop_saida_fora' => 'str', 'cfop_entrada' => 'str',
        'origem' => 'str', 'cst_csosn' => 'str', 'gtin' => 'str', 'regime_tributario' => 'str',
        'yield_qty' => 'num', 'yield_unit' => 'str', 'prep_time_min' => 'int',
        'prep_method' => 'str', 'tech_notes' => 'str',
        // Foto (data URL base64, thumbnail leve enviado pelo cliente — ver migration 035).
        'image_data' => 'str',
    ];

    public static function create(Request $req): void
    {
        $in = $req->input();
        $name = $in->requireString('name', 1, 200);
        $cols = ['org_id', 'name'];
        $vals = [$req->orgId(), $name];
        foreach (self::SCALAR as $key => $kind) {
            $cols[] = $key;
            $vals[] = self::scalar($in, $key, $kind);
        }
        $place = implode(', ', array_fill(0, count($cols), '?'));
        Db::execute('INSERT INTO products (' . implode(', ', $cols) . ") VALUES ({$place})", $vals);
        $id = Db::lastInsertId();
        if ($in->has('recipe')) {
            self::saveRecipe($id, $req->orgId(), $in->array('recipe'));
        }
        if ($in->has('variation_groups')) {
            self::saveVariations($id, $req->orgId(), $in->array('variation_groups'));
        }
        Http::json(self::find($id), 201);
    }

    public static function update(Request $req): void
    {
        $id = $req->intParam('id');
        self::find($id, $req->orgId());
        $in = $req->input();
        // Campos escalares opcionais: só atualiza os enviados.
        $fields = [];
        $values = [];
        if ($in->has('name')) {
            $fields[] = 'name = ?';
            $values[] = $in->requireString('name', 1, 200);
        }
        foreach (self::SCALAR as $key => $kind) {
            if ($in->has($key)) {
                $fields[] = "{$key} = ?";
                $values[] = self::scalar($in, $key, $kind);
            }
        }
        if ($fields) {
            $values[] = $id;
            Db::execute('UPDATE products SET ' . implode(', ', $fields) . ' WHERE id = ?', $values);
        }
        // Receita: se enviada, substitui a ficha inteira (lista completa por edição).
        if ($in->has('recipe')) {
            self::saveRecipe($id, $req->orgId(), $in->array('recipe'));
        }
        // Variações: mesmo padrão replace-all da receita.
        if ($in->has('variation_groups')) {
            self::saveVariations($id, $req->orgId(), $in->array('variation_groups'));
        }
        if (!$fields && !$in->has('recipe') && !$in->has('variation_groups')) {
            throw HttpError::badRequest('Informe ao menos um campo');
        }
        Http::json(self::find($id));
    }

    /** Coerção de um campo escalar conforme o tipo declarado em SCALAR. */
    private static function scalar(\App\Core\Input $in, string $key, string $kind): mixed
    {
        return match ($kind) {
            'int' => $in->integer($key),
            'num' => $in->number($key),
            default => $in->string($key),
        };
    }

    /** Regrava a receita de um produto (apaga a atual e insere a lista recebida). */
    private static function saveRecipe(int $productId, int $orgId, array $rows): void
    {
        Db::execute('DELETE FROM product_recipe WHERE product_id = ?', [$productId]);
        $sort = 0;
        foreach ($rows as $row) {
            if (!is_array($row)) {
                continue;
            }
            $componentId = isset($row['component_id']) && $row['component_id'] !== '' ? (int) $row['component_id'] : null;
            $componentName = isset($row['component_name']) ? trim((string) $row['component_name']) : '';
            $componentName = $componentName === '' ? null : $componentName;
            // Linha vazia (sem insumo nem texto) é ignorada.
            if ($componentId === null && $componentName === null) {
                continue;
            }
            $quantity = isset($row['quantity']) && is_numeric($row['quantity']) ? (float) $row['quantity'] : 0;
            $unit = isset($row['unit']) && trim((string) $row['unit']) !== '' ? trim((string) $row['unit']) : null;
            Db::execute(
                'INSERT INTO product_recipe (org_id, product_id, component_id, component_name, quantity, unit, sort_order)
                 VALUES (?, ?, ?, ?, ?, ?, ?)',
                [$orgId, $productId, $componentId, $componentName, $quantity, $unit, $sort++]
            );
        }
    }

    /**
     * Regrava os grupos de variação de um produto (apaga os atuais e insere a lista
     * recebida — ON DELETE CASCADE limpa as opções junto).
     */
    private static function saveVariations(int $productId, int $orgId, array $groups): void
    {
        Db::execute('DELETE FROM product_variation_groups WHERE product_id = ?', [$productId]);
        $gSort = 0;
        foreach ($groups as $g) {
            if (!is_array($g)) {
                continue;
            }
            $name = trim((string) ($g['name'] ?? ''));
            $options = is_array($g['options'] ?? null) ? $g['options'] : [];
            if ($name === '' || !$options) {
                continue; // grupo sem nome ou sem opções não faz sentido no PDV
            }
            Db::execute(
                'INSERT INTO product_variation_groups (org_id, product_id, name, required, sort_order) VALUES (?, ?, ?, ?, ?)',
                [$orgId, $productId, mb_substr($name, 0, 80), !empty($g['required']) ? 1 : 0, $gSort++]
            );
            $groupId = Db::lastInsertId();
            $oSort = 0;
            foreach ($options as $o) {
                if (!is_array($o)) {
                    continue;
                }
                $oName = trim((string) ($o['name'] ?? ''));
                if ($oName === '') {
                    continue;
                }
                $componentId = isset($o['component_id']) && $o['component_id'] !== '' && $o['component_id'] !== null
                    ? (int) $o['component_id'] : null;
                $quantity = isset($o['quantity']) && is_numeric($o['quantity']) ? (float) $o['quantity'] : 1;
                $priceDelta = isset($o['price_delta']) && is_numeric($o['price_delta']) ? (float) $o['price_delta'] : 0;
                Db::execute(
                    'INSERT INTO product_variation_options (group_id, name, component_id, quantity, price_delta, sort_order)
                     VALUES (?, ?, ?, ?, ?, ?)',
                    [$groupId, mb_substr($oName, 0, 80), $componentId, $quantity, $priceDelta, $oSort++]
                );
            }
        }
    }

    public static function remove(Request $req): void
    {
        $id = $req->intParam('id');
        self::find($id, $req->orgId());
        // Soft delete: desvincula itens e desativa.
        Db::execute('UPDATE items SET product_id = NULL WHERE product_id = ?', [$id]);
        Db::execute('UPDATE products SET active = 0 WHERE id = ?', [$id]);
        Http::noContent();
    }

    public static function assign(Request $req): void
    {
        $id = $req->intParam('id');
        self::find($id, $req->orgId());
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
               FROM items i LEFT JOIN suppliers s ON s.id = i.supplier_id
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

    /** Gate de tenant quando $orgId é informado; null = uso interno (pós-insert). */
    private static function find(int $id, ?int $orgId = null): array
    {
        $row = $orgId === null
            ? Db::queryOne('SELECT * FROM products WHERE id = ?', [$id])
            : Db::queryOne('SELECT * FROM products WHERE id = ? AND org_id = ?', [$id, $orgId]);
        if (!$row) {
            throw HttpError::notFound('Produto não encontrado');
        }
        return $row;
    }

    /** Paginação opcional: ?limit=N(&offset=M). Sem limit = tudo (compatível). */
    private static function pagination(\App\Core\Request $req): string
    {
        $limit = (int) ($req->query('limit') ?? 0);
        if ($limit < 1) {
            return '';
        }
        $limit = min($limit, 500);
        $offset = max(0, (int) ($req->query('offset') ?? 0));
        return " LIMIT {$limit} OFFSET {$offset}";
    }
}
