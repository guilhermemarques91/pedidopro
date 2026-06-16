import { z } from 'zod';

const requestItemSchema = z
  .object({
    product_id: z.number().int().positive().nullable().optional(),
    free_text: z.string().min(1).max(200).nullable().optional(),
    quantity: z.number().positive('Quantidade deve ser maior que zero'),
    unit: z.string().min(1).max(30).optional(),
    notes: z.string().max(500).optional(),
  })
  .refine((i) => i.product_id != null || (i.free_text && i.free_text.trim()), {
    message: 'Cada item precisa de um produto do catálogo ou um texto livre',
  });

export const createRequestSchema = z.object({
  title: z.string().max(200).optional(),
  notes: z.string().max(1000).optional(),
  items: z.array(requestItemSchema).min(1, 'Inclua ao menos um item'),
});

export const updateRequestSchema = z.object({
  title: z.string().max(200).optional(),
  notes: z.string().max(1000).optional(),
  items: z.array(requestItemSchema).min(1, 'Inclua ao menos um item'),
});

// Alocação por item (preenchida pelo admin).
const allocationItemSchema = z.object({
  id: z.number().int().positive(), // id da linha em purchase_request_items
  supplier_id: z.number().int().positive(),
  item_id: z.number().int().positive().nullable().optional(), // item existente do fornecedor
  name: z.string().max(200).nullable().optional(),            // nome p/ item novo (texto livre/manual)
  unit: z.string().max(30).nullable().optional(),
  price: z.number().nonnegative('Preço inválido'),
});

export const allocationSchema = z.object({
  allocations: z.array(allocationItemSchema).min(1, 'Nada para alocar'),
});

export type CreateRequestDto = z.infer<typeof createRequestSchema>;
export type UpdateRequestDto = z.infer<typeof updateRequestSchema>;
export type AllocationDto = z.infer<typeof allocationSchema>;
