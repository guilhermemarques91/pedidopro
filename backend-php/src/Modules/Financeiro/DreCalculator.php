<?php

namespace App\Modules\Financeiro;

use App\Core\Db;

/**
 * Monta o DRE de um mês a partir das linhas importadas.
 *
 * O ponto delicado é que o DRE do AllFood é HIERÁRQUICO: a conta 5 (CUSTOS)
 * já contém 5.01, que já contém 5.01.01. Somar todas as linhas de um grupo
 * contaria o mesmo dinheiro várias vezes.
 *
 * A regra usada aqui é a "raiz do grupo": dentro de cada bucket do DRE, só
 * entram na soma as contas cujo PAI não pertence ao mesmo bucket. Assim
 * `receita_bruta` soma só 3.01.01 (o pai 3.01 é receita líquida), `cmv` soma só
 * 5.01.01, e assim por diante — sem depender de nível fixo nem de lista
 * cravada de códigos.
 *
 * No modo GERENCIAL, as contas marcadas com `include_in_dre = 0` são abatidas do
 * total do próprio grupo. É o que permite tirar do resultado uma conta de
 * trânsito sem mexer no dado importado — no DRE de julho/2026, por exemplo, a
 * conta 3.02.04.01 (recebimento de cartão/PIX lançado como receita financeira)
 * responde por 100,5% da venda bruta e faz o "lucro" superar o faturamento.
 */
final class DreCalculator
{
    /**
     * De onde vem a receita de iFood/99Food:
     *
     *  - planilhas    (padrão): do faturamento diário importado das plataformas,
     *                 pela DATA DA VENDA. É o único modo que respeita competência,
     *                 já que o repasse cai com semanas de atraso.
     *  - recebimentos: da conta de recebimento do DRE (3.02). Regime de CAIXA —
     *                 o repasse de junho que caiu em julho vira receita de julho.
     *  - off:         só o que o DRE registra como venda (balcão/comanda).
     */
    public const PLATFORM_MODES = ['planilhas', 'recebimentos', 'off'];

    /**
     * @return array{
     *   lines:array<int,array>, totals:array<string,float>, groups:array<string,float>,
     *   warnings:array<int,array>, excluded:array<int,string>, platform:array<string,float>
     * }
     */
    public static function build(int $orgId, string $month, bool $managerial): array
    {
        $lines = self::lines($orgId, $month);
        $platform = self::platformMonth($orgId, $month);
        $mode = self::mode($orgId);

        if (!$lines) {
            return [
                'lines' => [], 'totals' => self::emptyTotals(), 'groups' => [],
                'warnings' => [], 'excluded' => [], 'platform' => $platform, 'mode' => $mode,
            ];
        }

        $byCode = [];
        foreach ($lines as $l) {
            $byCode[$l['code']] = $l;
        }

        $groups = self::groupTotals($lines, $byCode, $managerial);
        $totals = self::statement($groups, $platform, $mode);
        $warnings = self::warnings($lines, $byCode, $totals, $managerial, $platform, $mode);

        $excluded = [];
        foreach ($lines as $l) {
            if (!$l['include_in_dre']) {
                $excluded[] = $l['code'];
            }
        }

        return [
            'lines' => $lines,
            'totals' => $totals,
            'groups' => $groups,
            'warnings' => $warnings,
            'excluded' => $excluded,
            'platform' => $platform,
            'mode' => $mode,
        ];
    }

    /**
     * Faturamento das plataformas no mês, das planilhas do iFood/99Food, pela
     * DATA DA VENDA — é o que permite competência, já que o repasse cai depois.
     * @return array<string,float>
     */
    public static function platformMonth(int $orgId, string $month): array
    {
        return PlatformTotals::forMonth($orgId, $month);
    }

    private static function mode(int $orgId): string
    {
        $mode = FinAccountsController::load($orgId)['platform_revenue_mode'] ?? 'planilhas';
        return in_array($mode, self::PLATFORM_MODES, true) ? $mode : 'planilhas';
    }

    /** Linhas do mês com a classificação vigente do plano de contas. */
    public static function lines(int $orgId, string $month): array
    {
        $rows = Db::query(
            'SELECT l.account_code AS code, l.account_name AS name, l.line_type, l.sign, l.level,
                    l.amount, l.pct_gross, l.sort_order,
                    a.parent_code, a.dre_group, a.cost_behavior, a.include_in_dre
               FROM fin_dre_lines l
               LEFT JOIN fin_accounts a ON a.org_id = l.org_id AND a.code = l.account_code
              WHERE l.org_id = ? AND l.ref_month = ?
              ORDER BY l.sort_order',
            [$orgId, $month]
        );

        foreach ($rows as &$r) {
            $r['amount'] = round((float) $r['amount'], 2);
            $r['pct_gross'] = $r['pct_gross'] === null ? null : (float) $r['pct_gross'];
            $r['level'] = (int) $r['level'];
            $r['include_in_dre'] = $r['include_in_dre'] === null ? true : (bool) $r['include_in_dre'];
            $r['group_label'] = AccountClassifier::label($r['dre_group']);
        }
        return $rows;
    }

