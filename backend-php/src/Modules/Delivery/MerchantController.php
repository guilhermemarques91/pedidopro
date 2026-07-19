<?php

namespace App\Modules\Delivery;

use App\Core\Db;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Request;
use App\Services\Integrations\IfoodClient;
use App\Services\Integrations\NineNineClient;

/**
 * Gestão da loja por canal (tela "Loja"), despachando por plataforma:
 *  - iFood (módulo Merchant): detalhes, disponibilidade, pausas, horários.
 *  - 99Food (Store Module): detalhes, abrir/fechar (setStatus), horários (shop/update).
 * O mapeamento de dias 99Food usa 1=Segunda … 7=Domingo (bizDay).
 */
final class MerchantController
{
    /** Dia da semana (nome iFood) → bizDay do 99Food (1=Mon … 7=Sun). */
    private const DAY_TO_BIZDAY = [
        'MONDAY' => 1, 'TUESDAY' => 2, 'WEDNESDAY' => 3, 'THURSDAY' => 4,
        'FRIDAY' => 5, 'SATURDAY' => 6, 'SUNDAY' => 7,
    ];

    public static function details(Request $req): void
    {
        [$c, $m] = self::ctx($req);
        if ($c['platform'] === '99food') {
            Http::json(NineNineClient::shopDetail($c));
            return;
        }
        Http::json(IfoodClient::getMerchant($c, $m));
    }

    public static function status(Request $req): void
    {
        [$c, $m] = self::ctx($req);
        if ($c['platform'] === '99food') {
            $d = NineNineClient::shopDetail($c);
            Http::json([
                'available' => (int) ($d['biz_status'] ?? 2) === 1,
                'biz_status' => $d['biz_status'] ?? null,
                'sub_biz_status' => $d['sub_biz_status'] ?? null,
                'auto_switch' => $d['auto_switch'] ?? null,
            ]);
            return;
        }
        Http::json(IfoodClient::getMerchantStatus($c, $m));
    }

    /**
     * POST /delivery/merchant/:channelId/status — abre/fecha a loja (só 99Food;
     * no iFood a pausa é via interruptions). Body: { open: bool, auto_switch?: 1|2|3 }.
     */
    public static function setStatus(Request $req): void
    {
        [$c] = self::ctx($req);
        if ($c['platform'] !== '99food') {
            throw HttpError::badRequest('Abrir/fechar direto disponível apenas para 99Food (no iFood use as pausas)');
        }
        $in = $req->input();
        $open = $in->boolean('open', null);
        if ($open === null) {
            throw HttpError::badRequest("Informe 'open' (true/false)");
        }
        $auto = $in->integer('auto_switch') ?? 3; // padrão: abre e fecha automático no horário
        Http::json(NineNineClient::setShopStatus($c, $open ? 1 : 2, $auto));
    }

    public static function listInterruptions(Request $req): void
    {
        [$c, $m] = self::ctx($req, 'ifood');
        Http::json(IfoodClient::listInterruptions($c, $m));
    }

    public static function createInterruption(Request $req): void
    {
        [$c, $m] = self::ctx($req, 'ifood');
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
        [$c, $m] = self::ctx($req, 'ifood');
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
        if ($c['platform'] === '99food') {
            $d = NineNineClient::shopDetail($c);
            // Normaliza biz_day_time → shifts no formato da UI (dayOfWeek/start/duration).
            $shifts = [];
            foreach ((array) ($d['biz_day_time'] ?? []) as $bdt) {
                $days = (array) ($bdt['bizDay'] ?? $bdt['biz_day'] ?? []);
                $times = (array) ($bdt['bizTime'] ?? $bdt['biz_time'] ?? []);
                foreach ($days as $day) {
                    $name = array_search((int) $day, self::DAY_TO_BIZDAY, true);
                    foreach ($times as $t) {
                        $begin = (string) ($t['begin'] ?? '00:00');
                        $end = (string) ($t['end'] ?? '23:59');
                        $shifts[] = [
                            'dayOfWeek' => $name !== false ? $name : (string) $day,
                            'start' => $begin . ':00',
                            'duration' => max(self::toMinutes($end) - self::toMinutes($begin), 0),
                        ];
                    }
                }
            }
            Http::json(['shifts' => $shifts, 'raw' => $d['biz_day_time'] ?? []]);
            return;
        }
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

        if ($c['platform'] === '99food') {
            self::setNineNineHours($c, $clean);
            Http::json(['ok' => true, 'shifts' => count($clean)]);
            return;
        }
        IfoodClient::setOpeningHours($c, $m, $clean);
        Http::json(['ok' => true, 'shifts' => count($clean)]);
    }

