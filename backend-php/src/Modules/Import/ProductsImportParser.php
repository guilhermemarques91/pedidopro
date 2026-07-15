<?php

namespace App\Modules\Import;

use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Worksheet\Worksheet;

/**
 * Lê o relatório "Lista completa de itens cadastrados" exportado do sistema atual do
 * usuário (AllFood): CÓD. INT. / DESCRIÇÃO INTERNA / TIPO / CLASSE DE ITENS / SUB-CLASSE /
 * UN,VENDA / UN.COMPRA/PROD, / VALOR DE VENDA / CUSTO MÉDIO COMPRA. O cabeçalho não fica
 * numa linha fixa (o relatório tem linhas de metadados acima), então é localizado por busca.
 */
final class ProductsImportParser
{
    private const REQUIRED_HEADERS = ['descricao_interna', 'tipo'];

    /** Eixo fixo "Tipo" do cadastro (mesmo conjunto do frontend) — chave sem acento/maiúscula. */
    private const TIPO_MAP = [
        'ADICIONAL DE COMANDA' => 'Adicional',
        'ADICIONAL' => 'Adicional',
        'MATERIA PRIMA' => 'Matéria-prima',
        'PRODUTO' => 'Produto',
        'MERCADORIA' => 'Mercadoria',
        'ITEM INTERMEDIARIO' => 'Item intermediário',
        'MATERIAL DE USO E CONSUMO' => 'Uso e consumo',
        'USO E CONSUMO' => 'Uso e consumo',
        'COMBO POR ETAPAS' => 'Combo',
        'COMBO' => 'Combo',
        'ATIVO IMOBILIZADO' => 'Ativo imobilizado',
    ];

    /** @return array{valid:array<int,array>,errors:array<int,array>,totalRows:int} */
    public static function parse(string $path): array
    {
        $spreadsheet = IOFactory::load($path);
        $sheet = self::findSheet($spreadsheet);
        $rows = $sheet->toArray(null, true, false, false);

        $headerRowIdx = self::findHeaderRow($rows);
        if ($headerRowIdx === null) {
            return ['valid' => [], 'errors' => [], 'totalRows' => 0];
        }

        $colIndex = [];
        foreach ($rows[$headerRowIdx] as $idx => $h) {
            $norm = self::normalizeHeader((string) $h);
            if ($norm !== '') {
                $colIndex[$norm] = $idx;
            }
        }
        $get = static fn (array $row, string $key) => isset($colIndex[$key]) ? ($row[$colIndex[$key]] ?? null) : null;

        $valid = [];
        $errors = [];
        $dataRows = 0;
        $count = count($rows);
        for ($r = $headerRowIdx + 1; $r < $count; $r++) {
            $row = $rows[$r];
            $rowNumber = $r + 1;
            $codeRaw = self::clean($get($row, 'cod_int'));
            $name = self::clean($get($row, 'descricao_interna'));

            if ($name === '' && $codeRaw === '') {
                continue; // linha em branco (separador)
            }
            if ($codeRaw === 'Itens:') {
                continue; // rodapé do relatório (total de linhas)
            }
            $dataRows++;

            $tipoRaw = self::clean($get($row, 'tipo'));
            $tipo = self::mapTipo($tipoRaw);

            $rowErrors = [];
            if ($name === '') {
                $rowErrors[] = 'descrição vazia';
            }
            if ($tipo === null) {
                $rowErrors[] = "tipo desconhecido: \"{$tipoRaw}\"";
            }
            if ($rowErrors) {
                $errors[] = ['rowNumber' => $rowNumber, 'errors' => $rowErrors, 'raw' => compact('name', 'tipoRaw')];
                continue;
            }

            $valid[] = [
                'rowNumber' => $rowNumber,
                'external_code' => $codeRaw !== '' ? $codeRaw : null,
                'name' => $name,
                'tipo' => $tipo,
                'classe' => self::cleanOrNull($get($row, 'classe_de_itens')),
                'sub_classe' => self::cleanOrNull($get($row, 'sub_classe')),
                'unit' => self::cleanOrNull($get($row, 'un_venda')),
                'purchase_unit' => self::cleanOrNull($get($row, 'un_compra_prod')),
                'sale_price' => self::parsePrice($get($row, 'valor_de_venda')),
                'cost_price' => self::parsePrice($get($row, 'custo_medio_compra')),
            ];
        }

        return ['valid' => $valid, 'errors' => $errors, 'totalRows' => $dataRows];
    }

