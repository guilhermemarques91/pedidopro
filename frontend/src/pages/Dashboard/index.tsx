import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Truck, Package, ClipboardList, ShoppingCart } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { suppliersApi, itemsApi, quotationsApi, ordersApi } from '../../services/resources';
import { brl, date } from '../../utils/format';
import { PageHeader } from '../../components/PageHeader';
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

  if (suppliers.isLoading || orders.isLoading) return <Spinner />;

  const orderList = orders.data ?? [];
  const pending = orderList.filter((o) => o.status === 'pending_approval').length;
  const openQuotations = (quotations.data ?? []).filter((q) => q.status !== 'closed').length;

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
        <Kpi icon={Truck} label="Fornecedores" value={suppliers.data?.length ?? 0} to="/suppliers" color="text-blue-600" />
        <Kpi icon={Package} label="Itens" value={items.data?.length ?? 0} to="/items" color="text-violet-600" />
        <Kpi icon={ClipboardList} label="Cotações abertas" value={openQuotations} to="/quotations" color="text-amber-600" />
        <Kpi icon={ShoppingCart} label="Pedidos p/ aprovar" value={pending} to="/orders" color="text-emerald-600" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h3 className="mb-4 text-lg font-semibold text-slate-800">Pedidos por status</h3>
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
          <h3 className="px-5 pt-5 text-lg font-semibold text-slate-800">Pedidos recentes</h3>
          {recent.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">Sem pedidos ainda.</p>
          ) : (
            <table className="mt-3 w-full text-sm">
              <tbody>
                {recent.map((o) => (
                  <tr key={o.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-5 py-3"><Link to={`/orders/${o.id}`} className="font-medium text-emerald-700 hover:underline">#{o.id}</Link></td>
                    <td className="px-5 py-3 text-slate-600">{o.supplier_name}</td>
                    <td className="px-5 py-3"><Badge status={o.status} /></td>
                    <td className="px-5 py-3 text-right text-slate-600">{brl(o.total_amount)}</td>
                    <td className="px-5 py-3 text-right text-xs text-slate-400">{date(o.created_at)}</td>
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

function Kpi({ icon: Icon, label, value, to, color }: {
  icon: typeof Truck; label: string; value: number; to: string; color: string;
}) {
  return (
    <Link to={to}>
      <Card className="transition hover:shadow-md">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-3xl font-bold text-slate-800">{value}</p>
            <p className="text-sm text-slate-500">{label}</p>
          </div>
          <Icon className={color} size={32} />
        </div>
      </Card>
    </Link>
  );
}