    /**
     * Converte shifts (dayOfWeek/start/duration) → biz_day_time e envia via
     * shop/update. A API exige shop_phone e promise_produce_time juntos: relê
     * os valores atuais de shopDetail e os reenvia.
     */
    private static function setNineNineHours(array $channel, array $shifts): void
    {
        $detail = NineNineClient::shopDetail($channel);

        // Agrupa dias com o MESMO conjunto de janelas num só bizDay (formato da API).
        $byDay = [];
        foreach ($shifts as $s) {
            $biz = self::DAY_TO_BIZDAY[$s['dayOfWeek']] ?? null;
            if ($biz === null) {
                throw HttpError::badRequest("Dia inválido: {$s['dayOfWeek']}");
            }
            $startMin = self::toMinutes(substr($s['start'], 0, 5));
            $endMin = min($startMin + (int) $s['duration'], 23 * 60 + 59);
            $byDay[$biz][] = ['begin' => self::toHm($startMin), 'end' => self::toHm($endMin)];
        }
        $groups = [];
        foreach ($byDay as $day => $times) {
            usort($times, static fn ($a, $b) => strcmp($a['begin'], $b['begin']));
            $key = json_encode($times);
            $groups[$key]['bizDay'][] = $day;
            $groups[$key]['bizTime'] = $times;
        }
        $bizDayTime = array_values(array_map(static fn ($g) => ['bizDay' => array_values($g['bizDay']), 'bizTime' => $g['bizTime']], $groups));

        // shop_phone atual (obrigatório no update) — normaliza p/ o formato de envio.
        $phones = [];
        foreach ((array) ($detail['shop_phone'] ?? []) as $p) {
            $phones[] = [
                'callingCode' => (int) ($p['calling_code'] ?? $p['callingCode'] ?? 55),
                'phone' => (int) ($p['phone'] ?? 0),
                'type' => (int) ($p['type'] ?? 0),
            ];
        }
        if (!$phones) {
            $phones = [['callingCode' => 55, 'phone' => 0, 'type' => 0]];
        }
        // promise_produce_time vem em SEGUNDOS no detail; o update espera MINUTOS.
        $produceMin = max((int) round(((int) ($detail['promise_produce_time'] ?? 1200)) / 60), 1);

        NineNineClient::updateShop($channel, $phones, $bizDayTime, $produceMin);
    }

    private static function toMinutes(string $hm): int
    {
        [$h, $m] = array_map('intval', explode(':', $hm . ':0'));
        return $h * 60 + $m;
    }

    private static function toHm(int $min): string
    {
        return sprintf('%02d:%02d', intdiv($min, 60) % 24, $min % 60);
    }

    /**
     * Resolve o canal (por :channelId) e o merchantId. $only restringe a uma
     * plataforma (recursos sem equivalente na outra).
     * @return array{0:array<string,mixed>,1:string}
     */
    private static function ctx(Request $req, ?string $only = null): array
    {
        $channelId = $req->intParam('channelId');
        $channel = Db::queryOne('SELECT * FROM channels WHERE id = ?', [$channelId]);
        if (!$channel) {
            throw HttpError::notFound('Canal não encontrado');
        }
        $platform = (string) $channel['platform'];
        if (!in_array($platform, ['ifood', '99food'], true)) {
            throw HttpError::badRequest('Gestão de loja indisponível para esta plataforma');
        }
        if ($only !== null && $platform !== $only) {
            throw HttpError::badRequest("Recurso disponível apenas para {$only}");
        }
        // iFood exige merchant_id; no 99Food o app_shop_id (merchant_id) já vai no token.
        $merchantId = (string) ($channel['merchant_id'] ?? '');
        if ($platform === 'ifood' && $merchantId === '') {
            throw HttpError::badRequest('Canal sem Merchant ID configurado');
        }
        return [$channel, $merchantId];
    }
}
