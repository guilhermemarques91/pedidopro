import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { ordersApi, suppliersApi, itemsApi, CreateOrderBody } from '../../services/resources';
import { apiError } from '../../services/api';
import { useAuth } from '../../store/auth.store';
import { brl, date, parseNum } from '../../utils/format';
import { PageHeader } from '../../components/PageHeader';
import { Button, Card, Field, Input, Select, Modal, Spinner, ErrorBox, EmptyState, Badge } from '../../components/ui';

const STATUS = ['', 'draft', 'pending_approval', 'approved', 'sent', 'received', 'cancelled'];

export function Orders() {
  const canWrite = useAuth((s) => s.hasRole('admin', 'buyer'));
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['orders', status],
    queryFn: () => ordersApi.list(status || undefined),
  });

  return (
    <div>
      <PageHeader
        title="Pedidos"
        subtitle="Geração, aprovação e envio por WhatsApp"
        action={canWrite && <Button onClick={() => setOpen(true)}><Plus size={16} /> Novo pedido</Button>}
      />

      <div className="mb-4 max-w-xs">
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUS.map((s) => <option key={s} value={s}>{s === '' ? 'Todos os status' : s}</option>)}
        </Select>
      </div>

      {isLoading && <Spinner />}
      {error && <ErrorBox message={apiError(error)} />}

      {data && (data.length === 0 ? (
        <EmptyState message="Nenhum pedido encontrado." />
      ) : (
        <Card className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Pedido</th>
                <th className="px-5 py-3 font-medium">Fornecedor</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium text-right">Total</th>
                <th className="px-5 py-3 font-medium">Criado</th>
              </tr>
            </thead>
            <tbody>
              {data.map((o) => (
                <tr key={o.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-5 py-3"><Link to={`/orders/${o.id}`} className="font-medium text-emerald-700 hover:underline">#{o.id}</Link></td>
                  <td className="px-5 py-3 text-slate-600">{o.supplier_name}</td>
                  <td className="px-5 py-3"><Badge status={o.status} /></td>
                  <td className="px-5 py-3 text-right text-slate-600">{brl(o.total_amount)}</td>
                  <td className="px-5 py-3 text-slate-600">{date(o.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}

      {open && <OrderForm onClose={() => setOpen(false)} />}
    </div>
  );
}

interface Line { item_id: string; quantity: string; unit_price: string }

function OrderForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: suppliers } = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });
  const [supplierId, setSupplierId] = useState('');
  const { data: items } = useQuery({
    queryKey: ['items', supplierId ? Number(supplierId) : undefined],
    queryFn: () => itemsApi.list(supplierId ? Number(supplierId) : undefined),
    enabled: !!supplierId,
  });
  const [lines, setLines] = useState<Line[]>([{ item_id: '', quantity: '1', unit_price: '' }]);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const create = useMutation({
    mutationFn: (body: CreateOrderBody) => ordersApi.create(body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['orders'] }); onClose(); },
    onError: (e) => setError(apiError(e)),
  });

  function setLine(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function pickItem(i: number, itemId: string) {
    const it = items?.find((x) => x.id === Number(itemId));
    setLine(i, { item_id: itemId, unit_price: it?.base_price ?? '' });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const parsedItems = lines
      .filter((l) => l.item_id)
      .map((l) => ({
        item_id: Number(l.item_id),
        quantity: parseNum(l.quantity) ?? 0,
        unit_price: parseNum(l.unit_price) ?? 0,
      }));
    if (!supplierId) { setError('Selecione o fornecedor'); return; }
    if (parsedItems.length === 0) { setError('Adicione ao menos um item'); return; }
    create.mutate({ supplier_id: Number(supplierId), notes: notes || undefined, items: parsedItems });
  }

  return (
    <Modal title="Novo pedido" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorBox message={error} />}
        <Field label="Fornecedor">
          <Select value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setLines([{ item_id: '', quantity: '1', unit_price: '' }]); }} required>
            <option value="">— selecione —</option>
            {suppliers?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>

        <div>
          <span className="mb-1 block text-sm font-medium text-slate-700">Itens</span>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="flex gap-2">
                <Select value={l.item_id} onChange={(e) => pickItem(i, e.target.value)} disabled={!supplierId} className="flex-1">
                  <option value="">— item —</option>
                  {items?.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
                </Select>
                <Input value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} placeholder="Qtd" className="w-20" />
                <Input value={l.unit_price} onChange={(e) => setLine(i, { unit_price: e.target.value })} placeholder="Preço" className="w-24" />
                <button type="button" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} className="text-slate-400 hover:text-red-600"><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setLines((ls) => [...ls, { item_id: '', quantity: '1', unit_price: '' }])} className="mt-2 text-sm text-emerald-600 hover:underline">+ adicionar linha</button>
        </div>

        <Field label="Observações (opcional)"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={create.isPending}>Criar pedido</Button>
        </div>
      </form>
    </Modal>
  );
}
