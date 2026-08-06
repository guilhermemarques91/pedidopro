<?php

namespace App\Modules\Financeiro\Parsers;

use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Worksheet\Worksheet;

/**
 * Utilitários compartilhados pelos parsers do módulo Financeiro.
 *
 * As planilhas vêm de três origens (AllFood, 99Food, iFood) e nenhuma tem o
 * cabeçalho numa linha fixa — todas trazem linhas de metadados acima, em
 * quantidade que varia entre exportações do MESMO relatório (a Ficha Técnica de
 * 14/04 tem o cabeçalho na linha 10; a de 30/05, na linha 2). Por isso o
 * cabeçalho é sempre localizado por busca, nunca assumido.
 *
 * Formatos numéricos também variam: o AllFood grava números nativos, o 99Food
 * grava TUDO como texto em pt-BR ("1.014,5", "11,11%") e o iFood grava números
 * nativos com percentuais já em fração (0.0909 = 9,09%).
 */
final class SheetHelper
{
    /** Quantos espaços de indentação o AllFood usa por nível na coluna CONTA. */
    private const INDENT_PER_LEVEL = 5;

    private const MONTHS_PT = [
        'JANEIRO' => 1, 'FEVEREIRO' => 2, 'MARCO' => 3, 'ABRIL' => 4,
        'MAIO' => 5, 'JUNHO' => 6, 'JULHO' => 7, 'AGOSTO' => 8,
        'SETEMBRO' => 9, 'OUTUBRO' => 10, 'NOVEMBRO' => 11, 'DEZEMBRO' => 12,
    ];

    /**
     * Carrega a planilha e devolve as linhas da primeira aba com conteúdo.
     * formatData = false para receber os valores crus (sem máscara do Excel).
     * @return array<int,array<int,mixed>>
     */
    public static function rows(string $path): array
    {
        $spreadsheet = IOFactory::load($path);
        return self::findSheet($spreadsheet)->toArray(null, true, false, false);
    }

    public static function findSheet(Spreadsheet $spreadsheet): Worksheet
    {
        foreach ($spreadsheet->getAllSheets() as $sheet) {
            if ($sheet->getHighestRow() > 1) {
                return $sheet;
            }
        }
        return $spreadsheet->getActiveSheet();
    }

