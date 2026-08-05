<?php

namespace App;

use App\Core\Http;
use App\Core\Router;
use App\Modules\Auth\AuthController;
use App\Modules\Categories\CategoriesController;
use App\Modules\Suppliers\SuppliersController;
use App\Modules\Items\ItemsController;
use App\Modules\Products\ProductsController;
use App\Modules\Products\ProductTypesController;
use App\Modules\Products\SubclassesController;
use App\Modules\Products\PrintersController;
use App\Modules\Quotations\QuotationsController;
use App\Modules\Orders\OrdersController;
use App\Modules\Requests\RequestsController;
use App\Modules\Users\UsersController;
use App\Modules\Roles\RolesController;
use App\Modules\Audit\AuditController;
use App\Modules\Settings\SettingsController;
use App\Modules\Stock\StockController;
use App\Modules\Stock\CountsController;
use App\Modules\Stock\ParamsController;
use App\Modules\Nfe\NfeController;
use App\Modules\Inbox\InboxController;
use App\Modules\Import\ImportController;
use App\Modules\Import\ProductsImportController;
use App\Modules\Whatsapp\WhatsappController;
use App\Modules\Webhooks\WebhooksController;
use App\Modules\Delivery\DeliveryController;
use App\Modules\Delivery\ReportsController;
use App\Modules\Delivery\MerchantController;
use App\Modules\Delivery\CatalogController;
use App\Modules\Delivery\MapController;
use App\Modules\Delivery\PrintController;
use App\Modules\Marmitex\MarmitexCatalogController;
use App\Modules\Marmitex\MarmitexCompaniesController;
use App\Modules\Marmitex\MarmitexOrdersController;
use App\Modules\Marmitex\MarmitexReportController;
use App\Modules\Marmitex\MarmitexLabelsController;
use App\Modules\Marmitex\MarmitexSheetController;
use App\Modules\Marmitex\MarmitexWaController;
use App\Modules\Vendas\VendasController;
use App\Modules\Vendas\VendasStationsController;

/**
 * Registro central das rotas. Guards por PERMISSÃO granular (`modulo:acao`), ver
 * App\Core\Permissions. null = público; [] (ANY) = qualquer autenticado.
 */
final class Routes
{
    private const ANY = [];                          // qualquer autenticado (ex.: /auth/me)
    // Compras & cadastros
    private const READ = ['compras:read'];
    private const WRITE = ['compras:write'];
    private const APPROVE = ['compras:approve'];
    private const REQUESTS = ['compras:requests'];
    private const COMPRAS_ADMIN = ['compras:admin'];
    // Estoque
    private const ESTOQUE_READ = ['estoque:read'];
    private const ESTOQUE_MOVE = ['estoque:mover'];
    private const ESTOQUE_COUNT = ['estoque:contagem'];
    // Delivery
    private const DELIVERY = ['delivery:operate'];
    private const DELIVERY_ADMIN = ['delivery:admin'];
    // Marmitex
    private const MARMITEX = ['marmitex:order'];
    private const MARMITEX_ADMIN = ['marmitex:admin'];
    // Vendas (balcão, retirada, mesas e comandas)
    private const VENDAS = ['vendas:operate'];
    private const VENDAS_ADMIN = ['vendas:admin'];
    // Administração / sistema
    private const USERS = ['users:manage'];
    private const SYSTEM = ['system:admin'];
    private const AUDIT = ['system:audit'];

