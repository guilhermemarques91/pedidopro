<?php

namespace App\Modules\Whatsapp;

use App\Core\Http;
use App\Core\Request;
use App\Services\Evolution;

final class WhatsappController
{
    /** Fila de envios pendentes/falhos. GET /whatsapp/outbox */
    public static function outbox(\App\Core\Request $req): void
    {
        \App\Core\Http::json(\App\Core\Db::query(
            "SELECT id, to_number, context, status, attempts, last_error, created_at, sent_at
               FROM whatsapp_outbox WHERE org_id = ? AND status <> 'sent'
              ORDER BY id DESC LIMIT 100",
            [$req->orgId()]
        ));
    }

    /** Reenvia pendências agora. POST /whatsapp/outbox/drain */
    public static function drainOutbox(\App\Core\Request $req): void
    {
        \App\Core\Http::json(\App\Services\Outbox::drain(50));
    }

    public static function sendTest(Request $req): void
    {
        $in = $req->input();
        $number = $in->requireString('number', 8);
        $message = $in->requireString('message');
        Evolution::sendMessage($number, $message);
        Http::json(['sent' => true]);
    }

    public static function status(Request $req): void
    {
        Http::json(['connected' => Evolution::checkConnection()]);
    }
}
