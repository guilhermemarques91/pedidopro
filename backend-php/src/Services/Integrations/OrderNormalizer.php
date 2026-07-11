<?php

namespace App\Services\Integrations;

/**
 * Converte o payload cru de cada plataforma para o modelo unificado de
 * delivery_orders / delivery_order_items / delivery_customers.
 *
 * Tudo é defensivo (?? null): payloads variam por versão e por tipo de pedido.
 */
final class OrderNormalizer
{
    /** Status unificados aceitos pela aplicação. */
    public const STATUSES = ['placed', 'confirmed', 'preparing', 'ready', 'dispatched', 'concluded', 'cancelled'];

    /** iFood: code/fullCode/status cru → status unificado. */
    private const IFOOD_STATUS = [
        'PLACED' => 'placed', 'PLC' => 'placed',
        'CONFIRMED' => 'confirmed', 'CFM' => 'confirmed',
        'SEPARATION_STARTED' => 'preparing', 'PREPARATION_STARTED' => 'preparing', 'SPS' => 'preparing', 'PRS' => 'preparing',
        'READY_TO_PICKUP' => 'ready', 'RTP' => 'ready',
        'DISPATCHED' => 'dispatched', 'DSP' => 'dispatched',
        'CONCLUDED' => 'concluded', 'CON' => 'concluded',
        'CANCELLED' => 'cancelled', 'CAN' => 'cancelled', 'CANCELLATION_REQUESTED' => 'cancelled',
    ];

    /** 99Food/DiDi: eventos do callback (orderNew/Finish/Cancel) → status unificado. */
    private const NINE_NINE_STATUS = [
        'ORDERNEW' => 'placed', 'RECEIVED' => 'placed', 'PLACED' => 'placed',
        'CONFIRMED' => 'confirmed', 'ACCEPTED' => 'confirmed',
        'PREPARING' => 'preparing',
        'READY_FOR_PICKUP' => 'ready', 'READY' => 'ready',
        'DISPATCHED' => 'dispatched', 'OUT_FOR_DELIVERY' => 'dispatched',
        'ORDERFINISH' => 'concluded', 'CONCLUDED' => 'concluded', 'DELIVERED' => 'concluded', 'COMPLETED' => 'concluded',
        'ORDERCANCEL' => 'cancelled', 'CANCELED' => 'cancelled', 'CANCELLED' => 'cancelled',
    ];

    /** Lookup cru → status unificado, ou null se não reconhecido. */
    public static function statusFromRaw(string $platform, ?string $raw): ?string
    {
        if ($raw === null || $raw === '') {
            return null;
        }
        $map = $platform === 'ifood' ? self::IFOOD_STATUS : self::NINE_NINE_STATUS;
        return $map[strtoupper($raw)] ?? null;
    }

    public static function mapStatus(string $platform, ?string $raw): string
    {
        return self::statusFromRaw($platform, $raw) ?? 'placed';
    }

    /**
     * @return array{order:array<string,mixed>,items:array<int,array<string,mixed>>,customer:array<string,mixed>}
     */
    public static function normalize(string $platform, array $raw): array
    {
        return $platform === 'ifood' ? self::ifood($raw) : self::nineNine($raw);
    }