    /**
     * Acha a linha de cabeçalho procurando as colunas obrigatórias (já normalizadas)
     * nas primeiras linhas do arquivo.
     * @param array<int,array<int,mixed>> $rows
     * @param string[] $required
     */
    public static function findHeaderRow(array $rows, array $required, int $limit = 30): ?int
    {
        $limit = min($limit, count($rows));
        for ($i = 0; $i < $limit; $i++) {
            if (!is_array($rows[$i])) {
                continue;
            }
            $norm = array_map(static fn ($h) => self::normalizeHeader((string) $h), $rows[$i]);
            $hasAll = true;
            foreach ($required as $req) {
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

    /**
     * Mapa cabeçalho normalizado => índice da coluna.
     * @param array<int,mixed> $headerRow
     * @return array<string,int>
     */
    public static function columnIndex(array $headerRow): array
    {
        $map = [];
        foreach ($headerRow as $idx => $h) {
            $norm = self::normalizeHeader((string) $h);
            if ($norm !== '' && !isset($map[$norm])) {
                $map[$norm] = $idx;
            }
        }
        return $map;
    }

    /** Baixa caixa, remove acentos e troca pontuação por _. */
    public static function normalizeHeader(string $h): string
    {
        $h = self::stripAccents(mb_strtolower(trim($h)));
        $h = preg_replace('/[^a-z0-9]+/', '_', $h);
        return trim($h, '_');
    }

    public static function clean(mixed $value): string
    {
        return $value === null ? '' : trim((string) $value);
    }

    public static function cleanOrNull(mixed $value): ?string
    {
        $v = self::clean($value);
        return ($v === '' || $v === '***' || $v === '-') ? null : $v;
    }

    /**
     * Número em pt-BR: "1.014,5" => 1014.5, "609,5" => 609.5, "18" => 18.0.
     * Números nativos passam direto. "-" e "" viram null.
     */
    public static function parseMoney(mixed $value): ?float
    {
        if ($value === null) {
            return null;
        }
        if (is_int($value) || is_float($value)) {
            return is_finite((float) $value) ? (float) $value : null;
        }
        $s = trim((string) $value);
        if ($s === '' || $s === '***' || $s === '-') {
            return null;
        }
        // Vírgula presente => separador decimal pt-BR e ponto é milhar.
        if (str_contains($s, ',')) {
            $s = str_replace('.', '', $s);
            $s = str_replace(',', '.', $s);
        }
        $s = preg_replace('/[^0-9.\-]/', '', $s);
        return is_numeric($s) ? (float) $s : null;
    }

    /**
     * Percentual normalizado como FRAÇÃO (0.1111 = 11,11%).
     * "11,11%" (99Food, texto) => 0.1111; 0.0909 (iFood/AllFood, nativo) => 0.0909.
     */
    public static function parsePct(mixed $value): ?float
    {
        if ($value === null) {
            return null;
        }
        if (is_int($value) || is_float($value)) {
            return is_finite((float) $value) ? (float) $value : null;
        }
        $s = trim((string) $value);
        if ($s === '' || $s === '-') {
            return null;
        }
        $hadSymbol = str_contains($s, '%');
        $n = self::parseMoney($s);
        if ($n === null) {
            return null;
        }
        return $hadSymbol ? $n / 100 : $n;
    }

    public static function parseInt(mixed $value): ?int
    {
        $n = self::parseMoney($value);
        return $n === null ? null : (int) round($n);
    }

    /**
     * Data em 'Y-m-d'. Aceita "2026-07-31", "31/07/2026", "31/07" (usa $yearHint),
     * DateTime e serial do Excel. Devolve null se não der pra interpretar.
     */
    public static function parseDate(mixed $value, ?int $yearHint = null): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }
        if ($value instanceof \DateTimeInterface) {
            return $value->format('Y-m-d');
        }
        // Serial do Excel (formatData=false devolve o número cru).
        if (is_int($value) || is_float($value)) {
            $n = (float) $value;
            if ($n > 20000 && $n < 60000) {
                return \PhpOffice\PhpSpreadsheet\Shared\Date::excelToDateTimeObject($n)->format('Y-m-d');
            }
            return null;
        }
        $s = trim((string) $value);
        if ($s === '' || $s === '-') {
            return null;
        }
        // "2026-07-31 00:00:00" ou "2026-07-31"
        if (preg_match('/^(\d{4})-(\d{2})-(\d{2})/', $s, $m)) {
            return self::validDate((int) $m[1], (int) $m[2], (int) $m[3]);
        }
        // "31/07/2026"
        if (preg_match('#^(\d{1,2})/(\d{1,2})/(\d{4})#', $s, $m)) {
            return self::validDate((int) $m[3], (int) $m[2], (int) $m[1]);
        }
        // "31/07" — sem ano (relatório de qualidade do iFood)
        if (preg_match('#^(\d{1,2})/(\d{1,2})$#', $s, $m) && $yearHint !== null) {
            return self::validDate($yearHint, (int) $m[2], (int) $m[1]);
        }
        return null;
    }

    private static function validDate(int $y, int $m, int $d): ?string
    {
        return checkdate($m, $d, $y) ? sprintf('%04d-%02d-%02d', $y, $m, $d) : null;
    }

    /** Nome do mês em português => número (1-12). */
    public static function monthFromName(string $name): ?int
    {
        $key = self::stripAccents(mb_strtoupper(trim($name)));
        return self::MONTHS_PT[$key] ?? null;
    }

    /**
     * Quebra a coluna CONTA do DRE do AllFood.
     * "     3.01.01.01 - VENDA BRUTA DE ITENS" => code 3.01.01.01, nível 2 (5 espaços).
     * "LUCRO BRUTO" (sem código) => code null: é uma linha de subtotal calculada.
     *
     * @return array{code:?string,name:string,level:int,parent:?string}
     */
    public static function splitAccount(string $raw): array
    {
        $indent = strlen($raw) - strlen(ltrim($raw, " \t"));
        $level = intdiv($indent, self::INDENT_PER_LEVEL) + 1;
        $text = trim($raw);

        if (preg_match('/^([0-9][0-9.]*)\s*-\s*(.+)$/u', $text, $m)) {
            $code = rtrim($m[1], '.');
            return [
                'code' => $code,
                'name' => trim($m[2]),
                'level' => $level,
                'parent' => self::parentCode($code),
            ];
        }
        return ['code' => null, 'name' => $text, 'level' => $level, 'parent' => null];
    }

    /** "3.01.01.01" => "3.01.01"; "5" => null. */
    public static function parentCode(string $code): ?string
    {
        $pos = strrpos($code, '.');
        return $pos === false ? null : substr($code, 0, $pos);
    }

    /**
     * Chave de cruzamento para nomes livres vindos das planilhas: maiúsculas,
     * sem acento e com espaços colapsados. O AllFood não padroniza a grafia
     * entre exportações ("Arroz Branco" x "ARROZ BRANCO"), e sem isso o mesmo
     * insumo viraria dois na evolução de custo.
     */
    public static function nameKey(string $s): string
    {
        $s = self::stripAccents(mb_strtoupper(trim($s)));
        return preg_replace('/\s+/', ' ', $s);
    }

    /** Identificador estável para linhas sem código (subtotais do DRE). */
    public static function slug(string $s): string
    {
        $s = self::stripAccents(mb_strtolower(trim($s)));
        $s = preg_replace('/[^a-z0-9]+/', '_', $s);
        return trim($s, '_');
    }

    public static function stripAccents(string $s): string
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
