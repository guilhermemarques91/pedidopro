<?php

declare(strict_types=1);

/**
 * Poller das plataformas (rede de segurança do webhook).
 *
 * HostGator: cron com granularidade mínima de 1 min. Para chegar perto dos ~20s,
 * este script faz 3 iterações com sleep(20) dentro do minuto. Agende via cron:
 *   * * * * * /usr/bin/php /home/USER/api/bin/poll.php >> /home/USER/api/poll.log 2>&1
 *
 * Plano B (cron limitado a 5/15 min): rode este script no PC (sempre ligado,
 * como Evolution/Ollama) com --loop para um laço contínuo a cada 20s.
 */

use App\Core\Env;
use App\Services\Integrations\IngestService;

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

$loop = in_array('--loop', $argv, true);
$intervalMs = Env::int('DELIVERY_POLL_INTERVAL_MS', 20000);
$iterations = $loop ? PHP_INT_MAX : 3;

for ($i = 0; $i < $iterations; $i++) {
    try {
        $summary = IngestService::poll();
        $stamp = date('Y-m-d H:i:s');
        foreach ($summary as $s) {
            echo "[{$stamp}] {$s['platform']}/{$s['channel']}: +{$s['ingested']} dup={$s['duplicated']}\n";
        }
    } catch (\Throwable $e) {
        // Db::query já reconecta sozinho se a conexão cair no laço longo.
        echo '[' . date('Y-m-d H:i:s') . '] ERRO: ' . $e->getMessage() . "\n";
    }
    if ($i + 1 < $iterations) {
        usleep($intervalMs * 1000);
    }
}
