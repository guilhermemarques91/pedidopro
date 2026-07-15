<?php

namespace App\Services\Integrations;

use App\Core\Db;
use App\Core\Env;

/**
 * Cliente do Nominatim (geocodificação gratuita da OpenStreetMap): endereço → lat/lng
 * (forward) e lat/lng → bairro/cidade aproximados (reverse). Usado pelo mapa de
 * pedidos Delivery (App\Services\GeoService), nunca no caminho de leitura de página.
 *
 * Política de uso do Nominatim: ~1 req/seg, User-Agent obrigatório, cachear resultados
 * (não repetir a mesma consulta). O rate-limit em si é responsabilidade do chamador
 * (GeoService::backfill faz usleep entre chamadas); aqui só garantimos o cache.
 */
final class NominatimClient
{
    private static function base(): string
    {
        return rtrim((string) Env::get('NOMINATIM_BASE_URL', 'https://nominatim.openstreetmap.org'), '/');
    }

    private static function userAgent(): string
    {
        return (string) Env::get('NOMINATIM_USER_AGENT', 'PedidoPro/1.0');
    }

    /**
     * Geocodificação direta: texto do endereço → lat/lng/bairro/cidade (best-effort).
     * @return array{lat:?float,lng:?float,neighborhood:?string,city:?string,state:?string,display_name:?string}|null
     */
    public static function geocode(string $query): ?array
    {
        $key = self::normalizeQuery($query);
        if ($key === '') {
            return null;
        }
        $cached = self::cacheGet($key, 'forward');
        if ($cached !== null) {
            return $cached;
        }

        $url = self::base() . '/search?' . http_build_query([
            'q' => $query,
            'format' => 'jsonv2',
            'limit' => 1,
            'addressdetails' => 1,
            'countrycodes' => 'br',
        ]);
        $res = HttpClient::request('GET', $url, [self::uaHeader(), 'Accept: application/json'], null, 15);
        $data = is_array($res['data']) ? $res['data'] : null;
        $first = (is_array($data) && isset($data[0]) && is_array($data[0])) ? $data[0] : null;
        if ($first === null) {
            return null; // não encontrado — não cacheia negativos (endereço pode ser corrigido depois)
        }

        $result = self::fromNominatim($first);
        self::cacheSet($key, 'forward', $result);
        return $result;
    }

    /**
     * Geocodificação reversa: lat/lng → bairro/cidade aproximados (sugestão, não aplica sozinho).
     * @return array{lat:?float,lng:?float,neighborhood:?string,city:?string,state:?string,display_name:?string}|null
     */
    public static function reverseGeocode(float $lat, float $lng): ?array
    {
        $key = sprintf('%.5f,%.5f', $lat, $lng);
        $cached = self::cacheGet($key, 'reverse');
        if ($cached !== null) {
            return $cached;
        }

        $url = self::base() . '/reverse?' . http_build_query([
            'lat' => $lat,
            'lon' => $lng,
            'format' => 'jsonv2',
            'zoom' => 18,
            'addressdetails' => 1,
        ]);
        $res = HttpClient::request('GET', $url, [self::uaHeader(), 'Accept: application/json'], null, 15);
        $data = is_array($res['data']) ? $res['data'] : null;
        if ($data === null) {
            return null;
        }

        $result = self::fromNominatim($data);
        self::cacheSet($key, 'reverse', $result);
        return $result;
    }

    private static function uaHeader(): string
    {
        return 'User-Agent: ' . self::userAgent();
    }

    /** @return array{lat:?float,lng:?float,neighborhood:?string,city:?string,state:?string,display_name:?string} */
    private static function fromNominatim(array $item): array
    {
        $addr = is_array($item['address'] ?? null) ? $item['address'] : [];
        return [
            'lat' => isset($item['lat']) && is_numeric($item['lat']) ? (float) $item['lat'] : null,
            'lng' => isset($item['lon']) && is_numeric($item['lon']) ? (float) $item['lon'] : null,
            'neighborhood' => $addr['suburb'] ?? $addr['neighbourhood'] ?? $addr['quarter'] ?? $addr['city_district'] ?? null,
            'city' => $addr['city'] ?? $addr['town'] ?? $addr['village'] ?? $addr['municipality'] ?? null,
            'state' => $addr['state'] ?? null,
            'display_name' => $item['display_name'] ?? null,
        ];
    }

    private static function normalizeQuery(string $q): string
    {
        return preg_replace('/\s+/', ' ', mb_strtolower(trim($q))) ?? '';
    }

    /** @return array{lat:?float,lng:?float,neighborhood:?string,city:?string,state:?string,display_name:?string}|null */
    private static function cacheGet(string $key, string $kind): ?array
    {
        $row = Db::queryOne(
            'SELECT lat, lng, neighborhood, city, state, display_name FROM geocode_cache WHERE query_key = ? AND kind = ?',
            [$key, $kind]
        );
        if (!$row) {
            return null;
        }
        return [
            'lat' => $row['lat'] !== null ? (float) $row['lat'] : null,
            'lng' => $row['lng'] !== null ? (float) $row['lng'] : null,
            'neighborhood' => $row['neighborhood'],
            'city' => $row['city'],
            'state' => $row['state'],
            'display_name' => $row['display_name'],
        ];
    }

    /** @param array{lat:?float,lng:?float,neighborhood:?string,city:?string,state:?string,display_name:?string} $r */
    private static function cacheSet(string $key, string $kind, array $r): void
    {
        Db::execute(
            'INSERT INTO geocode_cache (query_key, kind, lat, lng, neighborhood, city, state, display_name)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE lat = VALUES(lat), lng = VALUES(lng), neighborhood = VALUES(neighborhood),
               city = VALUES(city), state = VALUES(state), display_name = VALUES(display_name)',
            [$key, $kind, $r['lat'], $r['lng'], $r['neighborhood'], $r['city'], $r['state'], $r['display_name']]
        );
    }
}