    private static function ifood(array $o): array
    {
        $customer = $o['customer'] ?? [];
        $delivery = $o['delivery'] ?? [];
        $total = $o['total'] ?? [];
        $address = $delivery['deliveryAddress'] ?? null;

        $items = [];
        foreach (($o['items'] ?? []) as $it) {
            $items[] = [
                'name' => (string) ($it['name'] ?? 'Item'),
                'quantity' => (float) ($it['quantity'] ?? 1),
                'unit_price' => self::money($it['unitPrice'] ?? $it['price'] ?? null),
                'total' => self::money($it['totalPrice'] ?? $it['total'] ?? null),
                'observations' => $it['observations'] ?? null,
                'options' => $it['options'] ?? null,
            ];
        }

        // Descontos: benefícios patrocinados pelo iFood vs. pela loja.
        [$discMerchant, $discPlatform] = self::ifoodBenefits($o['benefits'] ?? []);

        $phone = $customer['phone']['number'] ?? ($customer['phone'] ?? null);
        $order = [
            'platform_order_id' => (string) ($o['id'] ?? ''),
            'display_id' => $o['displayId'] ?? null,
            'merchant_id' => $o['merchant']['id'] ?? ($o['merchantId'] ?? null),
            'platform_status' => $o['status'] ?? null,
            'status' => self::mapStatus('ifood', $o['status'] ?? null),
            'order_type' => strtolower((string) ($o['orderType'] ?? 'delivery')),
            'delivery_mode' => self::ifoodMode($delivery),
            'delivery_address' => self::address('ifood', $address),
            'delivery_distance_m' => isset($delivery['distance']) ? (int) round(((float) $delivery['distance']) * 1000) : null,
            'eta' => self::ts($delivery['deliveryDateTime'] ?? null),
            'customer_name' => $customer['name'] ?? null,
            'customer_phone' => $phone,
            // Observação em nível de pedido (talheres, "cancelar só o que faltar", etc.).
            'customer_notes' => self::firstStr($o, ['observations', 'note', 'deliveryObservations', 'additionalInfo']),
            'items_amount' => self::money($total['subTotal'] ?? null),
            'delivery_fee' => self::money($total['deliveryFee'] ?? ($delivery['deliveryFee'] ?? null)),
            'discount_merchant' => $discMerchant,
            'discount_platform' => $discPlatform,
            'customer_paid' => self::money($total['orderAmount'] ?? null),
            'placed_at' => self::ts($o['createdAt'] ?? null),
        ];

        return [
            'order' => $order,
            'items' => $items,
            'customer' => [
                'platform_customer_id' => $customer['id'] ?? null,
                'name' => $customer['name'] ?? null,
                'phone' => $phone,
            ],
        ];
    }

    /** 99Food/DiDi OrderModel (valores em centavos; status numérico). */
    private static function nineNine(array $o): array
    {
        $shop = $o['shop'] ?? [];
        $addr = $o['receive_address'] ?? [];
        $price = $o['price'] ?? [];

        $items = [];
        foreach (($o['order_items'] ?? []) as $it) {
            $items[] = [
                'name' => (string) ($it['name'] ?? 'Item'),
                'quantity' => (float) ($it['amount'] ?? 1),
                'unit_price' => self::cents($it['sku_price'] ?? null),
                'total' => self::cents($it['real_price'] ?? ($it['total_price'] ?? null)),
                'observations' => $it['remark'] ?? null,
                'options' => $it['sub_item_list'] ?? null,
            ];
        }

        // Descontos: shop_subside_price = parte que a LOJA banca; resto = plataforma.
        [$discMerchant, $discPlatform] = self::nineNineDiscounts($o['promotions'] ?? [], $price);

        // Telefone: calling_code + phone.
        $phone = trim((string) ($addr['calling_code'] ?? '') . ' ' . (string) ($addr['phone'] ?? '')) ?: null;
        $name = $addr['name'] ?? trim((string) ($addr['first_name'] ?? '') . ' ' . (string) ($addr['last_name'] ?? '')) ?: null;

        $order = [
            'platform_order_id' => (string) ($o['order_id'] ?? ''),
            'display_id' => isset($o['order_index']) ? (string) $o['order_index'] : null,
            'merchant_id' => isset($shop['app_shop_id']) ? (string) $shop['app_shop_id'] : null,
            'platform_status' => isset($o['status']) ? (string) $o['status'] : null,
            // status definitivo vem do evento do callback (override no IngestService).
            'status' => 'placed',
            'order_type' => 'delivery',
            // delivery_type: 1 = DiDi (parceira), 2 = Store (própria).
            'delivery_mode' => ((int) ($o['delivery_type'] ?? 1)) === 2 ? 'own' : 'partner',
            'delivery_address' => self::address('99food', $addr),
            'delivery_distance_m' => null,
            'eta' => self::ts($o['expected_arrived_eta'] ?? ($o['delivery_eta'] ?? null)),
            'customer_name' => $name,
            'customer_phone' => $phone,
            // Observação em nível de pedido (talheres, "cancelar só o que faltar", etc.).
            // Chaves defensivas: o OrderModel do 99Food varia; refine ao inspecionar um `raw` real.
            'customer_notes' => self::firstStr($o, ['remark', 'user_remark', 'order_remark', 'buyer_remark', 'user_note', 'note', 'caution']),
            'items_amount' => self::cents($price['order_price'] ?? null),
            'delivery_fee' => self::cents($price['delivery_price'] ?? null),
            'discount_merchant' => $discMerchant,
            'discount_platform' => $discPlatform,
            // Entrega parceira (rider DiDi) só expõe order_price; os demais valores
            // (customer_need_paying_money/real_pay_price/real_price) vêm nulos por
            // privacidade. Cai pro melhor disponível p/ sempre mostrar um valor.
            'customer_paid' => self::cents($price['customer_need_paying_money'] ?? $price['real_pay_price'] ?? $price['real_price'] ?? $price['order_price'] ?? null),
            'placed_at' => self::ts($o['create_time'] ?? null),
        ];

        return [
            'order' => $order,
            'items' => $items,
            'customer' => [
                'platform_customer_id' => isset($addr['uid']) ? (string) $addr['uid'] : null,
                'name' => $name,
                'phone' => $phone,
            ],
        ];
    }

