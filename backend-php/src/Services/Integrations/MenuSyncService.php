<?php

namespace App\Services\Integrations;

use App\Core\Db;
use App\Core\HttpError;

/**
 * Publica o cardápio mestre local (menu_categories/menu_items/menu_option_groups/
 * menu_options) nas plataformas e importa o cardápio remoto para bootstrap.
 *
 * Mapeamento de ids:
 *  - 99Food: app_*_id determinístico derivado do id local ("c{id}", "i{id}", ...).
 *    O upload substitui o cardápio inteiro, então não há estado remoto a rastrear
 *    além do próprio app id.
 *  - iFood: UUIDs gerados aqui e persistidos em menu_channel_links (external_id +
 *    extra.productId). Reusar o mesmo UUID em PUTs subsequentes = update.
 *
 * Preço local em REAIS; 99Food usa CENTAVOS (×100), iFood usa decimal.
 */
final class MenuSyncService
{
    // ---- árvore local ----

    /** Árvore completa do cardápio local da org (inclui inativos; o filtro é por uso). */
    public static function localTree(int $orgId): array
    {
        $categories = Db::query('SELECT * FROM menu_categories WHERE org_id = ? ORDER BY sort, id', [$orgId]);
        $items = Db::query('SELECT * FROM menu_items WHERE org_id = ? ORDER BY sort, id', [$orgId]);
        // A classe de complementos é da ORG, não do item: a mesma "Proteínas" é anexada a
        // vários itens (menu_item_option_groups). Cada item recebe uma CÓPIA da classe com
        // o sort do vínculo — a mesma classe pode ser a 1ª num prato e a 3ª noutro.
        $groups = Db::query('SELECT * FROM menu_option_groups WHERE org_id = ? ORDER BY name, id', [$orgId]);
        $options = Db::query('SELECT * FROM menu_options ORDER BY sort, id');
        $links = Db::query(
            'SELECT l.item_id, l.group_id, l.sort
               FROM menu_item_option_groups l
               JOIN menu_option_groups g ON g.id = l.group_id
              WHERE g.org_id = ? ORDER BY l.sort, l.id',
            [$orgId]
        );

        $optionsByGroup = [];
        foreach ($options as $o) {
            $optionsByGroup[(int) $o['group_id']][] = $o;
        }
        // Quantos itens usam cada classe — a UI avisa antes de editar algo compartilhado.
        $usedBy = [];
        foreach ($links as $l) {
            $usedBy[(int) $l['group_id']] = ($usedBy[(int) $l['group_id']] ?? 0) + 1;
        }
        $groupById = [];
        foreach ($groups as $g) {
            $g['options'] = $optionsByGroup[(int) $g['id']] ?? [];
            $g['used_in'] = $usedBy[(int) $g['id']] ?? 0;
            $groupById[(int) $g['id']] = $g;
        }
        $groupsByItem = [];
        foreach ($links as $l) {
            $g = $groupById[(int) $l['group_id']] ?? null;
            if ($g === null) {
                continue;
            }
            $g['sort'] = (int) $l['sort'];
            $groupsByItem[(int) $l['item_id']][] = $g;
        }
        $itemsByCategory = [];
        foreach ($items as $i) {
            $i['groups'] = $groupsByItem[(int) $i['id']] ?? [];
            $itemsByCategory[(int) $i['category_id']][] = $i;
        }
        foreach ($categories as &$c) {
            $c['items'] = $itemsByCategory[(int) $c['id']] ?? [];
        }
        unset($c);
        return $categories;
    }

    // ---- publicação ----

