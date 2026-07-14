<?php

declare(strict_types=1);

// Script de teste manual (não faz parte do fluxo normal): conecta no QZ Tray local,
// lista as impressoras e opcionalmente imprime um teste. Usar durante o setup do
// poller com QZ Tray; apagar/ignorar depois.
//
// Uso: php bin/qz-test.php [nome-da-impressora]

use App\Core\Env;
use App\Services\Print\QzTrayClient;

$root = dirname(__DIR__);
require $root . '/vendor/autoload.php';
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

$certPath = Env::get('QZ_CERT_PATH');
$keyPath = Env::get('QZ_PRIVATE_KEY_PATH');
$cert = $certPath && is_readable($certPath) ? (string) file_get_contents($certPath) : '';
$key = $keyPath && is_readable($keyPath) ? (string) file_get_contents($keyPath) : '';

echo 'cert configurado: ' . ($cert !== '' ? 'sim' : 'NÃO') . "\n";
echo 'chave configurada: ' . ($key !== '' ? 'sim' : 'NÃO') . "\n";

$qz = new QzTrayClient(privateKeyPem: $key ?: null, certPem: $cert ?: null);
echo "Conectando ao QZ Tray (ws://127.0.0.1:8182)...\n";
$qz->connect();
echo "Conectado. Listando impressoras...\n";

try {
    $printers = $qz->findPrinters();
    echo "Impressoras encontradas:\n";
    foreach ($printers as $p) {
        echo "  - {$p}\n";
    }
} catch (\Throwable $e) {
    echo 'ERRO ao listar impressoras: ' . $e->getMessage() . "\n";
}

$printerArg = $argv[1] ?? null;
if ($printerArg) {
    echo "Imprimindo teste em '{$printerArg}'...\n";
    $html = '<div style="font-family:monospace;font-weight:bold;padding:4mm">'
        . '<div>TESTE QZ VIA PHP</div><div>' . date('Y-m-d H:i:s') . '</div></div>';
    try {
        $qz->printHtml($printerArg, $html, 76);
        echo "Comando de impressão enviado (confira o papel).\n";
    } catch (\Throwable $e) {
        echo 'ERRO ao imprimir: ' . $e->getMessage() . "\n";
    }
}

$qz->close();
