import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Truck, Package, ClipboardList, ShoppingCart, AlertTriangle, PackageCheck } from 'lucide-react';
import {
  BarChart, Bar, ComposedChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts';
import { suppliersApi, itemsApi, quotationsApi, ordersApi, productsApi, receiptsApi, purchasesApi } from '../../services/resources';
import { brl, pct, date } from '../../utils/format';
import { PageHeader } from '../../components/PageHeader';
import { StatCard } from '../../components/StatCard';
import { Card, Spinner, Badge } from '../../components/ui';
import type { AbcClass, AbcDimension } from '../../types';

const CLASS_TONE: Record<AbcClass, string> = {
  A: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  B: 'bg-amber-50 text-amber-700 ring-amber-200',
  C: 'bg-slate-100 text-slate-500 ring-slate-200',
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Rascunho', pending_approval: 'Aguardando', approved: 'Aprovado',
  sent: 'Enviado', received: 'Recebido', cancelled: 'Cancelado',
};
const STATUS_COLORS: Record<string, string> = {
  draft: '#94a3b8', pending_approval: '#f59e0b', approved: '#10b981',
  sent: '#6366f1', received: '#22c55e', cancelled: '#ef4444',
};

export function Dashboard() {
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });
  const items = useQuery({ queryKey: ['items', undefined], queryFn: () => itemsApi.list() });
  const quotations = useQuery({ queryKey: ['quotations'], queryFn: quotationsApi.list });
  const orders = useQuery({ queryKey: ['orders', ''], queryFn: () => ordersApi.list() });
  // Mesma query que a tela Produtos já carrega inteira (sem paginação): reusar em vez
  // de um endpoint novo, e o card de crítico bate exatamente com o que a tela mostra.
  const products = useQuery({ queryKey: ['products', {}], queryFn: () => productsApi.list() });
  const receipts = useQuery({ queryKey: ['stock-receipts', 'aguardando'], queryFn: () => receiptsApi.list('aguardando') });

  if (suppliers.isLoading || orders.isLoading) return <Spinner />;

  const orderList = orders.data ?? [];
  const pending = orderList.filter((o) => o.status === 'pending_approval').length;
  const openQuotations = (quotations.data ?? []).filter((q) => q.status !== 'closed').length;
  const criticalProducts = (products.data ?? []).filter((p) => p.stock_status === 'critico').length;
  const awaitingReceipts = receipts.data?.length ?? 0;

  const byStatus = Object.entries(
    orderList.reduce<Record<string, number>>((acc, o) => {
      acc[o.status] = (acc[o.status] ?? 0) + 1;
      return acc;
    }, {})
  ).map(([status, count]) => ({ status, label: STATUS_LABELS[status] ?? status, count }));

  const recent = [...orderList].slice(0, 6);

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Visão geral das compras" />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={Truck} label="Fornecedores" value={suppliers.data?.length ?? 0} tone="info" to="/suppliers" />
        <StatCard icon={Package} label="Itens cadastrados" value={items.data?.length ?? 0} to="/items" />
        {/* Tom por SIGNIFICADO: cotação aberta e pedido parado esperam uma ação — ficam
            em âmbar para saltarem na varredura da linha. Zerados voltam ao neutro. */}
        <StatCard
          icon={ClipboardList}
          label="Cotações abertas"
          value={openQuotations}
          tone={openQuotations > 0 ? 'warn' : 'default'}
          to="/quotations"
        />
        <StatCard
          icon={ShoppingCart}
          label="Pedidos p/ aprovar"
          value={pending}
          tone={pending > 0 ? 'danger' : 'success'}
          to="/orders"
        />
        {/* O lado do estoque não tinha nenhum sinal aqui — só fornecedor/item/cotação/
            pedido. Estes dois fecham o buraco: o que está no vermelho agora, e o que já
            foi comprado mas ainda não chegou. */}
        <StatCard
          icon={AlertTriangle}
          label="Produtos críticos"
          value={products.isLoading ? '—' : criticalProducts}
          tone={criticalProducts > 0 ? 'danger' : 'success'}
          to="/products?estoque=critico"
        />
        <StatCard
          icon={PackageCheck}
          label="Entradas aguardando nota"
          value={receipts.isLoading ? '—' : awaitingReceipts}
          tone={awaitingReceipts > 0 ? 'warn' : 'default'}
          to="/estoque/entradas"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h3 className="mb-4 text-base font-semibold tracking-tight text-slate-900">Pedidos por status</h3>
          {byStatus.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">Sem pedidos ainda.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={byStatus}>
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                  {byStatus.map((d) => <Cell key={d.status} fill={STATUS_COLORS[d.status] ?? '#10b981'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card className="p-0">
          {/* Cabeçalho com atalho à direita — padrão "título + ação" dos painéis. */}
          <div className="flex items-center justify-between px-5 pt-5">
            <h3 className="text-base font-semibold tracking-tight text-slate-900">Pedidos recentes</h3>
            <Link
              to="/orders"
              className="rounded-lg px-2 py-1 text-sm font-medium text-emerald-700 hover:bg-emerald-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            >
              Ver todos
            </Link>
          </div>
          {recent.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">Sem pedidos ainda.</p>
          ) : (
            <table className="mt-2 w-full text-sm">
              <tbody>
                {recent.map((o) => (
                  <tr key={o.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70">
                    <td className="px-5 py-3.5"><Link to={`/orders/${o.id}`} className="font-semibold text-emerald-700 hover:underline">#{o.id}</Link></td>
                    <td className="px-5 py-3.5 text-slate-700">{o.supplier_name}</td>
                    <td className="px-5 py-3.5"><Badge status={o.status} /></td>
                    <td className="px-5 py-3.5 text-right font-medium text-slate-800">{brl(o.total_amount)}</td>
                    <td className="px-5 py-3.5 text-right text-xs text-slate-400">{date(o.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <AbcCurve />
      </div>
    </div>
  );
}

/**
 * Curva ABC: ranking de gasto por item ou fornecedor, com % acumulado — classe A é quem
 * soma até 80% do gasto do período, B até 95%, C o resto. Fonte híbrida (ver
 * PurchasesReportController): preço da nota confirmada quando existe, preço do pedido
 * quando não — por isso algumas linhas trazem os dois períodos misturados ("fonte mista").
 */
function AbcCurve() {
  const [dimension, setDimension] = useState<AbcDimension>('product');
  const [days, setDays] = useState(90);
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);

  const { data, isLoading, error } = useQuery({
    queryKey: ['purchases-abc', dimension, days],
    queryFn: () => purchasesApi.abc({ from, to, dimension }),
  });

  const chart = (data?.rows ?? []).slice(0, 12).map((r) => ({
    name: r.name.length > 16 ? r.name.slice(0, 15) + '…' : r.name,
    spend: r.spend,
    cumPct: r.cum_pct * 100,
  }));

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <h3 className="text-base font-semibold tracking-tight text-slate-900">Curva ABC de compras</h3>
          <p className="text-xs text-slate-400">Últimos {days} dias · quem concentra o gasto</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
            <button
              type="button"
              onClick={() => setDimension('product')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${dimension === 'product' ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              Por item
            </button>
            <button
              type="button"
              onClick={() => setDimension('supplier')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${dimension === 'supplier' ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              Por fornecedor
            </button>
          </div>
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
            {[30, 90, 365].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${days === d ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                {d === 365 ? '12 meses' : `${d} dias`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isLoading && <div className="p-5"><Spinner /></div>}
      {error && <p className="p-5 text-sm text-rose-600">Não deu para carregar a curva ABC.</p>}
      {data && data.rows.length === 0 && (
        <p className="px-5 py-8 text-center text-sm text-slate-400">
          Nenhum gasto confirmado neste período — a curva usa entradas de mercadoria confirmadas
          e pedidos recebidos.
        </p>
      )}

      {data && data.rows.length > 0 && (
        <>
          <div className="px-5 pt-4">
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={chart} margin={{ left: 0, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-25} textAnchor="end" height={50} />
                <YAxis yAxisId="l" tick={{ fontSize: 11 }} tickFormatter={(v: number) => (v / 1000).toFixed(0) + 'k'} />
                <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(v: number) => v.toFixed(0) + '%'} domain={[0, 100]} />
                <Tooltip formatter={(v: number, n) => (n === '% acumulado' ? [`${v.toFixed(1)}%`, n] : [brl(v), n])} />
                <Bar yAxisId="l" dataKey="spend" name="Gasto" fill="#059669" radius={[4, 4, 0, 0]} />
                <Line yAxisId="r" type="monotone" dataKey="cumPct" name="% acumulado" stroke="#e11d48" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="overflow-x-auto">
            <table className="mt-2 w-full text-sm">
              <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-2.5 font-medium">#</th>
                  <th className="px-5 py-2.5 font-medium">{dimension === 'product' ? 'Item' : 'Fornecedor'}</th>
                  <th className="px-5 py-2.5 text-right font-medium">Gasto</th>
                  <th className="px-5 py-2.5 text-right font-medium">% do total</th>
                  <th className="px-5 py-2.5 text-right font-medium">% acumulado</th>
                  <th className="px-5 py-2.5 font-medium">Classe</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={`${r.id}-${i}`} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-2.5 text-slate-400">{i + 1}</td>
                    <td className="px-5 py-2.5 font-medium text-slate-800">
                      {r.name}
                      {r.source === 'mixed' && <span className="ml-1.5 text-xs font-normal text-slate-400" title="Soma preço de nota confirmada e de pedido no mesmo período">(fonte mista)</span>}
                    </td>
                    <td className="px-5 py-2.5 text-right text-slate-700">{brl(r.spend)}</td>
                    <td className="px-5 py-2.5 text-right text-xs text-slate-500">{pct(r.pct)}</td>
                    <td className="px-5 py-2.5 text-right text-xs text-slate-500">{pct(r.cum_pct)}</td>
                    <td className="px-5 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${CLASS_TONE[r.class]}`}>{r.class}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
