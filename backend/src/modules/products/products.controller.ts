import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../../shared/types';
import { badRequest } from '../../shared/utils/http-error';
import { productsService } from './products.service';

function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('ID inválido');
  return id;
}

const createSchema = z.object({
  name: z.string().min(1, 'Nome obrigatório').max(200),
  category_id: z.number().int().positive().optional(),
});
const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  category_id: z.number().int().positive().nullable().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'Informe ao menos um campo' });
const assignSchema = z.object({ item_ids: z.array(z.number().int().positive()).min(1) });

export const productsController = {
  async list(_req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await productsService.list()); } catch (err) { next(err); }
  },
  async unmapped(_req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await productsService.unmapped()); } catch (err) { next(err); }
  },
  async suggest(_req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await productsService.suggestGroups()); } catch (err) { next(err); }
  },
  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await productsService.getWithItems(parseId(req.params.id))); } catch (err) { next(err); }
  },
  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const dto = createSchema.parse(req.body);
      res.status(201).json(await productsService.create(dto.name, dto.category_id));
    } catch (err) { next(err); }
  },
  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const dto = updateSchema.parse(req.body);
      res.json(await productsService.update(parseId(req.params.id), dto));
    } catch (err) { next(err); }
  },
  async remove(req: AuthRequest, res: Response, next: NextFunction) {
    try { await productsService.remove(parseId(req.params.id)); res.status(204).send(); } catch (err) { next(err); }
  },
  async assign(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { item_ids } = assignSchema.parse(req.body);
      res.json(await productsService.assign(parseId(req.params.id), item_ids));
    } catch (err) { next(err); }
  },
  async unassign(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { item_ids } = assignSchema.parse(req.body);
      res.json(await productsService.unassign(item_ids));
    } catch (err) { next(err); }
  },
};
