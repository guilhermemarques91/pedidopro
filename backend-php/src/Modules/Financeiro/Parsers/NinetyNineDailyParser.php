<?php

namespace App\Modules\Financeiro\Parsers;

/**
 * "Dados da loja" do 99Food — uma linha por dia, 48 colunas.
 *
 * Atenção: o arquivo grava TUDO como texto. Os valores vêm em pt-BR
 * ("1.014,5", "43,52") e os percentuais como string ("11,11%"); só a data sai
 * em ISO ("2026-07-31"). Por isso todo campo passa por SheetHelper::parseMoney
 * / parsePct em vez de cast direto.
 *
 * Receita líquida = receita de vendas - comissão - ofertas - taxa de pagamento.
 * As "recompensas da plataforma" (promoções bancadas pelo 99) NÃO entram nesse
 * cálculo: são subsídio de marketing, não venda — ficam num campo próprio.
 */
final class NinetyNineDailyParser
{
    private const REQUIRED_HEADERS = ['data', 'receita_total_de_vendas'];

    /** Colunas normalizadas que viram coluna da tabela. */
    private const MONEY = [
        'gross_revenue' => 'receita_total_de_vendas',
        'avg_ticket' => 'valor_medio_dos_pedidos',
        'offers_cost' => 'despesas_de_ofertas_da_loja',
        'commission' => 'despesas_de_comissao_da_loja',
        'payment_fee' => 'taxa_de_canal_de_pagamento_da_loja',
        'platform_rewards' => 'recompensas_da_plataforma',
        'cancelled_value' => 'valor_da_perda_de_pedido_por_cancelamentos_por_parte_da_loja',
        'rating' => 'avaliacao_da_loja',
        'prep_time_avg' => 'tempo_medio_de_preparo_minutos',
    ];

    private const INTS = [
        'orders' => 'total_de_vendas_realizadas',
        'cancelled_orders' => 'pedidos_cancelados_por_parte_da_loja',
        'visitors' => 'visitantes_da_loja',
        'new_customers' => 'novos_clientes',
        'returning_customers' => 'clientes_recorrentes',
    ];

    /** Guardadas em extra_json — úteis nos relatórios, não valem coluna própria. */
    private const EXTRA = [
        'receita_total' => 'receita_total',
        'alcance' => 'alcance',
        'carrinhos' => 'clientes_que_adicionaram_ao_carrinho',
        'clientes_pedido' => 'clientes_que_fizeram_um_pedido',
        'pedidos_oferta' => 'pedidos_de_oferta_finalizados',
        'receita_oferta' => 'receita_de_pedidos_em_oferta',
        'loja_id' => 'id_do_loja',
    ];

    /** @return array{valid:array<int,array>,errors:array<int,array>,totalRows:int,meta:array} */
    public static function parse(string $path): array
    {
        $rows = SheetHelper::rows($path);
        $headerIdx = SheetHelper::findHeaderRow($rows, self::REQUIRED_HEADERS);
        if ($headerIdx === null) {
            return [
                'valid' => [], 'totalRows' => 0, 'meta' => [],
                'errors' => [['rowNumber' => 0, 'errors' => ['cabeçalho do relatório do 99Food não encontrado'], 'raw' => []]],
            ];
        }

        $cols = SheetHelper::columnIndex($rows[$headerIdx]);
        $get = static fn (array $row, string $key) => isset($cols[$key]) ? ($row[$cols[$key]] ?? null) : null;

        $valid = [];
        $errors = [];
        $dataRows = 0;
        $seen = [];
        $count = count($rows);

        for ($r = $headerIdx + 1; $r < $count; $r++) {
            $row = (array) $rows[$r];
            $rowNumber = $r + 1;
            $rawDate = $get($row, 'data');
            if (SheetHelper::clean($rawDate) === '') {
                continue;
            }
            $dataRows++;

            $date = SheetHelper::parseDate($rawDate);
            if ($date === null) {
                $errors[] = [
                    'rowNumber' => $rowNumber,
                    'errors' => ['data inválida: "' . SheetHelper::clean($rawDate) . '"'],
                    'raw' => [],
                ];
                continue;
            }
            if (isset($seen[$date])) {
                $errors[] = ['rowNumber' => $rowNumber, 'errors' => ["data repetida no arquivo: {$date}"], 'raw' => []];
                continue;
            }
            $seen[$date] = true;

            $out = ['rowNumber' => $rowNumber, 'platform' => '99food', 'stat_date' => $date];
            foreach (self::MONEY as $field => $header) {
                $out[$field] = SheetHelper::parseMoney($get($row, $header));
            }
            foreach (self::INTS as $field => $header) {
                $out[$field] = SheetHelper::parseInt($get($row, $header));
            }

            $extra = [];
            foreach (self::EXTRA as $key => $header) {
                $v = SheetHelper::cleanOrNull($get($row, $header));
                if ($v !== null) {
                    $extra[$key] = $v;
                }
            }
            $out['extra_json'] = $extra ?: null;

            $gross = $out['gross_revenue'] ?? 0.0;
            $out['net_revenue'] = round(
                $gross - ($out['commission'] ?? 0.0) - ($out['offers_cost'] ?? 0.0) - ($out['payment_fee'] ?? 0.0),
                2
            );
            $out['delivery_fee'] = null; // o 99Food não separa a taxa de entrega neste relatório

            $valid[] = $out;
        }

        $dates = array_keys($seen);
        sort($dates);

        return [
            'valid' => $valid,
            'errors' => $errors,
            'totalRows' => $dataRows,
            'meta' => [
                'platform' => '99food',
                'period_start' => $dates[0] ?? null,
                'period_end' => $dates ? end($dates) : null,
                'ref_month' => isset($dates[0]) ? substr($dates[0], 0, 7) : null,
            ],
        ];
    }
}
