<?php

namespace App\Services\Integrations;

use App\Core\Db;
use App\Core\Env;
use App\Core\HttpError;

/**
 * Cliente da API do 99Food / DiDi Food (openapi.didi-food.com).
 *
 * Modelo de auth (DIFERENTE de OAuth client_credentials):
 *  - Credenciais do app: app_id + app_secret (guardadas no canal como client_id/client_secret).
 *  - Por loja: você define um app_shop_id (guardado como merchant_id) e vincula a loja
 *    real via página de autorização (auth/authorizationpage/getUrl).
 *  - Token por loja: GET /v1/auth/authtoken/get → auth_token (+ token_expiration_time).
 *    Se não existir/expirou: GET /v1/auth/authtoken/refresh e então /get de novo.
 *  - Todas as chamadas de pedido/loja usam auth_token (query no GET, corpo no POST).
 *
 * Pedidos chegam por CALLBACK (orderNew/orderFinish/orderCancel) → buscamos o
 * detalhe com order/order/detail. Não há polling de pedidos (pollEvents = []).
 *
 * Resposta padrão: { errno:0, errmsg:'ok', requestId, time, data }. Sucesso = errno 0.
 *
 * @phpstan-type Channel array{id:int,merchant_id:?string,client_id:?string,client_secret:?string}
 */
final class NineNineClient
{
    /** Comando unificado → reason_id padrão de cancelamento (enum DiDi). */
    private const CANCEL_REASON_ID = 1010;

    /** errno do DiDi para "token/autorização da loja expirou". */
    private const TOKEN_EXPIRED = 10102;

    private static function base(): string
    {
        return rtrim((string) Env::get('NINE_NINE_API_BASE', 'https://openapi.didi-food.com'), '/');
    }

    private static function mock(): bool
    {
        return Env::bool('INTEGRATIONS_MOCK', false);
    }

    /** Credenciais do canal mapeadas para os nomes do DiDi. */
    private static function creds(array $channel): array
    {
        return [
            'app_id' => (string) ($channel['client_id'] ?? ''),
            'app_secret' => (string) ($channel['client_secret'] ?? ''),
            'app_shop_id' => (string) ($channel['merchant_id'] ?? ''),
        ];
    }

    /**
     * Chama a API e interpreta o StandardResponse.
     * @return array{ok:bool,errno:int,errmsg:string,data:mixed,status:int,requestId:string}
     */
    private static function call(string $method, string $path, array $query = [], ?array $body = null): array
    {
        $url = self::base() . $path;
        if ($query) {
            $url .= '?' . http_build_query($query);
        }
        $r = HttpClient::request($method, $url, ['Accept: application/json'], $body);
        // order_id/shop_id do DiDi são inteiros de 64 bits. Decodifica o corpo cru
        // preservando a precisão (JSON_BIGINT_AS_STRING): um json_decode normal pode
        // arredondar ids grandes e corrompê-los → depois o DiDi devolve errno 10001
        // ("falha ao recuperar o pedido") ao mandarmos ready/cancel com o id errado.
        $decoded = ($r['raw'] ?? '') !== '' ? json_decode($r['raw'], true, 512, JSON_BIGINT_AS_STRING) : null;
        $data = is_array($decoded) ? $decoded : [];
        // status 0 = falha de cURL (timeout/conexão): NÃO pode contar como sucesso.
        $httpOk = $r['status'] >= 200 && $r['status'] < 400;
        $errno = (int) ($data['errno'] ?? ($httpOk ? 0 : -1));
        $result = [
            'ok' => $httpOk && $errno === 0,
            'errno' => $errno,
            'errmsg' => (string) ($data['errmsg'] ?? $r['error'] ?? ''),
            'data' => $data['data'] ?? null,
            'status' => $r['status'],
            'requestId' => (string) ($data['requestId'] ?? $data['request_id'] ?? ''),
        ];

        // Diagnóstico: registra TODA chamada que não deu ok (errno != 0 ou HTTP ruim),
        // com o corpo exato enviado e a resposta crua, para depurar erros genéricos do
        // DiDi (ex.: errno 10001 "falha ao recuperar o pedido"). O auth_token é
        // redigido. Vai para o error_log do PHP (na HostGator: error_log da conta/app).
        if (!$result['ok']) {
            self::debug($method, $path, $query, $body, $r['status'], $result, $r['raw'] ?? '');
        }

        return $result;
    }