    /** Publica o cardápio local inteiro no canal. Retorna resumo p/ a UI. */
    public static function publish(array $channel): array
    {
        $tree = self::localTree((int) $channel['org_id']);
        $active = array_values(array_filter($tree, static fn ($c) => (int) $c['active'] === 1));
        if (!$active) {
            throw HttpError::unprocessable('Cardápio local vazio (ou sem categorias ativas) — cadastre ou importe antes de publicar.');
        }
        try {
            $summary = match ((string) $channel['platform']) {
                '99food' => self::publishNineNine($channel, $active),
                'ifood' => self::publishIfood($channel, $active),
                default => throw HttpError::badRequest('Plataforma não suportada'),
            };
            self::log($channel, 'publish', 'ok', json_encode($summary, JSON_UNESCAPED_UNICODE));
            return $summary;
        } catch (\Throwable $e) {
            self::log($channel, 'publish', 'error', $e->getMessage());
            throw $e;
        }
    }

    /** 99Food: item/item/upload substitui o cardápio inteiro de uma vez. */
    private static function publishNineNine(array $channel, array $tree): array
    {
        $menus = [['app_menu_id' => 'menu1', 'menu_name' => 'Cardápio']];
        $categories = [];
        $items = [];
        foreach ($tree as $cat) {
            $activeItems = array_values(array_filter($cat['items'], static fn ($i) => (int) $i['active'] === 1));
            if (!$activeItems) {
                continue; // categoria sem itens ativos não vai no upload
            }
            $categories[] = [
                'app_category_id' => 'c' . $cat['id'],
                'category_name' => mb_substr((string) $cat['name'], 0, 100),
                'app_item_ids' => array_map(static fn ($i) => 'i' . $i['id'], $activeItems),
            ];
            foreach ($activeItems as $item) {
                $struct = [
                    'app_item_id' => 'i' . $item['id'],
                    'item_name' => mb_substr((string) $item['name'], 0, 50),
                    'price' => (int) round(((float) $item['price']) * 100),
                ];
                if (!empty($item['description'])) {
                    $struct['short_desc'] = mb_substr((string) $item['description'], 0, 300);
                }
                if (!empty($item['external_code'])) {
                    $struct['app_external_id'] = (string) $item['external_code'];
                }
                if (!empty($item['image_url'])) {
                    $struct['head_img'] = (string) $item['image_url'];
                }
                $contents = [];
                foreach ($item['groups'] as $g) {
                    if ((int) $g['active'] !== 1) {
                        continue;
                    }
                    $activeOpts = array_values(array_filter($g['options'], static fn ($o) => (int) $o['active'] === 1));
                    if (!$activeOpts) {
                        continue;
                    }
                    // Ids do complemento são prefixados com o ITEM: no 99Food o grupo vai
                    // aninhado dentro de cada item, e uma classe compartilhada apareceria
                    // com o mesmo app_content_id em vários itens do mesmo upload.
                    $ns = 'i' . $item['id'] . '_';
                    $contents[] = [
                        'content' => [
                            'app_content_id' => $ns . 'g' . $g['id'],
                            'content_name' => mb_substr((string) $g['name'], 0, 50),
                            'is_required' => ((int) $g['min']) > 0 ? 1 : 2,
                            'quantity_min_permitted' => (int) $g['min'],
                            'quantity_max_permitted' => max((int) $g['max'], 1),
                            'buy_mode' => 0,
                        ],
                        'sub_item_list' => array_map(static fn ($o) => [
                            'app_sub_item_id' => $ns . 'o' . $o['id'],
                            'sub_item_name' => mb_substr((string) $o['name'], 0, 50),
                            'price' => (int) round(((float) $o['price']) * 100),
                        ], $activeOpts),
                    ];
                }
                if ($contents) {
                    $struct['content_with_sub_item'] = $contents;
                }
                $items[] = $struct;
            }
        }
        if (!$items) {
            throw HttpError::unprocessable('Nenhum item ativo para publicar.');
        }
        NineNineClient::menuUpload($channel, $menus, $categories, $items);
        // Marca tudo que foi publicado (external_id = app id determinístico).
        $now = [];
        foreach ($categories as $c) {
            $now[] = ['category', (int) substr($c['app_category_id'], 1), $c['app_category_id']];
        }
        foreach ($items as $i) {
            $now[] = ['item', (int) substr($i['app_item_id'], 1), $i['app_item_id']];
        }
        foreach ($now as [$type, $localId, $ext]) {
            self::saveLink((int) $channel['id'], $type, $localId, $ext);
        }
        return ['platform' => '99food', 'categories' => count($categories), 'items' => count($items)];
    }

