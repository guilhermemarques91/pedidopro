import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid,
  ScatterChart, Scatter, ZAxis, ReferenceLine,
} from 'recharts';
import { AlertTriangle, Bike, Search, Store, Users, X, XCircle } from 'lucide-react';
import { reportsApi } from '../../services/resources';
import { apiError } from '../../services/api';
import type { DeliveryMode, DeliveryPlatform, MenuEngineeringItem, MenuQuadrant } from '../../types';
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
  { key: 'menu', label: 'Engenharia de cardápio' },
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
      {tab === 'menu' && <MenuEngineering filters={filters} />}
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
  const [sort, setSort] = useState<'spent' | 'orders' | 'name' | 'recent'>('spent');
  const q = useDebounced('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['delivery-report-customers', filters, onlyRecurring, sort, q.value],
    queryFn: () => reportsApi.customers({
      ...filters, limit: 100, sort,
      ...(q.value ? { q: q.value } : {}),
      ...(onlyRecurring ? { recurring: '1' as const } : {}),
    }),
  });

  if (error) return <ErrorBox message={apiError(error)} />;

  const rows = data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <SearchBox value={q.text} onChange={q.set} placeholder="Buscar cliente ou telefone" />
        <label className="w-56 text-sm">
          <Select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="spent">Ordenar por valor gasto</option>
            <option value="orders">Ordenar por nº de pedidos</option>
            <option value="name">Ordem alfabética (A–Z)</option>
            <option value="recent">Pedido mais recente</option>
          </Select>
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={onlyRecurring} onChange={(e) => setOnlyRecurring(e.target.checked)}
                 className="rounded border-slate-300" />
          Só recorrentes (2+ pedidos)
        </label>
        <span className="text-sm text-slate-400">{isLoading ? 'carregando…' : `${rows.length} cliente(s)`}</span>
      </div>

      {isLoading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState message={q.value ? `Nenhum cliente encontrado para "${q.value}".` : 'Nenhum cliente no período selecionado.'} />
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

// ------------------------------------------------- engenharia de cardápio

/**
 * Cada prato posicionado por popularidade × margem. O nome de cada quadrante é o do método
 * clássico de engenharia de cardápio; o que importa na tela é a AÇÃO, então ela vem junto.
 */
const QUADRANT: Record<MenuQuadrant, { label: string; action: string; color: string; chip: string }> = {
  estrela: {
    label: 'Estrela',
    action: 'Vende muito e dá margem. Proteja: não mexa no preço nem na ficha sem motivo forte.',
    color: '#059669',
    chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  },
  cavalo: {
    label: 'Cavalo de batalha',
    action: 'Vende muito e sobra pouco. Renegocie o insumo ou suba o preço aos poucos.',
    color: '#d97706',
    chip: 'bg-amber-50 text-amber-700 ring-amber-200',
  },
  quebra_cabeca: {
    label: 'Quebra-cabeça',
    action: 'Dá margem mas quase ninguém pede. Vale empurrar: foto, destaque, combo.',
    color: '#0284c7',
    chip: 'bg-sky-50 text-sky-700 ring-sky-200',
  },
  abacaxi: {
    label: 'Abacaxi',
    action: 'Vende pouco e sobra pouco. Candidato a sair do cardápio.',
    color: '#e11d48',
    chip: 'bg-rose-50 text-rose-700 ring-rose-200',
  },
};

function MenuEngineering({ filters }: { filters: Filters }) {
  const [only, setOnly] = useState<MenuQuadrant | ''>('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['delivery-report-menu-engineering', filters],
    queryFn: () => reportsApi.menuEngineering(filters),
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox message={apiError(error)} />;
  if (!data) return null;
  if (data.items.length === 0 && data.unmatched.length === 0) {
    return <EmptyState message="Nenhum item vendido no período selecionado." />;
  }

  const t = data.totals;
  const rows = only ? data.items.filter((i) => i.quadrant === only) : data.items;
  const plotted = data.items.filter((i) => i.quadrant !== null);

  return (
    <div className="space-y-6">
      {/* Todos os totais contam só os itens com custo conhecido — misturar os outros
          devolveria uma margem alta que não existe. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Receita líquida" value={brl(t.net_revenue)} hint={`Sem a comissão do canal · ${t.costed_items} item(ns) com custo`} />
        <Kpi label="Custo da comida" value={brl(t.cost)} hint="Ficha técnica dos itens acima" />
        <Kpi label="Margem de contribuição" value={brl(t.margin)} />
        <Kpi label="Margem %" value={t.margin_pct === null ? '—' : `${t.margin_pct}%`} />
      </div>

      {(t.uncosted_items > 0 || t.unmatched_items > 0) && (
        <Card className="border-amber-200 bg-amber-50/60">
          <div className="flex gap-3">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
            <div className="text-sm text-amber-900">
              <p className="font-medium">A conta está incompleta.</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-amber-800">
                {t.uncosted_items > 0 && (
                  <li>
                    <strong>{t.uncosted_items}</strong> item(ns) vendidos sem custo conhecido — falta ficha técnica ou
                    custo do insumo. Eles aparecem na tabela, mas ficam fora dos quadrantes.
                  </li>
                )}
                {t.unmatched_items > 0 && (
                  <li>
                    <strong>{t.unmatched_items}</strong> item(ns) vendidos que o cardápio mestre não reconhece. Esses
                    também <strong>não baixam estoque</strong> — vale conferir o nome no cardápio.
                  </li>
                )}
                {t.uncovered_revenue > 0 && (
                  <li>
                    <strong>{brl(t.uncovered_revenue)}</strong> de receita ficou fora dos totais acima. Os números só
                    contam o que tem custo — somar o resto com custo zero mostraria uma margem que não existe.
                  </li>
                )}
              </ul>
            </div>
          </div>
        </Card>
      )}

      {plotted.length > 0 && (
        <Card>
          <h3 className="mb-1 text-sm font-semibold text-slate-700">Popularidade × margem</h3>
          <p className="mb-3 text-xs text-slate-500">
            As linhas são a mediana do período: {data.median_qty} unidade(s) vendidas e {brl(data.median_margin_unit)} de
            margem por unidade. Não há régua absoluta — cada prato é comparado com o resto do seu cardápio.
          </p>
          <ResponsiveContainer width="100%" height={340}>
            <ScatterChart margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                type="number" dataKey="qty" name="Vendidos" tick={{ fontSize: 12 }}
                label={{ value: 'Unidades vendidas', position: 'insideBottom', offset: -12, fontSize: 12 }}
              />
              <YAxis
                type="number" dataKey="margin_unit" name="Margem un." tick={{ fontSize: 12 }}
                tickFormatter={(v: number) => brl(v)} width={80}
              />
              <ZAxis type="number" dataKey="margin_total" range={[60, 400]} name="Margem total" />
              <ReferenceLine x={data.median_qty} stroke="#94a3b8" strokeDasharray="4 4" />
              <ReferenceLine y={data.median_margin_unit} stroke="#94a3b8" strokeDasharray="4 4" />
              <Tooltip
                cursor={{ strokeDasharray: '3 3' }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const i = payload[0].payload as MenuEngineeringItem;
                  const q = i.quadrant ? QUADRANT[i.quadrant] : null;
                  return (
                    <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs shadow-lg">
                      <p className="font-semibold text-slate-800">{i.menu_item_name}</p>
                      {q && <p className="mt-0.5" style={{ color: q.color }}>{q.label}</p>}
                      <p className="mt-1 text-slate-600">{i.qty} vendidos · {i.orders} pedido(s)</p>
                      <p className="text-slate-600">Margem un.: {brl(i.margin_unit ?? 0)}</p>
                      <p className="text-slate-600">Margem total: {brl(i.margin_total ?? 0)}</p>
                    </div>
                  );
                }}
              />
              <Scatter data={plotted} fill="#059669">
                {plotted.map((i) => (
                  <Cell key={i.menu_item_id} fill={i.quadrant ? QUADRANT[i.quadrant].color : '#94a3b8'} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(Object.keys(QUADRANT) as MenuQuadrant[]).map((k) => {
          const list = data.items.filter((i) => i.quadrant === k);
          const total = list.reduce((s, i) => s + (i.margin_total ?? 0), 0);
          return (
            <button
              key={k}
              onClick={() => setOnly(only === k ? '' : k)}
              className={`rounded-xl border p-4 text-left transition ${
                only === k ? 'border-slate-400 bg-slate-50' : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: QUADRANT[k].color }} />
                <span className="text-sm font-semibold text-slate-700">{QUADRANT[k].label}</span>
              </div>
              <p className="mt-1 text-2xl font-semibold text-slate-800">{list.length}</p>
              <p className="text-xs text-slate-500">{brl(total)} de margem no período</p>
              <p className="mt-2 text-xs leading-snug text-slate-500">{QUADRANT[k].action}</p>
            </button>
          );
        })}
      </div>

      <Card className="overflow-x-auto p-0">
        <div className="flex items-center justify-between px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-700">
            {only ? QUADRANT[only].label : 'Todos os itens'} · {rows.length}
          </h3>
          {only && (
            <button onClick={() => setOnly('')} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
              <X size={14} /> limpar filtro
            </button>
          )}
        </div>
        <table className="w-full min-w-[52rem] text-sm">
          <thead className="border-y border-slate-200 text-left text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Item</th>
              <th className="px-4 py-3 text-right font-medium">Vendidos</th>
              <th className="px-4 py-3 text-right font-medium">Preço médio</th>
              <th className="px-4 py-3 text-right font-medium">Custo un.</th>
              <th className="px-4 py-3 text-right font-medium">Margem un.</th>
              <th className="px-4 py-3 text-right font-medium">Margem total</th>
              <th className="px-4 py-3 font-medium">Classificação</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.menu_item_id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-700">
                  {i.menu_item_name}
                  {i.name !== i.menu_item_name && (
                    <span className="ml-2 text-xs text-slate-400">vendido como “{i.name}”</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-medium text-slate-700">{i.qty}</td>
                <td className="px-4 py-3 text-right text-slate-600">{brl(i.avg_price)}</td>
                <td className="px-4 py-3 text-right text-slate-600">
                  {i.cost_unit === null ? <span className="text-amber-600">sem custo</span> : brl(i.cost_unit)}
                </td>
                <td className="px-4 py-3 text-right text-slate-600">
                  {i.margin_unit === null ? '—' : brl(i.margin_unit)}
                </td>
                <td className={`px-4 py-3 text-right font-medium ${(i.margin_total ?? 0) < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                  {i.margin_total === null ? '—' : brl(i.margin_total)}
                </td>
                <td className="px-4 py-3">
                  {i.quadrant ? (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${QUADRANT[i.quadrant].chip}`}>
                      {QUADRANT[i.quadrant].label}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">
                      {i.cost_source === 'sem_vinculo' ? 'sem vínculo com o ERP' : 'sem ficha técnica'}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {data.unmatched.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <h3 className="px-4 py-3 text-sm font-semibold text-slate-700">
            Vendidos mas fora do cardápio mestre · {data.unmatched.length}
          </h3>
          <table className="w-full min-w-[28rem] text-sm">
            <thead className="border-y border-slate-200 text-left text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Nome no pedido</th>
                <th className="px-4 py-3 text-right font-medium">Vendidos</th>
                <th className="px-4 py-3 text-right font-medium">Receita</th>
              </tr>
            </thead>
            <tbody>
              {data.unmatched.map((u) => (
                <tr key={u.name} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-700">{u.name}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{u.qty}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{brl(u.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function Items({ filters }: { filters: Filters }) {
  const [sort, setSort] = useState<'qty' | 'revenue' | 'name'>('qty');
  const q = useDebounced('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['delivery-report-items', filters, sort, q.value],
    queryFn: () => reportsApi.items({ ...filters, limit: 100, sort, ...(q.value ? { q: q.value } : {}) }),
  });

  if (error) return <ErrorBox message={apiError(error)} />;

  const rows = data ?? [];
  // O gráfico mostra sempre os mais vendidos, mesmo quando a tabela está em A–Z:
  // uma barra por ordem alfabética não comunica nada.
  const chart = [...rows].sort((a, b) => b.qty - a.qty).slice(0, 12).map((i) => ({ name: i.name, qty: i.qty }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <SearchBox value={q.text} onChange={q.set} placeholder="Buscar item" />
        <label className="w-56 text-sm">
          <Select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="qty">Ordenar por quantidade</option>
            <option value="revenue">Ordenar por receita</option>
            <option value="name">Ordem alfabética (A–Z)</option>
          </Select>
        </label>
        <span className="text-sm text-slate-400">{isLoading ? 'carregando…' : `${rows.length} item(ns)`}</span>
      </div>

      {isLoading && <Spinner />}
      {!isLoading && rows.length === 0 && (
        <EmptyState message={q.value ? `Nenhum item encontrado para "${q.value}".` : 'Nenhum item vendido no período selecionado.'} />
      )}

      {rows.length > 0 && (
      <>
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
      </>
      )}
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

/** Busca com atraso: o texto aparece na hora, a requisição só sai depois da pausa. */
function useDebounced(initial: string, delay = 350) {
  const [text, set] = useState(initial);
  const [value, setValue] = useState(initial);
  useEffect(() => {
    const t = setTimeout(() => setValue(text.trim()), delay);
    return () => clearTimeout(t);
  }, [text, delay]);
  return { text, set, value };
}

function SearchBox({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder: string;
}) {
  return (
    <div className="relative">
      <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-64 rounded-lg border border-slate-300 py-2 pl-8 pr-8 text-sm"
      />
      {value && (
        <button onClick={() => onChange('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
          <X size={14} />
        </button>
      )}
    </div>
  );
}

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
