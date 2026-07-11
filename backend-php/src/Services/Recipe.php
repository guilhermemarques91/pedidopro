<?php

namespace App\Services;

use App\Core\HttpError;
use PDO;

/**
 * Explosão da ficha técnica (product_recipe): converte "vendi N do produto X" na lista de
 * insumos realmente consumidos. Só lê; quem grava movimento é o Stock.
 *
 * Um produto com receita é ATRAVESSADO (sub-receita explode recursivamente); um produto sem
 * receita é folha e vira consumo dele mesmo. Consequência conhecida: um item intermediário
 * produzido em lote e estocado (uma panela de molho que dura a semana) sempre será explodido
 * até a matéria-prima — estocá-lo de verdade depende de uma ordem de produção, que não existe.
 */
final class Recipe
{
    /** Receitas mais fundas que isto são erro de cadastro, não uso legítimo. */
    private const MAX_DEPTH = 10;

    /**
     * @param  float                $qty Quantidade vendida do produto.
     * @return array<int,float>     component_id => quantidade total a consumir.
     */
    public static function explode(PDO $pdo, int $orgId, int $productId, float $qty): array
    {
        $out = [];
        self::walk($pdo, $orgId, $productId, $qty, $out, [], 0);
        return $out;
    }

    /**
     * @param array<int,float> $out   Acumulador: o mesmo insumo vindo de ramos diferentes soma.
     * @param array<int,true>  $path  Ids no caminho atual (detecta ciclo).
     */
    private static function walk(PDO $pdo, int $orgId, int $productId, float $qty, array &$out, array $path, int $depth): void
    {
        if (isset($path[$productId])) {
            throw HttpError::badRequest("Ciclo na ficha técnica: o produto #{$productId} contém a si mesmo");
        }
        if ($depth > self::MAX_DEPTH) {
            throw HttpError::badRequest('Ficha técnica profunda demais (possível ciclo)');
        }

        $components = self::components($pdo, $orgId, $productId);
        if (!$components) {
            $out[$productId] = ($out[$productId] ?? 0) + $qty; // folha: consome a si mesmo
            return;
        }

        // A receita rende yield_qty unidades; o consumo por unidade vendida é proporcional.
        $factor = $qty / self::yieldQty($pdo, $productId);
        $path[$productId] = true;
        foreach ($components as $c) {
            self::walk($pdo, $orgId, (int) $c['component_id'], (float) $c['quantity'] * $factor, $out, $path, $depth + 1);
        }
    }

    /** Linhas de receita com insumo cadastrado; component_name solto (texto livre) é ignorado. */
    private static function components(PDO $pdo, int $orgId, int $productId): array
    {
        $st = $pdo->prepare(
            'SELECT component_id, quantity
               FROM product_recipe
              WHERE product_id = ? AND org_id = ? AND component_id IS NOT NULL AND quantity > 0'
        );
        $st->execute([$productId, $orgId]);
        return $st->fetchAll();
    }

    private static function yieldQty(PDO $pdo, int $productId): float
    {
        $st = $pdo->prepare('SELECT yield_qty FROM products WHERE id = ?');
        $st->execute([$productId]);
        $y = (float) ($st->fetch()['yield_qty'] ?? 0);
        return $y > 0 ? $y : 1.0;
    }
}