    /** iFood: garante categorias e faz PUT item a item com UUIDs persistidos. */
    private static function publishIfood(array $channel, array $tree): array
    {
        $merchantId = (string) ($channel['merchant_id'] ?? '');
        if ($merchantId === '') {
            throw HttpError::badRequest('Canal iFood sem Merchant ID configurado');
        }
        $catalogId = self::ifoodCatalogId($channel, $merchantId);
        $links = self::linksMap((int) $channel['id']);

        $countCats = 0;
        $countItems = 0;
        $paused = 0;
        foreach ($tree as $cat) {
            $activeItems = array_values(array_filter($cat['items'], static fn ($i) => (int) $i['active'] === 1));
            // Garante a categoria no iFood (cria uma vez; depois reusa o id salvo).
            $catExt = $links['category'][(int) $cat['id']]['external_id'] ?? null;
            if ($catExt === null) {
                if (!$activeItems) {
                    continue; // não cria categoria vazia
                }
                $created = IfoodClient::createCategory($channel, $merchantId, $catalogId, [
                    'name' => mb_substr((string) $cat['name'], 0, 100),
                    'status' => 'AVAILABLE',
                    'template' => 'DEFAULT',
                    'sequence' => (int) $cat['sort'],
                ]);
                $catExt = (string) ($created['id'] ?? '');
                if ($catExt === '') {
                    throw HttpError::unprocessable("iFood não retornou o id da categoria '{$cat['name']}'.");
                }
                self::saveLink((int) $channel['id'], 'category', (int) $cat['id'], $catExt);
                $links['category'][(int) $cat['id']] = ['external_id' => $catExt, 'extra' => null];
                $countCats++;
            }

            foreach ($cat['items'] as $item) {
                $localId = (int) $item['id'];
                $link = $links['item'][$localId] ?? null;
                if ((int) $item['active'] !== 1) {
                    // Item desativado: se já existe no iFood, pausa (não dá pra deletar via PUT).
                    if ($link) {
                        IfoodClient::patchItemStatus($channel, $merchantId, ['itemId' => $link['external_id'], 'status' => 'UNAVAILABLE']);
                        $paused++;
                    }
                    continue;
                }
                [$payload, $ids] = self::ifoodItemPayload($item, $catExt, $link, $links, (int) $channel['id']);
                IfoodClient::upsertItem($channel, $merchantId, $payload);
                self::saveLink((int) $channel['id'], 'item', $localId, $ids['itemId'], ['productId' => $ids['productId']]);
                $links['item'][$localId] = ['external_id' => $ids['itemId'], 'extra' => ['productId' => $ids['productId']]];
                $countItems++;
            }
        }
        return ['platform' => 'ifood', 'categories_created' => $countCats, 'items' => $countItems, 'paused' => $paused];
    }

