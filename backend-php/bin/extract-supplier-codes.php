<?php

/**
 * Extrai o código do fornecedor (número isolado de 4 dígitos) do nome dos itens.
 * Para usar quando o MySQL não tem REGEXP_SUBSTR/REGEXP_REPLACE (MySQL 5.7).
 *
 * Uso (no Terminal do cPanel ou SSH, a partir da pasta /api):
 *   php bin/extract-supplier-codes.php           # PRÉVIA (não altera nada)
 *   php bin/extract-supplier-codes.php --apply    # aplica as alterações
 *
 * Regra: só altera itens com supplier_code vazio e com EXATAMENTE um número
 * isolado de 4 dígitos no nome. Itens com mais de um número são listados como
 * "AMBÍGUO" e ignorados (revise manualmente na tela de Itens).
 */

declare(strict_types=1);

use App\Core\Db;
use App\Core\Env;

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

$apply = in_array('--apply', $argv, true);

$items = Db::query('SELECT id, name FROM items WHERE supplier_code IS NULL OR supplier_code = ?', ['']);

$toUpdate = [];
$ambiguous = [];

foreach ($items as $it) {
    $name = (string) $it['name'];
    preg_match_all('/\b\d{4}\b/', $name, $m);
    $codes = array_values(array_unique($m[0]));
    if (count($codes) === 0) {
        continue;
    }
    if (count($codes) > 1) {
        $ambiguous[] = ['id' => $it['id'], 'name' => $name, 'codes' => $codes];
        continue;
    }
    $code = $codes[0];
    // Remove a 1ª ocorrência do código e normaliza espaços.
    $clean = preg_replace('/\b' . preg_quote($code, '/') . '\b/', '', $name, 1);
    $clean = trim((string) preg_replace('/\s{2,}/', ' ', (string) $clean));
    $toUpdate[] = ['id' => $it['id'], 'name' => $name, 'code' => $code, 'clean' => $clean];
}

echo "\n=== ITENS A ATUALIZAR (" . count($toUpdate) . ") ===\n";
foreach ($toUpdate as $u) {
    printf("#%-4d  [%s]  %s  ->  %s\n", $u['id'], $u['code'], $u['name'], $u['clean']);
}

if ($ambiguous) {
    echo "\n=== AMBÍGUOS — NÃO ALTERADOS (" . count($ambiguous) . ") ===\n";
    foreach ($ambiguous as $a) {
        printf("#%-4d  códigos: %s  |  %s\n", $a['id'], implode(', ', $a['codes']), $a['name']);
    }
}

if (!$apply) {
    echo "\nPRÉVIA apenas. Para aplicar, rode de novo com --apply\n";
    exit;
}

$n = 0;
Db::transaction(function () use ($toUpdate, &$n) {
    foreach ($toUpdate as $u) {
        Db::execute('UPDATE items SET supplier_code = ?, name = ? WHERE id = ?', [$u['code'], $u['clean'], $u['id']]);
        $n++;
    }
});

echo "\n{$n} item(ns) atualizado(s).\n";
