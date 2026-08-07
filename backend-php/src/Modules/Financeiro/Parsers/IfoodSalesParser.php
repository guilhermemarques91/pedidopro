<?php

namespace App\Modules\Financeiro\Parsers;

/**
 * "Relatório de vendas" do iFood.
 *
 * Aba `Vendas`, uma linha por Serviço x Logística, com o total do PERÍODO — não
 * há abertura por dia. Por isso o resultado é mensal (fin_platform_monthly) e
 * não diário.
 *
 *   Período | Marca | Serviço | Logística | Id da loja | Nome da loja | UF |
 *   Cidade | Total de vendas (pedidos) | Valor total de vendas |
 *   Taxa de entrega | Ticket médio | Novos clientes
 *
 * A TAXA DE ENTREGA só é receita da loja quando a entrega é própria: na
 * logística do iFood quem fica com ela é a plataforma. Por isso ela é somada
 * apenas nas linhas de "Entrega própria" (a de "Retirada" vem zerada mesmo).
 *
 * Este relatório NÃO traz comissão — ele é de volume de vendas, não extrato
 * financeiro. O take-rate do iFood continua desconhecido até o extrato de
 * repasse ser importado.
 */
final class IfoodSalesParser
{
    private const REQUIRED_HEADERS = ['valor_total_de_vendas', 'taxa_de_entrega'];

    /** @return array{valid:array<int,array>,errors:array<int,array>,totalRows:int,meta:array} */
    public static function parse(string $path): array
    {
        $rows = SheetHelper::rows($path);
        $headerIdx = SheetHelper::findHeaderRow($rows, self::REQUIRED_HEADERS);
        if ($headerIdx === null) {
            return [
                'valid' => [], 'totalRows' => 0, 'meta' => [],
                'errors' => [['rowNumber' => 0, 'errors' => ['aba "Vendas" do relatório do iFood não encontrada'], 'raw' => []]],
            ];
        }

        $cols = SheetHelper::columnIndex($rows[$headerIdx]);
        $get = static fn (array $row, string $key) => isset($cols[$key]) ? ($row[$cols[$key]] ?? null) : null;

        $byMonth = [];
        $errors = [];
        $dataRows = 0;
        $count = count($rows);

        for ($r = $headerIdx + 1; $r < $count; $r++) {
            $row = (array) $rows[$r];
            $rowNumber = $r + 1;
            $period = SheetHelper::clean($get($row, 'periodo'));
            if ($period === '') {
                continue;
            }
            $dataRows++;

            $refMonth = self::refMonth($period);
            if ($refMonth === null) {
                $errors[] = [
                    'rowNumber' => $rowNumber,
                    'errors' => ["período não reconhecido: \"{$period}\""],
                    'raw' => [],
                ];
                continue;
            }

            $logistics = SheetHelper::stripAccents(mb_strtolower(SheetHelper::clean($get($row, 'logistica'))));
            $ownDelivery = str_contains($logistics, 'propria');

            $byMonth[$refMonth] ??= [
                'platform' => 'ifood',
                'ref_month' => $refMonth,
                'orders' => 0,
                'gross_revenue' => 0.0,
                'delivery_fee' => 0.0,
                'new_customers' => 0,
                'extra_json' => ['logisticas' => []],
                'rowNumber' => $rowNumber,
            ];
            $m = &$byMonth[$refMonth];

            $orders = SheetHelper::parseInt($get($row, 'total_de_vendas_pedidos')) ?? 0;
            $revenue = SheetHelper::parseMoney($get($row, 'valor_total_de_vendas')) ?? 0.0;
            $fee = SheetHelper::parseMoney($get($row, 'taxa_de_entrega')) ?? 0.0;

            $m['orders'] += $orders;
            $m['gross_revenue'] += $revenue;
            if ($ownDelivery) {
                $m['delivery_fee'] += $fee;
            }
            $m['new_customers'] += SheetHelper::parseInt($get($row, 'novos_clientes')) ?? 0;
            $m['extra_json']['logisticas'][] = [
                'logistica' => SheetHelper::cleanOrNull($get($row, 'logistica')),
                'servico' => SheetHelper::cleanOrNull($get($row, 'servico')),
                'pedidos' => $orders,
                'vendas' => round($revenue, 2),
                'taxa_entrega' => round($fee, 2),
                'taxa_e_receita_da_loja' => $ownDelivery,
            ];
            unset($m);
        }

        $valid = [];
        foreach ($byMonth as $m) {
            $m['gross_revenue'] = round($m['gross_revenue'], 2);
            $m['delivery_fee'] = round($m['delivery_fee'], 2);
            $m['avg_ticket'] = $m['orders'] > 0 ? round($m['gross_revenue'] / $m['orders'], 2) : null;
            // Sem comissão no arquivo: deixa NULL em vez de zero, senão o
            // take-rate do iFood apareceria como 0% (e não como desconhecido).
            $m['commission'] = null;
            $m['offers_cost'] = null;
            $m['payment_fee'] = null;
            $m['net_revenue'] = null;
            $valid[] = $m;
        }

        $months = array_keys($byMonth);
        sort($months);
        $first = $months[0] ?? null;
        $last = $months ? end($months) : null;

        return [
            'valid' => $valid,
            'errors' => $errors,
            'totalRows' => $dataRows,
            'meta' => [
                'platform' => 'ifood',
                'granularity' => 'mensal',
                'ref_month' => $first,
                'period_start' => $first ? $first . '-01' : null,
                'period_end' => $last ? date('Y-m-t', strtotime($last . '-01')) : null,
                'sem_comissao' => true,
            ],
        ];
    }

    /** "01/07/2026 - 31/07/2026" => "2026-07". */
    private static function refMonth(string $period): ?string
    {
        if (preg_match('#(\d{1,2})/(\d{1,2})/(\d{4})#', $period, $m)) {
            return sprintf('%04d-%02d', (int) $m[3], (int) $m[2]);
        }
        return null;
    }
}
