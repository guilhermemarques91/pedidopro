<?php

namespace App\Modules\Delivery;

use App\Core\Db;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Request;
use App\Services\Integrations\MenuSyncService;

/**
 * Cardápio mestre local (fonte da verdade) + publicação/importação por canal.
 * CRUD de categorias/itens (itens carregam grupos e complementos aninhados).
 */
final class CatalogController
{
    // ---- leitura ----

    /** GET /delivery/menu — árvore completa + status de sync por canal. */
    public static function tree(Request $req): void
    {
        $tree = MenuSyncService::localTree($req->orgId());
        // synced_at por item×canal p/ a UI indicar o que está publicado/desatualizado.
        $links = Db::query(
            "SELECT l.channel_id, l.local_id, l.synced_at, c.platform, c.name AS channel_name
               FROM menu_channel_links l JOIN channels c ON c.id = l.channel_id
              WHERE l.entity_type = 'item' AND c.org_id = ?",
            [$req->orgId()]
        );
        $byItem = [];
        foreach ($links as $l) {
            $byItem[(int) $l['local_id']][] = [
                'channel_id' => (int) $l['channel_id'],
                'platform' => $l['platform'],
                'channel_name' => $l['channel_name'],
                'synced_at' => $l['synced_at'],
            ];
        }
        // De-para com produtos do ERP: nome do produto vinculado (p/ exibir o vínculo)
        // e foto herdada quando o item não tem imagem própria. Decora só a UI — não
        // passa pelo localTree, então a publicação nas plataformas fica intocada.
        $erpIds = [];
        foreach ($tree as $cat) {
            foreach ($cat['items'] as $item) {
                if (!empty($item['erp_product_id'])) {
                    $erpIds[(int) $item['erp_product_id']] = true;
                }
            }
        }
        $erpById = [];
        if ($erpIds) {
            $ph = implode(',', array_fill(0, count($erpIds), '?'));
            $rows = Db::query(
                "SELECT id, name, image_data FROM products WHERE org_id = ? AND id IN ($ph)",
                array_merge([$req->orgId()], array_keys($erpIds))
            );
            foreach ($rows as $r) {
                $erpById[(int) $r['id']] = $r;
            }
        }
        foreach ($tree as &$cat) {
            foreach ($cat['items'] as &$item) {
                $item['channels'] = $byItem[(int) $item['id']] ?? [];
                $prod = !empty($item['erp_product_id']) ? ($erpById[(int) $item['erp_product_id']] ?? null) : null;
                $item['erp_product_name'] = $prod['name'] ?? null;
                if (empty($item['image_data']) && empty($item['image_url']) && !empty($prod['image_data'])) {
                    $item['image_data'] = $prod['image_data'];
                }
            }
            unset($item);
        }
        unset($cat);
        Http::json($tree);
    }

    /** GET /delivery/menu/remote/:channelId — cardápio cru da plataforma (conferência). */
    public static function remote(Request $req): void
    {
        $channel = self::channel($req->intParam('channelId'), $req->orgId());
        $data = match ((string) $channel['platform']) {
            '99food' => \App\Services\Integrations\NineNineClient::menuList($channel),
            'ifood' => self::ifoodRemote($channel),
            default => throw HttpError::badRequest('Plataforma não suportada'),
        };
        Http::json($data);
    }

    private static function ifoodRemote(array $channel): array
    {
        $merchantId = (string) ($channel['merchant_id'] ?? '');
        if ($merchantId === '') {
            throw HttpError::badRequest('Canal iFood sem Merchant ID configurado');
        }
        $catalogs = \App\Services\Integrations\IfoodClient::catalogs($channel, $merchantId);
        $default = null;
        foreach ($catalogs as $c) {
            if (in_array('DEFAULT', array_map('strtoupper', (array) ($c['context'] ?? [])), true)) {
                $default = (string) $c['catalogId'];
                break;
            }
        }
        $default ??= (string) ($catalogs[0]['catalogId'] ?? '');
        return [
            'catalogs' => $catalogs,
            'categories' => $default !== ''
                ? \App\Services\Integrations\IfoodClient::categories($channel, $merchantId, $default, true)
                : [],
        ];
    }

    // ---- categorias ----

    public static function createCategory(Request $req): void
    {
        $in = $req->input();
        $id = self::insertId(
            'INSERT INTO menu_categories (org_id, name, sort, active) VALUES (?, ?, ?, ?)',
            [
                $req->orgId(),
                $in->requireString('name', 1, 100),
                $in->integer('sort') ?? 0,
                ($in->boolean('active', true) ?? true) ? 1 : 0,
            ],
            'menu_categories'
        );
        Http::json(Db::queryOne('SELECT * FROM menu_categories WHERE id = ?', [$id]), 201);
    }