    /**
     * Monta o payload do PUT /items do iFood para um item local (com grupos e
     * complementos), reusando UUIDs já publicados ou gerando novos.
     * @return array{0:array,1:array{itemId:string,productId:string}}
     */
    private static function ifoodItemPayload(array $item, string $categoryExtId, ?array $link, array $links, int $channelId): array
    {
        $extra = is_string($link['extra'] ?? null) ? json_decode($link['extra'], true) : ($link['extra'] ?? null);
        $itemId = $link['external_id'] ?? self::uuid();
        $productId = (string) ($extra['productId'] ?? self::uuid());

        $products = [[
            'id' => $productId,
            'name' => mb_substr((string) $item['name'], 0, 100),
            'description' => (string) ($item['description'] ?? ''),
            'externalCode' => (string) ($item['external_code'] ?? ('item_' . $item['id'])),
            'serving' => 'NOT_APPLICABLE',
            'optionGroups' => [],
        ]];
        $optionGroups = [];
        $options = [];

        foreach ($item['groups'] as $g) {
            if ((int) $g['active'] !== 1) {
                continue;
            }
            $activeOpts = array_values(array_filter($g['options'], static fn ($o) => (int) $o['active'] === 1));
            if (!$activeOpts) {
                continue;
            }
            $gLink = $links['group'][(int) $g['id']] ?? null;
            $groupId = $gLink['external_id'] ?? self::uuid();
            self::saveLink($channelId, 'group', (int) $g['id'], $groupId);

            $optionIds = [];
            foreach ($activeOpts as $o) {
                $oLink = $links['option'][(int) $o['id']] ?? null;
                $oExtra = is_string($oLink['extra'] ?? null) ? json_decode($oLink['extra'], true) : ($oLink['extra'] ?? null);
                $optionId = $oLink['external_id'] ?? self::uuid();
                $optProductId = (string) ($oExtra['productId'] ?? self::uuid());
                self::saveLink($channelId, 'option', (int) $o['id'], $optionId, ['productId' => $optProductId]);

                $products[] = [
                    'id' => $optProductId,
                    'name' => mb_substr((string) $o['name'], 0, 100),
                    'description' => (string) ($o['description'] ?? ''),
                    'externalCode' => 'option_' . $o['id'],
                    'serving' => 'NOT_APPLICABLE',
                    'optionGroups' => null,
                ];
                $options[] = [
                    'id' => $optionId,
                    'status' => 'AVAILABLE',
                    'index' => (int) $o['sort'],
                    'productId' => $optProductId,
                    'price' => ['value' => (float) $o['price']],
                    'externalCode' => 'option_' . $o['id'],
                ];
                $optionIds[] = $optionId;
            }
            $optionGroups[] = [
                'id' => $groupId,
                'name' => mb_substr((string) $g['name'], 0, 100),
                'externalCode' => 'group_' . $g['id'],
                'status' => 'AVAILABLE',
                'index' => (int) $g['sort'],
                'optionGroupType' => 'DEFAULT',
                'optionIds' => $optionIds,
            ];
            $products[0]['optionGroups'][] = ['id' => $groupId, 'min' => (int) $g['min'], 'max' => max((int) $g['max'], 1)];
        }
        if (!$products[0]['optionGroups']) {
            $products[0]['optionGroups'] = null;
        }
        if (!empty($item['image_url'])) {
            $products[0]['imagePath'] = (string) $item['image_url'];
        }

        $price = ['value' => (float) $item['price']];
        if (!empty($item['original_price']) && (float) $item['original_price'] > (float) $item['price']) {
            $price['originalValue'] = (float) $item['original_price'];
        }
        $payload = [
            'item' => [
                'id' => $itemId,
                'type' => 'DEFAULT',
                'categoryId' => $categoryExtId,
                'status' => 'AVAILABLE',
                'price' => $price,
                'externalCode' => (string) ($item['external_code'] ?? ('item_' . $item['id'])),
                'index' => (int) $item['sort'],
                'productId' => $productId,
            ],
            'products' => $products,
            'optionGroups' => $optionGroups,
            'options' => $options,
        ];
        return [$payload, ['itemId' => $itemId, 'productId' => $productId]];
    }

