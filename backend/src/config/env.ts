import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('3001'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  DATABASE_URL: z.string({ required_error: 'DATABASE_URL é obrigatório' }).min(1),

  JWT_SECRET: z.string({ required_error: 'JWT_SECRET é obrigatório' }).min(16),
  JWT_EXPIRES_IN: z.string().default('7d'),

  EVOLUTION_API_URL: z.string({ required_error: 'EVOLUTION_API_URL é obrigatório' }).url(),
  EVOLUTION_API_KEY: z.string({ required_error: 'EVOLUTION_API_KEY é obrigatório' }).min(1),
  EVOLUTION_INSTANCE: z.string().default('pedidopro'),

  ANTHROPIC_API_KEY: z.string({ required_error: 'ANTHROPIC_API_KEY é obrigatório' }).min(1),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Variáveis de ambiente inválidas ou ausentes:');
  parsed.error.issues.forEach(issue => {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  });
  process.exit(1);
}

export const env = parsed.data;
