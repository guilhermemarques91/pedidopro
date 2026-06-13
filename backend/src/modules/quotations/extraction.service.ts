import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config/env';
import { HttpError } from '../../shared/utils/http-error';
import { logger } from '../../shared/utils/logger';

/** Uma linha de preço extraída de um documento por IA. */
export interface ExtractedPriceRow {
  name: string;
  unit: string;
  price: number | null;
  quantity: number | null;
  notes: string | null;
}

// timeout/maxRetries baixos para não pendurar a requisição se a API estiver
// inacessível ou a chave for inválida — falha rápido e cai no catch (502).
const client = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY,
  timeout: 120_000,
  maxRetries: 1,
});

const IMAGE_MEDIA = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

const EXTRACTION_TOOL: Anthropic.Tool = {
  name: 'registrar_precos',
  description: 'Registra a lista de itens e preços extraídos do documento de cotação.',
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        description: 'Cada produto/insumo encontrado no documento com seu preço.',
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
  },
};

const SYSTEM_PROMPT =
  'Você extrai preços de documentos de cotação de fornecedores brasileiros ' +
  '(orçamentos, tabelas de preço, fotos de listas). Os preços estão em reais (R$), ' +
  'geralmente com vírgula decimal — converta para número com ponto (ex: "12,90" → 12.90). ' +
  'Extraia TODOS os itens com preço que conseguir identificar. Não invente itens nem preços: ' +
  'se um preço não estiver legível, use null. Chame a ferramenta registrar_precos com o resultado.';

function buildDocumentBlock(buffer: Buffer, mediaType: string): Anthropic.ContentBlockParam {
  const data = buffer.toString('base64');
  if (mediaType === 'application/pdf') {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } };
  }
  if ((IMAGE_MEDIA as readonly string[]).includes(mediaType)) {
    return {
      type: 'image',
      source: { type: 'base64', media_type: mediaType as (typeof IMAGE_MEDIA)[number], data },
    };
  }
  throw new HttpError(400, 'Tipo de arquivo não suportado para extração (use PDF ou imagem)');
}

export const extractionService = {
  /**
   * Envia o documento ao Claude e devolve as linhas de preço extraídas.
   * Lança HttpError 502 se a API falhar.
   */
  async extractFromDocument(buffer: Buffer, mediaType: string): Promise<ExtractedPriceRow[]> {
    const documentBlock = buildDocumentBlock(buffer, mediaType);

    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model: 'claude-opus-4-8',
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        tools: [EXTRACTION_TOOL],
        tool_choice: { type: 'tool', name: 'registrar_precos' },
        messages: [
          {
            role: 'user',
            content: [
              documentBlock,
              { type: 'text', text: 'Extraia todos os itens e preços deste documento.' },
            ],
          },
        ],
      });
    } catch (err) {
      logger.error('Falha na chamada à Claude API:', err instanceof Error ? err.message : err);
      throw new HttpError(502, 'Falha ao extrair preços com a IA. Verifique a ANTHROPIC_API_KEY.');
    }

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    );
    if (!toolUse) {
      throw new HttpError(502, 'A IA não retornou itens estruturados');
    }

    const raw = (toolUse.input as { items?: unknown }).items;
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
  },
};
