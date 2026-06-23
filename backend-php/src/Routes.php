<?php

namespace App;

use App\Core\Http;
use App\Core\Router;
use App\Modules\Auth\AuthController;
use App\Modules\Categories\CategoriesController;
use App\Modules\Suppliers\SuppliersController;
use App\Modules\Items\ItemsController;
use App\Modules\Products\ProductsController;
use App\Modules\Quotations\QuotationsController;
use App\Modules\Orders\OrdersController;
use App\Modules\Requests\RequestsController;
use App\Modules\Users\UsersController;
use App\Modules\Inbox\InboxController;
use App\Modules\Import\ImportController;
use App\Modules\Whatsapp\WhatsappController;

/** Registro central das rotas (espelha as rotas do backend Node). */
final class Routes
{
    // Guards de papel (null = público; [] = qualquer autenticado).
    private const ANY = [];
    private const ADMIN = ['admin'];
    private const WRITERS = ['admin', 'buyer'];
    private const APPROVERS = ['admin', 'approver'];
    private const REQUESTERS = ['admin', 'buyer', 'requester'];

    public static function register(Router $r): void
    {
        // Health
        $r->get('/health', fn () => Http::json(['status' => 'ok']), null);

        // Auth
        $r->post('/auth/login', [AuthController::class, 'login'], null);
        $r->get('/auth/me', [AuthController::class, 'me'], self::ANY);

        // Categories
        $r->get('/categories', [CategoriesController::class, 'list'], self::ANY);
        $r->get('/categories/:id', [CategoriesController::class, 'getById'], self::ANY);
        $r->post('/categories', [CategoriesController::class, 'create'], self::ADMIN);
        $r->put('/categories/:id', [CategoriesController::class, 'update'], self::ADMIN);
        $r->delete('/categories/:id', [CategoriesController::class, 'remove'], self::ADMIN);

        // Suppliers
        $r->get('/suppliers', [SuppliersController::class, 'list'], self::ANY);
        $r->get('/suppliers/:id', [SuppliersController::class, 'getById'], self::ANY);
        $r->post('/suppliers', [SuppliersController::class, 'create'], self::WRITERS);
        $r->put('/suppliers/:id', [SuppliersController::class, 'update'], self::WRITERS);
        $r->delete('/suppliers/:id', [SuppliersController::class, 'remove'], self::ADMIN);

        // Items
        $r->get('/items', [ItemsController::class, 'list'], self::ANY);
        $r->get('/items/:id', [ItemsController::class, 'getById'], self::ANY);
        $r->post('/items', [ItemsController::class, 'create'], self::WRITERS);
        $r->put('/items/:id', [ItemsController::class, 'update'], self::WRITERS);
        $r->delete('/items/:id', [ItemsController::class, 'remove'], self::ADMIN);

        // Products (rotas específicas antes de /:id)
        $r->get('/products', [ProductsController::class, 'list'], self::ANY);
        $r->get('/products/unmapped', [ProductsController::class, 'unmapped'], self::ANY);
        $r->post('/products/suggest', [ProductsController::class, 'suggest'], self::WRITERS);
        $r->post('/products/unassign', [ProductsController::class, 'unassign'], self::WRITERS);
        $r->post('/products', [ProductsController::class, 'create'], self::WRITERS);
        $r->get('/products/:id', [ProductsController::class, 'getById'], self::ANY);
        $r->put('/products/:id', [ProductsController::class, 'update'], self::WRITERS);
        $r->delete('/products/:id', [ProductsController::class, 'remove'], self::WRITERS);
        $r->post('/products/:id/items', [ProductsController::class, 'assign'], self::WRITERS);

        // Quotations
        $r->get('/quotations', [QuotationsController::class, 'list'], self::ANY);
        $r->get('/quotations/:id', [QuotationsController::class, 'getById'], self::ANY);
        $r->get('/quotations/:id/comparison', [QuotationsController::class, 'comparison'], self::ANY);
        $r->post('/quotations', [QuotationsController::class, 'create'], self::WRITERS);
        $r->patch('/quotations/:id', [QuotationsController::class, 'update'], self::WRITERS);
        $r->delete('/quotations/:id', [QuotationsController::class, 'remove'], self::WRITERS);
        $r->post('/quotations/:id/close', [QuotationsController::class, 'close'], self::WRITERS);
        $r->post('/quotations/:id/extract-text', [QuotationsController::class, 'extractText'], self::WRITERS);
        $r->post('/quotations/:id/extract', [QuotationsController::class, 'extract'], self::WRITERS);
        $r->post('/quotations/:id/items', [QuotationsController::class, 'addItem'], self::WRITERS);
        $r->put('/quotations/:id/items/:itemId', [QuotationsController::class, 'updateItem'], self::WRITERS);
        $r->delete('/quotations/:id/items/:itemId', [QuotationsController::class, 'removeItem'], self::WRITERS);

        // Orders
        $r->get('/orders', [OrdersController::class, 'list'], self::ANY);
        $r->get('/orders/:id', [OrdersController::class, 'getById'], self::ANY);
        $r->get('/orders/:id/message', [OrdersController::class, 'message'], self::WRITERS);
        $r->post('/orders', [OrdersController::class, 'create'], self::WRITERS);
        $r->patch('/orders/:id', [OrdersController::class, 'update'], self::WRITERS);
        $r->delete('/orders/:id', [OrdersController::class, 'remove'], self::ADMIN);
        $r->post('/orders/:id/items', [OrdersController::class, 'addItem'], self::WRITERS);
        $r->put('/orders/:id/items/:itemId', [OrdersController::class, 'updateItem'], self::WRITERS);
        $r->delete('/orders/:id/items/:itemId', [OrdersController::class, 'removeItem'], self::WRITERS);
        $r->post('/orders/:id/submit', [OrdersController::class, 'submit'], self::WRITERS);
        $r->post('/orders/:id/approve', [OrdersController::class, 'approve'], self::APPROVERS);
        $r->post('/orders/:id/reject', [OrdersController::class, 'reject'], self::APPROVERS);
        $r->post('/orders/:id/send', [OrdersController::class, 'send'], self::WRITERS);
        $r->post('/orders/:id/receive', [OrdersController::class, 'receive'], self::WRITERS);
        $r->post('/orders/:id/cancel', [OrdersController::class, 'cancel'], self::WRITERS);

        // Requests (listas de compra)
        $r->get('/requests', [RequestsController::class, 'list'], self::ANY);
        $r->get('/requests/:id', [RequestsController::class, 'getById'], self::ANY);
        $r->post('/requests', [RequestsController::class, 'create'], self::REQUESTERS);
        $r->put('/requests/:id', [RequestsController::class, 'update'], self::REQUESTERS);
        $r->post('/requests/:id/submit', [RequestsController::class, 'submit'], self::REQUESTERS);
        $r->post('/requests/:id/cancel', [RequestsController::class, 'cancel'], self::REQUESTERS);
        $r->delete('/requests/:id', [RequestsController::class, 'remove'], self::REQUESTERS);
        $r->put('/requests/:id/allocation', [RequestsController::class, 'allocate'], self::ADMIN);
        $r->post('/requests/:id/generate-orders', [RequestsController::class, 'generateOrders'], self::ADMIN);

        // Users (admin)
        $r->get('/users', [UsersController::class, 'list'], self::ADMIN);
        $r->post('/users', [UsersController::class, 'create'], self::ADMIN);
        $r->put('/users/:id', [UsersController::class, 'update'], self::ADMIN);
        $r->patch('/users/:id/active', [UsersController::class, 'setActive'], self::ADMIN);
        $r->delete('/users/:id', [UsersController::class, 'remove'], self::ADMIN);

        // Inbox (rotas específicas antes de /:id)
        $r->get('/inbox', [InboxController::class, 'list'], self::ANY);
        $r->get('/inbox/count', [InboxController::class, 'count'], self::ANY);
        $r->post('/inbox/sync', [InboxController::class, 'sync'], self::WRITERS);
        $r->post('/inbox/approve', [InboxController::class, 'approve'], self::WRITERS);
        $r->post('/inbox/discard', [InboxController::class, 'discard'], self::WRITERS);
        $r->put('/inbox/:id', [InboxController::class, 'update'], self::WRITERS);

        // Import
        $r->post('/import/preview', [ImportController::class, 'preview'], self::WRITERS);
        $r->post('/import', [ImportController::class, 'commit'], self::WRITERS);

        // WhatsApp
        $r->post('/whatsapp/test', [WhatsappController::class, 'sendTest'], self::ADMIN);
        $r->get('/whatsapp/status', [WhatsappController::class, 'status'], self::ANY);
    }
}
