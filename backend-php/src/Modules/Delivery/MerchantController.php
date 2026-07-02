<?php

namespace App\Modules\Delivery;

use App\Core\Db;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Request;
use App\Services\Integrations\IfoodClient;

/**
 * Gestão da loja no iFood (módulo Merchant): detalhes, disponibilidade,
 * interrupções (pausas) e horário de funcionamento. Alimenta a tela "Loja".
 */
final class MerchantController
{
    public static function details(Request $req): void
    {
        [$c, $m] = self::ctx($req);
        Http::json(IfoodClient::getMerchant($c, $m));
    }

    public static function status(Request $req): void
    {
        [$c, $m] = self::ctx($req);
        Http::json(IfoodClient::getMerchantStatus($c, $m));
    }

    public static function listInterruptions(Request $req): void
    {
        [$c, $m] = self::ctx($req);
        Http::json(IfoodClient::listInterruptions($c, $m));
    }

    public static function createInterruption(Request $req): void
    {
        [$c, $m] = self::ctx($req);
        $in = $req->input();
        $body = [
            'description' => $in->requireString('description', 1, 100),
            'start' => $in->requireString('start'),
            'end' => $in->requireString('end'),
        ];
        Http::json(IfoodClient::createInterruption($c, $m, $body), 201);
    }

    public static function deleteInterruption(Request $req): void
    {
        [$c, $m] = self::ctx($req);
        $id = $req->param('id');
        if (!$id) {
            throw HttpError::badRequest('ID da pausa ausente');
        }
        IfoodClient::deleteInterruption($c, $m, $id);
        Http::noContent();
    }

    public static function openingHours(Request $req): void
    {
        [$c, $m] = self::ctx($req);
        Http::json(IfoodClient::getOpeningHours($c, $m));
    }

    public static function setOpeningHours(Request $req): void
    {
        [$c, $m] = self::ctx($req);
        $shifts = $req->input()->array('shifts', true);
        // Valida/normaliza cada turno: dayOfWeek, start (HH:mm:ss), duration (min).
        $clean = [];
        foreach ($shifts as $s) {
            $day = strtoupper((string) ($s['dayOfWeek'] ?? ''));
            $start = (string) ($s['start'] ?? '');
            $duration = (int) ($s['duration'] ?? 0);
            if ($day === '' || $start === '' || $duration <= 0) {
                throw HttpError::badRequest('Turno inválido (dayOfWeek/start/duration)');
            }
            $clean[] = ['dayOfWeek' => $day, 'start' => $start, 'duration' => $duration];
        }
        if (!$clean) {
            throw HttpError::badRequest('Informe ao menos um turno');
        }
        IfoodClient::setOpeningHours($c, $m, $clean);
        Http::json(['ok' => true, 'shifts' => count($clean)]);
    }

    /**
     * Resolve o canal (por :channelId) e o merchantId. Só iFood por enquanto.
     * @return array{0:array<string,mixed>,1:string}
     */
    private static function ctx(Request $req): array
    {
        $channelId = $req->intParam('channelId');
        $channel = Db::queryOne('SELECT * FROM channels WHERE id = ?', [$channelId]);
        if (!$channel) {
            throw HttpError::notFound('Canal não encontrado');
        }
        if ($channel['platform'] !== 'ifood') {
            throw HttpError::badRequest('Gestão de loja disponível apenas para iFood no momento');
        }
        $merchantId = (string) ($channel['merchant_id'] ?? '');
        if ($merchantId === '') {
            throw HttpError::badRequest('Canal sem Merchant ID configurado');
        }
        return [$channel, $merchantId];
    }
}