    /** error_log estruturado de uma chamada ao DiDi (com auth_token redigido). */
    private static function debug(string $method, string $path, array $query, ?array $body, int $status, array $result, string $raw): void
    {
        $redact = static function (?array $a): ?array {
            if ($a === null) {
                return null;
            }
            if (isset($a['auth_token'])) {
                $a['auth_token'] = '***';
            }
            return $a;
        };
        error_log('[99food] ' . $method . ' ' . $path
            . ' q=' . json_encode($redact($query), JSON_UNESCAPED_UNICODE)
            . ' body=' . json_encode($redact($body), JSON_UNESCAPED_UNICODE)
            . ' -> http=' . $status . ' errno=' . $result['errno']
            . ' errmsg=' . $result['errmsg']
            . ' requestId=' . $result['requestId']
            . ' raw=' . substr($raw, 0, 1000));
    }

    /**
     * auth_token válido da loja (cacheado em channel_tokens; renova quando expira).
     * $forceRefresh ignora o cache e força um token novo — usado quando um comando
     * levou errno 10102 (o cache local achava válido um token já expirado no DiDi).
     */
    public static function token(array $channel, bool $forceRefresh = false): string
    {
        if (self::mock()) {
            return 'mock-token';
        }
        $cid = (int) $channel['id'];
        if (!$forceRefresh) {
            $row = Db::queryOne('SELECT access_token, expires_at FROM channel_tokens WHERE channel_id = ?', [$cid]);
            if ($row && $row['expires_at'] !== null && strtotime((string) $row['expires_at']) - 60 > time()) {
                return (string) $row['access_token'];
            }
        } else {
            // Mint um token novo no servidor antes de buscar (o antigo pode estar morto).
            self::call('GET', '/v1/auth/authtoken/refresh', self::creds($channel));
        }

        $token = self::fetchToken($channel);
        // Sem token ou expirado no servidor → força refresh e busca de novo.
        if ($token === null) {
            self::call('GET', '/v1/auth/authtoken/refresh', self::creds($channel));
            $token = self::fetchToken($channel);
        }
        if ($token === null) {
            throw HttpError::unprocessable('Falha ao obter auth_token do 99Food (confira app_id/app_secret/app_shop_id e o vínculo da loja).');
        }
        return $token;
    }

    /** GET authtoken/get; cacheia e devolve o auth_token (ou null). */
    private static function fetchToken(array $channel): ?string
    {
        $r = self::call('GET', '/v1/auth/authtoken/get', self::creds($channel));
        $token = is_array($r['data']) ? ($r['data']['auth_token'] ?? null) : null;
        if (!is_string($token) || $token === '') {
            return null;
        }
        $exp = (int) ($r['data']['token_expiration_time'] ?? (time() + 3600));
        Db::execute(
            'INSERT INTO channel_tokens (channel_id, access_token, expires_at) VALUES (?, ?, FROM_UNIXTIME(?))
             ON DUPLICATE KEY UPDATE access_token = VALUES(access_token), expires_at = VALUES(expires_at)',
            [(int) $channel['id'], $token, $exp]
        );
        return $token;
    }

