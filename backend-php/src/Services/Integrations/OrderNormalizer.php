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

    /** 99Food: status cru → status unificado. */
    private const NINE_NINE_STATUS = [
        'RECEIVED' => 'placed', 'PLACED' => 'placed',
        'CONFIRMED' => 'confirmed', 'ACCEPTED' => 'confirmed',
        'PREPARING' => 'preparing',
        'READY_FOR_PICKUP' => 'ready', 'READY' => 'ready',
        'DISPATCHED' => 'dispatched', 'OUT_FOR_DELIVERY' => 'dispatched',
        'CONCLUDED' => 'concluded', 'DELIVERED' => 'concluded', 'COMPLETED' => 'concluded',
        'CANCELED' => 'cancelled', 'CANCELLED' => 'cancelled',
    ];

    public static function mapStatus(string $platform, ?string $raw): string
    {
        if ($raw === null || $raw === '') {
            return 'placed';
        }
        $key = strtoupper($raw);
        $map = $platform === 'ifood' ? self::IFOOD_STATUS : self::NINE_NINE_STATUS;
        return $map[$key] ?? 'placed';
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
            'delivery_address' => $address,
            'delivery_distance_m' => isset($delivery['distance']) ? (int) round(((float) $delivery['distance']) * 1000) : null,
            'eta' => self::ts($delivery['deliveryDateTime'] ?? null),
            'customer_name' => $customer['name'] ?? null,
            'customer_phone' => $phone,
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

    private static function nineNine(array $o): array
    {
        $customer = $o['customer'] ?? ($o['client'] ?? []);
        $delivery = $o['delivery'] ?? [];
        $address = $delivery['address'] ?? ($o['deliveryAddress'] ?? null);

        $items = [];
        foreach (($o['items'] ?? []) as $it) {
            $items[] = [
                'name' => (string) ($it['name'] ?? 'Item'),
                'quantity' => (float) ($it['quantity'] ?? 1),
                'unit_price' => self::money($it['unitPrice'] ?? $it['price'] ?? null),
                'total' => self::money($it['totalPrice'] ?? $it['total'] ?? null),
                'observations' => $it['observations'] ?? ($it['notes'] ?? null),
                'options' => $it['options'] ?? ($it['complements'] ?? null),
            ];
        }

        $distance = $delivery['distance'] ?? null; // metros, geralmente
        $phone = $customer['phone'] ?? ($customer['phoneNumber'] ?? null);
        $order = [
            'platform_order_id' => (string) ($o['id'] ?? ($o['orderId'] ?? '')),
            'display_id' => $o['shortReference'] ?? ($o['code'] ?? ($o['displayId'] ?? null)),
            'merchant_id' => $o['merchantId'] ?? ($o['storeId'] ?? null),
            'platform_status' => $o['status'] ?? null,
            'status' => self::mapStatus('99food', $o['status'] ?? null),
            'order_type' => strtolower((string) ($o['orderType'] ?? ($o['type'] ?? 'delivery'))),
            'delivery_mode' => self::nineNineMode($delivery),
            'delivery_address' => $address,
            'delivery_distance_m' => $distance !== null ? (int) $distance : null,
            'eta' => self::ts($delivery['estimatedDeliveryTime'] ?? ($o['eta'] ?? null)),
            'customer_name' => $customer['name'] ?? null,
            'customer_phone' => $phone,
            'items_amount' => self::money($o['subtotal'] ?? ($o['itemsAmount'] ?? null)),
            'delivery_fee' => self::money($delivery['fee'] ?? ($o['deliveryFee'] ?? null)),
            'discount_merchant' => self::money($o['merchantDiscount'] ?? null),
            'discount_platform' => self::money($o['platformDiscount'] ?? null),
            'customer_paid' => self::money($o['totalAmount'] ?? ($o['total'] ?? null)),
            'commission' => self::money($o['commission'] ?? null),
            'placed_at' => self::ts($o['createdAt'] ?? ($o['placedAt'] ?? null)),
        ];

        return [
            'order' => $order,
            'items' => $items,
            'customer' => [
                'platform_customer_id' => $customer['id'] ?? ($customer['customerId'] ?? null),
                'name' => $customer['name'] ?? null,
                'phone' => $phone,
            ],
        ];
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

    private static function nineNineMode(array $delivery): ?string
    {
        $mode = strtoupper((string) ($delivery['mode'] ?? ($delivery['type'] ?? '')));
        if ($mode !== '') {
            return in_array($mode, ['OWN', 'MERCHANT', 'SELF'], true) ? 'own' : 'partner';
        }
        // Fallback pelo modelo híbrido: até 2km = própria.
        $distance = $delivery['distance'] ?? null;
        if ($distance !== null) {
            return ((int) $distance) <= 2000 ? 'own' : 'partner';
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
