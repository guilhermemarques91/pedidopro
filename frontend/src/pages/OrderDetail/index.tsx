import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Send, Check, X, PackageCheck, Ban, MessageCircle, Plus, Trash2, Copy } from 'lucide-react';
import { ordersApi, itemsApi } from '../../services/resources';
import { apiError } from '../../services/api';
import { useAuth } from '../../store/auth.store';
import { brl, datetime, parseNum, numToInput } from '../../utils/format';
import type { OrderItem } from '../../types';
import { Button, Card, Spinner, ErrorBox, Badge, Input, Select } from '../../components/ui';

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
  const [msgBox, setMsgBox] = useState<{ message: string; whatsapp_number: string | null } | null>(null);
  const [copied, setCopied] = useState(false);
  const fetchMsg = useMutation({
    mutationFn: () => ordersApi.message(oid),
    onSuccess: (d) => { setMsgBox(d); setCopied(false); },
  });
  // Se a Evolution falhar (ex.: 502), mostra a mensagem automaticamente para copiar/colar.
  useEffect(() => {
    if (send.isError && !msgBox && !fetchMsg.isPending) fetchMsg.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [send.isError]);
  const receive = useMutation({ mutationFn: () => ordersApi.receive(oid), onSuccess: invalidate });
  const cancel = useMutation({ mutationFn: () => ordersApi.cancel(oid), onSuccess: invalidate });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox message={apiError(error)} />;
  if (!data) return null;

  const busy = [submit, approve, reject, send, receive, cancel].some((m) => m.isPending);
  const mutError = [submit, approve, reject, send, receive, cancel].find((m) => m.error)?.error;

  // Edição liberada apenas em rascunho (o backend bloqueia após submissão).
  const editable = data.status === 'draft' && isBuyer;

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
          {isBuyer && data.order_type === 'whatsapp' && ['approved', 'sent'].includes(data.status) && (
            <Button variant="secondary" onClick={() => fetchMsg.mutate()} disabled={fetchMsg.isPending}>
              <Copy size={16} /> Gerar mensagem
            </Button>
          )}
          {isBuyer && data.status === 'sent' && <Button onClick={() => receive.mutate()} disabled={busy}><PackageCheck size={16} /> Marcar recebido</Button>}
          {isBuyer && !['received', 'cancelled'].includes(data.status) && <Button variant="ghost" onClick={() => confirm('Cancelar pedido?') && cancel.mutate()} disabled={busy}><Ban size={16} /> Cancelar</Button>}
        </div>
      </div>

      {mutError && <div className="mb-4"><ErrorBox message={apiError(mutError)} /></div>}
      {send.data?.whatsappSent && <div className="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">✅ Pedido enviado pelo WhatsApp!</div>}

      {msgBox && (
        <Card className="mb-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">Mensagem do pedido</h3>
            <button onClick={() => setMsgBox(null)} className="text-slate-300 hover:text-slate-600"><X size={16} /></button>
          </div>
          {send.isError && (
            <p className="text-sm text-amber-700">
              O envio automático falhou. Copie a mensagem abaixo e cole no WhatsApp do fornecedor.
            </p>
          )}
          <textarea
            readOnly
            value={msgBox.message}
            rows={Math.min(16, msgBox.message.split('\n').length + 1)}
            className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-700 outline-none"
            onFocus={(e) => e.currentTarget.select()}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => { navigator.clipboard.writeText(msgBox.message); setCopied(true); }}
            >
              <Copy size={16} /> {copied ? 'Copiado!' : 'Copiar mensagem'}
            </Button>
            {msgBox.whatsapp_number && (
              <a
                href={`https://wa.me/${msgBox.whatsapp_number.replace(/\D/g, '')}?text=${encodeURIComponent(msgBox.message)}`}
                target="_blank"
                rel="noreferrer"
              >
                <Button><MessageCircle size={16} /> Abrir WhatsApp</Button>
              </a>
            )}
          </div>
        </Card>
      )}

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
                {editable && <th className="px-5 py-3" />}
              </tr>
            </thead>
            <tbody>
              {data.items.map((it) =>
                editable
                  ? <EditableItemRow key={it.id} oid={oid} item={it} onChanged={invalidate} />
                  : (
                    <tr key={it.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-5 py-3 font-medium text-slate-800">{it.item_name} <span className="text-xs text-slate-400">({it.unit})</span></td>
                      <td className="px-5 py-3 text-right text-slate-600">{Number(it.quantity)}</td>
                      <td className="px-5 py-3 text-right text-slate-600">{brl(it.unit_price)}</td>
                      <td className="px-5 py-3 text-right font-medium text-slate-800">{brl(it.subtotal)}</td>
                    </tr>
                  )
              )}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200">
                <td colSpan={3} className="px-5 py-3 text-right font-medium text-slate-600">Total</td>
                <td className="px-5 py-3 text-right text-lg font-bold text-emerald-700">{brl(data.total_amount)}</td>
                {editable && <td />}
              </tr>
            </tfoot>
          </table>
          {editable && <AddItemRow oid={oid} supplierId={data.supplier_id} onChanged={invalidate} />}
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
            {editable
              ? <NotesEditor oid={oid} initial={data.notes ?? ''} onChanged={invalidate} />
              : data.notes && <p className="mt-3 border-t border-slate-100 pt-3 text-sm text-slate-600">{data.notes}</p>}
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

/** Linha de item editável (qtd/preço salvam ao sair do campo) — só em rascunho. */
function EditableItemRow({ oid, item, onChanged }: { oid: number; item: OrderItem; onChanged: () => void }) {
  const [qty, setQty] = useState(numToInput(item.quantity));
  const [price, setPrice] = useState(numToInput(item.unit_price));

  const update = useMutation({
    mutationFn: (body: { quantity?: number; unit_price?: number }) => ordersApi.updateItem(oid, item.id, body),
    onSuccess: onChanged,
  });
  const remove = useMutation({
    mutationFn: () => ordersApi.removeItem(oid, item.id),
    onSuccess: onChanged,
  });

  function saveQty() {
    const n = parseNum(qty);
    if (n !== null && n !== Number(item.quantity)) update.mutate({ quantity: n });
  }
  function savePrice() {
    const n = parseNum(price);
    if (n !== null && n !== Number(item.unit_price)) update.mutate({ unit_price: n });
  }

  return (
    <tr className="border-b border-slate-100 last:border-0">
      <td className="px-5 py-2 font-medium text-slate-800">{item.item_name} <span className="text-xs text-slate-400">({item.unit})</span></td>
      <td className="px-3 py-2 text-right">
        <Input value={qty} onChange={(e) => setQty(e.target.value)} onBlur={saveQty} className="w-20 text-right" />
      </td>
      <td className="px-3 py-2 text-right">
        <Input value={price} onChange={(e) => setPrice(e.target.value)} onBlur={savePrice} className="w-24 text-right" />
      </td>
      <td className="px-5 py-2 text-right font-medium text-slate-800">{brl(item.subtotal)}</td>
      <td className="px-3 py-2 text-right">
        <button onClick={() => remove.mutate()} className="text-slate-400 hover:text-red-600" disabled={remove.isPending}><Trash2 size={16} /></button>
      </td>
    </tr>
  );
}

/** Formulário para adicionar um item ao pedido (fornecedor fixo do pedido). */
function AddItemRow({ oid, supplierId, onChanged }: { oid: number; supplierId: number; onChanged: () => void }) {
  const { data: items } = useQuery({ queryKey: ['items', supplierId], queryFn: () => itemsApi.list(supplierId) });
  const [itemId, setItemId] = useState('');
  const [qty, setQty] = useState('1');
  const [price, setPrice] = useState('');
  const [error, setError] = useState('');

  const add = useMutation({
    mutationFn: () => ordersApi.addItem(oid, {
      item_id: Number(itemId), quantity: parseNum(qty) ?? 0, unit_price: parseNum(price) ?? 0,
    }),
    onSuccess: () => { setItemId(''); setQty('1'); setPrice(''); setError(''); onChanged(); },
    onError: (e) => setError(apiError(e)),
  });

  function pick(id: string) {
    setItemId(id);
    const it = items?.find((x) => x.id === Number(id));
    if (it?.base_price) setPrice(numToInput(it.base_price));
  }

  return (
    <div className="border-t border-slate-200 p-4">
      {error && <div className="mb-2"><ErrorBox message={error} /></div>}
      <div className="grid grid-cols-12 items-center gap-2">
        <Select value={itemId} onChange={(e) => pick(e.target.value)} className="col-span-6">
          <option value="">+ adicionar item…</option>
          {items?.map((it) => <option key={it.id} value={it.id}>{it.name} ({it.unit})</option>)}
        </Select>
        <Input value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Qtd" className="col-span-2" />
        <Input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Preço" className="col-span-3" />
        <button
          onClick={() => itemId && add.mutate()}
          disabled={!itemId || add.isPending}
          className="col-span-1 flex justify-center text-emerald-600 hover:text-emerald-700 disabled:opacity-40"
        >
          <Plus size={18} />
        </button>
      </div>
    </div>
  );
}

/** Editor das observações do pedido. */
function NotesEditor({ oid, initial, onChanged }: { oid: number; initial: string; onChanged: () => void }) {
  const [notes, setNotes] = useState(initial);
  const save = useMutation({
    mutationFn: () => ordersApi.update(oid, { notes }),
    onSuccess: onChanged,
  });
  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <span className="mb-1 block text-sm font-medium text-slate-700">Observações</span>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => notes !== initial && save.mutate()}
        rows={2}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
        placeholder="Observações do pedido…"
      />
    </div>
  );
}
