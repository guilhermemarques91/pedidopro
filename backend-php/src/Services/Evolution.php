<?php

namespace App\Services;

use App\Core\Env;
use App\Core\HttpError;

/** Cliente da Evolution API (WhatsApp), rodando no PC e exposta pelo tunnel. */
final class Evolution
{
    private static function base(): string
    {
        return rtrim((string) Env::get('EVOLUTION_API_URL', ''), '/');
    }

    private static function instance(): string
    {
        return (string) Env::get('EVOLUTION_INSTANCE', 'pedidopro');
    }

    /**
     * @param array<string,mixed>|null $body
     * @return array{status:int,data:mixed}
     */
    private static function call(string $method, string $path, ?array $body = null, int $timeout = 15): array
    {
        $ch = curl_init(self::base() . $path);
        $headers = ['apikey: ' . (string) Env::get('EVOLUTION_API_KEY', '')];
        $opts = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_TIMEOUT => $timeout,
        ];
        if ($body !== null) {
            $headers[] = 'Content-Type: application/json';
            $opts[CURLOPT_POSTFIELDS] = json_encode($body, JSON_UNESCAPED_UNICODE);
        }
        $opts[CURLOPT_HTTPHEADER] = $headers;
        curl_setopt_array($ch, $opts);
        $raw = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        $data = is_string($raw) ? json_decode($raw, true) : null;
        return ['status' => $status, 'data' => $data];
    }

    /**
     * POST /message/sendText/{instance}
     *
     * Devolve o `key.id` da mensagem criada (quando a Evolution informa). Quem
     * espelha a conversa PRECISA dele: a mensagem enviada volta pelo webhook
     * `messages.upsert` com essa mesma chave, e gravar o eco local com ela é o
     * que faz o UNIQUE descartar a segunda cópia. Sem isso, tudo que você
     * mandasse pelo sistema apareceria duas vezes na tela.
     *
     * A maior parte dos chamadores (outbox, confirmação do marmitex) ignora o
     * retorno — só o inbox precisa dele.
     */
    public static function sendMessage(string $to, string $message): ?string
    {
        $r = self::call('POST', '/message/sendText/' . self::instance(), [
            'number' => $to,
            'text' => $message,
        ]);
        if ($r['status'] >= 400 || $r['status'] === 0) {
            throw new HttpError(502, 'Falha ao enviar mensagem pelo WhatsApp');
        }
        $id = $r['data']['key']['id'] ?? null;
        return is_string($id) && $id !== '' ? $id : null;
    }

    /**
     * POST /chat/findMessages/{instance} → registros crus.
     *
     * O WhatsApp pode endereçar um contato pelo número (`<num>@s.whatsapp.net`) ou
     * por um identificador de privacidade (`<id>@lid`). Quando é LID, `key.remoteJid`
     * é o `@lid` e o número real fica em `key.remoteJidAlt`. Consultamos os dois
     * campos com o mesmo `<num>@s.whatsapp.net` e juntamos (dedup por `key.id`),
     * senão contatos migrados para LID nunca seriam encontrados.
     */
    public static function fetchMessages(string $remoteJid): array
    {
        $merged = [];
        $seen = [];
        foreach (['remoteJid', 'remoteJidAlt'] as $field) {
            foreach (self::queryMessages([$field => $remoteJid]) as $m) {
                $id = $m['key']['id'] ?? null;
                if ($id !== null && isset($seen[$id])) {
                    continue;
                }
                if ($id !== null) {
                    $seen[$id] = true;
                }
                $merged[] = $m;
            }
        }
        return $merged;
    }

    /**
     * Como `fetchMessages`, mas limitado às N mais recentes — para carregar o
     * histórico de uma conversa na caixa de entrada sem baixar os 361 registros
     * que um grupo antigo tem. A Evolution devolve em ordem DECRESCENTE
     * (a mais nova primeiro) num envelope `{messages:{total,pages,records}}`.
     *
     * @return array<int,array<string,mixed>>
     */
    public static function findMessagesPage(string $remoteJid, int $limit = 60): array
    {
        $merged = [];
        $seen = [];
        foreach (['remoteJid', 'remoteJidAlt'] as $field) {
            foreach (self::queryMessages([$field => $remoteJid], $limit) as $m) {
                $id = $m['key']['id'] ?? null;
                if ($id !== null && isset($seen[$id])) {
                    continue;
                }
                if ($id !== null) {
                    $seen[$id] = true;
                }
                $merged[] = $m;
            }
        }
        return $merged;
    }

    /**
     * POST /chat/findChats/{instance} → lista crua de conversas.
     *
     * Atenção ao que NÃO vem: na instância real `pushName`, `unreadCount` e
     * `profilePicUrl` voltam nulos em 100% dos chats. Serve para descobrir QUAIS
     * conversas existem e quando cada uma mudou (`updatedAt`) — o nome e o
     * "não lido" são responsabilidade nossa.
     *
     * @return array<int,array<string,mixed>>
     */
    public static function findChats(): array
    {
        $r = self::call('POST', '/chat/findChats/' . self::instance(), [], 40);
        $data = $r['data'];
        $records = $data['records'] ?? $data;
        return is_array($records) ? $records : [];
    }

    /**
     * GET /group/fetchAllGroups/{instance} → `id` (JID) + `subject` (nome).
     * É a única fonte do nome do grupo: `findChats` não traz.
     *
     * @return array<string,string> jid => nome
     */
    public static function groupNames(): array
    {
        $r = self::call('GET', '/group/fetchAllGroups/' . self::instance() . '?getParticipants=false', null, 40);
        $data = $r['data'];
        $records = $data['records'] ?? $data;
        $out = [];
        foreach (is_array($records) ? $records : [] as $g) {
            $jid = trim((string) ($g['id'] ?? ''));
            $name = trim((string) ($g['subject'] ?? ''));
            if ($jid !== '' && $name !== '') {
                $out[$jid] = $name;
            }
        }
        return $out;
    }

    /**
     * POST /chat/markMessageAsRead/{instance} — tira o "não lido" no celular também.
     * Best-effort: falhar aqui não pode derrubar a leitura na tela.
     *
     * @param array<int,array{remoteJid:string,fromMe:bool,id:string}> $keys
     */
    public static function markAsRead(array $keys): void
    {
        if ($keys === []) {
            return;
        }
        self::call('POST', '/chat/markMessageAsRead/' . self::instance(), ['readMessages' => $keys]);
    }

    /**
     * @param array<string,string> $keyWhere filtro aplicado em `key`
     * @param int|null $limit quando informado, vira o tamanho da página (`offset`)
     */
    private static function queryMessages(array $keyWhere, ?int $limit = null): array
    {
        $body = ['where' => ['key' => $keyWhere]];
        if ($limit !== null) {
            $body['page'] = 1;
            $body['offset'] = $limit;
        }
        $r = self::call('POST', '/chat/findMessages/' . self::instance(), $body);
        $data = $r['data'];
        $records = $data['messages']['records'] ?? $data['records'] ?? $data;
        return is_array($records) ? $records : [];
    }

    /** GET /instance/connectionState/{instance} → conectado? */
    public static function checkConnection(): bool
    {
        $r = self::call('GET', '/instance/connectionState/' . self::instance());
        $state = $r['data']['instance']['state'] ?? $r['data']['state'] ?? null;
        return $state === 'open';
    }

    /** Extrai o texto de um registro de mensagem da Evolution. */
    public static function messageText(array $m): string
    {
        $msg = $m['message'] ?? [];
        $text = $msg['conversation']
            ?? $msg['extendedTextMessage']['text']
            ?? $msg['imageMessage']['caption']
            ?? $msg['documentMessage']['caption']
            ?? '';
        return trim((string) $text);
    }

    /**
     * Classifica o registro num punhado de tipos que a interface sabe desenhar.
     * O registro traz `messageType`; a chave de `message` é o plano B (a varredura
     * e o webhook nem sempre preenchem o campo).
     *
     * `reaction` e `protocol` (apagar, edição de chave) são ruído de painel: quem
     * chama decide descartar, mas a classificação fica aqui, junto do resto do
     * conhecimento sobre o formato da Evolution.
     */
    public static function messageKind(array $m): string
    {
        $raw = (string) ($m['messageType'] ?? array_key_first($m['message'] ?? []) ?? '');
        return match (true) {
            $raw === 'conversation', $raw === 'extendedTextMessage' => 'text',
            $raw === 'imageMessage' => 'image',
            $raw === 'videoMessage' => 'video',
            $raw === 'audioMessage', $raw === 'pttMessage' => 'audio',
            $raw === 'documentMessage', $raw === 'documentWithCaptionMessage' => 'document',
            $raw === 'stickerMessage' => 'sticker',
            $raw === 'locationMessage', $raw === 'liveLocationMessage' => 'location',
            $raw === 'contactMessage', $raw === 'contactsArrayMessage' => 'contact',
            $raw === 'reactionMessage' => 'reaction',
            str_starts_with($raw, 'protocol') || $raw === 'senderKeyDistributionMessage' => 'protocol',
            default => 'other',
        };
    }

    /** Monta a mensagem de pedido formatada para WhatsApp (sem preços — só itens e quantidades). */
    public static function formatOrderMessage(array $order, array $items): string
    {
        // Quantidade: inteiro quando não tem fração (1, não 1,000); decimais só quando precisa (ex.: kg).
        $qty = static function ($q): string {
            $n = (float) $q;
            if (floor($n) === $n) {
                return (string) (int) $n;
            }
            return rtrim(rtrim(number_format($n, 3, ',', ''), '0'), ',');
        };
        $date = !empty($order['created_at'])
            ? date('d/m/Y', strtotime((string) $order['created_at']))
            : date('d/m/Y');
        $lines = [];
        foreach ($items as $it) {
            $code = trim((string) ($it['code'] ?? ''));
            $prefix = $qty($it['quantity']) . 'x ' . ($code !== '' ? '(' . $code . ') ' : '');
            $lines[] = '• ' . $prefix . $it['name'];
        }
        return implode("\n", array_merge(
            [
                "🛒 *Pedido #{$order['id']} — Restaurante Seu Sérgio*",
                "📅 Data: {$date}",
                '',
            ],
            $lines,
            [
                '',
                'Confirmar recebimento respondendo esta mensagem.',
            ]
        ));
    }
}
