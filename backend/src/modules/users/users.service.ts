import bcrypt from 'bcryptjs';
import { query, queryOne } from '../../config/database';
import { PublicUser } from '../../shared/types';
import { badRequest, notFound } from '../../shared/utils/http-error';
import { CreateUserDto, UpdateUserDto } from './users.dto';

const PUBLIC_COLS = 'id, name, email, role, active, created_at';

export const usersService = {
  async list(): Promise<PublicUser[]> {
    return query<PublicUser>(`SELECT ${PUBLIC_COLS} FROM users ORDER BY name`);
  },

  async getById(id: number): Promise<PublicUser> {
    const u = await queryOne<PublicUser>(`SELECT ${PUBLIC_COLS} FROM users WHERE id = $1`, [id]);
    if (!u) throw notFound('Usuário não encontrado');
    return u;
  },

  async create(dto: CreateUserDto): Promise<PublicUser> {
    const exists = await queryOne<{ id: number }>('SELECT id FROM users WHERE email = $1', [dto.email]);
    if (exists) throw badRequest('Já existe um usuário com este e-mail');
    const hash = await bcrypt.hash(dto.password, 10);
    const u = await queryOne<PublicUser>(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4) RETURNING ${PUBLIC_COLS}`,
      [dto.name, dto.email, hash, dto.role]
    );
    return u!;
  },

  async update(id: number, dto: UpdateUserDto, actingUserId: number): Promise<PublicUser> {
    await this.getById(id);
    // Evita lockout: o admin não pode rebaixar o próprio papel.
    if (id === actingUserId && dto.role && dto.role !== 'admin') {
      throw badRequest('Você não pode rebaixar o seu próprio papel');
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (dto.name !== undefined) { fields.push(`name = $${i++}`); values.push(dto.name); }
    if (dto.role !== undefined) { fields.push(`role = $${i++}`); values.push(dto.role); }
    if (dto.password !== undefined) {
      fields.push(`password_hash = $${i++}`);
      values.push(await bcrypt.hash(dto.password, 10));
    }
    values.push(id);
    const u = await queryOne<PublicUser>(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${i} RETURNING ${PUBLIC_COLS}`,
      values
    );
    return u!;
  },

  async setActive(id: number, active: boolean, actingUserId: number): Promise<PublicUser> {
    await this.getById(id);
    // Evita lockout: o admin não pode se auto-desativar.
    if (id === actingUserId && !active) {
      throw badRequest('Você não pode desativar o seu próprio acesso');
    }
    const u = await queryOne<PublicUser>(
      `UPDATE users SET active = $1 WHERE id = $2 RETURNING ${PUBLIC_COLS}`,
      [active, id]
    );
    return u!;
  },
};
