import { z } from 'zod';

const baseItem = z.object({
  supplier_id: z.number().int().positive('supplier_id obrigatório'),
  product_id: z.number().int().positive().nullable().optional(),
  name: z.string().min(1, 'Nome obrigatório').max(200),
  unit: z.string().min(1, 'Unidade obrigatória').max(30),
  package_size: z.number().positive('Tamanho da embalagem deve ser positivo').optional(),
  package_unit: z.string().max(30).optional(),
  base_price: z.number().nonnegative('Preço base não pode ser negativo').optional(),
});

export const createItemSchema = baseItem;

export const updateItemSchema = baseItem
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Informe ao menos um campo para atualizar',
  });

export type CreateItemDto = z.infer<typeof createItemSchema>;
export type UpdateItemDto = z.infer<typeof updateItemSchema>;
