import { PoolClient } from 'pg';
import { query, queryOne, withTransaction } from '../../config/database';
import { notFound, badRequest } from '../../shared/utils/http-error';
import { whatsappService } from '../whatsapp/whatsapp.service';
import {
  CreateOrderDto,
  UpdateOrderDto,
  AddOrderItemDto,
  UpdateOrderItemDto,
} from './orders.dto';

export type OrderStatus =
  | 'draft' | 'pending_approval' | 'approved' | 'sent' | 'received' | 'cancelled';

export interface Order {
  id: number;
  supplier_id: number;
  quotation_id: number | null;
  status: OrderStatus;
  total_amount: string | null;
  notes: string | null;
  created_by: number;
  approved_by: number | null;
  approved_at: Date | null;
  sent_at: Date | null;
  received_at: Date | null;
  created_at: Date;
}

export interface OrderItemRow {
  id: number;
  order_id: number;
  item_id: number;
  quantity: string;
  unit_price: string;
  subtotal: string;
  notes: string | null;
  item_name: string;
  unit: string;
}

export const ordersService = {
  async list(opts: { status?: string; supplierId?: number } = {}): Promise<unknown[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (opts.status) { params.push(opts.status); conditions.push(`o.status = $${params.length}`); }
    if (opts.supplierId != null) { params.push(opts.supplierId); conditions.push(`o.supplier_id = $${params.length}`); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    return query(
      `SELECT o.*, s.name AS supplier_name, u.name AS created_by_name
         FROM orders o
         JOIN suppliers s ON s.id = o.supplier_id
         JOIN users u ON u.id = o.created_by
         ${where}
         ORDER BY o.created_at DESC`,
      params
    );
  },

  async getById(id: number): Promise<Order> {
    const o = await queryOne<Order>('SELECT * FROM orders WHERE id = $1', [id]);
    if (!o) throw notFound('Pedido não encontrado');
    return o;
  },

  /** Pedido completo: cabeçalho + fornecedor + itens + histórico de aprovações. */
  async getDetailed(id: number): Promise<unknown> {
    const order = await queryOne(
      `SELECT o.*, s.name AS supplier_name, s.order_type, s.whatsapp_number,
              u.name AS created_by_name, a.name AS approved_by_name
         FROM orders o
         JOIN suppliers s ON s.id = o.supplier_id
         JOIN users u ON u.id = o.created_by
         LEFT JOIN users a ON a.id = o.approved_by
        WHERE o.id = $1`,
      [id]
    );
    if (!order) throw notFound('Pedido não encontrado');
    const items = await this.getItems(id);
    const approvals = await query(
      `SELECT ap.*, u.name AS user_name
         FROM order_approvals ap JOIN users u ON u.id = ap.user_id
        WHERE ap.order_id = $1 ORDER BY ap.created_at`,
      [id]
    );
    return { ...order, items, approvals };
  },

  async getItems(orderId: number): Promise<OrderItemRow[]> {
    return query<OrderItemRow>(
      `SELECT oi.*, i.name AS item_name, i.unit
         FROM order_items oi JOIN items i ON i.id = oi.item_id
        WHERE oi.order_id = $1 ORDER BY i.name`,
      [orderId]
    );
  },

  async create(dto: CreateOrderDto, userId: number): Promise<unknown> {
    const supplier = await queryOne<{ id: number }>(
      'SELECT id FROM suppliers WHERE id = $1 AND active = true', [dto.supplier_id]
    );
    if (!supplier) throw badRequest('Fornecedor não existe ou está inativo');

    // Valida que todos os itens existem e pertencem ao fornecedor.
    for (const it of dto.items) {
      const item = await queryOne<{ supplier_id: number }>(
        'SELECT supplier_id FROM items WHERE id = $1', [it.item_id]
      );
      if (!item) throw badRequest(`Item ${it.item_id} não existe`);
      if (item.supplier_id !== dto.supplier_id) {
        throw badRequest(`Item ${it.item_id} não pertence ao fornecedor informado`);
      }
    }

    const orderId = await withTransaction(async (client) => {
      const o = await client.query<{ id: number }>(
        `INSERT INTO orders (supplier_id, quotation_id, notes, created_by)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [dto.supplier_id, dto.quotation_id ?? null, dto.notes ?? null, userId]
      );
      const id = o.rows[0].id;
      for (const it of dto.items) {
        await client.query(
          `INSERT INTO order_items (order_id, item_id, quantity, unit_price, notes)
           VALUES ($1, $2, $3, $4, $5)`,
          [id, it.item_id, it.quantity, it.unit_price, it.notes ?? null]
        );
      }
      await this.recalcTotal(client, id);
      return id;
    });

    return this.getDetailed(orderId);
  },

  async update(id: number, dto: UpdateOrderDto): Promise<Order> {
    const o = await this.getById(id);
    this.assertDraft(o);
    const updated = await queryOne<Order>(
      'UPDATE orders SET notes = $1 WHERE id = $2 RETURNING *',
      [dto.notes ?? null, id]
    );
    return updated!;
  },

  /** Remove o pedido (apenas em rascunho). */
  async remove(id: number): Promise<void> {
    const o = await this.getById(id);
    this.assertDraft(o);
    await withTransaction(async (client) => {
      await client.query('DELETE FROM order_items WHERE order_id = $1', [id]);
      await client.query('DELETE FROM orders WHERE id = $1', [id]);
    });
  },

  // ---- itens do pedido (somente em rascunho) ----

  async addItem(orderId: number, dto: AddOrderItemDto): Promise<unknown> {
    const o = await this.getById(orderId);
    this.assertDraft(o);
    const item = await queryOne<{ supplier_id: number }>(
      'SELECT supplier_id FROM items WHERE id = $1', [dto.item_id]
    );
    if (!item) throw badRequest('Item não existe');
    if (item.supplier_id !== o.supplier_id) {
      throw badRequest('Item não pertence ao fornecedor do pedido');
    }
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO order_items (order_id, item_id, quantity, unit_price, notes)
         VALUES ($1, $2, $3, $4, $5)`,
        [orderId, dto.item_id, dto.quantity, dto.unit_price, dto.notes ?? null]
      );
      await this.recalcTotal(client, orderId);
    });
    return this.getDetailed(orderId);
  },

  async updateItem(orderId: number, itemRowId: number, dto: UpdateOrderItemDto): Promise<unknown> {
    const o = await this.getById(orderId);
    this.assertDraft(o);
    await this.assertItemBelongs(orderId, itemRowId);

    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const key of ['quantity', 'unit_price', 'notes'] as const) {
      if (dto[key] !== undefined) { fields.push(`${key} = $${i++}`); values.push(dto[key]); }
    }
    values.push(itemRowId);
    await withTransaction(async (client) => {
      await client.query(`UPDATE order_items SET ${fields.join(', ')} WHERE id = $${i}`, values);
      await this.recalcTotal(client, orderId);
    });
    return this.getDetailed(orderId);
  },

  async removeItem(orderId: number, itemRowId: number): Promise<unknown> {
    const o = await this.getById(orderId);
    this.assertDraft(o);
    await this.assertItemBelongs(orderId, itemRowId);
    await withTransaction(async (client) => {
      await client.query('DELETE FROM order_items WHERE id = $1', [itemRowId]);
      await this.recalcTotal(client, orderId);
    });
    return this.getDetailed(orderId);
  },

  // ---- transições de estado ----

  /** rascunho → aguardando aprovação. */
  async submit(id: number): Promise<Order> {
    const o = await this.getById(id);
    if (o.status !== 'draft') throw badRequest('Apenas pedidos em rascunho podem ser enviados para aprovação');
    const items = await this.getItems(id);
    if (items.length === 0) throw badRequest('Pedido sem itens não pode ser enviado para aprovação');
    return this.setStatus(id, 'pending_approval');
  },

  /** aguardando aprovação → aprovado (registra aprovação). */
  async approve(id: number, userId: number, comment?: string): Promise<Order> {
    const o = await this.getById(id);
    if (o.status !== 'pending_approval') throw badRequest('Pedido não está aguardando aprovação');
    return withTransaction(async (client) => {
      await client.query(
        `INSERT INTO order_approvals (order_id, action, user_id, comment)
         VALUES ($1, 'approved', $2, $3)`,
        [id, userId, comment ?? null]
      );
      const r = await client.query<Order>(
        `UPDATE orders SET status = 'approved', approved_by = $1, approved_at = NOW()
         WHERE id = $2 RETURNING *`,
        [userId, id]
      );
      return r.rows[0];
    });
  },

  /** aguardando aprovação → volta a rascunho (registra rejeição com comentário). */
  async reject(id: number, userId: number, comment?: string): Promise<Order> {
    const o = await this.getById(id);
    if (o.status !== 'pending_approval') throw badRequest('Pedido não está aguardando aprovação');
    return withTransaction(async (client) => {
      await client.query(
        `INSERT INTO order_approvals (order_id, action, user_id, comment)
         VALUES ($1, 'rejected', $2, $3)`,
        [id, userId, comment ?? null]
      );
      const r = await client.query<Order>(
        `UPDATE orders SET status = 'draft', approved_by = NULL, approved_at = NULL
         WHERE id = $1 RETURNING *`,
        [id]
      );
      return r.rows[0];
    });
  },

  /**
   * aprovado → enviado. Se o fornecedor for do tipo whatsapp, dispara a
   * mensagem formatada via Evolution API. Para portal, apenas marca como enviado.
   */
  async send(id: number): Promise<{ order: Order; whatsappSent: boolean }> {
    const o = await this.getById(id);
    if (o.status !== 'approved') throw badRequest('Apenas pedidos aprovados podem ser enviados');

    const supplier = await queryOne<{
      order_type: string; whatsapp_number: string | null; name: string;
    }>('SELECT order_type, whatsapp_number, name FROM suppliers WHERE id = $1', [o.supplier_id]);
    if (!supplier) throw badRequest('Fornecedor do pedido não encontrado');

    let whatsappSent = false;
    if (supplier.order_type === 'whatsapp') {
      if (!supplier.whatsapp_number) {
        throw badRequest('Fornecedor não tem número de WhatsApp cadastrado');
      }
      const items = await this.getItems(id);
      const message = whatsappService.formatOrderMessage(
        { id: o.id, total_amount: Number(o.total_amount ?? 0), created_at: o.created_at },
        items.map((it) => ({
          name: it.item_name, quantity: Number(it.quantity),
          unit: it.unit, unit_price: Number(it.unit_price),
        }))
      );
      await whatsappService.sendMessage(supplier.whatsapp_number, message);
      whatsappSent = true;
    }

    const order = await this.setStatusWithTimestamp(id, 'sent', 'sent_at');
    return { order, whatsappSent };
  },

  /** enviado → recebido. */
  async receive(id: number): Promise<Order> {
    const o = await this.getById(id);
    if (o.status !== 'sent') throw badRequest('Apenas pedidos enviados podem ser marcados como recebidos');
    return this.setStatusWithTimestamp(id, 'received', 'received_at');
  },

  /** Cancela o pedido (qualquer estado exceto recebido/cancelado). */
  async cancel(id: number): Promise<Order> {
    const o = await this.getById(id);
    if (o.status === 'received' || o.status === 'cancelled') {
      throw badRequest('Pedido recebido ou já cancelado não pode ser cancelado');
    }
    return this.setStatus(id, 'cancelled');
  },

  // ---- helpers ----

  assertDraft(o: Order): void {
    if (o.status !== 'draft') {
      throw badRequest(`Pedido em status "${o.status}" não pode ser editado (apenas rascunho)`);
    }
  },

  async assertItemBelongs(orderId: number, itemRowId: number): Promise<void> {
    const row = await queryOne<{ id: number }>(
      'SELECT id FROM order_items WHERE id = $1 AND order_id = $2', [itemRowId, orderId]
    );
    if (!row) throw notFound('Item não encontrado neste pedido');
  },

  async recalcTotal(client: PoolClient, orderId: number): Promise<void> {
    await client.query(
      `UPDATE orders SET total_amount = COALESCE(
         (SELECT SUM(subtotal) FROM order_items WHERE order_id = $1), 0)
       WHERE id = $1`,
      [orderId]
    );
  },

  async setStatus(id: number, status: OrderStatus): Promise<Order> {
    const o = await queryOne<Order>(
      'UPDATE orders SET status = $1 WHERE id = $2 RETURNING *', [status, id]
    );
    return o!;
  },

  async setStatusWithTimestamp(id: number, status: OrderStatus, tsField: 'sent_at' | 'received_at'): Promise<Order> {
    const o = await queryOne<Order>(
      `UPDATE orders SET status = $1, ${tsField} = NOW() WHERE id = $2 RETURNING *`,
      [status, id]
    );
    return o!;
  },
};
