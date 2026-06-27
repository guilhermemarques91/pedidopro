<?php

namespace App\Modules\Marmitex;

use App\Core\Db;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Request;
use PhpOffice\PhpSpreadsheet\Cell\DataValidation;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Style\Fill;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;

/**
 * Planilha-modelo (.xlsx) para a empresa lançar o pedido em lote e importação dessa
 * planilha. A importação NÃO salva: devolve as marmitas resolvidas (nome→id) + erros
 * por linha; o salvamento continua passando pelo POST /marmitex/orders (upsert do dia).
 */
final class MarmitexSheetController
{
    /** GET /marmitex/orders/template — baixa o .xlsx modelo com dropdowns do cardápio. */
    public static function template(Request $req): never
    {
        $sizes = Db::query('SELECT name, price FROM marmitex_sizes WHERE active = 1 ORDER BY sort_order, name');
        $proteins = Db::query('SELECT name FROM marmitex_proteins WHERE active = 1 ORDER BY sort_order, name');
        $sides = Db::query('SELECT name FROM marmitex_sides WHERE active = 1 ORDER BY sort_order, name');

        $ss = new Spreadsheet();
        $sheet = $ss->getActiveSheet();
        $sheet->setTitle('Pedido');
        $sheet->fromArray(['Nome', 'Tamanho', 'Proteína', 'Acompanhamentos', 'Observação'], null, 'A1');
        $sheet->getStyle('A1:E1')->getFont()->setBold(true);
        $sheet->getStyle('A1:E1')->getFill()->setFillType(Fill::FILL_SOLID)->getStartColor()->setRGB('D1FAE5');
        foreach (['A' => 22, 'B' => 18, 'C' => 24, 'D' => 34, 'E' => 28] as $col => $w) {
            $sheet->getColumnDimension($col)->setWidth($w);
        }
        $sheet->freezePane('A2');
        $sheet->getComment('D1')->getText()->createTextRun('Separe vários acompanhamentos por vírgula. Veja a aba "Opcoes".');
        $sheet->getComment('B1')->getText()->createTextRun('Escolha um tamanho da lista (aba "Opcoes").');

        // Aba de referência com os valores válidos (também alimenta as listas suspensas).
        $opt = $ss->createSheet();
        $opt->setTitle('Opcoes');
        $opt->fromArray(['Tamanhos', 'Proteínas', 'Acompanhamentos', 'Preços (referência)'], null, 'A1');
        $opt->getStyle('A1:D1')->getFont()->setBold(true);
        foreach (['A' => 22, 'B' => 24, 'C' => 28, 'D' => 28] as $col => $w) {
            $opt->getColumnDimension($col)->setWidth($w);
        }
        $r = 2;
        foreach ($sizes as $s) {
            $opt->setCellValue('A' . $r, $s['name']);
            $opt->setCellValue('D' . $r, $s['name'] . ' — R$ ' . number_format((float) $s['price'], 2, ',', '.'));
            $r++;
        }
        $r = 2;
        foreach ($proteins as $p) {
            $opt->setCellValue('B' . $r, $p['name']);
            $r++;
        }
        $r = 2;
        foreach ($sides as $s) {
            $opt->setCellValue('C' . $r, $s['name']);
            $r++;
        }

        // Listas suspensas (Tamanho e Proteína) nas primeiras 300 linhas.
        if ($sizes) {
            $sheet->setDataValidation('B2:B301', self::listValidation('Opcoes!$A$2:$A$' . (count($sizes) + 1)));
        }
        if ($proteins) {
            $sheet->setDataValidation('C2:C301', self::listValidation('Opcoes!$B$2:$B$' . (count($proteins) + 1)));
        }

        $ss->setActiveSheetIndex(0);

        header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        header('Content-Disposition: attachment; filename="modelo-pedido-marmitex.xlsx"');
        header('Cache-Control: max-age=0');
        (new Xlsx($ss))->save('php://output');
        exit;
    }