    public static function updateCategory(Request $req): void
    {
        $id = $req->intParam('id');
        self::exists('menu_categories', $id, 'Categoria', $req->orgId());
        $in = $req->input();
        $fields = [];
        $values = [];
        if ($in->has('name')) {
            $fields[] = 'name = ?';
            $values[] = $in->requireString('name', 1, 100);
        }
        if ($in->has('sort')) {
            $fields[] = 'sort = ?';
            $values[] = $in->integer('sort') ?? 0;
        }
        if ($in->has('active')) {
            $fields[] = 'active = ?';
            $values[] = ($in->boolean('active', true) ?? true) ? 1 : 0;
        }
        if (!$fields) {
            throw HttpError::badRequest('Nada para atualizar');
        }
        $values[] = $id;
        Db::execute('UPDATE menu_categories SET ' . implode(', ', $fields) . ' WHERE id = ?', $values);
        Http::json(Db::queryOne('SELECT * FROM menu_categories WHERE id = ?', [$id]));
    }

    public static function deleteCategory(Request $req): void
    {
        $id = $req->intParam('id');
        self::exists('menu_categories', $id, 'Categoria', $req->orgId());
        Db::execute('DELETE FROM menu_categories WHERE id = ?', [$id]);
        Http::noContent();
    }

    // ---- itens (com grupos/complementos aninhados) ----

    /** POST /delivery/menu/items — cria item; PUT /delivery/menu/items/:id — atualiza. */
    public static function createItem(Request $req): void
    {
        self::saveItem($req, null);
    }

    public static function updateItem(Request $req): void
    {
        self::saveItem($req, $req->intParam('id'));
    }

    private static function saveItem(Request $req, ?int $id): void
    {
        $orgId = $req->orgId();
        $in = $req->input();
        if ($id !== null) {
            self::exists('menu_items', $id, 'Item', $orgId);
        }
        $categoryId = $in->integer('category_id', $id === null);
        if ($categoryId !== null) {
            self::exists('menu_categories', $categoryId, 'Categoria', $orgId);
        }

        $cols = [
            'name' => $in->has('name') ? $in->requireString('name', 1, 100) : null,
            'description' => $in->string('description'),
            'price' => $in->has('price') ? (float) ($in->number('price') ?? 0) : null,
            'original_price' => $in->has('original_price') ? $in->number('original_price') : null,
            'image_url' => $in->string('image_url'),
            'image_data' => $in->string('image_data'),
            'external_code' => $in->string('external_code'),
            // De-para com o produto do ERP: destrava a baixa de estoque por ficha técnica
            // e a herança da foto do produto quando o item não tem imagem própria.
            'erp_product_id' => $in->has('erp_product_id') ? $in->integer('erp_product_id') : null,
            'sort' => $in->has('sort') ? ($in->integer('sort') ?? 0) : null,
        ];

        if ($id === null) {
            $id = self::insertId(
                'INSERT INTO menu_items (org_id, category_id, name, description, price, original_price, image_url, image_data, external_code, erp_product_id, sort, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [
                    $orgId,
                    $categoryId,
                    $cols['name'] ?? '',
                    $cols['description'],
                    $cols['price'] ?? 0,
                    $cols['original_price'],
                    $cols['image_url'],
                    $cols['image_data'],
                    $cols['external_code'],
                    $cols['erp_product_id'],
                    $cols['sort'] ?? 0,
                    ($in->boolean('active', true) ?? true) ? 1 : 0,
                ],
                'menu_items'
            );
        } else {
            $fields = [];
            $values = [];
            if ($categoryId !== null) {
                $fields[] = 'category_id = ?';
                $values[] = $categoryId;
            }
            foreach (['name', 'description', 'price', 'original_price', 'image_url', 'image_data', 'external_code', 'erp_product_id', 'sort'] as $k) {
                if ($in->has($k)) {
                    $fields[] = "{$k} = ?";
                    $values[] = $cols[$k];
                }
            }
            if ($in->has('active')) {
                $fields[] = 'active = ?';
                $values[] = ($in->boolean('active', true) ?? true) ? 1 : 0;
            }
            if ($fields) {
                $values[] = $id;
                Db::execute('UPDATE menu_items SET ' . implode(', ', $fields) . ' WHERE id = ?', $values);
            }
        }

