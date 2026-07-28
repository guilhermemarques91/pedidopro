import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid,
} from 'recharts';
import { Bike, Store, Users, XCircle } from 'lucide-react';
import { reportsApi } from '../../services/resources';
import { apiError } from '../../services/api';
import type { DeliveryMode, DeliveryPlatform } from '../../types';
import { PageHeader } from '../../components/PageHeader';
import { Card, Select, Spinner, ErrorBox, EmptyState } from '../../components/ui';
import { brl } from '../../utils/format';

const PLATFORM_LABEL: Record<string, string> = { ifood: 'iFood', '99food': '99Food' };
const WEEKDAY = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const TABS = [
  { key: 'overview', label: 'Visão geral' },
  { key: 'customers', label: 'Clientes' },
  { key: 'items', label: 'Itens vendidos' },
  { key: 'performance', label: 'Desempenho' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

export function Reports() {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 29 * 86400_000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [platform, setPlatform] = useState<DeliveryPlatform | ''>('');
  const [mode, setMode] = useState<DeliveryMode | ''>('');
  const [tab, setTab] = useState<TabKey>('overview');

  const filters = { from, to, platform: platform || undefined, delivery_mode: mode || undefined };

  return (
    <div>
      <PageHeader title="Relatórios" subtitle="Operação de delivery — faturamento, taxas, clientes e desempenho" />

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
            <option value="unknown">Não informado</option>
          </Select>
        </label>
        <QuickRanges onPick={(d) => { setFrom(d); setTo(today); }} today={today} />
      </div>

      <div className="mb-5 flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
              tab === t.key
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview filters={filters} />}
      {tab === 'customers' && <Customers filters={filters} />}
      {tab === 'items' && <Items filters={filters} />}
      {tab === 'performance' && <Performance filters={filters} />}
    </div>
  );
}

type Filters = { from: string; to: string; platform?: DeliveryPlatform; delivery_mode?: DeliveryMode };

/** Atalhos de período — o operador quase sempre quer "hoje" ou "últimos 7 dias". */
function QuickRanges({ onPick, today }: { onPick: (from: string) => void; today: string }) {
  const day = (n: number) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
  const opts = [
    { label: 'Hoje', from: today },
    { label: '7 dias', from: day(6) },
    { label: '30 dias', from: day(29) },
    { label: '90 dias', from: day(89) },
  ];
  return (
    <div className="flex gap-1">
      {opts.map((o) => (
        <button
          key={o.label}
          onClick={() => onPick(o.from)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ visão geral

function Overview({ filters }: { filters: Filters }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['delivery-report', filters],
    queryFn: () => reportsApi.summary(filters),
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox message={apiError(error)} />;
  if (!data) return null;

  const t = data.totals;
  if (t.orders === 0) return <EmptyState message="Nenhum pedido no período selecionado." />;

  const own = data.by_delivery_mode.find((m) => m.mode === 'own');
  const partner = data.by_delivery_mode.find((m) => m.mode === 'partner');
  const c = data.customers;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Pedidos" value={String(t.orders)} />
        <Kpi label="Cliente pagou" value={brl(t.customer_paid)} />
        <Kpi label="Ticket médio" value={brl(t.avg_ticket)} />
        <Kpi label="Faturamento (itens)" value={brl(t.items_amount)} />
        <Kpi label="Taxa de entrega recebida" value={brl(t.own_delivery_fee)} hint="Só da entrega própria" />
        <Kpi label="Desconto loja" value={brl(t.discount_merchant)} />
        <Kpi label="Desconto plataforma" value={brl(t.discount_platform)} />
        <Kpi label="Comissão estimada" value={brl(t.commission_est)} />
      </div>

      {/* Própria × plataforma: a taxa só entra no caixa quando a entrega é nossa. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <ModeCard
          icon={<Bike size={18} />}
          title="Entrega própria"
          orders={own?.orders ?? 0}
          total={t.orders}
          revenue={own?.customer_paid ?? 0}
          fee={own?.delivery_fee ?? 0}
          avgFee={own?.avg_fee ?? 0}
          feeIsRevenue
        />
        <ModeCard
          icon={<Store size={18} />}
          title="Entrega da plataforma"
          orders={partner?.orders ?? 0}
          total={t.orders}
          revenue={partner?.customer_paid ?? 0}
          fee={partner?.delivery_fee ?? 0}
          avgFee={partner?.avg_fee ?? 0}
        />
        <Card>
          <div className="mb-2 flex items-center gap-2 text-slate-700">
            <XCircle size={18} className="text-rose-500" />
            <h3 className="text-sm font-semibold">Cancelamentos</h3>
          </div>
          <p className="text-2xl font-semibold text-slate-800">{data.cancellations.orders}</p>
          <p className="text-xs text-slate-500">{data.cancellations.rate}% dos pedidos recebidos</p>
          <p className="mt-2 text-sm text-rose-600">{brl(data.cancellations.lost_amount)} não faturados</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <div className="mb-3 flex items-center gap-2 text-slate-700">
            <Users size={18} />
            <h3 className="text-sm font-semibold">Clientes</h3>
          </div>
          <Row label="Ativos no período" value={String(c.active)} />
          <Row label="Novos (1º pedido)" value={String(c.new)} />
          <Row label="Já compravam antes" value={String(c.returning)} />
          <Row label="Recorrentes (2+ pedidos)" value={String(c.repeat)} />
          <Row label="Compraram só 1 vez" value={String(c.one_time)} />
          <div className="mt-2 rounded-lg bg-emerald-50 px-3 py-2">
            <p className="text-xs text-emerald-700">Taxa de recompra</p>
            <p className="text-lg font-semibold text-emerald-700">{c.repeat_rate}%</p>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Top bairros/cidades</h3>
          {data.top_regions.length === 0 ? (
            <p className="text-sm text-slate-400">Sem dados de endereço no período.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {data.top_regions.map((r) => (
                <li key={r.region} className="flex justify-between border-b border-slate-100 py-1 last:border-0">
                  <span className="text-slate-600">{r.region}</span>
                  <span className="text-slate-500">
                    {r.orders} <span className="ml-2 font-medium text-slate-700">{brl(r.customer_paid)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[46rem] text-sm">
          <thead className="border-b border-slate-200 text-left text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Plataforma</th>
              <th className="px-4 py-3 text-right font-medium">Pedidos</th>
              <th className="px-4 py-3 text-right font-medium">Cliente pagou</th>
              <th className="px-4 py-3 text-right font-medium">Ticket médio</th>
              <th className="px-4 py-3 text-right font-medium">Taxa entrega</th>
              <th className="px-4 py-3 text-right font-medium">Comissão est.</th>
              <th className="px-4 py-3 text-right font-medium">Margem est.</th>
            </tr>
          </thead>
          <tbody>
            {data.by_platform.map((p) => (
              <tr key={p.platform} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-3 font-medium text-slate-700">{PLATFORM_LABEL[p.platform] ?? p.platform}</td>
                <td className="px-4 py-3 text-right text-slate-600">{p.orders}</td>
                <td className="px-4 py-3 text-right text-slate-600">{brl(p.customer_paid)}</td>
                <td className="px-4 py-3 text-right text-slate-600">{brl(p.avg_ticket)}</td>
                <td className="px-4 py-3 text-right text-slate-600">{brl(p.own_delivery_fee)}</td>
                <td className="px-4 py-3 text-right text-slate-600">{brl(p.commission_est)}</td>
                <td className="px-4 py-3 text-right font-medium text-emerald-700">{brl(p.margin_est)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <p className="text-xs text-slate-400">
        Margem e comissão são <strong>estimadas</strong> pela taxa de comissão configurada em cada canal (Integrações).
        A conciliação de repasses reais virá da API Financeira. Cancelados não entram no faturamento.
      </p>
    </div>
  );
}

function ModeCard({ icon, title, orders, total, revenue, fee, avgFee, feeIsRevenue }: {
  icon: React.ReactNode; title: string; orders: number; total: number;
  revenue: number; fee: number; avgFee: number; feeIsRevenue?: boolean;
}) {
  const pct = total > 0 ? Math.round((orders / total) * 100) : 0;
  return (
    <Card>
      <div className="mb-2 flex items-center gap-2 text-slate-700">
        <span className={feeIsRevenue ? 'text-emerald-600' : 'text-slate-400'}>{icon}</span>
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <p className="text-2xl font-semibold text-slate-800">{orders}</p>
      <p className="text-xs text-slate-500">{pct}% dos pedidos · {brl(revenue)}</p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full ${feeIsRevenue ? 'bg-emerald-500' : 'bg-slate-400'}`} style={{ width: `${pct}%` }} />
      </div>
      {feeIsRevenue ? (
        <p className="mt-2 text-sm text-emerald-700">
          {brl(fee)} <span className="text-xs text-slate-500">em taxas (média {brl(avgFee)})</span>
        </p>
      ) : (
        <p className="mt-2 text-xs text-slate-400">A taxa fica com a plataforma.</p>
      )}
    </Card>
  );
}

// --------------------------------------------------------------------- clientes

function Customers({ filters }: { filters: Filters }) {
  const [onlyRecurring, setOnlyRecurring] = useState(false);
  const [sort, setSort] = useState<'spent' | 'orders'>('spent');

  const { data, isLoading, error } = useQuery({
    queryKey: ['delivery-report-customers', filters, onlyRecurring, sort],
    queryFn: () => reportsApi.customers({
      ...filters, limit: 100, sort, ...(onlyRecurring ? { recurring: '1' as const } : {}),
    }),
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox message={apiError(error)} />;

  const rows = data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={onlyRecurring} onChange={(e) => setOnlyRecurring(e.target.checked)}
                 className="rounded border-slate-300" />
          Só recorrentes (2+ pedidos)
        </label>
        <label className="w-52 text-sm">
          <Select value={sort} onChange={(e) => setSort(e.target.value as 'spent' | 'orders')}>
            <option value="spent">Ordenar por valor gasto</option>
            <option value="orders">Ordenar por nº de pedidos</option>
          </Select>
        </label>
        <span className="text-sm text-slate-400">{rows.length} cliente(s)</span>
      </div>

      {rows.length === 0 ? (
        <EmptyState message="Nenhum cliente no período selecionado." />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[52rem] text-sm">
            <thead className="border-b border-slate-200 text-left text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Cliente</th>
                <th className="px-4 py-3 font-medium">Telefone</th>
                <th className="px-4 py-3 font-medium">Plataforma</th>
                <th className="px-4 py-3 text-right font-medium">Pedidos no período</th>
                <th className="px-4 py-3 text-right font-medium">Total histórico</th>
                <th className="px-4 py-3 text-right font-medium">Gasto</th>
                <th className="px-4 py-3 text-right font-medium">Ticket médio</th>
                <th className="px-4 py-3 text-right font-medium">Último pedido</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <span className="font-medium text-slate-700">{c.name ?? 'Cliente'}</span>
                    {c.is_recurring && (
                      <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        recorrente
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{c.phone ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{PLATFORM_LABEL[c.platform] ?? c.platform}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{c.orders}</td>
                  <td className="px-4 py-3 text-right font-medium text-slate-700">{c.orders_total}</td>
                  <td className="px-4 py-3 text-right font-medium text-slate-700">{brl(c.spent)}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{brl(c.avg_ticket)}</td>
                  <td className="px-4 py-3 text-right text-slate-500">
                    {c.days_since_last === null ? '—'
                      : c.days_since_last === 0 ? 'hoje'
                      : `há ${c.days_since_last} dia${c.days_since_last > 1 ? 's' : ''}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <p className="text-xs text-slate-400">
        <strong>Total histórico</strong> conta todos os pedidos do cliente, não só os do período — é ele que define a recorrência.
        Clientes só são identificados quando a plataforma envia o id do cliente.
      </p>
    </div>
  );
}

// ------------------------------------------------------------------------ itens

function Items({ filters }: { filters: Filters }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['delivery-report-items', filters],
    queryFn: () => reportsApi.items({ ...filters, limit: 100 }),
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox message={apiError(error)} />;

  const rows = data ?? [];
  if (rows.length === 0) return <EmptyState message="Nenhum item vendido no período selecionado." />;

  const chart = rows.slice(0, 12).map((i) => ({ name: i.name, qty: i.qty }));

  return (
    <div className="space-y-4">
      <Card>
        <h3 className="mb-3 text-sm font-semibold text-slate-700">12 itens mais vendidos (quantidade)</h3>
        <ResponsiveContainer width="100%" height={Math.max(220, chart.length * 28)}>
          <BarChart data={chart} layout="vertical" margin={{ left: 8, right: 16 }}>
            <XAxis type="number" tick={{ fontSize: 12 }} />
            <YAxis type="category" dataKey="name" width={180} tick={{ fontSize: 12 }} />
            <Tooltip formatter={(v: number) => [v, 'Quantidade']} />
            <Bar dataKey="qty" radius={[0, 4, 4, 0]} fill="#059669" />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[36rem] text-sm">
          <thead className="border-b border-slate-200 text-left text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Item</th>
              <th className="px-4 py-3 text-right font-medium">Quantidade</th>
              <th className="px-4 py-3 text-right font-medium">Pedidos</th>
              <th className="px-4 py-3 text-right font-medium">Preço médio</th>
              <th className="px-4 py-3 text-right font-medium">Receita</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.name} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-700">{i.name}</td>
                <td className="px-4 py-3 text-right font-medium text-slate-700">{i.qty}</td>
                <td className="px-4 py-3 text-right text-slate-600">{i.orders}</td>
                <td className="px-4 py-3 text-right text-slate-600">{brl(i.avg_price)}</td>
                <td className="px-4 py-3 text-right font-medium text-emerald-700">{brl(i.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// -------------------------------------------------------------------- desempenho

function Performance({ filters }: { filters: Filters }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['delivery-report-performance', filters],
    queryFn: () => reportsApi.performance(filters),
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox message={apiError(error)} />;
  if (!data) return null;
  if (data.daily.length === 0) return <EmptyState message="Nenhum pedido no período selecionado." />;

  const daily = data.daily.map((d) => ({ ...d, label: d.day.slice(8, 10) + '/' + d.day.slice(5, 7) }));
  // Eixo fixo de 0-23h: hora sem pedido tem que aparecer como vale, não sumir do gráfico.
  const hourly = Array.from({ length: 24 }, (_, h) => {
    const found = data.hourly.find((x) => x.hour === h);
    return { hour: h, label: `${String(h).padStart(2, '0')}h`, orders: found?.orders ?? 0 };
  });
  const peak = hourly.reduce((a, b) => (b.orders > a.orders ? b : a), hourly[0]);
  const weekday = Array.from({ length: 7 }, (_, d) => {
    const found = data.weekday.find((x) => x.dow === d);
    return { label: WEEKDAY[d], orders: found?.orders ?? 0, revenue: found?.revenue ?? 0 };
  });
  const bestDay = weekday.reduce((a, b) => (b.orders > a.orders ? b : a), weekday[0]);
  const tm = data.timings;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="Aceite do pedido" value={min(tm.to_confirm_min)} hint="Recebido → confirmado" />
        <Kpi label="Preparo" value={min(tm.to_ready_min)} hint="Confirmado → pronto" />
        <Kpi label="Saída" value={min(tm.to_dispatch_min)} hint="Pronto → a caminho" />
        <Kpi label="Entrega" value={min(tm.to_conclude_min)} hint="A caminho → concluído" />
        <Kpi label="Ciclo total" value={min(tm.total_min)} hint={`${tm.concluded} concluídos`} accent />
      </div>

      <Card>
        <h3 className="mb-3 text-sm font-semibold text-slate-700">Pedidos por dia</h3>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={daily} margin={{ left: 0, right: 16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip formatter={(v: number, n) => (n === 'revenue' ? [brl(v), 'Faturamento'] : [v, 'Pedidos'])} />
            <Line type="monotone" dataKey="orders" stroke="#059669" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-baseline justify-between">
            <h3 className="text-sm font-semibold text-slate-700">Horário de pico</h3>
            <span className="text-xs text-slate-500">maior movimento às {peak.label} ({peak.orders} pedidos)</span>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={hourly} margin={{ left: 0, right: 8 }}>
              <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={1} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip formatter={(v: number) => [v, 'Pedidos']} />
              <Bar dataKey="orders" radius={[4, 4, 0, 0]}>
                {hourly.map((h) => (
                  <Cell key={h.hour} fill={h.hour === peak.hour ? '#059669' : '#cbd5e1'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <div className="mb-3 flex items-baseline justify-between">
            <h3 className="text-sm font-semibold text-slate-700">Dia da semana</h3>
            <span className="text-xs text-slate-500">melhor dia: {bestDay.label}</span>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={weekday} margin={{ left: 0, right: 8 }}>
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip formatter={(v: number) => [v, 'Pedidos']} />
              <Bar dataKey="orders" radius={[4, 4, 0, 0]}>
                {weekday.map((w) => (
                  <Cell key={w.label} fill={w.label === bestDay.label ? '#059669' : '#cbd5e1'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <p className="text-xs text-slate-400">
        Tempos são a média das etapas com os dois carimbos registrados; transições acima de 24h são
        descartadas para não distorcer a média. A conclusão do iFood de entrega própria pode ser
        automática (rede de segurança do poller), então o tempo de entrega é aproximado.
      </p>
    </div>
  );
}

function min(v: number | null): string {
  return v === null ? '—' : `${v} min`;
}

// ---------------------------------------------------------------------- comuns

function Kpi({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <Card className={accent ? 'border-emerald-200 bg-emerald-50' : ''}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${accent ? 'text-emerald-700' : 'text-slate-800'}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold text-slate-800">{value}</span>
    </div>
  );
}
