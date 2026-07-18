import { useState, type MouseEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, ExternalLink, Users } from 'lucide-react';
import { vendasApi } from '../../services/resources';
import { apiError } from '../../services/api';
import { useAuth } from '../../store/auth.store';
import type { VendasBoardCard, BoardColumn, BoardOrigin } from '../../types';
import { PageHeader } from '../../components/PageHeader';
import { Button, Card, Spinner, ErrorBox } from '../../components/ui';
import { brl } from '../../utils/format';
import { NewOrderModal } from './NewOrderModal';
import { PaymentModal } from './PaymentModal';
import { SaleDetailModal } from './SaleDetailModal';
import { ORIGIN_META, PAYMENT_LABEL, cardTitle, ElapsedBadge, useMinuteTick } from './shared';

const COLUMNS: { key: BoardColumn; title: string; accent: string }[] = [
  { key: 'enviado', title: 'Em preparo', accent: 'border-t-blue-500' },
  { key: 'pronto', title: 'Pronto', accent: 'border-t-emerald-500' },
  { key: 'aguardando_pagamento', title: 'Aguardando pagamento', accent: 'border-t-amber-500' },
  { key: 'concluido', title: 'Concluído', accent: 'border-t-slate-300' },
];

const FILTERS: { value: BoardOrigin | ''; label: string }[] = [
  { value: '', label: 'Todos' },
  { value: 'mesa', label: 'Mesa' },
  { value: 'comanda', label: 'Comanda' },
  { value: 'balcao', label: 'Balcão' },
  { value: 'retirada', label: 'Retirada' },
  { value: 'ifood', label: 'iFood' },
  { value: '99food', label: '99Food' },
];

