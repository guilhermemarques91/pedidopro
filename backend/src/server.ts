import app from './app';
import { env } from './config/env';
import { pool } from './config/database';
import { logger } from './shared/utils/logger';

const port = Number(env.PORT);

const server = app.listen(port, () => {
  logger.info(`PedidoPro API rodando em http://localhost:${port} (${env.NODE_ENV})`);
});

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
