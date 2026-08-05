<?php

namespace App\Services;

use App\Core\Db;
use App\Core\Env;
use App\Modules\Marmitex\MarmitexResolver;

/**
 * Porta de entrada das mensagens do grupo de WhatsApp de cada empresa.
 *
 * Dois caminhos chegam AQUI, na mesma função: o webhook da Evolution (tempo real)
 * e a varredura periódica (rede de segurança para webhook perdido). Ter um funil só
 * é o que garante que uma mensagem vista pelos dois caminhos não vire pedido dobrado
 * — a dedup é o UNIQUE de `message_key`.
 *
 * Esta camada NÃO chama IA: ela só decide "isto pode ser pedido?" com um filtro
 * barato e guarda a mensagem crua. Quem paga a IA é o worker (CLI), porque o modelo
 * local roda em CPU e leva minutos — bem mais que o limite do túnel.
 */
final class MarmitexWaIngest
{
    /** Palavras que denunciam um pedido mesmo sem citar item do cardápio. */
    private const ANCHORS = ['marmita', 'marmitex', 'quentinha', 'refeicao', 'pedido', 'almoco', 'cancela', 'cancelar', 'tira'];

    public static function configByGroupJid(string $jid): ?array
    {
        return Db::queryOne(
            'SELECT w.*, c.name AS company_name, c.order_cutoff_time, c.org_id
               FROM marmitex_wa_configs w
               JOIN marmitex_companies c ON c.id = w.company_id
              WHERE w.group_jid = ? AND c.active = 1',
            [$jid]
        );
    }

    /** @return array<int,array<string,mixed>> configs ativas com grupo definido */
    public static function activeConfigs(): array
    {
        return Db::query(
            "SELECT w.*, c.name AS company_name, c.order_cutoff_time, c.org_id
               FROM marmitex_wa_configs w
               JOIN marmitex_companies c ON c.id = w.company_id
              WHERE w.enabled = 1 AND c.active = 1 AND w.group_jid <> ''
              ORDER BY w.company_id"
        );
    }