    public static function register(Router $r): void
    {
        // Health
        $r->get('/health', fn () => Http::json(['status' => 'ok']), null);

        // Marca/personalização (login precisa antes da autenticação)
        $r->get('/branding', [SettingsController::class, 'branding'], null);
        $r->put('/settings/branding', [SettingsController::class, 'update'], self::SYSTEM);

        // Auth
        $r->post('/auth/login', [AuthController::class, 'login'], null);
        $r->get('/auth/me', [AuthController::class, 'me'], self::ANY);
        $r->post('/auth/change-password', [AuthController::class, 'changePassword'], self::ANY);

        // Categories
        $r->get('/categories', [CategoriesController::class, 'list'], self::READ);
        $r->get('/categories/:id', [CategoriesController::class, 'getById'], self::READ);
        $r->post('/categories', [CategoriesController::class, 'create'], self::COMPRAS_ADMIN);
        $r->put('/categories/:id', [CategoriesController::class, 'update'], self::COMPRAS_ADMIN);
        $r->delete('/categories/:id', [CategoriesController::class, 'remove'], self::COMPRAS_ADMIN);

        // Suppliers
        $r->get('/suppliers', [SuppliersController::class, 'list'], self::READ);
        $r->get('/suppliers/:id', [SuppliersController::class, 'getById'], self::READ);
        $r->post('/suppliers', [SuppliersController::class, 'create'], self::WRITE);
        $r->put('/suppliers/:id', [SuppliersController::class, 'update'], self::WRITE);
        $r->delete('/suppliers/:id', [SuppliersController::class, 'remove'], self::COMPRAS_ADMIN);

        // Items
        $r->get('/items', [ItemsController::class, 'list'], self::READ);
        $r->get('/items/:id', [ItemsController::class, 'getById'], self::READ);
        $r->post('/items', [ItemsController::class, 'create'], self::WRITE);
        $r->put('/items/:id', [ItemsController::class, 'update'], self::WRITE);
        $r->delete('/items/:id', [ItemsController::class, 'remove'], self::COMPRAS_ADMIN);
        $r->post('/items/:id/suppliers', [ItemsController::class, 'linkSupplier'], self::WRITE);
        $r->delete('/items/:id/suppliers/:supplierId', [ItemsController::class, 'unlinkSupplier'], self::WRITE);

        // Products (rotas específicas antes de /:id)
        $r->get('/products', [ProductsController::class, 'list'], self::READ);
        $r->get('/products/unmapped', [ProductsController::class, 'unmapped'], self::READ);
        $r->post('/products/suggest', [ProductsController::class, 'suggest'], self::WRITE);
        $r->post('/products/unassign', [ProductsController::class, 'unassign'], self::WRITE);
        $r->post('/products', [ProductsController::class, 'create'], self::WRITE);
        $r->get('/products/:id', [ProductsController::class, 'getById'], self::READ);
        $r->put('/products/:id', [ProductsController::class, 'update'], self::WRITE);
        $r->delete('/products/:id', [ProductsController::class, 'remove'], self::WRITE);
        $r->post('/products/:id/items', [ProductsController::class, 'assign'], self::WRITE);

        // Tipos de produto (eixo do cadastro de estoque)
        $r->get('/product-types', [ProductTypesController::class, 'list'], self::READ);
        $r->post('/product-types', [ProductTypesController::class, 'create'], self::WRITE);
        $r->put('/product-types/:id', [ProductTypesController::class, 'update'], self::WRITE);
        $r->delete('/product-types/:id', [ProductTypesController::class, 'remove'], self::WRITE);

        // Sub-classes (filhas da Classe)
        $r->get('/product-subclasses', [SubclassesController::class, 'list'], self::READ);
        $r->post('/product-subclasses', [SubclassesController::class, 'create'], self::WRITE);
        $r->put('/product-subclasses/:id', [SubclassesController::class, 'update'], self::WRITE);
        $r->delete('/product-subclasses/:id', [SubclassesController::class, 'remove'], self::WRITE);

        // Impressoras de produção (direcionamento de impressão dos pedidos — módulo de vendas)
        $r->get('/production-printers', [PrintersController::class, 'list'], self::READ);
        $r->post('/production-printers', [PrintersController::class, 'create'], self::WRITE);
        $r->put('/production-printers/:id', [PrintersController::class, 'update'], self::WRITE);
        $r->delete('/production-printers/:id', [PrintersController::class, 'remove'], self::WRITE);

        // Estoque (movimentações; saldo vive em products)
        $r->get('/stock/moves', [StockController::class, 'moves'], self::ESTOQUE_READ);
        $r->post('/stock/moves', [StockController::class, 'create'], self::ESTOQUE_MOVE);
        // Contagem (inventário) → compra sugerida. Concluir a contagem corrige o saldo,
        // por isso apply exige a mesma permissão de contagem (e não só leitura).
        $r->get('/stock/counts', [CountsController::class, 'list'], self::ESTOQUE_READ);
        $r->post('/stock/counts', [CountsController::class, 'create'], self::ESTOQUE_COUNT);
        $r->get('/stock/counts/:id', [CountsController::class, 'getById'], self::ESTOQUE_READ);
        $r->put('/stock/counts/:id', [CountsController::class, 'update'], self::ESTOQUE_COUNT);
        $r->delete('/stock/counts/:id', [CountsController::class, 'remove'], self::ESTOQUE_COUNT);
        $r->post('/stock/counts/:id/apply', [CountsController::class, 'apply'], self::ESTOQUE_COUNT);
        $r->post('/stock/counts/:id/generate-request', [CountsController::class, 'generateRequest'], self::REQUESTS);
        // Parâmetros de reposição (mín/máx/embalagem) em lote — é cadastro de produto.
        $r->get('/stock/replenishment', [ParamsController::class, 'list'], self::ESTOQUE_READ);
        $r->put('/stock/replenishment', [ParamsController::class, 'save'], self::WRITE);
        // Entrada por NF-e (XML)
        $r->post('/nfe/preview', [NfeController::class, 'preview'], self::ESTOQUE_MOVE);
        $r->post('/nfe/import', [NfeController::class, 'import'], self::ESTOQUE_MOVE);
        $r->get('/nfe/history', [NfeController::class, 'history'], self::ESTOQUE_READ);

        // Quotations
        $r->get('/quotations', [QuotationsController::class, 'list'], self::READ);
        $r->get('/quotations/:id', [QuotationsController::class, 'getById'], self::READ);
        $r->get('/quotations/:id/comparison', [QuotationsController::class, 'comparison'], self::READ);
        $r->post('/quotations', [QuotationsController::class, 'create'], self::WRITE);
        $r->patch('/quotations/:id', [QuotationsController::class, 'update'], self::WRITE);
        $r->delete('/quotations/:id', [QuotationsController::class, 'remove'], self::WRITE);
        $r->post('/quotations/:id/close', [QuotationsController::class, 'close'], self::WRITE);
        $r->post('/quotations/:id/extract-text', [QuotationsController::class, 'extractText'], self::WRITE);
        $r->post('/quotations/:id/extract', [QuotationsController::class, 'extract'], self::WRITE);
        $r->post('/quotations/:id/items', [QuotationsController::class, 'addItem'], self::WRITE);
        $r->put('/quotations/:id/items/:itemId', [QuotationsController::class, 'updateItem'], self::WRITE);
        $r->delete('/quotations/:id/items/:itemId', [QuotationsController::class, 'removeItem'], self::WRITE);

        // Orders
        $r->get('/orders', [OrdersController::class, 'list'], self::READ);
        $r->get('/orders/:id', [OrdersController::class, 'getById'], self::READ);
        $r->get('/orders/:id/message', [OrdersController::class, 'message'], self::WRITE);
        $r->post('/orders', [OrdersController::class, 'create'], self::WRITE);
        $r->patch('/orders/:id', [OrdersController::class, 'update'], self::WRITE);
        $r->delete('/orders/:id', [OrdersController::class, 'remove'], self::COMPRAS_ADMIN);
        $r->post('/orders/:id/items', [OrdersController::class, 'addItem'], self::WRITE);
        $r->put('/orders/:id/items/:itemId', [OrdersController::class, 'updateItem'], self::WRITE);
        $r->delete('/orders/:id/items/:itemId', [OrdersController::class, 'removeItem'], self::WRITE);
        $r->post('/orders/:id/submit', [OrdersController::class, 'submit'], self::WRITE);
        $r->post('/orders/:id/approve', [OrdersController::class, 'approve'], self::APPROVE);
        $r->post('/orders/:id/reject', [OrdersController::class, 'reject'], self::APPROVE);
        $r->post('/orders/:id/send', [OrdersController::class, 'send'], self::WRITE);
        $r->post('/orders/:id/receive', [OrdersController::class, 'receive'], self::WRITE);
        $r->post('/orders/:id/cancel', [OrdersController::class, 'cancel'], self::WRITE);

        // Requests (listas de compra)
        $r->get('/requests', [RequestsController::class, 'list'], self::READ);
        $r->get('/requests/:id', [RequestsController::class, 'getById'], self::READ);
        $r->post('/requests', [RequestsController::class, 'create'], self::REQUESTS);
        $r->put('/requests/:id', [RequestsController::class, 'update'], self::REQUESTS);
        $r->post('/requests/:id/submit', [RequestsController::class, 'submit'], self::REQUESTS);
        $r->post('/requests/:id/cancel', [RequestsController::class, 'cancel'], self::REQUESTS);
        $r->delete('/requests/:id', [RequestsController::class, 'remove'], self::REQUESTS);
        $r->put('/requests/:id/allocation', [RequestsController::class, 'allocate'], self::COMPRAS_ADMIN);
        $r->post('/requests/:id/generate-orders', [RequestsController::class, 'generateOrders'], self::COMPRAS_ADMIN);

        // Users (admin)
        $r->get('/users', [UsersController::class, 'list'], self::USERS);
        $r->post('/users', [UsersController::class, 'create'], self::USERS);
        $r->put('/users/:id', [UsersController::class, 'update'], self::USERS);
        $r->patch('/users/:id/active', [UsersController::class, 'setActive'], self::USERS);
        $r->delete('/users/:id', [UsersController::class, 'remove'], self::USERS);

        // Papéis (roles) customizáveis + catálogo de permissões (admin de acessos)
        $r->get('/permissions/catalog', [RolesController::class, 'catalog'], self::USERS);
        $r->get('/roles', [RolesController::class, 'list'], self::USERS);
        $r->post('/roles', [RolesController::class, 'create'], self::USERS);
        $r->put('/roles/:id', [RolesController::class, 'update'], self::USERS);
        $r->delete('/roles/:id', [RolesController::class, 'remove'], self::USERS);

        // Trilha de auditoria (leitura)
        $r->get('/audit', [AuditController::class, 'list'], self::AUDIT);

        // Inbox (rotas específicas antes de /:id)
        $r->get('/inbox', [InboxController::class, 'list'], self::READ);
        $r->get('/inbox/count', [InboxController::class, 'count'], self::READ);
        $r->post('/inbox/sync', [InboxController::class, 'sync'], self::WRITE);
        $r->post('/inbox/approve', [InboxController::class, 'approve'], self::WRITE);
        $r->post('/inbox/discard', [InboxController::class, 'discard'], self::WRITE);
        $r->put('/inbox/:id', [InboxController::class, 'update'], self::WRITE);

        // Import
        $r->post('/import/preview', [ImportController::class, 'preview'], self::WRITE);
        $r->post('/import', [ImportController::class, 'commit'], self::WRITE);
        // Import — cadastro de Produtos/Estoque (planilha do sistema atual do usuário, AllFood)
        $r->post('/import/products/preview', [ProductsImportController::class, 'preview'], self::WRITE);
        $r->post('/import/products', [ProductsImportController::class, 'commit'], self::WRITE);

        // WhatsApp
        $r->post('/whatsapp/test', [WhatsappController::class, 'sendTest'], self::SYSTEM);
        $r->get('/whatsapp/status', [WhatsappController::class, 'status'], self::ANY);
        $r->get('/whatsapp/outbox', [WhatsappController::class, 'outbox'], self::WRITE);
        $r->post('/whatsapp/outbox/drain', [WhatsappController::class, 'drainOutbox'], self::WRITE);

        // Webhooks de delivery (PÚBLICOS — validados por segredo do canal)
        $r->post('/webhooks/ifood', [WebhooksController::class, 'ifood'], null);
        $r->post('/webhooks/99food', [WebhooksController::class, 'nineFood'], null);
        // Evolution API → mensagens dos grupos das empresas (PÚBLICO — segredo compartilhado)
        $r->post('/webhooks/evolution', [WebhooksController::class, 'evolution'], null);

        // Delivery — painel de pedidos (iFood + 99Food)
        $r->post('/delivery/poll', [DeliveryController::class, 'poll'], null); // protegido por token interno (cron)
        $r->post('/delivery/sync', [DeliveryController::class, 'sync'], self::DELIVERY_ADMIN); // sincronização manual pela UI
        $r->get('/delivery/orders', [DeliveryController::class, 'listOrders'], self::DELIVERY);
        $r->get('/delivery/orders/:id', [DeliveryController::class, 'getOrder'], self::DELIVERY);
        $r->get('/delivery/orders/:id/tracking', [DeliveryController::class, 'tracking'], self::DELIVERY);
        $r->post('/delivery/orders/:id/confirm', [DeliveryController::class, 'confirm'], self::DELIVERY);
        $r->post('/delivery/orders/:id/ready', [DeliveryController::class, 'ready'], self::DELIVERY);
        $r->post('/delivery/orders/:id/dispatch', [DeliveryController::class, 'dispatch'], self::DELIVERY);
        $r->post('/delivery/orders/:id/conclude', [DeliveryController::class, 'conclude'], self::DELIVERY); // fecha no painel (local; iFood próprio não emite CONCLUDED confiável)
        $r->post('/delivery/orders/:id/cancel', [DeliveryController::class, 'cancel'], self::DELIVERY);
        $r->patch('/delivery/orders/:id/address', [DeliveryController::class, 'updateAddress'], self::DELIVERY); // corrige endereço/bairro ou fixa o ponto à mão
        $r->post('/delivery/orders/:id/geocode', [DeliveryController::class, 'geocodeOrder'], self::DELIVERY);  // tenta localizar 1 pedido agora
        $r->post('/delivery/orders/:id/printed', [DeliveryController::class, 'markPrinted'], self::DELIVERY); // reivindica impressão da comanda (idempotente)
        $r->post('/delivery/orders/:id/print-reset', [DeliveryController::class, 'resetPrinted'], self::DELIVERY); // libera a reivindicação se a impressão falhou
        $r->get('/delivery/print/cert', [PrintController::class, 'cert'], self::DELIVERY);   // certificado público QZ Tray
        $r->post('/delivery/print/sign', [PrintController::class, 'sign'], self::DELIVERY);   // assina requisição QZ Tray
        // Relatórios operacionais
        $r->get('/delivery/reports/summary', [ReportsController::class, 'summary'], self::DELIVERY);
        $r->get('/delivery/reports/customers', [ReportsController::class, 'customers'], self::DELIVERY);     // ranking + recorrência
        $r->get('/delivery/reports/items', [ReportsController::class, 'items'], self::DELIVERY);             // mais vendidos
        $r->get('/delivery/reports/performance', [ReportsController::class, 'performance'], self::DELIVERY); // dia/hora + tempos
        // Mapa de pedidos + distância (endereço da loja, listagem geocodificada, backfill sob demanda)
        $r->get('/delivery/settings/store', [MapController::class, 'getSettings'], self::DELIVERY);
        $r->put('/delivery/settings/store', [MapController::class, 'updateSettings'], self::DELIVERY_ADMIN);
        $r->get('/delivery/map', [MapController::class, 'list'], self::DELIVERY);
        $r->post('/delivery/map/backfill', [MapController::class, 'backfill'], self::DELIVERY);
        // Loja (módulo Merchant iFood): detalhes, disponibilidade, pausas, horários
        $r->get('/delivery/merchant/:channelId/details', [MerchantController::class, 'details'], self::DELIVERY);
        $r->get('/delivery/merchant/:channelId/status', [MerchantController::class, 'status'], self::DELIVERY);
        $r->post('/delivery/merchant/:channelId/status', [MerchantController::class, 'setStatus'], self::DELIVERY); // abre/fecha loja (99food)
        $r->get('/delivery/merchant/:channelId/interruptions', [MerchantController::class, 'listInterruptions'], self::DELIVERY);
        $r->post('/delivery/merchant/:channelId/interruptions', [MerchantController::class, 'createInterruption'], self::DELIVERY);
        $r->delete('/delivery/merchant/:channelId/interruptions/:id', [MerchantController::class, 'deleteInterruption'], self::DELIVERY);
        $r->get('/delivery/merchant/:channelId/opening-hours', [MerchantController::class, 'openingHours'], self::DELIVERY);
        $r->put('/delivery/merchant/:channelId/opening-hours', [MerchantController::class, 'setOpeningHours'], self::DELIVERY);
        // Cardápio mestre local + publicação/importação por canal
        $r->get('/delivery/menu', [CatalogController::class, 'tree'], self::DELIVERY);
        $r->get('/delivery/menu/remote/:channelId', [CatalogController::class, 'remote'], self::DELIVERY);
        $r->post('/delivery/menu/categories', [CatalogController::class, 'createCategory'], self::DELIVERY_ADMIN);
        $r->put('/delivery/menu/categories/:id', [CatalogController::class, 'updateCategory'], self::DELIVERY_ADMIN);
        $r->delete('/delivery/menu/categories/:id', [CatalogController::class, 'deleteCategory'], self::DELIVERY_ADMIN);
        $r->post('/delivery/menu/items', [CatalogController::class, 'createItem'], self::DELIVERY_ADMIN);
        $r->put('/delivery/menu/items/:id', [CatalogController::class, 'updateItem'], self::DELIVERY_ADMIN);
        $r->delete('/delivery/menu/items/:id', [CatalogController::class, 'deleteItem'], self::DELIVERY_ADMIN);
        $r->post('/delivery/menu/items/:id/availability', [CatalogController::class, 'itemAvailability'], self::DELIVERY);
        $r->post('/delivery/menu/options/:id/availability', [CatalogController::class, 'optionAvailability'], self::DELIVERY);
        $r->post('/delivery/menu/groups/:id/availability', [CatalogController::class, 'groupAvailability'], self::DELIVERY);
        // Módulo de complementos: classes reutilizáveis (Proteínas, Acompanhamentos...).
        // Editar a classe vale em todo item que a usa — por isso o CRUD é separado do item.
        $r->get('/delivery/menu/option-groups', [CatalogController::class, 'listGroups'], self::DELIVERY);
        $r->post('/delivery/menu/option-groups', [CatalogController::class, 'createGroup'], self::DELIVERY_ADMIN);
        $r->post('/delivery/menu/option-groups/merge-duplicates', [CatalogController::class, 'mergeDuplicateGroups'], self::DELIVERY_ADMIN);
        $r->put('/delivery/menu/option-groups/:id', [CatalogController::class, 'updateGroup'], self::DELIVERY_ADMIN);
        $r->put('/delivery/menu/option-groups/:id/items', [CatalogController::class, 'setGroupUsage'], self::DELIVERY_ADMIN);
        $r->delete('/delivery/menu/option-groups/:id', [CatalogController::class, 'deleteGroup'], self::DELIVERY_ADMIN);
        $r->post('/delivery/menu/publish/:channelId', [CatalogController::class, 'publish'], self::DELIVERY_ADMIN);
        $r->post('/delivery/menu/import/:channelId', [CatalogController::class, 'import'], self::DELIVERY_ADMIN);
        $r->get('/delivery/alerts', [DeliveryController::class, 'listAlerts'], self::DELIVERY);
        $r->post('/delivery/alerts/:id/accept', [DeliveryController::class, 'acceptAlert'], self::DELIVERY);
        $r->post('/delivery/alerts/:id/reject', [DeliveryController::class, 'rejectAlert'], self::DELIVERY);
        // Integrações (canais) — admin
        $r->get('/delivery/channels', [DeliveryController::class, 'listChannels'], self::DELIVERY_ADMIN);
        $r->post('/delivery/channels', [DeliveryController::class, 'createChannel'], self::DELIVERY_ADMIN);
        $r->put('/delivery/channels/:id', [DeliveryController::class, 'updateChannel'], self::DELIVERY_ADMIN);
        $r->post('/delivery/channels/:id/test', [DeliveryController::class, 'testChannel'], self::DELIVERY_ADMIN);
        $r->post('/delivery/channels/:id/authorization-url', [DeliveryController::class, 'authorizationUrl'], self::DELIVERY_ADMIN);

        // ===== Marmitex (catering B2B) =====
        // Catálogo: leitura liberada à empresa (monta o formulário); escrita só admin.
        $r->get('/marmitex/catalog', [MarmitexCatalogController::class, 'catalog'], self::MARMITEX);
        $r->post('/marmitex/catalog/:type', [MarmitexCatalogController::class, 'create'], self::MARMITEX_ADMIN);
        $r->put('/marmitex/catalog/:type/:id', [MarmitexCatalogController::class, 'update'], self::MARMITEX_ADMIN);
        $r->delete('/marmitex/catalog/:type/:id', [MarmitexCatalogController::class, 'remove'], self::MARMITEX_ADMIN);

        // Empresas-cliente: CRUD admin; a empresa só lê a própria.
        $r->get('/marmitex/companies', [MarmitexCompaniesController::class, 'list'], self::MARMITEX_ADMIN);
        $r->post('/marmitex/companies', [MarmitexCompaniesController::class, 'create'], self::MARMITEX_ADMIN);
        $r->get('/marmitex/companies/:id', [MarmitexCompaniesController::class, 'getById'], self::MARMITEX);
        $r->get('/marmitex/companies/:id/contract', [MarmitexCompaniesController::class, 'contract'], self::MARMITEX_ADMIN);
        $r->put('/marmitex/companies/:id/contract', [MarmitexCompaniesController::class, 'updateContract'], self::MARMITEX_ADMIN);
        $r->put('/marmitex/companies/:id', [MarmitexCompaniesController::class, 'update'], self::MARMITEX_ADMIN);

        // Pedidos do dia (empresa) — escopados pelo token; admin pode filtrar por empresa.
        // Planilha-modelo + importação (rotas específicas antes de /:id).
        $r->get('/marmitex/orders/template', [MarmitexSheetController::class, 'template'], self::MARMITEX);
        $r->post('/marmitex/orders/import', [MarmitexSheetController::class, 'import'], self::MARMITEX);
        $r->get('/marmitex/orders', [MarmitexOrdersController::class, 'list'], self::MARMITEX);
        $r->get('/marmitex/orders/:id', [MarmitexOrdersController::class, 'getById'], self::MARMITEX);
        $r->post('/marmitex/orders', [MarmitexOrdersController::class, 'save'], self::MARMITEX);
        $r->delete('/marmitex/orders/:id', [MarmitexOrdersController::class, 'remove'], self::MARMITEX);
        // Fechar a produção baixa o estoque pela ficha técnica — só quem administra o marmitex.
        $r->get('/marmitex/orders/:id/production', [MarmitexOrdersController::class, 'productionPreview'], self::MARMITEX_ADMIN);
        $r->post('/marmitex/orders/:id/produce', [MarmitexOrdersController::class, 'produce'], self::MARMITEX_ADMIN);
        $r->post('/marmitex/orders/:id/reopen', [MarmitexOrdersController::class, 'reopen'], self::MARMITEX_ADMIN);

        // Etiquetas (dados planos para impressão).
        $r->get('/marmitex/labels', [MarmitexLabelsController::class, 'labels'], self::MARMITEX);

        // Pedidos lidos do grupo de WhatsApp: configurar é admin, revisar/aplicar é
        // de quem opera. A interpretação (IA) roda no worker, nunca nestas rotas.
        $r->get('/marmitex/whatsapp/config/:companyId', [MarmitexWaController::class, 'getConfig'], self::MARMITEX_ADMIN);
        $r->put('/marmitex/whatsapp/config/:companyId', [MarmitexWaController::class, 'saveConfig'], self::MARMITEX_ADMIN);
        $r->post('/marmitex/whatsapp/simulate', [MarmitexWaController::class, 'simulate'], self::MARMITEX_ADMIN);
        $r->get('/marmitex/whatsapp/drafts/count', [MarmitexWaController::class, 'count'], self::MARMITEX);
        $r->get('/marmitex/whatsapp/drafts', [MarmitexWaController::class, 'drafts'], self::MARMITEX);
        $r->get('/marmitex/whatsapp/drafts/:id', [MarmitexWaController::class, 'draft'], self::MARMITEX);
        $r->post('/marmitex/whatsapp/drafts/:id/lines', [MarmitexWaController::class, 'addLine'], self::MARMITEX);
        $r->put('/marmitex/whatsapp/drafts/:id/lines/:lineId', [MarmitexWaController::class, 'updateLine'], self::MARMITEX);
        $r->delete('/marmitex/whatsapp/drafts/:id/lines/:lineId', [MarmitexWaController::class, 'removeLine'], self::MARMITEX);
        $r->post('/marmitex/whatsapp/drafts/:id/apply', [MarmitexWaController::class, 'apply'], self::MARMITEX);
        $r->post('/marmitex/whatsapp/drafts/:id/discard', [MarmitexWaController::class, 'discard'], self::MARMITEX);
        $r->post('/marmitex/whatsapp/messages/:id/retry', [MarmitexWaController::class, 'retry'], self::MARMITEX_ADMIN);

        // Relatório / faturamento — admin.
        $r->get('/marmitex/report', [MarmitexReportController::class, 'report'], self::MARMITEX_ADMIN);
        $r->get('/marmitex/report/detail', [MarmitexReportController::class, 'detail'], self::MARMITEX_ADMIN);
        $r->post('/marmitex/report/close', [MarmitexReportController::class, 'close'], self::MARMITEX_ADMIN);
        $r->get('/marmitex/invoices', [MarmitexReportController::class, 'invoices'], self::MARMITEX_ADMIN);
        $r->get('/marmitex/invoices/:id', [MarmitexReportController::class, 'getInvoice'], self::MARMITEX_ADMIN);
        $r->post('/marmitex/invoices/:id/cancel', [MarmitexReportController::class, 'cancelInvoice'], self::MARMITEX_ADMIN);

        // ===== Vendas (balcão, retirada, mesas e comandas) =====
        // Mesas/comandas: cadastro fixo — leitura para quem opera, escrita só admin.
        $r->get('/vendas/stations', [VendasStationsController::class, 'list'], self::VENDAS);
        $r->post('/vendas/stations', [VendasStationsController::class, 'create'], self::VENDAS_ADMIN);
        $r->post('/vendas/stations/batch', [VendasStationsController::class, 'createBatch'], self::VENDAS_ADMIN);
        $r->put('/vendas/stations/:id', [VendasStationsController::class, 'update'], self::VENDAS_ADMIN);
        $r->delete('/vendas/stations/:id', [VendasStationsController::class, 'remove'], self::VENDAS_ADMIN);

        // Painel (Kanban) + lançamento — quem opera o balcão/mesas.
        $r->get('/vendas/board', [VendasController::class, 'board'], self::VENDAS);
        // Tela de observações de preparo: ficha técnica + variações de um produto.
        $r->get('/vendas/products/:id/prep', [VendasController::class, 'prep'], self::VENDAS);
        $r->get('/vendas/:id', [VendasController::class, 'getById'], self::VENDAS);
        $r->post('/vendas', [VendasController::class, 'create'], self::VENDAS);
        $r->post('/vendas/:id/ready', [VendasController::class, 'ready'], self::VENDAS);
        $r->post('/vendas/:id/close', [VendasController::class, 'close'], self::VENDAS);
        $r->post('/vendas/:id/reopen', [VendasController::class, 'reopen'], self::VENDAS);
        $r->post('/vendas/:id/pay', [VendasController::class, 'pay'], self::VENDAS);
        // Cancelar (com estorno de estoque) — só admin.
        $r->post('/vendas/:id/cancel', [VendasController::class, 'cancel'], self::VENDAS_ADMIN);
        // Editar/remover item já enviado (ajusta a baixa de estoque) — só admin.
        $r->put('/vendas/:id/items/:itemId', [VendasController::class, 'updateItem'], self::VENDAS_ADMIN);
        $r->delete('/vendas/:id/items/:itemId', [VendasController::class, 'removeItem'], self::VENDAS_ADMIN);
    }
}
