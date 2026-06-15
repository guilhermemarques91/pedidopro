import axios from 'axios';

const baseURL = (import.meta.env.VITE_API_URL ?? '') + '/api';

export const api = axios.create({ baseURL });

// Injeta o token JWT salvo no localStorage em toda requisição.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('pedidopro_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Em 401, limpa a sessão e manda para o login.
api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401 && !location.pathname.startsWith('/login')) {
      localStorage.removeItem('pedidopro_token');
      localStorage.removeItem('pedidopro_user');
      location.href = '/login';
    }
    return Promise.reject(error);
  }
);

/** Extrai uma mensagem de erro legível da resposta da API. */
export function apiError(err: unknown, fallback = 'Erro inesperado'): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { error?: string; details?: { message: string }[] } | undefined;
    if (data?.details?.length) return data.details.map((d) => d.message).join('; ');
    return data?.error ?? err.message ?? fallback;
  }
  return fallback;
}
