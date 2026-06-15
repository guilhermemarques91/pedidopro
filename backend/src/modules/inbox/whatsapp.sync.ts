import { query, queryOne } from '../../config/database';
import { env } from '../../config/env';
import { logger } from '../../shared/utils/logger';
import { whatsappService, messageText, EvolutionMessage } from '../whatsapp/whatsapp.service';
import { extractFromText } from '../quotations/extraction';

interface WhatsappSupplier { id: number; name: string; whatsapp_number: string }

export interface SyncResult {
  suppliers: number;
  messagesScanned: number;
  candidates: number;
  itemsAdded: number;
}

/** Só dígitos. */
function digits(s: string): string {
  return (s ?? '').replace(/\D/g, '');
}

/** Heurística barata: a mensagem parece conter preço? (evita rodar a LLM em conversa fiada) */
function looksLikePrice(text: string): boolean {
  if (text.length < 4) return false;
  // tem "R$" ou um número com casas decimais (vírgula/ponto) — ex.: 12,90 / 7.49 / R$ 5
  return /r\$\s*\d/i.test(text) || /\d+[.,]\d{2}\b/.test(text);
}

/**
 * Sincroniza as mensagens recentes dos fornecedores WhatsApp: extrai preços por
 * IA local e grava na fila de revisão (inbox_prices), sem duplicar.
 */
export async function syncWhatsappInbox(): Promise<SyncResult> {
  const suppliers = await query<WhatsappSupplier>(
    `SELECT id, name, whatsapp_number FROM suppliers
      WHERE active = true AND order_type = 'whatsapp'
        AND whatsapp_number IS NOT NULL AND whatsapp_number <> ''`
  );

  const sinceMs = Date.now() - env.INBOX_SYNC_DAYS * 24 * 60 * 60 * 1000;
  const result: SyncResult = { suppliers: suppliers.length, messagesScanned: 0, candidates: 0, itemsAdded: 0 };

  for (const sup of suppliers) {
    const jid = `${digits(sup.whatsapp_number)}@s.whatsapp.net`;
    const messages = await whatsappService.fetchMessages(jid);
    result.messagesScanned += messages.length;

    for (const m of messages) {
      if (m.key?.fromMe) continue;                         // só mensagens recebidas
      const tsMs = Number(m.messageTimestamp ?? 0) * 1000;
      if (tsMs && tsMs < sinceMs) continue;                // só janela recente
      const key = m.key?.id;
      if (!key) continue;

      const text = messageText(m as EvolutionMessage);
      if (!looksLikePrice(text)) continue;
      result.candidates++;

      // dedup: já processada (qualquer status)?
      const exists = await queryOne<{ id: number }>(
        'SELECT id FROM inbox_prices WHERE message_key = $1 LIMIT 1', [key]
      );
      if (exists) continue;

      // extrai com a IA local (sequencial — CPU faz uma por vez)
      let rows;
      try {
        rows = await extractFromText(text);
      } catch (err) {
        logger.warn(`Extração falhou p/ msg ${key} (${sup.name}):`, err instanceof Error ? err.message : err);
        continue;
      }

      for (const r of rows) {
        await query(
          `INSERT INTO inbox_prices
             (supplier_id, message_key, raw_message, item_name, unit, price, quantity, notes, received_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [sup.id, key, text, r.name, r.unit, r.price, r.quantity, r.notes,
           tsMs ? new Date(tsMs) : null]
        );
        result.itemsAdded++;
      }
    }
  }

  logger.info(
    `Sync WhatsApp: ${result.suppliers} fornecedores, ${result.messagesScanned} msgs, ` +
    `${result.candidates} candidatas, ${result.itemsAdded} itens na fila.`
  );
  return result;
}
