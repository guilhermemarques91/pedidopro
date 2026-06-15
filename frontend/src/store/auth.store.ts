import { create } from 'zustand';
import { api } from '../services/api';
import type { User } from '../types';

interface AuthState {
  token: string | null;
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  hasRole: (...roles: User['role'][]) => boolean;
}

function loadUser(): User | null {
  const raw = localStorage.getItem('pedidopro_user');
  return raw ? (JSON.parse(raw) as User) : null;
}

export const useAuth = create<AuthState>((set, get) => ({
  token: localStorage.getItem('pedidopro_token'),
  user: loadUser(),

  async login(email, password) {
    const { data } = await api.post<{ token: string; user: User }>('/auth/login', {
      email,
      password,
    });
    localStorage.setItem('pedidopro_token', data.token);
    localStorage.setItem('pedidopro_user', JSON.stringify(data.user));
    set({ token: data.token, user: data.user });
  },

  logout() {
    localStorage.removeItem('pedidopro_token');
    localStorage.removeItem('pedidopro_user');
    set({ token: null, user: null });
  },

  hasRole(...roles) {
    const role = get().user?.role;
    return role ? roles.includes(role) : false;
  },
}));
