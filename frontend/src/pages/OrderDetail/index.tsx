import { useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Send, Check, X, PackageCheck, Ban, MessageCircle } from 'lucide-react';
import { ordersApi } from '../../services/resources';
import { apiError } from '../../services/api';
import { useAuth } from '../../store/auth.store';
import { brl, datetime } from '../../utils/format';
import { Button, Card, Spinner, ErrorBox, Badge } from '../../components/ui';

export function OrderDetailPage() {
  const { id } = useParams();
  const oid = Number(id);
  const qc = useQueryClient();
  const isBuyer = useAuth((s) => s.hasRole('admin', 'buyer'));
  const isApprover = useAuth((s) => s.hasRole('admin', 'approver'));

  const { data, isLoading, error } = useQuery({ queryKey: ['order', oid], queryFn: () => ordersApi.get(oid) });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['order', oid] });
    qc.invalidateQueries({ queryKey: ['orders'] });
  };

  const submit = useMutation({ mutationFn: () => ordersApi.submit(oid), onSuccess: invalidate });
  const approve = useMutation({ mutationFn: () => ordersApi.approve(oid), onSuccess: invalidate });
  const reject = useMutation({ mutationFn: (c: string) => ordersApi.reject(oid, c), onSuccess: invalidate });
  const send = useMutation({ mutationFn: () => ordersApi.send(oid), onSuccess: invalidate });
  const receive = useMutation({ mutationFn: () => ordersApi.receive(oid), onSuccess: invalidate });
  const cancel = useMutation({ mutationFn: () => ordersApi.cancel(oid), onSuccess: invalidate });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox message={apiError(error)} />;
  if (!data) return null;

  const busy = [submit, approve, reject, send, receive, cancel].some((m) => m.isPending);
  const mutError = [submit, approve, reject, send, receive, cancel].find((m) => m.error)?.error;

  return (
    <div>
      <Link to="/orders" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"><ArrowLeft size={16} /> Pedidos</Link>
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-slate-800">Pedido #{data.id}</h1>
          <Badge status={data.status} />
        </div>
        <div className="flex flex-wrap gap-2">
          {isBuyer && data.status === 'draft' && <Button onClick={() => submit.mutate()} disabled={busy}><Send size={16} /> Enviar p/ aprovação</Button>}
          {isApprover && data.status === 'pending_approval' && (
            <>
              <Button onClick={() => approve.mutate()} disabled={busy}><Check size={16} /> Aprovar</Button>
              <Button variant="danger" onClick={() => { const c = prompt('Motivo da rejeição (opcional):') ?? ''; reject.mutate(c); }} disabled={busy}><X size={16} /> Rejeitar</Button>
            </>
          )}
          {isBuyer && data.status === 'approved' && (
            <Button onClick={() => send.mutate()} disabled={busy}>
              {data.order_type === 'whatsapp' ? <MessageCircle size={16} /> : <Send size={16} />} Enviar ao fornecedor
            </Button>
          )}
          {isBuyer && data.status === 'sent' && <Button onClick={() => receive.mutate()} disabled={busy}><PackageCheck size={16} /> Marcar recebido</Button>}
          {isBuyer && !['received', 'cancelled'].includes(data.status) && <Button variant="ghost" onClick={() => confirm('Cancelar pedido?') && cancel.mutate()} disabled={busy}><Ban size={16} /> Cancelar</Button>}
        </div>
      </div>

      {mutError && <div className="mb-4"><ErrorBox message={apiError(mutError)} /></div>}
      {send.data?.whatsappSent && <div className="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">✅ Pedido enviado pelo WhatsApp!</div>}

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-2 p-0">
          <h3 className="px-5 pt-4 text-lg font-semibold text-slate-800">Itens</h3>
          <table className="mt-3 w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Item</th>
                <th className="px-5 py-3 font-medium text-right">Qtd</th>
                <th className="px-5 py-3 font-medium text-right">Unit.</th>
                <th className="px-5 py-3 font-medium text-right">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((it) => (
                <tr key={it.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-5 py-3 font-medium text-slate-800">{it.item_name} <span className="text-xs text-slate-400">({it.unit})</span></td>
                  <td className="px-5 py-3 text-right text-slate-600">{Number(it.quantity)}</td>
                  <td className="px-5 py-3 text-right text-slate-600">{brl(it.unit_price)}</td>
                  <td className="px-5 py-3 text-right font-medium text-slate-800">{brl(it.subtotal)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200">
                <td colSpan={3} className="px-5 py-3 text-right font-medium text-slate-600">Total</td>
                <td className="px-5 py-3 text-right text-lg font-bold text-emerald-700">{brl(data.total_amount)}</td>
              </tr>
            </tfoot>
          </table>
        </Card>

        <div className="space-y-6">
          <Card>
            <h3 className="mb-3 text-sm font-semibold text-slate-800">Informações</h3>
            <dl className="space-y-2 text-sm">
              <Row label="Fornecedor" value={data.supplier_name} />
              <Row label="Tipo" value={data.order_type === 'whatsapp' ? 'WhatsApp' : 'Portal'} />
              <Row label="Criado por" value={data.created_by_name} />
              <Row label="Aprovado por" value={data.approved_by_name ?? '—'} />
              <Row label="Enviado em" value={datetime(data.sent_at)} />
              <Row label="Recebido em" value={datetime(data.received_at)} />
            </dl>
            {data.notes && <p className="mt-3 border-t border-slate-100 pt-3 text-sm text-slate-600">{data.notes}</p>}
          </Card>

          {data.approvals.length > 0 && (
            <Card>
              <h3 className="mb-3 text-sm font-semibold text-slate-800">Histórico de aprovação</h3>
              <ul className="space-y-2 text-sm">
                {data.approvals.map((a) => (
                  <li key={a.id} className="border-b border-slate-100 pb-2 last:border-0">
                    <span className={a.action === 'approved' ? 'text-emerald-700' : 'text-red-700'}>
                      {a.action === 'approved' ? '✓ Aprovado' : '✗ Rejeitado'}
                    </span> por {a.user_name}
                    <div className="text-xs text-slate-400">{datetime(a.created_at)}</div>
                    {a.comment && <p className="mt-1 text-slate-600">"{a.comment}"</p>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-700">{value ?? '—'}</dd>
    </div>
  );
}
