import { z } from 'zod';

const baseSupplier = z.object({
  name: z.string().min(1, 'Nome obrigatório').max(150),
  contact_name: z.string().max(150).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email('E-mail inválido').max(150).optional(),
  category_id: z.number().int().positive().optional(),
  order_type: z.enum(['portal', 'whatsapp'], {
    errorMap: () => ({ message: "order_type deve ser 'portal' ou 'whatsapp'" }),
  }),
  portal_url: z.string().url('portal_url deve ser uma URL válida').optional(),
  whatsapp_number: z.string().max(30).optional(),
  notes: z.string().optional(),
});

// Exige o campo coerente com o order_type escolhido.
export const createSupplierSchema = baseSupplier.refine(
  (d) => d.order_type !== 'portal' || !!d.portal_url,
  { message: 'portal_url é obrigatório quando order_type = portal', path: ['portal_url'] }
).refine(
  (d) => d.order_type !== 'whatsapp' || !!d.whatsapp_number,
  { message: 'whatsapp_number é obrigatório quando order_type = whatsapp', path: ['whatsapp_number'] }
);

export const updateSupplierSchema = baseSupplier
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Informe ao menos um campo para atualizar',
  });

export type CreateSupplierDto = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierDto = z.infer<typeof updateSupplierSchema>;
