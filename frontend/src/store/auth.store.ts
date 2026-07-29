import { create } from 'zustand';
import { api } from '../services/api';
import type { User } from '../types';

interface AuthState {
  token: string | null;
  user: User | null;
  permissions: string[];
  login: (username: string, password: string) => Promise<void>;
  /** Recarrega usuário e permissões do servidor (ver nota em `refresh`). */
  refresh: () => Promise<void>;
  logout: () => void;
  hasRole: (...roles: User['role'][]) => boolean;
  /** O usuário logado tem esta permissão? (admin já vem com todas do backend) */
  can: (perm: string) => boolean;
}

function loadUser(): User | null {
  const raw = localStorage.getItem('pedidopro_user');
  return raw ? (JSON.parse(raw) as User) : null;
}
function loadPerms(): string[] {
  try {
    const raw = localStorage.getItem('pedidopro_permissions');
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export const useAuth = create<AuthState>((set, get) => ({
  token: localStorage.getItem('pedidopro_token'),
  user: loadUser(),
  permissions: loadPerms(),

  async login(username, password) {
    const { data } = await api.post<{ token: string; user: User; permissions: string[] }>('/auth/login', {
      username,
      password,
    });
    localStorage.setItem('pedidopro_token', data.token);
    localStorage.setItem('pedidopro_user', JSON.stringify(data.user));
    localStorage.setItem('pedidopro_permissions', JSON.stringify(data.permissions ?? []));
    set({ token: data.token, user: data.user, permissions: data.permissions ?? [] });
  },

  /**
   * Ressincroniza a sessão com o servidor.
   *
   * As permissões eram gravadas SÓ no login: quem já estava logado ficava com a
   * lista congelada e não enxergava tela nova (nem mudança de papel feita pelo
   * admin) até deslogar. Chamado no boot do app, com token presente.
   * Falha de rede é ignorada de propósito — o app segue com o que está em cache;
   * 401 já é tratado pelo interceptor do axios.
   */
  async refresh() {
    if (!get().token) return;
    try {
      const { data } = await api.get<User & { permissions?: string[] }>('/auth/me');
      const { permissions = [], ...user } = data;
      localStorage.setItem('pedidopro_user', JSON.stringify(user));
      localStorage.setItem('pedidopro_permissions', JSON.stringify(permissions));
      set({ user: user as User, permissions });
    } catch {
      /* offline ou servidor fora: mantém o cache local */
    }
  },

  logout() {
    localStorage.removeItem('pedidopro_token');
    localStorage.removeItem('pedidopro_user');
    localStorage.removeItem('pedidopro_permissions');
    set({ token: null, user: null, permissions: [] });
  },

  hasRole(...roles) {
    const role = get().user?.role;
    return role ? roles.includes(role) : false;
  },

  can(perm) {
    return get().permissions.includes(perm);
  },
}));
