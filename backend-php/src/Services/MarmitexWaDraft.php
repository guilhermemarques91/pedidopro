<?php

namespace App\Services;

use App\Core\Db;
use App\Core\Env;
use App\Core\HttpError;
use App\Modules\Marmitex\MarmitexOrderWriter;
use App\Modules\Marmitex\MarmitexResolver;
use PDO;

/**
 * Rascunho do dia: junta o que várias mensagens do grupo pediram e, quando não
 * sobrou dúvida, vira o pedido de verdade.
 *
 * Por que existe um rascunho em vez de gravar direto: as duas empresas pedem de
 * jeitos diferentes — uma manda a lista inteira de manhã, a outra manda pessoa por
 * pessoa até o corte. O rascunho é o "estado do dia até agora", e o pedido é
 * sempre reescrito a partir dele por inteiro (o upsert do Marmitex substitui o dia,
 * não aceita delta). Aplicar duas vezes o mesmo rascunho dá o mesmo resultado.
 *
 * Status das linhas: ok (entra no pedido) · doubt (precisa de gente) ·
 * duplicate (igual a outra já pedida) · cancelled (cancelada no grupo) ·
 * superseded (substituída por uma lista reenviada).
 */
final class MarmitexWaDraft
{
    /** Fila: interpreta as mensagens pendentes. Roda só no worker (a IA é lenta). */
    public static function drain(int $limit): array
    {
        $rows = Db::query(
            "SELECT * FROM marmitex_wa_messages WHERE status = 'pending' ORDER BY id LIMIT " . max(1, $limit)
        );
        $out = ['processed' => 0, 'lines' => 0, 'applied' => 0, 'errors' => 0];
        foreach ($rows as $msg) {
            $r = self::processMessage($msg);
            $out['processed']++;
            $out['lines'] += $r['lines'];
            $out['errors'] += $r['status'] === 'error' ? 1 : 0;
            $out['applied'] += $r['order_id'] ? 1 : 0;
        }
        return $out;
    }

    /**
     * Uma mensagem: IA → resolução → rascunho → (talvez) pedido.
     *
     * @return array{status:string,lines:int,draft_id:?int,order_id:?int}
     */
    public static function processMessage(array $msg): array
    {
        $id = (int) $msg['id'];
        $cfg = Db::queryOne(
            'SELECT w.*, c.name AS company_name, c.order_cutoff_time, c.org_id
               FROM marmitex_wa_configs w JOIN marmitex_companies c ON c.id = w.company_id
              WHERE w.company_id = ?',
            [(int) $msg['company_id']]
        );
        if (!$cfg) {
            Db::execute("UPDATE marmitex_wa_messages SET status = 'ignored', ignore_reason = 'empresa sem configuração de WhatsApp' WHERE id = ?", [$id]);
            return ['status' => 'ignored', 'lines' => 0, 'draft_id' => null, 'order_id' => null];
        }

        Db::execute("UPDATE marmitex_wa_messages SET status = 'parsing', attempts = attempts + 1 WHERE id = ?", [$id]);

        try {
            $lines = MarmitexWaParser::parse($cfg, (string) $msg['body']);
            // `true` = confere o nome contra o elenco da empresa. Aqui o nome foi extraído
            // de texto livre (regra ou IA), então é o único campo que chegaria sem nada
            // conferindo — e nome errado só aparece quando alguém fica sem almoço.
            $resolved = MarmitexResolver::resolve($lines, (int) $cfg['company_id'], MarmitexWaIngest::aliases($cfg), true);
            $draftId = self::mergeMessage($cfg, $msg, $lines, $resolved);
        } catch (\Throwable $e) {
            $attempts = (int) $msg['attempts'] + 1;
            $max = Env::int('MARMITEX_WA_MAX_ATTEMPTS', 3);
            Db::execute(
                'UPDATE marmitex_wa_messages SET status = ?, error = ? WHERE id = ?',
                [$attempts >= $max ? 'error' : 'pending', mb_substr($e->getMessage(), 0, 1000), $id]
            );
            self::log("mensagem {$id} falhou (tentativa {$attempts}/{$max}): " . $e->getMessage());
            return ['status' => 'error', 'lines' => 0, 'draft_id' => null, 'order_id' => null];
        }

        Db::execute(
            "UPDATE marmitex_wa_messages SET status = 'parsed', parsed_at = NOW(), error = NULL, ai_raw = ? WHERE id = ?",
            [json_encode($lines, JSON_UNESCAPED_UNICODE), $id]
        );

        $orderId = self::tryAutoApply($cfg, $draftId);
        return ['status' => 'parsed', 'lines' => count($lines), 'draft_id' => $draftId, 'order_id' => $orderId];
    }

