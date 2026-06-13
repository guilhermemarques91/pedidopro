import { PoolClient } from 'pg';
import { query, queryOne, withTransaction } from '../../config/database';
import { parseImportWorkbook, ParsedRow, RowError } from './import.parser';

export interface ImportPreview {
  filename: string;
  totalRows: number;
  validRows: number;
  errorRows: number;
  newSuppliers: string[];
  newCategories: string[];
  newItems: number;
  updatedItems: number;
  errors: RowError[];
  sample: ParsedRow[];
}

export interface ImportResult {
  importId: number;
  totalRows: number;
  importedRows: number;
  errorRows: number;
  suppliersCreated: number;
  categoriesCreated: number;
  itemsCreated: number;
  itemsUpdated: number;
  errors: RowError[];
}

const norm = (s: string) => s.trim().toLowerCase();

export const importService = {
  /** Analisa a planilha e devolve o que seria criado/atualizado, sem gravar. */
  async preview(buffer: Buffer, filename: string): Promise<ImportPreview> {
    const { valid, errors, totalRows } = parseImportWorkbook(buffer);

    // Conjuntos de nomes existentes no banco (case-insensitive).
    const existingSuppliers = await this.fetchNameSet('suppliers');
    const existingCategories = await this.fetchNameSet('categories');

    const newSuppliers = new Set<string>();
    const newCategories = new Set<string>();

    for (const row of valid) {
      if (!existingSuppliers.has(norm(row.fornecedor))) newSuppliers.add(row.fornecedor);
      if (row.categoria && !existingCategories.has(norm(row.categoria))) {
        newCategories.add(row.categoria);
      }
    }

    // Estima itens novos vs. atualizados (por fornecedor+nome).
    const existingItems = await this.fetchItemKeySet();
    let newItems = 0;
    let updatedItems = 0;
    for (const row of valid) {
      const key = `${norm(row.fornecedor)}|${norm(row.item)}`;
      if (existingItems.has(key)) updatedItems++;
      else newItems++;
    }

    return {
      filename,
      totalRows,
      validRows: valid.length,
      errorRows: errors.length,
      newSuppliers: [...newSuppliers],
      newCategories: [...newCategories],
      newItems,
      updatedItems,
      errors,
      sample: valid.slice(0, 10),
    };
  },

  /** Grava de fato, em transação. Registra o job na tabela imports. */
  async commit(buffer: Buffer, filename: string, userId: number): Promise<ImportResult> {
    const { valid, errors, totalRows } = parseImportWorkbook(buffer);

    return withTransaction(async (client) => {
      const supplierCache = new Map<string, number>();
      const categoryCache = new Map<string, number>();
      let suppliersCreated = 0;
      let categoriesCreated = 0;
      let itemsCreated = 0;
      let itemsUpdated = 0;

      for (const row of valid) {
        const categoryId = row.categoria
          ? await this.findOrCreateCategory(client, row.categoria, categoryCache, () => categoriesCreated++)
          : null;

        const supplierId = await this.findOrCreateSupplier(
          client, row.fornecedor, row.whatsapp, categoryId, supplierCache, () => suppliersCreated++
        );

        const created = await this.upsertItem(client, supplierId, row);
        if (created) itemsCreated++;
        else itemsUpdated++;
      }

      const imp = await queryOne<{ id: number }>(
        `INSERT INTO imports (filename, status, total_rows, imported_rows, error_rows, error_log, created_by)
         VALUES ($1, 'done', $2, $3, $4, $5, $6) RETURNING id`,
        [filename, totalRows, valid.length, errors.length, JSON.stringify(errors), userId]
      );

      return {
        importId: imp!.id,
        totalRows,
        importedRows: valid.length,
        errorRows: errors.length,
        suppliersCreated,
        categoriesCreated,
        itemsCreated,
        itemsUpdated,
        errors,
      };
    });
  },

  async fetchNameSet(table: 'suppliers' | 'categories'): Promise<Set<string>> {
    const rows = await query<{ name: string }>(`SELECT name FROM ${table}`);
    return new Set(rows.map((r) => norm(r.name)));
  },

  async fetchItemKeySet(): Promise<Set<string>> {
    const rows = await query<{ name: string; supplier_name: string }>(
      `SELECT i.name, s.name AS supplier_name
         FROM items i JOIN suppliers s ON s.id = i.supplier_id`
    );
    return new Set(rows.map((r) => `${norm(r.supplier_name)}|${norm(r.name)}`));
  },

  async findOrCreateCategory(
    client: PoolClient, name: string, cache: Map<string, number>, onCreate: () => void
  ): Promise<number> {
    const key = norm(name);
    if (cache.has(key)) return cache.get(key)!;

    const existing = await client.query<{ id: number }>(
      'SELECT id FROM categories WHERE lower(name) = $1 LIMIT 1', [key]
    );
    if (existing.rows[0]) {
      cache.set(key, existing.rows[0].id);
      return existing.rows[0].id;
    }

    const created = await client.query<{ id: number }>(
      'INSERT INTO categories (name) VALUES ($1) RETURNING id', [name]
    );
    onCreate();
    cache.set(key, created.rows[0].id);
    return created.rows[0].id;
  },

  async findOrCreateSupplier(
    client: PoolClient, name: string, whatsapp: string | null, categoryId: number | null,
    cache: Map<string, number>, onCreate: () => void
  ): Promise<number> {
    const key = norm(name);
    if (cache.has(key)) return cache.get(key)!;

    const existing = await client.query<{ id: number }>(
      'SELECT id FROM suppliers WHERE lower(name) = $1 LIMIT 1', [key]
    );
    if (existing.rows[0]) {
      cache.set(key, existing.rows[0].id);
      return existing.rows[0].id;
    }

    // Fornecedor novo nasce como whatsapp; usuário ajusta na tela depois.
    const created = await client.query<{ id: number }>(
      `INSERT INTO suppliers (name, order_type, whatsapp_number, category_id)
       VALUES ($1, 'whatsapp', $2, $3) RETURNING id`,
      [name, whatsapp, categoryId]
    );
    onCreate();
    cache.set(key, created.rows[0].id);
    return created.rows[0].id;
  },

  /** Insere o item; se já existir (fornecedor+nome), atualiza preço/embalagem. Retorna true se criou. */
  async upsertItem(client: PoolClient, supplierId: number, row: ParsedRow): Promise<boolean> {
    const existing = await client.query<{ id: number }>(
      'SELECT id FROM items WHERE supplier_id = $1 AND lower(name) = $2 LIMIT 1',
      [supplierId, norm(row.item)]
    );

    if (existing.rows[0]) {
      await client.query(
        `UPDATE items SET unit = $1, package_size = $2, package_unit = $3,
                base_price = COALESCE($4, base_price), active = true
         WHERE id = $5`,
        [row.unidade, row.embalagem_qtd, row.embalagem_unidade, row.preco, existing.rows[0].id]
      );
      return false;
    }

    await client.query(
      `INSERT INTO items (supplier_id, name, unit, package_size, package_unit, base_price)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [supplierId, row.item, row.unidade, row.embalagem_qtd, row.embalagem_unidade, row.preco]
    );
    return true;
  },
};
