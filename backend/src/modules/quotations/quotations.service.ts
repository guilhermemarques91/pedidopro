import { query, queryOne, withTransaction } from '../../config/database';
import { notFound, badRequest } from '../../shared/utils/http-error';
import {
  CreateQuotationDto,
  UpdateQuotationDto,
  AddQuotationItemDto,
  UpdateQuotationItemDto,
} from './quotations.dto';
import { extractionService, ExtractedPriceRow } from './extraction.service';

export interface Quotation {
  id: number;
  title: string;
  status: 'draft' | 'active' | 'closed';
  created_by: number;
  created_at: Date;
  closed_at: Date | null;
}

export interface QuotationItemRow {
  id: number;
  quotation_id: number;
  item_id: number;
  supplier_id: number;
  price: string | null;
  quantity: string | null;
  notes: string | null;
  source: string;
  extracted_by_ai: boolean;
  reviewed: boolean;
  created_at: Date;
  item_name: string;
  unit: string;
  supplier_name: string;
}

export const quotationsService = {
  async list(status?: string): Promise<unknown[]> {
    const params: unknown[] = [];
    let where = '';
    if (status) {
      params.push(status);
      where = 'WHERE q.status = $1';
    }
    return query(
      `SELECT q.*, u.name AS created_by_name,
              COUNT(qi.id) AS item_count
         FROM quotations q
         JOIN users u ON u.id = q.created_by
         LEFT JOIN quotation_items qi ON qi.quotation_id = q.id
         ${where}
         GROUP BY q.id, u.name
         ORDER BY q.created_at DESC`,
      params
    );
  },

  async getById(id: number): Promise<Quotation> {
    const q = await queryOne<Quotation>('SELECT * FROM quotations WHERE id = $1', [id]);
    if (!q) throw notFound('Cotação não encontrada');
    return q;
  },

  /** Cotação + seus itens (com nome do item/fornecedor). */
  async getWithItems(id: number): Promise<Quotation & { items: QuotationItemRow[] }> {
    const q = await this.getById(id);
    const items = await query<QuotationItemRow>(
      `SELECT qi.*, i.name AS item_name, i.unit, s.name AS supplier_name
         FROM quotation_items qi
         JOIN items i ON i.id = qi.item_id
         JOIN suppliers s ON s.id = qi.supplier_id
        WHERE qi.quotation_id = $1
        ORDER BY i.name, s.name`,
      [id]
    );
    return { ...q, items };
  },

  async create(dto: CreateQuotationDto, userId: number): Promise<Quotation> {
    const q = await queryOne<Quotation>(
      'INSERT INTO quotations (title, created_by) VALUES ($1, $2) RETURNING *',
      [dto.title, userId]
    );
    return q!;
  },

  async update(id: number, dto: UpdateQuotationDto): Promise<Quotation> {
    const q = await this.getById(id);
    if (q.status === 'closed') throw badRequest('Cotação fechada não pode ser editada');

    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (dto.title !== undefined) { fields.push(`title = $${i++}`); values.push(dto.title); }
    if (dto.status !== undefined) { fields.push(`status = $${i++}`); values.push(dto.status); }
    values.push(id);

    const updated = await queryOne<Quotation>(
      `UPDATE quotations SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    return updated!;
  },

  /** Remove a cotação e seus itens. Bloqueado se já estiver fechada. */
  async remove(id: number): Promise<void> {
    const q = await this.getById(id);
    if (q.status === 'closed') throw badRequest('Cotação fechada não pode ser excluída');
    await withTransaction(async (client) => {
      await client.query('DELETE FROM quotation_items WHERE quotation_id = $1', [id]);
      await client.query('DELETE FROM quotations WHERE id = $1', [id]);
    });
  },

  // ---- Itens da cotação (entrada de preços) ----

  async addItem(quotationId: number, dto: AddQuotationItemDto): Promise<QuotationItemRow> {
    const q = await this.getById(quotationId);
    if (q.status === 'closed') throw badRequest('Cotação fechada não aceita novos preços');

    // item precisa existir; supplier_id default = fornecedor do item
    const item = await queryOne<{ id: number; supplier_id: number }>(
      'SELECT id, supplier_id FROM items WHERE id = $1', [dto.item_id]
    );
    if (!item) throw badRequest('Item informado não existe');

    const supplierId = dto.supplier_id ?? item.supplier_id;
    const supplier = await queryOne<{ id: number }>(
      'SELECT id FROM suppliers WHERE id = $1', [supplierId]
    );
    if (!supplier) throw badRequest('Fornecedor informado não existe');

    const inserted = await queryOne<{ id: number }>(
      `INSERT INTO quotation_items (quotation_id, item_id, supplier_id, price, quantity, notes, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [quotationId, dto.item_id, supplierId, dto.price ?? null, dto.quantity ?? null,
       dto.notes ?? null, dto.source ?? 'manual']
    );
    return this.getItemRow(inserted!.id);
  },

  async updateItem(quotationId: number, qiId: number, dto: UpdateQuotationItemDto): Promise<QuotationItemRow> {
    await this.assertItemBelongs(quotationId, qiId);

    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const key of ['price', 'quantity', 'notes', 'reviewed'] as const) {
      if (dto[key] !== undefined) { fields.push(`${key} = $${i++}`); values.push(dto[key]); }
    }
    values.push(qiId);
    await query(`UPDATE quotation_items SET ${fields.join(', ')} WHERE id = $${i}`, values);
    return this.getItemRow(qiId);
  },

  async removeItem(quotationId: number, qiId: number): Promise<void> {
    await this.assertItemBelongs(quotationId, qiId);
    await query('DELETE FROM quotation_items WHERE id = $1', [qiId]);
  },

  /**
   * Comparativo de preços: agrupa por nome do item e lista o preço de cada
   * fornecedor, marcando o menor preço. É o que permite "comparar fornecedores".
   */
  async comparison(quotationId: number): Promise<unknown[]> {
    await this.getById(quotationId);
    const rows = await query<QuotationItemRow>(
      `SELECT qi.*, i.name AS item_name, i.unit, s.name AS supplier_name
         FROM quotation_items qi
         JOIN items i ON i.id = qi.item_id
         JOIN suppliers s ON s.id = qi.supplier_id
        WHERE qi.quotation_id = $1 AND qi.price IS NOT NULL
        ORDER BY lower(i.name)`,
      [quotationId]
    );

    const groups = new Map<string, { item: string; unit: string; offers: { supplier: string; price: number; qiId: number }[] }>();
    for (const r of rows) {
      const key = r.item_name.trim().toLowerCase();
      if (!groups.has(key)) groups.set(key, { item: r.item_name, unit: r.unit, offers: [] });
      groups.get(key)!.offers.push({ supplier: r.supplier_name, price: Number(r.price), qiId: r.id });
    }

    return [...groups.values()].map((g) => {
      const best = Math.min(...g.offers.map((o) => o.price));
      return {
        item: g.item,
        unit: g.unit,
        bestPrice: best,
        offers: g.offers
          .sort((a, b) => a.price - b.price)
          .map((o) => ({ ...o, isBest: o.price === best })),
      };
    });
  },

  /**
   * Fecha a cotação: grava os preços no price_history e marca como closed.
   * Idempotência: bloqueia se já estiver fechada.
   */
  async close(quotationId: number): Promise<Quotation> {
    const q = await this.getById(quotationId);
    if (q.status === 'closed') throw badRequest('Cotação já está fechada');

    return withTransaction(async (client) => {
      // Registra no histórico cada preço lançado.
      await client.query(
        `INSERT INTO price_history (item_id, supplier_id, price, quotation_id)
         SELECT item_id, supplier_id, price, quotation_id
           FROM quotation_items
          WHERE quotation_id = $1 AND price IS NOT NULL`,
        [quotationId]
      );
      const updated = await client.query<Quotation>(
        `UPDATE quotations SET status = 'closed', closed_at = NOW() WHERE id = $1 RETURNING *`,
        [quotationId]
      );
      return updated.rows[0];
    });
  },

  /**
   * Extrai preços de um PDF/imagem (via Claude) e lança como itens da cotação,
   * todos do fornecedor informado, marcados como extracted_by_ai e não revisados.
   */
  async extractAndAdd(
    quotationId: number,
    supplierId: number,
    buffer: Buffer,
    mediaType: string,
    source: 'pdf' | 'image'
  ): Promise<{ extracted: number; added: number; rows: ExtractedPriceRow[]; items: QuotationItemRow[] }> {
    const q = await this.getById(quotationId);
    if (q.status === 'closed') throw badRequest('Cotação fechada não aceita novos preços');

    const supplier = await queryOne<{ id: number }>(
      'SELECT id FROM suppliers WHERE id = $1', [supplierId]
    );
    if (!supplier) throw badRequest('Fornecedor informado não existe');

    const rows = await extractionService.extractFromDocument(buffer, mediaType);

    const addedIds = await withTransaction(async (client) => {
      const ids: number[] = [];
      for (const row of rows) {
        // find-or-create do item sob o fornecedor (mesmo padrão do Import)
        const existing = await client.query<{ id: number }>(
          'SELECT id FROM items WHERE supplier_id = $1 AND lower(name) = lower($2) LIMIT 1',
          [supplierId, row.name]
        );
        let itemId: number;
        if (existing.rows[0]) {
          itemId = existing.rows[0].id;
        } else {
          const created = await client.query<{ id: number }>(
            'INSERT INTO items (supplier_id, name, unit, base_price) VALUES ($1, $2, $3, $4) RETURNING id',
            [supplierId, row.name, row.unit, row.price]
          );
          itemId = created.rows[0].id;
        }

        const qi = await client.query<{ id: number }>(
          `INSERT INTO quotation_items
             (quotation_id, item_id, supplier_id, price, quantity, notes, source, extracted_by_ai, reviewed)
           VALUES ($1, $2, $3, $4, $5, $6, $7, true, false) RETURNING id`,
          [quotationId, itemId, supplierId, row.price, row.quantity, row.notes, source]
        );
        ids.push(qi.rows[0].id);
      }
      return ids;
    });

    const items = await Promise.all(addedIds.map((id) => this.getItemRow(id)));
    return { extracted: rows.length, added: addedIds.length, rows, items };
  },

  // ---- helpers ----

  async getItemRow(qiId: number): Promise<QuotationItemRow> {
    const row = await queryOne<QuotationItemRow>(
      `SELECT qi.*, i.name AS item_name, i.unit, s.name AS supplier_name
         FROM quotation_items qi
         JOIN items i ON i.id = qi.item_id
         JOIN suppliers s ON s.id = qi.supplier_id
        WHERE qi.id = $1`,
      [qiId]
    );
    if (!row) throw notFound('Item da cotação não encontrado');
    return row;
  },

  async assertItemBelongs(quotationId: number, qiId: number): Promise<void> {
    const q = await this.getById(quotationId);
    if (q.status === 'closed') throw badRequest('Cotação fechada não pode ser editada');
    const row = await queryOne<{ id: number }>(
      'SELECT id FROM quotation_items WHERE id = $1 AND quotation_id = $2',
      [qiId, quotationId]
    );
    if (!row) throw notFound('Item da cotação não encontrado nesta cotação');
  },
};
