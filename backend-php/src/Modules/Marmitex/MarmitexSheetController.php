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

        // Com a empresa no formulário, a planilha passa a respeitar o contrato
        // (itens ocultos não valem); sem ela, cai no cardápio base como antes.
        $companyId = $req->isCompany()
            ? $req->companyId()
            : (($v = $req->query('company_id') ?? ($req->body['company_id'] ?? null)) ? (int) $v : null);

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
            $col[MarmitexResolver::norm((string) $h)] = $idx;
        }
        $pick = static fn (array $row, string $key) => isset($col[$key]) ? self::clean($row[$col[$key]] ?? '') : '';

        // Coleta as linhas preenchidas guardando o nº da linha na planilha, para o
        // erro apontar a linha certa depois de descartar as vazias.
        $input = [];
        $lineNumbers = [];
        $count = count($rows);
        for ($i = 1; $i < $count; $i++) {
            $row = $rows[$i];
            $cells = [
                'person_name' => $pick($row, 'nome'),
                'size' => $pick($row, 'tamanho'),
                'protein' => $pick($row, 'proteina'),
                'sides' => $pick($row, 'acompanhamentos'),
                'observation' => $pick($row, 'observacao'),
            ];
            if (implode('', $cells) === '') {
                continue; // linha totalmente vazia
            }
            $input[] = $cells;
            $lineNumbers[] = $i + 1;
        }

        $marmitas = [];
        $errors = [];
        foreach (MarmitexResolver::resolve($input, $companyId) as $idx => $r) {
            if ($r['issues']) {
                $errors[] = ['row' => $lineNumbers[$idx], 'messages' => $r['issues']];
                continue;
            }
            $marmitas[] = [
                'person_name' => $r['person_name'],
                'size_id' => $r['size_id'],
                'protein_id' => $r['protein_id'],
                'side_ids' => $r['side_ids'],
                'observation' => $r['observation'],
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

    private static function clean(mixed $v): string
    {
        return $v === null ? '' : trim((string) $v);
    }
}
