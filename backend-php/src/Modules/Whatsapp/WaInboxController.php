<?php

namespace App\Modules\Whatsapp;

use App\Core\Http;
use App\Core\HttpError;
use App\Core\Request;
use App\Services\WaInbox;

/**
 * Caixa de entrada do WhatsApp — a janela flutuante da barra superior.
 *
 * Tudo aqui lê do espelho local (ver App\Services\WaInbox); a Evolution só é
 * chamada quando a ação é para fora (enviar, marcar lido) ou para buscar
 * histórico que ainda não temos (backfill).
 */
final class WaInboxController
{
    /**
     * O endpoint quente: a tela pergunta "mudou algo?" a cada poucos segundos, o
     * dia inteiro, mesmo com a janela fechada (é o que alimenta o contador). Por
     * isso devolve só o delta — nunca a lista de mensagens.
     */
    public static function updates(Request $req): void
    {
        $since = (int) ($req->query('since') ?? 0);
        Http::json(WaInbox::updates($req->orgId(), $since));
    }

    public static function chats(Request $req): void
    {
        Http::json(WaInbox::chats($req->orgId()));
    }

    public static function messages(Request $req): void
    {
        $before = $req->query('before');
        Http::json(WaInbox::messages(
            $req->orgId(),
            $req->intParam('id'),
            $before !== null && $before !== '' ? (int) $before : null,
        ));
    }

    public static function read(Request $req): void
    {
        WaInbox::markRead($req->orgId(), $req->intParam('id'));
        Http::json(['ok' => true]);
    }

    public static function send(Request $req): void
    {
        $text = trim($req->input()->requireString('text'));
        if ($text === '') {
            throw HttpError::badRequest('Mensagem vazia');
        }
        Http::json(WaInbox::send($req->orgId(), $req->intParam('id'), $text));
    }

    /** Puxa o histórico da Evolution na primeira vez que a conversa é aberta. */
    public static function backfill(Request $req): void
    {
        Http::json(WaInbox::backfill($req->orgId(), $req->intParam('id')));
    }
}
