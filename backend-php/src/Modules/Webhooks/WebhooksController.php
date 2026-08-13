<?php

namespace App\Modules\Webhooks;

use App\Core\Env;
use App\Core\Http;
use App\Core\Request;
use App\Services\Integrations\IngestService;
use App\Services\MarmitexWaIngest;
use App\Services\WaInbox;

/**
 * Recebe eventos de pedido das plataformas (rotas PÚBLICAS — sem JWT).
 * É o caminho de tempo real; o polling (cron) é só a rede de segurança.
 *
 * Segurança por plataforma:
 *  - iFood: assina cada requisição com HMAC-SHA256 do corpo CRU usando o
 *    client_secret, em hex, no header `X-IFood-Signature`. Validar é OBRIGATÓRIO
 *    na homologação (o iFood testa enviando assinaturas inválidas e o endpoint
 *    DEVE rejeitar). Ver: developer.ifood.com.br/.../webhook-signature.
 *  - 99food (e fallback): segredo compartilhado em `x-webhook-secret`/`?secret=`.
 *
 * Em INTEGRATIONS_MOCK a validação é pulada (testes locais com curl).
 */
final class WebhooksController
{
    public static function ifood(Request $req): void
    {
        self::handle('ifood', $req);
    }

    public static function nineFood(Request $req): void
    {
        self::handle('99food', $req);
    }

    /**
     * Evolution API → toda mensagem da instância. Daqui saem DOIS caminhos:
     *  1. `WaInbox::ingest` — espelho da caixa de entrada (a janela de WhatsApp
     *     dentro do app). Recebe tudo, inclusive o que você mandou pelo celular.
     *  2. `MarmitexWaIngest::stageMessage` — só os grupos de empresa cadastrados,
     *     que viram pedido.
     *
     * Aqui NÃO se interpreta nada: o handler só grava a mensagem crua. A IA local
     * roda em CPU e leva minutos — se fosse chamada aqui, o túnel cortaria em 100s
     * e a Evolution reentregaria a mensagem em loop. Quem interpreta é o worker
     * `bin/marmitex-wa.php`.
     *
     * Responde 200 mesmo para grupo desconhecido: 4xx faz a Evolution reenviar.
     */
    public static function evolution(Request $req): void
    {
        $raw = file_get_contents('php://input');
        $body = is_string($raw) && $raw !== '' ? json_decode($raw, true) : null;
        if (!is_array($body)) {
            $body = $req->body;
        }

        if (!self::evolutionSecretOk($req)) {
            Http::error(401, 'Segredo do webhook inválido');
        }

        $event = strtolower((string) ($body['event'] ?? ''));
        if (!in_array(str_replace('_', '.', $event), ['messages.upsert', ''], true)) {
            Http::json(['ok' => true, 'ignored' => "evento {$event}"], 200);
        }

        // A Evolution manda `data` como objeto (1 mensagem) ou array (lote),
        // dependendo da versão/configuração da instância.
        $data = $body['data'] ?? [];
        $records = isset($data['key']) ? [$data] : (is_array($data) ? $data : []);

        $result = ['staged' => 0, 'duplicate' => 0, 'ignored' => 0, 'inbox' => 0];
        foreach ($records as $m) {
            if (!is_array($m) || !isset($m['key']['remoteJid'])) {
                $result['ignored']++;
                continue;
            }
            // Espelho da caixa de entrada ANTES do funil do marmitex: aqui entra
            // toda conversa, e os `continue` abaixo descartam o que não é de
            // empresa cadastrada. Falhar no espelho não pode derrubar o pedido.
            try {
                if (WaInbox::ingest($m, 'webhook') === 'stored') {
                    $result['inbox']++;
                }
            } catch (\Throwable $e) {
                error_log('[wa-inbox] ingest falhou: ' . $e->getMessage());
            }

            $cfg = MarmitexWaIngest::configByGroupJid((string) $m['key']['remoteJid']);
            if (!$cfg || (int) $cfg['enabled'] !== 1) {
                $result['ignored']++;
                continue;
            }
            $r = MarmitexWaIngest::stageMessage($cfg, $m, 'webhook');
            $result[$r === 'staged' ? 'staged' : ($r === 'duplicate' ? 'duplicate' : 'ignored')]++;
        }
        Http::json(['ok' => true] + $result, 200);
    }

    /** Segredo compartilhado no header (preferido — não vaza em log de proxy) ou na query. */
    private static function evolutionSecretOk(Request $req): bool
    {
        if (Env::bool('INTEGRATIONS_MOCK', false)) {
            return true;
        }
        $expected = (string) Env::get('MARMITEX_WA_WEBHOOK_SECRET', '');
        if ($expected === '') {
            return false; // sem segredo configurado, a rota pública fica fechada
        }
        $sent = (string) ($_SERVER['HTTP_X_WEBHOOK_SECRET'] ?? $req->query('secret') ?? '');
        return $sent !== '' && hash_equals($expected, $sent);
    }

