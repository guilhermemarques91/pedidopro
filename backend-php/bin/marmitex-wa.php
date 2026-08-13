<?php

/**
 * Worker dos pedidos empresariais recebidos por WhatsApp.
 *
 * O webhook (público) só GRAVA a mensagem crua e responde 200. Quem paga a parte
 * cara — interpretar com a IA local, que roda em CPU e leva minutos — é este
 * processo. É o mesmo arranjo do poller de delivery: um container só, laço próprio,
 * sem cron dentro da imagem.
 *
 * Uso:
 *   php bin/marmitex-wa.php --loop                    laço contínuo (é o do container)
 *   php bin/marmitex-wa.php --once                    uma rodada (varre + interpreta)
 *   php bin/marmitex-wa.php --no-sweep                só interpreta a fila
 *   php bin/marmitex-wa.php --company=1 --text="..."  injeta uma mensagem de teste
 *                                                     e interpreta na hora (sem WhatsApp)
 */

declare(strict_types=1);

use App\Core\Db;
use App\Core\Env;
use App\Services\MarmitexWaDraft;
use App\Services\MarmitexWaIngest;
use App\Services\WaInbox;

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("CLI only\n");
}

$root = dirname(__DIR__);
require $root . '/vendor/autoload.php';
spl_autoload_register(function (string $class) use ($root): void {
    if (str_starts_with($class, 'App\\')) {
        $p = $root . '/src/' . str_replace('\\', '/', substr($class, 4)) . '.php';
        if (is_file($p)) {
            require $p;
        }
    }
});
Env::load($root . '/.env');

$opt = static function (string $name) use ($argv): ?string {
    foreach ($argv as $a) {
        if (str_starts_with($a, "--{$name}=")) {
            return substr($a, strlen($name) + 3);
        }
    }
    return null;
};
$flag = static fn (string $name): bool => in_array("--{$name}", $argv, true);

$stamp = static fn (): string => date('Y-m-d H:i:s');
$say = static function (string $msg) use ($stamp): void {
    echo '[' . $stamp() . "] {$msg}\n";
};

// --- Modo teste: injeta uma mensagem sintética e interpreta na hora ---
$companyOpt = $opt('company');
$textOpt = $opt('text');
if ($companyOpt !== null || $textOpt !== null) {
    if ($companyOpt === null || $textOpt === null || trim($textOpt) === '') {
        fwrite(STDERR, "Use: --company=<id> --text=\"João - M frango\"\n");
        exit(1);
    }
    $companyId = (int) $companyOpt;
    $cfg = Db::queryOne(
        'SELECT w.*, c.name AS company_name, c.order_cutoff_time, c.org_id
           FROM marmitex_wa_configs w JOIN marmitex_companies c ON c.id = w.company_id
          WHERE w.company_id = ?',
        [$companyId]
    );
    if (!$cfg) {
        fwrite(STDERR, "Empresa {$companyId} não tem configuração de WhatsApp (cadastre em Clientes Empresariais).\n");
        exit(1);
    }
    $key = 'sim:' . bin2hex(random_bytes(8));
    $ts = time();
    Db::execute(
        'INSERT INTO marmitex_wa_messages
            (company_id, group_jid, message_key, sender_name, body, message_ts, service_date, source, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [$companyId, (string) $cfg['group_jid'], $key, 'Simulação', $textOpt,
            date('Y-m-d H:i:s', $ts), MarmitexWaIngest::localDate($ts), 'manual', 'pending']
    );
    $msg = Db::queryOne('SELECT * FROM marmitex_wa_messages WHERE message_key = ?', [$key]);
    $say("mensagem de teste #{$msg['id']} criada para {$cfg['company_name']}; interpretando...");

    $r = MarmitexWaDraft::processMessage($msg);
    $counts = $r['draft_id'] ? MarmitexWaDraft::counts($r['draft_id']) : ['ok' => 0, 'doubt' => 0, 'total' => 0];
    $say(sprintf(
        '%s: %d linha(s) lida(s) · rascunho #%s com %d ok / %d duvidosa(s)%s',
        $r['status'],
        $r['lines'],
        (string) ($r['draft_id'] ?? '-'),
        $counts['ok'],
        $counts['doubt'],
        $r['order_id'] ? " · pedido #{$r['order_id']} aplicado" : ' · aguardando revisão'
    ));
    exit($r['status'] === 'error' ? 1 : 0);
}

// --- Lock: a IA é pesada; dois workers só brigariam pela RAM do modelo ---
$lock = fopen(sys_get_temp_dir() . '/pedidopro-marmitex-wa.lock', 'c');
if ($lock === false || !flock($lock, LOCK_EX | LOCK_NB)) {
    echo "Outro worker do WhatsApp já está rodando; saindo.\n";
    exit;
}

$loop = $flag('loop');
$noSweep = $flag('no-sweep');
$intervalMs = Env::int('MARMITEX_WA_INTERVAL_MS', 60000);
$sweepMs = Env::int('MARMITEX_WA_SWEEP_MS', 300000);
$batch = Env::int('MARMITEX_WA_BATCH', 20);
$lastSweep = 0.0;
// Varredura da caixa de entrada geral: mesmo laço, cadência própria. É bem mais
// barata que a do marmitex (não chama IA), mas cobre TODAS as conversas.
$inboxMs = Env::int('WA_INBOX_SWEEP_MS', 120000);
$lastInbox = 0.0;
$lastPurge = 0.0;

$say('worker iniciado' . ($loop ? " (laço de {$intervalMs}ms, varredura a cada {$sweepMs}ms)" : ' (rodada única)'));

do {
    try {
        $nowMs = microtime(true) * 1000;
        if (!$noSweep && ($nowMs - $lastSweep) >= $sweepMs) {
            $lastSweep = $nowMs;
            $s = MarmitexWaIngest::sweep();
            if ($s['staged'] > 0 || $s['groups'] === 0) {
                $say("varredura: {$s['groups']} grupo(s), {$s['scanned']} msg(s), {$s['staged']} nova(s)");
            }
        }

        if (!$noSweep && ($nowMs - $lastInbox) >= $inboxMs) {
            $lastInbox = $nowMs;
            $i = WaInbox::sweep();
            if ($i['stored'] > 0) {
                $say("inbox: {$i['chats']} conversa(s) relida(s), {$i['stored']} mensagem(ns) recuperada(s)");
            }
            // Retenção uma vez por dia — dado pessoal de cliente não fica para sempre.
            if (($nowMs - $lastPurge) >= 86400000) {
                $lastPurge = $nowMs;
                $removed = WaInbox::purge();
                if ($removed > 0) {
                    $say("inbox: {$removed} mensagem(ns) fora da janela de retenção removida(s)");
                }
            }
        }

        $d = MarmitexWaDraft::drain($batch);
        if ($d['processed'] > 0) {
            $say("fila: {$d['processed']} mensagem(ns), {$d['lines']} linha(s), {$d['applied']} pedido(s) aplicado(s), {$d['errors']} erro(s)");
        }
    } catch (\Throwable $e) {
        fwrite(STDERR, '[' . $stamp() . '] ERRO: ' . $e->getMessage() . "\n");
    }
    if ($loop) {
        usleep($intervalMs * 1000);
    }
} while ($loop);
