<?php

namespace App\Modules\Marmitex;

use App\Core\Db;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Request;
use App\Services\MarmitexWaDraft;
use App\Services\MarmitexWaIngest;

/**
 * Configuração e revisão dos pedidos que chegam pelo grupo de WhatsApp.
 *
 * Nada aqui chama a IA: `simulate` só enfileira a mensagem de teste (o worker
 * interpreta em seguida) e `apply` só grava o rascunho já resolvido. Isso mantém
 * toda rota HTTP em milissegundos, sem esbarrar no limite do túnel.
 */
final class MarmitexWaController
{
    private const MODES = ['list', 'incremental'];

    // ---- configuração por empresa ----

    public static function getConfig(Request $req): void
    {
        $companyId = self::requireCompany($req, $req->intParam('companyId'));
        $cfg = Db::queryOne('SELECT * FROM marmitex_wa_configs WHERE company_id = ?', [$companyId]);
        Http::json($cfg ? self::shapeConfig($cfg) : self::defaultConfig($companyId));
    }

    public static function saveConfig(Request $req): void
    {
        $companyId = self::requireCompany($req, $req->intParam('companyId'));
        $in = $req->input();

        $jid = trim((string) ($in->string('group_jid') ?? ''));
        $enabled = $in->boolean('enabled', false) ? 1 : 0;
        if ($enabled === 1 && $jid === '') {
            throw HttpError::badRequest('Informe o ID do grupo de WhatsApp para ativar a leitura');
        }
        if ($jid !== '' && !str_ends_with($jid, '@g.us')) {
            throw HttpError::badRequest('O ID do grupo termina em "@g.us" (ex.: 120363000000000000@g.us)');
        }
        // O JID é a chave que liga a mensagem à empresa: dois cadastros no mesmo
        // grupo fariam o mesmo pedido cair em duas empresas.
        if ($jid !== '') {
            $clash = Db::queryOne('SELECT company_id FROM marmitex_wa_configs WHERE group_jid = ? AND company_id <> ?', [$jid, $companyId]);
            if ($clash) {
                throw HttpError::badRequest('Este grupo já está vinculado a outra empresa');
            }
        }

        $mode = $in->enum('mode', self::MODES, false, 'incremental');
        $defaultSize = $in->integer('default_size_id');
        if ($defaultSize && !Db::queryOne('SELECT id FROM marmitex_sizes WHERE id = ? AND active = 1', [$defaultSize])) {
            throw HttpError::badRequest('Tamanho padrão inválido');
        }

        $aliases = self::parseAliases($req->body['aliases'] ?? null);
        $existing = Db::queryOne('SELECT enabled, enabled_at FROM marmitex_wa_configs WHERE company_id = ?', [$companyId]);
        // `enabled_at` marca a partir de quando o grupo conta: sem isso, ligar a
        // integração importaria o histórico inteiro da conversa como pedido de hoje.
        $enabledAt = ($enabled === 1 && (!$existing || (int) $existing['enabled'] !== 1))
            ? date('Y-m-d H:i:s')
            : ($existing['enabled_at'] ?? null);

        Db::execute(
            'INSERT INTO marmitex_wa_configs
                (company_id, enabled, group_jid, mode, list_replaces, auto_apply, auto_apply_after_cutoff,
                 confirm_reply, default_size_id, aliases_json, ai_instructions, enabled_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                enabled = VALUES(enabled), group_jid = VALUES(group_jid), mode = VALUES(mode),
                list_replaces = VALUES(list_replaces), auto_apply = VALUES(auto_apply),
                auto_apply_after_cutoff = VALUES(auto_apply_after_cutoff), confirm_reply = VALUES(confirm_reply),
                default_size_id = VALUES(default_size_id), aliases_json = VALUES(aliases_json),
                ai_instructions = VALUES(ai_instructions), enabled_at = VALUES(enabled_at)',
            [
                $companyId, $enabled, $jid, $mode,
                $in->boolean('list_replaces', true) ? 1 : 0,
                $in->boolean('auto_apply', false) ? 1 : 0,
                $in->boolean('auto_apply_after_cutoff', false) ? 1 : 0,
                $in->boolean('confirm_reply', false) ? 1 : 0,
                $defaultSize ?: null,
                $aliases ? json_encode($aliases, JSON_UNESCAPED_UNICODE) : null,
                $in->string('ai_instructions'),
                $enabledAt,
            ]
        );
        Http::json(self::shapeConfig(Db::queryOne('SELECT * FROM marmitex_wa_configs WHERE company_id = ?', [$companyId])));
    }

    // ---- rascunhos ----

    public static function drafts(Request $req): void
    {
        $where = ['c.org_id = ?'];
        $params = [$req->orgId()];
        if ($req->isCompany()) {
            $where[] = 'd.company_id = ?';
            $params[] = self::requireCompany($req, null);
        } elseif ($req->query('company_id')) {
            $where[] = 'd.company_id = ?';
            $params[] = (int) $req->query('company_id');
        }
        $status = $req->query('status');
        if ($status === 'open') {
            $where[] = "d.status IN ('pending', 'blocked')";
        } elseif ($status) {
            $where[] = 'd.status = ?';
            $params[] = $status;
        }
        if ($req->query('date')) {
            $where[] = 'd.service_date = ?';
            $params[] = self::date($req->query('date'));
        }

        Http::json(Db::query(
            'SELECT d.*, c.name AS company_name,
                    SUM(l.status = \'ok\') AS ok_count,
                    SUM(l.status IN (\'doubt\', \'duplicate\')) AS doubt_count,
                    COUNT(l.id) AS line_count
               FROM marmitex_wa_drafts d
               JOIN marmitex_companies c ON c.id = d.company_id
               LEFT JOIN marmitex_wa_draft_lines l ON l.draft_id = d.id
              WHERE ' . implode(' AND ', $where) . '
              GROUP BY d.id, c.name
              ORDER BY d.service_date DESC, c.name
              LIMIT 200',
            $params
        ));
    }

    /** Badge do menu: quantos dias estão esperando alguém olhar. */
    public static function count(Request $req): void
    {
        $where = ["d.status IN ('pending', 'blocked')", 'c.org_id = ?'];
        $params = [$req->orgId()];
        if ($req->isCompany()) {
            $where[] = 'd.company_id = ?';
            $params[] = self::requireCompany($req, null);
        }
        $row = Db::queryOne(
            'SELECT COUNT(*) AS n FROM marmitex_wa_drafts d
               JOIN marmitex_companies c ON c.id = d.company_id
              WHERE ' . implode(' AND ', $where),
            $params
        );
        Http::json(['count' => (int) ($row['n'] ?? 0)]);
    }

    public static function draft(Request $req): void
    {
        $draft = self::loadDraft($req, $req->intParam('id'));
        $lines = Db::query('SELECT * FROM marmitex_wa_draft_lines WHERE draft_id = ? ORDER BY id', [$draft['id']]);
        foreach ($lines as &$l) {
            $l['side_ids'] = $l['side_ids_json'] ? (array) json_decode((string) $l['side_ids_json'], true) : [];
            $l['issues'] = $l['issues_json'] ? (array) json_decode((string) $l['issues_json'], true) : [];
            unset($l['side_ids_json'], $l['issues_json']);
        }
        unset($l);

        $messages = Db::query(
            'SELECT id, sender_name, body, message_ts, source, status, ignore_reason, attempts, error
               FROM marmitex_wa_messages
              WHERE company_id = ? AND service_date = ?
              ORDER BY message_ts, id',
            [$draft['company_id'], $draft['service_date']]
        );

        Http::json($draft + [
            'lines' => $lines,
            'messages' => $messages,
            'counts' => MarmitexWaDraft::counts((int) $draft['id']),
        ]);
    }

    public static function addLine(Request $req): void
    {
        $draft = self::loadDraft($req, $req->intParam('id'));
        $data = self::lineInput($req, (int) $draft['company_id']);
        Db::execute(
            'INSERT INTO marmitex_wa_draft_lines
                (draft_id, message_id, line_index, raw_text, person_name, size_id, protein_id, side_ids_json, observation, status)
             VALUES (?, NULL, 0, NULL, ?, ?, ?, ?, ?, \'ok\')',
            [$draft['id'], $data['person_name'], $data['size_id'], $data['protein_id'],
                json_encode($data['side_ids'], JSON_UNESCAPED_UNICODE), $data['observation']]
        );
        self::reopen((int) $draft['id']);
        Http::json(['id' => Db::lastInsertId()], 201);
    }

    /** Correção manual de uma linha: ao salvar, a dúvida deixa de existir. */
    public static function updateLine(Request $req): void
    {
        $draft = self::loadDraft($req, $req->intParam('id'));
        $line = self::loadLine((int) $draft['id'], $req->intParam('lineId'));
        $data = self::lineInput($req, (int) $draft['company_id']);
        Db::execute(
            "UPDATE marmitex_wa_draft_lines
                SET person_name = ?, size_id = ?, protein_id = ?, side_ids_json = ?, observation = ?,
                    status = 'ok', issues_json = NULL
              WHERE id = ?",
            [$data['person_name'], $data['size_id'], $data['protein_id'],
                json_encode($data['side_ids'], JSON_UNESCAPED_UNICODE), $data['observation'], $line['id']]
        );
        self::reopen((int) $draft['id']);
        Http::json(['ok' => true]);
    }

    public static function removeLine(Request $req): void
    {
        $draft = self::loadDraft($req, $req->intParam('id'));
        $line = self::loadLine((int) $draft['id'], $req->intParam('lineId'));
        Db::execute('DELETE FROM marmitex_wa_draft_lines WHERE id = ?', [$line['id']]);
        self::reopen((int) $draft['id']);
        Http::noContent();
    }

    /** Grava o rascunho como pedido do dia (substitui o pedido atual daquela data). */
    public static function apply(Request $req): void
    {
        $draft = self::loadDraft($req, $req->intParam('id'));
        $orderId = MarmitexWaDraft::apply((int) $draft['id'], $req->userId());
        Http::json(['order_id' => $orderId]);
    }

    public static function discard(Request $req): void
    {
        $draft = self::loadDraft($req, $req->intParam('id'));
        Db::execute("UPDATE marmitex_wa_drafts SET status = 'discarded', block_reason = NULL WHERE id = ?", [$draft['id']]);
        Http::json(['ok' => true]);
    }

    /** Recoloca na fila uma mensagem que estourou as tentativas (ex.: IA fora do ar). */
    public static function retry(Request $req): void
    {
        $id = $req->intParam('id');
        $msg = Db::queryOne(
            'SELECT m.id FROM marmitex_wa_messages m
               JOIN marmitex_companies c ON c.id = m.company_id
              WHERE m.id = ? AND c.org_id = ?',
            [$id, $req->orgId()]
        );
        if (!$msg) {
            throw HttpError::notFound('Mensagem não encontrada');
        }
        Db::execute("UPDATE marmitex_wa_messages SET status = 'pending', attempts = 0, error = NULL WHERE id = ?", [$id]);
        Http::json(['ok' => true]);
    }

    /**
     * POST /marmitex/whatsapp/simulate — enfileira uma mensagem de teste.
     *
     * Não interpreta aqui: a IA local leva minutos. A mensagem entra na fila e o
     * worker a processa na próxima rodada (ou rode `bin/marmitex-wa.php --once`).
     */
    public static function simulate(Request $req): void
    {
        $companyId = self::requireCompany($req, $req->input()->integer('company_id'));
        $text = $req->input()->requireString('text');
        $cfg = Db::queryOne('SELECT * FROM marmitex_wa_configs WHERE company_id = ?', [$companyId]);
        if (!$cfg) {
            throw HttpError::badRequest('Configure o grupo de WhatsApp desta empresa antes de testar');
        }
        $ts = time();
        Db::execute(
            'INSERT INTO marmitex_wa_messages
                (company_id, group_jid, message_key, sender_name, body, message_ts, service_date, source, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$companyId, (string) $cfg['group_jid'], 'sim:' . bin2hex(random_bytes(8)), 'Simulação', $text,
                date('Y-m-d H:i:s', $ts), MarmitexWaIngest::localDate($ts), 'manual', 'pending']
        );
        Http::json(['queued' => true, 'message_id' => Db::lastInsertId()], 201);
    }

    // ---- helpers ----

    private static function requireCompany(Request $req, ?int $requested): int
    {
        if ($req->isCompany()) {
            $cid = $req->companyId();
            if (!$cid || ($requested !== null && $requested !== $cid)) {
                throw HttpError::forbidden('Você não tem acesso a esta empresa');
            }
            return $cid;
        }
        if (!$requested) {
            throw HttpError::badRequest('Informe a empresa (company_id)');
        }
        if (!Db::queryOne('SELECT id FROM marmitex_companies WHERE id = ? AND org_id = ?', [$requested, $req->orgId()])) {
            throw HttpError::notFound('Empresa não encontrada');
        }
        return $requested;
    }

    private static function loadDraft(Request $req, int $id): array
    {
        $draft = Db::queryOne(
            'SELECT d.*, c.name AS company_name, c.order_cutoff_time
               FROM marmitex_wa_drafts d JOIN marmitex_companies c ON c.id = d.company_id
              WHERE d.id = ? AND c.org_id = ?',
            [$id, $req->orgId()]
        );
        if (!$draft) {
            throw HttpError::notFound('Rascunho não encontrado');
        }
        if ($req->isCompany() && (int) $draft['company_id'] !== $req->companyId()) {
            throw HttpError::forbidden('Você não tem acesso a este rascunho');
        }
        return $draft;
    }

    private static function loadLine(int $draftId, int $lineId): array
    {
        $line = Db::queryOne('SELECT * FROM marmitex_wa_draft_lines WHERE id = ? AND draft_id = ?', [$lineId, $draftId]);
        if (!$line) {
            throw HttpError::notFound('Linha não encontrada');
        }
        return $line;
    }

    /** Valida a linha editada contra o cardápio efetivo da empresa. */
    private static function lineInput(Request $req, int $companyId): array
    {
        $in = $req->input();
        $menu = MarmitexResolver::menu($companyId);
        $ids = static function (array $index): array {
            $out = [];
            foreach ($index as $row) {
                $out[(int) $row['id']] = true;
            }
            return $out;
        };
        $sizes = $ids($menu['sizes']);
        $proteins = $ids($menu['proteins']);
        $sides = $ids($menu['sides']);

        $sizeId = $in->integer('size_id');
        if (!$sizeId || !isset($sizes[$sizeId])) {
            throw HttpError::badRequest('Selecione um tamanho válido');
        }
        $proteinId = $in->integer('protein_id') ?: null;
        if ($proteinId !== null && !isset($proteins[$proteinId])) {
            throw HttpError::badRequest('Proteína inválida');
        }
        $sideIds = [];
        foreach ($in->intArray('side_ids') as $sid) {
            if (!isset($sides[$sid])) {
                throw HttpError::badRequest('Acompanhamento inválido');
            }
            $sideIds[] = $sid;
        }
        $person = $in->string('person_name');
        if ($person === null) {
            throw HttpError::badRequest('Informe o nome da pessoa');
        }

        return [
            'person_name' => mb_substr($person, 0, 150),
            'size_id' => $sizeId,
            'protein_id' => $proteinId,
            'side_ids' => array_values(array_unique($sideIds)),
            'observation' => $in->string('observation') ? mb_substr((string) $in->string('observation'), 0, 255) : null,
        ];
    }

    /** Mexer nas linhas tira o rascunho de "bloqueado": o motivo pode ter sido resolvido. */
    private static function reopen(int $draftId): void
    {
        Db::execute(
            "UPDATE marmitex_wa_drafts SET status = 'pending', block_reason = NULL
              WHERE id = ? AND status IN ('blocked', 'discarded')",
            [$draftId]
        );
    }

    private static function shapeConfig(array $cfg): array
    {
        $cfg['aliases'] = self::asObjects(MarmitexWaIngest::aliases($cfg));
        unset($cfg['aliases_json']);
        return $cfg;
    }

    /** Dicionário vazio precisa sair como `{}` (json_encode transformaria `[]` em lista). */
    private static function asObjects(array $aliases): array
    {
        foreach ($aliases as $type => $map) {
            $aliases[$type] = (object) $map;
        }
        return $aliases;
    }

    private static function defaultConfig(int $companyId): array
    {
        return [
            'company_id' => $companyId,
            'enabled' => 0,
            'group_jid' => '',
            'mode' => 'incremental',
            'list_replaces' => 1,
            'auto_apply' => 0,
            'auto_apply_after_cutoff' => 0,
            'confirm_reply' => 0,
            'default_size_id' => null,
            'ai_instructions' => null,
            'enabled_at' => null,
            'last_sweep_at' => null,
            'aliases' => self::asObjects(['sizes' => [], 'proteins' => [], 'sides' => [], 'notes' => []]),
        ];
    }

    /** @return array<string,array<string,string>> */
    private static function parseAliases(mixed $raw): array
    {
        $out = ['sizes' => [], 'proteins' => [], 'sides' => [], 'notes' => []];
        if (!is_array($raw)) {
            return $out;
        }
        foreach (array_keys($out) as $type) {
            foreach ((array) ($raw[$type] ?? []) as $from => $to) {
                $from = trim((string) $from);
                $to = is_string($to) ? trim($to) : '';
                if ($from !== '' && $to !== '') {
                    $out[$type][mb_substr($from, 0, 40)] = mb_substr($to, 0, 120);
                }
            }
        }
        return $out;
    }

    private static function date(string $v): string
    {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $v)) {
            throw HttpError::badRequest('Data inválida (use AAAA-MM-DD)');
        }
        return $v;
    }
}
