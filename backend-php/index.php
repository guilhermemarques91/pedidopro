<?php

declare(strict_types=1);

use App\Core\Env;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Router;
use App\Routes;

// Este arquivo é o front controller e fica na pasta web `/api` do subdomínio.
$root = __DIR__;

// Autoload: Composer (libs) + fallback PSR-4 para App\ (resiliência).
if (is_file($root . '/vendor/autoload.php')) {
    require $root . '/vendor/autoload.php';
}
spl_autoload_register(function (string $class) use ($root): void {
    if (!str_starts_with($class, 'App\\')) {
        return;
    }
    $path = $root . '/src/' . str_replace('\\', '/', substr($class, 4)) . '.php';
    if (is_file($path)) {
        require $path;
    }
});

Env::load($root . '/.env');

// CORS (apenas se a API estiver em origem diferente do frontend).
$origins = array_filter(array_map('trim', explode(',', (string) Env::get('CORS_ORIGINS', ''))));
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origins && $origin && in_array($origin, $origins, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Allow-Headers: Authorization, Content-Type');
    header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
    header('Vary: Origin');
}
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// Caminho da rota: remove query e o prefixo /api (a API publica em .../api).
$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$uri = rawurldecode($uri);
if (str_starts_with($uri, '/api')) {
    $uri = substr($uri, 4);
}
if ($uri === '' || $uri === false) {
    $uri = '/';
}

$router = new Router();
Routes::register($router);

try {
    $router->dispatch($_SERVER['REQUEST_METHOD'] ?? 'GET', $uri);
} catch (HttpError $e) {
    Http::error($e->getCode() ?: 400, $e->getMessage(), $e->details);
} catch (\Throwable $e) {
    if (Env::get('APP_ENV') === 'dev') {
        Http::error(500, $e->getMessage());
    }
    error_log('[pedidopro] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    Http::error(500, 'Erro interno do servidor');
}
