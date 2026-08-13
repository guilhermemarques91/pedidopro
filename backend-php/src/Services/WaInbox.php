<?php

namespace App\Services;

use App\Core\Db;
use App\Core\Env;
use App\Core\HttpError;

/**
 * Caixa de entrada do WhatsApp: espelho local das conversas da instância.
 *
 * Duas portas de entrada caem em `ingest()`: o webhook da Evolution (tempo real)
 * e `sweep()` (rede de segurança para webhook perdido). Funil único + UNIQUE em
 * `message_key` = mensagem vista pelos dois caminhos não duplica — mesmo desenho
 * do MarmitexWaIngest, que resolve o mesmo problema para os grupos das empresas.
 *
 * Diferença de propósito: lá é uma STAGING que filtra o que parece pedido e joga
 * o resto fora. Aqui é um ESPELHO — guarda tudo, porque a tela é a conversa.
 */
final class WaInbox
{
    /** Tipos que não viram linha de conversa (reação e evento de protocolo). */
    private const NOISE = ['reaction', 'protocol'];

    private const PREVIEW = [
        'image' => '📷 Foto',
        'video' => '🎥 Vídeo',
        'audio' => '🎤 Áudio',
        'document' => '📄 Documento',
        'sticker' => '🌟 Figurinha',
        'location' => '📍 Localização',
        'contact' => '👤 Contato',
        'other' => 'Mensagem',
    ];

    /**
     * A instância da Evolution é UMA (um número de WhatsApp), e o webhook é rota
     * pública — não há usuário logado de quem herdar o tenant. A organização dona
     * do inbox é, portanto, configuração do servidor; 1 é a org padrão do ERP.
     */
    public static function orgId(): int
    {
        return Env::int('WA_INBOX_ORG_ID', 1);
    }

    // ---------------------------------------------------------------- entrada

    /**
     * Grava um registro cru da Evolution. Idempotente.
     *
     * @return string stored | duplicate | ignored
     */
    public static function ingest(array $m, string $source = 'webhook'): string
    {
        $key = trim((string) ($m['key']['id'] ?? ''));
        if ($key === '' || empty($m['key']['remoteJid'])) {
            return 'ignored';
        }
        $kind = Evolution::messageKind($m);
        if (in_array($kind, self::NOISE, true)) {
            return 'ignored';
        }

        $ids = self::resolveJids($m);
        $orgId = self::orgId();
        $fromMe = !empty($m['key']['fromMe']);
        $ts = (int) ($m['messageTimestamp'] ?? 0) ?: time();
        $text = Evolution::messageText($m);
        // `pushName` com fromMe é literalmente "Você" — não serve de nome de contato.
        $pushName = $fromMe ? null : self::str($m['pushName'] ?? null, 150);

        $chatId = self::upsertChat($orgId, $ids, $pushName);

        $stored = Db::execute(
            'INSERT IGNORE INTO wa_messages
                (org_id, chat_id, message_key, from_me, sender_jid, sender_name, type, body, message_ts, payload)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                $orgId,
                $chatId,
                $key,
                $fromMe ? 1 : 0,
                self::str($m['key']['participant'] ?? $m['participant'] ?? null, 80),
                self::str($m['pushName'] ?? null, 150),
                $kind,
                $text !== '' ? $text : null,
                date('Y-m-d H:i:s', $ts),
                json_encode($m, JSON_UNESCAPED_UNICODE),
            ]
        );
        if ($stored === 0) {
            return 'duplicate'; // já tínhamos (webhook e varredura viram a mesma)
        }

