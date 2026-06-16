import axios from 'axios';
import { query, queryOne } from '../../config/database';
import { env } from '../../config/env';
import { notFound, badRequest } from '../../shared/utils/http-error';
import { logger } from '../../shared/utils/logger';

export interface Product {
  id: number;
  name: string;
  category_id: number | null;
  active: boolean;
  created_at: Date;
}

export interface SuggestedGroup {
  suggested_name: string;
  item_ids: number[];
  items: { id: number; name: string; supplier_name: string }[];
}

const ollama = axios.create({ baseURL: env.OLLAMA_URL, timeout: 300_000 });

export const productsService = {
  async list(): Promise<unknown[]> {
    return query(
      `SELECT p.*, c.name AS category_name,
              COUNT(i.id) FILTER (WHERE i.active) AS item_count
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         LEFT JOIN items i ON i.product_id = p.id
        WHERE p.active = true
        GROUP BY p.id, c.name
        ORDER BY p.name`
    );
  },

  async getById(id: number): Promise<Product> {
    const p = await queryOne<Product>('SELECT * FROM products WHERE id = $1', [id]);
    if (!p) throw notFound('Produto não encontrado');
    return p;
  },

  async getWithItems(id: number): Promise<unknown> {
    const product = await this.getById(id);
    const items = await query(
      `SELECT i.id, i.name, i.unit, i.base_price, s.name AS supplier_name
         FROM items i JOIN suppliers s ON s.id = i.supplier_id
        WHERE i.product_id = $1 AND i.active = true
        ORDER BY s.name, i.name`,
      [id]
    );
    return { ...product, items };
  },

  async create(name: string, categoryId?: number): Promise<Product> {
    const p = await queryOne<Product>(
      'INSERT INTO products (name, category_id) VALUES ($1, $2) RETURNING *',
      [name, categoryId ?? null]
    );
    return p!;
  },

  async update(id: number, dto: { name?: string; category_id?: number | null }): Promise<Product> {
    await this.getById(id);
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (dto.name !== undefined) { fields.push(`name = $${i++}`); values.push(dto.name); }
    if (dto.category_id !== undefined) { fields.push(`category_id = $${i++}`); values.push(dto.category_id); }
    if (!fields.length) throw badRequest('Nada para atualizar');
    values.push(id);
    const p = await queryOne<Product>(`UPDATE products SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);
    return p!;
  },

  /** Soft delete: desativa o produto e desvincula os itens. */
  async remove(id: number): Promise<void> {
    await this.getById(id);
    await query('UPDATE items SET product_id = NULL WHERE product_id = $1', [id]);
    await query('UPDATE products SET active = false WHERE id = $1', [id]);
  },

  /** Itens ativos ainda não vinculados a nenhum produto. */
  async unmapped(): Promise<unknown[]> {
    return query(
      `SELECT i.id, i.name, i.unit, s.name AS supplier_name
         FROM items i JOIN suppliers s ON s.id = i.supplier_id
        WHERE i.active = true AND i.product_id IS NULL
        ORDER BY lower(i.name)`
    );
  },

  async assign(productId: number, itemIds: number[]): Promise<{ assigned: number }> {
    await this.getById(productId);
    if (!itemIds.length) throw badRequest('Selecione ao menos um item');
    const r = await query<{ id: number }>(
      'UPDATE items SET product_id = $1 WHERE id = ANY($2::int[]) RETURNING id',
      [productId, itemIds]
    );
    return { assigned: r.length };
  },

  async unassign(itemIds: number[]): Promise<{ unassigned: number }> {
    if (!itemIds.length) throw badRequest('Selecione ao menos um item');
    const r = await query<{ id: number }>(
      'UPDATE items SET product_id = NULL WHERE id = ANY($1::int[]) RETURNING id',
      [itemIds]
    );
    return { unassigned: r.length };
  },

  /**
   * Sugere agrupamentos dos itens não-mapeados via IA local (Ollama).
   * Retorna grupos de itens que parecem ser o mesmo produto — apenas SUGESTÃO,
   * nada é gravado. O usuário confirma na tela.
   */
  async suggestGroups(): Promise<SuggestedGroup[]> {
    const items = (await this.unmapped()) as { id: number; name: string; supplier_name: string }[];
    if (items.length < 2) return [];
    const batch = items.slice(0, 60); // limita p/ não pesar na CPU

    const list = batch.map((it) => `${it.id}: ${it.name}`).join('\n');
    const schema = {
      type: 'object',
      properties: {
        groups: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Nome canônico sugerido para o grupo' },
              item_ids: { type: 'array', items: { type: 'number' }, description: 'IDs dos itens equivalentes' },
            },
            required: ['name', 'item_ids'],
          },
        },
      },
      required: ['groups'],
    };

    let content: string;
    try {
      const { data } = await ollama.post('/api/chat', {
        model: env.OLLAMA_MODEL,
        stream: false,
        format: schema,
        options: { temperature: 0 },
        messages: [
          {
            role: 'system',
            content:
              'Você agrupa produtos de açougue/alimentos que são EQUIVALENTES (mesmo produto com nomes diferentes ' +
              'ou sinônimos do setor, ex.: "acém" = "acém completo"). Agrupe apenas itens que sejam claramente o mesmo ' +
              'produto. NÃO invente itens nem IDs. Itens sem equivalente devem ficar de fora. Responda só com o JSON.',
          },
          { role: 'user', content: `Itens (id: nome):\n${list}\n\nAgrupe os equivalentes.` },
        ],
      });
      content = data?.message?.content ?? '';
    } catch (err) {
      logger.error('Falha ao sugerir agrupamentos (Ollama):', err instanceof Error ? err.message : err);
      throw badRequest('IA local indisponível para sugerir agrupamentos. Verifique o Ollama.');
    }

    let parsed: { groups?: { name?: string; item_ids?: number[] }[] };
    try { parsed = JSON.parse(content); } catch { return []; }

    const validIds = new Set(batch.map((b) => b.id));
    const byId = new Map(batch.map((b) => [b.id, b]));
    return (parsed.groups ?? [])
      .map((g) => {
        const ids = (g.item_ids ?? []).filter((id) => validIds.has(id));
        return {
          suggested_name: (g.name ?? '').trim() || 'Produto',
          item_ids: ids,
          items: ids.map((id) => byId.get(id)!),
        };
      })
      .filter((g) => g.item_ids.length >= 2); // só grupos com 2+ itens são úteis
  },
};
