import { z } from 'zod';

// Apenas os papéis expostos no cadastro. buyer/approver permanecem no banco
// (legado), mas não são oferecidos pela UI de gestão de usuários.
const manageableRole = z.enum(['admin', 'requester']);

export const createUserSchema = z.object({
  name: z.string().min(1, 'Nome obrigatório').max(150),
  email: z.string().email('E-mail inválido').max(150),
  password: z.string().min(6, 'Senha deve ter ao menos 6 caracteres').max(100),
  role: manageableRole,
});

export const updateUserSchema = z
  .object({
    name: z.string().min(1).max(150).optional(),
    role: manageableRole.optional(),
    password: z.string().min(6).max(100).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Informe ao menos um campo' });

export const setActiveSchema = z.object({ active: z.boolean() });

export type CreateUserDto = z.infer<typeof createUserSchema>;
export type UpdateUserDto = z.infer<typeof updateUserSchema>;
