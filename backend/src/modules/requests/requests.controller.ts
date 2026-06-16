import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../shared/types';
import { badRequest } from '../../shared/utils/http-error';
import { createRequestSchema, updateRequestSchema, allocationSchema } from './requests.dto';
import { requestsService } from './requests.service';

function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('ID inválido');
  return id;
}

export const requestsController = {
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await requestsService.list(req.user!)); } catch (err) { next(err); }
  },
  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await requestsService.getDetailed(parseId(req.params.id), req.user!)); } catch (err) { next(err); }
  },
  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const dto = createRequestSchema.parse(req.body);
      res.status(201).json(await requestsService.create(dto, req.user!.id));
    } catch (err) { next(err); }
  },
  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const dto = updateRequestSchema.parse(req.body);
      res.json(await requestsService.update(parseId(req.params.id), dto, req.user!));
    } catch (err) { next(err); }
  },
  async submit(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await requestsService.submit(parseId(req.params.id), req.user!)); } catch (err) { next(err); }
  },
  async allocate(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const dto = allocationSchema.parse(req.body);
      res.json(await requestsService.saveAllocation(parseId(req.params.id), dto));
    } catch (err) { next(err); }
  },
  async generateOrders(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await requestsService.generateOrders(parseId(req.params.id), req.user!.id)); } catch (err) { next(err); }
  },
  async cancel(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await requestsService.cancel(parseId(req.params.id))); } catch (err) { next(err); }
  },
};
