<?php

namespace App\Modules\Financeiro\Parsers;

/**
 * DRE mensal exportado do AllFood ("Dashboard JULHO/2026 - DRE").
 *
 * Layout: linhas 1-6 de metadados (Relatório / Emissão / Empresa / Mês / Ano),
 * cabeçalho "| CONTA | VALOR | % VENDA BRUTA", e as linhas do demonstrativo com:
 *   - coluna A = sinal (+) (-) (=)
 *   - coluna B = conta INDENTADA (5 espaços por nível): "     3.01.01.01 - NOME"
 *   - coluna C = valor (número nativo)
 *   - coluna D = fração da venda bruta (0.2995 = 29,95%)
 *
 * Linhas sem código (LUCRO BRUTO, LUCRO OPERACIONAL, RESULTADO DO EXERCICIO,
 * LUCRO/PREJUÍZO LÍQUIDO) são SUBTOTAIS calculados pelo AllFood; recebem um
 * código sintético "@lucro_bruto" para não colidirem na chave única do mês.
 */
final class AllfoodDreParser
{
    private const REQUIRED_HEADERS = ['conta', 'valor'];

    /**
     * @return array{valid:array<int,array>,errors:array<int,array>,totalRows:int,meta:array}
     */
    public static function parse(string $path): array
    {
        $rows = SheetHelper::rows($path);
        $meta = self::meta($rows);

        $headerIdx = SheetHelper::findHeaderRow($rows, self::REQUIRED_HEADERS);
        if ($headerIdx === null) {
            return [
                'valid' => [], 'totalRows' => 0, 'meta' => $meta,
                'errors' => [['rowNumber' => 0, 'errors' => ['cabeçalho "CONTA | VALOR" não encontrado'], 'raw' => []]],
            ];
        }

        $cols = SheetHelper::columnIndex($rows[$headerIdx]);
        $colConta = $cols['conta'] ?? 1;
        $colValor = $cols['valor'] ?? 2;
        $colPct = $cols['venda_bruta'] ?? $cols['_venda_bruta'] ?? 3;
        // A coluna do sinal não tem cabeçalho — é a que fica antes da CONTA.
        $colSign = $colConta > 0 ? $colConta - 1 : 0;

        $valid = [];
        $errors = [];
        $dataRows = 0;
        $seen = [];
        $sort = 0;
        $count = count($rows);

        for ($r = $headerIdx + 1; $r < $count; $r++) {
            $row = (array) $rows[$r];
            $rowNumber = $r + 1;
            $rawConta = $row[$colConta] ?? null;
            $contaText = $rawConta === null ? '' : rtrim((string) $rawConta);

            if (trim($contaText) === '') {
                continue;
            }
            $dataRows++;

            $account = SheetHelper::splitAccount($contaText);
            $amount = SheetHelper::parseMoney($row[$colValor] ?? null);
            if ($amount === null) {
                $errors[] = [
                    'rowNumber' => $rowNumber,
                    'errors' => ['valor ausente ou não numérico'],
                    'raw' => ['conta' => trim($contaText)],
                ];
                continue;
            }

            $isSubtotal = $account['code'] === null;
            // Nomes longos ("RESULTADO DO EXERCICIO ANTES DAS DEDUÇÕES") viram
            // códigos longos; corta no limite da coluna.
            $code = $isSubtotal
                ? '@' . substr(SheetHelper::slug($account['name']), 0, 60)
                : $account['code'];
            if ($code === '@') {
                continue;
            }
            // Mesmo código duas vezes no arquivo: fica a primeira ocorrência.
            if (isset($seen[$code])) {
                $errors[] = [
                    'rowNumber' => $rowNumber,
                    'errors' => ["conta repetida no arquivo: {$code}"],
                    'raw' => ['conta' => trim($contaText)],
                ];
                continue;
            }
            $seen[$code] = true;

            $valid[] = [
                'rowNumber' => $rowNumber,
                'account_code' => $code,
                'account_name' => $account['name'],
                'parent_code' => $account['parent'],
                'line_type' => $isSubtotal ? 'subtotal' : 'account',
                'sign' => self::sign($row[$colSign] ?? null),
                'level' => $account['level'],
                'amount' => round($amount, 2),
                'pct_gross' => SheetHelper::parsePct($row[$colPct] ?? null),
                'sort_order' => $sort++,
            ];
        }

        return ['valid' => $valid, 'errors' => $errors, 'totalRows' => $dataRows, 'meta' => $meta];
    }

    /** Mês/ano de competência a partir do bloco de metadados do topo. */
    private static function meta(array $rows): array
    {
        $month = null;
        $year = null;
        $title = null;

        $limit = min(12, count($rows));
        for ($i = 0; $i < $limit; $i++) {
            $label = SheetHelper::normalizeHeader((string) (($rows[$i][0] ?? '')));
            $value = SheetHelper::clean($rows[$i][1] ?? '');
            if ($value === '') {
                continue;
            }
            if ($label === 'relatorio') {
                $title = $value;
            } elseif ($label === 'mes') {
                $month = SheetHelper::monthFromName($value);
            } elseif ($label === 'ano' && preg_match('/(\d{4})/', $value, $m)) {
                $year = (int) $m[1];
            }
        }

        // Fallback: "Dashboard JULHO/2026 - DRE"
        if (($month === null || $year === null) && $title !== null) {
            if (preg_match('#([A-Za-zÇÃÁÉÍÓÚç]+)\s*/\s*(\d{4})#u', $title, $m)) {
                $month ??= SheetHelper::monthFromName($m[1]);
                $year ??= (int) $m[2];
            }
        }

        $refMonth = ($month !== null && $year !== null) ? sprintf('%04d-%02d', $year, $month) : null;

        return [
            'title' => $title,
            'ref_month' => $refMonth,
            'period_start' => $refMonth ? $refMonth . '-01' : null,
            'period_end' => $refMonth ? date('Y-m-t', strtotime($refMonth . '-01')) : null,
        ];
    }

    /** "(+)" => "+", "(-)" => "-", "(=)" => "=", vazio => null. */
    private static function sign(mixed $raw): ?string
    {
        $s = SheetHelper::clean($raw);
        if ($s === '') {
            return null;
        }
        return match (true) {
            str_contains($s, '+') => '+',
            str_contains($s, '-') => '-',
            str_contains($s, '=') => '=',
            default => null,
        };
    }
}