    /** Resolve o catalogId DEFAULT do merchant (cacheia em extra do canal? — busca sempre; é 1 GET). */
    private static function ifoodCatalogId(array $channel, string $merchantId): string
    {
        $catalogs = IfoodClient::catalogs($channel, $merchantId);
        foreach ($catalogs as $c) {
            $ctx = array_map('strtoupper', (array) ($c['context'] ?? []));
            if (in_array('DEFAULT', $ctx, true)) {
                return (string) $c['catalogId'];
            }
        }
        $first = $catalogs[0]['catalogId'] ?? null;
        if (!is_string($first) || $first === '') {
            throw HttpError::unprocessable('O iFood não retornou nenhum catálogo para esta loja (módulo Catalog habilitado no app?).');
        }
        return $first;
    }

    // ---- disponibilidade de item (pausar/reativar em todos os canais) ----

    /**
     * Propaga a disponibilidade de um item para um canal. Lança em falha —
     * o chamador decide se agrega erros (best-effort) ou aborta.
     */
    public static function pushItemStatus(array $channel, array $item, bool $active): void
    {
        $platform = (string) $channel['platform'];
        if ($platform === '99food') {
            NineNineClient::updateItemStatus($channel, 'i' . $item['id'], $active ? 1 : 2);
            return;
        }
        if ($platform === 'ifood') {
            $link = Db::queryOne(
                "SELECT * FROM menu_channel_links WHERE channel_id = ? AND entity_type = 'item' AND local_id = ?",
                [(int) $channel['id'], (int) $item['id']]
            );
            if (!$link) {
                return; // nunca publicado neste canal — nada a pausar
            }
            $merchantId = (string) ($channel['merchant_id'] ?? '');
            IfoodClient::patchItemStatus($channel, $merchantId, [
                'itemId' => (string) $link['external_id'],
                'status' => $active ? 'AVAILABLE' : 'UNAVAILABLE',
            ]);
        }
    }

    // ---- importação (bootstrap a partir do cardápio remoto) ----

    /** Importa o cardápio remoto do canal para o catálogo local (exige catálogo vazio). */
    public static function import(array $channel): array
    {
        $existing = Db::queryOne('SELECT COUNT(*) AS n FROM menu_categories');
        if ((int) ($existing['n'] ?? 0) > 0) {
            throw HttpError::unprocessable('O cardápio local já tem categorias — importe apenas com o catálogo vazio (evita duplicar).');
        }
        $summary = match ((string) $channel['platform']) {
            '99food' => self::importNineNine($channel),
            'ifood' => self::importIfood($channel),
            default => throw HttpError::badRequest('Plataforma não suportada'),
        };
        self::log($channel, 'import', 'ok', json_encode($summary, JSON_UNESCAPED_UNICODE));
        return $summary;
    }

    /**
     * Categoria de destino dos itens que o 99Food devolve SEM `app_item_id`.
     * Ver importNineNine: a API não diz a que categoria eles pertencem.
     */
    private const NINE_NINE_ORPHAN_CATEGORY = 'Sem categoria (99Food)';

