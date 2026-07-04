<?php

/**
 * Seed — cria o usuário admin inicial. Rode na linha de comando:
 *   php config/seed.php
 *
 * Credenciais padrão (ALTERE depois de logar):
 *   email: admin@pedidopro.local
 *   senha: admin123
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

$admin = ['name' => 'Administrador', 'username' => 'admin', 'password' => 'admin123', 'role' => 'admin'];

$existing = Db::queryOne('SELECT id FROM users WHERE username = ?', [$admin['username']]);
if ($existing) {
    echo "Usuário {$admin['username']} já existe (id {$existing['id']}). Nada a fazer.\n";
    exit;
}

$hash = password_hash($admin['password'], PASSWORD_BCRYPT);
Db::execute(
    'INSERT INTO users (name, username, password_hash, role) VALUES (?, ?, ?, ?)',
    [$admin['name'], $admin['username'], $hash, $admin['role']]
);
echo "Usuário admin criado (id " . Db::lastInsertId() . "):\n";
echo "  usuário: {$admin['username']}\n";
echo "  senha: {$admin['password']}\n";
