import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../shared/types';
import { badRequest } from '../../shared/utils/http-error';
import { createItemSchema, updateItemSchema } from './items.dto';
import { itemsService } from './items.service';

function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('ID inválido');
  return id;
}

export const itemsController = {
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const includeInactive = req.query.includeInactive === 'true';
      const supplierId = req.query.supplier_id
        ? parseId(String(req.query.supplier_id))
        : undefined;
      res.json(await itemsService.list({ supplierId, includeInactive }));
    } catch (err) {
      next(err);
    }
  },

  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json(await itemsService.getById(parseId(req.params.id)));
    } catch (err) {
      next(err);
    }
  },

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const dto = createItemSchema.parse(req.body);
      res.status(201).json(await itemsService.create(dto));
    } catch (err) {
      next(err);
    }
  },

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const dto = updateItemSchema.parse(req.body);
      res.json(await itemsService.update(parseId(req.params.id), dto));
    } catch (err) {
      next(err);
    }
  },

  async remove(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await itemsService.remove(parseId(req.params.id));
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
};