    private static function handle(string $platform, Request $req): void
    {
        // Corpo CRU para validar a assinatura (sem transformações).
        $raw = file_get_contents('php://input');
        $raw = is_string($raw) ? $raw : '';

        // order_id/shop_id do DiDi são inteiros de 64 bits: decodifica preservando a
        // precisão (JSON_BIGINT_AS_STRING) para o order_id não ser arredondado/corrompido
        // ao ser guardado — senão ready/cancel depois falham com errno 10001. Escopo local
        // ao webhook (não altera o parser global usado pelos demais módulos).
        $body = $raw !== '' ? json_decode($raw, true, 512, JSON_BIGINT_AS_STRING) : null;
        if (!is_array($body)) {
            $body = $req->body;
        }
        $merchantId = self::merchantFromBody($body);
        $channel = IngestService::findChannel($platform, $merchantId);

        // Sem canal cadastrado: responde 200 (não queremos reentrega) mas não processa.
        if (!$channel) {
            self::ack($platform, ['ignored' => 'no channel configured']);
        }

        if (!self::signatureOk($platform, $req, $channel, $raw)) {
            Http::error(401, 'Assinatura do webhook inválida');
        }

        $result = IngestService::handleWebhook($platform, $body, $channel);
        self::ack($platform, $result);
    }

    /**
     * Resposta de sucesso do webhook. O DiDi/99Food EXIGE {errno:0,errmsg:ok} —
     * qualquer outra coisa e ele reenvia o callback várias vezes. O iFood só checa
     * o status 2xx, então mantém o formato antigo {ok:true}+extra.
     */
    private static function ack(string $platform, array $extra = []): never
    {
        if ($platform === '99food') {
            Http::json(['errno' => 0, 'errmsg' => 'ok'], 200);
        }
        Http::json(['ok' => true] + $extra, 200);
    }

    private static function signatureOk(string $platform, Request $req, array $channel, string $raw): bool
    {
        if (Env::bool('INTEGRATIONS_MOCK', false)) {
            return true; // dev/local: dispensa assinatura
        }

        if ($platform === 'ifood') {
            // HMAC-SHA256(corpo_cru, client_secret) em hex == X-IFood-Signature.
            $secret = (string) ($channel['client_secret'] ?? '');
            $sig = $_SERVER['HTTP_X_IFOOD_SIGNATURE'] ?? '';
            if ($secret === '' || !is_string($sig) || $sig === '') {
                return false; // sem credencial ou sem assinatura → rejeita (exigido na homologação)
            }
            $expected = hash_hmac('sha256', $raw, $secret);
            return hash_equals($expected, strtolower(trim($sig)));
        }

        // 99food/DiDi: header `didi-header-sign` = MD5(corpo_cru . app_secret).
        // app_secret = client_secret do canal.
        $secret = (string) ($channel['client_secret'] ?? '');
        $sig = $_SERVER['HTTP_DIDI_HEADER_SIGN'] ?? '';
        $sig = is_string($sig) ? strtolower(trim($sig)) : '';
        if ($secret === '' || $sig === '') {
            error_log('[99food] webhook sem verificação (secret ' . ($secret === '' ? 'ausente' : 'ok')
                . ', sign ' . ($sig === '' ? 'ausente' : 'presente') . ') — aceitando');
            return true;
        }
        if (hash_equals(md5($raw . $secret), $sig)) {
            error_log('[99food] webhook sign OK');
            return true;
        }
        // Mismatch: loga sempre. Só REJEITA se DELIVERY_99FOOD_ENFORCE_SIGN=1 (rollout
        // seguro: primeiro confirmamos no tráfego real que o algoritmo bate, depois
        // liga o enforce — pra não perder pedido real por alguma sutileza de encoding).
        error_log('[99food] webhook sign MISMATCH esperado=' . md5($raw . $secret) . ' recebido=' . $sig);
        return !Env::bool('DELIVERY_99FOOD_ENFORCE_SIGN', false);
    }

    /** Tenta achar o merchantId no payload (varia entre plataformas/eventos). */
    private static function merchantFromBody(array $body): ?string
    {
        $candidates = [
            $body['merchantId'] ?? null,
            $body['merchant']['id'] ?? null,
            $body['storeId'] ?? null,
            $body['events'][0]['merchantId'] ?? null,
            // 99Food/DiDi: o vínculo é pelo app_shop_id (= merchant_id do canal).
            $body['app_shop_id'] ?? null,
            $body['data']['app_shop_id'] ?? null,
            $body['shop']['app_shop_id'] ?? null,
        ];
        foreach ($candidates as $c) {
            if ($c) {
                return (string) $c;
            }
        }
        return null;
    }
}
