import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { MulterError } from 'multer';
import { HttpError } from '../utils/http-error';
import { logger } from '../utils/logger';

/** Handler 404 para rotas não registradas. */
export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: 'Rota não encontrada' });
}

/** Handler global de erros. Deve ser o último middleware registrado. */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
) {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Dados inválidos',
      details: err.issues.map((i) => ({
        field: i.path.join('.'),
        message: i.message,
      })),
    });
    return;
  }

  if (err instanceof MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE'
      ? 'Arquivo excede o tamanho máximo (10 MB)'
      : `Erro no upload: ${err.message}`;
    res.status(400).json({ error: msg });
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

  logger.error(err);
  res.status(500).json({ error: 'Erro interno do servidor' });
}
