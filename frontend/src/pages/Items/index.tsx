import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { itemsApi, suppliersApi } from '../../services/resources';
import { apiError } from '../../services/api';
import { useAuth } from '../../store/auth.store';
import type { Item } from '../../types';
import { brl, parseNum } from '../../utils/format';
import { PageHeader } from '../../components/PageHeader';
import { Button, Card, Field, Input, Select, Modal, Spinner, ErrorBox, EmptyState } from '../../components/ui';

export function Items() {
  const qc = useQueryClient();
  const canWrite = useAuth((s) => s.hasRole('admin', 'buyer'));
  const isAdmin = useAuth((s) => s.hasRole('admin'));
  const [filter, setFilter] = useState<string>('');
  const [editing, setEditing] = useState<Item | null>(null);
  const [open, setOpen] = useState(false);

  const { data: suppliers } = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });
  const supplierId = filter ? Number(filter) : undefined;
  const { data, isLoading, error } = useQuery({
    queryKey: ['items', supplierId],
    queryFn: () => itemsApi.list(supplierId),
  });
  const remove = useMutation({
    mutationFn: itemsApi.remove,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['items'] }),
  });

  return (
    <div>
      <PageHeader
        title="Itens"
        subtitle="Produtos e insumos por fornecedor"
        action={canWrite && <Button onClick={() => { setEditing(null); setOpen(true); }}><Plus size={16} /> Novo item</Button>}
      />

      <div className="mb-4 max-w-xs">
        <Select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">Todos os fornecedores</option>
          {suppliers?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </div>

      {isLoading && <Spinner />}
      {error && <ErrorBox message={apiError(error)} />}

      {data && (data.length === 0 ? (
        <EmptyState message="Nenhum item encontrado." />
      ) : (
        <Card className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Item</th>
                <th className="px-5 py-3 font-medium">Fornecedor</th>
                <th className="px-5 py-3 font-medium">Un.</th>
                <th className="px-5 py-3 font-medium text-right">Preço base</th>
                {canWrite && <th className="px-5 py-3" />}
              </tr>
            </thead>
            <tbody>
              {data.map((it) => (
                <tr key={it.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-5 py-3 font-medium text-slate-800">{it.name}</td>
                  <td className="px-5 py-3 text-slate-600">{it.supplier_name}</td>
                  <td className="px-5 py-3 text-slate-600">{it.unit}</td>
                  <td className="px-5 py-3 text-right text-slate-600">{brl(it.base_price)}</td>
                  {canWrite && (
                    <td className="px-5 py-3 text-right">
                      <button onClick={() => { setEditing(it); setOpen(true); }} className="mr-2 text-slate-400 hover:text-emerald-600"><Pencil size={16} /></button>
                      {isAdmin && <button onClick={() => confirm(`Excluir "${it.name}"?`) && remove.mutate(it.id)} className="text-slate-400 hover:text-red-600"><Trash2 size={16} /></button>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}

      {open && <ItemForm item={editing} defaultSupplier={supplierId} onClose={() => setOpen(false)} />}
    </div>
  );
}

function ItemForm({ item, defaultSupplier, onClose }: { item: Item | null; defaultSupplier?: number; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: suppliers } = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });
  const [supplierId, setSupplierId] = useState<string>(String(item?.supplier_id ?? defaultSupplier ?? ''));
  const [name, setName] = useState(item?.name ?? '');
  const [unit, setUnit] = useState(item?.unit ?? 'un');
  const [price, setPrice] = useState(item?.base_price ?? '');
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: (body: Partial<Item>) => item ? itemsApi.update(item.id, body) : itemsApi.create(body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['items'] }); onClose(); },
    onError: (e) => setError(apiError(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!supplierId) { setError('Selecione o fornecedor'); return; }
    const parsedPrice = parseNum(String(price));
    save.mutate({
      supplier_id: Number(supplierId), name, unit,
      base_price: parsedPrice === null ? undefined : (parsedPrice as unknown as string),
    });
  }

  return (
    <Modal title={item ? 'Editar item' : 'Novo item'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorBox message={error} />}
        <Field label="Fornecedor">
          <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} disabled={!!item} required>
            <option value="">— selecione —</option>
            {suppliers?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Nome"><Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Unidade"><Input value={unit} onChange={(e) => setUnit(e.target.value)} required /></Field>
          <Field label="Preço base"><Input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="12,90" /></Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={save.isPending}>Salvar</Button>
        </div>
      </form>
    </Modal>
  );
}
