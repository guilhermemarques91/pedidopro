import { query, queryOne } from '../../config/database';
import { badRequest, notFound } from '../../shared/utils/http-error';
import { quotationsService } from '../quotations/quotations.service';
import type { ExtractedPriceRow } from '../quotations/extraction';
import { syncWhatsappInbox, SyncResult } from './whatsapp.sync';

export interface InboxRow {
  id: number;
  supplier_id: number;
  supplier_name: string;
  message_key: string;
  raw_message: string | null;
  item_name: string;
  unit: string;
  price: string | null;
  quantity: string | null;
  notes: string | null;
  status: string;
  received_at: string | null;
  created_at: string;
}

export const inboxService = {
  sync(): Promise<SyncResult> {
    return syncWhatsappInbox();
  },

  /** Lista os itens pendentes de revisão (com nome do fornecedor). */
  listPending(): Promise<InboxRow[]> {
    return query<InboxRow>(
      `SELECT ip.*, s.name AS supplier_name
         FROM inbox_prices ip
         JOIN suppliers s ON s.id = ip.supplier_id
        WHERE ip.status = 'pending'
        ORDER BY s.name, ip.received_at DESC, ip.id`
    );
  },

  async count(): Promise<number> {
    const r = await queryOne<{ n: string }>(
      "SELECT COUNT(*)::text AS n FROM inbox_prices WHERE status = 'pending'"
    );
    return Number(r?.n ?? 0);
  },

  /** Edita campos de uma linha pendente. */
  async update(
    id: number,
    dto: { item_name?: string; unit?: string; price?: number | null; quantity?: number | null; notes?: string | null }
  ): Promise<InboxRow> {
    const row = await queryOne<{ id: number; status: string }>('SELECT id, status FROM inbox_prices WHERE id = $1', [id]);
    if (!row) throw notFound('Item da caixa de entrada não encontrado');
    if (row.status !== 'pending') throw badRequest('Item já revisado não pode ser editado');

    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const k of ['item_name', 'unit', 'price', 'quantity', 'notes'] as const) {
      if (dto[k] !== undefined) { fields.push(`${k} = $${i++}`); values.push(dto[k]); }
    }
    if (!fields.length) throw badRequest('Nada para atualizar');
    values.push(id);
    const updated = await queryOne<InboxRow>(
      `UPDATE inbox_prices SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    return updated!;
  },

  /**
   * Aprova linhas selecionadas → cria os itens na cotação informada (reusando
   * a gravação da extração) e marca as linhas como aprovadas.
   */
  async approve(ids: number[], quotationId: number, userId: number): Promise<{ approved: number; added: number }> {
    if (!ids.length) throw badRequest('Selecione ao menos um item');
    const q = await quotationsService.getById(quotationId);
    if (q.status === 'closed') throw badRequest('Cotação fechada não aceita novos preços');

    const rows = await query<InboxRow>(
      `SELECT * FROM inbox_prices WHERE id = ANY($1::int[]) AND status = 'pending'`, [ids]
    );
    if (!rows.length) throw badRequest('Nenhum item pendente selecionado');

    // agrupa por fornecedor e grava reusando addExtractedRows
    const bySupplier = new Map<number, ExtractedPriceRow[]>();
    for (const r of rows) {
      const list = bySupplier.get(r.supplier_id) ?? [];
      list.push({
        name: r.item_name,
        unit: r.unit,
        price: r.price !== null ? Number(r.price) : null,
        quantity: r.quantity !== null ? Number(r.quantity) : null,
        notes: r.notes,
      });
      bySupplier.set(r.supplier_id, list);
    }

    let added = 0;
    for (const [supplierId, list] of bySupplier) {
      const res = await quotationsService.addExtractedRows(quotationId, supplierId, list, 'whatsapp');
      added += res.added;
    }

    const approvedIds = rows.map((r) => r.id);
    await query(
      `UPDATE inbox_prices SET status = 'approved', reviewed_at = NOW(), reviewed_by = $1
        WHERE id = ANY($2::int[])`,
      [userId, approvedIds]
    );
    return { approved: approvedIds.length, added };
  },

  async discard(ids: number[], userId: number): Promise<{ discarded: number }> {
    if (!ids.length) throw badRequest('Selecione ao menos um item');
    const r = await query<{ id: number }>(
      `UPDATE inbox_prices SET status = 'discarded', reviewed_at = NOW(), reviewed_by = $1
        WHERE id = ANY($2::int[]) AND status = 'pending' RETURNING id`,
      [userId, ids]
    );
    return { discarded: r.length };
  },
};
