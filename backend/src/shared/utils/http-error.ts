/**
 * Erro HTTP com status code. Lançado pelos services e tratado
 * pelo error.middleware global.
 */
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (msg = 'Requisição inválida') => new HttpError(400, msg);
export const unauthorized = (msg = 'Não autenticado') => new HttpError(401, msg);
export const forbidden = (msg = 'Acesso negado') => new HttpError(403, msg);
export const notFound = (msg = 'Recurso não encontrado') => new HttpError(404, msg);
