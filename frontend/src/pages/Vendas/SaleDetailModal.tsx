import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { vendasApi } from '../../services/resources';
import { apiError } from '../../services/api';
import { useAuth } from '../../store/auth.store';
import type { PaymentMethod } from '../../types';
import { Button, Field, Select, Modal, Spinner, ErrorBox } from '../../components/ui';
import { brl, datetime } from '../../utils/format';
import { ORIGIN_META } from './shared';

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'debito', label: 'Cartão de débito' },
  { value: 'credito', label: 'Cartão de crédito' },
  { value: 'pix', label: 'Pix' },
  { value: 'outro', label: 'Outro' },
];

/** Detalhe de um pedido: itens, status/pagamento e, pra admin, edição item a item + cancelamento. */
export function SaleDetailModal({ saleId, onClose }: { saleId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const isAdmin = useAuth((s) => s.can('vendas:admin'));
  const [payMethod, setPayMethod] = useState<PaymentMethod>('dinheiro');

  const { data: sale, isLoading, error } = useQuery({
    queryKey: ['vendas-sale', saleId],
    queryFn: () => vendasApi.get(saleId),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['vendas-board'] });
    qc.invalidateQueries({ queryKey: ['vendas-sale', saleId] });
  };
  const ready = useMutation({ mutationFn: () => vendasApi.ready(saleId), onSuccess: invalidate });
  const close = useMutation({ mutationFn: () => vendasApi.close(saleId), onSuccess: invalidate });
  const pay = useMutation({ mutationFn: (method?: PaymentMethod) => vendasApi.pay(saleId, method), onSuccess: invalidate });
  const cancel = useMutation({
    mutationFn: () => vendasApi.cancel(saleId),
    onSuccess: () => { invalidate(); qc.invalidateQueries({ queryKey: ['vendas-stations'] }); },
  });
  const updateItem = useMutation({
    mutationFn: (v: { itemId: number; quantity: number }) => vendasApi.updateItem(saleId, v.itemId, v.quantity),
    onSuccess: invalidate,
  });
  const removeItem = useMutation({
    mutationFn: (itemId: number) => vendasApi.removeItem(saleId, itemId),
    onSuccess: () => { invalidate(); qc.invalidateQueries({ queryKey: ['vendas-stations'] }); },
  });

  const busy = ready.isPending || close.isPending || pay.isPending || cancel.isPending
    || updateItem.isPending || removeItem.isPending;
  const mutationError = ready.error || close.error || pay.error || cancel.error || updateItem.error || removeItem.error;

  const title = sale
    ? (sale.station_kind
      ? `${sale.station_kind === 'mesa' ? 'Mesa' : 'Comanda'} ${sale.station_number}${sale.station_label ? ` (${sale.station_label})` : ''}`
      : sale.daily_number ? `Senha #${sale.daily_number}` : `Pedido #${sale.id}`)
    : 'Pedido';

  const editable = !!sale && !['completed', 'cancelled'].includes(sale.status);
  const isMesaOrComanda = sale?.origin === 'mesa' || sale?.origin === 'comanda';

  return (
    <Modal title={title} onClose={onClose} size="xl">
      {isLoading && <Spinner />}
      {error && <ErrorBox message={apiError(error)} />}
      {mutationError && <div className="mb-3"><ErrorBox message={apiError(mutationError)} /></div>}

      {sale && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className={`rounded px-2 py-0.5 text-xs font-bold ${ORIGIN_META[sale.origin].cls}`}>{ORIGIN_META[sale.origin].label}</span>
            <span className="text-slate-500">Enviado em {datetime(sale.created_at)}</span>
            {sale.payment_status === 'pending' ? (
              <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">Pagamento pendente</span>
            ) : (
              <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                Pago{sale.payment_method ? ` (${sale.payment_method})` : ''}
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
                {sale.items.map((it) => (
                  <tr key={it.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 text-slate-800">{it.product_name}</td>
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
                            className="text-slate-400 hover:text-slate-700 disabled:opacity-40"
                          >
                            <Minus size={14} />
                          </button>
                          <span className="w-6 text-center font-medium">{it.quantity}</span>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => updateItem.mutate({ itemId: it.id, quantity: Number(it.quantity) + 1 })}
                            className="text-slate-400 hover:text-slate-700 disabled:opacity-40"
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
                          className="text-slate-400 hover:text-red-600 disabled:opacity-40"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-sm font-semibold text-slate-800">
            <span>Total</span>
            <span>{brl(sale.total_amount)}</span>
          </div>

          {editable && (
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
              {sale.status === 'sent' && <Button disabled={busy} onClick={() => ready.mutate()}>Pronto</Button>}
              {sale.status === 'ready' && isMesaOrComanda && <Button disabled={busy} onClick={() => close.mutate()}>Fechar conta</Button>}
              {sale.status === 'ready' && !isMesaOrComanda && sale.payment_status === 'paid' && (
                <Button disabled={busy} onClick={() => pay.mutate(undefined)}>Concluir</Button>
              )}
              {(sale.status === 'ready' || sale.status === 'awaiting_payment') && sale.payment_status === 'pending' && (
                <div className="flex items-end gap-2">
                  <Field label="Forma de pagamento">
                    <Select value={payMethod} onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}>
                      {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </Select>
                  </Field>
                  <Button disabled={busy} onClick={() => pay.mutate(payMethod)}>Receber pagamento</Button>
                </div>
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
    </Modal>
  );
}
