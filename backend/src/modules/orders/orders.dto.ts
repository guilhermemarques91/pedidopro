import { z } from 'zod';

const orderItemSchema = z.object({
  item_id: z.number().int().positive('item_id obrigatório'),
  quantity: z.number().positive('Quantidade deve ser positiva'),
  unit_price: z.number().nonnegative('Preço unitário não pode ser negativo'),
  notes: z.string().optional(),
});

export const createOrderSchema = z.object({
  supplier_id: z.number().int().positive('supplier_id obrigatório'),
  quotation_id: z.number().int().positive().optional(),
  notes: z.string().optional(),
  items: z.array(orderItemSchema).min(1, 'Inclua ao menos um item'),
});

export const updateOrderSchema = z.object({
  notes: z.string().optional(),
}).refine((d) => Object.keys(d).length > 0, {
  message: 'Informe ao menos um campo para atualizar',
});

export const addOrderItemSchema = orderItemSchema;

export const updateOrderItemSchema = z.object({
  quantity: z.number().positive().optional(),
  unit_price: z.number().nonnegative().optional(),
  notes: z.string().optional(),
}).refine((d) => Object.keys(d).length > 0, {
  message: 'Informe ao menos um campo para atualizar',
});

export const rejectSchema = z.object({
  comment: z.string().optional(),
});

export const approveSchema = z.object({
  comment: z.string().optional(),
});

export type CreateOrderDto = z.infer<typeof createOrderSchema>;
export type UpdateOrderDto = z.infer<typeof updateOrderSchema>;
export type AddOrderItemDto = z.infer<typeof addOrderItemSchema>;
export type UpdateOrderItemDto = z.infer<typeof updateOrderItemSchema>;
