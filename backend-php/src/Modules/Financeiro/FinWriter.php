<?php

namespace App\Modules\Financeiro;

use App\Core\HttpError;
use App\Modules\Financeiro\Parsers\SourceDetector;
use PDO;

/**
 * Persistência das planilhas importadas. Tudo aqui roda DENTRO da transação
 * aberta pelo FinImportController.
 *
 * Estratégias de gravação, por fonte:
 *   - DRE e ficha técnica: APAGA o período/snapshot e regrava. Reimportar o mesmo
 *     mês corrige os números em vez de duplicar linhas.
 *   - Contas a pagar: UPSERT por (ext_id, parcela) — a chave do AllFood —, então
 *     exportações com períodos sobrepostos são idempotentes.
 *   - Plataformas: UPSERT COLUNA A COLUNA com COALESCE. O relatório de qualidade
 *     do iFood e o extrato financeiro descrevem o MESMO dia com campos
 *     diferentes; sem o COALESCE, o segundo import zeraria o que o primeiro trouxe.
 */
final class FinWriter
{
    /** Colunas de fin_platform_daily preenchidas pelos parsers de plataforma. */
    private const PLATFORM_COLUMNS = [
        'orders', 'cancelled_orders', 'gross_revenue', 'avg_ticket', 'offers_cost',
        'commission', 'payment_fee', 'platform_rewards', 'delivery_fee', 'net_revenue',
        'cancelled_value', 'rating', 'prep_time_avg', 'visitors', 'new_customers',
        'returning_customers',
    ];

    /** @return array<string,mixed> estatísticas para a resposta da API */
    public static function write(PDO $pdo, int $orgId, string $source, array $parsed, int $importId): array
    {
        return match ($source) {
            SourceDetector::ALLFOOD_DRE => self::writeDre($pdo, $orgId, $parsed, $importId),
            SourceDetector::ALLFOOD_AP => self::writeExpenses($pdo, $orgId, $parsed, $importId),
            SourceDetector::ALLFOOD_FICHA => self::writeFicha($pdo, $orgId, $parsed, $importId),
            SourceDetector::NINETYNINE_DAILY,
            SourceDetector::IFOOD_QUALITY,
            SourceDetector::IFOOD_SETTLEMENT => self::writePlatform($pdo, $orgId, $parsed, $importId),
            default => throw HttpError::badRequest("Fonte não suportada: {$source}"),
        };
    }

    // ---- DRE ----

