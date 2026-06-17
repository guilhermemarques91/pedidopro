<?php

/**
 * Sync diário do WhatsApp → fila de revisão (inbox_prices).
 * Agende no cron do cPanel, ex.:
 *   0 7 * * * /usr/local/bin/php /home1/espac793/pedidos.guimarques.dev.br/api/bin/sync-inbox.php
 */

declare(strict_types=1);

use App\Core\Env;
use App\Services\WhatsappSync;

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("CLI only\n");
}

$root = dirname(__DIR__);
require $root . '/vendor/autoload.php';
spl_autoload_register(function (string $class) use ($root): void {
    if (str_starts_with($class, 'App\\')) {
        $p = $root . '/src/' . str_replace('\\', '/', substr($class, 4)) . '.php';
        if (is_file($p)) {
            require $p;
        }
    }
});
Env::load($root . '/.env');

if (!Env::bool('INBOX_SYNC_ENABLED', true)) {
    echo "Sync desabilitado (INBOX_SYNC_ENABLED=false).\n";
    exit;
}

try {
    $r = WhatsappSync::run();
    echo sprintf(
        "Sync WhatsApp: %d fornecedores, %d msgs, %d candidatas, %d itens na fila.\n",
        $r['suppliers'],
        $r['messagesScanned'],
        $r['candidates'],
        $r['itemsAdded']
    );
} catch (\Throwable $e) {
    fwrite(STDERR, 'Sync falhou: ' . $e->getMessage() . "\n");
    exit(1);
}
