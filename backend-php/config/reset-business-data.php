<?php

/**
 * Reset de dados de negócio — apaga produtos/estoque, fornecedores, itens, pedidos, vendas,
 * marmitex, delivery, auditoria etc. MANTÉM organizations/users/roles/schema_migrations (login
 * e configuração intactos). Rode na linha de comando:
 *   php config/reset-business-data.php
 */

declare(strict_types=1);

use App\Core\Db;

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
\App\Core\Env::load($root . '/.env');

$keep = ['organizations', 'users', 'roles', 'schema_migrations'];

$rows = Db::query('SHOW TABLES');
$all = $rows ? array_column($rows, array_key_first($rows[0])) : [];
$tables = array_values(array_diff($all, $keep));

Db::execute('SET FOREIGN_KEY_CHECKS=0');
foreach ($tables as $t) {
    Db::execute("TRUNCATE TABLE `{$t}`");
    echo "  truncated {$t}\n";
}
Db::execute('SET FOREIGN_KEY_CHECKS=1');

echo "\nOK — " . count($tables) . " tabelas de negócio zeradas. Mantidos: " . implode(', ', $keep) . ".\n";