    /**
     * Grava um registro cru da Evolution na staging. Idempotente.
     *
     * @param array $m registro da Evolution (`key`, `message`, `messageTimestamp`, …)
     * @return string staged | duplicate | ignored
     */
    public static function stageMessage(array $cfg, array $m, string $source): string
    {
        if (!empty($m['key']['fromMe'])) {
            return 'ignored'; // eco do próprio bot/atendente
        }
        $key = (string) ($m['key']['id'] ?? '');
        if ($key === '') {
            return 'ignored';
        }
        $text = Evolution::messageText($m);
        if ($text === '') {
            return 'ignored'; // figurinha, áudio, reação, evento de grupo
        }

        $ts = (int) ($m['messageTimestamp'] ?? 0);
        if ($ts <= 0) {
            $ts = time();
        }
        // Janela: nada anterior à ativação (não importar o histórico do grupo no
        // primeiro dia) nem mais velho que a janela de varredura.
        $enabledAt = !empty($cfg['enabled_at']) ? strtotime((string) $cfg['enabled_at']) : 0;
        $minTs = max($enabledAt, time() - Env::int('MARMITEX_WA_SYNC_HOURS', 14) * 3600);
        if ($ts < $minTs) {
            return 'ignored';
        }

        $ignoreReason = null;
        if (!self::looksLikeOrder($text, $cfg)) {
            $ignoreReason = 'sem termos do cardápio';
        }

        $affected = Db::execute(
            'INSERT IGNORE INTO marmitex_wa_messages
                (company_id, group_jid, message_key, sender_jid, sender_name, body, message_ts,
                 service_date, source, status, ignore_reason, payload)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                (int) $cfg['company_id'],
                (string) $cfg['group_jid'],
                $key,
                self::str($m['key']['participant'] ?? $m['participant'] ?? null, 80),
                self::str($m['pushName'] ?? null, 150),
                $text,
                date('Y-m-d H:i:s', $ts),
                self::localDate($ts),
                $source,
                $ignoreReason ? 'ignored' : 'pending',
                $ignoreReason,
                json_encode($m, JSON_UNESCAPED_UNICODE),
            ]
        );
        if ($affected === 0) {
            return 'duplicate';
        }
        return $ignoreReason ? 'ignored' : 'staged';
    }

    /**
     * Varredura de segurança: relê os grupos das empresas ativas.
     *
     * @return array{groups:int,scanned:int,staged:int,duplicate:int,ignored:int}
     */
    public static function sweep(): array
    {
        $out = ['groups' => 0, 'scanned' => 0, 'staged' => 0, 'duplicate' => 0, 'ignored' => 0];
        foreach (self::activeConfigs() as $cfg) {
            $out['groups']++;
            try {
                $messages = Evolution::fetchMessages((string) $cfg['group_jid']);
            } catch (\Throwable $e) {
                self::log("varredura falhou para {$cfg['group_jid']}: " . $e->getMessage());
                continue;
            }
            $out['scanned'] += count($messages);
            foreach ($messages as $m) {
                $r = self::stageMessage($cfg, $m, 'sweep');
                $out[$r === 'staged' ? 'staged' : ($r === 'duplicate' ? 'duplicate' : 'ignored')]++;
            }
            Db::execute('UPDATE marmitex_wa_configs SET last_sweep_at = NOW() WHERE company_id = ?', [(int) $cfg['company_id']]);
        }
        return $out;
    }

    /**
     * Filtro barato ANTES da IA: a mensagem precisa citar algo do cardápio da
     * empresa, um apelido configurado ou uma palavra-âncora. Sem isso, "bom dia" e
     * combinação de futebol custariam uma chamada de modelo cada.
     */
    public static function looksLikeOrder(string $text, array $cfg): bool
    {
        $norm = MarmitexResolver::norm($text);
        if (mb_strlen($norm) < 3 || mb_strlen($text) > Env::int('MARMITEX_WA_MAX_CHARS', 4000)) {
            return false;
        }
        foreach (self::tokens($cfg) as $t) {
            if ($t === '') {
                continue;
            }
            // Token curto (apelido tipo "P"/"G") só vale como palavra inteira: solto,
            // ele casaria dentro de "Pessoal" e o filtro deixaria passar conversa fiada.
            // Token de 3+ letras vale como prefixo, para pegar plural e flexão
            // ("marmita" → "marmitas", "cancela" → "cancelamento").
            $suffix = mb_strlen($t) >= 3 ? '' : '(?![a-z0-9])';
            if (preg_match('/(?<![a-z0-9])' . preg_quote($t, '/') . $suffix . '/u', $norm)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Tokens de reconhecimento da empresa (primeira palavra de cada item do cardápio
     * efetivo + apelidos + âncoras), em cache por processo — a varredura passa por
     * dezenas de mensagens do mesmo grupo.
     *
     * @return string[]
     */
    private static function tokens(array $cfg): array
    {
        static $cache = [];
        $companyId = (int) $cfg['company_id'];
        if (isset($cache[$companyId])) {
            return $cache[$companyId];
        }
        $tokens = self::ANCHORS;
        foreach (MarmitexResolver::menu($companyId) as $type => $index) {
            if ($type === 'observations') {
                continue; // observação é texto livre demais para servir de gatilho
            }
            foreach (array_keys($index) as $name) {
                $first = explode(' ', $name)[0];
                if (mb_strlen($first) >= 3) {
                    $tokens[] = $first;
                }
            }
        }
        foreach (self::aliases($cfg) as $map) {
            foreach (array_keys($map) as $alias) {
                $tokens[] = MarmitexResolver::norm((string) $alias);
            }
        }
        return $cache[$companyId] = array_values(array_unique($tokens));
    }

    /**
     * Dicionário de apelidos da empresa:
     * {"sizes":{"g":"Grande"},"proteins":{...},"sides":{...},"notes":{"P":"Porção P"}}
     *
     * `notes` é o único que não aponta para o cardápio: é texto livre que vai para a
     * observação. Serve para a abreviação que é recado de cozinha, não item cobrado —
     * sem isso ela sobraria na linha e viraria parte do nome da pessoa.
     *
     * @return array<string,array<string,string>>
     */
    public static function aliases(array $cfg): array
    {
        $raw = $cfg['aliases_json'] ?? null;
        $decoded = is_string($raw) ? json_decode($raw, true) : (is_array($raw) ? $raw : null);
        $out = ['sizes' => [], 'proteins' => [], 'sides' => [], 'notes' => []];
        if (!is_array($decoded)) {
            return $out;
        }
        foreach ($out as $type => $_) {
            if (isset($decoded[$type]) && is_array($decoded[$type])) {
                foreach ($decoded[$type] as $from => $to) {
                    if (is_string($from) && is_string($to) && trim($from) !== '' && trim($to) !== '') {
                        $out[$type][trim($from)] = trim($to);
                    }
                }
            }
        }
        return $out;
    }

    /**
     * Itens do cardápio que a empresa pede para o grupo, não para uma pessoa
     * (refrigerante, sobremesa compartilhada). @return int[] ids de marmitex_sizes
     */
    public static function ownerlessSizeIds(array $cfg): array
    {
        $raw = $cfg['ownerless_size_ids'] ?? null;
        $decoded = is_string($raw) ? json_decode($raw, true) : (is_array($raw) ? $raw : null);
        if (!is_array($decoded)) {
            return [];
        }
        $out = [];
        foreach ($decoded as $id) {
            if ((int) $id > 0) {
                $out[] = (int) $id;
            }
        }
        return array_values(array_unique($out));
    }

    /** Data de atendimento = dia local (o pedido das 8h da manhã é do dia de hoje aqui, não em UTC). */
    public static function localDate(int $ts): string
    {
        $tz = new \DateTimeZone((string) Env::get('APP_TZ', 'America/Sao_Paulo'));
        return (new \DateTimeImmutable('@' . $ts))->setTimezone($tz)->format('Y-m-d');
    }

    /** Hora local HH:MM:SS — usada para comparar com o horário de corte da empresa. */
    public static function localTime(int $ts): string
    {
        $tz = new \DateTimeZone((string) Env::get('APP_TZ', 'America/Sao_Paulo'));
        return (new \DateTimeImmutable('@' . $ts))->setTimezone($tz)->format('H:i:s');
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
            fwrite(STDERR, '[marmitex-wa] ' . $msg . "\n");
        }
    }
}
