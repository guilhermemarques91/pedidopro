<?php

namespace App\Modules\Financeiro\Parsers;

/**
 * "Contas a pagar" exportado do AllFood — despesas e compras lançadas no sistema
 * de origem (o PedidoPro só lê e classifica; o lançamento continua lá).
 *
 * Colunas: ID | TIPO | FORNECEDOR NOME FANTASIA | PLANO DE CONTAS |
 *          DESCRIÇÃO DO GASTO | D.COMPETÊNCIA | PARCELA | V,ORIGINAL |
 *          V,QUITADO | STATUS
 *
 * ID + PARCELA é a chave do sistema de origem: exportações com períodos
 * sobrepostos não duplicam o lançamento (ver UNIQUE em fin_expenses).
 */
final class AllfoodApParser
{
    private const REQUIRED_HEADERS = ['plano_de_contas', 'd_competencia'];

    /** @return array{valid:array<int,array>,errors:array<int,array>,totalRows:int,meta:array} */
    public static function parse(string $path): array
    {
        $rows = SheetHelper::rows($path);

        $headerIdx = SheetHelper::findHeaderRow($rows, self::REQUIRED_HEADERS);
        if ($headerIdx === null) {
            return [
                'valid' => [], 'totalRows' => 0, 'meta' => [],
                'errors' => [['rowNumber' => 0, 'errors' => ['cabeçalho do contas a pagar não encontrado'], 'raw' => []]],
            ];
        }

        $cols = SheetHelper::columnIndex($rows[$headerIdx]);
        $get = static fn (array $row, string $key) => isset($cols[$key]) ? ($row[$cols[$key]] ?? null) : null;

        $valid = [];
        $errors = [];
        $dataRows = 0;
        $seen = [];
        $dates = [];
        $count = count($rows);

        for ($r = $headerIdx + 1; $r < $count; $r++) {
            $row = (array) $rows[$r];
            $rowNumber = $r + 1;
            $extId = SheetHelper::clean($get($row, 'id'));
            $description = SheetHelper::clean($get($row, 'descricao_do_gasto'));

            if ($extId === '' && $description === '') {
                continue;
            }
            // Rodapé do relatório ("Itens: 176", totalizadores).
            if (!preg_match('/^\d+$/', $extId)) {
                continue;
            }
            $dataRows++;

            $installment = SheetHelper::clean($get($row, 'parcela'));
            $key = $extId . '|' . $installment;
            if (isset($seen[$key])) {
                $errors[] = [
                    'rowNumber' => $rowNumber,
                    'errors' => ["lançamento repetido no arquivo: {$extId} {$installment}"],
                    'raw' => ['descricao' => $description],
                ];
                continue;
            }
            $seen[$key] = true;

            $account = SheetHelper::splitAccount((string) ($get($row, 'plano_de_contas') ?? ''));
            $competence = SheetHelper::parseDate($get($row, 'd_competencia'));
            if ($competence !== null) {
                $dates[] = $competence;
            }

            $valid[] = [
                'rowNumber' => $rowNumber,
                'ext_id' => $extId,
                'installment' => $installment,
                'kind' => SheetHelper::cleanOrNull($get($row, 'tipo')),
                'supplier_name' => SheetHelper::cleanOrNull($get($row, 'fornecedor_nome_fantasia')),
                'account_code' => $account['code'],
                'account_name' => $account['name'] !== '' ? $account['name'] : null,
                'description' => $description !== '' ? $description : null,
                'competence_date' => $competence,
                'amount_original' => round(SheetHelper::parseMoney($get($row, 'v_original')) ?? 0.0, 2),
                'amount_paid' => round(SheetHelper::parseMoney($get($row, 'v_quitado')) ?? 0.0, 2),
                'status' => SheetHelper::cleanOrNull($get($row, 'status')),
            ];
        }

        sort($dates);

        return [
            'valid' => $valid,
            'errors' => $errors,
            'totalRows' => $dataRows,
            'meta' => [
                'period_start' => $dates[0] ?? null,
                'period_end' => $dates ? end($dates) : null,
                'ref_month' => isset($dates[0]) ? substr($dates[0], 0, 7) : null,
            ],
        ];
    }
}