        // Tudo aqui depende de a mensagem ser MAIS NOVA que o topo atual da conversa.
        //  - prévia/autor: a varredura reingere mensagens antigas que se perderam, e
        //    elas não podem reescrever o topo.
        //  - não lido: é o que separa "webhook perdido, recuperado agora" (mensagem
        //    nova de verdade → conta) de "histórico sendo espelhado pela primeira
        //    vez" (passado → não conta). Sem essa condição, o primeiro sweep marcaria
        //    meses de conversa como não lida e o contador nasceria com centenas.
        //
        // `last_message_at` é atribuída POR ÚLTIMO de propósito: o MySQL avalia as
        // atribuições de um UPDATE da esquerda para a direita já com os valores
        // novos, então as condições precisam ler o valor ANTIGO antes de ela mudar.
        $when = date('Y-m-d H:i:s', $ts);
        $newer = "? >= COALESCE(last_message_at, '1000-01-01')";
        Db::execute(
            "UPDATE wa_chats
                SET last_preview    = IF({$newer}, ?, last_preview),
                    last_from_me    = IF({$newer}, ?, last_from_me),
                    unread_count    = unread_count + IF({$newer}, ?, 0),
                    last_message_at = GREATEST(COALESCE(last_message_at, '1000-01-01'), ?)
              WHERE id = ?",
            [
                $when, self::preview($kind, $text),
                $when, $fromMe ? 1 : 0,
                $when, $fromMe ? 0 : 1,
                $when, $chatId,
            ]
        );
        return 'stored';
    }

    /**
     * Descobre a identidade canônica da conversa.
     *
     * O WhatsApp endereça o mesmo contato ora pelo número, ora por um LID de
     * privacidade — e na instância real a maioria chega como LID, com o número em
     * `key.remoteJidAlt`. Canonizar no número (quando conhecido) e guardar o LID
     * como apelido é o que impede o contato de virar duas conversas.
     *
     * @return array{jid:string,lid:?string,group:bool}
     */
    public static function resolveJids(array $m): array
    {
        $remote = trim((string) ($m['key']['remoteJid'] ?? ''));
        $alt = trim((string) ($m['key']['remoteJidAlt'] ?? ''));

        if (str_ends_with($remote, '@g.us')) {
            return ['jid' => $remote, 'lid' => null, 'group' => true];
        }
        if (str_ends_with($remote, '@lid')) {
            // Sem o número no `alt`, o LID vira a chave — e migra para o número
            // assim que uma mensagem futura revelar qual é (ver upsertChat).
            return ['jid' => str_ends_with($alt, '@s.whatsapp.net') ? $alt : $remote, 'lid' => $remote, 'group' => false];
        }
        return ['jid' => $remote, 'lid' => str_ends_with($alt, '@lid') ? $alt : null, 'group' => false];
    }

    /** @param array{jid:string,lid:?string,group:bool} $ids */
    private static function upsertChat(int $orgId, array $ids, ?string $name): int
    {
        $row = Db::queryOne(
            'SELECT id, remote_jid, lid_jid, name FROM wa_chats
              WHERE org_id = ? AND (remote_jid = ? OR (lid_jid IS NOT NULL AND lid_jid = ?))
              LIMIT 1',
            [$orgId, $ids['jid'], $ids['lid'] ?? '-']
        );

        if ($row === null) {
            Db::execute(
                'INSERT INTO wa_chats (org_id, remote_jid, lid_jid, name, is_group)
                 VALUES (?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)',
                // Grupo nasce SEM nome: o `pushName` aqui é de quem falou, e o grupo
                // ficaria chamado "Fulano" até a varredura buscar o nome de verdade.
                [$orgId, $ids['jid'], $ids['lid'], $ids['group'] ? null : $name, $ids['group'] ? 1 : 0]
            );
            return Db::lastInsertId();
        }

        $id = (int) $row['id'];
        $sets = [];
        $params = [];
        // A conversa nasceu só com o LID e agora sabemos o número: promove a chave.
        if (str_ends_with((string) $row['remote_jid'], '@lid') && !str_ends_with($ids['jid'], '@lid')) {
            $sets[] = 'remote_jid = ?';
            $params[] = $ids['jid'];
        }
        if ($ids['lid'] !== null && empty($row['lid_jid'])) {
            $sets[] = 'lid_jid = ?';
            $params[] = $ids['lid'];
        }
        // Grupo tem nome próprio (vem de groupNames()); o pushName aqui é do
        // participante que falou e sobrescreveria o nome do grupo por quem digitou.
        if ($name !== null && !$ids['group'] && $name !== ($row['name'] ?? null)) {
            $sets[] = 'name = ?';
            $params[] = $name;
        }
        if ($sets !== []) {
            $params[] = $id;
            Db::execute('UPDATE wa_chats SET ' . implode(', ', $sets) . ' WHERE id = ?', $params);
        }
        return $id;
    }

    // ------------------------------------------------------------------ leitura

    /** @return array<int,array<string,mixed>> */
    public static function chats(int $orgId, int $limit = 100): array
    {
        return Db::query(
            'SELECT id, remote_jid, name, is_group, last_message_at, last_preview,
                    last_from_me, unread_count
               FROM wa_chats
              WHERE org_id = ? AND archived = 0 AND last_message_at IS NOT NULL
              ORDER BY pinned DESC, last_message_at DESC
              LIMIT ' . max(1, min($limit, 300)),
            [$orgId]
        );
    }

    /**
     * Mensagens da conversa, mais antigas primeiro (ordem de leitura na tela).
     * `before` pagina para trás ao rolar para cima.
     *
     * @return array<int,array<string,mixed>>
     */
    public static function messages(int $orgId, int $chatId, ?int $before, int $limit = 60): array
    {
        $params = [$orgId, $chatId];
        $cursor = '';
        if ($before !== null && $before > 0) {
            $cursor = ' AND id < ?';
            $params[] = $before;
        }
        $rows = Db::query(
            'SELECT id, message_key, from_me, sender_name, type, body, message_ts
               FROM wa_messages
              WHERE org_id = ? AND chat_id = ?' . $cursor . '
              ORDER BY id DESC
              LIMIT ' . max(1, min($limit, 200)),
            $params
        );
        return array_reverse($rows);
    }

    /**
     * Resposta do polling curto. Uma consulta só, pelo índice (org_id, id):
     * é o endpoint mais chamado do sistema (a cada poucos segundos, o dia todo).
     *
     * @return array{lastId:int,unreadTotal:int,changed:array<int,array<string,mixed>>}
     */
    public static function updates(int $orgId, int $sinceId): array
    {
        $last = (int) (Db::queryOne('SELECT COALESCE(MAX(id), 0) AS v FROM wa_messages WHERE org_id = ?', [$orgId])['v'] ?? 0);
        $unread = (int) (Db::queryOne('SELECT COALESCE(SUM(unread_count), 0) AS v FROM wa_chats WHERE org_id = ? AND archived = 0', [$orgId])['v'] ?? 0);

        $changed = [];
        if ($sinceId > 0 && $last > $sinceId) {
            $changed = Db::query(
                'SELECT c.id, c.name, c.remote_jid, c.is_group, c.unread_count,
                        c.last_preview, c.last_message_at, COUNT(*) AS novas
                   FROM wa_messages m
                   JOIN wa_chats c ON c.id = m.chat_id
                  WHERE m.org_id = ? AND m.id > ? AND m.from_me = 0
                  GROUP BY c.id
                  ORDER BY c.last_message_at DESC',
                [$orgId, $sinceId]
            );
        }
        return ['lastId' => $last, 'unreadTotal' => $unread, 'changed' => $changed];
    }

    public static function chat(int $orgId, int $chatId): array
    {
        $row = Db::queryOne('SELECT * FROM wa_chats WHERE org_id = ? AND id = ?', [$orgId, $chatId]);
        if ($row === null) {
            throw HttpError::notFound('Conversa não encontrada');
        }
        return $row;
    }

    // ------------------------------------------------------------------ escrita

    /** Zera o não lido local e (best-effort) tira o não lido no celular. */
    public static function markRead(int $orgId, int $chatId): void
    {
        $chat = self::chat($orgId, $chatId);
        Db::execute('UPDATE wa_chats SET unread_count = 0 WHERE id = ?', [$chatId]);

        $pending = Db::query(
            'SELECT message_key FROM wa_messages
              WHERE chat_id = ? AND from_me = 0 ORDER BY id DESC LIMIT 20',
            [$chatId]
        );
        $keys = array_map(
            static fn (array $r) => ['remoteJid' => (string) $chat['remote_jid'], 'fromMe' => false, 'id' => (string) $r['message_key']],
            $pending
        );
        try {
            Evolution::markAsRead($keys);
        } catch (\Throwable) {
            // A leitura na nossa tela já aconteceu; o espelho no celular é bônus.
        }
    }

    /**
     * Envia texto e já grava o eco local, para a mensagem aparecer na hora em vez
     * de esperar o webhook dar a volta.
     *
     * A chave gravada é a que a própria Evolution devolve: a mensagem enviada
     * volta pelo webhook `messages.upsert` com essa mesma chave, e é o UNIQUE de
     * `message_key` que descarta a cópia. Se a Evolution não informar a chave,
     * caímos num `local:*` — aí a mensagem pode duplicar quando o webhook chegar,
     * o que é bem menos ruim do que a mensagem não aparecer ao ser enviada.
     */
    public static function send(int $orgId, int $chatId, string $text): array
    {
        $chat = self::chat($orgId, $chatId);
        $key = Evolution::sendMessage((string) $chat['remote_jid'], $text);

        $now = date('Y-m-d H:i:s');
        $messageKey = $key ?? 'local:' . bin2hex(random_bytes(8));
        $inserted = Db::execute(
            'INSERT IGNORE INTO wa_messages (org_id, chat_id, message_key, from_me, type, body, message_ts)
             VALUES (?, ?, ?, 1, ?, ?, ?)',
            [$orgId, $chatId, $messageKey, 'text', $text, $now]
        );
        // O webhook é rápido e pode ter chegado antes deste INSERT. Aí ele não
        // insere nada, e `lastInsertId()` devolveria o id de outra operação.
        $id = $inserted > 0
            ? Db::lastInsertId()
            : (int) (Db::queryOne('SELECT id FROM wa_messages WHERE message_key = ?', [$messageKey])['id'] ?? 0);
        Db::execute(
            'UPDATE wa_chats SET last_message_at = ?, last_preview = ?, last_from_me = 1, unread_count = 0 WHERE id = ?',
            [$now, self::preview('text', $text), $chatId]
        );
        return ['id' => $id, 'message_ts' => $now];
    }

    // ------------------------------------------------------------- reconciliação

    /**
     * Puxa o histórico da conversa na Evolution. Chamado uma vez, quando a tela
     * abre um chat que ainda não tem passado espelhado.
     *
     * @return array{fetched:int,stored:int}
     */
    public static function backfill(int $orgId, int $chatId, int $limit = 60): array
    {
        $chat = self::chat($orgId, $chatId);
        // Mensagem de chat migrado para LID fica gravada sob o LID na Evolution:
        // consultar pelo número não acha nada.
        $jid = (string) ($chat['lid_jid'] ?: $chat['remote_jid']);
        $records = Evolution::findMessagesPage($jid, $limit);

        $stored = 0;
        foreach ($records as $m) {
            if (self::ingest($m, 'backfill') === 'stored') {
                $stored++;
            }
        }
        // Backfill traz passado, não novidade: o que veio daqui já foi lido.
        Db::execute('UPDATE wa_chats SET unread_count = 0 WHERE id = ?', [$chatId]);
        return ['fetched' => count($records), 'stored' => $stored];
    }

    /**
     * Rede de segurança contra webhook perdido: relê as conversas que a Evolution
     * diz terem mudado depois do que temos espelhado, e reingere.
     *
     * @return array{chats:int,scanned:int,stored:int}
     */
    public static function sweep(int $perChat = 20): array
    {
        $orgId = self::orgId();
        $out = ['chats' => 0, 'scanned' => 0, 'stored' => 0];

        try {
            $chats = Evolution::findChats();
        } catch (\Throwable $e) {
            self::log('findChats falhou: ' . $e->getMessage());
            return $out;
        }

        // Nome de grupo só existe aqui — findChats devolve pushName nulo sempre.
        $groupNames = [];
        try {
            $groupNames = Evolution::groupNames();
        } catch (\Throwable $e) {
            self::log('fetchAllGroups falhou: ' . $e->getMessage());
        }

        foreach ($chats as $c) {
            $jid = trim((string) ($c['remoteJid'] ?? ''));
            if ($jid === '') {
                continue;
            }
            $remoteTs = strtotime((string) ($c['updatedAt'] ?? '')) ?: 0;
            $local = Db::queryOne(
                'SELECT id, last_message_at FROM wa_chats WHERE org_id = ? AND (remote_jid = ? OR lid_jid = ?) LIMIT 1',
                [$orgId, $jid, $jid]
            );
            $localTs = $local && $local['last_message_at'] ? strtotime((string) $local['last_message_at']) : 0;

            // Margem de 60s: `updatedAt` do chat e `messageTimestamp` da mensagem
            // vêm de relógios diferentes e empatam com folga de segundos.
            if ($local !== null && $remoteTs > 0 && $remoteTs <= $localTs + 60) {
                continue; // nada novo desse lado
            }

            $out['chats']++;
            try {
                $records = Evolution::findMessagesPage($jid, $perChat);
            } catch (\Throwable $e) {
                self::log("findMessages falhou para {$jid}: " . $e->getMessage());
                continue;
            }
            $out['scanned'] += count($records);
            foreach ($records as $m) {
                if (self::ingest($m, 'sweep') === 'stored') {
                    $out['stored']++;
                }
            }
        }

        foreach ($groupNames as $jid => $name) {
            Db::execute(
                'UPDATE wa_chats SET name = ?, is_group = 1 WHERE org_id = ? AND remote_jid = ?',
                [mb_substr($name, 0, 150), $orgId, $jid]
            );
        }
        return $out;
    }

    /**
     * Retenção. Espelhar todas as conversas guarda dado pessoal de cliente; o que
     * passou da janela não tem por que continuar aqui.
     */
    public static function purge(?int $days = null): int
    {
        $days = $days ?? Env::int('WA_INBOX_RETENTION_DAYS', 90);
        if ($days <= 0) {
            return 0;
        }
        // `$days` é int vindo do Env — interpolar é seguro e evita a esquisitice de
        // placeholder dentro de INTERVAL.
        return Db::execute('DELETE FROM wa_messages WHERE message_ts < (NOW() - INTERVAL ' . (int) $days . ' DAY)');
    }

    // ------------------------------------------------------------------ helpers

    private static function preview(string $kind, string $text): string
    {
        $s = $text !== '' ? $text : (self::PREVIEW[$kind] ?? 'Mensagem');
        return mb_substr(trim(preg_replace('/\s+/u', ' ', $s) ?? $s), 0, 250);
    }

    private static function str(mixed $v, int $max): ?string
    {
        if ($v === null) {
            return null;
        }
        $s = trim((string) $v);
        return $s === '' ? null : mb_substr($s, 0, $max);
    }

    private static function log(string $msg): void
    {
        if (defined('STDERR')) {
            fwrite(STDERR, '[wa-inbox] ' . $msg . "\n");
        }
    }
}
