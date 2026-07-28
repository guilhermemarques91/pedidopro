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

    public static function storeSettings(int $orgId): array
    {
        $row = Db::queryOne('SELECT * FROM store_settings WHERE org_id = ?', [$orgId]) ?? ['org_id' => $orgId];
        // DECIMAL sai como string do PDO; o frontend (e o cálculo de distância) esperam número.
        $row['lat'] = isset($row['lat']) && $row['lat'] !== null ? (float) $row['lat'] : null;
        $row['lng'] = isset($row['lng']) && $row['lng'] !== null ? (float) $row['lng'] : null;
        return $row;
    }

    /** Atualiza o endereço da loja; geocodifica automaticamente se lat/lng não vierem explícitos e o endereço mudou. */
    public static function saveStoreSettings(array $fields, int $orgId): array
    {
        $current = self::storeSettings($orgId);
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

        // A org 1 já é semeada pela migration; para outras orgs, garante a linha (upsert).
        Db::execute(
            'INSERT INTO store_settings (org_id) VALUES (?) ON DUPLICATE KEY UPDATE org_id = org_id',
            [$orgId]
        );
        Db::execute(
            'UPDATE store_settings SET name=?, street=?, number=?, complement=?, neighborhood=?, city=?, state=?, postal_code=?, formatted_address=?, lat=?, lng=?, geocoded_at=? WHERE org_id = ?',
            [
                $merged['name'] ?? null, $merged['street'] ?? null, $merged['number'] ?? null,
                $merged['complement'] ?? null, $merged['neighborhood'] ?? null, $merged['city'] ?? null,
                $merged['state'] ?? null, $merged['postal_code'] ?? null, $merged['formatted_address'] ?? null,
                $lat, $lng, $geocodedAt, $orgId,
            ]
        );
        return self::storeSettings($orgId);
    }

    /**
     * Backfill em lote, bounded: geocodifica pedidos sem lat/lng e reverse-geocodifica
     * pedidos sem sugestão de bairro. usleep entre chamadas de rede respeita o limite
     * do Nominatim (~1 req/seg). Só toca pedidos que já têm delivery_address.
     * @return array{geocoded:int,reverse_geocoded:int,remaining:int}
     */
    /** Resultado a mais de 50km da loja = rua homônima em outra cidade; rejeita. */
    private const MAX_GEOCODE_DISTANCE_M = 50_000;

    public static function backfill(int $limit, int $orgId): array
    {
        $geocoded = 0;
        $reverseGeocoded = 0;
        $rejected = 0;
        $notFound = 0;
        $store = self::storeSettings($orgId);
        $sLat = $store['lat'];
        $sLng = $store['lng'];

        // geocode_failed marca endereços já rejeitados (fora do raio) — não re-tenta
        // a cada rodada, senão o lote inteiro se esgota nos mesmos endereços ruins.
        $rows = Db::query(
            "SELECT id, delivery_address FROM delivery_orders
              WHERE delivery_address IS NOT NULL
                AND org_id = ?
                AND JSON_EXTRACT(delivery_address, '$.lat') IS NULL
                AND JSON_EXTRACT(delivery_address, '$.geocode_failed') IS NULL
              ORDER BY created_at DESC
              LIMIT " . max(1, $limit),
            [$orgId]
        );
        foreach ($rows as $row) {
            $addr = json_decode((string) $row['delivery_address'], true);
            if (!is_array($addr)) {
                continue;
            }
            $g = self::geocodeWithFallback($addr, $store);
            if ($g !== null && $g['lat'] !== null && $g['lng'] !== null) {
                $far = $sLat !== null && $sLng !== null
                    && self::haversineMeters($sLat, $sLng, $g['lat'], $g['lng']) > self::MAX_GEOCODE_DISTANCE_M;
                if ($far) {
                    $addr['geocode_failed'] = 'far_from_store';
                    $rejected++;
                } else {
                    $addr['lat'] = $g['lat'];
                    $addr['lng'] = $g['lng'];
                    $addr['geocode_source'] = 'nominatim';
                    $addr['geocode_precision'] = $g['precision'] ?? null; // street|neighborhood
                    $addr['geocoded_at'] = date('c');
                    $geocoded++;
                }
            } else {
                // Endereço que o OpenStreetMap não conhece: marca para não re-tentar em
                // toda rodada (fica sem pin; melhor cinza do que um pin errado).
                $addr['geocode_failed'] = 'not_found';
                $notFound++;
            }
            Db::execute('UPDATE delivery_orders SET delivery_address = ? WHERE id = ?', [
                json_encode($addr, JSON_UNESCAPED_UNICODE), $row['id'],
            ]);
            usleep(1_100_000);
        }

        $rows2 = Db::query(
            "SELECT id, delivery_address FROM delivery_orders
              WHERE delivery_address IS NOT NULL
                AND org_id = ?
                AND JSON_EXTRACT(delivery_address, '$.lat') IS NOT NULL
                AND JSON_EXTRACT(delivery_address, '$.suggested_neighborhood') IS NULL
              ORDER BY created_at DESC
              LIMIT " . max(1, $limit),
            [$orgId]
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
            "SELECT COUNT(*) AS n FROM delivery_orders
              WHERE delivery_address IS NOT NULL AND org_id = ?
                AND JSON_EXTRACT(delivery_address, '$.lat') IS NULL
                AND JSON_EXTRACT(delivery_address, '$.geocode_failed') IS NULL",
            [$orgId]
        )['n'] ?? 0);

        return ['geocoded' => $geocoded, 'reverse_geocoded' => $reverseGeocoded, 'rejected' => $rejected, 'not_found' => $notFound, 'remaining' => $remaining];
    }

    /**
     * Tenta geocodificar UM pedido sob demanda (botão "Tentar localizar" na tela).
     * Diferente do backfill, ignora o carimbo `geocode_failed`: é um pedido explícito
     * do operador, normalmente logo depois de ele corrigir a rua/bairro à mão.
     *
     * @return array{ok:bool,reason:?string,lat:?float,lng:?float}
     */
    public static function geocodeOrder(int $orderId, int $orgId): array
    {
        $row = Db::queryOne(
            'SELECT delivery_address FROM delivery_orders WHERE id = ? AND org_id = ?',
            [$orderId, $orgId]
        );
        $addr = $row !== null ? json_decode((string) $row['delivery_address'], true) : null;
        if (!is_array($addr)) {
            return ['ok' => false, 'reason' => 'no_address', 'lat' => null, 'lng' => null];
        }

        $store = self::storeSettings($orgId);
        $g = self::geocodeWithFallback($addr, $store);
        if ($g === null || $g['lat'] === null || $g['lng'] === null) {
            $addr['geocode_failed'] = 'not_found';
            self::persist($orderId, $addr);
            return ['ok' => false, 'reason' => 'not_found', 'lat' => null, 'lng' => null];
        }

        $sLat = $store['lat'];
        $sLng = $store['lng'];
        if ($sLat !== null && $sLng !== null
            && self::haversineMeters($sLat, $sLng, $g['lat'], $g['lng']) > self::MAX_GEOCODE_DISTANCE_M) {
            $addr['geocode_failed'] = 'far_from_store';
            self::persist($orderId, $addr);
            return ['ok' => false, 'reason' => 'far_from_store', 'lat' => null, 'lng' => null];
        }

        $addr['lat'] = $g['lat'];
        $addr['lng'] = $g['lng'];
        $addr['geocode_source'] = 'nominatim';
        $addr['geocode_precision'] = $g['precision'] ?? null;
        $addr['geocoded_at'] = date('c');
        unset($addr['geocode_failed']);
        self::persist($orderId, $addr);

        return ['ok' => true, 'reason' => null, 'lat' => $g['lat'], 'lng' => $g['lng']];
    }

    /** Sugere o bairro real a partir de uma coordenada (usado após o pin manual). */
    public static function suggestNeighborhood(int $orderId, array $addr, float $lat, float $lng): array
    {
        $g = NominatimClient::reverseGeocode($lat, $lng);
        if ($g !== null) {
            $addr['suggested_neighborhood'] = $g['neighborhood'];
            $addr['neighborhood_mismatch'] = self::mismatch($addr['neighborhood'] ?? null, $g['neighborhood']);
            self::persist($orderId, $addr);
        }
        return $addr;
    }

    private static function persist(int $orderId, array $addr): void
    {
        Db::execute('UPDATE delivery_orders SET delivery_address = ? WHERE id = ?', [
            json_encode($addr, JSON_UNESCAPED_UNICODE), $orderId,
        ]);
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

    /**
     * Geocodifica tentando do mais específico ao mais genérico. O Nominatim raramente
     * resolve "rua + número + bairro" num free-text só (testado: falha até com endereço
     * limpo), mas resolve bem rua+cidade, CEP+cidade e bairro+cidade — precisão de rua
     * já basta para o relatório de distância. Cidade/UF ausentes caem para as da LOJA
     * (sem cidade o Nominatim acha rua homônima em outra cidade).
     */
    /**
     * Lê um pedaço do endereço aceitando as várias grafias que as plataformas usam.
     * O payload NÃO é padronizado: a maioria dos pedidos vem com `street`/`number`, mas
     * parte vem com `streetName`/`streetNumber` — ler só a primeira grafia fazia esses
     * caírem direto no fallback de bairro, sem nunca tentar geocodificar a rua.
     */
    private static function addrPart(array $addr, string ...$keys): ?string
    {
        foreach ($keys as $k) {
            if (isset($addr[$k]) && trim((string) $addr[$k]) !== '') {
                return trim((string) $addr[$k]);
            }
        }
        return null;
    }

    private static function geocodeWithFallback(array $addr, array $store): ?array
    {
        $city = self::addrPart($addr, 'city') ?? trim((string) ($store['city'] ?? ''));
        $state = self::addrPart($addr, 'state') ?? trim((string) ($store['state'] ?? ''));
        $suffix = implode(', ', array_filter([$city ?: null, $state ?: null, 'Brasil']));

        $street = self::normalizePart(self::addrPart($addr, 'street', 'streetName', 'street_name'));
        $number = (string) (self::addrPart($addr, 'number', 'streetNumber', 'street_number') ?? '');
        $neighborhood = self::normalizePart(self::addrPart($addr, 'neighborhood', 'district'));

        // [query, termo que o resultado PRECISA citar, precisão]. Sem tentativa por CEP:
        // o Nominatim não resolve CEP brasileiro — devolve o centroide da cidade (ou um
        // bairro aleatório) fingindo sucesso, e o pin cai longe do endereço real.
        $tries = [];
        if ($street !== null) {
            if ($number !== '') {
                $tries[] = ["{$street} {$number}, {$suffix}", $street, 'street'];
            }
            $tries[] = ["{$street}, {$suffix}", $street, 'street'];
        }
        if ($neighborhood !== null) {
            $tries[] = ["{$neighborhood}, {$suffix}", $neighborhood, 'neighborhood'];
        }

        $seen = [];
        $first = true;
        foreach ($tries as [$q, $mustContain, $precision]) {
            if (isset($seen[$q])) {
                continue;
            }
            $seen[$q] = true;
            if (!$first) {
                usleep(1_100_000); // limite de uso do Nominatim (~1 req/s) entre tentativas
            }
            $first = false;
            $g = NominatimClient::geocode($q);
            if ($g === null || $g['lat'] === null || $g['lng'] === null) {
                continue;
            }
            // O Nominatim "acha alguma coisa" mesmo sem ter o dado (ex.: só a cidade):
            // válido apenas se o resultado citar a rua/bairro pedidos. Sem match em
            // nenhuma tentativa, o pedido fica SEM coordenada (pin cinza) — honesto,
            // em vez de um pin confiante no lugar errado.
            $display = self::normalizeText((string) ($g['display_name'] ?? ''));
            if ($display === '' || !str_contains($display, self::normalizeText($mustContain))) {
                continue;
            }
            $g['precision'] = $precision;
            return $g;
        }
        return null;
    }

    /**
     * Limpa um pedaço de endereço vindo da plataforma: o 99Food abrevia com espaços
     * estranhos ("R . Geraldo Ribeiro", "Maria Imac .") que o Nominatim não entende.
     */
    private static function normalizePart(?string $v): ?string
    {
        $v = trim((string) $v);
        if ($v === '') {
            return null;
        }
        $v = (string) preg_replace('/\s+\.\s*/', ' ', $v); // "R . X" -> "R X"; "Imac ." -> "Imac"
        $v = (string) preg_replace('/\s{2,}/', ' ', trim($v));
        $abbr = [
            '/^r\.?\s+/iu' => 'Rua ',
            '/^av\.?\s+/iu' => 'Avenida ',
            '/^tv\.?\s+/iu' => 'Travessa ',
            '/^al\.?\s+/iu' => 'Alameda ',
            '/^(pç|pc|pca)\.?\s+/iu' => 'Praça ',
            '/^rod\.?\s+/iu' => 'Rodovia ',
            '/^estr\.?\s+/iu' => 'Estrada ',
        ];
        foreach ($abbr as $re => $full) {
            $n = preg_replace($re, $full, $v, 1, $count);
            if ($count > 0) {
                $v = (string) $n;
                break;
            }
        }
        return $v !== '' ? $v : null;
    }

    /** Monta a query de geocodificação; $fallback (endereço da loja) preenche cidade/UF ausentes. */
    private static function addressQuery(array $a, array $fallback = []): string
    {
        $line = trim(($a['street'] ?? '') . ' ' . ($a['number'] ?? ''));
        $city = trim((string) ($a['city'] ?? '')) !== '' ? $a['city'] : ($fallback['city'] ?? null);
        $state = trim((string) ($a['state'] ?? '')) !== '' ? $a['state'] : ($fallback['state'] ?? null);
        $parts = array_filter(
            [$line, $a['neighborhood'] ?? null, $city, $state, $a['postal_code'] ?? null, 'Brasil'],
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
