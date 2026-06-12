import { Request } from 'express';

export type UserRole = 'admin' | 'buyer' | 'approver';

export interface User {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  role: UserRole;
  active: boolean;
  created_at: Date;
}

/** Dados do usuário expostos pela API (sem o hash da senha). */
export interface PublicUser {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  created_at: Date;
}

/** Payload embutido no JWT. */
export interface JwtPayload {
  id: number;
  email: string;
  role: UserRole;
}

/** Request do Express com o usuário autenticado injetado pelo middleware. */
export interface AuthRequest extends Request {
  user?: JwtPayload;
}
