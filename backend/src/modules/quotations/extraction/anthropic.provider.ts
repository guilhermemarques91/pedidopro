import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../../config/env';
import { HttpError } from '../../../shared/utils/http-error';
import { logger } from '../../../shared/utils/logger';
import {
  ExtractionProvider, ExtractedPriceRow,
  IMAGE_MEDIA, ITEMS_JSON_SCHEMA, EXTRACTION_SYSTEM_PROMPT, normalizeRows,
} from './types';

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) {
    throw new HttpError(500, 'ANTHROPIC_API_KEY não configurada (AI_PROVIDER=anthropic).');
  }
  if (!_client) {
    _client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 120_000, maxRetries: 1 });
  }
  return _client;
}

const EXTRACTION_TOOL: Anthropic.Tool = {
  name: 'registrar_precos',
  description: 'Registra a lista de itens e preços extraídos.',
  input_schema: ITEMS_JSON_SCHEMA as unknown as Anthropic.Tool.InputSchema,
};

async function call(content: Anthropic.ContentBlockParam[]): Promise<ExtractedPriceRow[]> {
  let response: Anthropic.Message;
  try {
    response = await client().messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 16000,
      system: EXTRACTION_SYSTEM_PROMPT,
      tools: [EXTRACTION_TOOL],
      tool_choice: { type: 'tool', name: 'registrar_precos' },
      messages: [{ role: 'user', content }],
    });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    logger.error('Falha na chamada à Claude API:', err instanceof Error ? err.message : err);
    throw new HttpError(502, 'Falha ao extrair preços com a IA. Verifique a ANTHROPIC_API_KEY.');
  }

  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
  if (!toolUse) throw new HttpError(502, 'A IA não retornou itens estruturados.');
  return normalizeRows((toolUse.input as { items?: unknown }).items);
}

export const anthropicProvider: ExtractionProvider = {
  extractFromText(text) {
    return call([{ type: 'text', text: `Extraia os itens e preços do texto a seguir:\n\n${text}` }]);
  },

  extractFromImage(buffer, mediaType) {
    let block: Anthropic.ContentBlockParam;
    const data = buffer.toString('base64');
    if (mediaType === 'application/pdf') {
      block = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } };
    } else if ((IMAGE_MEDIA as readonly string[]).includes(mediaType)) {
      block = { type: 'image', source: { type: 'base64', media_type: mediaType as (typeof IMAGE_MEDIA)[number], data } };
    } else {
      throw new HttpError(400, 'Tipo de arquivo não suportado para extração.');
    }
    return call([block, { type: 'text', text: 'Extraia todos os itens e preços deste documento.' }]);
  },
};
