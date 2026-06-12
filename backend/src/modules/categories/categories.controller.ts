import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../shared/types';
import { badRequest } from '../../shared/utils/http-error';
import { createCategorySchema, updateCategorySchema } from './categories.dto';
import { categoriesService } from './categories.service';

function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('ID inválido');
  return id;
}

export const categoriesController = {
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const includeInactive = req.query.includeInactive === 'true';
      res.json(await categoriesService.list(includeInactive));
    } catch (err) {
      next(err);
    }
  },

  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json(await categoriesService.getById(parseId(req.params.id)));
    } catch (err) {
      next(err);
    }
  },

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const dto = createCategorySchema.parse(req.body);
      res.status(201).json(await categoriesService.create(dto));
    } catch (err) {
      next(err);
    }
  },

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const dto = updateCategorySchema.parse(req.body);
      res.json(await categoriesService.update(parseId(req.params.id), dto));
    } catch (err) {
      next(err);
    }
  },

  async remove(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await categoriesService.remove(parseId(req.params.id));
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
};