    /**
     * Total por bucket do DRE somando apenas as "raízes do grupo" e abatendo as
     * contas excluídas (modo gerencial).
     * @return array<string,float>
     */
    private static function groupTotals(array $lines, array $byCode, bool $managerial): array
    {
        return self::rootSum($lines, $byCode, 'dre_group', $managerial);
    }

    /**
     * Buckets de CUSTO que não se sobrepõem entre si. `custos` (conta 5) fica de
     * fora quando os filhos direto/indireto existem, senão o mesmo dinheiro
     * entraria duas vezes — e com comportamentos diferentes, já que o CMV é
     * variável e o custo indireto costuma ser fixo.
     */
    private const COST_GROUPS = [
        'deducoes', 'custo_direto', 'custo_indireto', 'desp_comercial', 'desp_financeira',
        'desp_admin', 'outras_desp_op', 'desp_nao_op', 'imposto',
    ];

    /**
     * Total por comportamento de custo (fixo/variável), base do ponto de
     * equilíbrio.
     *
     * Não dá para reaproveitar a soma por raiz de grupo aqui: a hierarquia do
     * DRE cruza comportamentos (a conta 5 é variável e contém a 5.02, fixa), e
     * somar as duas contaria os custos indiretos duas vezes. Por isso a conta é
     * feita sobre os buckets de custo mutuamente exclusivos, cada um herdando o
     * comportamento da própria conta-raiz — que o usuário pode editar.
     *
     * @return array<string,float>
     */
    public static function behaviorTotals(array $lines, bool $managerial = true): array
    {
        $byCode = [];
        foreach ($lines as $l) {
            $byCode[$l['code']] = $l;
        }

        $groups = self::rootSum($lines, $byCode, 'dre_group', $managerial);
        $hasSplit = isset($groups['custo_direto']) || isset($groups['custo_indireto']);

        // Comportamento de cada bucket = o da conta-raiz dele.
        $behaviorOf = [];
        foreach ($lines as $l) {
            if ($l['line_type'] !== 'account' || $l['dre_group'] === null) {
                continue;
            }
            $parent = $l['parent_code'];
            $isRoot = $parent === null
                || !isset($byCode[$parent])
                || $byCode[$parent]['dre_group'] !== $l['dre_group'];
            if ($isRoot && !isset($behaviorOf[$l['dre_group']])) {
                $behaviorOf[$l['dre_group']] = $l['cost_behavior'] ?? 'nao_classificado';
            }
        }

        $totals = [];
        foreach ($groups as $group => $amount) {
            if (!in_array($group, self::COST_GROUPS, true)) {
                continue; // receitas e o bucket agregado `custos` ficam de fora
            }
            if ($group === 'custos' && $hasSplit) {
                continue;
            }
            $behavior = $behaviorOf[$group] ?? 'nao_classificado';
            $totals[$behavior] = round(($totals[$behavior] ?? 0.0) + $amount, 2);
        }

        // Plano de contas sem a quebra direto/indireto: o total de custos entra inteiro.
        if (!$hasSplit && isset($groups['custos'])) {
            $behavior = $behaviorOf['custos'] ?? 'variavel';
            $totals[$behavior] = round(($totals[$behavior] ?? 0.0) + $groups['custos'], 2);
        }

        return $totals;
    }

    /**
     * Soma as contas por um critério qualquer, contando cada real UMA vez: só
     * entra a conta cujo PAI não cai no mesmo balde (o pai já a contém).
     * @return array<string,float>
     */
    private static function rootSum(array $lines, array $byCode, string $key, bool $managerial): array
    {
        $totals = [];

        foreach ($lines as $l) {
            if ($l['line_type'] !== 'account' || ($l[$key] ?? null) === null) {
                continue;
            }
            $parent = $l['parent_code'];
            $parentInSameBucket = $parent !== null
                && isset($byCode[$parent])
                && ($byCode[$parent][$key] ?? null) === $l[$key];
            if ($parentInSameBucket) {
                continue; // já está contido no total do pai
            }
            $totals[$l[$key]] = ($totals[$l[$key]] ?? 0.0) + $l['amount'];
        }

        if ($managerial) {
            foreach (self::topLevelExclusions($lines, $byCode) as $l) {
                $bucket = $l[$key] ?? null;
                if ($bucket === null) {
                    continue;
                }
                $totals[$bucket] = ($totals[$bucket] ?? 0.0) - $l['amount'];
            }
        }

        foreach ($totals as $k => $v) {
            $totals[$k] = round($v, 2);
        }
        return $totals;
    }