    /**
     * Funde as linhas de UMA mensagem no rascunho do dia.
     *
     * A mensagem é a unidade de contribuição: reprocessá-la apaga as linhas dela
     * antes de reinserir, então reparsear nunca duplica o pedido.
     */
    public static function mergeMessage(array $cfg, array $msg, array $lines, array $resolved): int
    {
        $companyId = (int) $cfg['company_id'];
        // "Almoço dia 04/08/26" manda mais que a data da mensagem: quem envia na
        // véspera estaria lançando no dia errado se fôssemos só pelo carimbo.
        $serviceDate = MarmitexWaParser::serviceDateHint(
            (string) $msg['body'],
            (string) ($msg['service_date'] ?: MarmitexWaIngest::localDate(time()))
        );
        $messageId = (int) $msg['id'];
        $late = self::isLate($cfg, $msg);

        $ownerless = MarmitexWaIngest::ownerlessSizeIds($cfg);

        return Db::transaction(function (PDO $pdo) use ($companyId, $serviceDate, $messageId, $lines, $resolved, $cfg, $late, $ownerless) {
            $pdo->prepare(
                'INSERT INTO marmitex_wa_drafts (company_id, service_date) VALUES (?, ?)
                 ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)'
            )->execute([$companyId, $serviceDate]);
            $draftId = (int) $pdo->lastInsertId();
            $pdo->prepare('SELECT id FROM marmitex_wa_drafts WHERE id = ? FOR UPDATE')->execute([$draftId]);

            // Reprocessamento da mesma mensagem: começa do zero para ela.
            $pdo->prepare('DELETE FROM marmitex_wa_draft_lines WHERE message_id = ?')->execute([$messageId]);

            $adds = array_keys(array_filter($lines, static fn ($l) => ($l['action'] ?? 'add') !== 'cancel'));
            $isFullList = (string) $cfg['mode'] === 'list'
                && (int) $cfg['list_replaces'] === 1
                && count($adds) >= Env::int('MARMITEX_WA_LIST_MIN_LINES', 5);
            if ($isFullList) {
                // Lista completa reenviada (corrigida): o que veio antes não vale mais,
                // senão o dia dobraria de tamanho.
                $pdo->prepare("UPDATE marmitex_wa_draft_lines SET status = 'superseded' WHERE draft_id = ? AND status = 'ok'")
                    ->execute([$draftId]);
            }

            $insert = $pdo->prepare(
                'INSERT INTO marmitex_wa_draft_lines
                    (draft_id, message_id, line_index, raw_text, person_name, size_id, protein_id, protein2_id,
                     side_ids_json, observation, status, issues_json, fingerprint)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            );

            foreach ($lines as $i => $line) {
                $r = $resolved[$i] ?? null;
                if ($r === null) {
                    continue;
                }
                if (($line['action'] ?? 'add') === 'cancel') {
                    self::applyCancel($pdo, $insert, $draftId, $messageId, $i, $line);
                    continue;
                }

                $issues = $r['issues'];
                if ($r['person_name'] === null && $r['size_id'] !== null && in_array((int) $r['size_id'], $ownerless, true)) {
                    // Item declarado como compartilhado (o refrigerante da mesa): a
                    // etiqueta sai no nome da empresa em vez de segurar o dia inteiro.
                    $r['person_name'] = mb_substr((string) $cfg['company_name'], 0, 150);
                }
                if ($r['person_name'] === null) {
                    // Decisão do negócio: toda marmita tem dono (é o que vai na etiqueta).
                    $issues[] = 'sem nome da pessoa';
                }
                $fingerprint = self::fingerprint($r);
                $status = $issues ? 'doubt' : 'ok';
                if ($status === 'ok' && self::hasTwin($pdo, $draftId, $messageId, $fingerprint)) {
                    $status = 'duplicate';
                    $issues[] = 'igual a outra marmita já pedida hoje';
                }

                $insert->execute([
                    $draftId, $messageId, $i,
                    mb_substr((string) ($line['raw'] ?? ''), 0, 500) ?: null,
                    $r['person_name'], $r['size_id'], $r['protein_id'], $r['protein2_id'],
                    json_encode($r['side_ids'], JSON_UNESCAPED_UNICODE),
                    $r['observation'], $status,
                    $issues ? json_encode(array_values($issues), JSON_UNESCAPED_UNICODE) : null,
                    $fingerprint,
                ]);
            }

            // Mensagem nova reabre o rascunho: o operador precisa ver o que mudou.
            $pdo->prepare(
                "UPDATE marmitex_wa_drafts
                    SET status = CASE WHEN status = 'discarded' THEN 'discarded' ELSE 'pending' END,
                        block_reason = NULL,
                        late = GREATEST(late, ?)
                  WHERE id = ?"
            )->execute([$late ? 1 : 0, $draftId]);

            return $draftId;
        });
    }

    /**
     * "Cancela o pedido do João": marca a última linha ativa dessa pessoa como
     * cancelada. Sem correspondência, vira dúvida — cancelar o que não existe é
     * exatamente o caso em que alguém precisa olhar.
     */
    private static function applyCancel(PDO $pdo, \PDOStatement $insert, int $draftId, int $messageId, int $index, array $line): void
    {
        $person = (string) ($line['person_name'] ?? '');
        $target = null;
        if ($person !== '') {
            $st = $pdo->prepare("SELECT id, person_name FROM marmitex_wa_draft_lines WHERE draft_id = ? AND status = 'ok' ORDER BY id DESC");
            $st->execute([$draftId]);
            $norm = MarmitexResolver::norm($person);
            foreach ($st->fetchAll() as $row) {
                if (MarmitexResolver::norm((string) $row['person_name']) === $norm) {
                    $target = (int) $row['id'];
                    break;
                }
            }
        }
        if ($target !== null) {
            $pdo->prepare("UPDATE marmitex_wa_draft_lines SET status = 'cancelled' WHERE id = ?")->execute([$target]);
            return;
        }
        $insert->execute([
            $draftId, $messageId, $index,
            mb_substr((string) ($line['raw'] ?? ''), 0, 500) ?: null,
            $person !== '' ? $person : null, null, null, null, null, null,
            'doubt',
            json_encode(['cancelamento sem pedido correspondente'], JSON_UNESCAPED_UNICODE),
            null,
        ]);
    }

    /**
     * Já existe linha igual vinda de OUTRA mensagem? (dentro da mesma mensagem não
     * conta: "3 marmitas iguais pro João" são três linhas idênticas de propósito.)
     */
    private static function hasTwin(PDO $pdo, int $draftId, int $messageId, ?string $fingerprint): bool
    {
        if ($fingerprint === null) {
            return false;
        }
        $st = $pdo->prepare(
            "SELECT 1 FROM marmitex_wa_draft_lines
              WHERE draft_id = ? AND status = 'ok' AND fingerprint = ?
                AND (message_id IS NULL OR message_id <> ?) LIMIT 1"
        );
        $st->execute([$draftId, $fingerprint, $messageId]);
        return (bool) $st->fetch();
    }

    private static function fingerprint(array $r): ?string
    {
        if ($r['person_name'] === null || $r['size_id'] === null) {
            return null;
        }
        $sides = $r['side_ids'];
        sort($sides);
        return md5(implode('|', [
            MarmitexResolver::norm((string) $r['person_name']),
            (string) $r['size_id'],
            (string) ($r['protein_id'] ?? ''),
            (string) ($r['protein2_id'] ?? ''),
            implode(',', $sides),
            MarmitexResolver::norm((string) ($r['observation'] ?? '')),
        ]));
    }

    private static function isLate(array $cfg, array $msg): bool
    {
        $cutoff = (string) ($cfg['order_cutoff_time'] ?? '');
        if ($cutoff === '') {
            return false;
        }
        $ts = !empty($msg['message_ts']) ? strtotime((string) $msg['message_ts']) : time();
        return MarmitexWaIngest::localTime((int) $ts) > $cutoff;
    }

    // ---- aplicação ----

    /**
     * "Automático com aviso": grava o pedido sozinho apenas quando entendeu tudo.
     * Qualquer dúvida — ou qualquer sinal de que um humano mexeu no dia — para e
     * espera revisão.
     *
     * @return int|null id do pedido, se aplicou
     */
    public static function tryAutoApply(array $cfg, int $draftId): ?int
    {
        if ((int) ($cfg['auto_apply'] ?? 0) !== 1) {
            return null;
        }
        $draft = self::load($draftId);
        if (!$draft || $draft['status'] === 'discarded') {
            return null;
        }
        $counts = self::counts($draftId);
        if ($counts['doubt'] > 0 || $counts['ok'] < 1) {
            return null;
        }
        if ($counts['ok'] > Env::int('MARMITEX_WA_MAX_AUTO_LINES', 60)) {
            self::block($draftId, 'Pedido grande demais para aplicar automaticamente — confira e aplique');
            return null;
        }
        if ((int) $draft['late'] === 1 && (int) ($cfg['auto_apply_after_cutoff'] ?? 0) !== 1) {
            self::block($draftId, 'Mensagem chegou depois do horário de corte — confira e aplique');
            return null;
        }
        // Não passar por cima de trabalho manual: só reescreve o dia se ele estiver
        // vazio ou se quem escreveu foi este mesmo rascunho.
        $order = Db::queryOne(
            'SELECT id, status, source, wa_draft_id FROM marmitex_orders WHERE company_id = ? AND service_date = ?',
            [(int) $draft['company_id'], (string) $draft['service_date']]
        );
        if ($order && !((string) $order['source'] === 'whatsapp' && (int) $order['wa_draft_id'] === $draftId)) {
            self::block($draftId, 'O pedido deste dia foi lançado manualmente — confira antes de substituir');
            return null;
        }

        try {
            return self::apply($draftId, null, true);
        } catch (\Throwable $e) {
            self::block($draftId, mb_substr($e->getMessage(), 0, 255));
            return null;
        }
    }

    /** Grava o rascunho como pedido do dia. Usado pelo automático e pelo botão da tela. */
    public static function apply(int $draftId, ?int $userId, bool $auto = false): int
    {
        $draft = self::load($draftId);
        if (!$draft) {
            throw HttpError::notFound('Rascunho não encontrado');
        }
        $lines = Db::query(
            "SELECT * FROM marmitex_wa_draft_lines WHERE draft_id = ? AND status = 'ok' ORDER BY id",
            [$draftId]
        );
        if (!$lines) {
            throw HttpError::badRequest('Não há marmitas resolvidas neste rascunho');
        }

        $marmitas = [];
        foreach ($lines as $l) {
            $marmitas[] = [
                'person_name' => $l['person_name'],
                'size_id' => (int) $l['size_id'],
                'protein_id' => $l['protein_id'] !== null ? (int) $l['protein_id'] : null,
                'protein2_id' => $l['protein2_id'] !== null ? (int) $l['protein2_id'] : null,
                'side_ids' => $l['side_ids_json'] ? (array) json_decode((string) $l['side_ids_json'], true) : [],
                'observation' => $l['observation'],
            ];
        }

        $orderId = MarmitexOrderWriter::saveDay(
            (int) $draft['company_id'],
            (string) $draft['service_date'],
            $marmitas,
            'Pedido recebido pelo WhatsApp',
            $userId,
            'whatsapp',
            $draftId
        );

        Db::execute(
            "UPDATE marmitex_wa_drafts
                SET status = 'applied', block_reason = NULL, auto_applied = ?, applied_order_id = ?, applied_at = NOW(), applied_by = ?
              WHERE id = ?",
            [$auto ? 1 : 0, $orderId, $userId, $draftId]
        );

        self::confirmInGroup($draftId, count($marmitas));
        return $orderId;
    }

    /** @return array{ok:int,doubt:int,total:int} */
    public static function counts(int $draftId): array
    {
        $row = Db::queryOne(
            "SELECT SUM(status = 'ok') AS ok,
                    SUM(status IN ('doubt', 'duplicate')) AS doubt,
                    COUNT(*) AS total
               FROM marmitex_wa_draft_lines WHERE draft_id = ?",
            [$draftId]
        );
        return [
            'ok' => (int) ($row['ok'] ?? 0),
            'doubt' => (int) ($row['doubt'] ?? 0),
            'total' => (int) ($row['total'] ?? 0),
        ];
    }

    public static function load(int $draftId): ?array
    {
        return Db::queryOne(
            'SELECT d.*, c.name AS company_name, c.org_id
               FROM marmitex_wa_drafts d JOIN marmitex_companies c ON c.id = d.company_id
              WHERE d.id = ?',
            [$draftId]
        );
    }

    private static function block(int $draftId, string $reason): void
    {
        Db::execute(
            "UPDATE marmitex_wa_drafts SET status = 'blocked', block_reason = ? WHERE id = ? AND status <> 'discarded'",
            [$reason, $draftId]
        );
        self::log("rascunho {$draftId} retido: {$reason}");
    }

    /** Confirmação no grupo: é a chance de alguém corrigir a tempo se a leitura saiu errada. */
    private static function confirmInGroup(int $draftId, int $count): void
    {
        $draft = self::load($draftId);
        if (!$draft) {
            return;
        }
        $cfg = Db::queryOne('SELECT group_jid, confirm_reply FROM marmitex_wa_configs WHERE company_id = ?', [(int) $draft['company_id']]);
        if (!$cfg || (int) $cfg['confirm_reply'] !== 1 || !$cfg['group_jid']) {
            return;
        }
        $date = date('d/m/Y', strtotime((string) $draft['service_date']));
        try {
            Evolution::sendMessage((string) $cfg['group_jid'], "✅ Pedido de {$date} registrado: {$count} marmita(s).");
        } catch (\Throwable $e) {
            self::log('confirmação no grupo falhou: ' . $e->getMessage());
        }
    }

    private static function log(string $msg): void
    {
        if (defined('STDERR')) {
            fwrite(STDERR, '[marmitex-wa] ' . $msg . "\n");
        }
    }
}
