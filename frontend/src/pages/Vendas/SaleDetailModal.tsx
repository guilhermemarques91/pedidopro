import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Minus, Plus, Trash2, Users } from 'lucide-react';
import { vendasApi } from '../../services/resources';
import { apiError } from '../../services/api';
import { useAuth } from '../../store/auth.store';
import { Button, Modal, Spinner, ErrorBox } from '../../components/ui';
import { brl, datetime } from '../../utils/format';
import { ORIGIN_META, PAYMENT_LABEL, ElapsedBadge } from './shared';
import { PaymentModal } from './PaymentModal';

/** Detalhe de um pedido: itens (por round), status/pagamento e, pra admin, edição item a item + cancelamento. */
export function SaleDetailModal({ saleId, onClose }: { saleId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const isAdmin = useAuth((s) => s.can('vendas:admin'));
  const [paying, setPaying] = useState(false);

  const { data: sale, isLoading, error } = useQuery({
    queryKey: ['vendas-sale', saleId],
    queryFn: () => vendasApi.get(saleId),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['vendas-board'] });
    qc.invalidateQueries({ queryKey: ['vendas-sale', saleId] });
    qc.invalidateQueries({ queryKey: ['vendas-stations'] });
  };
  const ready = useMutation({ mutationFn: () => vendasApi.ready(saleId), onSuccess: invalidate });
  const close = useMutation({ mutationFn: () => vendasApi.close(saleId), onSuccess: invalidate });
  const reopen = useMutation({ mutationFn: () => vendasApi.reopen(saleId), onSuccess: invalidate });
  const complete = useMutation({ mutationFn: () => vendasApi.pay(saleId), onSuccess: invalidate });
  const cancel = useMutation({ mutationFn: () => vendasApi.cancel(saleId), onSuccess: invalidate });
  const updateItem = useMutation({
    mutationFn: (v: { itemId: number; quantity: number }) => vendasApi.updateItem(saleId, v.itemId, v.quantity),
    onSuccess: invalidate,
  });
  const removeItem = useMutation({
    mutationFn: (itemId: number) => vendasApi.removeItem(saleId, itemId),
    onSuccess: invalidate,
  });

  const busy = ready.isPending || close.isPending || reopen.isPending || complete.isPending || cancel.isPending
    || updateItem.isPending || removeItem.isPending;
  const mutationError = ready.error || close.error || reopen.error || complete.error || cancel.error
    || updateItem.error || removeItem.error;

  const title = sale
    ? (sale.station_kind
      ? `${sale.station_kind === 'mesa' ? 'Mesa' : 'Comanda'} ${sale.station_number}${sale.station_label ? ` (${sale.station_label})` : ''}`
      : sale.daily_number ? `Senha #${sale.daily_number}` : `Pedido #${sale.id}`)
    : 'Pedido';

  const editable = !!sale && !['completed', 'cancelled'].includes(sale.status);
  const isMesaOrComanda = sale?.origin === 'mesa' || sale?.origin === 'comanda';
  const multiRound = !!sale && new Set(sale.items.map((i) => i.round_no)).size > 1;

  return (
    <Modal title={title} onClose={onClose} size="xl">
      {isLoading && <Spinner />}
      {error && <ErrorBox message={apiError(error)} />}
      {mutationError && <div className="mb-3"><ErrorBox message={apiError(mutationError)} /></div>}

      {sale && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className={`rounded px-2 py-0.5 text-xs font-bold ${ORIGIN_META[sale.origin].cls}`}>{ORIGIN_META[sale.origin].label}</span>
            {editable && <ElapsedBadge since={sale.created_at} />}
            <span className="text-slate-500">Aberto em {datetime(sale.created_at)}</span>
            {sale.payment_status === 'pending' ? (
              <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">Não pago</span>
            ) : (
              <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                Pago{sale.payment_method ? ` · ${PAYMENT_LABEL[sale.payment_method]}` : ''}
              </span>
            )}
            {(sale.customer_name || sale.party_size != null) && (
              <span className="flex items-center gap-1.5 text-slate-600">
                {sale.customer_name && <span className="font-medium">{sale.customer_name}</span>}
                {sale.party_size != null && (
                  <span className="flex items-center gap-0.5 text-slate-500"><Users size={12} /> {sale.party_size}</span>
                )}
              </span>
            )}
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Item</th>
                  <th className="px-3 py-2 font-medium">Qtd</th>
                  <th className="px-3 py-2 text-right font-medium">Preço</th>
                  <th className="px-3 py-2 text-right font-medium">Subtotal</th>
                  {editable && isAdmin && <th className="px-3 py-2" />}
                </tr>
              </thead>
              <tbody>
                {sale.items.map((it, idx) => {
                  const firstOfRound = multiRound && (idx === 0 || sale.items[idx - 1].round_no !== it.round_no);
                  return [
                    firstOfRound && (
                      <tr key={`round-${it.round_no}`} className="border-t border-slate-100 bg-slate-50/60">
                        <td colSpan={editable && isAdmin ? 5 : 4} className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                          {it.round_no === 1 ? '1º envio' : `${it.round_no}º envio`}{it.sent_at ? ` · ${datetime(it.sent_at)}` : ''}
                        </td>
                      </tr>
                    ),
                    <tr key={it.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 text-slate-800">
                        {it.product_name}
                        {(it.variation.length > 0 || it.removed.length > 0 || it.notes) && (
                          <div className="mt-0.5 space-y-0.5 text-[11px] leading-tight">
                            {it.variation.map((v) => (
                              <p key={v.option_id} className="text-emerald-700">{v.group_name}: {v.option_name}</p>
                            ))}
                            {it.removed.map((r, ri) => (
                              <p key={`${r.component_id}-${ri}`} className="text-red-600">Sem {r.name}</p>
                            ))}
                            {it.notes && <p className="italic text-slate-500">{it.notes}</p>}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {editable && isAdmin ? (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                if (Number(it.quantity) <= 1) {
                                  if (window.confirm(`Remover "${it.product_name}" do pedido?`)) removeItem.mutate(it.id);
                                } else {
                                  updateItem.mutate({ itemId: it.id, quantity: Number(it.quantity) - 1 });
                                }
                              }}
                              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
                            >
                              <Minus size={14} />
                            </button>
                            <span className="w-6 text-center font-medium">{it.quantity}</span>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => updateItem.mutate({ itemId: it.id, quantity: Number(it.quantity) + 1 })}
                              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
                            >
                              <Plus size={14} />
                            </button>
                          </div>
                        ) : it.quantity}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-600">{brl(it.unit_price)}</td>
                      <td className="px-3 py-2 text-right font-medium text-slate-700">{brl(it.subtotal)}</td>
                      {editable && isAdmin && (
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            disabled={busy}
                            title="Remover item"
                            onClick={() => { if (window.confirm(`Remover "${it.product_name}" do pedido?`)) removeItem.mutate(it.id); }}
                            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      )}
                    </tr>,
                  ];
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-sm font-semibold text-slate-800">
            <span>Total</span>
            <span className="text-lg">{brl(sale.total_amount)}</span>
          </div>

          {sale.payments.length > 0 && (
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Pagamento</p>
              {sale.payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between">
                  <span>{PAYMENT_LABEL[p.method]}</span>
                  <span className="font-medium text-slate-700">{brl(p.amount)}</span>
                </div>
              ))}
            </div>
          )}

          {editable && (
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
              {sale.status === 'sent' && <Button disabled={busy} onClick={() => ready.mutate()}>Marcar pronto</Button>}
              {sale.status === 'ready' && isMesaOrComanda && <Button disabled={busy} onClick={() => close.mutate()}>Fechar conta</Button>}
              {sale.status === 'ready' && !isMesaOrComanda && sale.payment_status === 'paid' && (
                <Button disabled={busy} onClick={() => complete.mutate()}>Entregar</Button>
              )}
              {(sale.status === 'ready' || sale.status === 'awaiting_payment') && sale.payment_status === 'pending' && (
                <Button disabled={busy} onClick={() => setPaying(true)}>Receber pagamento</Button>
              )}
              {sale.status === 'awaiting_payment' && isMesaOrComanda && (
                <Button variant="secondary" disabled={busy} onClick={() => reopen.mutate()}>Reabrir conta</Button>
              )}
              {isAdmin && (
                <Button
                  variant="ghost"
                  className="ml-auto text-red-600"
                  disabled={busy}
                  onClick={() => { if (window.confirm('Cancelar este pedido? O estoque baixado será estornado.')) cancel.mutate(); }}
                >
                  Cancelar pedido
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {paying && sale && (
        <PaymentModal saleId={sale.id} totalAmount={Number(sale.total_amount)} onClose={() => setPaying(false)} />
      )}
    </Modal>
  );
}
