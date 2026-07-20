import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L, { Map as LeafletMap } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { RefreshCw } from 'lucide-react';
import { mapApi } from '../../services/resources';
import { apiError } from '../../services/api';
import type { DeliveryMapOrder, DeliveryPlatform } from '../../types';
import { PageHeader } from '../../components/PageHeader';
import { Button, Card, Select, Spinner, ErrorBox, EmptyState } from '../../components/ui';
import { formatAddress } from '../../utils/format';

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
  const [selected, setSelected] = useState<number | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['delivery-map', from, to, platform],
    queryFn: () => mapApi.list({ from, to, platform: platform || undefined }),
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
        <label className="w-44 text-sm">
          <span className="mb-1 block font-medium text-slate-600">Plataforma</span>
          <Select value={platform} onChange={(e) => setPlatform(e.target.value as DeliveryPlatform | '')}>
            <option value="">Todas</option>
            <option value="ifood">iFood</option>
            <option value="99food">99Food</option>
          </Select>
        </label>
      </div>

      {isLoading && <Spinner />}
      {error && <ErrorBox message={apiError(error)} />}

      {data && (
        orders.length === 0 ? (
          <EmptyState message="Nenhum pedido com endereço no período selecionado." />
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
                    <th className="px-4 py-3 font-medium">Bairro registrado</th>
                    <th className="px-4 py-3 font-medium">Bairro sugerido</th>
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
                      <td className="px-4 py-3 text-slate-600">{o.address?.neighborhood ?? '—'}</td>
                      <td className={`px-4 py-3 ${o.address?.neighborhood_mismatch ? 'font-medium text-amber-700' : 'text-slate-500'}`}>
                        {o.address?.suggested_neighborhood ?? (o.needs_geocode ? 'sem coordenada' : '—')}
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
