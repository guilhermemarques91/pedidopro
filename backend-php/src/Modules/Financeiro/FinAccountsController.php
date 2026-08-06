<?php

namespace App\Modules\Financeiro;

use App\Core\Db;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Request;
use PDO;

/**
 * Plano de contas e configurações do módulo.
 *
 * A classificação (bucket do DRE, fixo/variável, entra ou não no DRE gerencial)
 * é o que transforma a planilha crua em análise. Ao editar aqui, a conta recebe
 * `auto_group = 0` e nenhuma reimportação sobrescreve mais a escolha do usuário.
 */
final class FinAccountsController
{
    private const BEHAVIORS = ['fixo', 'variavel', 'nao_classificado'];

    /** Chaves aceitas em fin_settings e seus valores padrão. */
    private const SETTING_DEFAULTS = [
        'target_margin_pct' => 60,
        'tax_rate_pct' => 0,
        // Comissão por canal usada no simulador de margem. Vazio = o sistema usa
        // o take-rate REAL calculado das planilhas das plataformas.
        'channel_commission' => [],
    ];

    public static function index(Request $req): void
    {
        $orgId = $req->orgId();
        $month = self::month($req->query('month'));

        // Com ?month=, só as contas que aparecem naquele mês (a tela fica enxuta).
        // O parâmetro do JOIN vem antes do WHERE na ordem dos placeholders.
        $join = $month !== null
            ? ' JOIN fin_dre_lines l ON l.org_id = a.org_id AND l.account_code = a.code AND l.ref_month = ?'
            : '';
        $params = $month !== null ? [$month, $orgId] : [$orgId];

        $rows = Db::query(
            "SELECT DISTINCT a.code, a.name, a.parent_code, a.level, a.dre_group,
                    a.cost_behavior, a.include_in_dre, a.auto_group
               FROM fin_accounts a{$join}
              WHERE a.org_id = ?
              ORDER BY a.code",
            $params
        );

        foreach ($rows as &$r) {
            $r['include_in_dre'] = (bool) $r['include_in_dre'];
            $r['auto_group'] = (bool) $r['auto_group'];
            $r['group_label'] = AccountClassifier::label($r['dre_group']);
        }

        Http::json([
            'accounts' => $rows,
            'groups' => AccountClassifier::GROUPS,
            'behaviors' => self::BEHAVIORS,
        ]);
    }

    /** Body: { accounts: [{ code, dre_group?, cost_behavior?, include_in_dre? }] } */
    public static function bulkUpdate(Request $req): void
    {
        $items = $req->body['accounts'] ?? null;
        if (!is_array($items) || !$items) {
            throw HttpError::badRequest('Envie "accounts" com as contas a atualizar.');
        }

        $orgId = $req->orgId();
        // Estado atual de todas as contas de uma vez: os campos omitidos no body
        // mantêm o valor gravado, sem uma consulta por linha editada.
        $existing = [];
        foreach (Db::query('SELECT code, dre_group, cost_behavior, include_in_dre FROM fin_accounts WHERE org_id = ?', [$orgId]) as $r) {
            $existing[$r['code']] = $r;
        }

        $updated = Db::transaction(function (PDO $pdo) use ($items, $orgId, $existing) {
            $stmt = $pdo->prepare(
                'UPDATE fin_accounts
                    SET dre_group = ?, cost_behavior = ?, include_in_dre = ?, auto_group = 0
                  WHERE org_id = ? AND code = ?'
            );
            $n = 0;
            foreach ($items as $item) {
                if (!is_array($item) || !isset($item['code']) || !is_string($item['code'])) {
                    continue;
                }
                $row = $existing[$item['code']] ?? null;
                if (!$row) {
                    continue;
                }

                $group = array_key_exists('dre_group', $item) ? $item['dre_group'] : $row['dre_group'];
                if ($group !== null && !isset(AccountClassifier::GROUPS[$group])) {
                    throw HttpError::badRequest("Grupo do DRE inválido: {$group}");
                }
                $behavior = $item['cost_behavior'] ?? $row['cost_behavior'];
                if (!in_array($behavior, self::BEHAVIORS, true)) {
                    throw HttpError::badRequest("Comportamento de custo inválido: {$behavior}");
                }
                $include = array_key_exists('include_in_dre', $item)
                    ? (int) (bool) $item['include_in_dre']
                    : (int) $row['include_in_dre'];

                $stmt->execute([$group, $behavior, $include, $orgId, $item['code']]);
                $n++;
            }
            return $n;
        });

        Http::json(['updated' => $updated]);
    }

    public static function settings(Request $req): void
    {
        Http::json(['settings' => self::load($req->orgId())]);
    }

    public static function updateSettings(Request $req): void
    {
        $body = $req->body['settings'] ?? $req->body;
        if (!is_array($body)) {
            throw HttpError::badRequest('Envie as configurações a salvar.');
        }

        $orgId = $req->orgId();
        Db::transaction(function (PDO $pdo) use ($body, $orgId) {
            $stmt = $pdo->prepare(
                'INSERT INTO fin_settings (org_id, skey, value_json) VALUES (?, ?, ?) AS new
                 ON DUPLICATE KEY UPDATE value_json = new.value_json'
            );
            foreach ($body as $key => $value) {
                if (!array_key_exists($key, self::SETTING_DEFAULTS)) {
                    continue;
                }
                $stmt->execute([$orgId, $key, json_encode($value, JSON_UNESCAPED_UNICODE)]);
            }
        });

        Http::json(['settings' => self::load($orgId)]);
    }

    /** Configurações efetivas (padrão + o que estiver salvo). @return array<string,mixed> */
    public static function load(int $orgId): array
    {
        $out = self::SETTING_DEFAULTS;
        foreach (Db::query('SELECT skey, value_json FROM fin_settings WHERE org_id = ?', [$orgId]) as $r) {
            if (!array_key_exists($r['skey'], $out)) {
                continue;
            }
            $decoded = json_decode((string) $r['value_json'], true);
            if ($decoded !== null) {
                $out[$r['skey']] = $decoded;
            }
        }
        return $out;
    }

    private static function month(?string $raw): ?string
    {
        if ($raw === null) {
            return null;
        }
        if (!preg_match('/^\d{4}-\d{2}$/', $raw)) {
            throw HttpError::badRequest('Mês inválido — use AAAA-MM.');
        }
        return $raw;
    }
}