    /** POST /marmitex/orders/import — lê a planilha e devolve marmitas resolvidas + erros. */
    public static function import(Request $req): void
    {
        $f = $req->file('file');
        if (!$f) {
            throw HttpError::badRequest('Envie a planilha no campo "file"');
        }

        $sizes = self::indexByName(Db::query('SELECT id, name FROM marmitex_sizes WHERE active = 1'));
        $proteins = self::indexByName(Db::query('SELECT id, name FROM marmitex_proteins WHERE active = 1'));
        $sides = self::indexByName(Db::query('SELECT id, name FROM marmitex_sides WHERE active = 1'));

        try {
            $spreadsheet = IOFactory::load($f['tmp_name']);
        } catch (\Throwable) {
            throw HttpError::badRequest('Não foi possível ler a planilha. Use o modelo em .xlsx.');
        }
        $rows = $spreadsheet->getSheetByName('Pedido')?->toArray(null, true, false, false)
            ?? $spreadsheet->getActiveSheet()->toArray(null, true, false, false);
        if (!$rows) {
            throw HttpError::badRequest('Planilha vazia');
        }

        // Mapeia colunas pelo cabeçalho (tolera acento/maiúsculas e ordem trocada).
        $col = [];
        foreach ($rows[0] as $idx => $h) {
            $col[self::norm((string) $h)] = $idx;
        }
        $pick = static fn (array $row, string $key) => isset($col[$key]) ? self::clean($row[$col[$key]] ?? '') : '';

        $marmitas = [];
        $errors = [];
        $count = count($rows);
        for ($i = 1; $i < $count; $i++) {
            $row = $rows[$i];
            $rowNumber = $i + 1;
            $person = $pick($row, 'nome');
            $sizeName = $pick($row, 'tamanho');
            $proteinName = $pick($row, 'proteina');
            $sidesRaw = $pick($row, 'acompanhamentos');
            $obs = $pick($row, 'observacao');

            // Linha totalmente vazia: ignora.
            if ($person === '' && $sizeName === '' && $proteinName === '' && $sidesRaw === '' && $obs === '') {
                continue;
            }

            $rowErrors = [];
            $size = $sizes[self::norm($sizeName)] ?? null;
            if ($sizeName === '') {
                $rowErrors[] = 'tamanho vazio';
            } elseif (!$size) {
                $rowErrors[] = "tamanho \"{$sizeName}\" não existe no cardápio";
            }

            $proteinId = null;
            if ($proteinName !== '') {
                $protein = $proteins[self::norm($proteinName)] ?? null;
                if (!$protein) {
                    $rowErrors[] = "proteína \"{$proteinName}\" não existe no cardápio";
                } else {
                    $proteinId = (int) $protein['id'];
                }
            }

            $sideIds = [];
            if ($sidesRaw !== '') {
                foreach (preg_split('/[,;]/', $sidesRaw) as $piece) {
                    $name = trim((string) $piece);
                    if ($name === '') {
                        continue;
                    }
                    $side = $sides[self::norm($name)] ?? null;
                    if (!$side) {
                        $rowErrors[] = "acompanhamento \"{$name}\" não existe no cardápio";
                    } else {
                        $sideIds[] = (int) $side['id'];
                    }
                }
            }

            if ($rowErrors) {
                $errors[] = ['row' => $rowNumber, 'messages' => $rowErrors];
                continue;
            }

            $marmitas[] = [
                'person_name' => $person !== '' ? $person : null,
                'size_id' => (int) $size['id'],
                'protein_id' => $proteinId,
                'side_ids' => $sideIds,
                'observation' => $obs !== '' ? $obs : null,
            ];
        }

        Http::json(['marmitas' => $marmitas, 'errors' => $errors, 'imported' => count($marmitas)]);
    }

    // ---- helpers ----

    private static function listValidation(string $formula): DataValidation
    {
        $dv = new DataValidation();
        $dv->setType(DataValidation::TYPE_LIST);
        $dv->setErrorStyle(DataValidation::STYLE_INFORMATION);
        $dv->setAllowBlank(true);
        $dv->setShowDropDown(true);
        $dv->setShowErrorMessage(true);
        $dv->setShowInputMessage(true);
        $dv->setFormula1($formula);
        return $dv;
    }

    /** @param array<int,array{id:int,name:string}> $rows */
    private static function indexByName(array $rows): array
    {
        $out = [];
        foreach ($rows as $r) {
            $out[self::norm($r['name'])] = $r;
        }
        return $out;
    }

    private static function clean(mixed $v): string
    {
        return $v === null ? '' : trim((string) $v);
    }

    /** Baixa caixa, remove acentos e espaços extras — para casar nomes com tolerância. */
    private static function norm(string $s): string
    {
        $s = trim(mb_strtolower($s));
        $map = [
            'á' => 'a', 'à' => 'a', 'â' => 'a', 'ã' => 'a', 'ä' => 'a',
            'é' => 'e', 'è' => 'e', 'ê' => 'e', 'ë' => 'e',
            'í' => 'i', 'ì' => 'i', 'î' => 'i', 'ï' => 'i',
            'ó' => 'o', 'ò' => 'o', 'ô' => 'o', 'õ' => 'o', 'ö' => 'o',
            'ú' => 'u', 'ù' => 'u', 'û' => 'u', 'ü' => 'u',
            'ç' => 'c',
        ];
        $s = strtr($s, $map);
        return preg_replace('/\s+/', ' ', $s);
    }
}
