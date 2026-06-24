import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, MapPin } from 'lucide-react';
import { deliveryApi } from '../../services/resources';
import { apiError } from '../../services/api';
import type { DeliveryStatus } from '../../types';
import { PageHeader } from '../../components/PageHeader';
import { Button, Card, Spinner, ErrorBox } from '../../components/ui';
import { brl, datetime } from '../../utils/format';

const STATUS_FLOW: { key: DeliveryStatus; label: string; tsField: string }[] = [
  { key: 'placed', label: 'Recebido', tsField: 'placed_at' },
  { key: 'confirmed', label: 'Confirmado', tsField: 'confirmed_at' },
  { key: 'ready', label: 'Pronto', tsField: 'ready_at' },
  { key: 'dispatched', label: 'Despachado', tsField: 'dispatched_at' },
  { key: 'concluded', label: 'Concluído', tsField: 'concluded_at' },
];

export function DeliveryOrderDetailPage() {
  const { id } = useParams();
  const orderId = Number(id);
  const qc = useQueryClient();
  const [tracking, setTracking] = useState<Record<string, unknown> | null>(null);

  const { data: order, isLoading, error } = useQuery({
    queryKey: ['delivery-order', orderId],
    queryFn: () => deliveryApi.get(orderId),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['delivery-order', orderId] });
    qc.invalidateQueries({ queryKey: ['delivery-orders'] });
  };
  const confirm = useMutation({ mutationFn: () => deliveryApi.confirm(orderId), onSuccess: invalidate });
  const ready = useMutation({ mutationFn: () => deliveryApi.ready(orderId), onSuccess: invalidate });
  const dispatch = useMutation({ mutationFn: () => deliveryApi.dispatch(orderId), onSuccess: invalidate });
  const cancel = useMutation({ mutationFn: () => deliveryApi.cancel(orderId), onSuccess: invalidate });
  const track = useMutation({ mutationFn: () => deliveryApi.tracking(orderId), onSuccess: (d) => setTracking(d) });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox message={apiError(error)} />;
  if (!order) return null;

  const addr = order.delivery_address as Record<string, unknown> | null;

  return (
    <div>
      <Link to="/delivery" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft size={16} /> Voltar ao painel
      </Link>
      <PageHeader
        title={`Pedido ${order.display_id ? `#${order.display_id}` : `#${order.id}`}`}
        subtitle={`${order.platform === 'ifood' ? 'iFood' : '99Food'} · ${order.customer_name ?? 'Cliente'}`}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Itens</h3>
            <table className="w-full text-sm">
              <tbody>
                {order.items.map((it) => (
                  <tr key={it.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 text-slate-500">{Number(it.quantity)}x</td>
                    <td className="py-2 text-slate-800">{it.name}{it.observations && <span className="block text-xs text-slate-400">{it.observations}</span>}</td>
                    <td className="py-2 text-right text-slate-600">{brl(it.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {addr && (
            <Card>
              <h3 className="mb-2 flex items-center gap-1 text-sm font-semibold text-slate-700"><MapPin size={15} /> Entrega</h3>
              <p className="text-sm text-slate-600">{formatAddress(addr)}</p>
              {order.delivery_mode && (
                <p className="mt-1 text-xs text-slate-400">{order.delivery_mode === 'own' ? 'Entrega própria' : 'Entrega parceira'}{order.delivery_distance_m ? ` · ${(order.delivery_distance_m / 1000).toFixed(1)} km` : ''}</p>
              )}
              {order.status === 'dispatched' && order.delivery_mode === 'own' && (
                <div className="mt-3">
                  <Button variant="secondary" className="text-xs" disabled={track.isPending} onClick={() => track.mutate()}>Acompanhar entregador</Button>
                  {tracking && <pre className="mt-2 overflow-auto rounded bg-slate-50 p-2 text-xs text-slate-600">{JSON.stringify(tracking, null, 2)}</pre>}
                </div>
              )}
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Valores</h3>
            <Row label="Itens" value={brl(order.items_amount)} />
            <Row label="Taxa de entrega" value={brl(order.delivery_fee)} />
            {order.discount_merchant && <Row label="Desconto (loja)" value={`- ${brl(order.discount_merchant)}`} />}
            {order.discount_platform && <Row label="Desconto (plataforma)" value={`- ${brl(order.discount_platform)}`} />}
            <div className="mt-2 border-t border-slate-100 pt-2">
              <Row label="Cliente pagou" value={brl(order.customer_paid)} bold />
            </div>
          </Card>

          <Card>
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Linha do tempo</h3>
            <ol className="space-y-2 text-sm">
              {STATUS_FLOW.map((s) => {
                const ts = order[s.tsField as keyof typeof order] as string | null;
                const done = !!ts;
                return (
                  <li key={s.key} className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${done ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                    <span className={done ? 'text-slate-700' : 'text-slate-400'}>{s.label}</span>
                    {ts && <span className="ml-auto text-xs text-slate-400">{datetime(ts)}</span>}
                  </li>
                );
              })}
              {order.status === 'cancelled' && <li className="text-sm font-medium text-red-600">Cancelado {order.cancelled_at ? `· ${datetime(order.cancelled_at)}` : ''}</li>}
            </ol>
          </Card>

          <Card>
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Ações</h3>
            <div className="flex flex-wrap gap-2">
              {order.status === 'placed' && <Button className="text-xs" disabled={confirm.isPending} onClick={() => confirm.mutate()}>Confirmar</Button>}
              {(order.status === 'confirmed' || order.status === 'preparing') && <Button className="text-xs" disabled={ready.isPending} onClick={() => ready.mutate()}>Marcar pronto</Button>}
              {order.status === 'ready' && <Button className="text-xs" disabled={dispatch.isPending} onClick={() => dispatch.mutate()}>Despachar</Button>}
              {!['dispatched', 'concluded', 'cancelled'].includes(order.status) && (
                <Button variant="ghost" className="text-xs" disabled={cancel.isPending} onClick={() => { if (window.confirm('Cancelar este pedido?')) cancel.mutate(); }}>Cancelar</Button>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between py-0.5 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className={bold ? 'font-semibold text-slate-800' : 'text-slate-700'}>{value}</span>
    </div>
  );
}

function formatAddress(addr: Record<string, unknown>): string {
  const get = (k: string) => (addr[k] != null ? String(addr[k]) : '');
  const parts = [
    [get('streetName') || get('street'), get('streetNumber') || get('number')].filter(Boolean).join(', '),
    get('complement'),
    get('neighborhood') || get('district'),
    get('city'),
    get('postalCode') || get('zipCode'),
  ].filter(Boolean);
  return parts.join(' · ') || JSON.stringify(addr);
}
