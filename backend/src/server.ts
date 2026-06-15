import cron from 'node-cron';
import app from './app';
import { env } from './config/env';
import { pool } from './config/database';
import { logger } from './shared/utils/logger';
import { syncWhatsappInbox } from './modules/inbox/whatsapp.sync';

const port = Number(env.PORT);

const server = app.listen(port, () => {
  logger.info(`PedidoPro API rodando em http://localhost:${port} (${env.NODE_ENV})`);
});

// Sincronização automática diária do WhatsApp → fila de revisão de preços.
if (env.INBOX_SYNC_ENABLED && cron.validate(env.INBOX_SYNC_CRON)) {
  cron.schedule(env.INBOX_SYNC_CRON, () => {
    logger.info('Disparando sync automático do WhatsApp...');
    syncWhatsappInbox().catch((e) => logger.error('Sync automático falhou:', e));
  });
  logger.info(`Sync WhatsApp agendado: "${env.INBOX_SYNC_CRON}"`);
}

// Encerramento gracioso
async function shutdown(signal: string) {
  logger.info(`Recebido ${signal}, encerrando...`);
  server.close(async () => {
    await pool.end();
    logger.info('Conexões encerradas. Até logo!');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