    /**
     * URL da página de autorização (bind) da loja. POST auth/authorizationpage/getUrl
     * com app_id + app_shop_id (não usa secret nem token). O lojista abre a URL, loga na
     * conta 99Food do estabelecimento e autoriza — vinculando a loja real ao app.
     */
    public static function authorizationUrl(array $channel): string
    {
        if (self::mock()) {
            return 'https://example.test/authorize?mock=1';
        }
        $creds = self::creds($channel);
        if ($creds['app_id'] === '' || $creds['app_shop_id'] === '') {
            throw HttpError::unprocessable('Configure o Client ID (app_id) e o Merchant ID (app_shop_id) do canal antes de gerar o link.');
        }
        $r = self::call('POST', '/v1/auth/authorizationpage/getUrl', [], [
            'app_id' => self::orderIdValue($creds['app_id']),
            'app_shop_id' => $creds['app_shop_id'],
        ]);
        if (!$r['ok']) {
            $rid = $r['requestId'] !== '' ? " [reqId {$r['requestId']}]" : '';
            throw HttpError::unprocessable("Falha ao gerar link de autorização no 99Food (errno {$r['errno']}: {$r['errmsg']}){$rid}.");
        }
        // A URL pode vir como string, lista ['http...'] ou objeto {campo: 'http...'} —
        // procura a 1ª string http em qualquer nível do data (robusto ao formato).
        $url = self::firstUrl($r['data']);
        if ($url === '') {
            // errno 0 mas sem URL: registra o data cru p/ diagnosticar o formato/vazio.
            error_log('[99food] getUrl sem URL — data=' . json_encode($r['data'], JSON_UNESCAPED_UNICODE) . ' requestId=' . $r['requestId']);
            throw HttpError::unprocessable('O 99Food não retornou a URL de autorização (data vazio — veja o log; pode faltar aprovação do app de produção).');
        }
        return $url;
    }

    /** Acha a 1ª string que começa com http em $data (string ou array aninhado). */
    private static function firstUrl(mixed $data): string
    {
        if (is_string($data)) {
            return str_starts_with($data, 'http') ? $data : '';
        }
        if (is_array($data)) {
            foreach ($data as $v) {
                $u = self::firstUrl($v);
                if ($u !== '') {
                    return $u;
                }
            }
        }
        return '';
    }

    /** 99Food entrega pedidos por callback — não há polling. */
    public static function pollEvents(array $channel): array
    {
        return [];
    }

    public static function acknowledge(array $channel, array $eventIds): void
    {
        // Sem ACK no modelo de callback do DiDi.
    }

    /** GET /v1/order/order/detail → OrderModel. */
    public static function getOrder(array $channel, string $orderId): ?array
    {
        if (self::mock()) {
            return null;
        }
        $r = self::call('GET', '/v1/order/order/detail', [
            'auth_token' => self::token($channel),
            'order_id' => $orderId,
        ]);
        return is_array($r['data']) ? $r['data'] : null;
    }

    /**
     * Envia comando de status. Mapeamento:
     *  confirm  → POST order/confirm
     *  ready    → GET  order/ready
     *  dispatch → GET  order/delivered (só entrega própria; concluído pela loja)
     *  cancel   → POST order/cancel (reason_id obrigatório)
     */
    public static function command(array $channel, string $orderId, string $command): void
    {
        if (self::mock()) {
            return;
        }
        $oid = self::orderIdValue($orderId);

        $send = static fn(string $token): array => match ($command) {
            'confirm' => self::call('POST', '/v1/order/order/confirm', [], ['auth_token' => $token, 'order_id' => $oid]),
            'ready' => self::call('GET', '/v1/order/order/ready', ['auth_token' => $token, 'order_id' => $oid]),
            'dispatch' => self::call('GET', '/v1/order/order/delivered', ['auth_token' => $token, 'order_id' => $oid]),
            'cancel' => self::call('POST', '/v1/order/order/cancel', [], [
                'auth_token' => $token,
                'order_id' => $oid,
                'reason_id' => self::CANCEL_REASON_ID,
                'reason' => 'Cancelado pela loja',
            ]),
            default => throw HttpError::badRequest("Comando '{$command}' não suportado pelo 99Food"),
        };

        $r = $send(self::token($channel));
        // Vida do token é "aleatória" no DiDi: o cache local pode achar válido um
        // token que o servidor já expirou → errno 10102. Força refresh e reenvia 1x.
        if (!$r['ok'] && $r['errno'] === self::TOKEN_EXPIRED) {
            $r = $send(self::token($channel, true));
        }

        if (!$r['ok']) {
            $msg = $r['errmsg'] !== '' ? $r['errmsg'] : 'sem resposta da API';
            $rid = $r['requestId'] !== '' ? " [reqId {$r['requestId']}]" : '';
            // 422 (não 5xx): a HostGator troca o corpo de respostas 5xx pela página de
            // erro dela, escondendo esta mensagem do frontend. 422 passa o JSON intacto.
            throw HttpError::unprocessable("Falha ao enviar '{$command}' ao 99Food (errno {$r['errno']}: {$msg}){$rid}.");
        }
    }