    /**
     * Importa o cardápio do 99Food.
     *
     * ATENÇÃO ao `app_item_id`: ele é o id do PARCEIRO, e vem VAZIO para todo item
     * criado direto no portal do 99Food (na loja real, 14 dos 32). A versão anterior
     * indexava os itens por esse campo — todos os sem-id colapsavam na mesma chave `''`,
     * e como a categoria também os referencia por `''`, cada vaga recebia o ÚLTIMO item
     * do array. Resultado: 14 itens idênticos no cardápio local, com os nomes reais
     * perdidos (e a baixa de estoque, que casa pedido↔cardápio por nome, sem chance).
     *
     * Agora id vazio nunca vira chave de busca. O item sem id é importado com o nome
     * certo, mas numa categoria à parte: o payload não tem NENHUM campo que diga a
     * categoria dele, e adivinhar pela ordem do array não bate (conferido no cardápio
     * real). Cabe ao operador arrastá-los para a categoria certa — uma vez.
     */
    private static function importNineNine(array $channel): array
    {
        $menu = NineNineClient::menuList($channel);
        $itemsById = [];
        $orphans = [];
        foreach ((array) ($menu['items'] ?? []) as $i) {
            $appItemId = trim((string) ($i['app_item_id'] ?? ''));
            if ($appItemId === '') {
                $orphans[] = $i;
                continue;
            }
            $itemsById[$appItemId] = $i;
        }

        $nCats = $nItems = 0;
        $sort = 0;
        foreach ((array) ($menu['categories'] ?? []) as $cat) {
            $catId = self::insertId(
                'INSERT INTO menu_categories (org_id, name, sort) VALUES (?, ?, ?)',
                [(int) $channel['org_id'], mb_substr((string) ($cat['category_name'] ?? 'Categoria'), 0, 100), $sort++],
                'menu_categories'
            );
            self::saveLink((int) $channel['id'], 'category', $catId, self::externalId($cat['app_category_id'] ?? null, 'c' . $catId));
            $nCats++;
            $iSort = 0;
            foreach ((array) ($cat['app_item_ids'] ?? []) as $appItemId) {
                $appItemId = trim((string) $appItemId);
                // Vaga sem id: o item existe, mas a API não diz qual — vai pros órfãos.
                $item = $appItemId !== '' ? ($itemsById[$appItemId] ?? null) : null;
                if (!$item) {
                    continue;
                }
                self::importNineNineItem($channel, $catId, $item, $iSort++, $appItemId);
                $nItems++;
            }
        }

        if ($orphans) {
            $catId = self::insertId(
                'INSERT INTO menu_categories (org_id, name, sort) VALUES (?, ?, ?)',
                [(int) $channel['org_id'], self::NINE_NINE_ORPHAN_CATEGORY, $sort++],
                'menu_categories'
            );
            $nCats++;
            $iSort = 0;
            foreach ($orphans as $item) {
                self::importNineNineItem($channel, $catId, $item, $iSort++, '');
                $nItems++;
            }
        }

        return [
            'platform' => '99food',
            'categories' => $nCats,
            'items' => $nItems,
            // A UI mostra o resumo: deixa explícito quantos precisam ser recategorizados.
            'sem_categoria' => count($orphans),
        ];
    }

    /**
     * Grava um item do 99Food (com grupos e complementos) numa categoria já criada.
     * `$appItemId` vazio = item sem id do parceiro: importa igual, mas sem link de sync
     * (link com external_id vazio não serviria para nada na publicação).
     */
    private static function importNineNineItem(array $channel, int $catId, array $item, int $sort, string $appItemId): void
    {
        $itemId = self::insertId(
            'INSERT INTO menu_items (org_id, category_id, name, description, price, image_url, external_code, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [
                (int) $channel['org_id'],
                $catId,
                mb_substr((string) ($item['item_name'] ?? 'Item'), 0, 100),
                $item['short_desc'] ?? null,
                ((int) ($item['price'] ?? 0)) / 100,
                $item['head_img'] ?? null,
                $item['app_external_id'] ?? null,
                $sort,
            ],
            'menu_items'
        );
        if ($appItemId !== '') {
            self::saveLink((int) $channel['id'], 'item', $itemId, $appItemId);
        }

