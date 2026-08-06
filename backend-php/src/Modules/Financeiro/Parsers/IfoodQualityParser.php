<?php

namespace App\Modules\Financeiro\Parsers;

/**
 * Relatório "Qualidade da operação" do iFood.
 *
 * Layout TRANSPOSTO: os indicadores são LINHAS e as datas são COLUNAS. O arquivo
 * ainda empilha várias seções (qualidade, variação, perdas por cancelamento,
 * cancelamentos por turno/dia da semana), cada uma repetindo a própria linha de
 * datas. Por isso a leitura é feita em varredura: sempre que aparece uma linha
 * com várias datas, o mapa coluna=>data é reconstruído; as linhas seguintes são
 * lidas contra esse mapa.
 *
 * ATENÇÃO — o arquivo NÃO tem o ano em lugar nenhum: o cabeçalho traz
 * "Período: Diário (01/07 a 31/07)" e as colunas trazem "31/07". O ano vem do
 * parâmetro $yearHint (o usuário confirma na pré-visualização); sem ele, cai no
 * palpite de `guessYear()`.
 *
 * Este relatório é operacional — não traz faturamento nem comissão. Ele preenche
 * apenas as colunas de qualidade de fin_platform_daily; as colunas financeiras
 * ficam por conta do extrato do iFood (ver IfoodSettlementParser).
 */
final class IfoodQualityParser
{
    /** Rótulo do indicador (normalizado) => campo da tabela. */
    private const INDICATORS = [
        'pedidos_totais' => 'orders',
        'valor_total_do_cancelamento_com_entrega_r' => 'cancelled_value',
        'pedidos_cancelados_com_impacto_no_super' => 'cancelled_orders',
        'media_das_avaliacoes' => 'rating',
    ];

    /** Indicadores guardados em extra_json. */
    private const EXTRA_INDICATORS = [
        'quantidade_de_avaliacoes' => 'avaliacoes',
        'pedidos_com_chamados' => 'chamados',
        'tempo_online_real_vs_planejado' => 'tempo_online',
    ];

    /** @return array{valid:array<int,array>,errors:array<int,array>,totalRows:int,meta:array} */
    public static function parse(string $path, ?int $yearHint = null): array
    {
        $rows = SheetHelper::rows($path);
        $period = self::period($rows);
        $year = $yearHint ?? $period['year'] ?? self::guessYear($period['start_month']);

        /** @var array<string,array<string,mixed>> $byDate */
        $byDate = [];
        $dateCols = [];
        $errors = [];
        $indicatorRows = 0;

        foreach ($rows as $i => $rawRow) {
            $row = (array) $rawRow;

            // Linha de datas? (>= 3 células no formato dd/mm) => vira o mapa atual.
            $candidate = self::dateColumns($row, $year);
            if (count($candidate) >= 3) {
                $dateCols = $candidate;
                continue;
            }
            if (!$dateCols) {
                continue;
            }

            $label = SheetHelper::normalizeHeader((string) ($row[0] ?? ''));
            if ($label === '') {
                continue;
            }
            $field = self::INDICATORS[$label] ?? null;
            $extraKey = self::EXTRA_INDICATORS[$label] ?? null;
            if ($field === null && $extraKey === null) {
                continue;
            }
            $indicatorRows++;

            foreach ($dateCols as $colIdx => $date) {
                $value = SheetHelper::parseMoney($row[$colIdx] ?? null);
                if ($value === null) {
                    continue;
                }
                $byDate[$date] ??= ['platform' => 'ifood', 'stat_date' => $date, 'extra_json' => []];
                // PRIMEIRA ocorrência vence: "Média das avaliações" aparece duas
                // vezes no arquivo — na seção "Qualidade da Operação" (o valor
                // real) e de novo em "Variação Dia vs Dia" (a diferença em p.p.,
                // que chega a ser negativa). Sem isso a nota vira a variação.
                if ($field !== null) {
                    if (!isset($byDate[$date][$field])) {
                        $byDate[$date][$field] = in_array($field, ['orders', 'cancelled_orders'], true)
                            ? (int) round($value)
                            : round($value, 2);
                    }
                } elseif (!isset($byDate[$date]['extra_json'][$extraKey])) {
                    $byDate[$date]['extra_json'][$extraKey] = $value;
                }
            }
        }

        if (!$byDate) {
            $errors[] = [
                'rowNumber' => 0,
                'errors' => ['nenhuma coluna de data encontrada no relatório do iFood'],
                'raw' => [],
            ];
        }

        ksort($byDate);
        $valid = [];
        foreach ($byDate as $date => $rowOut) {
            $rowOut['extra_json'] = $rowOut['extra_json'] ?: null;
            $rowOut['rowNumber'] = 0;
            $valid[] = $rowOut;
        }

        $dates = array_keys($byDate);

        return [
            'valid' => $valid,
            'errors' => $errors,
            'totalRows' => $indicatorRows,
            'meta' => [
                'platform' => 'ifood',
                'year_used' => $year,
                'year_was_inferred' => $yearHint === null && ($period['year'] ?? null) === null,
                'period_label' => $period['label'],
                'period_start' => $dates[0] ?? null,
                'period_end' => $dates ? end($dates) : null,
                'ref_month' => isset($dates[0]) ? substr($dates[0], 0, 7) : null,
            ],
        ];
    }

    /**
     * Colunas cujo conteúdo é uma data dd/mm (ou dd/mm/aaaa).
     * @return array<int,string> índice da coluna => data ISO
     */
    private static function dateColumns(array $row, int $year): array
    {
        $out = [];
        foreach ($row as $idx => $cell) {
            $s = SheetHelper::clean($cell);
            if ($s === '' || !preg_match('#^\d{1,2}/\d{1,2}(/\d{4})?$#', $s)) {
                continue;
            }
            $date = SheetHelper::parseDate($s, $year);
            if ($date !== null) {
                $out[$idx] = $date;
            }
        }
        return $out;
    }

    /** Lê "Período: Diário (01/07 a 31/07)" — o ano quase nunca está lá. */
    private static function period(array $rows): array
    {
        $label = null;
        $limit = min(12, count($rows));
        for ($i = 0; $i < $limit; $i++) {
            if (SheetHelper::normalizeHeader((string) (($rows[$i][0] ?? ''))) === 'periodo') {
                $label = SheetHelper::clean($rows[$i][1] ?? '');
                break;
            }
        }
        $year = null;
        $startMonth = null;
        if ($label !== null) {
            if (preg_match('#(\d{1,2})/(\d{1,2})(?:/(\d{4}))?#', $label, $m)) {
                $startMonth = (int) $m[2];
                $year = isset($m[3]) ? (int) $m[3] : null;
            }
        }
        return ['label' => $label, 'year' => $year, 'start_month' => $startMonth];
    }

    /**
     * Sem ano no arquivo: assume a ocorrência mais recente já encerrada. Se o mês
     * do relatório ainda não chegou neste ano, o relatório é do ano passado.
     */
    private static function guessYear(?int $month): int
    {
        $now = (int) date('Y');
        if ($month === null) {
            return $now;
        }
        return $month > (int) date('n') ? $now - 1 : $now;
    }
}
