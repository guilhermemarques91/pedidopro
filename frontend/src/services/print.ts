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
import { RECEIPT_CSS, receiptHtml } from '../pages/Delivery/OrderReceipt/receipt';

const QZ_SCRIPT = 'https://cdn.jsdelivr.net/npm/qz-tray@2.2.4/qz-tray.js';
const PRINTERS_KEY = 'pedidopro.print.printers'; // string[] com nomes de impressora do SO

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
async function configureSecurity(qz: QZ): Promise<void> {
  const raw = { transformResponse: [(d: unknown) => d] }; // mantém texto cru (cert/base64)
  let cert = '';
  try { cert = (await api.get<string>('/delivery/print/cert', raw)).data ?? ''; } catch { cert = ''; }
  if (!cert || !String(cert).trim()) return; // modo não-assinado (prompt único no QZ)

  qz.security.setCertificatePromise((resolve: (v: string) => void) => resolve(cert));
  qz.security.setSignatureAlgorithm('SHA512');
  qz.security.setSignaturePromise((toSign: string) =>
    (resolve: (v: string) => void, reject: (e: unknown) => void) => {
      api.post<string>('/delivery/print/sign', { request: toSign }, raw)
        .then((r) => resolve(r.data)).catch(reject);
    });
}

/** Garante conexão ativa com o QZ Tray. */
async function connect(): Promise<QZ> {
  const qz = await loadQz();
  await configureSecurity(qz);
  if (!qz.websocket.isActive()) {
    await qz.websocket.connect();
  }
  return qz;
}

/** Nomes de impressora configurados neste PC. */
export function getPrinters(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(PRINTERS_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch { return []; }
}

export function setPrinters(names: string[]): void {
  localStorage.setItem(PRINTERS_KEY, JSON.stringify(names.filter(Boolean)));
}

export function isPrintConfigured(): boolean {
  return getPrinters().length > 0;
}

/** Lista as impressoras do SO (via QZ) para a tela de configuração. */
export async function listSystemPrinters(): Promise<string[]> {
  const qz = await connect();
  const found = await qz.printers.find();
  return Array.isArray(found) ? found : (found ? [found] : []);
}

/** Imprime um cupom de teste em cada impressora configurada (valida QZ + papel). */
export async function printTest(): Promise<void> {
  const printers = getPrinters();
  if (printers.length === 0) throw new Error('Nenhuma impressora configurada');
  const qz = await connect();
  for (const name of printers) {
    const safe = String(name).replace(/[&<>]/g, '');
    const html = `<style>${RECEIPT_CSS}</style><div class="receipt">`
      + `<div class="center big">TESTE DE IMPRESSAO</div>`
      + `<div class="center">PedidoPro - comanda 80mm</div>`
      + `<div class="hr"></div>`
      + `<div>Impressora: <b>${safe}</b></div>`
      + `<div>${new Date().toLocaleString('pt-BR')}</div>`
      + `<div class="hr"></div>`
      + `<div class="center">Se voce esta lendo isto, funcionou!</div></div>`;
    const cfg = qz.configs.create(name, { size: { width: 80, height: null }, units: 'mm', margins: 0 });
    await qz.print(cfg, [{ type: 'pixel', format: 'html', flavor: 'plain', data: html }]);
  }
}

/** Imprime a comanda em TODAS as impressoras configuradas. Lança se QZ indisponível. */
export async function printReceipt(order: DeliveryOrderDetail): Promise<void> {
  const printers = getPrinters();
  if (printers.length === 0) throw new Error('Nenhuma impressora configurada');
  const qz = await connect();
  const html = `<style>${RECEIPT_CSS}</style>${receiptHtml(order)}`;
  const data = [{ type: 'pixel', format: 'html', flavor: 'plain', data: html }];
  for (const name of printers) {
    const cfg = qz.configs.create(name, { size: { width: 80, height: null }, units: 'mm', margins: 0 });
    await qz.print(cfg, data);
  }
}
