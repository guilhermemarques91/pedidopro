<?php

namespace App\Services;

use App\Core\Db;
use App\Services\Integrations\NominatimClient;

/**
 * Suporte ao mapa de pedidos Delivery: endereço/coordenadas do estabelecimento,
 * distância até cada pedido (linha reta), e o backfill de geocodificação (forward
 * para pedidos sem lat/lng, reverse para sugerir o bairro real e flagar divergência
 * com o bairro gravado pela plataforma).
 */
final class GeoService
{
    private const ADDRESS_FIELDS = ['name', 'street', 'number', 'complement', 'neighborhood', 'city', 'state', 'postal_code', 'formatted_address'];

    /** Distância em linha reta (haversine), em metros. */
    public static function haversineMeters(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $r = 6371000.0; // raio médio da Terra, em metros
        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);
        $a = sin($dLat / 2) ** 2 + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;
        $c = 2 * atan2(sqrt($a), sqrt(1 - $a));
        return $r * $c;
    }

    public static function storeSettings(): array
    {
        return Db::queryOne('SELECT * FROM store_settings WHERE id = 1') ?? ['id' => 1];
    }

    /** Atualiza o endereço da loja; geocodifica automaticamente se lat/lng não vierem explícitos e o endereço mudou. */
    public static function saveStoreSettings(array $fields): array
    {
        $current = self::storeSettings();
        $merged = array_merge($current, $fields);

        $lat = array_key_exists('lat', $fields) ? $fields['lat'] : ($current['lat'] ?? null);
        $lng = array_key_exists('lng', $fields) ? $fields['lng'] : ($current['lng'] ?? null);
        $geocodedAt = $current['geocoded_at'] ?? null;

        $explicitCoords = array_key_exists('lat', $fields) || array_key_exists('lng', $fields);
        if (!$explicitCoords && self::addressChanged($current, $fields)) {
            $query = self::addressQuery($merged);
            if ($query !== '') {
                $g = NominatimClient::geocode($query);
                if ($g !== null && $g['lat'] !== null && $g['lng'] !== null) {
                    $lat = $g['lat'];
                    $lng = $g['lng'];
                    $geocodedAt = date('Y-m-d H:i:s');
                }
            }
        }

        Db::execute(
            'UPDATE store_settings SET name=?, street=?, number=?, complement=?, neighborhood=?, city=?, state=?, postal_code=?, formatted_address=?, lat=?, lng=?, geocoded_at=? WHERE id = 1',
            [
                $merged['name'] ?? null, $merged['street'] ?? null, $merged['number'] ?? null,
                $merged['complement'] ?? null, $merged['neighborhood'] ?? null, $merged['city'] ?? null,
                $merged['state'] ?? null, $merged['postal_code'] ?? null, $merged['formatted_address'] ?? null,
                $lat, $lng, $geocodedAt,
            ]
        );
        return self::storeSettings();
    }

    /**
     * Backfill em lote, bounded: geocodifica pedidos sem lat/lng e reverse-geocodifica
     * pedidos sem sugestão de bairro. usleep entre chamadas de rede respeita o limite
     * do Nominatim (~1 req/seg). Só toca pedidos que já têm delivery_address.
     * @return array{geocoded:int,reverse_geocoded:int,remaining:int}
     */
    public static function backfill(int $limit = 15): array
    {
        $geocoded = 0;
        $reverseGeocoded = 0;

        $rows = Db::query(
            "SELECT id, delivery_address FROM delivery_orders
              WHERE delivery_address IS NOT NULL
                AND JSON_EXTRACT(delivery_address, '$.lat') IS NULL
              ORDER BY created_at DESC
              LIMIT " . max(1, $limit)
        );
        foreach ($rows as $row) {
            $addr = json_decode((string) $row['delivery_address'], true);
            if (!is_array($addr)) {
                continue;
            }
            $query = self::addressQuery($addr);
            if ($query === '') {
                continue;
            }
            $g = NominatimClient::geocode($query);
            if ($g !== null && $g['lat'] !== null && $g['lng'] !== null) {
                $addr['lat'] = $g['lat'];
                $addr['lng'] = $g['lng'];
                $addr['geocode_source'] = 'nominatim';
                $addr['geocoded_at'] = date('c');
                Db::execute('UPDATE delivery_orders SET delivery_address = ? WHERE id = ?', [
                    json_encode($addr, JSON_UNESCAPED_UNICODE), $row['id'],
                ]);
                $geocoded++;
            }
            usleep(1_100_000);
        }

        $rows2 = Db::query(
            "SELECT id, delivery_address FROM delivery_orders
              WHERE delivery_address IS NOT NULL
                AND JSON_EXTRACT(delivery_address, '$.lat') IS NOT NULL
                AND JSON_EXTRACT(delivery_address, '$.suggested_neighborhood') IS NULL
              ORDER BY created_at DESC
              LIMIT " . max(1, $limit)
        );
        foreach ($rows2 as $row) {
            $addr = json_decode((string) $row['delivery_address'], true);
            if (!is_array($addr) || !isset($addr['lat'], $addr['lng']) || !is_numeric($addr['lat']) || !is_numeric($addr['lng'])) {
                continue;
            }
            $g = NominatimClient::reverseGeocode((float) $addr['lat'], (float) $addr['lng']);
            if ($g !== null) {
                $addr['suggested_neighborhood'] = $g['neighborhood'];
                $addr['neighborhood_mismatch'] = self::mismatch($addr['neighborhood'] ?? null, $g['neighborhood']);
                Db::execute('UPDATE delivery_orders SET delivery_address = ? WHERE id = ?', [
                    json_encode($addr, JSON_UNESCAPED_UNICODE), $row['id'],
                ]);
                $reverseGeocoded++;
            }
            usleep(1_100_000);
        }

        $remaining = (int) (Db::queryOne(
            "SELECT COUNT(*) AS n FROM delivery_orders WHERE delivery_address IS NOT NULL AND JSON_EXTRACT(delivery_address, '$.lat') IS NULL"
        )['n'] ?? 0);

        return ['geocoded' => $geocoded, 'reverse_geocoded' => $reverseGeocoded, 'remaining' => $remaining];
    }

    private static function addressChanged(array $current, array $fields): bool
    {
        foreach (self::ADDRESS_FIELDS as $k) {
            if ($k === 'name' || $k === 'formatted_address') {
                continue; // não disparam re-geocodificação sozinhos
            }
            if (array_key_exists($k, $fields) && (string) ($fields[$k] ?? '') !== (string) ($current[$k] ?? '')) {
                return true;
            }
        }
        return false;
    }

    private static function addressQuery(array $a): string
    {
        $line = trim(($a['street'] ?? '') . ' ' . ($a['number'] ?? ''));
        $parts = array_filter(
            [$line, $a['neighborhood'] ?? null, $a['city'] ?? null, $a['state'] ?? null, $a['postal_code'] ?? null, 'Brasil'],
            static fn ($v) => $v !== null && trim((string) $v) !== ''
        );
        return implode(', ', $parts);
    }

    /** Compara bairro gravado vs. sugerido (ignora acento/caixa); null se faltar dado pra comparar. */
    private static function mismatch(?string $recorded, ?string $suggested): ?bool
    {
        if ($recorded === null || trim($recorded) === '' || $suggested === null || trim($suggested) === '') {
            return null;
        }
        return self::normalizeText($recorded) !== self::normalizeText($suggested);
    }

    private static function normalizeText(string $s): string
    {
        $s = mb_strtolower(trim($s));
        $map = ['á' => 'a', 'à' => 'a', 'ã' => 'a', 'â' => 'a', 'é' => 'e', 'ê' => 'e', 'í' => 'i', 'ó' => 'o', 'õ' => 'o', 'ô' => 'o', 'ú' => 'u', 'ç' => 'c'];
        return strtr($s, $map);
    }
}
