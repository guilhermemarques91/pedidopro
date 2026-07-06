<?php

namespace App\Modules\Marmitex;

use App\Core\Db;

/**
 * Contrato da empresa (Clientes Empresariais): preço diferenciado por tamanho e
 * itens do cardápio ocultos. Ausência de registro = cardápio/preço base.
 */
final class MarmitexContract
{
    public const TYPES = ['sizes', 'proteins', 'sides', 'observations'];

    /** IDs ocultos por tipo. @return array<string,array<int,true>> */
    public static function hidden(int $companyId): array
    {
        $out = array_fill_keys(self::TYPES, []);
        foreach (Db::query('SELECT item_type, item_id FROM marmitex_company_hidden WHERE company_id = ?', [$companyId]) as $r) {
            $out[$r['item_type']][(int) $r['item_id']] = true;
        }
        return $out;
    }

    /** Preços de contrato por tamanho. @return array<int,string> size_id => price */
    public static function prices(int $companyId): array
    {
        $out = [];
        foreach (Db::query('SELECT size_id, price FROM marmitex_company_prices WHERE company_id = ?', [$companyId]) as $r) {
            $out[(int) $r['size_id']] = $r['price'];
        }
        return $out;
    }

    /** Aplica o contrato às listas do cardápio base (filtra ocultos, sobrepõe preços). */
    public static function apply(array $lists, int $companyId): array
    {
        $hidden = self::hidden($companyId);
        $prices = self::prices($companyId);
        foreach ($lists as $type => &$rows) {
            $rows = array_values(array_filter($rows, static fn ($r) => !isset($hidden[$type][(int) $r['id']])));
        }
        unset($rows);
        foreach ($lists['sizes'] as &$s) {
            $s['base_price'] = $s['price'];
            if (isset($prices[(int) $s['id']])) {
                $s['price'] = $prices[(int) $s['id']];
            }
        }
        unset($s);
        return $lists;
    }
}
