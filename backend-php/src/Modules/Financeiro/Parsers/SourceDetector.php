<?php

namespace App\Modules\Financeiro\Parsers;

/**
 * Descobre QUAL relatório é a planilha enviada, olhando o conteúdo — o usuário
 * não precisa escolher a fonte na tela. Os nomes dos arquivos exportados são
 * truncados e cheios de timestamp ("RelatorioDashboard J #06-08-2026 13_53_47 #.xlsx"),
 * então o nome não serve como pista confiável.
 */
final class SourceDetector
{
    public const ALLFOOD_DRE = 'allfood_dre';
    public const ALLFOOD_AP = 'allfood_ap';
    public const ALLFOOD_FICHA = 'allfood_ficha';
    public const NINETYNINE_DAILY = '99food_daily';
    public const IFOOD_QUALITY = 'ifood_quality';
    public const IFOOD_SETTLEMENT = 'ifood_settlement';

    public const LABELS = [
        self::ALLFOOD_DRE => 'AllFood — Dashboard DRE',
        self::ALLFOOD_AP => 'AllFood — Contas a pagar',
        self::ALLFOOD_FICHA => 'AllFood — Ficha técnica',
        self::NINETYNINE_DAILY => '99Food — Dados da loja',
        self::IFOOD_QUALITY => 'iFood — Qualidade da operação',
        self::IFOOD_SETTLEMENT => 'iFood — Extrato financeiro',
    ];

    /** @param array<int,array<int,mixed>> $rows */
    public static function detect(array $rows): ?string
    {
        $head = self::headText($rows, 12);

        // iFood: a célula A1 é literalmente "iFood".
        if (preg_match('/^\s*ifood\s*$/i', SheetHelper::clean($rows[0][0] ?? ''))) {
            return self::hasHeader($rows, ['faturamento', 'comissao'])
                ? self::IFOOD_SETTLEMENT
                : self::IFOOD_QUALITY;
        }

        // 99Food: cabeçalho largo, sem metadados acima.
        if (self::hasHeader($rows, ['nome_do_estabelecimento'])
            && self::hasHeader($rows, ['despesas_de_comissao_da_loja', 'receita_total_de_vendas'], false)) {
            return self::NINETYNINE_DAILY;
        }

        // AllFood: linha 1 = "Relatório: | <nome do relatório>".
        if (str_contains($head, 'relatorio:')) {
            if (str_contains($head, 'dre') || str_contains($head, 'dashboard')) {
                return self::ALLFOOD_DRE;
            }
            if (str_contains($head, 'contas a pagar')) {
                return self::ALLFOOD_AP;
            }
            if (str_contains($head, 'ficha tecnica')) {
                return self::ALLFOOD_FICHA;
            }
        }

        // Fallback pelo próprio cabeçalho, caso o bloco de metadados mude.
        if (self::hasHeader($rows, ['plano_de_contas', 'd_competencia'])) {
            return self::ALLFOOD_AP;
        }
        if (self::hasHeader($rows, ['composicao', 'c_medio_unit'])) {
            return self::ALLFOOD_FICHA;
        }
        if (self::hasHeader($rows, ['conta', 'venda_bruta'], false)) {
            return self::ALLFOOD_DRE;
        }

        return null;
    }

    /** Texto normalizado das primeiras linhas, para casar com o nome do relatório. */
    private static function headText(array $rows, int $lines): string
    {
        $parts = [];
        $limit = min($lines, count($rows));
        for ($i = 0; $i < $limit; $i++) {
            foreach ((array) $rows[$i] as $cell) {
                $v = SheetHelper::clean($cell);
                if ($v !== '') {
                    $parts[] = $v;
                }
            }
        }
        return SheetHelper::stripAccents(mb_strtolower(implode(' | ', $parts)));
    }

    /**
     * Procura colunas nas primeiras linhas.
     * $all = true exige todas; false aceita qualquer uma.
     */
    private static function hasHeader(array $rows, array $needles, bool $all = true): bool
    {
        $limit = min(30, count($rows));
        $found = [];
        for ($i = 0; $i < $limit; $i++) {
            foreach ((array) $rows[$i] as $cell) {
                $norm = SheetHelper::normalizeHeader((string) $cell);
                foreach ($needles as $n) {
                    if ($norm === $n || ($norm !== '' && str_contains($norm, $n))) {
                        $found[$n] = true;
                    }
                }
            }
        }
        return $all ? count($found) === count($needles) : count($found) > 0;
    }
}
