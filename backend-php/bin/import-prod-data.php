<?php

declare(strict_types=1);

/**
 * Migração de dados HostGator (produção, schema do `main`) → ERP local (schema erp-local).
 *
 * Pré-requisito: o dump de produção já carregado numa base auxiliar no MESMO MySQL
 * (padrão `pedidopro_prod`) — o wrapper `scripts/import-prod.sh` faz isso.
 *
 * Por que não um dump/restore cru: o schema local é um SUPERconjunto do de produção
 * (org_id, colunas extras, migrations 009-033). Este script copia tabela a tabela
 * usando a INTERSEÇÃO de colunas (via information_schema), então colunas novas do
 * ERP ficam com o DEFAULT (org_id=1) e colunas que só existem no prod são ignoradas.
 *
 * Escopo: operação de DELIVERY + MARMITEX (canais, pedidos, cardápio mestre, loja,
 * empresas e logins das empresas). Dados de COMPRAS/produtos NÃO são migrados — o
 * catálogo local (AllFood) é a fonte da verdade; o histórico fica no backup do dump.
 *
 * Uso (dentro do container do app):
 *   php bin/import-prod-data.php --source=pedidopro_prod [--dry-run]
 */

use App\Core\Db;
use App\Core\Env;

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

$source = 'pedidopro_prod';
$dryRun = false;
foreach (array_slice($argv, 1) as $arg) {
    if (str_starts_with($arg, '--source=')) {
        $source = substr($arg, 9);
    } elseif ($arg === '--dry-run') {
        $dryRun = true;
    } else {
        fwrite(STDERR, "Argumento desconhecido: {$arg}\n");
        exit(1);
    }
}

$target = (string) Env::get('DB_NAME', 'pedidopro');

/**
 * Tabelas a migrar, em ordem de FK. 'truncate' = limpa o destino antes (todas
 * estão vazias/apenas-seed no local; store_settings perde a linha semeada e a
 * linha do prod entra com org_id DEFAULT 1).
 */
const TABLES = [
    // Delivery — canais e pedidos
    ['name' => 'channels',             'truncate' => true],
    ['name' => 'channel_tokens',       'truncate' => true],
    ['name' => 'delivery_customers',   'truncate' => true],
    ['name' => 'delivery_orders',      'truncate' => true],
    ['name' => 'delivery_order_items', 'truncate' => true],
    ['name' => 'channel_events',       'truncate' => true],
    ['name' => 'delivery_alerts',      'truncate' => true],
    // Mapa/loja + cache de geocodificação
    ['name' => 'store_settings',       'truncate' => true],
    ['name' => 'geocode_cache',        'truncate' => true],
    // Cardápio mestre + links de sincronização
    ['name' => 'menu_categories',      'truncate' => true],
    ['name' => 'menu_items',           'truncate' => true],
    ['name' => 'menu_option_groups',   'truncate' => true],
    ['name' => 'menu_options',         'truncate' => true],
    ['name' => 'menu_channel_links',   'truncate' => true],
    ['name' => 'menu_sync_log',        'truncate' => true],
    // Marmitex — catálogo, empresas, pedidos, faturamentos
    ['name' => 'marmitex_companies',    'truncate' => true],
    ['name' => 'marmitex_sizes',        'truncate' => true],
    ['name' => 'marmitex_proteins',     'truncate' => true],
    ['name' => 'marmitex_sides',        'truncate' => true],
    ['name' => 'marmitex_observations', 'truncate' => true],
    ['name' => 'marmitex_invoices',     'truncate' => true],
    ['name' => 'marmitex_orders',       'truncate' => true],
    ['name' => 'marmitex_marmitas',     'truncate' => true],
];

function columns(string $schema, string $table): array
{
    $rows = Db::query(
        'SELECT column_name AS c FROM information_schema.columns WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position',
        [$schema, $table]
    );
    return array_map(static fn ($r) => (string) $r['c'], $rows);
}

function tableExists(string $schema, string $table): bool
{
    return Db::queryOne(
        'SELECT 1 FROM information_schema.tables WHERE table_schema = ? AND table_name = ?',
        [$schema, $table]
    ) !== null;
}

$q = static fn (string $ident): string => '`' . str_replace('`', '', $ident) . '`';

echo "[import] origem={$source} destino={$target}" . ($dryRun ? ' (DRY-RUN: nada será gravado)' : '') . "\n";

if (!tableExists($source, 'channels')) {
    fwrite(STDERR, "[import] base '{$source}' não encontrada ou sem a tabela 'channels' — o dump foi carregado? (scripts/import-prod.sh)\n");
    exit(1);
}

