import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../shared/types';
import { badRequest } from '../../shared/utils/http-error';
import {
  createOrderSchema,
  updateOrderSchema,
  addOrderItemSchema,
  updateOrderItemSchema,
  approveSchema,
  rejectSchema,
} from './orders.dto';
import { ordersService } from './orders.service';

function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('ID inválido');
  return id;
}

export const ordersController = {
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const status = req.query.status ? String(req.query.status) : undefined;
      const supplierId = req.query.supplier_id ? parseId(String(req.query.supplier_id)) : undefined;
      res.json(await ordersService.list({ status, supplierId }));
    } catch (err) { next(err); }
  },

  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json(await ordersService.getDetailed(parseId(req.params.id)));
    } catch (err) { next(err); }
  },

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const dto = createOrderSchema.parse(req.body);
      res.status(201).json(await ordersService.create(dto, req.user!.id));
    } catch (err) { next(err); }
  },

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const dto = updateOrderSchema.parse(req.body);
      res.json(await ordersService.update(parseId(req.params.id), dto));
    } catch (err) { next(err); }
  },

  async remove(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await ordersService.remove(parseId(req.params.id));
      res.status(204).send();
    } catch (err) { next(err); }
  },

  // ---- itens ----

  async addItem(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const dto = addOrderItemSchema.parse(req.body);
      res.status(201).json(await ordersService.addItem(parseId(req.params.id), dto));
    } catch (err) { next(err); }
  },

  async updateItem(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const dto = updateOrderItemSchema.parse(req.body);
      res.json(await ordersService.updateItem(parseId(req.params.id), parseId(req.params.itemId), dto));
    } catch (err) { next(err); }
  },

  async removeItem(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json(await ordersService.removeItem(parseId(req.params.id), parseId(req.params.itemId)));
    } catch (err) { next(err); }
  },

  // ---- transições ----

  async submit(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json(await ordersService.submit(parseId(req.params.id)));
    } catch (err) { next(err); }
  },

  async approve(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { comment } = approveSchema.parse(req.body ?? {});
      res.json(await ordersService.approve(parseId(req.params.id), req.user!.id, comment));
    } catch (err) { next(err); }
  },

  async reject(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { comment } = rejectSchema.parse(req.body ?? {});
      res.json(await ordersService.reject(parseId(req.params.id), req.user!.id, comment));
    } catch (err) { next(err); }
  },

  async send(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json(await ordersService.send(parseId(req.params.id)));
    } catch (err) { next(err); }
  },

  async receive(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json(await ordersService.receive(parseId(req.params.id)));
    } catch (err) { next(err); }
  },

  async cancel(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json(await ordersService.cancel(parseId(req.params.id)));
    } catch (err) { next(err); }
  },
};
