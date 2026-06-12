import { z } from 'zod';

export const createCategorySchema = z.object({
  name: z.string().min(1, 'Nome obrigatório').max(100),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Cor deve ser hex no formato #RRGGBB')
    .optional(),
  icon: z.string().max(50).optional(),
});

// Todos os campos opcionais no update, mas pelo menos um deve vir.
export const updateCategorySchema = createCategorySchema.partial().refine(
  (data) => Object.keys(data).length > 0,
  { message: 'Informe ao menos um campo para atualizar' }
);

export type CreateCategoryDto = z.infer<typeof createCategorySchema>;
export type UpdateCategoryDto = z.infer<typeof updateCategorySchema>;
