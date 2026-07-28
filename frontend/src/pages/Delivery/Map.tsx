import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapContainer, TileLayer, Marker, Popup, Circle, Tooltip as LTooltip, useMap, useMapEvents } from 'react-leaflet';
import L, { Map as LeafletMap } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { RefreshCw, MapPin, Search, Crosshair, X } from 'lucide-react';
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
  if (o.address?.geocode_source === 'manual') return '#7c3aed'; // fixado à mão
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

/** Cor de cada anel de raio — do mais próximo (verde) ao mais distante (âmbar). */
const RING_COLOR: Record<number, string> = {
  1000: '#059669', 2000: '#0d9488', 3000: '#0891b2', 5000: '#6366f1', 10000: '#d97706',
};

/** Ponte entre o MapContainer (só acessível via useMap dentro dele) e o componente pai. */
function MapRefBridge({ onReady }: { onReady: (map: LeafletMap) => void }) {
  const map = useMap();
  useEffect(() => { onReady(map); }, [map, onReady]);
  return null;
}

/** Captura o clique no mapa enquanto o operador está fixando um ponto à mão. */
function ClickCatcher({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
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
  const [missingOnly, setMissingOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState(''); // busca efetivamente enviada (debounce)
  const [showRings, setShowRings] = useState(true);
  const [sort, setSort] = useState<'distance' | 'name' | 'recent'>('distance');
  const [selected, setSelected] = useState<number | null>(null);
  const [editing, setEditing] = useState<DeliveryMapOrder | null>(null);
  const [pinning, setPinning] = useState(false);
  // Coordenada escolhida no mapa AGORA (ainda não salva). Separada do endereço do
  // pedido para não confundir "acabei de clicar" com "já tinha coordenada".
  const [picked, setPicked] = useState<{ lat: number; lng: number } | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);

  // Debounce: evita uma requisição por tecla digitada na busca.
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  // A faixa é um atalho para min/max: quando uma está ativa, a outra é ignorada.
  const active = band ? BANDS.find((b) => b.key === band) : null;
  const minParam = active ? active.min : (minKm !== '' ? Number(minKm) : undefined);
  const maxParam = active ? active.max : (maxKm !== '' ? Number(maxKm) : undefined);

  const { data, isLoading, error } = useQuery({
    queryKey: ['delivery-map', from, to, platform, mode, minParam, maxParam, missingOnly, query],
    queryFn: () => mapApi.list({
      from, to,
      platform: platform || undefined,
      delivery_mode: mode || undefined,
      min_km: minParam,
      max_km: maxParam,
      without_coords: missingOnly ? '1' : undefined,
      q: query || undefined,
    }),
  });

  const backfill = useMutation({
    // Lote de 10: com a cadeia de fallback do geocode (até 3 tentativas × 1.1s por
    // endereço), 15 poderia estourar o timeout de 120s da chamada.
    mutationFn: () => mapApi.backfill(10),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['delivery-map'] }),
  });

  const orders = useMemo(() => {
    const list = data?.orders ?? [];
    const byName = (o: DeliveryMapOrder) => (o.customer_name ?? '').toLocaleLowerCase('pt-BR');
    return [...list].sort((a, b) => {
      if (sort === 'name') return byName(a).localeCompare(byName(b), 'pt-BR');
      if (sort === 'recent') return (b.created_at ?? '').localeCompare(a.created_at ?? '');
      return (a.distance_m ?? Infinity) - (b.distance_m ?? Infinity);
    });
  }, [data, sort]);

  const store = data?.store ?? null;
  const storeLat = store?.lat ?? null;
  const storeLng = store?.lng ?? null;
  const center: [number, number] = storeLat != null && storeLng != null
    ? [storeLat, storeLng]
    : (orders.find((o) => o.address?.lat != null)?.address
      ? [orders[0].address!.lat as number, orders[0].address!.lng as number]
      : BRAZIL_CENTER);

  function focus(o: DeliveryMapOrder) {
    setSelected(o.id);
    if (o.address?.lat != null && o.address?.lng != null && mapRef.current) {
      mapRef.current.flyTo([o.address.lat, o.address.lng], 16);
    }
  }

  /** Fixar à mão: o clique seguinte no mapa vira a coordenada do pedido em edição. */
  function startPinning(o: DeliveryMapOrder) {
    setEditing(o);
    setPinning(true);
    if (storeLat != null && storeLng != null && mapRef.current) {
      mapRef.current.flyTo([storeLat, storeLng], 15);
    }
  }

  const distanceFilterOn = band !== '' || minKm !== '' || maxKm !== '';

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

      <div className="mb-3 flex flex-wrap items-end gap-3">
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
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-600">Buscar</span>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cliente, nº do pedido ou rua"
              className="w-60 rounded-lg border border-slate-300 py-2 pl-8 pr-8 text-sm"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X size={14} />
              </button>
            )}
          </div>
        </label>
        <label className="w-36 text-sm">
          <span className="mb-1 block font-medium text-slate-600">Plataforma</span>
          <Select value={platform} onChange={(e) => setPlatform(e.target.value as DeliveryPlatform | '')}>
            <option value="">Todas</option>
            <option value="ifood">iFood</option>
            <option value="99food">99Food</option>
          </Select>
        </label>
        <label className="w-44 text-sm">
          <span className="mb-1 block font-medium text-slate-600">Tipo de entrega</span>
          <Select value={mode} onChange={(e) => setMode(e.target.value as DeliveryMode | '')}>
            <option value="">Todas</option>
            <option value="own">Entrega própria</option>
            <option value="partner">Entrega da plataforma</option>
          </Select>
        </label>
        <label className="w-40 text-sm">
          <span className="mb-1 block font-medium text-slate-600">Ordenar por</span>
          <Select value={sort} onChange={(e) => setSort(e.target.value as 'distance' | 'name' | 'recent')}>
            <option value="distance">Distância</option>
            <option value="name">Nome (A–Z)</option>
            <option value="recent">Mais recentes</option>
          </Select>
        </label>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="w-28 text-sm">
          <span className="mb-1 block font-medium text-slate-600">Mín. (km)</span>
          <input
            type="number" min={0} step={0.5} value={minKm} placeholder="0"
            onChange={(e) => { setMinKm(e.target.value); setBand(''); }}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400"
            disabled={band !== '' || missingOnly}
          />
        </label>
        <label className="w-28 text-sm">
          <span className="mb-1 block font-medium text-slate-600">Máx. (km)</span>
          <input
            type="number" min={0} step={0.5} value={maxKm} placeholder="∞"
            onChange={(e) => { setMaxKm(e.target.value); setBand(''); }}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400"
            disabled={band !== '' || missingOnly}
          />
        </label>
        {distanceFilterOn && !missingOnly && (
          <button
            onClick={() => { setBand(''); setMinKm(''); setMaxKm(''); }}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            Limpar distância
          </button>
        )}
        <button
          onClick={() => { setMissingOnly((v) => !v); setBand(''); setMinKm(''); setMaxKm(''); }}
          className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
            missingOnly
              ? 'border-slate-500 bg-slate-700 text-white'
              : 'border-slate-300 text-slate-600 hover:bg-slate-50'
          }`}
        >
          <MapPin size={14} className="mr-1 inline" />
          {missingOnly ? 'Mostrando só sem localização' : `Sem localização${data?.stats ? ` (${data.stats.without_coords})` : ''}`}
        </button>
        <label className="flex items-center gap-2 py-2 text-sm text-slate-600">
          <input type="checkbox" checked={showRings} onChange={(e) => setShowRings(e.target.checked)}
                 className="rounded border-slate-300" />
          Mostrar raios de entrega
        </label>
      </div>

      {missingOnly && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Estes pedidos não aparecem no mapa porque o OpenStreetMap não achou o endereço. Clique em
          <strong> Corrigir</strong> para ajustar a rua/bairro e tentar de novo, ou em <strong>Fixar no mapa</strong> para
          marcar o ponto exato com o mouse — o ponto fixado à mão nunca é sobrescrito.
        </div>
      )}

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

          <p className="mb-1.5 text-xs font-medium text-slate-500">Dentro do raio (acumulado)</p>
          <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-5">
            {data.stats.radii.map((r) => (
              <button
                key={r.radius_m}
                onClick={() => { setBand(''); setMinKm(''); setMaxKm(String(r.radius_m / 1000)); setMissingOnly(false); }}
                className="rounded-lg border border-slate-200 px-3 py-2 text-left transition hover:border-slate-300 hover:bg-slate-50"
                title={`Filtrar pedidos até ${r.radius_m / 1000} km`}
              >
                <span className="flex items-center gap-1.5 text-xs text-slate-500">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: RING_COLOR[r.radius_m] }} />
                  até {r.radius_m / 1000} km
                </span>
                <p className="text-lg font-semibold text-slate-800">{r.orders}</p>
                <p className="text-xs text-slate-400">{r.share}% · {brl(r.revenue)}</p>
              </button>
            ))}
          </div>

          <p className="mb-1.5 text-xs font-medium text-slate-500">Por faixa (exclusivo)</p>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {data.stats.bands.map((b) => {
              const on = band === b.key;
              return (
                <button
                  key={b.key}
                  onClick={() => { setBand(on ? '' : b.key); setMinKm(''); setMaxKm(''); setMissingOnly(false); }}
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

      {pinning && editing && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-violet-300 bg-violet-50 px-4 py-3 text-sm">
          <span className="text-violet-800">
            <Crosshair size={15} className="mr-1 inline" />
            Clique no mapa para marcar onde fica <strong>{editing.display_id ?? `#${editing.id}`} — {editing.customer_name ?? 'Cliente'}</strong>
            {editing.address && <span className="block text-xs text-violet-600">{formatAddress(editing.address)}</span>}
          </span>
          <button onClick={() => { setPinning(false); setEditing(null); }}
                  className="rounded border border-violet-300 px-3 py-1 text-violet-700 hover:bg-violet-100">
            Cancelar
          </button>
        </div>
      )}

      {isLoading && <Spinner />}
      {error && <ErrorBox message={apiError(error)} />}

      {data && (
        <div className="space-y-4">
          <Card className="overflow-hidden p-0">
            <MapContainer center={center} zoom={store?.lat != null ? 13 : 4}
                          style={{ height: 480, width: '100%', cursor: pinning ? 'crosshair' : '' }}>
              <MapRefBridge onReady={(m) => (mapRef.current = m)} />
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                         attribution="&copy; <a href=&quot;https://www.openstreetmap.org/copyright&quot;>OpenStreetMap</a> contributors" />
              {pinning && <ClickCatcher onPick={(lat, lng) => { setPicked({ lat, lng }); setPinning(false); }} />}

              {/* Anéis de alcance: leitura imediata de até onde a operação entrega. */}
              {showRings && storeLat != null && storeLng != null && data.stats?.radii.map((r) => (
                <Circle
                  key={r.radius_m}
                  center={[storeLat, storeLng]}
                  radius={r.radius_m}
                  pathOptions={{
                    color: RING_COLOR[r.radius_m], weight: 1.5, opacity: 0.75,
                    fillOpacity: 0.04, fillColor: RING_COLOR[r.radius_m], dashArray: '5 5',
                  }}
                >
                  <LTooltip direction="center" permanent={false} sticky>
                    até {r.radius_m / 1000} km — {r.orders} pedidos ({r.share}%)
                  </LTooltip>
                </Circle>
              ))}

              {storeLat != null && storeLng != null && (
                <Marker position={[storeLat, storeLng]} icon={STORE_ICON}>
                  <Popup>
                    <strong>{store?.name || 'Loja'}</strong>
                    <div className="text-xs text-slate-500">{store?.formatted_address}</div>
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
                    <OrderPopup order={o} onEdit={() => setEditing(o)} />
                  </Popup>
                </Marker>
              ))}
            </MapContainer>
          </Card>
          <p className="text-xs text-slate-400">
            Distância em <strong>linha reta</strong> até a loja (não é rota real de entrega).
            Verde = bairro confere · Âmbar = bairro divergente do sugerido · Roxo = ponto fixado à mão · Cinza = sem coordenada.
          </p>

          {orders.length === 0 ? (
            <EmptyState message={
              missingOnly
                ? 'Nenhum pedido sem localização — todos já estão no mapa.'
                : (data.stats?.hidden_by_distance ?? 0) > 0
                  ? 'Nenhum pedido nesta faixa de distância. Limpe o filtro para ver os demais.'
                  : query
                    ? `Nenhum pedido encontrado para "${query}".`
                    : 'Nenhum pedido com endereço no período selecionado.'
            } />
          ) : (
            <Card className="overflow-x-auto p-0">
              <table className="w-full min-w-[58rem] text-sm">
                <thead className="border-b border-slate-200 text-left text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Pedido</th>
                    <th className="px-4 py-3 font-medium">Plataforma</th>
                    <th className="px-4 py-3 font-medium">Endereço</th>
                    <th className="px-4 py-3 font-medium">Bairro</th>
                    <th className="px-4 py-3 text-right font-medium">Valor</th>
                    <th className="px-4 py-3 text-right font-medium">Distância</th>
                    <th className="px-4 py-3 text-right font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr
                      key={o.id}
                      onClick={() => focus(o)}
                      className={`cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50 ${o.id === selected ? 'bg-emerald-50' : ''}`}
                    >
                      <td className="px-4 py-3 text-slate-700">
                        {o.display_id ?? `#${o.id}`}
                        <span className="block text-xs text-slate-400">{o.customer_name ?? 'Cliente'}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {PLATFORM_LABEL[o.platform] ?? o.platform}
                        <span className="block text-xs text-slate-400">
                          {o.delivery_mode === 'own' ? 'Própria' : o.delivery_mode === 'partner' ? 'Plataforma' : '—'}
                        </span>
                      </td>
                      <td className="max-w-[18rem] truncate px-4 py-3 text-slate-500" title={formatAddress(o.address)}>
                        {formatAddress(o.address) || '—'}
                      </td>
                      <td className={`px-4 py-3 ${o.address?.neighborhood_mismatch ? 'font-medium text-amber-700' : 'text-slate-600'}`}>
                        {o.address?.neighborhood ?? '—'}
                        {o.address?.neighborhood_mismatch && (
                          <span className="block text-xs text-amber-600">mapa sugere: {o.address?.suggested_neighborhood}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-600">
                        {o.customer_paid !== null ? brl(o.customer_paid) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-600">
                        {o.needs_geocode
                          ? <span className="text-xs text-slate-400">sem localização</span>
                          : km(o.distance_m)}
                      </td>
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => setEditing(o)}
                            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                          >
                            Corrigir
                          </button>
                          {o.needs_geocode && (
                            <button
                              onClick={() => startPinning(o)}
                              className="rounded border border-violet-300 px-2 py-1 text-xs text-violet-700 hover:bg-violet-50"
                            >
                              Fixar no mapa
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      )}

      {editing && !pinning && (
        <AddressEditor
          order={editing}
          picked={picked}
          onClose={() => { setEditing(null); setPicked(null); }}
          onPinOnMap={() => startPinning(editing)}
          onSaved={() => {
            setEditing(null);
            setPicked(null);
            qc.invalidateQueries({ queryKey: ['delivery-map'] });
          }}
        />
      )}
    </div>
  );
}

function OrderPopup({ order, onEdit }: { order: DeliveryMapOrder; onEdit: () => void }) {
  return (
    <div className="min-w-[220px] text-sm">
      <p className="font-semibold text-slate-800">{order.display_id ?? `#${order.id}`} · {PLATFORM_LABEL[order.platform] ?? order.platform}</p>
      <p className="text-slate-600">{order.customer_name ?? 'Cliente'}</p>
      <p className="mt-1 text-xs text-slate-500">{formatAddress(order.address)}</p>
      <p className="mt-1 text-xs text-slate-500">Distância: {km(order.distance_m)}</p>
      <p className="text-xs text-slate-500">Bairro: <strong>{order.address?.neighborhood ?? '—'}</strong></p>
      {order.address?.neighborhood_mismatch && (
        <p className="text-xs text-amber-700">Sugestão (mapa): {order.address?.suggested_neighborhood}</p>
      )}
      {order.address?.geocode_source === 'manual' && (
        <p className="text-xs text-violet-700">Ponto fixado à mão</p>
      )}
      <button onClick={onEdit} className="mt-2 w-full rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700">
        Corrigir endereço
      </button>
    </div>
  );
}

/**
 * Correção do endereço. Fica FORA do popup do marcador de propósito: pedido sem
 * coordenada não tem marcador, e eram justamente esses os que precisavam de correção.
 */
function AddressEditor({ order, picked, onClose, onPinOnMap, onSaved }: {
  order: DeliveryMapOrder;
  /** Coordenada clicada no mapa nesta sessão de edição (null = nenhuma). */
  picked: { lat: number; lng: number } | null;
  onClose: () => void;
  onPinOnMap: () => void;
  onSaved: () => void;
}) {
  const a = order.address;
  const pick = (...keys: string[]): string => {
    const raw = a as unknown as Record<string, unknown> | null;
    if (!raw) return '';
    for (const k of keys) {
      const v = raw[k];
      if (v != null && String(v).trim() !== '') return String(v);
    }
    return '';
  };
  const [street, setStreet] = useState(pick('street', 'streetName', 'street_name'));
  const [number, setNumber] = useState(pick('number', 'streetNumber', 'street_number'));
  const [neighborhood, setNeighborhood] = useState(pick('neighborhood', 'district'));
  const [city, setCity] = useState(pick('city'));

  const save = useMutation({
    mutationFn: () => mapApi.updateAddress(order.id, {
      street, number, neighborhood, city,
      ...(picked ? { lat: picked.lat, lng: picked.lng } : {}),
    }),
    onSuccess: onSaved,
  });
  const locate = useMutation({
    mutationFn: async () => {
      await mapApi.updateAddress(order.id, { street, number, neighborhood, city });
      return mapApi.geocodeOne(order.id);
    },
    onSuccess: (r) => { if (r.ok) onSaved(); },
  });

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-800">
              Corrigir endereço · {order.display_id ?? `#${order.id}`}
            </h3>
            <p className="text-sm text-slate-500">{order.customer_name ?? 'Cliente'}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        {order.needs_geocode && !picked && (
          <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            {order.geocode_failed === 'far_from_store'
              ? 'O endereço encontrado caiu longe demais da loja e foi descartado.'
              : 'O OpenStreetMap não encontrou este endereço.'}
            {' '}Ajuste a rua/bairro e use <strong>Salvar e localizar</strong>, ou marque o ponto à mão.
          </div>
        )}
        {picked && (
          <div className="mb-3 rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-700">
            Ponto marcado à mão: {picked.lat.toFixed(5)}, {picked.lng.toFixed(5)} — salve para confirmar.
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="sm:col-span-2 text-sm">
            <span className="mb-1 block font-medium text-slate-600">Rua</span>
            <input value={street} onChange={(e) => setStreet(e.target.value)}
                   className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-600">Número</span>
            <input value={number} onChange={(e) => setNumber(e.target.value)}
                   className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="sm:col-span-2 text-sm">
            <span className="mb-1 block font-medium text-slate-600">Bairro</span>
            <input value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)}
                   className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-600">Cidade</span>
            <input value={city} onChange={(e) => setCity(e.target.value)}
                   className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </label>
        </div>

        {locate.isSuccess && !locate.data.ok && (
          <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
            Ainda não encontrado ({locate.data.reason === 'far_from_store' ? 'resultado longe demais da loja' : 'endereço desconhecido no mapa'}).
            Use <strong>Fixar no mapa</strong> para marcar o ponto com o mouse.
          </p>
        )}
        {(save.isError || locate.isError) && (
          <div className="mt-3"><ErrorBox message={apiError(save.error ?? locate.error)} /></div>
        )}

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button onClick={onPinOnMap}
                  className="rounded-lg border border-violet-300 px-3 py-2 text-sm font-medium text-violet-700 hover:bg-violet-50">
            <Crosshair size={14} className="mr-1 inline" />
            Fixar no mapa
          </button>
          <button onClick={() => locate.mutate()} disabled={locate.isPending || save.isPending}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            {locate.isPending ? 'Localizando…' : 'Salvar e localizar'}
          </button>
          <button onClick={() => save.mutate()} disabled={save.isPending || locate.isPending}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
            {save.isPending ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}