    /**
     * order_id do DiDi para envio: numérico quando cabe em PHP_INT_MAX (o corpo JSON
     * do DiDi espera número), senão preserva a string — um (int) direto poderia
     * estourar e corromper ids muito grandes.
     */
    private static function orderIdValue(string $orderId): int|string
    {
        return (string) (int) $orderId === $orderId ? (int) $orderId : $orderId;
    }

    /** Sem endpoint simples de tracking do entregador na API atual. */
    public static function tracking(array $channel, string $orderId): ?array
    {
        return null;
    }

    /**
     * Verifica a autenticação e devolve a loja vinculada (para a tela de Integrações).
     * Usa shop/detail (shop/list exige assinatura 'sign'); retorna a loja deste canal.
     * @return array<int,array{id:string,name:string}>
     */
    public static function merchants(array $channel): array
    {
        if (self::mock()) {
            return [];
        }
        $r = self::call('GET', '/v1/shop/shop/detail', ['auth_token' => self::token($channel)]);
        if (!$r['ok'] || !is_array($r['data'])) {
            return [];
        }
        $shop = $r['data'];
        return [[
            'id' => (string) ($shop['app_shop_id'] ?? ($channel['merchant_id'] ?? '')),
            'name' => (string) ($shop['name'] ?? 'Loja'),
        ]];
    }

    // ---- Loja (Store Module) ----

    /**
     * Executa uma chamada autenticada por auth_token com retry único em token
     * expirado (errno 10102) — mesmo padrão do command().
     * @param callable(string):array $send recebe o token e devolve o resultado de call()
     */
    private static function withToken(array $channel, callable $send): array
    {
        $r = $send(self::token($channel));
        if (!$r['ok'] && $r['errno'] === self::TOKEN_EXPIRED) {
            $r = $send(self::token($channel, true));
        }
        return $r;
    }

    /** Lança HttpError 422 legível quando a resposta do DiDi não é ok. */
    private static function assertOk(array $r, string $what): void
    {
        if (!$r['ok']) {
            $msg = $r['errmsg'] !== '' ? $r['errmsg'] : 'sem resposta da API';
            $rid = $r['requestId'] !== '' ? " [reqId {$r['requestId']}]" : '';
            throw HttpError::unprocessable("Falha em {$what} no 99Food (errno {$r['errno']}: {$msg}){$rid}.");
        }
    }

    /** GET /v1/shop/shop/detail — detalhes completos da loja (ShopModel). */
    public static function shopDetail(array $channel): array
    {
        if (self::mock()) {
            return ['name' => 'Loja Mock', 'biz_status' => 1, 'sub_biz_status' => 1];
        }
        $r = self::withToken($channel, static fn (string $t) => self::call('GET', '/v1/shop/shop/detail', ['auth_token' => $t]));
        self::assertOk($r, 'consultar loja');
        return is_array($r['data']) ? $r['data'] : [];
    }

    /**
     * POST /v1/shop/shop/setStatus — abre/fecha a loja.
     * $bizStatus: 1 online, 2 offline. $autoSwitch: 1 abre automático, 2 fecha
     * automático, 3 abre e fecha automático (só vale com biz_status online).
     */
    public static function setShopStatus(array $channel, int $bizStatus, int $autoSwitch = 1): array
    {
        if (self::mock()) {
            return ['biz_status' => $bizStatus === 1, 'auto_switch' => true];
        }
        $r = self::withToken($channel, static fn (string $t) => self::call('POST', '/v1/shop/shop/setStatus', [], [
            'auth_token' => $t,
            'biz_status' => $bizStatus,
            'auto_switch' => $autoSwitch,
        ]));
        self::assertOk($r, 'alterar status da loja');
        return is_array($r['data']) ? $r['data'] : [];
    }

