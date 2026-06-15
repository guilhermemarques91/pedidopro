import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../../shared/types';
import { badRequest } from '../../shared/utils/http-error';
import { inboxService } from './inbox.service';

function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('ID inválido');
  return id;
}

const updateSchema = z.object({
  item_name: z.string().min(1).optional(),
  unit: z.string().min(1).optional(),
  price: z.number().nonnegative().nullable().optional(),
  quantity: z.number().positive().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const approveSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1),
  quotation_id: z.number().int().positive(),
});

const discardSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1),
});

export const inboxController = {
  async list(_req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await inboxService.listPending()); } catch (err) { next(err); }
  },

  async count(_req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json({ count: await inboxService.count() }); } catch (err) { next(err); }
  },

  async sync(_req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await inboxService.sync()); } catch (err) { next(err); }
  },

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const dto = updateSchema.parse(req.body);
      res.json(await inboxService.update(parseId(req.params.id), dto));
    } catch (err) { next(err); }
  },

  async approve(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { ids, quotation_id } = approveSchema.parse(req.body);
      res.json(await inboxService.approve(ids, quotation_id, req.user!.id));
    } catch (err) { next(err); }
  },

  async discard(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { ids } = discardSchema.parse(req.body);
      res.json(await inboxService.discard(ids, req.user!.id));
    } catch (err) { next(err); }
  },
};