    /**
     * Contas excluídas que NÃO têm um ancestral também excluído — evita abater
     * duas vezes quando o usuário desmarca pai e filho.
     */
    private static function topLevelExclusions(array $lines, array $byCode): array
    {
        $out = [];
        foreach ($lines as $l) {
            if ($l['line_type'] !== 'account' || $l['include_in_dre']) {
                continue;
            }
            $ancestor = $l['parent_code'];
            $hasExcludedAncestor = false;
            while ($ancestor !== null && isset($byCode[$ancestor])) {
                if (!$byCode[$ancestor]['include_in_dre']) {
                    $hasExcludedAncestor = true;
                    break;
                }
                $ancestor = $byCode[$ancestor]['parent_code'];
            }
            if (!$hasExcludedAncestor) {
                $out[] = $l;
            }
        }
        return $out;
    }

    /**
     * Estrutura do demonstrativo a partir dos totais por bucket. Os subtotais são
     * RECALCULADOS aqui (e não lidos das linhas "(=)" do arquivo) — é isso que
     * faz o modo gerencial refletir as exclusões.
     * @return array<string,float>
     */
    private static function statement(array $g, array $platform, string $mode): array
    {
        $get = static fn (string $k): float => round($g[$k] ?? 0.0, 2);

        // O AllFood registra só balcão/comanda; o faturamento de iFood e 99Food
        // entra por fora, das planilhas das plataformas.
        $receitaDre = $get('receita_bruta');
        $recebimentos = $get('recebimentos');

        // revenue_total = venda de itens + taxa de entrega própria (na entrega
        // própria a taxa é dinheiro da loja; na logística da plataforma, não).
        $receitaPlataformas = match ($mode) {
            'planilhas' => $platform['revenue_total'],
            'recebimentos' => $recebimentos,
            default => 0.0,
        };
        // Comissão/ofertas/taxa só entram como custo no modo 'planilhas': o
        // repasse do modo 'recebimentos' já chega líquido desses descontos.
        $custoPlataformas = $mode === 'planilhas' ? $platform['platform_cost'] : 0.0;

        $receitaBruta = round($receitaDre + $receitaPlataformas, 2);
        $deducoes = $get('deducoes');
        // A receita líquida importada (3.01) é preferida para a parte do DRE;
        // se sumir por exclusão/classificação, o cálculo direto assume.
        $receitaLiquidaDre = isset($g['receita_liquida']) ? $get('receita_liquida') : $receitaDre - $deducoes;
        $receitaLiquida = round($receitaLiquidaDre + $receitaPlataformas, 2);

        $cmv = $get('cmv');
        $custoDireto = $get('custo_direto');
        $custoIndireto = $get('custo_indireto');
        // "custos" (conta 5) já engloba direto + indireto quando existe.
        $custosDre = isset($g['custos']) ? $get('custos') : $custoDireto + $custoIndireto;
        $custos = round($custosDre + $custoPlataformas, 2);

        $lucroBruto = round($receitaLiquida - $custos, 2);

        $despComercial = $get('desp_comercial');
        $despFinanceira = $get('desp_financeira');
        // No modo 'recebimentos' o valor já virou receita acima; somá-lo de novo
        // aqui como receita financeira contaria o mesmo dinheiro duas vezes.
        $recFinanceira = $get('rec_financeira');
        $despAdmin = $get('desp_admin');
        $outrasDesp = $get('outras_desp_op');
        $outrasRec = $get('outras_rec_op');

        $lucroOperacional = round(
            $lucroBruto - $despComercial - $despFinanceira + $recFinanceira
            - $despAdmin - $outrasDesp + $outrasRec,
            2
        );

        $despNaoOp = $get('desp_nao_op');
        $recNaoOp = $get('rec_nao_op');
        $resultadoAntes = round($lucroOperacional - $despNaoOp + $recNaoOp, 2);
        $imposto = $get('imposto');
        $resultadoLiquido = round($resultadoAntes - $imposto, 2);

        $pct = static fn (float $v): ?float => $receitaBruta > 0 ? round($v / $receitaBruta, 6) : null;

        return [
            'receita_dre' => $receitaDre,
            'receita_plataformas' => round($receitaPlataformas, 2),
            'receita_bruta' => $receitaBruta,
            'deducoes' => $deducoes,
            'receita_liquida' => $receitaLiquida,
            'cmv' => $cmv,
            'custo_direto' => $custoDireto,
            'custo_indireto' => $custoIndireto,
            'custo_plataformas' => round($custoPlataformas, 2),
            'custos_dre' => $custosDre,
            'custos' => $custos,
            // Fora do resultado no modo 'planilhas': é caixa entrando, não venda
            // do mês. Fica exposto para conciliar com o extrato bancário.
            'recebimentos' => $recebimentos,
            'lucro_bruto' => $lucroBruto,
            'desp_comercial' => $despComercial,
            'desp_financeira' => $despFinanceira,
            'rec_financeira' => $recFinanceira,
            'desp_admin' => $despAdmin,
            'outras_desp_op' => $outrasDesp,
            'outras_rec_op' => $outrasRec,
            'lucro_operacional' => $lucroOperacional,
            'desp_nao_op' => $despNaoOp,
            'rec_nao_op' => $recNaoOp,
            'resultado_antes_impostos' => $resultadoAntes,
            'imposto' => $imposto,
            'resultado_liquido' => $resultadoLiquido,
            'margem_bruta' => $pct($lucroBruto),
            'margem_operacional' => $pct($lucroOperacional),
            'margem_liquida' => $pct($resultadoLiquido),
            'cmv_pct' => $receitaLiquida > 0 ? round($cmv / $receitaLiquida, 6) : null,
        ];
    }

