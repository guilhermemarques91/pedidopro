<?php

namespace App\Modules\Financeiro;

/**
 * Classificação padrão do plano de contas do AllFood.
 *
 * O código da conta já carrega a semântica (3 = receita, 4 = despesa, 5 = custo,
 * 6 = tributos, 1/2 = patrimonial), então o bucket do DRE e o comportamento do
 * custo saem por PREFIXO MAIS LONGO na importação. É só o ponto de partida: o
 * usuário reclassifica na aba Configurações e a escolha dele nunca é
 * sobrescrita por uma reimportação (ver `auto_group` em fin_accounts).
 */
final class AccountClassifier
{
    /** Buckets do DRE, na ordem em que aparecem no demonstrativo. */
    public const GROUPS = [
        'receita_bruta' => 'Receita bruta de vendas',
        'deducoes' => 'Deduções da receita',
        'receita_liquida' => 'Receita líquida',
        'cmv' => 'CMV',
        'custo_direto' => 'Custos diretos de produção',
        'custo_indireto' => 'Custos indiretos de produção',
        'custos' => 'Custos (total)',
        'desp_comercial' => 'Despesas comerciais',
        'desp_financeira' => 'Despesas financeiras',
        'rec_financeira' => 'Receitas financeiras',
        'desp_admin' => 'Despesas gerais e administrativas',
        'outras_desp_op' => 'Outras despesas operacionais',
        'outras_rec_op' => 'Outras receitas operacionais',
        'desp_nao_op' => 'Despesas não operacionais',
        'rec_nao_op' => 'Receitas não operacionais',
        'imposto' => 'Provisões e tributos',
        'patrimonial' => 'Patrimonial (estoque, compras, ativo)',
    ];

    /** Prefixo => bucket. A busca é do mais específico para o mais genérico. */
    private const PREFIX_MAP = [
        '3.01.01' => 'receita_bruta',
        '3.01.02' => 'deducoes',
        '3.01' => 'receita_liquida',
        '3.02' => 'rec_financeira',
        '3.03' => 'outras_rec_op',
        '3.04' => 'rec_nao_op',
        '5.01.01' => 'cmv',
        '5.01' => 'custo_direto',
        '5.02' => 'custo_indireto',
        '5' => 'custos',
        '4.01' => 'desp_comercial',
        '4.02' => 'desp_financeira',
        '4.03' => 'desp_admin',
        '4.04' => 'outras_desp_op',
        '4.05' => 'desp_nao_op',
        '6' => 'imposto',
        '1' => 'patrimonial',
        '2' => 'patrimonial',
    ];

    /**
     * Comportamento do custo por bucket — alimenta o ponto de equilíbrio.
     * Comissão de cartão e CMV variam com a venda; aluguel, folha e contabilidade não.
     */
    private const BEHAVIOR_MAP = [
        'cmv' => 'variavel',
        'custo_direto' => 'variavel',
        'custos' => 'variavel',
        'deducoes' => 'variavel',
        'desp_comercial' => 'variavel',
        'desp_financeira' => 'variavel',
        'custo_indireto' => 'fixo',
        'desp_admin' => 'fixo',
    ];

    /** Buckets que entram como RECEITA no resultado (os demais subtraem). */
    public const POSITIVE_GROUPS = [
        'receita_bruta', 'receita_liquida', 'rec_financeira', 'outras_rec_op', 'rec_nao_op',
    ];

    public static function groupFor(?string $code): ?string
    {
        if ($code === null || $code === '' || $code[0] === '@') {
            return null;
        }
        $best = null;
        $bestLen = -1;
        foreach (self::PREFIX_MAP as $prefix => $group) {
            // Chaves como '5' e '1' viram INT no array do PHP — sem o cast, o
            // `===` abaixo falha e as contas de 1 dígito ficam sem grupo.
            $prefix = (string) $prefix;
            if (($code === $prefix || str_starts_with($code, $prefix . '.')) && strlen($prefix) > $bestLen) {
                $best = $group;
                $bestLen = strlen($prefix);
            }
        }
        return $best;
    }

    public static function behaviorFor(?string $group): string
    {
        return self::BEHAVIOR_MAP[$group] ?? 'nao_classificado';
    }

    public static function isPositive(?string $group): bool
    {
        return in_array($group, self::POSITIVE_GROUPS, true);
    }

    public static function label(?string $group): string
    {
        return self::GROUPS[$group] ?? 'Não classificado';
    }
}
