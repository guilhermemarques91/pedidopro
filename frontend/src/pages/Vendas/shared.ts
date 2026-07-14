import type { VendasBoardCard, BoardOrigin } from '../../types';

export const ORIGIN_META: Record<BoardOrigin, { label: string; cls: string }> = {
  mesa: { label: 'Mesa', cls: 'bg-emerald-100 text-emerald-700' },
  comanda: { label: 'Comanda', cls: 'bg-blue-100 text-blue-700' },
  balcao: { label: 'Balcão', cls: 'bg-purple-100 text-purple-700' },
  retirada: { label: 'Retirada', cls: 'bg-orange-100 text-orange-700' },
  ifood: { label: 'iFood', cls: 'bg-red-100 text-red-700' },
  '99food': { label: '99Food', cls: 'bg-yellow-100 text-yellow-800' },
};

export function cardTitle(c: Pick<VendasBoardCard, 'source' | 'id' | 'display_id' | 'station' | 'daily_number'>): string {
  if (c.source === 'delivery') return c.display_id ? `#${c.display_id}` : `#${c.id}`;
  if (c.station) return `${c.station.kind === 'mesa' ? 'Mesa' : 'Comanda'} ${c.station.number}`;
  return c.daily_number ? `#${c.daily_number}` : `#${c.id}`;
}
