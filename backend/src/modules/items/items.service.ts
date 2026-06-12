import { query, queryOne } from '../../config/database';
import { notFound, badRequest } from '../../shared/utils/http-error';
import { CreateItemDto, UpdateItemDto } from './items.dto';

export interface Item {
  id: number;
  supplier_id: number;
  name: string;
  unit: string;
  package_size: string | null; // NUMERIC volta como string no pg
  package_unit: string | null;
  base_price: string | null;
  active: boolean;
  created_at: Date;
}

export interface ItemWithSupplier extends Item {
  supplier_name: string;
}

const COLUMNS = [
  'supplier_id',
  'name',
  'unit',
  'package_size',
  'package_unit',
  'base_price',
] as const;

export const itemsService = {
  /** Lista itens; opcionalmente filtra por fornecedor. */
  async list(opts: { supplierId?: number; includeInactive?: boolean } = {}): Promise<ItemWithSupplier[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (!opts.includeInactive) conditions.push('i.active = true');
    if (opts.supplierId != null) {
      params.push(opts.supplierId);
      conditions.push(`i.supplier_id = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    return query<ItemWithSupplier>(
      `SELECT i.*, s.name AS supplier_name
         FROM items i
         JOIN suppliers s ON s.id = i.supplier_id
         ${where}
         ORDER BY s.name, i.name`,
      params
    );
  },

  async getById(id: number): Promise<ItemWithSupplier> {
    const row = await queryOne<ItemWithSupplier>(
      `SELECT i.*, s.name AS supplier_name
         FROM items i
         JOIN suppliers s ON s.id = i.supplier_id
        WHERE i.id = $1`,
      [id]
    );
    if (!row) throw notFound('Item não encontrado');
    return row;
  },

  async create(dto: CreateItemDto): Promise<Item> {
    await this.assertSupplierExists(dto.supplier_id);
    const values = COLUMNS.map((c) => (dto as Record<string, unknown>)[c] ?? null);
    const placeholders = COLUMNS.map((_, i) => `$${i + 1}`).join(', ');
    const item = await queryOne<Item>(
      `INSERT INTO items (${COLUMNS.join(', ')})
       VALUES (${placeholders}) RETURNING *`,
      values
    );
    return item!;
  },

  async update(id: number, dto: UpdateItemDto): Promise<Item> {
    await this.getById(id);
    if (dto.supplier_id !== undefined) {
      await this.assertSupplierExists(dto.supplier_id);
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const col of COLUMNS) {
      const val = (dto as Record<string, unknown>)[col];
      if (val !== undefined) {
        fields.push(`${col} = $${i++}`);
        values.push(val);
      }
    }

    values.push(id);
    const item = await queryOne<Item>(
      `UPDATE items SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    return item!;
  },

  /** Soft delete. */
  async remove(id: number): Promise<void> {
    await this.getById(id);
    await query('UPDATE items SET active = false WHERE id = $1', [id]);
  },

  async assertSupplierExists(supplierId: number): Promise<void> {
    const sup = await queryOne<{ id: number }>(
      'SELECT id FROM suppliers WHERE id = $1 AND active = true',
      [supplierId]
    );
    if (!sup) throw badRequest('Fornecedor informado não existe ou está inativo');
  },
};
