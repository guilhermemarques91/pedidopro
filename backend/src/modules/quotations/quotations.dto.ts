import { z } from 'zod';

export const createQuotationSchema = z.object({
  title: z.string().min(1, 'Título obrigatório').max(200),
});

export const updateQuotationSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  status: z.enum(['draft', 'active']).optional(), // 'closed' só via /close
}).refine((d) => Object.keys(d).length > 0, {
  message: 'Informe ao menos um campo para atualizar',
});

const sourceEnum = z.enum(['manual', 'excel', 'pdf', 'image', 'whatsapp']);

export const addQuotationItemSchema = z.object({
  item_id: z.number().int().positive('item_id obrigatório'),
  supplier_id: z.number().int().positive().optional(), // default = fornecedor do item
  price: z.number().nonnegative('Preço não pode ser negativo').optional(),
  quantity: z.number().positive('Quantidade deve ser positiva').optional(),
  notes: z.string().optional(),
  source: sourceEnum.optional(),
});

export const updateQuotationItemSchema = z.object({
  price: z.number().nonnegative('Preço não pode ser negativo').optional(),
  quantity: z.number().positive('Quantidade deve ser positiva').optional(),
  notes: z.string().optional(),
  reviewed: z.boolean().optional(),
}).refine((d) => Object.keys(d).length > 0, {
  message: 'Informe ao menos um campo para atualizar',
});

export type CreateQuotationDto = z.infer<typeof createQuotationSchema>;
export type UpdateQuotationDto = z.infer<typeof updateQuotationSchema>;
export type AddQuotationItemDto = z.infer<typeof addQuotationItemSchema>;
export type UpdateQuotationItemDto = z.infer<typeof updateQuotationItemSchema>;
