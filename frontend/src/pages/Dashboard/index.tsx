import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Truck, Package, ClipboardList, ShoppingCart, AlertTriangle, PackageCheck } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { suppliersApi, itemsApi, quotationsApi, ordersApi, productsApi, receiptsApi } from '../../services/resources';
import { brl, date } from '../../utils/format';
import { PageHeader } from '../../components/PageHeader';
import { StatCard } from '../../components/StatCard';
import { Card, Spinner, Badge } from '../../components/ui';

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
    </div>
  );
}

