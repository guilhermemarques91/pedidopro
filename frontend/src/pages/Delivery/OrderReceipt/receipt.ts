import type { DeliveryOrderDetail } from '../../../types';
import { brl, datetime, formatAddress, parseOptions } from '../../../utils/format';

/** Via da comanda: cozinha (só preparo, sem valores) ou balcão (completa). */
export type ReceiptVariant = 'kitchen' | 'counter';

/**
 * Largura real de impressão em mm. A maioria das térmicas "80mm" tem área imprimível
 * menor que o rolo físico (a 80mm cortava os últimos dígitos dos valores). Usada
 * tanto no CSS quanto na config do QZ Tray (print.ts) — mantém as duas em sincronia.
 */
export const PAPER_WIDTH_MM = 76;

/**
 * CSS da comanda térmica no estilo "cozinha do iFood": quantidade grande à
 * esquerda, nome do item em CAIXA ALTA/negrito, complementos indentados e
 * observações em fundo preto invertido (impossível não ver). Só preto puro — nada
 * de cinza, que a impressora térmica (1 bit) renderiza falhado. Reusado pela rota
 * de impressão e pelo agente QZ.
 */
export const RECEIPT_CSS = `
@page { size: ${PAPER_WIDTH_MM}mm auto; margin: 0; }
/* Reset incondicional (não só em @media print): o QZ Tray renderiza o HTML em modo
   tela normal, não em modo impressão — a margem padrão do body (~8px) sobraria e
   empurraria o conteúdo alinhado à direita (valores) pra fora da área imprimível. */
html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
@media print { .no-print { display: none !important; } }
.rc { width: ${PAPER_WIDTH_MM}mm; box-sizing: border-box; padding: 3mm 4mm; margin: 0; background: #fff; color: #000;
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
`;

/** Escapa texto p/ interpolar com segurança no HTML da comanda. */
const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

/**
 * Renderiza a comanda de um pedido como string HTML (estilo cozinha iFood). Função
 * pura (sem React), reusada pela rota de impressão e pelo envio ao agente QZ Tray.
 *
 * variant='kitchen' → só o que a cozinha precisa (itens + complementos + observações),
 * SEM valores nem endereço. variant='counter' → comanda completa (valores + entrega).
 */
export function receiptHtml(order: DeliveryOrderDetail, variant: ReceiptVariant = 'counter'): string {
  const isKitchen = variant === 'kitchen';
  const plat = order.platform === 'ifood' ? 'iFood' : '99Food';
  const num = order.display_id ? `#${order.display_id}` : `#${order.id}`;
  const mode = order.delivery_mode === 'own' ? 'ENTREGA PRÓPRIA'
    : order.delivery_mode === 'partner' ? 'ENTREGA PARCEIRA' : '';
  const addr = formatAddress(order.delivery_address);
  const rawRef = order.delivery_address && typeof order.delivery_address === 'object'
    ? (order.delivery_address as Record<string, unknown>).reference : null;
  const ref = typeof rawRef === 'string' ? rawRef.trim() : '';

  const items = order.items.map((it) => {
    // Lista simples dos complementos, sem repetir o rótulo do grupo por linha (o
    // 99Food manda a pergunta inteira em `group`, ex.: "Acompanhamentos - Selecione
    // todos que você queira" — poluiria a comanda repetido em cada item).
    const opts = parseOptions(it.options).map((op) => {
      const qty = op.quantity && op.quantity > 1 ? esc(op.quantity) + 'x ' : '';
      return `<div class="rc-opt">${qty}${esc(op.name)}</div>`;
    }).join('');
    const obs = it.observations ? `<div class="rc-obs">» ${esc(it.observations).toUpperCase()}</div>` : '';
    return `<div class="rc-item"><div class="rc-qty">${esc(Number(it.quantity))}x</div>`
      + `<div class="rc-body"><div class="rc-name">${esc(it.name)}</div>${opts}${obs}</div></div>`;
  }).join('<div class="rc-sep-item"></div>');

  const note = order.customer_notes
    ? `<div class="rc-note">OBS DO PEDIDO:<br>${esc(order.customer_notes).toUpperCase()}</div>` : '';

  const money = isKitchen ? '' : `<div class="rc-hr"></div>
    <div class="rc-row"><span>Itens</span><span>${esc(brl(order.items_amount))}</span></div>
    <div class="rc-row"><span>Taxa entrega</span><span>${esc(brl(order.delivery_fee))}</span></div>
    ${order.discount_platform ? `<div class="rc-row"><span>Desc. plataforma</span><span>- ${esc(brl(order.discount_platform))}</span></div>` : ''}
    ${order.discount_merchant ? `<div class="rc-row"><span>Desc. loja</span><span>- ${esc(brl(order.discount_merchant))}</span></div>` : ''}
    <div class="rc-row rc-total"><span>TOTAL</span><span>${esc(brl(order.customer_paid))}</span></div>`;

  const delivery = (isKitchen || !addr) ? '' : `<div class="rc-hr-d"></div>
    <div class="rc-line"><b>ENTREGA:</b></div>
    <div class="rc-line">${esc(addr)}</div>
    ${ref ? `<div class="rc-line">Ref.: ${esc(ref)}</div>` : ''}`;

  const footer = isKitchen ? '' : `<div class="rc-foot">${esc(plat)} ID: ${esc(order.platform_order_id)}</div>`;

  return `<div class="rc">
    <div class="rc-brand">${esc(plat).toUpperCase()}</div>
    <div class="rc-num">PEDIDO ${esc(num)}</div>
    <div class="rc-plat">${esc(datetime(order.placed_at || order.created_at))}</div>
    ${mode ? `<div class="rc-type">${mode}</div>` : ''}
    ${order.locator ? `<div class="rc-loc">LOCALIZADOR: ${esc(order.locator)}</div>` : ''}
    ${isKitchen ? '<div class="rc-cook">** COZINHA **</div>' : ''}
    <div class="rc-hr-d"></div>
    <div class="rc-line">CLIENTE: <b>${esc(order.customer_name || '—')}</b></div>
    ${!isKitchen && order.customer_phone ? `<div class="rc-line">TEL: ${esc(order.customer_phone)}</div>` : ''}
    <div class="rc-hr"></div>
    <div class="rc-h">ITENS</div>
    ${items}
    ${note}
    ${money}
    ${delivery}
    ${footer}
  </div>`;
}
