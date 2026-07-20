// Integração com o QZ Tray para impressão térmica silenciosa direto do navegador.
//
// O QZ Tray é um app local (WebSocket wss://localhost:8181) instalado no PC do painel.
// Carregamos a lib client sob demanda (CDN), conectamos e imprimimos o HTML da comanda
// em cada impressora configurada. Impressão SEM diálogo exige assinatura: a chave privada
// fica no servidor (POST /delivery/print/sign) e o certificado público vem de /delivery/print/cert.
//
// Config das impressoras é POR MÁQUINA (nomes do SO) → guardada em localStorage.
// Se o QZ não estiver disponível, as funções lançam erro; o chamador degrada para
// impressão manual (rota /delivery/:id/print).

import { api } from './api';
import type { DeliveryOrderDetail } from '../types';
import { RECEIPT_CSS, receiptHtml, PAPER_WIDTH_MM, type ReceiptVariant } from '../pages/Delivery/OrderReceipt/receipt';

const QZ_SCRIPT = 'https://cdn.jsdelivr.net/npm/qz-tray@2.2.4/qz-tray.js';
const MAP_KEY = 'pedidopro.print.map'; // { kitchen, counter } → nomes de impressora do SO

/** Impressora por papel: cozinha (via de preparo) e balcão (via completa). */
export interface PrinterMap { kitchen: string | null; counter: string | null; }

// A lib do QZ não tem tipos; tratamos como any local.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type QZ = any;

let qzPromise: Promise<QZ> | null = null;

/** Carrega qz-tray.js (uma vez) e resolve com o objeto global `qz`. */
function loadQz(): Promise<QZ> {
  if (qzPromise) return qzPromise;
  qzPromise = new Promise<QZ>((resolve, reject) => {
    const w = window as unknown as { qz?: QZ };
    if (w.qz) { resolve(w.qz); return; }
    const s = document.createElement('script');
    s.src = QZ_SCRIPT;
    s.async = true;
    s.onload = () => (w.qz ? resolve(w.qz) : reject(new Error('qz-tray carregou sem expor `qz`')));
    s.onerror = () => { qzPromise = null; reject(new Error('Falha ao baixar qz-tray')); };
    document.head.appendChild(s);
  });
  return qzPromise;
}

/**
 * Registra assinatura para impressão silenciosa — SÓ se houver certificado no backend.
 * Sem certificado (QZ_CERT_PATH não configurado), não registra nada: o QZ opera em modo
 * não-assinado e pede "Permitir" uma vez (com opção de lembrar). Evita erro de cert vazio.
 */
async function configureSecurity(qz: QZ): Promise<boolean> {
  const raw = { transformResponse: [(d: unknown) => d] }; // mantém texto cru (cert/base64)
  let cert = '';
  try { cert = (await api.get<string>('/delivery/print/cert', raw)).data ?? ''; } catch { cert = ''; }
  if (!cert || !String(cert).trim()) return false; // modo não-assinado (prompt único no QZ)

  qz.security.setCertificatePromise((resolve: (v: string) => void) => resolve(cert));
  qz.security.setSignatureAlgorithm('SHA512');
  qz.security.setSignaturePromise((toSign: string) =>
    (resolve: (v: string) => void, reject: (e: unknown) => void) => {
      api.post<string>('/delivery/print/sign', { request: toSign }, raw)
        .then((r) => resolve(r.data)).catch(reject);
    });
  return true;
}

// O certificado é apresentado ao QZ NA CONEXÃO: uma conexão aberta antes de a
// assinatura existir fica anônima para sempre (o QZ trava o "Remember" e pede
// Allow a cada impressão). Rastreia se a conexão ativa nasceu assinada.
let connectedSigned = false;

/** Garante conexão ativa com o QZ Tray (reconecta se a assinatura surgiu depois). */
async function connect(): Promise<QZ> {
  const qz = await loadQz();
  const signed = await configureSecurity(qz);
  if (qz.websocket.isActive() && signed && !connectedSigned) {
    try { await qz.websocket.disconnect(); } catch { /* conexão já caiu — segue */ }
  }
  if (!qz.websocket.isActive()) {
    await qz.websocket.connect();
    connectedSigned = signed;
  }
  return qz;
}

