import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L, { Map as LeafletMap } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { RefreshCw } from 'lucide-react';
import { mapApi } from '../../services/resources';
import { apiError } from '../../services/api';
import type { DeliveryMapOrder, DeliveryMode, DeliveryPlatform } from '../../types';
import { PageHeader } from '../../components/PageHeader';
import { Button, Card, Select, Spinner, ErrorBox, EmptyState } from '../../components/ui';
import { brl, formatAddress } from '../../utils/format';

const PLATFORM_LABEL: Record<string, string> = { ifood: 'iFood', '99food': '99Food' };
// Centro aproximado do Brasil — usado só enquanto a loja/pedidos ainda não têm coordenada.
const BRAZIL_CENTER: [number, number] = [-15.78, -47.93];

function pinIcon(color: string, size = 16): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 3px rgba(0,0,0,.5)"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}
const STORE_ICON = L.divIcon({
  className: '',
  html: '<div style="width:18px;height:18px;background:#1d4ed8;border:2px solid #fff;box-shadow:0 0 3px rgba(0,0,0,.5);transform:rotate(45deg)"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});
function orderColor(o: DeliveryMapOrder): string {
  if (o.needs_geocode) return '#94a3b8';
  if (o.address?.neighborhood_mismatch) return '#d97706';
  return '#059669';
}
function km(m: number | null): string {
  return m === null ? '—' : `${(m / 1000).toFixed(2)} km`;
}

/**
 * Faixas de distância para o filtro rápido — os mesmos cortes usados pelo resumo
 * do backend (MapController::BANDS), para o clique na faixa bater com o número dela.
 */
const BANDS: { key: string; label: string; min?: number; max?: number }[] = [
  { key: '0-2', label: 'Até 2 km', max: 2 },
  { key: '2-5', label: '2 a 5 km', min: 2, max: 5 },
  { key: '5-10', label: '5 a 10 km', min: 5, max: 10 },
  { key: '10+', label: 'Acima de 10 km', min: 10 },
];

/** Ponte entre o MapContainer (só acessível via useMap dentro dele) e o componente pai. */
function MapRefBridge({ onReady }: { onReady: (map: LeafletMap) => void }) {
  const map = useMap();
  useEffect(() => { onReady(map); }, [map, onReady]);
  return null;
}

export function DeliveryMap() {
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 29 * 86400_000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [platform, setPlatform] = useState<DeliveryPlatform | ''>('');
  const [mode, setMode] = useState<DeliveryMode | ''>('');
  const [band, setBand] = useState<string>(''); // faixa clicada no resumo
  const [minKm, setMinKm] = useState<string>('');
  const [maxKm, setMaxKm] = useState<string>('');
  const [selected, setSelected] = useState<number | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);

  // A faixa é um atalho para min/max: quando uma está ativa, a outra é ignorada.
  const active = band ? BANDS.find((b) => b.key === band) : null;
  const minParam = active ? active.min : (minKm !== '' ? Number(minKm) : undefined);
  const maxParam = active ? active.max : (maxKm !== '' ? Number(maxKm) : undefined);

  const { data, isLoading, error } = useQuery({
    queryKey: ['delivery-map', from, to, platform, mode, minParam, maxParam],
    queryFn: () => mapApi.list({
      from, to,
      platform: platform || undefined,
      delivery_mode: mode || undefined,
      min_km: minParam,
      max_km: maxParam,
    }),
  });

  const backfill = useMutation({
    // Lote de 10: com a cadeia de fallback do geocode (até 3 tentativas × 1.1s por
    // endereço), 15 poderia estourar o timeout de 120s da chamada.
    mutationFn: () => mapApi.backfill(10),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['delivery-map'] }),
  });
  const correct = useMutation({
    mutationFn: ({ id, neighborhood }: { id: number; neighborhood: string }) => mapApi.correctNeighborhood(id, neighborhood),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['delivery-map'] }),
  });

  const orders = useMemo(() => {
    const list = data?.orders ?? [];
    return [...list].sort((a, b) => (a.distance_m ?? Infinity) - (b.distance_m ?? Infinity));
  }, [data]);

  const store = data?.store ?? null;
  const center: [number, number] = store?.lat != null && store?.lng != null
    ? [store.lat, store.lng]
    : (orders.find((o) => o.address?.lat != null)?.address
      ? [orders[0].address!.lat as number, orders[0].address!.lng as number]
      : BRAZIL_CENTER);

  function focus(o: DeliveryMapOrder) {
    setSelected(o.id);
    if (o.address?.lat != null && o.address?.lng != null && mapRef.current) {
      mapRef.current.flyTo([o.address.lat, o.address.lng], 16);
    }
  }

  return (
    <div>
      <PageHeader
        title="Mapa & Distâncias"
        subtitle="Onde os pedidos de delivery realmente estão, e a distância (linha reta) até a loja"
        action={
          <Button variant="secondary" onClick={() => backfill.mutate()} disabled={backfill.isPending}>
            <RefreshCw size={16} className={backfill.isPending ? 'animate-spin' : ''} />
            Atualizar localizações
          </Button>
        }
      />

      {backfill.isSuccess && (
        <div className="mb-4 rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
          {backfill.data.geocoded} endereço(s) geocodificado(s), {backfill.data.reverse_geocoded} bairro(s) sugerido(s)
          {backfill.data.rejected > 0 && `, ${backfill.data.rejected} descartado(s) por caírem longe demais da loja`}
          {backfill.data.not_found > 0 && `, ${backfill.data.not_found} sem resultado no OpenStreetMap (ficam sem pin)`}
          {backfill.data.remaining > 0 && ` — ainda restam ${backfill.data.remaining} sem coordenada (rode de novo)`}.
        </div>
      )}
      {backfill.isError && <div className="mb-4"><ErrorBox message={apiError(backfill.error)} /></div>}
      {!store?.lat && (
        <div className="mb-4 rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-700">
          Endereço da loja ainda não geocodificado — cadastre em <strong>Loja</strong> para calcular a distância dos pedidos.
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-600">De</span>
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)}
                 className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-600">Até</span>
          <input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)}
                 className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="w-40 text-sm">
          <span className="mb-1 block font-medium text-slate-600">Plataforma</span>
          <Select value={platform} onChange={(e) => setPlatform(e.target.value as DeliveryPlatform | '')}>
            <option value="">Todas</option>
            <option value="ifood">iFood</option>
            <option value="99food">99Food</option>
          </Select>
        </label>
        <label className="w-48 text-sm">
          <span className="mb-1 block font-medium text-slate-600">Tipo de entrega</span>
          <Select value={mode} onChange={(e) => setMode(e.target.value as DeliveryMode | '')}>
            <option value="">Todas</option>
            <option value="own">Entrega própria</option>
            <option value="partner">Entrega da plataforma</option>
          </Select>
        </label>
        <label className="w-28 text-sm">
          <span className="mb-1 block font-medium text-slate-600">Mín. (km)</span>
          <input
            type="number" min={0} step={0.5} value={minKm} placeholder="0"
            onChange={(e) => { setMinKm(e.target.value); setBand(''); }}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400"
            disabled={band !== ''}
          />
        </label>
        <label className="w-28 text-sm">
          <span className="mb-1 block font-medium text-slate-600">Máx. (km)</span>
          <input
            type="number" min={0} step={0.5} value={maxKm} placeholder="∞"
            onChange={(e) => { setMaxKm(e.target.value); setBand(''); }}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400"
            disabled={band !== ''}
          />
        </label>
        {(band || minKm || maxKm) && (
          <button
            onClick={() => { setBand(''); setMinKm(''); setMaxKm(''); }}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            Limpar distância
          </button>
        )}
      </div>

      {/* Resumo de distância: sempre do período inteiro, para o número da faixa não
          mudar quando o próprio filtro de faixa é aplicado. */}
      {data?.stats && data.stats.measured > 0 && (
        <Card className="mb-4">
          <div className="mb-3 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
            <span className="font-semibold text-slate-700">Distâncias do período</span>
            <span className="text-slate-500">Média: <strong className="text-slate-700">{km(data.stats.avg_m)}</strong></span>
            <span className="text-slate-500">Mais distante: <strong className="text-slate-700">{km(data.stats.max_m)}</strong></span>
            <span className="text-slate-500">{data.stats.measured} de {data.stats.total} com coordenada</span>
            {data.stats.without_coords > 0 && (
              <span className="text-amber-600">{data.stats.without_coords} sem coordenada (fora do cálculo)</span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {data.stats.bands.map((b) => {
              const on = band === b.key;
              return (
                <button
                  key={b.key}
                  onClick={() => { setBand(on ? '' : b.key); setMinKm(''); setMaxKm(''); }}
                  className={`rounded-lg border px-3 py-2 text-left transition ${
                    on ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <p className={`text-xs ${on ? 'text-emerald-700' : 'text-slate-500'}`}>{b.label}</p>
                  <p className={`text-lg font-semibold ${on ? 'text-emerald-700' : 'text-slate-800'}`}>{b.orders}</p>
                  <p className="text-xs text-slate-400">{brl(b.revenue)}</p>
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {data?.stats && data.stats.hidden_by_distance > 0 && (
        <div className="mb-4 rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-600">
          {data.stats.hidden_by_distance} pedido(s) fora da faixa de distância selecionada estão ocultos.
        </div>
      )}

      {isLoading && <Spinner />}
      {error && <ErrorBox message={apiError(error)} />}

      {data && (
        orders.length === 0 ? (
          <EmptyState message={
            (data.stats?.hidden_by_distance ?? 0) > 0
              ? 'Nenhum pedido nesta faixa de distância. Limpe o filtro para ver os demais.'
              : 'Nenhum pedido com endereço no período selecionado.'
          } />
        ) : (
          <div className="space-y-4">
            <Card className="overflow-hidden p-0">
              <MapContainer center={center} zoom={store?.lat != null ? 13 : 4} style={{ height: 480, width: '100%' }}>
                <MapRefBridge onReady={(m) => (mapRef.current = m)} />
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                           attribution="&copy; <a href=&quot;https://www.openstreetmap.org/copyright&quot;>OpenStreetMap</a> contributors" />
                {store?.lat != null && store?.lng != null && (
                  <Marker position={[store.lat, store.lng]} icon={STORE_ICON}>
                    <Popup>
                      <strong>{store.name || 'Loja'}</strong>
                      <div className="text-xs text-slate-500">{store.formatted_address}</div>
                    </Popup>
                  </Marker>
                )}
                {orders.filter((o) => o.address?.lat != null && o.address?.lng != null).map((o) => (
                  <Marker
                    key={o.id}
                    position={[o.address!.lat as number, o.address!.lng as number]}
                    icon={pinIcon(orderColor(o), o.id === selected ? 22 : 16)}
                  >
                    <Popup>
                      <OrderPopup order={o} onSave={(neighborhood) => correct.mutate({ id: o.id, neighborhood })} saving={correct.isPending} />
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
            </Card>
            <p className="text-xs text-slate-400">
              Distância em <strong>linha reta</strong> até a loja (não é rota real de entrega).
              Verde = bairro confere · Âmbar = bairro divergente do sugerido · Cinza = sem coordenada ainda.
            </p>

            <Card className="p-0">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 text-left text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Pedido</th>
                    <th className="px-4 py-3 font-medium">Plataforma</th>
                    <th className="px-4 py-3 font-medium">Entrega</th>
                    <th className="px-4 py-3 font-medium">Bairro registrado</th>
                    <th className="px-4 py-3 font-medium">Bairro sugerido</th>
                    <th className="px-4 py-3 text-right font-medium">Valor</th>
                    <th className="px-4 py-3 text-right font-medium">Distância</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr
                      key={o.id}
                      onClick={() => focus(o)}
                      className={`cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50 ${o.id === selected ? 'bg-emerald-50' : ''}`}
                    >
                      <td className="px-4 py-3 text-slate-700">{o.display_id ?? `#${o.id}`} <span className="text-xs text-slate-400">— {o.customer_name ?? 'Cliente'}</span></td>
                      <td className="px-4 py-3 text-slate-600">{PLATFORM_LABEL[o.platform] ?? o.platform}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {o.delivery_mode === 'own' ? 'Própria' : o.delivery_mode === 'partner' ? 'Plataforma' : '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{o.address?.neighborhood ?? '—'}</td>
                      <td className={`px-4 py-3 ${o.address?.neighborhood_mismatch ? 'font-medium text-amber-700' : 'text-slate-500'}`}>
                        {o.address?.suggested_neighborhood ?? (o.needs_geocode ? 'sem coordenada' : '—')}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-600">
                        {o.customer_paid !== null ? brl(o.customer_paid) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-600">{km(o.distance_m)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        )
      )}
    </div>
  );
}

function OrderPopup({ order, onSave, saving }: { order: DeliveryMapOrder; onSave: (neighborhood: string) => void; saving: boolean }) {
  const [value, setValue] = useState(order.address?.suggested_neighborhood || order.address?.neighborhood || '');
  const mismatch = !!order.address?.neighborhood_mismatch;
  return (
    <div className="min-w-[220px] text-sm">
      <p className="font-semibold text-slate-800">{order.display_id ?? `#${order.id}`} · {PLATFORM_LABEL[order.platform] ?? order.platform}</p>
      <p className="text-slate-600">{order.customer_name ?? 'Cliente'}</p>
      <p className="mt-1 text-xs text-slate-500">{formatAddress(order.address)}</p>
      <p className="mt-1 text-xs text-slate-500">Distância: {km(order.distance_m)}</p>
      <div className="mt-2 border-t border-slate-100 pt-2">
        <p className="text-xs text-slate-500">Bairro registrado: <strong>{order.address?.neighborhood ?? '—'}</strong></p>
        {mismatch && <p className="text-xs text-amber-700">Sugestão (mapa): {order.address?.suggested_neighborhood}</p>}
        <div className="mt-1 flex gap-1">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
            placeholder="Corrigir bairro"
          />
          <button
            onClick={() => value.trim() && onSave(value.trim())}
            disabled={saving || !value.trim()}
            className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}
