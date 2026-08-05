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
        // Vale para o item E para cada complemento (proteína, acompanhamento).
        $erpIds = [];
        foreach ($tree as $cat) {
            foreach ($cat['items'] as $item) {
                if (!empty($item['erp_product_id'])) {
                    $erpIds[(int) $item['erp_product_id']] = true;
                }
                foreach (($item['groups'] ?? []) as $g) {
                    foreach (($g['options'] ?? []) as $o) {
                        if (!empty($o['erp_product_id'])) {
                            $erpIds[(int) $o['erp_product_id']] = true;
                        }
                    }
                }
            }
        }
        $erpById = [];
        if ($erpIds) {
            $ph = implode(',', array_fill(0, count($erpIds), '?'));
            $rows = Db::query(
                "SELECT id, name, unit, image_data FROM products WHERE org_id = ? AND id IN ($ph)",
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
                foreach ($item['groups'] as &$g) {
                    foreach ($g['options'] as &$o) {
                        $op = !empty($o['erp_product_id']) ? ($erpById[(int) $o['erp_product_id']] ?? null) : null;
                        $o['erp_product_name'] = $op['name'] ?? null;
                        $o['erp_product_unit'] = $op['unit'] ?? null;
                    }
                    unset($o);
                }
                unset($g);
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
            // Quanto do produto vinculado uma unidade consome (1 = a ficha técnica manda).
            'erp_qty' => $in->has('erp_qty') ? self::erpQty($in->number('erp_qty')) : null,
            'sort' => $in->has('sort') ? ($in->integer('sort') ?? 0) : null,
        ];

        if ($id === null) {
            $id = self::insertId(
                'INSERT INTO menu_items (org_id, category_id, name, description, price, original_price, image_url, image_data, external_code, erp_product_id, erp_qty, sort, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
                    $cols['erp_qty'] ?? 1,
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
            foreach (['name', 'description', 'price', 'original_price', 'image_url', 'image_data', 'external_code', 'erp_product_id', 'erp_qty', 'sort'] as $k) {
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

        // Classes de complementos: o item apenas ANEXA classes existentes (na ordem
        // enviada). O conteúdo da classe é editado no módulo de Complementos — é isso
        // que faz uma mudança na classe valer em todos os itens que a usam.
        if ($in->has('group_ids')) {
            self::setItemGroups($id, $orgId, $in->array('group_ids'));
        }

        Http::json(self::itemDetail($id), $req->param('id') === null ? 201 : 200);
    }

    /**
     * Define exatamente quais classes de complementos o item usa, na ordem recebida.
     * Não toca no conteúdo das classes: desanexar um item nunca apaga a classe (ela
     * continua valendo para os outros itens).
     *
     * @param int[] $groupIds
     */
    private static function setItemGroups(int $itemId, int $orgId, array $groupIds): void
    {
        $kept = [];
        $sort = 0;
        foreach ($groupIds as $gid) {
            $gid = (int) $gid;
            if ($gid <= 0 || isset($kept[$gid])) {
                continue;
            }
            if (!Db::queryOne('SELECT id FROM menu_option_groups WHERE id = ? AND org_id = ?', [$gid, $orgId])) {
                throw HttpError::badRequest("Classe de complementos #{$gid} não encontrada");
            }
            Db::execute(
                'INSERT INTO menu_item_option_groups (item_id, group_id, sort) VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE sort = VALUES(sort)',
                [$itemId, $gid, $sort++]
            );
            $kept[$gid] = true;
        }
        if ($kept) {
            $ph = implode(',', array_fill(0, count($kept), '?'));
            Db::execute(
                "DELETE FROM menu_item_option_groups WHERE item_id = ? AND group_id NOT IN ({$ph})",
                array_merge([$itemId], array_keys($kept))
            );
        } else {
            Db::execute('DELETE FROM menu_item_option_groups WHERE item_id = ?', [$itemId]);
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

    /**
     * POST /delivery/menu/options/:id/availability { active } — pausa/reativa um complemento.
     * A opção pertence à CLASSE, então isso vale de imediato em todo item que a usa.
     */
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
              WHERE o.id = ? AND g.org_id = ?',
            [$id, $req->orgId()]
        );
        if (!$row) {
            throw HttpError::notFound('Complemento não encontrado');
        }
        Db::execute('UPDATE menu_options SET active = ? WHERE id = ?', [$active ? 1 : 0, $id]);
        Http::json(['ok' => true, 'active' => $active, 'used_in' => self::usedIn($id, 'option')]);
    }

    /**
     * POST /delivery/menu/groups/:id/availability { active } — pausa/reativa a classe
     * inteira. Vale em todos os itens que a usam (é o ponto do módulo).
     */
    public static function groupAvailability(Request $req): void
    {
        $id = $req->intParam('id');
        $active = $req->input()->boolean('active', null);
        if ($active === null) {
            throw HttpError::badRequest("Informe 'active' (true/false)");
        }
        self::group($id, $req->orgId());
        Db::execute('UPDATE menu_option_groups SET active = ? WHERE id = ?', [$active ? 1 : 0, $id]);
        Http::json(['ok' => true, 'active' => $active, 'used_in' => self::usedIn($id, 'group')]);
    }

    // ---- módulo de complementos (classes reutilizáveis) ----

    /** GET /delivery/menu/option-groups — classes com opções e onde cada uma é usada. */
    public static function listGroups(Request $req): void
    {
        $orgId = $req->orgId();
        $groups = Db::query('SELECT * FROM menu_option_groups WHERE org_id = ? ORDER BY name, id', [$orgId]);
        if (!$groups) {
            Http::json([]);
            return;
        }
        $options = Db::query(
            'SELECT o.* FROM menu_options o JOIN menu_option_groups g ON g.id = o.group_id
              WHERE g.org_id = ? ORDER BY o.sort, o.id',
            [$orgId]
        );
        $usage = Db::query(
            'SELECT l.group_id, i.id AS item_id, i.name AS item_name, i.active
               FROM menu_item_option_groups l JOIN menu_items i ON i.id = l.item_id
              WHERE i.org_id = ? ORDER BY i.name',
            [$orgId]
        );
        // Nome do produto do ERP vinculado em cada opção (mesma decoração do tree).
        $erpIds = [];
        foreach ($options as $o) {
            if (!empty($o['erp_product_id'])) {
                $erpIds[(int) $o['erp_product_id']] = true;
            }
        }
        $erpById = [];
        if ($erpIds) {
            $ph = implode(',', array_fill(0, count($erpIds), '?'));
            foreach (Db::query("SELECT id, name, unit FROM products WHERE org_id = ? AND id IN ($ph)", array_merge([$orgId], array_keys($erpIds))) as $p) {
                $erpById[(int) $p['id']] = $p;
            }
        }

        $optsByGroup = [];
        foreach ($options as $o) {
            $p = !empty($o['erp_product_id']) ? ($erpById[(int) $o['erp_product_id']] ?? null) : null;
            $o['erp_product_name'] = $p['name'] ?? null;
            $o['erp_product_unit'] = $p['unit'] ?? null;
            $optsByGroup[(int) $o['group_id']][] = $o;
        }
        $itemsByGroup = [];
        foreach ($usage as $u) {
            $itemsByGroup[(int) $u['group_id']][] = [
                'id' => (int) $u['item_id'],
                'name' => $u['item_name'],
                'active' => (int) $u['active'],
            ];
        }
        foreach ($groups as &$g) {
            $g['options'] = $optsByGroup[(int) $g['id']] ?? [];
            $g['items'] = $itemsByGroup[(int) $g['id']] ?? [];
            $g['used_in'] = count($g['items']);
        }
        unset($g);
        Http::json($groups);
    }

    public static function createGroup(Request $req): void
    {
        self::saveGroup($req, null);
    }

    public static function updateGroup(Request $req): void
    {
        self::saveGroup($req, $req->intParam('id'));
    }

    /**
     * Cria/atualiza uma classe de complementos. As opções são substituídas pelo
     * conjunto enviado (ids preservados p/ não perder os links de sync nem o de-para
     * de estoque). Qualquer mudança aqui vale na hora em TODOS os itens que usam a classe.
     */
    private static function saveGroup(Request $req, ?int $id): void
    {
        $orgId = $req->orgId();
        $in = $req->input();
        if ($id !== null) {
            self::group($id, $orgId);
        }
        $name = $in->has('name') || $id === null ? $in->requireString('name', 1, 100) : null;
        $min = $in->has('min') ? max((int) ($in->integer('min') ?? 0), 0) : null;
        $max = $in->has('max') ? max((int) ($in->integer('max') ?? 1), 1) : null;

        if ($id === null) {
            $id = self::insertId(
                'INSERT INTO menu_option_groups (org_id, name, min, max, sort, active) VALUES (?, ?, ?, ?, 0, ?)',
                [$orgId, $name, $min ?? 0, $max ?? 1, ($in->boolean('active', true) ?? true) ? 1 : 0],
                'menu_option_groups'
            );
        } else {
            $fields = [];
            $values = [];
            foreach (['name' => $name, 'min' => $min, 'max' => $max] as $col => $val) {
                if ($val !== null) {
                    $fields[] = "{$col} = ?";
                    $values[] = $val;
                }
            }
            if ($in->has('active')) {
                $fields[] = 'active = ?';
                $values[] = ($in->boolean('active', true) ?? true) ? 1 : 0;
            }
            if ($fields) {
                $values[] = $id;
                Db::execute('UPDATE menu_option_groups SET ' . implode(', ', $fields) . ' WHERE id = ?', $values);
            }
        }

        if ($in->has('options')) {
            self::replaceOptions($id, $in->array('options'));
        }
        // `item_ids` é opcional: permite aplicar a classe a vários itens de uma vez.
        if ($in->has('item_ids')) {
            self::setGroupItems($id, $orgId, $in->array('item_ids'));
        }
        Http::json(self::groupDetail($id, $orgId), $req->param('id') === null ? 201 : 200);
    }

    /** Substitui as opções da classe, preservando os ids enviados. */
    private static function replaceOptions(int $groupId, array $options): void
    {
        $kept = [];
        $sort = 0;
        foreach ($options as $o) {
            if (!is_array($o)) {
                continue;
            }
            $name = mb_substr(trim((string) ($o['name'] ?? '')), 0, 100);
            if ($name === '') {
                continue;
            }
            $oid = isset($o['id']) ? (int) $o['id'] : null;
            $price = (float) ($o['price'] ?? 0);
            $desc = isset($o['description']) ? (string) $o['description'] : null;
            $img = isset($o['image_data']) ? (string) $o['image_data'] : null;
            $active = !empty($o['active']) || !isset($o['active']) ? 1 : 0;
            // De-para do COMPLEMENTO com o ERP: é ele que faz a proteína/acompanhamento
            // escolhido sair do estoque (o item sozinho só cobre a base do prato).
            $product = !empty($o['erp_product_id']) ? (int) $o['erp_product_id'] : null;
            $qty = self::erpQty($o['erp_qty'] ?? null);
            if ($oid !== null && Db::queryOne('SELECT id FROM menu_options WHERE id = ? AND group_id = ?', [$oid, $groupId])) {
                Db::execute(
                    'UPDATE menu_options SET name = ?, description = ?, price = ?, image_data = ?, erp_product_id = ?, erp_qty = ?, sort = ?, active = ? WHERE id = ?',
                    [$name, $desc, $price, $img, $product, $qty, $sort, $active, $oid]
                );
            } else {
                $oid = self::insertId(
                    'INSERT INTO menu_options (group_id, name, description, price, image_data, erp_product_id, erp_qty, sort, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [$groupId, $name, $desc, $price, $img, $product, $qty, $sort, $active],
                    'menu_options'
                );
            }
            $kept[] = $oid;
            $sort++;
        }
        if ($kept) {
            $ph = implode(',', array_fill(0, count($kept), '?'));
            Db::execute("DELETE FROM menu_options WHERE group_id = ? AND id NOT IN ({$ph})", array_merge([$groupId], $kept));
        } else {
            Db::execute('DELETE FROM menu_options WHERE group_id = ?', [$groupId]);
        }
    }

    /**
     * PUT /delivery/menu/option-groups/:id/items { item_ids } — define em quais itens a
     * classe é usada. É o "reutilizar em vários itens" visto do lado da classe.
     */
    public static function setGroupUsage(Request $req): void
    {
        $id = $req->intParam('id');
        $orgId = $req->orgId();
        self::group($id, $orgId);
        self::setGroupItems($id, $orgId, $req->input()->array('item_ids'));
        Http::json(self::groupDetail($id, $orgId));
    }

    /** @param int[] $itemIds */
    private static function setGroupItems(int $groupId, int $orgId, array $itemIds): void
    {
        $kept = [];
        foreach ($itemIds as $itemId) {
            $itemId = (int) $itemId;
            if ($itemId <= 0 || isset($kept[$itemId])) {
                continue;
            }
            if (!Db::queryOne('SELECT id FROM menu_items WHERE id = ? AND org_id = ?', [$itemId, $orgId])) {
                throw HttpError::badRequest("Item #{$itemId} não encontrado");
            }
            // Entra no fim da lista de complementos do item (sem remexer na ordem já feita).
            $next = Db::queryOne('SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM menu_item_option_groups WHERE item_id = ?', [$itemId]);
            Db::execute(
                'INSERT IGNORE INTO menu_item_option_groups (item_id, group_id, sort) VALUES (?, ?, ?)',
                [$itemId, $groupId, (int) ($next['s'] ?? 0)]
            );
            $kept[$itemId] = true;
        }
        if ($kept) {
            $ph = implode(',', array_fill(0, count($kept), '?'));
            Db::execute(
                "DELETE FROM menu_item_option_groups WHERE group_id = ? AND item_id NOT IN ({$ph})",
                array_merge([$groupId], array_keys($kept))
            );
        } else {
            Db::execute('DELETE FROM menu_item_option_groups WHERE group_id = ?', [$groupId]);
        }
    }

    /** DELETE /delivery/menu/option-groups/:id — apaga a classe (e a desanexa de todos os itens). */
    public static function deleteGroup(Request $req): void
    {
        $id = $req->intParam('id');
        self::group($id, $req->orgId());
        self::dropChannelLinks($id);
        Db::execute('DELETE FROM menu_option_groups WHERE id = ?', [$id]);
        Http::noContent();
    }

    /**
     * Apaga os links de sync da classe e das opções dela. `menu_channel_links` não tem
     * FK para essas tabelas (a chave é só channel+tipo+local_id), então sem isto sobram
     * linhas apontando para ids mortos — e um id reaproveitado herdaria o UUID errado
     * na publicação.
     */
    private static function dropChannelLinks(int $groupId): void
    {
        Db::execute(
            "DELETE FROM menu_channel_links WHERE entity_type = 'option'
              AND local_id IN (SELECT id FROM menu_options WHERE group_id = ?)",
            [$groupId]
        );
        Db::execute("DELETE FROM menu_channel_links WHERE entity_type = 'group' AND local_id = ?", [$groupId]);
    }

    /**
     * POST /delivery/menu/option-groups/merge-duplicates — unifica classes IDÊNTICAS
     * (mesmo nome e mesma lista de opções: nome + preço, na ordem). O import das
     * plataformas cria uma classe por item, então "Escolha sua Proteína" nasce
     * repetida N vezes; isto as funde numa só, mantendo a mais antiga e repontando
     * os vínculos. `?dry_run=1` só devolve o que seria feito.
     */
    public static function mergeDuplicateGroups(Request $req): void
    {
        $orgId = $req->orgId();
        $dryRun = $req->query('dry_run') !== null || ($req->input()->boolean('dry_run', false) ?? false);

        $groups = Db::query('SELECT id, name, min, max FROM menu_option_groups WHERE org_id = ? ORDER BY id', [$orgId]);
        $byFingerprint = [];
        foreach ($groups as $g) {
            $opts = Db::query('SELECT name, price FROM menu_options WHERE group_id = ? ORDER BY sort, id', [(int) $g['id']]);
            $sig = json_encode([
                mb_strtolower(trim((string) $g['name'])),
                (int) $g['min'],
                (int) $g['max'],
                array_map(static fn ($o) => [mb_strtolower(trim((string) $o['name'])), (float) $o['price']], $opts),
            ], JSON_UNESCAPED_UNICODE);
            $byFingerprint[$sig][] = (int) $g['id'];
        }

        $merged = [];
        foreach ($byFingerprint as $ids) {
            if (count($ids) < 2) {
                continue;
            }
            $keep = array_shift($ids); // a mais antiga vence (menor id)
            $name = Db::queryOne('SELECT name FROM menu_option_groups WHERE id = ?', [$keep])['name'] ?? '';
            $merged[] = ['keep' => $keep, 'name' => $name, 'removed' => $ids];
            if ($dryRun) {
                continue;
            }
            foreach ($ids as $dup) {
                // Reaponta os itens da duplicada para a que fica (preservando a ordem
                // que o item já tinha), depois apaga a duplicada (opções em cascata).
                foreach (Db::query('SELECT item_id, sort FROM menu_item_option_groups WHERE group_id = ?', [$dup]) as $l) {
                    Db::execute(
                        'INSERT IGNORE INTO menu_item_option_groups (item_id, group_id, sort) VALUES (?, ?, ?)',
                        [(int) $l['item_id'], $keep, (int) $l['sort']]
                    );
                }
                self::dropChannelLinks($dup);
                Db::execute('DELETE FROM menu_option_groups WHERE id = ?', [$dup]);
            }
        }
        Http::json([
            'dry_run' => $dryRun,
            'classes_unificadas' => count($merged),
            'classes_removidas' => array_sum(array_map(static fn ($m) => count($m['removed']), $merged)),
            'detalhe' => $merged,
        ]);
    }

    /** Quantos itens usam a classe (ou a classe da opção) — a UI mostra o alcance da mudança. */
    private static function usedIn(int $id, string $kind): int
    {
        $sql = $kind === 'option'
            ? 'SELECT COUNT(*) AS n FROM menu_item_option_groups l JOIN menu_options o ON o.group_id = l.group_id WHERE o.id = ?'
            : 'SELECT COUNT(*) AS n FROM menu_item_option_groups WHERE group_id = ?';
        return (int) (Db::queryOne($sql, [$id])['n'] ?? 0);
    }

    private static function group(int $id, int $orgId): array
    {
        $g = Db::queryOne('SELECT * FROM menu_option_groups WHERE id = ? AND org_id = ?', [$id, $orgId]);
        if (!$g) {
            throw HttpError::notFound('Classe de complementos não encontrada');
        }
        return $g;
    }

    private static function groupDetail(int $id, int $orgId): array
    {
        $g = self::group($id, $orgId);
        $g['options'] = Db::query('SELECT * FROM menu_options WHERE group_id = ? ORDER BY sort, id', [$id]);
        $g['items'] = Db::query(
            'SELECT i.id, i.name, i.active FROM menu_item_option_groups l JOIN menu_items i ON i.id = l.item_id
              WHERE l.group_id = ? ORDER BY i.name',
            [$id]
        );
        $g['used_in'] = count($g['items']);
        return $g;
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

    /**
     * Fator de consumo do vínculo com o ERP. Coluna NOT NULL DEFAULT 1: ausente,
     * vazio ou não-positivo vira 1 (o consumo sai da ficha técnica do produto).
     */
    private static function erpQty(mixed $v): float
    {
        $q = is_numeric($v) ? (float) $v : 0.0;
        return $q > 0 ? $q : 1.0;
    }

    /** INSERT e devolve o id gerado (Db::insertReturning retorna a linha inteira). */
    private static function insertId(string $sql, array $params, string $table): int
    {
        return (int) Db::insertReturning($sql, $params, $table)['id'];
    }

    private static function itemDetail(int $id): array
    {
        $item = Db::queryOne('SELECT * FROM menu_items WHERE id = ?', [$id]) ?? [];
        // Classes anexadas ao item, na ordem do vínculo (o sort é por item).
        $groups = Db::query(
            'SELECT g.*, l.sort AS sort FROM menu_item_option_groups l
               JOIN menu_option_groups g ON g.id = l.group_id
              WHERE l.item_id = ? ORDER BY l.sort, l.id',
            [$id]
        );
        foreach ($groups as &$g) {
            $g['options'] = Db::query('SELECT * FROM menu_options WHERE group_id = ? ORDER BY sort, id', [$g['id']]);
            $g['used_in'] = self::usedIn((int) $g['id'], 'group');
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