/** Mapa de impressoras (cozinha/balcão) configurado neste PC. */
export function getPrinterMap(): PrinterMap {
  try {
    const v = JSON.parse(localStorage.getItem(MAP_KEY) || '{}');
    return {
      kitchen: typeof v.kitchen === 'string' && v.kitchen ? v.kitchen : null,
      counter: typeof v.counter === 'string' && v.counter ? v.counter : null,
    };
  } catch { return { kitchen: null, counter: null }; }
}

export function setPrinterMap(map: PrinterMap): void {
  localStorage.setItem(MAP_KEY, JSON.stringify(map));
}

export function isPrintConfigured(): boolean {
  const m = getPrinterMap();
  return !!(m.kitchen || m.counter);
}

/** Jobs a imprimir conforme o mapa: cozinha→via de preparo, balcão→via completa. */
function jobsFor(map: PrinterMap): { printer: string; variant: ReceiptVariant }[] {
  const jobs: { printer: string; variant: ReceiptVariant }[] = [];
  if (map.kitchen) jobs.push({ printer: map.kitchen, variant: 'kitchen' });
  if (map.counter) jobs.push({ printer: map.counter, variant: 'counter' });
  return jobs;
}

/** Lista as impressoras do SO (via QZ) para a tela de configuração. */
export async function listSystemPrinters(): Promise<string[]> {
  const qz = await connect();
  const found = await qz.printers.find();
  return Array.isArray(found) ? found : (found ? [found] : []);
}

/** Envia um HTML de comanda a uma impressora nomeada. */
async function printHtml(qz: QZ, printer: string, bodyHtml: string): Promise<void> {
  const html = `<style>${RECEIPT_CSS}</style>${bodyHtml}`;
  // O QZ ajusta (fit) o conteúdo dentro de width x height mantendo a proporção.
  // Largura de PAPEL_MM (ver receipt.ts) — a maioria das térmicas "80mm" tem área
  // imprimível real menor que o rolo físico (a 80mm cortava os últimos dígitos dos
  // valores). Altura bem folgada (3000mm) garante que ela nunca é o fator limitante,
  // então a fonte não encolhe em pedidos longos.
  const cfg = qz.configs.create(printer, { size: { width: PAPER_WIDTH_MM, height: 3000 }, units: 'mm', margins: 0 });
  await qz.print(cfg, [{ type: 'pixel', format: 'html', flavor: 'plain', data: html }]);
}

/** Imprime um cupom de teste em cada papel configurado (valida QZ + papel + impressora). */
export async function printTest(): Promise<void> {
  const jobs = jobsFor(getPrinterMap());
  if (jobs.length === 0) throw new Error('Nenhuma impressora configurada');
  const qz = await connect();
  for (const { printer, variant } of jobs) {
    const role = variant === 'kitchen' ? 'COZINHA' : 'BALCÃO';
    const safe = String(printer).replace(/[&<>]/g, '');
    const body = `<div class="rc">`
      + `<div class="rc-num">TESTE</div>`
      + `<div class="rc-cook">** ${role} **</div>`
      + `<div class="rc-hr"></div>`
      + `<div class="rc-line">Impressora: <b>${safe}</b></div>`
      + `<div class="rc-line">${new Date().toLocaleString('pt-BR')}</div>`
      + `<div class="rc-hr-d"></div>`
      + `<div class="rc-line">Se você está lendo isto, funcionou!</div></div>`;
    await printHtml(qz, printer, body);
  }
}

/** Imprime a comanda: cozinha (via de preparo) e balcão (via completa). Lança se QZ off. */
export async function printReceipt(order: DeliveryOrderDetail): Promise<void> {
  const jobs = jobsFor(getPrinterMap());
  if (jobs.length === 0) throw new Error('Nenhuma impressora configurada');
  const qz = await connect();
  for (const { printer, variant } of jobs) {
    await printHtml(qz, printer, receiptHtml(order, variant));
  }
}
