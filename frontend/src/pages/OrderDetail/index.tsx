import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Send, Check, X, PackageCheck, Ban, MessageCircle, Plus, Trash2, Copy, AlertTriangle } from 'lucide-react';
import { ordersApi, itemsApi } from '../../services/resources';
import { buildOrderItemOptions, resolveOrderItemId } from '../../services/resolveOrderItem';
import { apiError } from '../../services/api';
import { useAuth } from '../../store/auth.store';
import { brl, datetime, parseNum, numToInput } from '../../utils/format';
import type { OrderItem } from '../../types';
import { Button, Card, Spinner, ErrorBox, Badge, Input, Combobox, ComboOption } from '../../components/ui';

export function OrderDetailPage() {
  const { id } = useParams();
  const oid = Number(id);
  const qc = useQueryClient();
  const isBuyer = useAuth((s) => s.can('compras:write'));
  const isApprover = useAuth((s) => s.can('compras:approve'));

  const { data, isLoading, error } = useQuery({ queryKey: ['order', oid], queryFn: () => ordersApi.get(oid) });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['order', oid] });
    qc.invalidateQueries({ queryKey: ['orders'] });
  };

  const submit = useMutation({ mutationFn: () => ordersApi.submit(oid), onSuccess: invalidate });
  const approve = useMutation({ mutationFn: () => ordersApi.approve(oid), onSuccess: invalidate });
  const reject = useMutation({ mutationFn: (c: string) => ordersApi.reject(oid, c), onSuccess: invalidate });
  // Envio real (Evolution API manda mensagem de verdade pro WhatsApp do fornecedor) só
  // dispara depois de confirmar — closeSendBox também limpa o estado de "isso é uma
  // pré-confirmação de envio", senão fechar a prévia e reabrir por "Gerar mensagem"
  // continuaria mostrando o botão de confirmar envio por engano.
  const send = useMutation({
    mutationFn: () => ordersApi.send(oid),
    onSuccess: () => { invalidate(); setPendingSend(false); setMsgBox(null); },
  });
  const [msgBox, setMsgBox] = useState<{ message: string; whatsapp_number: string | null } | null>(null);
  const [pendingSend, setPendingSend] = useState(false);
  const [copied, setCopied] = useState(false);
  const fetchMsg = useMutation({
    mutationFn: () => ordersApi.message(oid),
    onSuccess: (d) => { setMsgBox(d); setCopied(false); },
  });
  const closeMsgBox = () => { setMsgBox(null); setPendingSend(false); };
  // Se a Evolution falhar (ex.: 502), mostra a mensagem automaticamente para copiar/colar.
  useEffect(() => {
    if (send.isError && !msgBox && !fetchMsg.isPending) fetchMsg.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [send.isError]);
  const cancel = useMutation({ mutationFn: () => ordersApi.cancel(oid), onSuccess: invalidate });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox message={apiError(error)} />;
  if (!data) return null;

  const busy = [submit, approve, reject, send, cancel, fetchMsg].some((m) => m.isPending);
  const mutError = [submit, approve, reject, send, cancel, fetchMsg].find((m) => m.error)?.error;

  // Edição liberada apenas em rascunho (o backend bloqueia após submissão).
  const editable = data.status === 'draft' && isBuyer;
  // Preço não é obrigatório na alocação da lista de compras — sem este aviso, um pedido
  // com item a R$0 já passou por aprovação/envio/recebimento inteiro sem ninguém notar.
  const hasZeroPrice = data.items.some((it) => Number(it.unit_price) <= 0);

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
              <Button
                onClick={() => {
                  if (!hasZeroPrice || confirm('Este pedido tem item(ns) sem preço (R$ 0,00). Aprovar mesmo assim?')) approve.mutate();
                }}
                disabled={busy}
              >
                <Check size={16} /> Aprovar
              </Button>
              <Button variant="danger" onClick={() => { const c = prompt('Motivo da rejeição (opcional):') ?? ''; reject.mutate(c); }} disabled={busy}><X size={16} /> Rejeitar</Button>
            </>
          )}
          {isBuyer && data.status === 'approved' && (
            <Button
              onClick={() => {
                // Mensagem de WhatsApp é real (Evolution API) — mostra a prévia e exige
                // confirmação explícita antes de mandar, em vez de disparar no primeiro clique.
                if (data.order_type === 'whatsapp') { setPendingSend(true); fetchMsg.mutate(); }
                else if (confirm(`Enviar o pedido #${data.id} para ${data.supplier_name}? O fornecedor será avisado.`)) send.mutate();
              }}
              disabled={busy}
            >
              {data.order_type === 'whatsapp' ? <MessageCircle size={16} /> : <Send size={16} />} Enviar ao fornecedor
            </Button>
          )}
          {isBuyer && data.order_type === 'whatsapp' && ['approved', 'sent'].includes(data.status) && (
            <Button variant="secondary" onClick={() => fetchMsg.mutate()} disabled={fetchMsg.isPending}>
              <Copy size={16} /> Gerar mensagem
            </Button>
          )}
          {/* O recebimento deixou de ser um botão de tudo-ou-nada: o pedido enviado gera uma
              entrada de mercadoria, e é lá — com a nota do fornecedor na mão — que se
              confere quantidade e preço antes de mexer no estoque. */}
          {isBuyer && ['sent', 'partially_received'].includes(data.status) && (
            <Link to={`/estoque/entradas?pedido=${oid}`}>
              <Button disabled={busy}><PackageCheck size={16} /> Conferir entrada</Button>
            </Link>
          )}
          {isBuyer && !['received', 'cancelled'].includes(data.status) && <Button variant="ghost" onClick={() => confirm('Cancelar pedido?') && cancel.mutate()} disabled={busy}><Ban size={16} /> Cancelar</Button>}
        </div>
      </div>

      {mutError && <div className="mb-4"><ErrorBox message={apiError(mutError)} /></div>}
      {send.data?.whatsappSent && <div className="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">✅ Pedido enviado pelo WhatsApp!</div>}

      {hasZeroPrice && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <p>Este pedido tem item(ns) sem preço (R$ 0,00) — confira as linhas destacadas antes de seguir.</p>
        </div>
      )}

      {msgBox && (
        <Card className="mb-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">
              {pendingSend ? 'Confirmar mensagem antes de enviar' : 'Mensagem do pedido'}
            </h3>
            <button onClick={closeMsgBox} className="text-slate-300 hover:text-slate-600"><X size={16} /></button>
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
                <Button variant={pendingSend ? 'secondary' : 'primary'}><MessageCircle size={16} /> Abrir WhatsApp</Button>
              </a>
            )}
            {pendingSend && (
              <Button onClick={() => send.mutate()} disabled={send.isPending}>
                <Send size={16} /> {send.isPending ? 'Enviando…' : 'Confirmar e enviar'}
              </Button>
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
                    <tr key={it.id} className={`border-b border-slate-100 last:border-0 ${Number(it.unit_price) <= 0 ? 'bg-rose-50/60' : ''}`}>
                      <td className="px-5 py-3 font-medium text-slate-800">{it.item_name} <span className="text-xs text-slate-400">({it.unit})</span></td>
                      <td className="px-5 py-3 text-right text-slate-600">{Number(it.quantity)}</td>
                      <td className="px-5 py-3 text-right text-slate-600">
                        {Number(it.unit_price) <= 0
                          ? <span className="font-medium text-rose-700" title="Sem preço lançado">{brl(it.unit_price)}</span>
                          : brl(it.unit_price)}
                      </td>
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
              {data.purchase_request_id && (
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Gerado da lista</dt>
                  <dd className="text-right font-medium">
                    <Link to={`/requests/${data.purchase_request_id}`} className="text-emerald-700 hover:underline">
                      Lista #{data.purchase_request_id}
                    </Link>
                  </dd>
                </div>
              )}
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

  const zeroPrice = (parseNum(price) ?? 0) <= 0;

  return (
    <tr className={`border-b border-slate-100 last:border-0 ${zeroPrice ? 'bg-rose-50/60' : ''}`}>
      <td className="px-5 py-2 font-medium text-slate-800">{item.item_name} <span className="text-xs text-slate-400">({item.unit})</span></td>
      <td className="px-3 py-2 text-right">
        <Input value={qty} onChange={(e) => setQty(e.target.value)} onBlur={saveQty} className="w-20 text-right" />
      </td>
      <td className="px-3 py-2 text-right">
        <Input
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          onBlur={savePrice}
          title={zeroPrice ? 'Sem preço lançado' : undefined}
          className={`w-24 text-right ${zeroPrice ? 'border-rose-300' : ''}`}
        />
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
  const qc = useQueryClient();
  const { data: supplierItems } = useQuery({ queryKey: ['items', supplierId], queryFn: () => itemsApi.list(supplierId) });
  const { data: allItems } = useQuery({ queryKey: ['items', undefined], queryFn: () => itemsApi.list() });
  const { options, priceByValue } = buildOrderItemOptions(supplierItems, allItems);
  const [created, setCreated] = useState<ComboOption[]>([]);
  const itemOptions = [...options, ...created].sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  const [sel, setSel] = useState('');
  const [qty, setQty] = useState('1');
  const [price, setPrice] = useState('');
  const [error, setError] = useState('');

  const add = useMutation({
    mutationFn: async () => {
      const p = parseNum(price) ?? 0;
      const item_id = await resolveOrderItemId(sel, { supplierId, price: p });
      return ordersApi.addItem(oid, { item_id, quantity: parseNum(qty) ?? 0, unit_price: p });
    },
    onSuccess: () => {
      setSel(''); setCreated([]); setQty('1'); setPrice(''); setError('');
      qc.invalidateQueries({ queryKey: ['items'] });
      onChanged();
    },
    onError: (e) => setError(apiError(e)),
  });

  function pick(value: string) {
    setSel(value);
    const pv = priceByValue.get(value);
    if (pv != null) setPrice(numToInput(pv));
  }
  function createItem(name: string) {
    const v = `new:${name}`;
    setCreated((c) => (c.some((o) => o.value === v) ? c : [...c, { value: v, label: name, hint: 'novo item' }]));
    setSel(v);
  }

  return (
    <div className="border-t border-slate-200 p-4">
      {error && <div className="mb-2"><ErrorBox message={error} /></div>}
      <div className="grid grid-cols-12 items-center gap-2">
        <div className="col-span-6">
          <Combobox options={itemOptions} value={sel} onChange={pick} onCreate={createItem} placeholder="Buscar item ou criar…" />
        </div>
        <Input value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Qtd" className="col-span-2" />
        <Input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Preço" className="col-span-3" />
        <button
          onClick={() => sel && add.mutate()}
          disabled={!sel || add.isPending}
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
