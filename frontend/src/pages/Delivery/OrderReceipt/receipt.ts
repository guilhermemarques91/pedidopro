import type { DeliveryOrderDetail } from '../../../types';
import { brl, datetime, formatAddress, parseOptions } from '../../../utils/format';

/**
 * CSS da comanda térmica 80mm. Fonte monoespaçada grande p/ leitura na cozinha;
 * `@page size: 80mm auto` deixa a altura livre (cupom contínuo). `.no-print` some
 * na impressão (barra de topo). Reusado pela rota de impressão e pelo agente QZ.
 */
export const RECEIPT_CSS = `
@page { size: 80mm auto; margin: 0; }
@media print { .no-print { display: none !important; } html, body { margin: 0 !important; background: #fff !important; } }
.receipt { width: 80mm; box-sizing: border-box; padding: 3mm 4mm; margin: 0 auto; background: #fff; color: #000;
  font-family: 'Courier New', ui-monospace, monospace; font-size: 12pt; line-height: 1.25; }
.receipt * { box-sizing: border-box; }
.receipt .center { text-align: center; }
.receipt .big { font-size: 15pt; font-weight: 700; }
.receipt .hr { border-top: 1px dashed #000; margin: 2mm 0; }
.receipt .row { display: flex; justify-content: space-between; gap: 4mm; }
.receipt .item { margin: 1.5mm 0; break-inside: avoid; }
.receipt .item .opt { padding-left: 4mm; font-size: 11pt; }
.receipt .item .obs { padding-left: 4mm; font-style: italic; font-size: 11pt; }
.receipt .notes { border: 1.5px solid #000; padding: 2mm; margin: 2mm 0; font-weight: 700; break-inside: avoid; }
`;

/** Escapa texto p/ interpolar com segurança no HTML da comanda. */
const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

/**
 * Renderiza a comanda de um pedido como string HTML. Função pura (sem React) para
 * ser reusada tanto pela rota de impressão quanto pelo envio ao agente QZ Tray.
 */
export function receiptHtml(order: DeliveryOrderDetail): string {
  const plat = order.platform === 'ifood' ? 'iFood' : '99Food';
  const num = order.display_id ? `#${order.display_id}` : `#${order.id}`;
  const mode = order.delivery_mode === 'own' ? 'Entrega própria'
    : order.delivery_mode === 'partner' ? 'Entrega parceira' : '';
  const addr = formatAddress(order.delivery_address);
  const rawRef = order.delivery_address && typeof order.delivery_address === 'object'
    ? (order.delivery_address as Record<string, unknown>).reference : null;
  const ref = typeof rawRef === 'string' ? rawRef.trim() : '';

  const items = order.items.map((it) => {
    const opts = parseOptions(it.options).map((op) =>
      `<div class="opt">+ ${op.quantity && op.quantity > 1 ? esc(op.quantity) + 'x ' : ''}${esc(op.name)}${op.group ? ' · ' + esc(op.group) : ''}</div>`
    ).join('');
    const obs = it.observations ? `<div class="obs">${esc(it.observations)}</div>` : '';
    return `<div class="item"><div class="row"><span><b>${esc(Number(it.quantity))}x ${esc(it.name)}</b></span>`
      + `<span>${esc(brl(it.total))}</span></div>${opts}${obs}</div>`;
  }).join('');

  const notes = order.customer_notes ? `<div class="notes">OBS: ${esc(order.customer_notes)}</div>` : '';

  return `<div class="receipt">
    <div class="center big">${esc(plat)} ${esc(num)}</div>
    <div class="center">${esc(datetime(order.placed_at || order.created_at))}</div>
    ${mode ? `<div class="center">${esc(mode)}</div>` : ''}
    <div class="hr"></div>
    <div><b>Cliente:</b> ${esc(order.customer_name || '—')}</div>
    ${order.customer_phone ? `<div><b>Tel:</b> ${esc(order.customer_phone)}</div>` : ''}
    ${addr ? `<div><b>Entrega:</b> ${esc(addr)}</div>` : ''}
    ${ref ? `<div>Ref.: ${esc(ref)}</div>` : ''}
    ${notes}
    <div class="hr"></div>
    ${items}
    <div class="hr"></div>
    <div class="row"><span>Itens</span><span>${esc(brl(order.items_amount))}</span></div>
    <div class="row"><span>Taxa entrega</span><span>${esc(brl(order.delivery_fee))}</span></div>
    ${order.discount_platform ? `<div class="row"><span>Desc. plataforma</span><span>- ${esc(brl(order.discount_platform))}</span></div>` : ''}
    ${order.discount_merchant ? `<div class="row"><span>Desc. loja</span><span>- ${esc(brl(order.discount_merchant))}</span></div>` : ''}
    <div class="row big"><span>TOTAL</span><span>${esc(brl(order.customer_paid))}</span></div>
    <div class="hr"></div>
    <div class="center" style="font-size:9pt">ID ${esc(plat)}: ${esc(order.platform_order_id)}</div>
  </div>`;
}
