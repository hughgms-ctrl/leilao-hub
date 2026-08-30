import type { ListaResposta, Stats } from './types';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const qs = params ? `?${new URLSearchParams(params)}` : '';
  const res = await fetch(`${BASE}${path}${qs}`);
  if (!res.ok) {
    const corpo = await res.json().catch(() => ({}));
    throw new Error((corpo as { erro?: string }).erro ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const buscarLotes = (params: Record<string, string>) =>
  get<ListaResposta>('/api/lotes', params);

export const buscarOportunidades = (params: Record<string, string>) =>
  get<ListaResposta>('/api/oportunidades', params);

export const buscarStats = () => get<Stats>('/api/stats');

export const buscarLote = (id: string | number) =>
  get<import('./types').LoteDetalhe>(`/api/lotes/${id}`);