    /**
     * Inconsistências que valem um aviso na tela. Não alteram nada: só apontam
     * onde o dado importado provavelmente não representa operação.
     */
    private static function warnings(
        array $lines,
        array $byCode,
        array $totals,
        bool $managerial,
        array $platform,
        string $mode
    ): array {
        $out = [];
        $receitaBruta = $totals['receita_bruta'];
        if ($receitaBruta <= 0) {
            return $out;
        }

        // Plataforma faturando sem comissão importada: o relatório de vendas do
        // iFood traz volume, não extrato — o custo dela fica invisível.
        if ($mode === 'planilhas' && !empty($platform['missing_commission'])) {
            $names = implode(', ', array_map(
                static fn ($p) => $p === 'ifood' ? 'iFood' : ($p === '99food' ? '99Food' : $p),
                $platform['missing_commission']
            ));
            $out[] = [
                'code' => null,
                'name' => 'Comissão da plataforma não importada',
                'amount' => 0.0,
                'pct_gross' => 0.0,
                'severity' => 'media',
                'message' => "O faturamento de {$names} entrou, mas a comissão não — o relatório de vendas "
                    . 'traz volume, não extrato financeiro. Enquanto isso, o custo dessa plataforma fica de '
                    . 'fora e a margem aqui está otimista. Importe o extrato de repasse para fechar.',
            ];
        }

        // Mês com DRE mas sem planilha de plataforma: a receita fica só com o
        // balcão e todos os indicadores saem menores do que a realidade.
        if ($mode === 'planilhas' && $platform['revenue_total'] <= 0) {
            $out[] = [
                'code' => null,
                'name' => 'Faturamento das plataformas ausente',
                'amount' => 0.0,
                'pct_gross' => 0.0,
                'severity' => 'alta',
                'message' => 'Este mês tem DRE importado, mas nenhuma planilha de iFood/99Food. '
                    . 'A receita está contando só o balcão — importe "Dados da loja" (99Food) e o '
                    . 'extrato do iFood para o mês fechar.',
            ];
        }

        // CMV baixo demais depois de somar as plataformas costuma significar que
        // o custo do AllFood não cobre os insumos gastos nos pedidos de app.
        if ($mode !== 'off' && $totals['receita_plataformas'] > 0 && $totals['cmv'] > 0) {
            $cmvPct = $totals['cmv_pct'];
            if ($cmvPct !== null && $cmvPct < 0.20) {
                $out[] = [
                    'code' => null,
                    'name' => 'CMV baixo para o faturamento somado',
                    'amount' => $totals['cmv'],
                    'pct_gross' => $cmvPct,
                    'severity' => 'media',
                    'message' => sprintf(
                        'Somando as plataformas, o CMV ficou em %s%% da receita líquida — abaixo dos 28-35%% '
                        . 'típicos de restaurante. Como o AllFood não registra os pedidos de app, o custo dele '
                        . 'pode não incluir os insumos gastos nesses pedidos; nesse caso a margem aqui está '
                        . 'otimista. Confira o CMV contra as compras do mês.',
                        number_format($cmvPct * 100, 1, ',', '.')
                    ),
                ];
            }
        }

        // Receita não operacional do tamanho do faturamento = recebimento
        // (cartão/PIX/empréstimo) lançado como receita, duplicando a venda.
        $suspectGroups = ['rec_financeira', 'rec_nao_op', 'outras_rec_op'];
        $flagged = [];
        foreach ($lines as $l) {
            if ($l['line_type'] !== 'account' || !in_array($l['dre_group'], $suspectGroups, true)) {
                continue;
            }
            // No modo gerencial, o que já foi excluído (na própria conta ou num
            // filho) não é mais problema — avisar de novo seria ruído.
            $effective = $managerial ? self::effectiveAmount($l, $lines, $byCode) : $l['amount'];
            if ($effective < $receitaBruta * 0.5) {
                continue;
            }
            // A mesma quantia aparece em 3.02, 3.02.04 e 3.02.04.01: avisa só na
            // conta mais alta da cadeia.
            $ancestor = $l['parent_code'];
            $ancestorFlagged = false;
            while ($ancestor !== null && isset($byCode[$ancestor])) {
                if (isset($flagged[$ancestor])) {
                    $ancestorFlagged = true;
                    break;
                }
                $ancestor = $byCode[$ancestor]['parent_code'];
            }
            if ($ancestorFlagged) {
                continue;
            }
            $flagged[$l['code']] = true;

            $out[] = [
                'code' => $l['code'],
                'name' => $l['name'],
                'amount' => $effective,
                'pct_gross' => round($effective / $receitaBruta, 4),
                'severity' => 'alta',
                'message' => sprintf(
                    'A conta %s soma %s%% da venda bruta. Receita não operacional desse tamanho costuma ser '
                    . 'recebimento (cartão, PIX, empréstimo) lançado como receita, o que conta a mesma venda duas vezes. '
                    . 'Desmarque "Entra no DRE" em Configurações para tirá-la do DRE gerencial.',
                    $l['code'],
                    number_format($effective / $receitaBruta * 100, 1, ',', '.')
                ),
            ];
        }

        if ($totals['resultado_liquido'] > $receitaBruta) {
            $out[] = [
                'code' => null,
                'name' => 'Resultado maior que a receita',
                'amount' => $totals['resultado_liquido'],
                'pct_gross' => round($totals['resultado_liquido'] / $receitaBruta, 4),
                'severity' => 'alta',
                'message' => $managerial
                    ? 'Mesmo no modo gerencial o resultado do mês ficou acima da receita bruta — ainda há receita lançada em duplicidade.'
                    : 'O resultado do mês ficou acima da receita bruta, o que é impossível numa operação normal. '
                        . 'Veja as contas apontadas acima e use o modo Gerencial.',
            ];
        }

        return $out;
    }

