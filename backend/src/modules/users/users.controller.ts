import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../shared/types';
import { badRequest } from '../../shared/utils/http-error';
import { createUserSchema, updateUserSchema, setActiveSchema } from './users.dto';
import { usersService } from './users.service';

function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('ID inválido');
  return id;
}

export const usersController = {
  async list(_req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await usersService.list()); } catch (err) { next(err); }
  },
  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const dto = createUserSchema.parse(req.body);
      res.status(201).json(await usersService.create(dto));
    } catch (err) { next(err); }
  },
  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const dto = updateUserSchema.parse(req.body);
      res.json(await usersService.update(parseId(req.params.id), dto, req.user!.id));
    } catch (err) { next(err); }
  },
  async setActive(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { active } = setActiveSchema.parse(req.body);
      res.json(await usersService.setActive(parseId(req.params.id), active, req.user!.id));
    } catch (err) { next(err); }
  },
};
