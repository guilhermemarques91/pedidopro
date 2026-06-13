import * as XLSX from 'xlsx';

/** Linha já normalizada e validada, pronta para gravação. */
export interface ParsedRow {
  rowNumber: number; // linha na planilha (1-based, contando o cabeçalho)
  fornecedor: string;
  categoria: string | null;
  item: string;
  unidade: string;
  embalagem_qtd: number | null;
  embalagem_unidade: string | null;
  preco: number | null;
  whatsapp: string | null;
}

export interface RowError {
  rowNumber: number;
  errors: string[];
  raw: Record<string, unknown>;
}

export interface ParseResult {
  valid: ParsedRow[];
  errors: RowError[];
  totalRows: number;
}

/** Cabeçalhos canônicos esperados. */
const CANONICAL = [
  'fornecedor',
  'categoria',
  'item',
  'unidade',
  'embalagem_qtd',
  'embalagem_unidade',
  'preco',
  'whatsapp',
] as const;

/** Remove acentos, baixa caixa e tira espaços para casar cabeçalhos. */
function normalizeHeader(h: string): string {
  return String(h)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

/** Converte texto BR ("1.234,56" / "12,90") ou número em float. */
export function parseDecimal(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  let s = String(value).trim();
  if (s === '') return null;

  if (s.includes(',')) {
    // Vírgula é o separador decimal; pontos são milhar.
    s = s.replace(/\./g, '').replace(',', '.');
  }
  s = s.replace(/[^0-9.\-]/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function cleanStr(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

/** Só dígitos (para o número de WhatsApp). */
function cleanPhone(value: unknown): string | null {
  const digits = cleanStr(value).replace(/\D/g, '');
  return digits.length ? digits : null;
}

/**
 * Lê o buffer do .xlsx, normaliza cabeçalhos e valida cada linha.
 * Linhas inválidas vão para `errors` sem interromper as demais.
 */
export function parseImportWorkbook(buffer: Buffer): ParseResult {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    return { valid: [], errors: [], totalRows: 0 };
  }

  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    header: 1,
    defval: '',
    blankrows: false,
  }) as unknown as unknown[][];

  if (rows.length === 0) {
    return { valid: [], errors: [], totalRows: 0 };
  }

  // Mapeia índice de coluna -> chave canônica.
  const headerRow = rows[0].map((h) => normalizeHeader(String(h)));
  const colIndex: Partial<Record<(typeof CANONICAL)[number], number>> = {};
  headerRow.forEach((h, idx) => {
    if ((CANONICAL as readonly string[]).includes(h)) {
      colIndex[h as (typeof CANONICAL)[number]] = idx;
    }
  });

  const get = (row: unknown[], key: (typeof CANONICAL)[number]): unknown => {
    const idx = colIndex[key];
    return idx === undefined ? '' : row[idx];
  };

  const valid: ParsedRow[] = [];
  const errors: RowError[] = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const rowNumber = r + 1; // linha real na planilha (1-based)

    const fornecedor = cleanStr(get(row, 'fornecedor'));
    const item = cleanStr(get(row, 'item'));
    const unidade = cleanStr(get(row, 'unidade'));

    const rowErrors: string[] = [];
    if (!fornecedor) rowErrors.push('fornecedor vazio');
    if (!item) rowErrors.push('item vazio');
    if (!unidade) rowErrors.push('unidade vazia');

    if (rowErrors.length) {
      // Ignora linhas totalmente em branco silenciosamente.
      const allEmpty = !fornecedor && !item && !unidade &&
        cleanStr(get(row, 'preco')) === '';
      if (!allEmpty) {
        errors.push({
          rowNumber,
          errors: rowErrors,
          raw: { fornecedor, item, unidade },
        });
      }
      continue;
    }

    valid.push({
      rowNumber,
      fornecedor,
      categoria: cleanStr(get(row, 'categoria')) || null,
      item,
      unidade,
      embalagem_qtd: parseDecimal(get(row, 'embalagem_qtd')),
      embalagem_unidade: cleanStr(get(row, 'embalagem_unidade')) || null,
      preco: parseDecimal(get(row, 'preco')),
      whatsapp: cleanPhone(get(row, 'whatsapp')),
    });
  }

  return { valid, errors, totalRows: rows.length - 1 };
}
