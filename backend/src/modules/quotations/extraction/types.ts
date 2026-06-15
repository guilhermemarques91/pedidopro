/** Uma linha de preço extraída de um documento/texto por IA. */
export interface ExtractedPriceRow {
  name: string;
  unit: string;
  price: number | null;
  quantity: number | null;
  notes: string | null;
}

/** Contrato que cada provedor de IA (Ollama, Anthropic) implementa. */
export interface ExtractionProvider {
  extractFromText(text: string): Promise<ExtractedPriceRow[]>;
  extractFromImage(buffer: Buffer, mediaType: string): Promise<ExtractedPriceRow[]>;
}

/** Mídias de imagem aceitas para extração por visão. */
export const IMAGE_MEDIA = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

/**
 * JSON Schema da saída estruturada (lista de itens). Usado tanto como
 * tool input_schema (Anthropic) quanto como `format` (Ollama).
 */
export const ITEMS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      description: 'Cada produto/insumo encontrado com seu preço.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Nome/descrição do produto' },
          unit: { type: 'string', description: 'Unidade (kg, un, cx, L, pct...). Use "un" se não informado.' },
          price: { type: ['number', 'null'], description: 'Preço unitário em reais (ponto decimal). null se ausente.' },
          quantity: { type: ['number', 'null'], description: 'Quantidade, se houver. null caso contrário.' },
          notes: { type: ['string', 'null'], description: 'Observação relevante (marca, embalagem). null se nada.' },
        },
        required: ['name', 'unit', 'price', 'quantity', 'notes'],
      },
    },
  },
  required: ['items'],
} as const;

export const EXTRACTION_SYSTEM_PROMPT =
  'Você extrai preços de cotações de fornecedores brasileiros (mensagens de WhatsApp, ' +
  'orçamentos, tabelas de preço, fotos de listas). Os preços estão em reais (R$), ' +
  'geralmente com vírgula decimal — converta para número com ponto (ex: "12,90" → 12.90). ' +
  'Extraia TODOS os itens com preço que conseguir identificar. Não invente itens nem preços: ' +
  'se um preço não estiver legível/presente, use null. Responda apenas com o JSON estruturado.';

/** Normaliza a lista crua de itens vinda da IA para ExtractedPriceRow[]. */
export function normalizeRows(raw: unknown): ExtractedPriceRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => r as Record<string, unknown>)
    .filter((r) => typeof r.name === 'string' && (r.name as string).trim() !== '')
    .map((r) => ({
      name: String(r.name).trim(),
      unit: typeof r.unit === 'string' && r.unit.trim() ? r.unit.trim() : 'un',
      price: typeof r.price === 'number' && Number.isFinite(r.price) ? r.price : null,
      quantity: typeof r.quantity === 'number' && Number.isFinite(r.quantity) ? r.quantity : null,
      notes: typeof r.notes === 'string' && r.notes.trim() ? r.notes.trim() : null,
    }));
}
