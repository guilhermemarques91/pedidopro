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

    public static function list(Request $req): void
    {
        $to = $req->query('to') ?? date('Y-m-d');
        $from = $req->query('from') ?? date('Y-m-d', strtotime('-29 days'));
        $platform = $req->query('platform');

        $cond = 'o.org_id = ? AND o.created_at >= ? AND o.created_at < (? + INTERVAL 1 DAY) AND o.delivery_address IS NOT NULL';
        $params = [$req->orgId(), $from, $to];
        if ($platform !== null) {
            $cond .= ' AND o.platform = ?';
            $params[] = $platform;
        }

        $rows = Db::query(
            "SELECT id, display_id, platform, customer_name, delivery_address
               FROM delivery_orders o
              WHERE {$cond}
              ORDER BY created_at DESC",
            $params
        );

        $store = GeoService::storeSettings($req->orgId());
        $storeLat = isset($store['lat']) && $store['lat'] !== null ? (float) $store['lat'] : null;
        $storeLng = isset($store['lng']) && $store['lng'] !== null ? (float) $store['lng'] : null;

        $orders = [];
        foreach ($rows as $row) {
            $addr = json_decode((string) $row['delivery_address'], true);
            $addr = is_array($addr) ? $addr : null;
            $lat = ($addr !== null && isset($addr['lat']) && is_numeric($addr['lat'])) ? (float) $addr['lat'] : null;
            $lng = ($addr !== null && isset($addr['lng']) && is_numeric($addr['lng'])) ? (float) $addr['lng'] : null;
            $distance = ($lat !== null && $lng !== null && $storeLat !== null && $storeLng !== null)
                ? (int) round(GeoService::haversineMeters($storeLat, $storeLng, $lat, $lng))
                : null;
            $orders[] = [
                'id' => (int) $row['id'],
                'display_id' => $row['display_id'],
                'platform' => $row['platform'],
                'customer_name' => $row['customer_name'],
                'address' => $addr,
                'distance_m' => $distance,
                'needs_geocode' => $lat === null || $lng === null,
            ];
        }

        Http::json(['store' => $store, 'orders' => $orders]);
    }

    /** POST /delivery/map/backfill — geocodifica um lote pequeno sob demanda (botão no front). */
    public static function backfill(Request $req): void
    {
        $limit = (int) ($req->input()->integer('limit') ?? 15);
        $limit = max(1, min($limit, 25)); // limita o tempo de resposta (~1.1s por chamada de rede)
        Http::json(GeoService::backfill($limit, $req->orgId()));
    }
}