        // Grupos/complementos aninhados: substitui o conjunto quando enviado.
        if ($in->has('groups')) {
            self::replaceGroups($id, $in->array('groups'));
        }

        Http::json(self::itemDetail($id), $req->param('id') === null ? 201 : 200);
    }

    /** Substitui grupos+opções do item preservando ids enviados (mantém links de sync). */
    private static function replaceGroups(int $itemId, array $groups): void
    {
        $keptGroups = [];
        $sort = 0;
        foreach ($groups as $g) {
            if (!is_array($g)) {
                continue;
            }
            $gid = isset($g['id']) ? (int) $g['id'] : null;
            $name = mb_substr(trim((string) ($g['name'] ?? '')), 0, 100);
            if ($name === '') {
                continue;
            }
            $min = max((int) ($g['min'] ?? 0), 0);
            $max = max((int) ($g['max'] ?? 1), 1);
            $active = !empty($g['active']) || !isset($g['active']) ? 1 : 0;
            if ($gid !== null && Db::queryOne('SELECT id FROM menu_option_groups WHERE id = ? AND item_id = ?', [$gid, $itemId])) {
                Db::execute('UPDATE menu_option_groups SET name = ?, min = ?, max = ?, sort = ?, active = ? WHERE id = ?', [$name, $min, $max, $sort, $active, $gid]);
            } else {
                $gid = self::insertId('INSERT INTO menu_option_groups (item_id, name, min, max, sort, active) VALUES (?, ?, ?, ?, ?, ?)', [$itemId, $name, $min, $max, $sort, $active], 'menu_option_groups');
            }
            $keptGroups[] = $gid;
            $sort++;

            $keptOptions = [];
            $oSort = 0;
            foreach ((array) ($g['options'] ?? []) as $o) {
                if (!is_array($o)) {
                    continue;
                }
                $oid = isset($o['id']) ? (int) $o['id'] : null;
                $oName = mb_substr(trim((string) ($o['name'] ?? '')), 0, 100);
                if ($oName === '') {
                    continue;
                }
                $price = (float) ($o['price'] ?? 0);
                $desc = isset($o['description']) ? (string) $o['description'] : null;
                $oImg = isset($o['image_data']) ? (string) $o['image_data'] : null;
                $oActive = !empty($o['active']) || !isset($o['active']) ? 1 : 0;
                if ($oid !== null && Db::queryOne('SELECT id FROM menu_options WHERE id = ? AND group_id = ?', [$oid, $gid])) {
                    Db::execute('UPDATE menu_options SET name = ?, description = ?, price = ?, image_data = ?, sort = ?, active = ? WHERE id = ?', [$oName, $desc, $price, $oImg, $oSort, $oActive, $oid]);
                } else {
                    $oid = self::insertId('INSERT INTO menu_options (group_id, name, description, price, image_data, sort, active) VALUES (?, ?, ?, ?, ?, ?, ?)', [$gid, $oName, $desc, $price, $oImg, $oSort, $oActive], 'menu_options');
                }
                $keptOptions[] = $oid;
                $oSort++;
            }
            self::deleteMissing('menu_options', 'group_id', $gid, $keptOptions);
        }
        self::deleteMissing('menu_option_groups', 'item_id', $itemId, $keptGroups);
    }

    private static function deleteMissing(string $table, string $fkCol, int $fkVal, array $keptIds): void
    {
        if ($keptIds) {
            $ph = implode(',', array_fill(0, count($keptIds), '?'));
            Db::execute("DELETE FROM {$table} WHERE {$fkCol} = ? AND id NOT IN ({$ph})", array_merge([$fkVal], $keptIds));
        } else {
            Db::execute("DELETE FROM {$table} WHERE {$fkCol} = ?", [$fkVal]);
        }
    }

    public static function deleteItem(Request $req): void
    {
        $id = $req->intParam('id');
        self::exists('menu_items', $id, 'Item', $req->orgId());
        Db::execute('DELETE FROM menu_items WHERE id = ?', [$id]);
        Http::noContent();
    }

    /**
     * POST /delivery/menu/items/:id/availability { active } — pausa/reativa o item
     * localmente e propaga aos canais ativos (best-effort; agrega erros).
     */
    public static function itemAvailability(Request $req): void
    {
        $id = $req->intParam('id');
        $item = Db::queryOne('SELECT * FROM menu_items WHERE id = ? AND org_id = ?', [$id, $req->orgId()]);
        if (!$item) {
            throw HttpError::notFound('Item não encontrado');
        }
        $active = $req->input()->boolean('active', null);
        if ($active === null) {
            throw HttpError::badRequest("Informe 'active' (true/false)");
        }
        Db::execute('UPDATE menu_items SET active = ? WHERE id = ?', [$active ? 1 : 0, $id]);

        $errors = [];
        foreach (Db::query('SELECT * FROM channels WHERE active = 1 AND org_id = ?', [$req->orgId()]) as $channel) {
            try {
                MenuSyncService::pushItemStatus($channel, $item, $active);
            } catch (\Throwable $e) {
                $errors[] = ['channel' => $channel['name'], 'error' => $e->getMessage()];
            }
        }
        Http::json(['ok' => !$errors, 'active' => $active, 'errors' => $errors]);
    }

    /** POST /delivery/menu/options/:id/availability { active } — pausa/reativa um complemento (local). */
    public static function optionAvailability(Request $req): void
    {
        $id = $req->intParam('id');
        $active = $req->input()->boolean('active', null);
        if ($active === null) {
            throw HttpError::badRequest("Informe 'active' (true/false)");
        }
        $row = Db::queryOne(
            'SELECT o.id FROM menu_options o
               JOIN menu_option_groups g ON g.id = o.group_id
               JOIN menu_items i ON i.id = g.item_id
              WHERE o.id = ? AND i.org_id = ?',
            [$id, $req->orgId()]
        );
        if (!$row) {
            throw HttpError::notFound('Complemento não encontrado');
        }
        Db::execute('UPDATE menu_options SET active = ? WHERE id = ?', [$active ? 1 : 0, $id]);
        Http::json(['ok' => true, 'active' => $active]);
    }

    /** POST /delivery/menu/groups/:id/availability { active } — pausa/reativa um grupo de complementos (local). */
    public static function groupAvailability(Request $req): void
    {
        $id = $req->intParam('id');
        $active = $req->input()->boolean('active', null);
        if ($active === null) {
            throw HttpError::badRequest("Informe 'active' (true/false)");
        }
        $row = Db::queryOne(
            'SELECT g.id FROM menu_option_groups g
               JOIN menu_items i ON i.id = g.item_id
              WHERE g.id = ? AND i.org_id = ?',
            [$id, $req->orgId()]
        );
        if (!$row) {
            throw HttpError::notFound('Grupo não encontrado');
        }
        Db::execute('UPDATE menu_option_groups SET active = ? WHERE id = ?', [$active ? 1 : 0, $id]);
        Http::json(['ok' => true, 'active' => $active]);
    }

    // ---- publicação / importação ----

    /** POST /delivery/menu/publish/:channelId — publica o cardápio local no canal. */
    public static function publish(Request $req): void
    {
        Http::json(MenuSyncService::publish(self::channel($req->intParam('channelId'), $req->orgId())));
    }

    /** POST /delivery/menu/import/:channelId — importa o cardápio remoto (bootstrap). */
    public static function import(Request $req): void
    {
        Http::json(MenuSyncService::import(self::channel($req->intParam('channelId'), $req->orgId())));
    }

    // ---- helpers ----

    /** INSERT e devolve o id gerado (Db::insertReturning retorna a linha inteira). */
    private static function insertId(string $sql, array $params, string $table): int
    {
        return (int) Db::insertReturning($sql, $params, $table)['id'];
    }

    private static function itemDetail(int $id): array
    {
        $item = Db::queryOne('SELECT * FROM menu_items WHERE id = ?', [$id]) ?? [];
        $groups = Db::query('SELECT * FROM menu_option_groups WHERE item_id = ? ORDER BY sort, id', [$id]);
        foreach ($groups as &$g) {
            $g['options'] = Db::query('SELECT * FROM menu_options WHERE group_id = ? ORDER BY sort, id', [$g['id']]);
        }
        unset($g);
        $item['groups'] = $groups;
        return $item;
    }

    private static function channel(int $id, int $orgId): array
    {
        $c = Db::queryOne('SELECT * FROM channels WHERE id = ? AND org_id = ?', [$id, $orgId]);
        if (!$c) {
            throw HttpError::notFound('Canal não encontrado');
        }
        return $c;
    }

    private static function exists(string $table, int $id, string $label, int $orgId): void
    {
        if (!Db::queryOne("SELECT id FROM {$table} WHERE id = ? AND org_id = ?", [$id, $orgId])) {
            throw HttpError::notFound("{$label} não encontrada");
        }
    }
}
