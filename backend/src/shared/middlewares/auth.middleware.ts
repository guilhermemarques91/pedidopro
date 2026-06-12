import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { AuthRequest, JwtPayload, UserRole } from '../types';
import { unauthorized, forbidden } from '../utils/http-error';

/**
 * Valida o JWT no header `Authorization: Bearer <token>` e injeta
 * `req.user` com { id, email, role }.
 */
export function authenticate(req: AuthRequest, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return next(unauthorized('Token de autenticação ausente'));
  }

  const token = header.slice(7);

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    req.user = { id: payload.id, email: payload.email, role: payload.role };
    next();
  } catch {
    next(unauthorized('Token inválido ou expirado'));
  }
}

/**
 * Restringe a rota a determinados papéis. Use após `authenticate`.
 *
 * @example router.post('/', authenticate, authorize('admin'), handler)
 */
export function authorize(...roles: UserRole[]) {
  return (req: AuthRequest, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(forbidden('Você não tem permissão para esta ação'));
    }
    next();
  };
}
