import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '../../services/resources';
import { apiError } from '../../services/api';
import type { DeliveryPlatform } from '../../types';
import { PageHeader } from '../../components/PageHeader';
import { Card, Select, Spinner, ErrorBox, EmptyState } from '../../components/ui';
import { brl } from '../../utils/format';

const PLATFORM_LABEL: Record<string, string> = { ifood: 'iFood', '99food': '99Food' };

export function Reports() {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 29 * 86400_000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [platform, setPlatform] = useState<DeliveryPlatform | ''>('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['delivery-report', from, to, platform],
    queryFn: () => reportsApi.summary({ from, to, platform: platform || undefined }),
  });

  const t = data?.totals;
  const avgTicket = t && t.orders > 0 ? t.customer_paid / t.orders : 0;

  return (
    <div>
      <PageHeader title="Relatórios" subtitle="Operação de delivery — faturamento, taxas, descontos e clientes" />

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

      {data && t && (
        t.orders === 0 ? (
          <EmptyState message="Nenhum pedido no período selecionado." />
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Kpi label="Pedidos" value={String(t.orders)} />
              <Kpi label="Cliente pagou" value={brl(t.customer_paid)} />
              <Kpi label="Ticket médio" value={brl(avgTicket)} />
              <Kpi label="Faturamento (itens)" value={brl(t.items_amount)} />
              <Kpi label="Taxa de entrega" value={brl(t.delivery_fee)} />
              <Kpi label="Desconto loja" value={brl(t.discount_merchant)} />
              <Kpi label="Desconto plataforma" value={brl(t.discount_platform)} />
              <Kpi label="Comissão estimada" value={brl(t.commission_est)} />
              <Kpi label="Margem estimada" value={brl(t.margin_est)} accent />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <Card>
                <h3 className="mb-3 text-sm font-semibold text-slate-700">Clientes</h3>
                <Row label="Novos" value={String(data.customers.new)} />
                <Row label="Recorrentes" value={String(data.customers.recurring)} />
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
                        <span className="font-medium text-slate-700">{r.orders}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>

            <Card className="p-0">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 text-left text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Plataforma</th>
                    <th className="px-4 py-3 text-right font-medium">Pedidos</th>
                    <th className="px-4 py-3 text-right font-medium">Cliente pagou</th>
                    <th className="px-4 py-3 text-right font-medium">Ticket médio</th>
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
                      <td className="px-4 py-3 text-right text-slate-600">{brl(p.commission_est)}</td>
                      <td className="px-4 py-3 text-right font-medium text-emerald-700">{brl(p.margin_est)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <p className="text-xs text-slate-400">
              Margem e comissão são <strong>estimadas</strong> pela taxa de comissão configurada em cada canal (Integrações).
              A conciliação de repasses reais virá da API Financeira das plataformas.
            </p>
          </div>
        )
      )}
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <Card className={accent ? 'border-emerald-200 bg-emerald-50' : ''}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${accent ? 'text-emerald-700' : 'text-slate-800'}`}>{value}</p>
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
