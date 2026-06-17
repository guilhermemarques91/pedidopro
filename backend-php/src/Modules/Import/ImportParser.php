<?php

namespace App\Modules\Import;

use PhpOffice\PhpSpreadsheet\IOFactory;

/** Lê e valida a planilha de importação (.xlsx) — porte de import.parser.ts. */
final class ImportParser
{
    private const CANONICAL = [
        'fornecedor', 'categoria', 'item', 'unidade',
        'embalagem_qtd', 'embalagem_unidade', 'preco', 'whatsapp',
    ];

    /** @return array{valid:array<int,array>,errors:array<int,array>,totalRows:int} */
    public static function parse(string $path): array
    {
        $spreadsheet = IOFactory::load($path);
        $rows = $spreadsheet->getActiveSheet()->toArray(null, true, false, false);
        if (!$rows) {
            return ['valid' => [], 'errors' => [], 'totalRows' => 0];
        }

        $headerRow = array_map(fn ($h) => self::normalizeHeader((string) $h), $rows[0]);
        $colIndex = [];
        foreach ($headerRow as $idx => $h) {
            if (in_array($h, self::CANONICAL, true)) {
                $colIndex[$h] = $idx;
            }
        }
        $get = static fn (array $row, string $key) => isset($colIndex[$key]) ? ($row[$colIndex[$key]] ?? '') : '';

        $valid = [];
        $errors = [];
        $count = count($rows);
        for ($r = 1; $r < $count; $r++) {
            $row = $rows[$r];
            $rowNumber = $r + 1;
            $fornecedor = self::clean($get($row, 'fornecedor'));
            $item = self::clean($get($row, 'item'));
            $unidade = self::clean($get($row, 'unidade'));

            $rowErrors = [];
            if ($fornecedor === '') {
                $rowErrors[] = 'fornecedor vazio';
            }
            if ($item === '') {
                $rowErrors[] = 'item vazio';
            }
            if ($unidade === '') {
                $rowErrors[] = 'unidade vazia';
            }
            if ($rowErrors) {
                $allEmpty = $fornecedor === '' && $item === '' && $unidade === '' && self::clean($get($row, 'preco')) === '';
                if (!$allEmpty) {
                    $errors[] = ['rowNumber' => $rowNumber, 'errors' => $rowErrors, 'raw' => compact('fornecedor', 'item', 'unidade')];
                }
                continue;
            }

            $valid[] = [
                'rowNumber' => $rowNumber,
                'fornecedor' => $fornecedor,
                'categoria' => self::clean($get($row, 'categoria')) ?: null,
                'item' => $item,
                'unidade' => $unidade,
                'embalagem_qtd' => self::parseDecimal($get($row, 'embalagem_qtd')),
                'embalagem_unidade' => self::clean($get($row, 'embalagem_unidade')) ?: null,
                'preco' => self::parseDecimal($get($row, 'preco')),
                'whatsapp' => self::cleanPhone($get($row, 'whatsapp')),
            ];
        }

        return ['valid' => $valid, 'errors' => $errors, 'totalRows' => $count - 1];
    }

    public static function parseDecimal(mixed $value): ?float
    {
        if ($value === null || $value === '') {
            return null;
        }
        if (is_int($value) || is_float($value)) {
            return is_finite((float) $value) ? (float) $value : null;
        }
        $s = trim((string) $value);
        if ($s === '') {
            return null;
        }
        if (str_contains($s, ',')) {
            $s = str_replace('.', '', $s);
            $s = str_replace(',', '.', $s);
        }
        $s = preg_replace('/[^0-9.\-]/', '', $s);
        return is_numeric($s) ? (float) $s : null;
    }

    private static function clean(mixed $value): string
    {
        return $value === null ? '' : trim((string) $value);
    }

    private static function cleanPhone(mixed $value): ?string
    {
        $digits = preg_replace('/\D/', '', self::clean($value));
        return $digits !== '' ? $digits : null;
    }

    /** Baixa caixa, remove acentos e troca espaços por _. */
    private static function normalizeHeader(string $h): string
    {
        $h = trim(mb_strtolower($h));
        $map = [
            'á' => 'a', 'à' => 'a', 'â' => 'a', 'ã' => 'a', 'ä' => 'a',
            'é' => 'e', 'è' => 'e', 'ê' => 'e', 'ë' => 'e',
            'í' => 'i', 'ì' => 'i', 'î' => 'i', 'ï' => 'i',
            'ó' => 'o', 'ò' => 'o', 'ô' => 'o', 'õ' => 'o', 'ö' => 'o',
            'ú' => 'u', 'ù' => 'u', 'û' => 'u', 'ü' => 'u',
            'ç' => 'c',
        ];
        $h = strtr($h, $map);
        return preg_replace('/\s+/', '_', $h);
    }
}
