import { query, queryOne } from '../../config/database';
import { notFound } from '../../shared/utils/http-error';
import { CreateCategoryDto, UpdateCategoryDto } from './categories.dto';

export interface Category {
  id: number;
  name: string;
  color: string | null;
  icon: string | null;
  active: boolean;
  created_at: Date;
}

export const categoriesService = {
  async list(includeInactive = false): Promise<Category[]> {
    if (includeInactive) {
      return query<Category>('SELECT * FROM categories ORDER BY name');
    }
    return query<Category>(
      'SELECT * FROM categories WHERE active = true ORDER BY name'
    );
  },

  async getById(id: number): Promise<Category> {
    const cat = await queryOne<Category>(
      'SELECT * FROM categories WHERE id = $1',
      [id]
    );
    if (!cat) throw notFound('Categoria não encontrada');
    return cat;
  },

  async create(dto: CreateCategoryDto): Promise<Category> {
    const cat = await queryOne<Category>(
      `INSERT INTO categories (name, color, icon)
       VALUES ($1, $2, $3) RETURNING *`,
      [dto.name, dto.color ?? null, dto.icon ?? null]
    );
    return cat!;
  },

  async update(id: number, dto: UpdateCategoryDto): Promise<Category> {
    // Garante que existe antes de atualizar.
    await this.getById(id);

    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (dto.name !== undefined) { fields.push(`name = $${i++}`); values.push(dto.name); }
    if (dto.color !== undefined) { fields.push(`color = $${i++}`); values.push(dto.color); }
    if (dto.icon !== undefined) { fields.push(`icon = $${i++}`); values.push(dto.icon); }

    values.push(id);
    const cat = await queryOne<Category>(
      `UPDATE categories SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    return cat!;
  },

  /** Soft delete: marca active = false. */
  async remove(id: number): Promise<void> {
    await this.getById(id);
    await query('UPDATE categories SET active = false WHERE id = $1', [id]);
  },
};
