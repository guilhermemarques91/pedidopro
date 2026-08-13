<?php

namespace App\Modules\Search;

use App\Core\Auth;
use App\Core\Db;
use App\Core\Http;
use App\Core\Request;

/**
 * Busca global (a que abre com Ctrl+K no app).
 *
 * Uma consulta por fonte, cada uma limitada e escopada por org E por permissao:
 * o resultado nunca revela um registro de modulo ao qual o usuario nao tem acesso.
 *
 * Casamento por PREFIXO primeiro (usa os indices da migration 038) e, se o prefixo
 * nao trouxer nada, por trecho no meio da palavra. `ORDER BY` promove o prefixo,
 * entao "cocacola" digitado pela metade cai certo mesmo com o fallback ligado.
 */
final class SearchController
{
    /** Teto por fonte — a paleta mostra poucas linhas de cada tipo. */
    private const PER_SOURCE = 6;

    /** GET /search?q=termo */
    public static function query(Request $req): void
    {
        $q = trim((string) ($req->query('q') ?? ''));
        if (mb_strlen($q) < 2) {
            Http::json(['results' => []]);
            return;
        }
        $org = $req->orgId();
        $user = $req->user ?? [];
        $like = self::escapeLike($q);
        $prefix = $like . '%';
        $middle = '%' . $like . '%';

        $out = [];

        // --- Compras / cadastros ---
        if (Auth::can($user, 'compras:read')) {
            foreach (Db::query(
                "SELECT id, name, tipo FROM products
                  WHERE org_id = ? AND active = 1 AND (name LIKE ? ESCAPE '!' OR name LIKE ? ESCAPE '!')
                  ORDER BY (name LIKE ? ESCAPE '!') DESC, name
                  LIMIT " . self::PER_SOURCE,
                [$org, $prefix, $middle, $prefix]
            ) as $r) {
                $out[] = self::hit('Produto', $r['name'], $r['tipo'], '/products?q=' . rawurlencode($r['name']));
            }

            foreach (Db::query(
                "SELECT id, name FROM suppliers
                  WHERE org_id = ? AND (name LIKE ? ESCAPE '!' OR name LIKE ? ESCAPE '!')
                  ORDER BY (name LIKE ? ESCAPE '!') DESC, name
                  LIMIT " . self::PER_SOURCE,
                [$org, $prefix, $middle, $prefix]
            ) as $r) {
                $out[] = self::hit('Fornecedor', $r['name'], null, '/suppliers?q=' . rawurlencode($r['name']));
            }

            // Pedido de compra pelo numero (o operador fala "pedido 12").
            if (ctype_digit($q)) {
                foreach (Db::query(
                    'SELECT o.id, o.status, s.name AS supplier_name
                       FROM orders o JOIN suppliers s ON s.id = o.supplier_id
                      WHERE o.org_id = ? AND o.id = ? LIMIT 1',
                    [$org, (int) $q]
                ) as $r) {
                    $out[] = self::hit('Pedido de compra', "#{$r['id']} · {$r['supplier_name']}", $r['status'], "/orders/{$r['id']}");
                }
            }
        }

        // --- Delivery ---
        if (Auth::can($user, 'delivery:operate')) {
            foreach (Db::query(
                "SELECT id, customer_name, locator, status, platform FROM delivery_orders
                  WHERE org_id = ?
                    AND (customer_name LIKE ? ESCAPE '!' OR locator LIKE ? ESCAPE '!' OR customer_name LIKE ? ESCAPE '!')
                  ORDER BY placed_at DESC
                  LIMIT " . self::PER_SOURCE,
                [$org, $prefix, $prefix, $middle]
            ) as $r) {
                $label = trim(($r['locator'] ? $r['locator'] . ' · ' : '') . ($r['customer_name'] ?: 'sem nome'));
                $out[] = self::hit('Pedido delivery', $label, $r['platform'] . ' · ' . $r['status'], "/delivery/{$r['id']}");
            }
        }

        // --- Marmitex (empresas-cliente) ---
        if (Auth::can($user, 'marmitex:admin')) {
            foreach (Db::query(
                "SELECT id, name FROM marmitex_companies
                  WHERE org_id = ? AND active = 1 AND (name LIKE ? ESCAPE '!' OR name LIKE ? ESCAPE '!')
                  ORDER BY (name LIKE ? ESCAPE '!') DESC, name
                  LIMIT " . self::PER_SOURCE,
                [$org, $prefix, $middle, $prefix]
            ) as $r) {
                // Sem ?q=: a tela de empresas não tem campo de busca (são poucas),
                // e parâmetro que a tela ignora só confunde quem lê a URL depois.
                $out[] = self::hit('Empresa', $r['name'], null, '/marmitex/companies');
            }
        }

        Http::json(['results' => $out]);
    }

    /** @return array{type:string,label:string,hint:?string,to:string} */
    private static function hit(string $type, string $label, ?string $hint, string $to): array
    {
        return ['type' => $type, 'label' => $label, 'hint' => $hint, 'to' => $to];
    }

    /**
     * Neutraliza os curingas do LIKE no texto digitado.
     * Sem isso, um `%` digitado casaria com tudo e um `_` com qualquer caractere.
     */
    private static function escapeLike(string $s): string
    {
        return str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $s);
    }
}
