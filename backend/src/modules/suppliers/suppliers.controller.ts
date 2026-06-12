import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../shared/types';
import { badRequest } from '../../shared/utils/http-error';
import { createSupplierSchema, updateSupplierSchema } from './suppliers.dto';
import { suppliersService } from './suppliers.service';

function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('ID inválido');
  return id;
}

export const suppliersController = {
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const includeInactive = req.query.includeInactive === 'true';
      res.json(await suppliersService.list(includeInactive));
    } catch (err) {
      next(err);
    }
  },

  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json(await suppliersService.getById(parseId(req.params.id)));
    } catch (err) {
      next(err);
    }
  },

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const dto = createSupplierSchema.parse(req.body);
      res.status(201).json(await suppliersService.create(dto));
    } catch (err) {
      next(err);
    }
  },

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const dto = updateSupplierSchema.parse(req.body);
      res.json(await suppliersService.update(parseId(req.params.id), dto));
    } catch (err) {
      next(err);
    }
  },

  async remove(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await suppliersService.remove(parseId(req.params.id));
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
};