    private static function findSheet(\PhpOffice\PhpSpreadsheet\Spreadsheet $spreadsheet): Worksheet
    {
        foreach ($spreadsheet->getAllSheets() as $sheet) {
            if ($sheet->getHighestRow() > 1) {
                return $sheet;
            }
        }
        return $spreadsheet->getActiveSheet();
    }

    /** Acha a linha de cabeçalho procurando as colunas obrigatórias nas primeiras linhas. */
    private static function findHeaderRow(array $rows): ?int
    {
        $limit = min(30, count($rows));
        for ($i = 0; $i < $limit; $i++) {
            $norm = array_map(static fn ($h) => self::normalizeHeader((string) $h), $rows[$i]);
            $hasAll = true;
            foreach (self::REQUIRED_HEADERS as $req) {
                if (!in_array($req, $norm, true)) {
                    $hasAll = false;
                    break;
                }
            }
            if ($hasAll) {
                return $i;
            }
        }
        return null;
    }

    private static function mapTipo(string $raw): ?string
    {
        if ($raw === '') {
            return null;
        }
        $key = self::stripAccents(mb_strtoupper($raw));
        return self::TIPO_MAP[$key] ?? null;
    }

    private static function clean(mixed $value): string
    {
        return $value === null ? '' : trim((string) $value);
    }

    private static function cleanOrNull(mixed $value): ?string
    {
        $v = self::clean($value);
        return ($v === '' || $v === '***') ? null : $v;
    }

    private static function parsePrice(mixed $value): ?float
    {
        if ($value === null) {
            return null;
        }
        if (is_int($value) || is_float($value)) {
            return is_finite((float) $value) ? (float) $value : null;
        }
        $s = trim((string) $value);
        if ($s === '' || $s === '***') {
            return null;
        }
        if (str_contains($s, ',')) {
            $s = str_replace('.', '', $s);
            $s = str_replace(',', '.', $s);
        }
        $s = preg_replace('/[^0-9.\-]/', '', $s);
        return is_numeric($s) ? (float) $s : null;
    }

    /** Baixa caixa, remove acentos/pontuação e troca por _. */
    private static function normalizeHeader(string $h): string
    {
        $h = self::stripAccents(mb_strtolower(trim($h)));
        $h = preg_replace('/[^a-z0-9]+/', '_', $h);
        return trim($h, '_');
    }

    private static function stripAccents(string $s): string
    {
        $map = [
            'Á' => 'A', 'À' => 'A', 'Â' => 'A', 'Ã' => 'A', 'Ä' => 'A',
            'É' => 'E', 'È' => 'E', 'Ê' => 'E', 'Ë' => 'E',
            'Í' => 'I', 'Ì' => 'I', 'Î' => 'I', 'Ï' => 'I',
            'Ó' => 'O', 'Ò' => 'O', 'Ô' => 'O', 'Õ' => 'O', 'Ö' => 'O',
            'Ú' => 'U', 'Ù' => 'U', 'Û' => 'U', 'Ü' => 'U',
            'Ç' => 'C',
            'á' => 'a', 'à' => 'a', 'â' => 'a', 'ã' => 'a', 'ä' => 'a',
            'é' => 'e', 'è' => 'e', 'ê' => 'e', 'ë' => 'e',
            'í' => 'i', 'ì' => 'i', 'î' => 'i', 'ï' => 'i',
            'ó' => 'o', 'ò' => 'o', 'ô' => 'o', 'õ' => 'o', 'ö' => 'o',
            'ú' => 'u', 'ù' => 'u', 'û' => 'u', 'ü' => 'u',
            'ç' => 'c',
        ];
        return strtr($s, $map);
    }
}