    private static function writeDre(PDO $pdo, int $orgId, array $parsed, int $importId): array
    {
        $refMonth = $parsed['meta']['ref_month'] ?? null;
        if (!$refMonth) {
            throw HttpError::badRequest('Não foi possível identificar o mês de competência do DRE (linhas "Mês:" e "Ano:").');
        }

        $pdo->prepare('DELETE FROM fin_dre_lines WHERE org_id = ? AND ref_month = ?')
            ->execute([$orgId, $refMonth]);

        $ins = $pdo->prepare(
            'INSERT INTO fin_dre_lines
               (org_id, import_id, ref_month, account_code, account_name, line_type, sign, level, amount, pct_gross, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );

        $accounts = 0;
        foreach ($parsed['valid'] as $l) {
            $ins->execute([
                $orgId, $importId, $refMonth, $l['account_code'], $l['account_name'],
                $l['line_type'], $l['sign'], $l['level'], $l['amount'], $l['pct_gross'], $l['sort_order'],
            ]);
            if ($l['line_type'] === 'account') {
                self::upsertAccount($pdo, $orgId, $l['account_code'], $l['account_name'], $l['parent_code'], $l['level']);
                $accounts++;
            }
        }

        return ['lines' => count($parsed['valid']), 'accounts' => $accounts, 'ref_month' => $refMonth];
    }

    // ---- Contas a pagar ----

    private static function writeExpenses(PDO $pdo, int $orgId, array $parsed, int $importId): array
    {
        $ins = $pdo->prepare(
            'INSERT INTO fin_expenses
               (org_id, import_id, ext_id, installment, kind, supplier_name, account_code, account_name,
                description, competence_date, amount_original, amount_paid, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) AS new
             ON DUPLICATE KEY UPDATE
               import_id = new.import_id,
               kind = new.kind,
               supplier_name = new.supplier_name,
               account_code = new.account_code,
               account_name = new.account_name,
               description = new.description,
               competence_date = new.competence_date,
               amount_original = new.amount_original,
               amount_paid = new.amount_paid,
               status = new.status'
        );

        $accountsSeen = [];
        foreach ($parsed['valid'] as $e) {
            $ins->execute([
                $orgId, $importId, $e['ext_id'], $e['installment'], $e['kind'], $e['supplier_name'],
                $e['account_code'], $e['account_name'], $e['description'], $e['competence_date'],
                $e['amount_original'], $e['amount_paid'], $e['status'],
            ]);
            if ($e['account_code'] !== null && !isset($accountsSeen[$e['account_code']])) {
                $accountsSeen[$e['account_code']] = true;
                self::upsertAccount(
                    $pdo,
                    $orgId,
                    $e['account_code'],
                    $e['account_name'] ?? $e['account_code'],
                    \App\Modules\Financeiro\Parsers\SheetHelper::parentCode($e['account_code']),
                    substr_count($e['account_code'], '.') + 1
                );
            }
        }

        return ['expenses' => count($parsed['valid']), 'accounts' => count($accountsSeen)];
    }

    // ---- Ficha técnica ----

    private static function writeFicha(PDO $pdo, int $orgId, array $parsed, int $importId): array
    {
        $snapshot = $parsed['meta']['snapshot_date'] ?? null;
        if (!$snapshot) {
            throw HttpError::badRequest('Informe a data do snapshot da ficha técnica.');
        }

        $pdo->prepare('DELETE FROM fin_product_components WHERE org_id = ? AND snapshot_date = ?')
            ->execute([$orgId, $snapshot]);
        $pdo->prepare('DELETE FROM fin_product_costs WHERE org_id = ? AND snapshot_date = ?')
            ->execute([$orgId, $snapshot]);

        $insItem = $pdo->prepare(
            'INSERT INTO fin_product_costs
               (org_id, import_id, snapshot_date, classe, item_name, unit, cost_total, sale_price)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $insComp = $pdo->prepare(
            'INSERT INTO fin_product_components
               (org_id, import_id, snapshot_date, item_name, component_name, component_key, unit, quantity, unit_cost, cost_total)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );

        $components = 0;
        foreach ($parsed['valid'] as $item) {
            $insItem->execute([
                $orgId, $importId, $snapshot, $item['classe'], $item['item_name'],
                $item['unit'], $item['cost_total'], $item['sale_price'],
            ]);
            foreach ($item['components'] as $c) {
                $insComp->execute([
                    $orgId, $importId, $snapshot, $item['item_name'], $c['component_name'],
                    \App\Modules\Financeiro\Parsers\SheetHelper::nameKey($c['component_name']),
                    $c['unit'], $c['quantity'], $c['unit_cost'], $c['cost_total'],
                ]);
                $components++;
            }
        }

        return ['items' => count($parsed['valid']), 'components' => $components, 'snapshot_date' => $snapshot];
    }

    // ---- Plataformas (99Food / iFood) ----

    private static function writePlatform(PDO $pdo, int $orgId, array $parsed, int $importId): array
    {
        $cols = self::PLATFORM_COLUMNS;
        $insertCols = array_merge(['org_id', 'platform', 'stat_date', 'import_id'], $cols, ['extra_json']);
        $placeholders = implode(', ', array_fill(0, count($insertCols), '?'));

        $updates = ['import_id = new.import_id'];
        foreach ($cols as $c) {
            // COALESCE: o relatório que não conhece a coluna manda NULL e o valor
            // já gravado pelo outro relatório do mesmo dia é preservado.
            $updates[] = "{$c} = COALESCE(new.{$c}, fin_platform_daily.{$c})";
        }
        // Os dois relatórios do iFood contribuem chaves diferentes: mescla em vez de trocar.
        $updates[] = "extra_json = JSON_MERGE_PATCH(COALESCE(fin_platform_daily.extra_json, '{}'), COALESCE(new.extra_json, '{}'))";

        $sql = 'INSERT INTO fin_platform_daily (' . implode(', ', $insertCols) . ')'
            . " VALUES ({$placeholders}) AS new"
            . ' ON DUPLICATE KEY UPDATE ' . implode(', ', $updates);
        $ins = $pdo->prepare($sql);

        foreach ($parsed['valid'] as $d) {
            $params = [$orgId, $d['platform'], $d['stat_date'], $importId];
            foreach ($cols as $c) {
                $params[] = $d[$c] ?? null;
            }
            $extra = $d['extra_json'] ?? null;
            $params[] = $extra ? json_encode($extra, JSON_UNESCAPED_UNICODE) : null;
            $ins->execute($params);
        }

        return [
            'days' => count($parsed['valid']),
            'platform' => $parsed['meta']['platform'] ?? null,
        ];
    }

    // ---- Plano de contas ----

    /**
     * Cria/atualiza a conta. A classificação automática só é (re)aplicada enquanto
     * `auto_group = 1`; assim que o usuário edita o grupo na tela, `auto_group`
     * vira 0 e nenhuma reimportação sobrescreve a escolha dele.
     */
    private static function upsertAccount(PDO $pdo, int $orgId, string $code, string $name, ?string $parent, int $level): void
    {
        $group = AccountClassifier::groupFor($code);
        $behavior = AccountClassifier::behaviorFor($group);

        $pdo->prepare(
            'INSERT INTO fin_accounts (org_id, code, name, parent_code, level, dre_group, cost_behavior)
             VALUES (?, ?, ?, ?, ?, ?, ?) AS new
             ON DUPLICATE KEY UPDATE
               name = new.name,
               parent_code = COALESCE(new.parent_code, fin_accounts.parent_code),
               level = new.level,
               dre_group = IF(fin_accounts.auto_group = 1, new.dre_group, fin_accounts.dre_group),
               cost_behavior = IF(fin_accounts.auto_group = 1, new.cost_behavior, fin_accounts.cost_behavior)'
        )->execute([$orgId, $code, $name, $parent, $level, $group, $behavior]);
    }
}
