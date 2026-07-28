<?php

namespace App\Modules\Delivery;

use App\Core\Db;
use App\Core\Http;
use App\Core\Request;
use App\Services\GeoService;

/**
 * Mapa de pedidos Delivery + relatório de distância: endereço/coordenadas do
 * estabelecimento, listagem de pedidos já geocodificados (distância em linha reta)
 * e o backfill sob demanda (botão "Atualizar localizações" no front).
 * Nunca chama o Nominatim no caminho de leitura — list() só lê o que já está
 * persistido, o backfill é a única rota que geocodifica de fato.
 */
final class MapController
{
    public static function getSettings(Request $req): void
    {
        Http::json(GeoService::storeSettings($req->orgId()));
    }

    public static function updateSettings(Request $req): void
    {
        $in = $req->input();
        $fields = [];
        foreach (['name', 'street', 'number', 'complement', 'neighborhood', 'city', 'state', 'postal_code'] as $k) {
            if ($in->has($k)) {
                $fields[$k] = $in->string($k);
            }
        }
        if ($in->has('lat')) {
            $fields['lat'] = $in->number('lat');
        }
        if ($in->has('lng')) {
            $fields['lng'] = $in->number('lng');
        }
        Http::json(GeoService::saveStoreSettings($fields, $req->orgId()));
    }

    /**
     * Faixas de distância do relatório (metros). O último tem teto null = "acima de".
     * Servem tanto para o resumo quanto para o filtro rápido da tela.
     */
    private const BANDS = [
        ['key' => '0-2', 'label' => 'Até 2 km', 'min' => 0, 'max' => 2000],
        ['key' => '2-5', 'label' => '2 a 5 km', 'min' => 2000, 'max' => 5000],
        ['key' => '5-10', 'label' => '5 a 10 km', 'min' => 5000, 'max' => 10000],
        ['key' => '10+', 'label' => 'Acima de 10 km', 'min' => 10000, 'max' => null],
    ];

    public static function list(Request $req): void
    {
        $to = $req->query('to') ?? date('Y-m-d');
        $from = $req->query('from') ?? date('Y-m-d', strtotime('-29 days'));
        $platform = $req->query('platform');
        $mode = $req->query('delivery_mode');

        $cond = 'o.org_id = ? AND o.created_at >= ? AND o.created_at < (? + INTERVAL 1 DAY) AND o.delivery_address IS NOT NULL';
        $params = [$req->orgId(), $from, $to];
        if ($platform !== null && $platform !== '') {
            $cond .= ' AND o.platform = ?';
            $params[] = $platform;
        }
        if ($mode !== null && $mode !== '') {
            $cond .= ' AND o.delivery_mode = ?';
            $params[] = $mode;
        }

        // Filtro de distância (km, do usuário) → metros. Aplicado em PHP e não em SQL
        // porque a distância não está persistida: delivery_distance_m nunca é preenchido
        // e a coordenada mora no JSON do endereço, então ela é calculada aqui a cada leitura.
        $minM = self::km($req->query('min_km'));
        $maxM = self::km($req->query('max_km'));

        $rows = Db::query(
            "SELECT id, display_id, platform, customer_name, delivery_mode, customer_paid, delivery_fee, delivery_address
               FROM delivery_orders o
              WHERE {$cond}
              ORDER BY created_at DESC",
            $params
        );

        $store = GeoService::storeSettings($req->orgId());
        $storeLat = isset($store['lat']) && $store['lat'] !== null ? (float) $store['lat'] : null;
        $storeLng = isset($store['lng']) && $store['lng'] !== null ? (float) $store['lng'] : null;

        $orders = [];
        $bands = [];
        foreach (self::BANDS as $b) {
            $bands[$b['key']] = ['key' => $b['key'], 'label' => $b['label'], 'orders' => 0, 'revenue' => 0.0];
        }
        $sum = 0;
        $measured = 0;
        $max = null;
        $hiddenByDistance = 0;

        foreach ($rows as $row) {
            $addr = json_decode((string) $row['delivery_address'], true);
            $addr = is_array($addr) ? $addr : null;
            $lat = ($addr !== null && isset($addr['lat']) && is_numeric($addr['lat'])) ? (float) $addr['lat'] : null;
            $lng = ($addr !== null && isset($addr['lng']) && is_numeric($addr['lng'])) ? (float) $addr['lng'] : null;
            $distance = ($lat !== null && $lng !== null && $storeLat !== null && $storeLng !== null)
                ? (int) round(GeoService::haversineMeters($storeLat, $storeLng, $lat, $lng))
                : null;

            // O resumo (faixas/média) descreve TODOS os pedidos do período, por isso é
            // acumulado antes do filtro de distância — senão a média mudaria conforme o filtro.
            if ($distance !== null) {
                $sum += $distance;
                $measured++;
                $max = $max === null ? $distance : ($distance > $max ? $distance : $max);
                foreach (self::BANDS as $b) {
                    if ($distance >= $b['min'] && ($b['max'] === null || $distance < $b['max'])) {
                        $bands[$b['key']]['orders']++;
                        $bands[$b['key']]['revenue'] += (float) ($row['customer_paid'] ?? 0);
                        break;
                    }
                }
            }

            if ($minM !== null || $maxM !== null) {
                // Sem coordenada não dá para afirmar que está na faixa — fica de fora.
                if ($distance === null
                    || ($minM !== null && $distance < $minM)
                    || ($maxM !== null && $distance > $maxM)) {
                    $hiddenByDistance++;
                    continue;
                }
            }

            $orders[] = [
                'id' => (int) $row['id'],
                'display_id' => $row['display_id'],
                'platform' => $row['platform'],
                'customer_name' => $row['customer_name'],
                'delivery_mode' => $row['delivery_mode'],
                'customer_paid' => $row['customer_paid'] !== null ? (float) $row['customer_paid'] : null,
                'delivery_fee' => $row['delivery_fee'] !== null ? (float) $row['delivery_fee'] : null,
                'address' => $addr,
                'distance_m' => $distance,
                'needs_geocode' => $lat === null || $lng === null,
            ];
        }

        Http::json([
            'store' => $store,
            'orders' => $orders,
            'stats' => [
                'total' => count($rows),
                'measured' => $measured,
                'without_coords' => count($rows) - $measured,
                'hidden_by_distance' => $hiddenByDistance,
                'avg_m' => $measured > 0 ? (int) round($sum / $measured) : null,
                'max_m' => $max,
                'bands' => array_map(
                    static fn(array $b): array => $b + ['revenue' => round($b['revenue'], 2)],
                    array_values($bands)
                ),
            ],
        ]);
    }

    /** Converte km (string da query) para metros; null/inválido/negativo = sem limite. */
    private static function km(?string $v): ?int
    {
        if ($v === null || $v === '' || !is_numeric($v)) {
            return null;
        }
        $m = (int) round(((float) $v) * 1000);
        return $m >= 0 ? $m : null;
    }

    /** POST /delivery/map/backfill — geocodifica um lote pequeno sob demanda (botão no front). */
    public static function backfill(Request $req): void
    {
        $limit = (int) ($req->input()->integer('limit') ?? 15);
        $limit = max(1, min($limit, 25)); // limita o tempo de resposta (~1.1s por chamada de rede)
        Http::json(GeoService::backfill($limit, $req->orgId()));
    }
}
