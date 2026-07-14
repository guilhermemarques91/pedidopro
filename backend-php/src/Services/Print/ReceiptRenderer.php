<?php

namespace App\Services\Print;

/**
 * Porte PHP de frontend/src/pages/Delivery/OrderReceipt/receipt.ts — a comanda
 * térmica precisa sair igual venha ela do navegador (impressão manual) ou do
 * poller local em segundo plano (bin/poll.php --loop). Mantém as DUAS
 * implementações em sincronia manualmente se o layout mudar de um lado.
 */
final class ReceiptRenderer
{
    public const PAPER_WIDTH_MM = 76.0;

    public const CSS = <<<CSS
@page { size: 76mm auto; margin: 0; }
html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
@media print { .no-print { display: none !important; } }
.rc { width: 76mm; box-sizing: border-box; padding: 3mm 4mm; margin: 0; background: #fff; color: #000;
  font-family: 'Courier New', ui-monospace, monospace; font-size: 12pt; line-height: 1.32; font-weight: bold;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.rc * { box-sizing: border-box; }
.rc-brand { text-align: center; font-size: 20pt; font-weight: bold; letter-spacing: 1px; }
.rc-num { text-align: center; font-size: 20pt; font-weight: bold; margin: 0.5mm 0; }
.rc-plat { text-align: center; font-size: 10pt; font-weight: bold; }
.rc-type { text-align: center; font-weight: bold; border: 2px solid #000; padding: 1mm 0; margin-top: 1mm; }
.rc-cook { text-align: center; font-weight: bold; font-size: 13pt; margin-top: 1mm; }
.rc-loc { text-align: center; font-weight: bold; font-size: 13pt; border: 2px solid #000; padding: 1mm 0; margin-top: 1mm; }
.rc-line { font-size: 11pt; font-weight: bold; }
.rc-h { font-weight: bold; font-size: 10pt; letter-spacing: 1px; margin: 1mm 0; }
.rc-hr { border-top: 2px solid #000; margin: 2mm 0; }
.rc-hr-d { border-top: 2px dashed #000; margin: 2mm 0; }
.rc-sep-item { border-top: 1px dashed #000; margin: 2mm 0; }
.rc-item { display: flex; gap: 2.5mm; break-inside: avoid; }
.rc-qty { font-size: 17pt; font-weight: bold; min-width: 11mm; }
.rc-body { flex: 1; }
.rc-name { font-size: 14pt; font-weight: bold; text-transform: uppercase; }
.rc-opt { font-size: 11pt; font-weight: bold; padding-left: 1mm; }
.rc-obs { display: inline-block; background: #000; color: #fff; font-weight: bold; padding: 0.5mm 1.5mm; margin-top: 0.5mm; font-size: 11pt; }
.rc-note { background: #000; color: #fff; font-weight: bold; padding: 1.5mm 2mm; margin: 2.5mm 0; font-size: 12.5pt; }
.rc-row { display: flex; justify-content: space-between; font-size: 11.5pt; font-weight: bold; }
.rc-total { font-size: 16pt; font-weight: bold; margin-top: 1mm; }
.rc-foot { text-align: center; font-size: 9pt; font-weight: bold; margin-top: 2mm; }
CSS;

    private static function esc(mixed $s): string
    {
        return htmlspecialchars((string) ($s ?? ''), ENT_QUOTES, 'UTF-8');
    }

    private static function brl(mixed $v): string
    {
        if ($v === null || $v === '') {
            return '—';
        }
        $n = is_string($v) ? (float) $v : (float) $v;
        if (!is_finite($n)) {
            return '—';
        }
        return 'R$ ' . number_format($n, 2, ',', '.');
    }

    private static function datetime(?string $iso): string
    {
        if (!$iso) {
            return '—';
        }
        $ts = strtotime($iso);
        return $ts === false ? '—' : date('d/m/Y H:i', $ts);
    }

    /** Espelha utils/format.ts::formatAddress — aceita objeto (array assoc) já decodificado. */
    private static function formatAddress(mixed $addr): string
    {
        if (!is_array($addr)) {
            return '';
        }
        $get = static function (array $keys) use ($addr): string {
            foreach ($keys as $k) {
                $v = $addr[$k] ?? null;
                if ($v !== null && trim((string) $v) !== '') {
                    return trim((string) $v);
                }
            }
            return '';
        };
        $line = implode(', ', array_filter([
            $get(['street', 'streetName', 'street_name']),
            $get(['number', 'streetNumber', 'street_number']),
        ]));
        $parts = array_filter([
            $line,
            $get(['complement']),
            $get(['neighborhood', 'district']),
            $get(['city']),
            $get(['state']),
            $get(['postal_code', 'postalCode', 'zipCode']),
        ]);
        return $parts ? implode(' · ', $parts) : $get(['formatted', 'poi_address', 'formattedAddress']);
    }

    /** Espelha utils/format.ts::parseOptions — normaliza options[] (iFood) / sub_item_list[] (99Food). */
    private static function parseOptions(mixed $v): array
    {
        $arr = $v;
        if (is_string($v) && trim($v) !== '') {
            $decoded = json_decode($v, true);
            $arr = is_array($decoded) ? $decoded : null;
        }
        if (!is_array($arr)) {
            return [];
        }
        $pickStr = static function (array $o, array $keys): ?string {
            foreach ($keys as $k) {
                $x = $o[$k] ?? null;
                if ($x !== null && trim((string) $x) !== '') {
                    return trim((string) $x);
                }
            }
            return null;
        };
        $pickNum = static function (array $o, array $keys): ?float {
            foreach ($keys as $k) {
                $x = $o[$k] ?? null;
                if ($x !== null && $x !== '' && is_numeric($x)) {
                    return (float) $x;
                }
            }
            return null;
        };
        $out = [];
        foreach ($arr as $raw) {
            if (!is_array($raw)) {
                continue;
            }
            $name = $pickStr($raw, ['name', 'sub_item_name', 'itemName', 'complementName', 'description']);
            if ($name !== null) {
                $out[] = ['name' => $name, 'quantity' => $pickNum($raw, ['quantity', 'amount', 'count'])];
            }
            $nested = $raw['sub_item_list'] ?? $raw['options'] ?? $raw['garnishItems'] ?? null;
            if (is_array($nested)) {
                $out = [...$out, ...self::parseOptions($nested)];
            }
        }
        return $out;
    }

    /**
     * Renderiza a comanda. $order é a linha de delivery_orders (array assoc, com
     * delivery_address já decodificado se JSON) + 'items' (array de delivery_order_items,
     * cada um com 'options' já decodificado). $variant: 'kitchen' ou 'counter'.
     */
    public static function html(array $order, string $variant = 'counter'): string
    {
        $isKitchen = $variant === 'kitchen';
        $plat = ($order['platform'] ?? '') === 'ifood' ? 'iFood' : '99Food';
        $num = !empty($order['display_id']) ? "#{$order['display_id']}" : "#{$order['id']}";
        $mode = ($order['delivery_mode'] ?? null) === 'own' ? 'ENTREGA PRÓPRIA'
            : (($order['delivery_mode'] ?? null) === 'partner' ? 'ENTREGA PARCEIRA' : '');
        $addr = self::formatAddress($order['delivery_address'] ?? null);
        $rawRef = is_array($order['delivery_address'] ?? null) ? ($order['delivery_address']['reference'] ?? null) : null;
        $ref = is_string($rawRef) ? trim($rawRef) : '';

        $itemsHtml = [];
        foreach ($order['items'] ?? [] as $it) {
            $opts = '';
            foreach (self::parseOptions($it['options'] ?? null) as $op) {
                $qty = ($op['quantity'] ?? null) && $op['quantity'] > 1 ? self::esc((int) $op['quantity']) . 'x ' : '';
                $opts .= '<div class="rc-opt">' . $qty . self::esc($op['name']) . '</div>';
            }
            $obs = !empty($it['observations'])
                ? '<div class="rc-obs">» ' . mb_strtoupper(self::esc($it['observations'])) . '</div>' : '';
            $itemsHtml[] = '<div class="rc-item"><div class="rc-qty">' . self::esc((int) $it['quantity']) . 'x</div>'
                . '<div class="rc-body"><div class="rc-name">' . self::esc($it['name']) . '</div>' . $opts . $obs . '</div></div>';
        }
        $items = implode('<div class="rc-sep-item"></div>', $itemsHtml);

        $note = !empty($order['customer_notes'])
            ? '<div class="rc-note">OBS DO PEDIDO:<br>' . mb_strtoupper(self::esc($order['customer_notes'])) . '</div>' : '';

        $money = $isKitchen ? '' : '<div class="rc-hr"></div>'
            . '<div class="rc-row"><span>Itens</span><span>' . self::esc(self::brl($order['items_amount'] ?? null)) . '</span></div>'
            . '<div class="rc-row"><span>Taxa entrega</span><span>' . self::esc(self::brl($order['delivery_fee'] ?? null)) . '</span></div>'
            . (!empty($order['discount_platform']) ? '<div class="rc-row"><span>Desc. plataforma</span><span>- ' . self::esc(self::brl($order['discount_platform'])) . '</span></div>' : '')
            . (!empty($order['discount_merchant']) ? '<div class="rc-row"><span>Desc. loja</span><span>- ' . self::esc(self::brl($order['discount_merchant'])) . '</span></div>' : '')
            . '<div class="rc-row rc-total"><span>TOTAL</span><span>' . self::esc(self::brl($order['customer_paid'] ?? null)) . '</span></div>';

        $delivery = ($isKitchen || !$addr) ? '' : '<div class="rc-hr-d"></div>'
            . '<div class="rc-line"><b>ENTREGA:</b></div>'
            . '<div class="rc-line">' . self::esc($addr) . '</div>'
            . ($ref !== '' ? '<div class="rc-line">Ref.: ' . self::esc($ref) . '</div>' : '');

        $footer = $isKitchen ? '' : '<div class="rc-foot">' . self::esc($plat) . ' ID: ' . self::esc($order['platform_order_id'] ?? '') . '</div>';

        return '<div class="rc">'
            . '<div class="rc-brand">' . mb_strtoupper(self::esc($plat)) . '</div>'
            . '<div class="rc-num">PEDIDO ' . self::esc($num) . '</div>'
            . '<div class="rc-plat">' . self::esc(self::datetime($order['placed_at'] ?? $order['created_at'] ?? null)) . '</div>'
            . ($mode ? '<div class="rc-type">' . self::esc($mode) . '</div>' : '')
            . (!empty($order['locator']) ? '<div class="rc-loc">LOCALIZADOR: ' . self::esc($order['locator']) . '</div>' : '')
            . ($isKitchen ? '<div class="rc-cook">** COZINHA **</div>' : '')
            . '<div class="rc-hr-d"></div>'
            . '<div class="rc-line">CLIENTE: <b>' . self::esc($order['customer_name'] ?? '—') . '</b></div>'
            . (!$isKitchen && !empty($order['customer_phone']) ? '<div class="rc-line">TEL: ' . self::esc($order['customer_phone']) . '</div>' : '')
            . '<div class="rc-hr"></div>'
            . '<div class="rc-h">ITENS</div>'
            . $items
            . $note
            . $money
            . $delivery
            . $footer
            . '</div>';
    }
}
