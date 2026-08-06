<?php

namespace App\Modules\Financeiro\Parsers;

/**
 * Ficha técnica exportada do AllFood.
 *
 * Estrutura em dois níveis na MESMA planilha:
 *   - linha-PAI: CLASSE e ITEM preenchidos, com CUSTO TOTAL e V,VENDA do prato
 *   - linhas-FILHAS: só COMPOSIÇÃO, com UN / QUANTIDADE / C.MÉDIO UNIT / CUSTO TOTAL
 *
 * Cada importação é um SNAPSHOT datado (a data vem de "Emissão:"). Comparar dois
 * snapshots é o que produz a evolução de custo — entre 14/04 e 30/05 o arroz
 * saiu de R$ 5,00 para R$ 13,89/kg e o EXECUTIVO PEQUENO de R$ 2,64 para R$ 7,52.
 */
final class AllfoodFichaParser
{
    private const REQUIRED_HEADERS = ['item', 'composicao'];

    /**
     * @param ?string $snapshotHint data (Y-m-d) vinda do nome do arquivo ou informada
     *                              pelo usuário, usada quando a planilha não traz "Emissão:"
     * @return array{valid:array<int,array>,errors:array<int,array>,totalRows:int,meta:array}
     */
    public static function parse(string $path, ?string $snapshotHint = null): array
    {
        $rows = SheetHelper::rows($path);
        $fromSheet = self::snapshotDate($rows);
        $snapshot = $fromSheet ?? $snapshotHint ?? date('Y-m-d');

        $headerIdx = SheetHelper::findHeaderRow($rows, self::REQUIRED_HEADERS);
        if ($headerIdx === null) {
            return [
                'valid' => [], 'totalRows' => 0, 'meta' => ['snapshot_date' => $snapshot],
                'errors' => [['rowNumber' => 0, 'errors' => ['cabeçalho da ficha técnica não encontrado'], 'raw' => []]],
            ];
        }

        $cols = SheetHelper::columnIndex($rows[$headerIdx]);
        $get = static fn (array $row, string $key) => isset($cols[$key]) ? ($row[$cols[$key]] ?? null) : null;

        $valid = [];
        $errors = [];
        $dataRows = 0;
        $seen = [];
        $current = null;
        $count = count($rows);

        for ($r = $headerIdx + 1; $r < $count; $r++) {
            $row = (array) $rows[$r];
            $rowNumber = $r + 1;
            $item = SheetHelper::clean($get($row, 'item'));
            $composicao = SheetHelper::clean($get($row, 'composicao'));

            if ($item === '' && $composicao === '') {
                continue;
            }
            // Rodapé do relatório: a coluna CLASSE vira "Itens:" e a ITEM, a contagem.
            if (rtrim(SheetHelper::clean($get($row, 'classe')), ':') === 'Itens') {
                continue;
            }
            $dataRows++;

            if ($item !== '') {
                if (isset($seen[mb_strtolower($item)])) {
                    $errors[] = ['rowNumber' => $rowNumber, 'errors' => ["item repetido: {$item}"], 'raw' => []];
                    $current = null;
                    continue;
                }
                $seen[mb_strtolower($item)] = true;
                $valid[] = [
                    'rowNumber' => $rowNumber,
                    'item_name' => $item,
                    'classe' => SheetHelper::cleanOrNull($get($row, 'classe')),
                    'unit' => SheetHelper::cleanOrNull($get($row, 'un')),
                    'cost_total' => SheetHelper::parseMoney($get($row, 'custo_total')) ?? 0.0,
                    'sale_price' => SheetHelper::parseMoney($get($row, 'v_venda')),
                    'components' => [],
                ];
                // As linhas-filhas seguintes pertencem a este item, alcançado por índice.
                $current = array_key_last($valid);
                continue;
            }

            if ($current === null) {
                $errors[] = [
                    'rowNumber' => $rowNumber,
                    'errors' => ["composição \"{$composicao}\" sem item pai"],
                    'raw' => [],
                ];
                continue;
            }

            $valid[$current]['components'][] = [
                'component_name' => $composicao,
                'unit' => SheetHelper::cleanOrNull($get($row, 'un')),
                'quantity' => SheetHelper::parseMoney($get($row, 'quantidade')) ?? 0.0,
                'unit_cost' => SheetHelper::parseMoney($get($row, 'c_medio_unit')),
                'cost_total' => SheetHelper::parseMoney($get($row, 'custo_total')),
            ];
        }

        return [
            'valid' => $valid,
            'errors' => $errors,
            'totalRows' => $dataRows,
            'meta' => [
                'snapshot_date' => $snapshot,
                'snapshot_from_sheet' => $fromSheet !== null,
                'ref_month' => substr($snapshot, 0, 7),
                'period_start' => $snapshot,
                'period_end' => $snapshot,
                'items' => count($valid),
            ],
        ];
    }

    /**
     * Data de "Emissão:". Nem toda exportação traz o bloco de metadados — a de
     * 30/05 começa direto no cabeçalho —, e aí devolve null para o chamador cair
     * na data do nome do arquivo (ou na informada pelo usuário). Sem isso, um
     * arquivo antigo reimportado hoje viraria um snapshot com a data de hoje e
     * estragaria a curva de evolução de custo.
     */
    private static function snapshotDate(array $rows): ?string
    {
        $limit = min(12, count($rows));
        for ($i = 0; $i < $limit; $i++) {
            if (SheetHelper::normalizeHeader((string) (($rows[$i][0] ?? ''))) === 'emissao') {
                $d = SheetHelper::parseDate($rows[$i][1] ?? null);
                if ($d !== null) {
                    return $d;
                }
            }
        }
        return null;
    }

    /** Data no padrão de nome do AllFood: "...Ficha Técni #30-05-2026 13_39_40 #.xlsx". */
    public static function dateFromFilename(string $filename): ?string
    {
        if (preg_match('/#\s*(\d{2})-(\d{2})-(\d{4})/', $filename, $m)) {
            return checkdate((int) $m[2], (int) $m[1], (int) $m[3])
                ? sprintf('%s-%s-%s', $m[3], $m[2], $m[1])
                : null;
        }
        return null;
    }
}
