import bcrypt from 'bcryptjs';
import jwt, { SignOptions } from 'jsonwebtoken';
import { queryOne } from '../../config/database';
import { env } from '../../config/env';
import { User, PublicUser, JwtPayload } from '../../shared/types';
import { unauthorized, notFound } from '../../shared/utils/http-error';
import { LoginDto } from './auth.dto';

function toPublicUser(user: User): PublicUser {
  const { password_hash, ...rest } = user;
  void password_hash;
  return rest;
}

function signToken(payload: JwtPayload): string {
  const options: SignOptions = { expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'] };
  return jwt.sign(payload, env.JWT_SECRET, options);
}

export const authService = {
  async login(dto: LoginDto): Promise<{ token: string; user: PublicUser }> {
    const user = await queryOne<User>(
      'SELECT * FROM users WHERE email = $1',
      [dto.email]
    );

    // Mensagem genérica para não revelar se o e-mail existe.
    if (!user || !user.active) {
      throw unauthorized('Credenciais inválidas');
    }

    const valid = await bcrypt.compare(dto.password, user.password_hash);
    if (!valid) {
      throw unauthorized('Credenciais inválidas');
    }

    const token = signToken({ id: user.id, email: user.email, role: user.role });
    return { token, user: toPublicUser(user) };
  },

  async getMe(userId: number): Promise<PublicUser> {
    const user = await queryOne<User>(
      'SELECT * FROM users WHERE id = $1 AND active = true',
      [userId]
    );
    if (!user) {
      throw notFound('Usuário não encontrado');
    }
    return toPublicUser(user);
  },
};