$pdo = Db::pdo();
$pdo->exec('SET FOREIGN_KEY_CHECKS=0');

$summary = [];
try {
    foreach (TABLES as $t) {
        $table = $t['name'];
        if (!tableExists($source, $table)) {
            $summary[] = [$table, 'AUSENTE no dump', 0];
            continue;
        }
        $srcCols = columns($source, $table);
        $dstCols = columns($target, $table);
        $common = array_values(array_intersect($dstCols, $srcCols));
        if (!$common) {
            $summary[] = [$table, 'sem colunas em comum', 0];
            continue;
        }
        $colList = implode(', ', array_map($q, $common));
        $src = $q($source) . '.' . $q($table);
        $dst = $q($target) . '.' . $q($table);
        $count = (int) (Db::queryOne("SELECT COUNT(*) AS n FROM {$src}")['n'] ?? 0);

        if ($dryRun) {
            $skipped = array_values(array_diff($srcCols, $common));
            $note = $skipped ? ('ignora: ' . implode(',', $skipped)) : 'todas as colunas';
            $summary[] = [$table, "copiaria ({$note})", $count];
            continue;
        }

        if (!empty($t['truncate'])) {
            $pdo->exec("TRUNCATE TABLE {$dst}");
        }
        $pdo->exec("INSERT INTO {$dst} ({$colList}) SELECT {$colList} FROM {$src}");
        $summary[] = [$table, 'ok', $count];
    }

    // --- Logins das empresas do Marmitex (role='company') ---
    // O prod (main) não tem a coluna `username` (migration 011 é só do ERP): sintetiza
    // a partir do e-mail (parte antes do @) ou 'empresaN'. Ids NÃO são preservados
    // (AUTO_INCREMENT novo) para não colidir com os usuários locais; `company_id`
    // referencia marmitex_companies, cujos ids SÃO preservados acima.
    // Efeito colateral aceito: marmitex_orders.created_by (INT informativo, sem FK)
    // fica com ids antigos — não quebra nada.
    $srcUserCols = tableExists($source, 'users') ? columns($source, 'users') : [];
    if ($srcUserCols !== []) {
        $hasUsername = in_array('username', $srcUserCols, true);
        $srcUsers = $q($source) . '.`users`';
        $rows = Db::query("SELECT * FROM {$srcUsers} WHERE role = 'company'");
        $inserted = 0;
        $skippedUsers = [];
        foreach ($rows as $u) {
            $username = $hasUsername && !empty($u['username'])
                ? (string) $u['username']
                : (!empty($u['email']) ? strstr((string) $u['email'], '@', true) ?: (string) $u['email'] : 'empresa' . (int) ($u['company_id'] ?? 0));
            $username = strtolower(trim($username));
            $exists = Db::queryOne('SELECT id FROM users WHERE username = ?', [$username]);
            if ($exists) {
                $skippedUsers[] = $username;
                continue;
            }
            if ($dryRun) {
                $inserted++;
                continue;
            }
            Db::execute(
                'INSERT INTO users (name, username, email, password_hash, role, company_id, active) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [
                    (string) ($u['name'] ?? $username),
                    $username,
                    $u['email'] ?? null,
                    (string) ($u['password_hash'] ?? ''),
                    'company',
                    isset($u['company_id']) ? (int) $u['company_id'] : null,
                    (int) ($u['active'] ?? 1),
                ]
            );
            $inserted++;
        }
        $note = $dryRun ? 'copiaria (só role=company)' : 'ok (só role=company)';
        if ($skippedUsers) {
            $note .= ' — pulados por username já existir: ' . implode(', ', $skippedUsers);
        }
        $summary[] = ['users (empresas)', $note, $inserted];
    }
} finally {
    $pdo->exec('SET FOREIGN_KEY_CHECKS=1');
}

echo str_pad('tabela', 26) . str_pad('status', 60) . "linhas\n";
echo str_repeat('-', 96) . "\n";
foreach ($summary as [$tbl, $status, $n]) {
    echo str_pad((string) $tbl, 26) . str_pad((string) $status, 60) . $n . "\n";
}
echo "\n[import] concluído" . ($dryRun ? ' (dry-run)' : '') . ".\n";
if (!$dryRun) {
    echo "[import] confira os dados no app e depois remova a base auxiliar:\n";
    echo "         docker compose exec db mysql -uroot -p<senha> -e 'DROP DATABASE {$source}'\n";
}