        $gSort = 0;
        foreach ((array) ($item['content_with_sub_item'] ?? []) as $cws) {
            $content = (array) ($cws['content'] ?? []);
            $groupId = self::createGroupForItem(
                (int) $channel['org_id'],
                $itemId,
                mb_substr((string) ($content['content_name'] ?? 'Complementos'), 0, 100),
                ((int) ($content['is_required'] ?? 2)) === 1 ? max((int) ($content['quantity_min_permitted'] ?? 1), 1) : 0,
                max((int) ($content['quantity_max_permitted'] ?? 1), 1),
                $gSort++,
                1
            );
            self::saveLink((int) $channel['id'], 'group', $groupId, self::externalId($content['app_content_id'] ?? null, 'g' . $groupId));
            $oSort = 0;
            foreach ((array) ($cws['sub_item_list'] ?? []) as $sub) {
                $optId = self::insertId(
                    'INSERT INTO menu_options (group_id, name, price, sort) VALUES (?, ?, ?, ?)',
                    [
                        $groupId,
                        mb_substr((string) ($sub['sub_item_name'] ?? 'Opção'), 0, 100),
                        ((int) ($sub['price'] ?? 0)) / 100,
                        $oSort++,
                    ],
                    'menu_options'
                );
                self::saveLink((int) $channel['id'], 'option', $optId, self::externalId($sub['app_sub_item_id'] ?? null, 'o' . $optId));
            }
        }
    }

    /**
     * Cria uma classe de complementos já vinculada a um item (caminho da importação:
     * a plataforma manda os grupos aninhados no item, sem noção de reuso). Depois o
     * operador pode unificar as classes idênticas no módulo de Complementos.
     */
    private static function createGroupForItem(int $orgId, int $itemId, string $name, int $min, int $max, int $sort, int $active): int
    {
        $groupId = self::insertId(
            'INSERT INTO menu_option_groups (org_id, name, min, max, sort, active) VALUES (?, ?, ?, ?, ?, ?)',
            [$orgId, $name, $min, $max, $sort, $active],
            'menu_option_groups'
        );
        Db::execute(
            'INSERT IGNORE INTO menu_item_option_groups (item_id, group_id, sort) VALUES (?, ?, ?)',
            [$itemId, $groupId, $sort]
        );
        return $groupId;
    }

    /**
     * Id externo do canal, com fallback. O `??` sozinho não bastava: o 99Food manda
     * string VAZIA (não null) nos ids que não existem, e vazio não é identidade.
     */
    private static function externalId(mixed $value, string $fallback): string
    {
        $v = is_scalar($value) ? trim((string) $value) : '';
        return $v !== '' ? $v : $fallback;
    }

    private static function importIfood(array $channel): array
    {
        $merchantId = (string) ($channel['merchant_id'] ?? '');
        if ($merchantId === '') {
            throw HttpError::badRequest('Canal iFood sem Merchant ID configurado');
        }
        $catalogId = self::ifoodCatalogId($channel, $merchantId);
        $cats = IfoodClient::categories($channel, $merchantId, $catalogId, true);
        $nCats = $nItems = 0;
        foreach ($cats as $cat) {
            $catId = self::insertId(
                'INSERT INTO menu_categories (org_id, name, sort, active) VALUES (?, ?, ?, ?)',
                [
                    (int) $channel['org_id'],
                    mb_substr((string) ($cat['name'] ?? 'Categoria'), 0, 100),
                    (int) ($cat['sequence'] ?? $nCats),
                    strtoupper((string) ($cat['status'] ?? 'AVAILABLE')) === 'AVAILABLE' ? 1 : 0,
                ],
                'menu_categories'
            );
            self::saveLink((int) $channel['id'], 'category', $catId, (string) ($cat['id'] ?? ''));
            $nCats++;
            foreach ((array) ($cat['items'] ?? []) as $item) {
                $price = (array) ($item['price'] ?? []);
                $itemId = self::insertId(
                    'INSERT INTO menu_items (org_id, category_id, name, description, price, original_price, image_url, external_code, sort, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [
                        (int) $channel['org_id'],
                        $catId,
                        mb_substr((string) ($item['name'] ?? 'Item'), 0, 100),
                        $item['description'] ?? null,
                        (float) ($price['value'] ?? 0),
                        isset($price['originalValue']) ? (float) $price['originalValue'] : null,
                        ($item['imagePath'] ?? '') !== '' ? (string) $item['imagePath'] : null,
                        $item['externalCode'] ?? null,
                        (int) ($item['sequence'] ?? 0),
                        strtoupper((string) ($item['status'] ?? 'AVAILABLE')) === 'AVAILABLE' ? 1 : 0,
                    ],
                    'menu_items'
                );
                self::saveLink((int) $channel['id'], 'item', $itemId, (string) ($item['id'] ?? ''), ['productId' => $item['productId'] ?? null]);
                $nItems++;
                foreach ((array) ($item['optionGroups'] ?? []) as $g) {
                    $groupId = self::createGroupForItem(
                        (int) $channel['org_id'],
                        $itemId,
                        mb_substr((string) ($g['name'] ?? 'Complementos'), 0, 100),
                        (int) ($g['min'] ?? 0),
                        max((int) ($g['max'] ?? 1), 1),
                        (int) ($g['sequence'] ?? 0),
                        strtoupper((string) ($g['status'] ?? 'AVAILABLE')) === 'AVAILABLE' ? 1 : 0
                    );
                    self::saveLink((int) $channel['id'], 'group', $groupId, (string) ($g['id'] ?? ''));
                    foreach ((array) ($g['options'] ?? []) as $o) {
                        $oPrice = (array) ($o['price'] ?? []);
                        $optId = self::insertId(
                            'INSERT INTO menu_options (group_id, name, description, price, sort, active) VALUES (?, ?, ?, ?, ?, ?)',
                            [
                                $groupId,
                                mb_substr((string) ($o['name'] ?? 'Opção'), 0, 100),
                                $o['description'] ?? null,
                                (float) ($oPrice['value'] ?? 0),
                                (int) ($o['sequence'] ?? 0),
                                strtoupper((string) ($o['status'] ?? 'AVAILABLE')) === 'AVAILABLE' ? 1 : 0,
                            ],
                            'menu_options'
                        );
                        self::saveLink((int) $channel['id'], 'option', $optId, (string) ($o['id'] ?? ''), ['productId' => $o['productId'] ?? null]);
                    }
                }
            }
        }
        return ['platform' => 'ifood', 'categories' => $nCats, 'items' => $nItems];
    }

    // ---- helpers ----

    /** @return array<string,array<int,array{external_id:string,extra:mixed}>> por tipo → id local */
    private static function linksMap(int $channelId): array
    {
        $map = ['category' => [], 'item' => [], 'group' => [], 'option' => []];
        foreach (Db::query('SELECT * FROM menu_channel_links WHERE channel_id = ?', [$channelId]) as $l) {
            $map[(string) $l['entity_type']][(int) $l['local_id']] = [
                'external_id' => (string) $l['external_id'],
                'extra' => $l['extra'],
            ];
        }
        return $map;
    }

    private static function saveLink(int $channelId, string $type, int $localId, string $externalId, ?array $extra = null): void
    {
        Db::execute(
            'INSERT INTO menu_channel_links (channel_id, entity_type, local_id, external_id, extra, synced_at)
             VALUES (?, ?, ?, ?, ?, NOW())
             ON DUPLICATE KEY UPDATE external_id = VALUES(external_id), extra = VALUES(extra), synced_at = NOW()',
            [$channelId, $type, $localId, $externalId, $extra !== null ? json_encode($extra, JSON_UNESCAPED_UNICODE) : null]
        );
    }

    /** INSERT e devolve o id gerado (Db::insertReturning retorna a linha inteira). */
    private static function insertId(string $sql, array $params, string $table): int
    {
        return (int) Db::insertReturning($sql, $params, $table)['id'];
    }

    private static function log(array $channel, string $action, string $status, ?string $detail): void
    {
        Db::execute(
            'INSERT INTO menu_sync_log (channel_id, action, status, detail) VALUES (?, ?, ?, ?)',
            [(int) $channel['id'], $action, $status, $detail]
        );
    }

    /** UUID v4 — ids de entidades do Catalog do iFood são gerados pelo integrador. */
    private static function uuid(): string
    {
        $b = random_bytes(16);
        $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
        $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($b), 4));
    }
}