    /**
     * 99Food: separa desconto da loja (shop_subside_price) vs. plataforma.
     * @return array{0:?float,1:?float} [merchant, platform]
     */
    private static function nineNineDiscounts(array $promotions, array $price): array
    {
        $merchantCents = 0;
        $totalCents = 0;
        foreach ($promotions as $p) {
            $totalCents += (int) ($p['save_price'] ?? 0);
            $merchantCents += (int) ($p['shop_subside_price'] ?? 0);
        }
        // Sem detalhamento de promoções: usa os totais de desconto do PriceModel.
        if ($totalCents === 0) {
            $totalCents = (int) ($price['items_discount'] ?? 0) + (int) ($price['delivery_discount'] ?? 0);
        }
        $platformCents = max($totalCents - $merchantCents, 0);
        return [
            $merchantCents > 0 ? round($merchantCents / 100, 2) : null,
            $platformCents > 0 ? round($platformCents / 100, 2) : null,
        ];
    }

    /** Converte centavos (inteiro) para valor decimal. */
    private static function cents(mixed $v): ?float
    {
        if ($v === null || $v === '') {
            return null;
        }
        return is_numeric($v) ? round(((float) $v) / 100, 2) : null;
    }

    /** iFood: separa benefícios em desconto da loja (MERCHANT) vs. plataforma (IFOOD). */
    private static function ifoodBenefits(array $benefits): array
    {
        $merchant = 0.0;
        $platform = 0.0;
        foreach ($benefits as $b) {
            $value = (float) ($b['value'] ?? 0);
            foreach (($b['sponsorshipValues'] ?? []) as $s) {
                $name = strtoupper((string) ($s['name'] ?? ($s['description'] ?? '')));
                $sval = (float) ($s['value'] ?? 0);
                if (str_contains($name, 'MERCHANT') || str_contains($name, 'LOJA') || str_contains($name, 'STORE')) {
                    $merchant += $sval;
                } else {
                    $platform += $sval;
                }
            }
            if (empty($b['sponsorshipValues'])) {
                // Sem detalhamento: trata o alvo como plataforma por padrão.
                $platform += $value;
            }
        }
        return [$merchant ?: null, $platform ?: null];
    }

    private static function ifoodMode(array $delivery): ?string
    {
        $mode = strtoupper((string) ($delivery['mode'] ?? ''));
        if ($mode === '') {
            return 'own'; // iFood do usuário é entrega própria.
        }
        // DEFAULT/MERCHANT = própria; demais (logística iFood) = parceira.
        return in_array($mode, ['DEFAULT', 'MERCHANT'], true) ? 'own' : 'partner';
    }