export function Vendas() {
  const qc = useQueryClient();
  const isAdmin = useAuth((s) => s.can('vendas:admin'));
  const [origin, setOrigin] = useState<BoardOrigin | ''>('');
  const [newOrderOpen, setNewOrderOpen] = useState(false);
  const [paying, setPaying] = useState<{ id: number; total: number } | null>(null);
  const [viewingId, setViewingId] = useState<number | null>(null);
  useMinuteTick();

  // Board completo sempre; o filtro de origem é client-side pra deixar os contadores nos chips.
  const { data, isLoading, error } = useQuery({
    queryKey: ['vendas-board'],
    queryFn: () => vendasApi.board(),
    refetchInterval: 15_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['vendas-board'] });
  const ready = useMutation({ mutationFn: vendasApi.ready, onSuccess: invalidate });
  const close = useMutation({ mutationFn: vendasApi.close, onSuccess: invalidate });
  const complete = useMutation({ mutationFn: (id: number) => vendasApi.pay(id), onSuccess: invalidate });
  const cancel = useMutation({
    mutationFn: vendasApi.cancel,
    onSuccess: () => { invalidate(); qc.invalidateQueries({ queryKey: ['vendas-stations'] }); },
  });
  const busy = ready.isPending || close.isPending || complete.isPending || cancel.isPending;
  const mutationError = ready.error || close.error || complete.error || cancel.error;

  const all = data ?? [];
  const activeCount = (o: BoardOrigin | '') => all.filter((c) =>
    c.column !== null && c.column !== 'concluido' && (o === '' || c.origin === o)).length;
  const cards = origin === '' ? all : all.filter((c) => c.origin === origin);
  const cancelled = cards.filter((c) => c.column === null);

  return (
    <div>
      <PageHeader
        title="Vendas"
        subtitle="Balcão, retirada, mesas e comandas — junto com o delivery integrado"
        action={<Button onClick={() => setNewOrderOpen(true)}><Plus size={16} /> Novo pedido</Button>}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const n = activeCount(f.value);
          const active = origin === f.value;
          return (
            <button
              key={f.value || 'todos'}
              type="button"
              onClick={() => setOrigin(f.value)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                active ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {f.label}
              {n > 0 && (
                <span className={`rounded-full px-1.5 text-[10px] font-bold ${active ? 'bg-white/25' : 'bg-slate-200 text-slate-500'}`}>
                  {n}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {isLoading && <Spinner />}
      {error && <ErrorBox message={apiError(error)} />}
      {mutationError && <div className="mb-3"><ErrorBox message={apiError(mutationError)} /></div>}

      {data && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((col) => {
            const colCards = cards.filter((c) => c.column === col.key);
            return (
              <div key={col.key} className={`flex flex-col rounded-xl border-t-4 bg-slate-50/60 p-2 ${col.accent}`}>
                <div className="mb-2 flex items-center justify-between px-1 pt-1">
                  <h3 className="text-sm font-semibold text-slate-700">{col.title}</h3>
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">{colCards.length}</span>
                </div>
                <div className="space-y-3">
                  {colCards.length === 0 && (
                    <div className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-xs text-slate-400">
                      Nenhum pedido
                    </div>
                  )}
                  {colCards.map((c) => (
                    <BoardCardView
                      key={`${c.source}-${c.id}`}
                      card={c}
                      busy={busy}
                      isAdmin={isAdmin}
                      onOpen={() => { if (c.source === 'vendas') setViewingId(c.id); }}
                      onReady={() => ready.mutate(c.id)}
                      onClose={() => close.mutate(c.id)}
                      onComplete={() => complete.mutate(c.id)}
                      onPay={() => setPaying({ id: c.id, total: c.total_amount })}
                      onCancel={() => { if (window.confirm('Cancelar este pedido? O estoque baixado será estornado.')) cancel.mutate(c.id); }}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {cancelled.length > 0 && (
        <details className="mt-6 rounded-xl border border-slate-200 bg-white p-3">
          <summary className="cursor-pointer select-none text-sm font-semibold text-slate-700">
            Cancelados <span className="ml-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">{cancelled.length}</span>
          </summary>
          <div className="mt-3 flex flex-wrap gap-2">
            {cancelled.map((c) => {
              const meta = ORIGIN_META[c.origin];
              return (
                <span key={`${c.source}-${c.id}`} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600">
                  <span className={`rounded px-1.5 py-0.5 font-bold ${meta.cls}`}>{meta.label}</span>
                  <span className="font-medium text-slate-700">{cardTitle(c)}</span>
                  <span>{brl(c.total_amount)}</span>
                </span>
              );
            })}
          </div>
        </details>
      )}

      {newOrderOpen && <NewOrderModal onClose={() => setNewOrderOpen(false)} />}
      {paying && <PaymentModal saleId={paying.id} totalAmount={paying.total} onClose={() => setPaying(null)} />}
      {viewingId !== null && <SaleDetailModal saleId={viewingId} onClose={() => setViewingId(null)} />}
    </div>
  );
}

function BoardCardView({
  card, busy, isAdmin, onOpen, onReady, onClose, onComplete, onPay, onCancel,
}: {
  card: VendasBoardCard;
  busy: boolean;
  isAdmin: boolean;
  onOpen: () => void;
  onReady: () => void;
  onClose: () => void;
  onComplete: () => void;
  onPay: () => void;
  onCancel: () => void;
}) {
  const meta = ORIGIN_META[card.origin];
  const isMesaOrComanda = card.origin === 'mesa' || card.origin === 'comanda';
  const stop = (fn: () => void) => (e: MouseEvent) => { e.stopPropagation(); fn(); };
  const done = card.column === 'concluido';
  // Enviado conta desde a criação; nas demais colunas, desde que ficou pronto.
  const since = card.column === 'enviado' ? card.created_at : (card.ready_at ?? card.created_at);

  return (
    <Card
      className={`p-3 ${card.source === 'vendas' ? 'cursor-pointer transition hover:border-emerald-300 hover:shadow-md' : ''}`}
      onClick={card.source === 'vendas' ? onOpen : undefined}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`rounded px-2 py-0.5 text-xs font-bold ${meta.cls}`}>{meta.label}</span>
          {card.source === 'delivery' ? (
            <Link to={`/delivery/${card.id}`} className="flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline">
              {cardTitle(card)} <ExternalLink size={12} />
            </Link>
          ) : (
            <span className="text-xs font-semibold text-slate-600">{cardTitle(card)}</span>
          )}
        </div>
        {!done && <ElapsedBadge since={since} />}
      </div>

      {card.customer_name && (
        <p className="truncate text-sm font-medium text-slate-800">
          {card.customer_name}
          {card.party_size != null && (
            <span className="ml-2 inline-flex items-center gap-0.5 text-xs font-normal text-slate-500">
              <Users size={11} /> {card.party_size}
            </span>
          )}
        </p>
      )}

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        <span>{card.items_count} {card.items_count === 1 ? 'item' : 'itens'}</span>
        <span className="font-semibold text-slate-700">{brl(card.total_amount)}</span>
        {card.payment_status === 'pending' ? (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-700">Não pago</span>
        ) : (
          card.payment_method && <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700">{PAYMENT_LABEL[card.payment_method]}</span>
        )}
      </div>

      {card.source === 'vendas' && (
        <div className="mt-3 flex flex-wrap gap-2">
          {card.status === 'sent' && (
            <Button className="flex-1 justify-center px-3 py-1.5 text-xs" disabled={busy} onClick={stop(onReady)}>Marcar pronto</Button>
          )}
          {card.status === 'ready' && isMesaOrComanda && (
            <Button className="flex-1 justify-center px-3 py-1.5 text-xs" disabled={busy} onClick={stop(onClose)}>Fechar conta</Button>
          )}
          {card.status === 'ready' && !isMesaOrComanda && (
            <Button className="flex-1 justify-center px-3 py-1.5 text-xs" disabled={busy} onClick={stop(onComplete)}>Entregar</Button>
          )}
          {card.status === 'awaiting_payment' && (
            <Button className="flex-1 justify-center px-3 py-1.5 text-xs" disabled={busy} onClick={stop(onPay)}>Receber pagamento</Button>
          )}
          {isAdmin && !['completed', 'cancelled'].includes(card.status) && (
            <Button variant="ghost" className="px-3 py-1.5 text-xs" disabled={busy} onClick={stop(onCancel)}>Cancelar</Button>
          )}
        </div>
      )}
    </Card>
  );
}
