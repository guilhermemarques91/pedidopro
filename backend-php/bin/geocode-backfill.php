<?php

declare(strict_types=1);

/**
 * Backfill de geocodificação (mapa de pedidos Delivery), pra rodar via cron.
 *
 * A maioria dos pedidos já chega com lat/lng do próprio iFood/99Food (capturado em
 * OrderNormalizer::address()); este script só cobre os que faltam (pedidos antigos
 * ou payloads sem coordenada) e a geocodificação reversa (sugestão de bairro).
 * Roda em lotes pequenos e espaçados pelo próprio GeoService::backfill (usleep entre
 * chamadas de rede) — agende com frequência (ex.: a cada 10-15 min) em vez de um
 * lote gigante de uma vez, pra respeitar o limite de uso do Nominatim (~1 req/seg).
 * Agende no cron do cPanel a cada 10 minutos (campo minuto: 0,10,20,30,40,50):
 *   0,10,20,30,40,50 * * * * /usr/bin/php /home/USER/api/bin/geocode-backfill.php >> /home/USER/api/geocode.log 2>&1
 */

use App\Core\Env;
use App\Services\GeoService;

$root = dirname(__DIR__);

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

$limit = isset($argv[1]) && ctype_digit($argv[1]) ? (int) $argv[1] : 20;

try {
    $result = GeoService::backfill($limit);
    echo '[' . date('Y-m-d H:i:s') . "] geocoded={$result['geocoded']} reverse_geocoded={$result['reverse_geocoded']} remaining={$result['remaining']}\n";
} catch (\Throwable $e) {
    echo '[' . date('Y-m-d H:i:s') . '] ERRO: ' . $e->getMessage() . "\n";
}
