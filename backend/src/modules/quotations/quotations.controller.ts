import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../shared/types';
import { badRequest } from '../../shared/utils/http-error';
import {
  createQuotationSchema,
  updateQuotationSchema,
  addQuotationItemSchema,
  updateQuotationItemSchema,
} from './quotations.dto';
import { quotationsService } from './quotations.service';

function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('ID inválido');
  return id;
}

export const quotationsController = {
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const status = req.query.status ? String(req.query.status) : undefined;
      res.json(await quotationsService.list(status));
    } catch (err) { next(err); }
  },

  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json(await quotationsService.getWithItems(parseId(req.params.id)));
    } catch (err) { next(err); }
  },

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const dto = createQuotationSchema.parse(req.body);
      res.status(201).json(await quotationsService.create(dto, req.user!.id));
    } catch (err) { next(err); }
  },

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const dto = updateQuotationSchema.parse(req.body);
      res.json(await quotationsService.update(parseId(req.params.id), dto));
    } catch (err) { next(err); }
  },

  async remove(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await quotationsService.remove(parseId(req.params.id));
      res.status(204).send();
    } catch (err) { next(err); }
  },

  async close(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json(await quotationsService.close(parseId(req.params.id)));
    } catch (err) { next(err); }
  },

  async comparison(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json(await quotationsService.comparison(parseId(req.params.id)));
    } catch (err) { next(err); }
  },

  // ---- itens ----

  async addItem(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const dto = addQuotationItemSchema.parse(req.body);
      res.status(201).json(await quotationsService.addItem(parseId(req.params.id), dto));
    } catch (err) { next(err); }
  },

  async updateItem(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const dto = updateQuotationItemSchema.parse(req.body);
      res.json(await quotationsService.updateItem(
        parseId(req.params.id), parseId(req.params.itemId), dto
      ));
    } catch (err) { next(err); }
  },

  async removeItem(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await quotationsService.removeItem(parseId(req.params.id), parseId(req.params.itemId));
      res.status(204).send();
    } catch (err) { next(err); }
  },
};
