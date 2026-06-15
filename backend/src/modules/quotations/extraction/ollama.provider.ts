import axios from 'axios';
import { env } from '../../../config/env';
import { HttpError } from '../../../shared/utils/http-error';
import { logger } from '../../../shared/utils/logger';
import {
  ExtractionProvider, ExtractedPriceRow,
  ITEMS_JSON_SCHEMA, EXTRACTION_SYSTEM_PROMPT, normalizeRows,
} from './types';

// Cliente Ollama local. 127.0.0.1 por causa do Topaz (sequestra localhost).
// Timeout alto: inferência em CPU é lenta.
const client = axios.create({ baseURL: env.OLLAMA_URL, timeout: 300_000 });

interface OllamaChatResponse {
  message?: { content?: string };
}

async function chat(model: string, userContent: string, images?: string[]): Promise<ExtractedPriceRow[]> {
  let data: OllamaChatResponse;
  try {
    const res = await client.post<OllamaChatResponse>('/api/chat', {
      model,
      stream: false,
      format: ITEMS_JSON_SCHEMA,
      options: { temperature: 0 },
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
        { role: 'user', content: userContent, ...(images ? { images } : {}) },
      ],
    });
    data = res.data;
  } catch (err) {
    if (axios.isAxiosError(err) && (err.code === 'ECONNREFUSED' || err.response?.status === 404)) {
      logger.error('Ollama indisponível ou modelo não baixado:', err.message);
      throw new HttpError(502, `IA local indisponível. Verifique se o Ollama está rodando e o modelo "${model}" foi baixado (ollama pull ${model}).`);
    }
    logger.error('Falha na chamada ao Ollama:', err instanceof Error ? err.message : err);
    throw new HttpError(502, 'Falha ao extrair preços com a IA local.');
  }

  const content = data.message?.content;
  if (!content) throw new HttpError(502, 'A IA local não retornou conteúdo.');

  let parsed: { items?: unknown };
  try {
    parsed = JSON.parse(content);
  } catch {
    logger.error('Resposta do Ollama não é JSON válido:', content.slice(0, 500));
    throw new HttpError(502, 'A IA local não retornou JSON estruturado válido.');
  }
  return normalizeRows(parsed.items);
}

export const ollamaProvider: ExtractionProvider = {
  extractFromText(text) {
    return chat(env.OLLAMA_MODEL, `Extraia os itens e preços do texto a seguir:\n\n${text}`);
  },

  extractFromImage(buffer) {
    if (!env.OLLAMA_VISION_MODEL) {
      throw new HttpError(422, 'Extração de imagem requer um modelo de visão. Configure OLLAMA_VISION_MODEL (ex: qwen2.5vl:3b) ou envie o orçamento como texto.');
    }
    return chat(
      env.OLLAMA_VISION_MODEL,
      'Extraia todos os itens e preços desta imagem de cotação.',
      [buffer.toString('base64')]
    );
  },
};
