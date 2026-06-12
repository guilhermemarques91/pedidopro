/**
 * Seed de desenvolvimento — cria um usuário admin de teste.
 * Rode com: npm run seed
 *
 * Credenciais padrão (altere em produção!):
 *   email: admin@pedidopro.local
 *   senha: admin123
 */
import bcrypt from 'bcryptjs';
import { pool, queryOne } from './database';

const ADMIN = {
  name: 'Administrador',
  email: 'admin@pedidopro.local',
  password: 'admin123',
  role: 'admin' as const,
};

async function seed() {
  const existing = await queryOne<{ id: number }>(
    'SELECT id FROM users WHERE email = $1',
    [ADMIN.email]
  );

  if (existing) {
    console.log(`Usuário ${ADMIN.email} já existe (id ${existing.id}). Nada a fazer.`);
  } else {
    const hash = await bcrypt.hash(ADMIN.password, 10);
    const user = await queryOne<{ id: number }>(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [ADMIN.name, ADMIN.email, hash, ADMIN.role]
    );
    console.log(`Usuário admin criado (id ${user!.id}):`);
    console.log(`  email: ${ADMIN.email}`);
    console.log(`  senha: ${ADMIN.password}`);
  }

  await pool.end();
}

seed().catch((err) => {
  console.error('Erro no seed:', err);
  process.exit(1);
});
