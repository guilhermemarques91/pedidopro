<?php

/**
 * Vincula (items.product_id) os itens de fornecedor cujo nome bate — acento/caixa
 * insensível, mesma collation que o resto do sistema já usa (utf8mb4_0900_ai_ci) —
 * com um produto existente que ainda não tem esse vínculo.
 *
 * Resquício da importação da planilha: os itens entraram com o preço e o fornecedor
 * certos, mas sem o `product_id` que agrupa "FILÉ DE FRANGO da Aurora" e "FILÉ DE
 * FRANGO da Bolonha" como ofertas do MESMO produto "FILE DE FRANGO". Sem isso, a
 * tela de alocação da Lista de Compras não tinha NADA para sugerir na maioria dos
 * itens — o combo nascia vazio.
 *
 * Depois de vincular, também preenche products.supplier_id ("Fornecedor principal")
 * quando o produto passa a ter UM SÓ fornecedor entre os itens vinculados — aí não é
 * escolha, é o único que existe. Produto com 2+ fornecedores fica sem preencher: essa
 * decisão é do usuário (ver Products/index.tsx, campo "Fornecedor principal"), e
 * `supplier_id` já preenchido NUNCA é sobrescrito.
 *
 * Uso (dentro do container):
 *   php bin/link-items-to-products.php            # PRÉVIA (não altera nada)
 *   php bin/link-items-to-products.php --apply     # aplica as alterações
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

// Um item só casa se o nome apontar para EXATAMENTE um produto da mesma org — nome
// duplicado entre produtos vira ambíguo e fica de fora (não achei nenhum caso hoje,
// mas o script não deve presumir que nunca vai existir).
$candidates = Db::query(
    "SELECT i.id AS item_id, i.name AS item_name, i.org_id, i.supplier_id, s.name AS supplier_name,
            (SELECT COUNT(*) FROM products p2
              WHERE p2.org_id = i.org_id AND LOWER(TRIM(p2.name)) = LOWER(TRIM(i.name))) AS n_match,
            (SELECT p3.id FROM products p3
              WHERE p3.org_id = i.org_id AND LOWER(TRIM(p3.name)) = LOWER(TRIM(i.name)) LIMIT 1) AS product_id
       FROM items i LEFT JOIN suppliers s ON s.id = i.supplier_id
      WHERE i.active = 1 AND i.product_id IS NULL"
);

$byItemId = [];  // item_id (int) => linha completa, para lookup sem array_search frágil
foreach ($candidates as $c) {
    $byItemId[(int) $c['item_id']] = $c;
}

$toLink = [];   // item_id => product_id
$ambiguous = [];
$unmatched = [];
foreach ($candidates as $c) {
    $n = (int) $c['n_match'];
    if ($n === 0) {
        $unmatched[] = $c;
    } elseif ($n > 1) {
        $ambiguous[] = $c;
    } else {
        $toLink[(int) $c['item_id']] = (int) $c['product_id'];
    }
}

echo "\n=== ITENS A VINCULAR POR NOME (" . count($toLink) . ") ===\n";
foreach ($candidates as $c) {
    if (!isset($toLink[(int) $c['item_id']])) {
        continue;
    }
    printf("#%-4d  %-45s  <- %s\n", $c['product_id'], $c['item_name'], $c['supplier_name'] ?? '(sem fornecedor)');
}

if ($ambiguous) {
    echo "\n=== AMBÍGUOS — mais de um produto com este nome, NÃO vinculados (" . count($ambiguous) . ") ===\n";
    foreach ($ambiguous as $a) {
        printf("item #%-4d  %s\n", $a['item_id'], $a['item_name']);
    }
}
echo "\nSem produto correspondente (seguem soltos): " . count($unmatched) . "\n";

// Simula o "fornecedor único" já contando os vínculos que este script vai criar,
// não só os que já existiam — senão o produto que só tem UM item, e é justamente
// este script que está prestes a vinculá-lo, nunca se qualificaria.
$productSuppliers = [];
$rows = Db::query(
    'SELECT product_id, supplier_id FROM items WHERE active = 1 AND product_id IS NOT NULL AND supplier_id IS NOT NULL'
);
foreach ($rows as $r) {
    $productSuppliers[(int) $r['product_id']][(int) $r['supplier_id']] = true;
}
foreach ($toLink as $itemId => $productId) {
    $sid = (int) ($byItemId[$itemId]['supplier_id'] ?? 0);
    if ($sid > 0) {
        $productSuppliers[$productId][$sid] = true;
    }
}

$productsAlreadyDefault = [];
foreach (Db::query('SELECT id, supplier_id FROM products WHERE supplier_id IS NOT NULL') as $p) {
    $productsAlreadyDefault[(int) $p['id']] = true;
}

$toSetDefault = [];   // product_id => supplier_id
foreach ($productSuppliers as $pid => $suppliers) {
    if (isset($productsAlreadyDefault[$pid])) {
        continue; // já tem "Fornecedor principal" cadastrado — nunca sobrescreve
    }
    if (count($suppliers) === 1) {
        $toSetDefault[$pid] = (int) array_key_first($suppliers);
    }
}

echo "\n=== FORNECEDOR PRINCIPAL preenchido automaticamente — produto com 1 só fornecedor (" . count($toSetDefault) . ") ===\n";
$multi = 0;
foreach ($productSuppliers as $pid => $suppliers) {
    if (count($suppliers) > 1 && !isset($productsAlreadyDefault[$pid])) {
        $multi++;
    }
}
echo "Produtos com 2+ fornecedores (ficam sem preencher — decisão do usuário): {$multi}\n";

if (!$apply) {
    echo "\nPRÉVIA apenas. Para aplicar, rode de novo com --apply\n";
    exit;
}

[$linked, $defaulted] = Db::transaction(function () use ($toLink, $toSetDefault) {
    $n1 = 0;
    foreach ($toLink as $itemId => $productId) {
        Db::execute('UPDATE items SET product_id = ? WHERE id = ?', [$productId, $itemId]);
        $n1++;
    }
    $n2 = 0;
    foreach ($toSetDefault as $productId => $supplierId) {
        Db::execute('UPDATE products SET supplier_id = ? WHERE id = ? AND supplier_id IS NULL', [$supplierId, $productId]);
        $n2++;
    }
    return [$n1, $n2];
});

echo "\n{$linked} item(ns) vinculado(s) a produto. {$defaulted} produto(s) com fornecedor principal preenchido.\n";
