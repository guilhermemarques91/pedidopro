import { PoolClient } from 'pg';
import { query, queryOne, withTransaction } from '../../config/database';
import { JwtPayload } from '../../shared/types';
import { badRequest, notFound, forbidden } from '../../shared/utils/http-error';
import { CreateRequestDto, UpdateRequestDto, AllocationDto } from './requests.dto';

export type RequestStatus = 'draft' | 'submitted' | 'allocated' | 'ordered' | 'cancelled';

export interface PurchaseRequest {
  id: number;
  title: string;
  status: RequestStatus;
  notes: string | null;
  created_by: number;
  created_at: Date;
  submitted_at: Date | null;
}

export interface RequestItemRow {
  id: number;
  request_id: number;
  product_id: number | null;
  free_text: string | null;
  quantity: string;
  unit: string;
  notes: string | null;
  alloc_supplier_id: number | null;
  alloc_item_id: number | null;
  alloc_name: string | null;
  alloc_unit: string | null;
  alloc_price: string | null;
}

function defaultTitle(): string {
  return `Lista ${new Date().toLocaleDateString('pt-BR')}`;
}

export const requestsService = {
  async list(user: JwtPayload): Promise<unknown[]> {
    // Funcionário vê só as suas; admin vê todas.
    const own = user.role !== 'admin';
    const params = own ? [user.id] : [];
    const where = own ? 'WHERE pr.created_by = $1' : '';
    return query(
      `SELECT pr.*, u.name AS created_by_name,
              COUNT(pri.id) AS item_count
         FROM purchase_requests pr
         JOIN users u ON u.id = pr.created_by
         LEFT JOIN purchase_request_items pri ON pri.request_id = pr.id
         ${where}
        GROUP BY pr.id, u.name
        ORDER BY pr.created_at DESC`,
      params
    );
  },

  async getById(id: number): Promise<PurchaseRequest> {
    const r = await queryOne<PurchaseRequest>('SELECT * FROM purchase_requests WHERE id = $1', [id]);
    if (!r) throw notFound('Lista de compras não encontrada');
    return r;
  },

  /** Detalhe: cabeçalho + itens com categoria, produto e ofertas-guia por fornecedor. */
  async getDetailed(id: number, user: JwtPayload): Promise<unknown> {
    const header = await queryOne(
      `SELECT pr.*, u.name AS created_by_name
         FROM purchase_requests pr JOIN users u ON u.id = pr.created_by
        WHERE pr.id = $1`,
      [id]
    );
    if (!header) throw notFound('Lista de compras não encontrada');
    // Funcionário só acessa as próprias listas.
    if (user.role !== 'admin' && (header as { created_by: number }).created_by !== user.id) {
      throw forbidden('Você não tem acesso a esta lista');
    }

    const items = await query(
      `SELECT pri.*, p.name AS product_name, c.id AS category_id, c.name AS category_name
         FROM purchase_request_items pri
         LEFT JOIN products p ON p.id = pri.product_id
         LEFT JOIN categories c ON c.id = p.category_id
        WHERE pri.request_id = $1
        ORDER BY COALESCE(c.name, 'zzz'), COALESCE(p.name, pri.free_text)`,
      [id]
    );

    // Ofertas-guia: para cada linha com produto, os itens dos fornecedores
    // vinculados a esse produto, com base_price (orientação de preço).
    const productIds = (items as { product_id: number | null }[])
      .map((i) => i.product_id)
      .filter((pid): pid is number => pid != null);

    let offersByProduct = new Map<number, unknown[]>();
    if (productIds.length) {
      const offers = await query<{
        product_id: number; item_id: number; supplier_id: number;
        supplier_name: string; name: string; unit: string; base_price: string | null;
      }>(
        `SELECT i.product_id, i.id AS item_id, i.supplier_id, s.name AS supplier_name,
                i.name, i.unit, i.base_price
           FROM items i JOIN suppliers s ON s.id = i.supplier_id
          WHERE i.active = true AND i.product_id = ANY($1::int[])
          ORDER BY i.base_price ASC NULLS LAST, s.name`,
        [productIds]
      );
      offersByProduct = offers.reduce((map, o) => {
        const arr = map.get(o.product_id) ?? [];
        arr.push(o);
        map.set(o.product_id, arr);
        return map;
      }, new Map<number, unknown[]>());
    }

    const withOffers = (items as ({ product_id: number | null } & Record<string, unknown>)[]).map((i) => ({
      ...i,
      offers: i.product_id ? (offersByProduct.get(i.product_id) ?? []) : [],
    }));

    return { ...header, items: withOffers };
  },

  async create(dto: CreateRequestDto, userId: number): Promise<unknown> {
    const id = await withTransaction(async (client) => {
      const r = await client.query<{ id: number }>(
        `INSERT INTO purchase_requests (title, notes, created_by)
         VALUES ($1, $2, $3) RETURNING id`,
        [dto.title?.trim() || defaultTitle(), dto.notes ?? null, userId]
      );
      const rid = r.rows[0].id;
      await this.insertItems(client, rid, dto.items);
      return rid;
    });
    return this.getById(id);
  },

  async update(id: number, dto: UpdateRequestDto, user: JwtPayload): Promise<unknown> {
    const r = await this.getById(id);
    if (r.created_by !== user.id && user.role !== 'admin') throw forbidden('Lista de outro usuário');
    if (r.status !== 'draft') throw badRequest('Apenas listas em rascunho podem ser editadas');
    await withTransaction(async (client) => {
      if (dto.title !== undefined || dto.notes !== undefined) {
        await client.query(
          'UPDATE purchase_requests SET title = COALESCE($1, title), notes = $2 WHERE id = $3',
          [dto.title?.trim() || null, dto.notes ?? null, id]
        );
      }
      await client.query('DELETE FROM purchase_request_items WHERE request_id = $1', [id]);
      await this.insertItems(client, id, dto.items);
    });
    return this.getById(id);
  },

  async insertItems(client: PoolClient, requestId: number, items: CreateRequestDto['items']): Promise<void> {
    for (const it of items) {
      await client.query(
        `INSERT INTO purchase_request_items (request_id, product_id, free_text, quantity, unit, notes)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [requestId, it.product_id ?? null, it.free_text?.trim() || null, it.quantity, it.unit ?? 'un', it.notes ?? null]
      );
    }
  },

  /** rascunho → enviada ao admin. */
  async submit(id: number, user: JwtPayload): Promise<PurchaseRequest> {
    const r = await this.getById(id);
    if (r.created_by !== user.id && user.role !== 'admin') throw forbidden('Lista de outro usuário');
    if (r.status !== 'draft') throw badRequest('Apenas listas em rascunho podem ser enviadas');
    const updated = await queryOne<PurchaseRequest>(
      `UPDATE purchase_requests SET status = 'submitted', submitted_at = NOW() WHERE id = $1 RETURNING *`,
      [id]
    );
    return updated!;
  },

  /** Admin salva a alocação por item. submitted/allocated → allocated. */
  async saveAllocation(id: number, dto: AllocationDto): Promise<unknown> {
    const r = await this.getById(id);
    if (!['submitted', 'allocated'].includes(r.status)) {
      throw badRequest('A lista precisa estar enviada para ser alocada');
    }
    await withTransaction(async (client) => {
      for (const a of dto.allocations) {
        const row = await client.query<{ id: number }>(
          'SELECT id FROM purchase_request_items WHERE id = $1 AND request_id = $2',
          [a.id, id]
        );
        if (!row.rows[0]) throw badRequest(`Item ${a.id} não pertence a esta lista`);
        await client.query(
          `UPDATE purchase_request_items
              SET alloc_supplier_id = $1, alloc_item_id = $2, alloc_name = $3,
                  alloc_unit = $4, alloc_price = $5
            WHERE id = $6`,
          [a.supplier_id, a.item_id ?? null, a.name?.trim() || null, a.unit?.trim() || null, a.price, a.id]
        );
      }
      await client.query(`UPDATE purchase_requests SET status = 'allocated' WHERE id = $1`, [id]);
    });
    return this.getById(id);
  },

  /**
   * Gera 1 pedido por fornecedor a partir da alocação. Para linhas sem
   * alloc_item_id, cria o item no fornecedor (enriquecendo o catálogo).
   */
  async generateOrders(id: number, userId: number): Promise<{ orderIds: number[] }> {
    const r = await this.getById(id);
    if (r.status !== 'allocated') {
      throw badRequest('Aloque os itens antes de gerar os pedidos');
    }
    const items = await query<RequestItemRow & { product_name: string | null }>(
      `SELECT pri.*, p.name AS product_name
         FROM purchase_request_items pri
         LEFT JOIN products p ON p.id = pri.product_id
        WHERE pri.request_id = $1`,
      [id]
    );
    if (!items.length) throw badRequest('Lista sem itens');

    // Validação: toda linha precisa de fornecedor, preço e (item existente ou nome).
    const pending = items.filter(
      (i) => !i.alloc_supplier_id || i.alloc_price == null || (!i.alloc_item_id && !(i.alloc_name || i.free_text || i.product_name))
    );
    if (pending.length) {
      throw badRequest(`${pending.length} item(ns) sem alocação completa (fornecedor e preço)`);
    }

    type Line = RequestItemRow & { product_name: string | null };
    const orderIds = await withTransaction(async (client) => {
      // Agrupa por fornecedor.
      const bySupplier = new Map<number, Line[]>();
      for (const i of items) {
        const arr = bySupplier.get(i.alloc_supplier_id!) ?? [];
        arr.push(i);
        bySupplier.set(i.alloc_supplier_id!, arr);
      }

      const created: number[] = [];
      for (const [supplierId, lines] of bySupplier) {
        const o = await client.query<{ id: number }>(
          `INSERT INTO orders (supplier_id, purchase_request_id, created_by, notes)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [supplierId, id, userId, `Gerado da lista #${id}`]
        );
        const orderId = o.rows[0].id;

        for (const line of lines) {
          let itemId = line.alloc_item_id;
          if (!itemId) {
            // Cria item no fornecedor (vincula ao produto canônico quando houver).
            const name = (line.alloc_name || line.free_text || line.product_name)!.trim();
            const unit = line.alloc_unit || line.unit || 'un';
            const newItem = await client.query<{ id: number }>(
              `INSERT INTO items (supplier_id, product_id, name, unit, base_price)
               VALUES ($1, $2, $3, $4, $5) RETURNING id`,
              [supplierId, line.product_id ?? null, name, unit, line.alloc_price]
            );
            itemId = newItem.rows[0].id;
          }
          await client.query(
            `INSERT INTO order_items (order_id, item_id, quantity, unit_price, notes)
             VALUES ($1, $2, $3, $4, $5)`,
            [orderId, itemId, line.quantity, line.alloc_price, line.notes ?? null]
          );
        }
        await client.query(
          `UPDATE orders SET total_amount = COALESCE(
             (SELECT SUM(subtotal) FROM order_items WHERE order_id = $1), 0) WHERE id = $1`,
          [orderId]
        );
        created.push(orderId);
      }

      await client.query(`UPDATE purchase_requests SET status = 'ordered' WHERE id = $1`, [id]);
      return created;
    });

    return { orderIds };
  },

  async cancel(id: number): Promise<PurchaseRequest> {
    const r = await this.getById(id);
    if (r.status === 'ordered' || r.status === 'cancelled') {
      throw badRequest('Lista já finalizada ou cancelada não pode ser cancelada');
    }
    const updated = await queryOne<PurchaseRequest>(
      `UPDATE purchase_requests SET status = 'cancelled' WHERE id = $1 RETURNING *`,
      [id]
    );
    return updated!;
  },
};