    /**
     * Normaliza o endereço de entrega (iFood camelCase / 99Food snake_case) num
     * formato único, pro frontend e os relatórios lerem sempre as mesmas chaves.
     * Inclui um 'formatted' pronto pra exibir. Devolve null se não houver endereço.
     * @return array<string,mixed>|null
     */
    private static function address(string $platform, mixed $a): ?array
    {
        if (is_string($a)) {
            $a = json_decode($a, true); // a API às vezes manda o endereço como string JSON
        }
        if (!is_array($a) || !$a) {
            return null;
        }
        if ($platform === '99food') {
            $out = [
                'street' => self::str($a['street_name'] ?? null),
                'number' => self::str($a['street_number'] ?? null),
                'complement' => self::str($a['complement'] ?? null),
                'neighborhood' => self::str($a['district'] ?? null),
                'city' => self::str($a['city'] ?? null),
                'state' => self::str($a['state'] ?? null),
                'postal_code' => self::str($a['postal_code'] ?? null),
                'reference' => self::str($a['reference'] ?? null),
                'lat' => $a['poi_lat'] ?? null,
                'lng' => $a['poi_lng'] ?? null,
                'formatted' => self::str($a['poi_address'] ?? null),
            ];
        } else { // ifood
            $coords = $a['coordinates'] ?? [];
            $out = [
                'street' => self::str($a['streetName'] ?? null),
                'number' => self::str($a['streetNumber'] ?? null),
                'complement' => self::str($a['complement'] ?? null),
                'neighborhood' => self::str($a['neighborhood'] ?? null),
                'city' => self::str($a['city'] ?? null),
                'state' => self::str($a['state'] ?? null),
                'postal_code' => self::str($a['postalCode'] ?? null),
                'reference' => self::str($a['reference'] ?? null),
                'lat' => (is_array($coords) ? ($coords['latitude'] ?? null) : null),
                'lng' => (is_array($coords) ? ($coords['longitude'] ?? null) : null),
                'formatted' => self::str($a['formattedAddress'] ?? null),
            ];
        }
        // Monta um 'formatted' quando a plataforma não manda um pronto.
        if ($out['formatted'] === null) {
            $line = trim(($out['street'] ?? '') . ' ' . ($out['number'] ?? ''));
            $parts = array_filter([$line, $out['neighborhood'], $out['city']]);
            $out['formatted'] = $parts ? implode(', ', $parts) : null;
        }
        return $out;
    }

    /** Trim → string não-vazia, ou null. */
    private static function str(mixed $v): ?string
    {
        $s = is_scalar($v) ? trim((string) $v) : '';
        return $s !== '' ? $s : null;
    }

    /** Primeiro valor de texto não-vazio entre as chaves candidatas (tolerante a payloads variados). */
    private static function firstStr(array $src, array $keys): ?string
    {
        foreach ($keys as $k) {
            if (isset($src[$k]) && is_scalar($src[$k]) && trim((string) $src[$k]) !== '') {
                return trim((string) $src[$k]);
            }
        }
        return null;
    }

    private static function money(mixed $v): ?float
    {
        if ($v === null || $v === '') {
            return null;
        }
        return is_numeric($v) ? round((float) $v, 2) : null;
    }

    /** Normaliza datas ISO/epoch para "Y-m-d H:i:s" (formato do MySQL). */
    private static function ts(mixed $v): ?string
    {
        if ($v === null || $v === '') {
            return null;
        }
        if (is_numeric($v)) {
            // epoch em segundos ou milissegundos.
            $sec = (int) $v;
            if ($sec > 1_000_000_000_000) {
                $sec = (int) ($sec / 1000);
            }
            return date('Y-m-d H:i:s', $sec);
        }
        $t = strtotime((string) $v);
        return $t === false ? null : date('Y-m-d H:i:s', $t);
    }
}
