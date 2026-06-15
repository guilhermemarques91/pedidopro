import { env } from '../../../config/env';
import { HttpError } from '../../../shared/utils/http-error';
import { ExtractedPriceRow, ExtractionProvider } from './types';
import { ollamaProvider } from './ollama.provider';
import { anthropicProvider } from './anthropic.provider';

// pdf-parse é CommonJS sem tipos próprios; require tipado evita ruído de tipos.
const pdfParse = require('pdf-parse') as (b: Buffer) => Promise<{ text: string }>;

const provider: ExtractionProvider =
  env.AI_PROVIDER === 'anthropic' ? anthropicProvider : ollamaProvider;

/** Extrai preços de um texto puro (ex.: mensagem de WhatsApp). */
export function extractFromText(text: string): Promise<ExtractedPriceRow[]> {
  return provider.extractFromText(text);
}

/**
 * Extrai preços de um arquivo. PDF: tenta texto (pdf-parse) e usa o caminho de
 * texto — só cai em visão se for PDF escaneado. Imagem: caminho de visão.
 */
export async function extractFromDocument(
  buffer: Buffer,
  mediaType: string
): Promise<ExtractedPriceRow[]> {
  if (mediaType === 'application/pdf') {
    const { text } = await pdfParse(buffer).catch(() => ({ text: '' }));
    if (text && text.trim().length >= 20) {
      return provider.extractFromText(text);
    }
    // PDF sem texto extraível (escaneado).
    if (env.AI_PROVIDER === 'anthropic') {
      return provider.extractFromImage(buffer, 'application/pdf');
    }
    throw new HttpError(
      422,
      'PDF sem texto extraível (provavelmente escaneado). Cole o conteúdo como texto, ou configure um modelo de visão (OLLAMA_VISION_MODEL) e envie como imagem.'
    );
  }
  return provider.extractFromImage(buffer, mediaType);
}

export type { ExtractedPriceRow } from './types';
