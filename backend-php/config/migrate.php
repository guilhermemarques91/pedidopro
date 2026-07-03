<?php

/**
 * Runner de migrations (Etapa 0 do roadmap ERP).
 *
 * Substitui o bootstrap pragmático do `docker/db-init/10-apply.sh` (que aplicava
 * TODAS as migrations com `--force` ignorando erros de "já existe"). Aqui cada
 * migration roda UMA vez, na ordem, registrada na tabela `schema_migrations`.
 *
 * Uso (linha de comando, dentro do container do app — o MySQL não tem PHP):
 *   php config/migrate.php            # aplica as migrations pendentes
 *   php config/migrate.php --status   # lista aplicadas x pendentes, sem aplicar
 *   php config/migrate.php --baseline # marca TODAS as on-disk como aplicadas (adoção manual)
 *
 * Adoção automática: na primeiríssima execução (quando `schema_migrations` ainda
 * não existe) o runner "adota" o banco atual sem re-rodar DDL não-idempotente —
 * marca o baseline (o que o schema.mysql.sql consolidado já embute) e sonda os
 * objetos das migrations de delivery (cobre tanto um banco novo quanto um volume
 * legado que já tinha rodado tudo via `--force`). Só o que sobra é aplicado.
 */

declare(strict_types=1);

use App\Core\Db;
use App\Core\Env;

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

$migrationsDir = __DIR__ . '/migrations';
$dbName = (string) Env::get('DB_NAME', '');

/**
 * Migrations já embutidas no `schema.mysql.sql` consolidado. Num banco novo o
 * schema cria essas estruturas direto, então o runner NUNCA deve re-aplicá-las.
 */
const BASELINE = [
    '001_add_supplier_code',
    '002_extract_supplier_code_from_name',
    '003_add_request_item_source',
    '005_marmitex',
    '007_item_suppliers',
];

/**
 * Detecção "isto já foi aplicado?" para as migrations FORA do baseline (delivery).
 * Usada só na adoção inicial, para não re-rodar DDL num volume legado. Cada entrada
 * devolve true se o objeto que a migration cria já existe no banco.
 */
$probes = [
    '004_delivery_orders'   => static fn(): bool => tableExists($dbName, 'channels'),
    '006_channel_commission' => static fn(): bool => columnExists($dbName, 'channels', 'commission_rate'),
    '008_delivery_alerts'   => static fn(): bool => tableExists($dbName, 'delivery_alerts'),
];

function tableExists(string $db, string $table): bool
{
    return Db::queryOne(
        'SELECT 1 FROM information_schema.tables WHERE table_schema = ? AND table_name = ?',
        [$db, $table]
    ) !== null;
}

function columnExists(string $db, string $table, string $column): bool
{
    return Db::queryOne(
        'SELECT 1 FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ?',
        [$db, $table, $column]
    ) !== null;
}

/** Divide o arquivo em comandos executáveis (remove comentários `-- ` e linhas vazias). */
function splitStatements(string $sql): array
{
    $lines = [];
    foreach (preg_split('/\r?\n/', $sql) as $line) {
        $trimmed = ltrim($line);
        if ($trimmed === '' || str_starts_with($trimmed, '--')) {
            continue;
        }
        $lines[] = $line;
    }
    $body = implode("\n", $lines);
    return array_values(array_filter(array_map('trim', explode(';', $body)), static fn($s) => $s !== ''));
}

// --- Descobre as migrations no disco (ordenadas pelo nome) ---
$files = glob($migrationsDir . '/*.sql') ?: [];
sort($files);
/** @var array<string,string> version => caminho */
$onDisk = [];
foreach ($files as $f) {
    $onDisk[basename($f, '.sql')] = $f;
}

// --- Garante a tabela de controle (detectando se ela já existia) ---
$hadTable = tableExists($dbName, 'schema_migrations');
Db::execute(
    'CREATE TABLE IF NOT EXISTS schema_migrations ('
    . ' version VARCHAR(190) NOT NULL PRIMARY KEY,'
    . ' applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP'
    . ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
);

$appliedRows = Db::query('SELECT version FROM schema_migrations');
$applied = array_column($appliedRows, 'version');

$mode = $argv[1] ?? '';

// --- Modo --status: só relata ---
if ($mode === '--status') {
    echo "Migrations aplicadas (" . count($applied) . "):\n";
    foreach ($applied as $v) {
        echo "  [x] {$v}\n";
    }
    $pending = array_diff(array_keys($onDisk), $applied);
    echo "Pendentes (" . count($pending) . "):\n";
    foreach ($pending as $v) {
        echo "  [ ] {$v}\n";
    }
    exit(0);
}

// --- Modo --baseline: marca tudo como aplicado sem rodar (adoção manual) ---
if ($mode === '--baseline') {
    $marked = 0;
    foreach (array_keys($onDisk) as $version) {
        if (!in_array($version, $applied, true)) {
            Db::execute('INSERT INTO schema_migrations (version) VALUES (?)', [$version]);
            echo "  baseline: {$version}\n";
            $marked++;
        }
    }
    echo "Baseline aplicado ({$marked} marcadas). Nada foi executado.\n";
    exit(0);
}

// --- Adoção automática na primeira execução (tabela recém-criada) ---
if (!$hadTable) {
    echo "[migrate] primeira execução — adotando estado atual do banco (sem re-rodar DDL existente)...\n";
    foreach (array_keys($onDisk) as $version) {
        if (in_array($version, $applied, true)) {
            continue;
        }
        $isBaseline = in_array($version, BASELINE, true);
        $probe = $probes[$version] ?? null;
        if ($isBaseline || ($probe !== null && $probe())) {
            Db::execute('INSERT INTO schema_migrations (version) VALUES (?)', [$version]);
            $applied[] = $version;
            echo "  adotada (já existia): {$version}\n";
        }
    }
}

// --- Aplica as pendentes, em ordem ---
$pending = array_values(array_filter(array_keys($onDisk), static fn($v) => !in_array($v, $applied, true)));
if ($pending === []) {
    echo "[migrate] nada a aplicar — banco em dia.\n";
    exit(0);
}

foreach ($pending as $version) {
    echo "[migrate] aplicando {$version}...\n";
    $statements = splitStatements((string) file_get_contents($onDisk[$version]));
    try {
        foreach ($statements as $stmt) {
            Db::pdo()->exec($stmt);
        }
        Db::execute('INSERT INTO schema_migrations (version) VALUES (?)', [$version]);
        echo "  ok\n";
    } catch (\Throwable $e) {
        fwrite(STDERR, "[migrate] FALHOU em {$version}: {$e->getMessage()}\n");
        exit(1);
    }
}

echo "[migrate] concluído (" . count($pending) . " aplicada(s)).\n";
