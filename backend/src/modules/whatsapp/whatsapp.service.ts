import axios, { AxiosInstance } from 'axios';
import { env } from '../../config/env';
import { HttpError } from '../../shared/utils/http-error';
import { logger } from '../../shared/utils/logger';

/** Item simplificado usado na formatação da mensagem de pedido. */
export interface OrderMessageItem {
  name: string;
  quantity: number;
  unit: string;
  unit_price: number;
}

/** Dados mínimos do pedido para a mensagem. */
export interface OrderMessageData {
  id: number;
  total_amount: number;
  created_at?: Date | string;
}

/** Registro de mensagem cru retornado pela Evolution (campos relevantes). */
export interface EvolutionMessage {
  key?: { id?: string; fromMe?: boolean; remoteJid?: string };
  message?: {
    conversation?: string;
    extendedTextMessage?: { text?: string };
    imageMessage?: { caption?: string };
    documentMessage?: { caption?: string };
  };
  messageTimestamp?: number | string;
  pushName?: string;
}

/** Extrai o texto de um registro de mensagem da Evolution (vários formatos). */
export function messageText(m: EvolutionMessage): string {
  const msg = m.message ?? {};
  return (
    msg.conversation ??
    msg.extendedTextMessage?.text ??
    msg.imageMessage?.caption ??
    msg.documentMessage?.caption ??
    ''
  ).trim();
}

const client: AxiosInstance = axios.create({
  baseURL: env.EVOLUTION_API_URL,
  headers: { apikey: env.EVOLUTION_API_KEY },
  timeout: 15000,
});

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDate(d: Date | string | undefined): string {
  const date = d ? new Date(d) : new Date();
  return date.toLocaleDateString('pt-BR');
}

export const whatsappService = {
  /**
   * Envia uma mensagem de texto via Evolution API.
   * POST {EVOLUTION_API_URL}/message/sendText/{instance}
   */
  async sendMessage(to: string, message: string): Promise<void> {
    try {
      await client.post(`/message/sendText/${env.EVOLUTION_INSTANCE}`, {
        number: to,
        text: message,
      });
      logger.info(`Mensagem WhatsApp enviada para ${to}`);
    } catch (err) {
      const detail = axios.isAxiosError(err)
        ? err.response?.data ?? err.message
        : String(err);
      logger.error('Falha ao enviar mensagem WhatsApp:', detail);
      throw new HttpError(502, 'Falha ao enviar mensagem pelo WhatsApp');
    }
  },

  /** Monta a mensagem de pedido formatada para WhatsApp. */
  formatOrderMessage(order: OrderMessageData, items: OrderMessageItem[]): string {
    const lines = items.map(
      (it) =>
        `• ${it.quantity}x ${it.name} (${it.unit}) — ${formatBRL(it.unit_price)}/un`
    );

    return [
      `🛒 *Pedido #${order.id} — PedidoPro*`,
      `📅 Data: ${formatDate(order.created_at)}`,
      '',
      ...lines,
      '',
      `*Total: ${formatBRL(order.total_amount)}*`,
      '',
      'Confirmar recebimento respondendo esta mensagem.',
    ].join('\n');
  },

  /**
   * Busca mensagens de um chat (remoteJid) na Evolution.
   * POST {EVOLUTION_API_URL}/chat/findMessages/{instance}
   * Retorna os registros crus (key, message, messageTimestamp...).
   */
  async fetchMessages(remoteJid: string): Promise<EvolutionMessage[]> {
    try {
      const { data } = await client.post(
        `/chat/findMessages/${env.EVOLUTION_INSTANCE}`,
        { where: { key: { remoteJid } } }
      );
      const records = data?.messages?.records ?? data?.records ?? data;
      return Array.isArray(records) ? records : [];
    } catch (err) {
      const detail = axios.isAxiosError(err) ? err.response?.data ?? err.message : String(err);
      logger.error(`Falha ao buscar mensagens de ${remoteJid}:`, detail);
      return [];
    }
  },

  /**
   * Verifica se a instância está conectada.
   * GET {EVOLUTION_API_URL}/instance/connectionState/{instance}
   */
  async checkConnection(): Promise<boolean> {
    try {
      const { data } = await client.get(
        `/instance/connectionState/${env.EVOLUTION_INSTANCE}`
      );
      // Evolution retorna algo como { instance: { state: 'open' } }
      const state: string | undefined = data?.instance?.state ?? data?.state;
      return state === 'open';
    } catch (err) {
      const detail = axios.isAxiosError(err)
        ? err.response?.data ?? err.message
        : String(err);
      logger.error('Falha ao verificar conexão WhatsApp:', detail);
      return false;
    }
  },
};