    /**
     * Valor que a conta ainda representa no DRE gerencial: o próprio valor menos
     * o que foi excluído nela ou em qualquer conta abaixo dela. Excluir só a
     * folha 3.02.04.01 zera também o que 3.02 e 3.02.04 representam.
     */
    private static function effectiveAmount(array $line, array $lines, array $byCode): float
    {
        $amount = $line['amount'];
        foreach (self::topLevelExclusions($lines, $byCode) as $ex) {
            if ($ex['code'] === $line['code'] || self::isDescendantOf($ex, $line['code'], $byCode)) {
                $amount -= $ex['amount'];
            }
        }
        return round($amount, 2);
    }

    private static function isDescendantOf(array $node, string $ancestorCode, array $byCode): bool
    {
        $parent = $node['parent_code'];
        while ($parent !== null && isset($byCode[$parent])) {
            if ($parent === $ancestorCode) {
                return true;
            }
            $parent = $byCode[$parent]['parent_code'];
        }
        return false;
    }

    private static function emptyTotals(): array
    {
        return array_fill_keys([
            'receita_dre', 'receita_plataformas', 'receita_bruta', 'deducoes', 'receita_liquida',
            'cmv', 'custo_direto', 'custo_indireto', 'custo_plataformas', 'custos_dre', 'custos',
            'recebimentos', 'lucro_bruto', 'desp_comercial', 'desp_financeira', 'rec_financeira',
            'desp_admin', 'outras_desp_op', 'outras_rec_op', 'lucro_operacional', 'desp_nao_op',
            'rec_nao_op', 'resultado_antes_impostos', 'imposto', 'resultado_liquido',
            'margem_bruta', 'margem_operacional', 'margem_liquida', 'cmv_pct',
        ], 0.0);
    }
}
