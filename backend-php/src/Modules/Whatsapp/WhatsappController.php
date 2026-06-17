<?php

namespace App\Modules\Whatsapp;

use App\Core\Http;
use App\Core\Request;
use App\Services\Evolution;

final class WhatsappController
{
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
