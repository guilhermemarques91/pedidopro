import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Bike, Store, Clock, ExternalLink, RefreshCw } from 'lucide-react';
import { deliveryApi } from '../../services/resources';
import { apiError } from '../../services/api';
import { useAuth } from '../../store/auth.store';
import type { DeliveryOrder, DeliveryStatus } from '../../types';
import { PageHeader } from '../../components/PageHeader';
import { Button, Card, Spinner, ErrorBox, EmptyState } from '../../components/ui';
import { brl } from '../../utils/format';

// Colunas operacionais do painel (kanban). 'preparing' entra junto de 'confirmed'.
const COLUMNS: { key: DeliveryStatus; title: string; match: DeliveryStatus[] }[] = [
  { key: 'placed', title: 'Novos', match: ['placed'] },
  { key: 'confirmed', title: 'Em preparo', match: ['confirmed', 'preparing'] },
  { key: 'ready', title: 'Prontos', match: ['ready'] },
  { key: 'dispatched', title: 'A caminho', match: ['dispatched'] },
];

const PLATFORM_META: Record<string, { label: string; cls: string }> = {
  ifood: { label: 'iFood', cls: 'bg-red-100 text-red-700' },
  '99food': { label: '99Food', cls: 'bg-yellow-100 text-yellow-800' },
};

export function Delivery() {
  const qc = useQueryClient();
  const isAdmin = useAuth((s) => s.hasRole('admin'));
  const { data, isLoading, error } = useQuery({
    queryKey: ['delivery-orders'],
    queryFn: () => deliveryApi.list(),
    refetchInterval: 15_000, // mantém o painel "ao vivo" (mesma cadência da caixa de entrada)
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['delivery-orders'] });
  const sync = useMutation({ mutationFn: deliveryApi.sync, onSuccess: invalidate });
  const confirm = useMutation({ mutationFn: deliveryApi.confirm, onSuccess: invalidate });
  const ready = useMutation({ mutationFn: deliveryApi.ready, onSuccess: invalidate });
  const dispatch = useMutation({ mutationFn: deliveryApi.dispatch, onSuccess: invalidate });
  const cancel = useMutation({ mutationFn: deliveryApi.cancel, onSuccess: invalidate });
  const busy = confirm.isPending || ready.isPending || dispatch.isPending || cancel.isPending;

  return (
    <div>
      <PageHeader
        title="Painel de Pedidos"
        subtitle="Pedidos de delivery em tempo real — iFood e 99Food"
        action={isAdmin && (
          <Button variant="secondary" disabled={sync.isPending} onClick={() => sync.mutate()}>
            <RefreshCw size={16} className={sync.isPending ? 'animate-spin' : ''} /> Sincronizar agora
          </Button>
        )}
      />

      {isLoading && <Spinner />}
      {error && <ErrorBox message={apiError(error)} />}
      {(confirm.error || ready.error || dispatch.error || cancel.error) && (
        <div className="mb-3"><ErrorBox message={apiError(confirm.error || ready.error || dispatch.error || cancel.error)} /></div>
      )}

      {data && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((col) => {
            const orders = data.filter((o) => col.match.includes(o.status));
            return (
              <div key={col.key} className="flex flex-col">
                <div className="mb-2 flex items-center justify-between px-1">
                  <h3 className="text-sm font-semibold text-slate-700">{col.title}</h3>
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">{orders.length}</span>
                </div>
                <div className="space-y-3">
                  {orders.length === 0 && <EmptyState message="—" />}
                  {orders.map((o) => (
                    <OrderCard
                      key={o.id}
                      order={o}
                      busy={busy}
                      onConfirm={() => confirm.mutate(o.id)}
                      onReady={() => ready.mutate(o.id)}
                      onDispatch={() => dispatch.mutate(o.id)}
                      onCancel={() => { if (window.confirm(`Cancelar o pedido ${o.display_id ?? o.id}?`)) cancel.mutate(o.id); }}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function OrderCard({
  order, busy, onConfirm, onReady, onDispatch, onCancel,
}: {
  order: DeliveryOrder;
  busy: boolean;
  onConfirm: () => void;
  onReady: () => void;
  onDispatch: () => void;
  onCancel: () => void;
}) {
  const p = PLATFORM_META[order.platform] ?? { label: order.platform, cls: 'bg-slate-100 text-slate-700' };
  const mode = order.delivery_mode;
  return (
    <Card className="p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className={`rounded px-2 py-0.5 text-xs font-bold ${p.cls}`}>{p.label}</span>
        <Link to={`/delivery/${order.id}`} className="flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline">
          {order.display_id ? `#${order.display_id}` : `#${order.id}`} <ExternalLink size={12} />
        </Link>
      </div>
      <p className="truncate text-sm font-medium text-slate-800">{order.customer_name ?? 'Cliente'}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        {mode && (
          <span className="flex items-center gap-1">
            {mode === 'own' ? <Store size={12} /> : <Bike size={12} />}
            {mode === 'own' ? 'Entrega própria' : 'Entrega parceira'}
          </span>
        )}
        <span>{order.items_count ?? 0} itens</span>
        <span className="font-medium text-slate-700">{brl(order.customer_paid)}</span>
      </div>
      {order.eta && (
        <p className="mt-1 flex items-center gap-1 text-xs text-slate-400"><Clock size={11} /> Previsão: {new Date(order.eta).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {order.status === 'placed' && <Button className="px-3 py-1.5 text-xs" disabled={busy} onClick={onConfirm}>Confirmar</Button>}
        {(order.status === 'confirmed' || order.status === 'preparing') && (
          <Button className="px-3 py-1.5 text-xs" disabled={busy} onClick={onReady}>Pronto</Button>
        )}
        {order.status === 'ready' && <Button className="px-3 py-1.5 text-xs" disabled={busy} onClick={onDispatch}>Despachar</Button>}
        {order.status === 'dispatched' && (
          <Link to={`/delivery/${order.id}`}><Button variant="secondary" className="px-3 py-1.5 text-xs">Acompanhar</Button></Link>
        )}
        {order.status !== 'dispatched' && (
          <Button variant="ghost" className="px-3 py-1.5 text-xs" disabled={busy} onClick={onCancel}>Cancelar</Button>
        )}
      </div>
    </Card>
  );
}