    /**
     * POST /v1/shop/shop/update — atualiza telefone, horários e tempo de preparo.
     * A API exige os TRÊS campos juntos; o chamador deve reenviar os atuais
     * (lidos de shopDetail) quando quiser mudar só um.
     *  - $shopPhone:  [{callingCode:55, phone:..., type:0}]
     *  - $bizDayTime: [{bizDay:[1..7], bizTime:[{begin:'00:00', end:'23:59'}]}]
     *  - $promiseProduceTime: minutos de preparo médio
     */
    public static function updateShop(array $channel, array $shopPhone, array $bizDayTime, int $promiseProduceTime): void
    {
        if (self::mock()) {
            return;
        }
        $r = self::withToken($channel, static fn (string $t) => self::call('POST', '/v1/shop/shop/update', [], [
            'auth_token' => $t,
            // A API espera essas estruturas como STRING JSON (ver swagger: examples são strings).
            'shop_phone' => json_encode($shopPhone, JSON_UNESCAPED_UNICODE),
            'biz_day_time' => json_encode($bizDayTime, JSON_UNESCAPED_UNICODE),
            'promise_produce_time' => $promiseProduceTime,
        ]));
        self::assertOk($r, 'atualizar dados da loja');
    }

    // ---- Cardápio (Menu Module) ----

    /** GET /v1/item/item/list — cardápio completo { menus, categories, items }. */
    public static function menuList(array $channel): array
    {
        if (self::mock()) {
            return ['menus' => [], 'categories' => [], 'items' => []];
        }
        $r = self::withToken($channel, static fn (string $t) => self::call('GET', '/v1/item/item/list', ['auth_token' => $t]));
        self::assertOk($r, 'listar cardápio');
        return is_array($r['data']) ? $r['data'] : ['menus' => [], 'categories' => [], 'items' => []];
    }

    /**
     * POST /v1/item/item/upload — substitui o cardápio INTEIRO da loja.
     * $menus: MenuStruct[]; $categories: CateStruct[]; $items: ItemStruct[]
     * (preços em CENTAVOS). Timeout maior: payload grande.
     */
    public static function menuUpload(array $channel, array $menus, array $categories, array $items): mixed
    {
        if (self::mock()) {
            return [];
        }
        $r = self::withToken($channel, static fn (string $t) => self::call('POST', '/v1/item/item/upload', [], [
            'auth_token' => $t,
            'menus' => $menus,
            'categories' => $categories,
            'items' => $items,
        ]));
        self::assertOk($r, 'publicar cardápio');
        return $r['data'];
    }

    /** POST /v1/item/item/update — atualiza UM item (ItemStruct completo; auth_token na query). */
    public static function updateItem(array $channel, array $itemStruct): void
    {
        if (self::mock()) {
            return;
        }
        $r = self::withToken($channel, static fn (string $t) => self::call('POST', '/v1/item/item/update', ['auth_token' => $t], $itemStruct));
        self::assertOk($r, 'atualizar item');
    }

    /** POST /v1/item/item/updateItemStatus — pausa/reativa um item (1 disponível, 2 indisponível). */
    public static function updateItemStatus(array $channel, string $appItemId, int $status): void
    {
        if (self::mock()) {
            return;
        }
        $r = self::withToken($channel, static fn (string $t) => self::call('POST', '/v1/item/item/updateItemStatus', ['auth_token' => $t], [
            'app_item_id' => $appItemId,
            'status' => $status,
        ]));
        self::assertOk($r, 'alterar disponibilidade do item');
    }

    /**
     * Aceita/recusa um pedido de cancelamento do cliente.
     * POST /v1/order/apply/cancel { auth_token, order_id, apply_id, agree, reason }.
     */
    public static function resolveCancellation(array $channel, string $orderId, string $applyId, bool $agree, string $reason = ''): void
    {
        if (self::mock()) {
            return;
        }
        $r = self::call('POST', '/v1/order/apply/cancel', [], [
            'auth_token' => self::token($channel),
            'order_id' => self::orderIdValue($orderId),
            'apply_id' => self::orderIdValue($applyId),
            'agree' => $agree,
            'reason' => $reason !== '' ? $reason : ($agree ? 'Aceito pela loja' : 'Recusado pela loja'),
        ]);
        if (!$r['ok']) {
            $rid = $r['requestId'] !== '' ? " [reqId {$r['requestId']}]" : '';
            throw HttpError::unprocessable("Falha ao resolver cancelamento no 99Food (errno {$r['errno']}: {$r['errmsg']}){$rid}.");
        }
    }
}
