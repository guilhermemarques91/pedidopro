import { query, queryOne } from '../../config/database';
import { notFound, badRequest } from '../../shared/utils/http-error';
import { CreateSupplierDto, UpdateSupplierDto } from './suppliers.dto';

export interface Supplier {
  id: number;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  category_id: number | null;
  order_type: 'portal' | 'whatsapp';
  portal_url: string | null;
  whatsapp_number: string | null;
  notes: string | null;
  active: boolean;
  created_at: Date;
}

export interface SupplierWithCategory extends Supplier {
  category_name: string | null;
}

const COLUMNS = [
  'name',
  'contact_name',
  'phone',
  'email',
  'category_id',
  'order_type',
  'portal_url',
  'whatsapp_number',
  'notes',
] as const;

export const suppliersService = {
  async list(includeInactive = false): Promise<SupplierWithCategory[]> {
    const where = includeInactive ? '' : 'WHERE s.active = true';
    return query<SupplierWithCategory>(
      `SELECT s.*, c.name AS category_name
         FROM suppliers s
         LEFT JOIN categories c ON c.id = s.category_id
         ${where}
         ORDER BY s.name`
    );
  },

  async getById(id: number): Promise<SupplierWithCategory> {
    const row = await queryOne<SupplierWithCategory>(
      `SELECT s.*, c.name AS category_name
         FROM suppliers s
         LEFT JOIN categories c ON c.id = s.category_id
        WHERE s.id = $1`,
      [id]
    );
    if (!row) throw notFound('Fornecedor não encontrado');
    return row;
  },

  async create(dto: CreateSupplierDto): Promise<Supplier> {
    await this.assertCategoryExists(dto.category_id);
    const values = COLUMNS.map((c) => (dto as Record<string, unknown>)[c] ?? null);
    const placeholders = COLUMNS.map((_, i) => `$${i + 1}`).join(', ');
    const sup = await queryOne<Supplier>(
      `INSERT INTO suppliers (${COLUMNS.join(', ')})
       VALUES (${placeholders}) RETURNING *`,
      values
    );
    return sup!;
  },

  async update(id: number, dto: UpdateSupplierDto): Promise<Supplier> {
    await this.getById(id);
    if (dto.category_id !== undefined) {
      await this.assertCategoryExists(dto.category_id);
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
    const sup = await queryOne<Supplier>(
      `UPDATE suppliers SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    return sup!;
  },

  /** Soft delete. */
  async remove(id: number): Promise<void> {
    await this.getById(id);
    await query('UPDATE suppliers SET active = false WHERE id = $1', [id]);
  },

  async assertCategoryExists(categoryId: number | null | undefined): Promise<void> {
    if (categoryId == null) return;
    const cat = await queryOne<{ id: number }>(
      'SELECT id FROM categories WHERE id = $1 AND active = true',
      [categoryId]
    );
    if (!cat) throw badRequest('Categoria informada não existe ou está inativa');
  },
};
