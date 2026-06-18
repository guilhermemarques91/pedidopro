import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { itemsApi, suppliersApi, productsApi } from '../../services/resources';
import { apiError } from '../../services/api';
import { useAuth } from '../../store/auth.store';
import type { Item } from '../../types';
import { brl, parseNum } from '../../utils/format';
import { PageHeader } from '../../components/PageHeader';
import { Button, Card, Field, Input, Select, Modal, Spinner, ErrorBox, EmptyState, ActionMenu, type MenuAction } from '../../components/ui';

export function Items() {
  const qc = useQueryClient();
  const canWrite = useAuth((s) => s.hasRole('admin', 'buyer'));
  const isAdmin = useAuth((s) => s.hasRole('admin'));
  const [filter, setFilter] = useState<string>('');
  const [search, setSearch] = useState('');
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

  const q = search.trim().toLowerCase();
  const filtered = (data ?? []).filter((i) => !q || i.name.toLowerCase().includes(q));

  function actionsFor(it: Item): MenuAction[] {
    const out: MenuAction[] = [];
    if (canWrite) out.push({ label: 'Editar', icon: <Pencil size={16} />, onClick: () => { setEditing(it); setOpen(true); } });
    if (isAdmin) out.push({ label: 'Excluir', icon: <Trash2 size={16} />, danger: true, onClick: () => confirm(`Excluir "${it.name}"?`) && remove.mutate(it.id) });
    return out;
  }

  return (
    <div>
      <PageHeader
        title="Itens"
        subtitle="Produtos e insumos por fornecedor"
        action={canWrite && <Button onClick={() => { setEditing(null); setOpen(true); }}><Plus size={16} /> Novo item</Button>}
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar item pelo nome…"
          className="sm:max-w-sm"
        />
        <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="sm:max-w-xs">
          <option value="">Todos os fornecedores</option>
          {suppliers?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </div>

      {isLoading && <Spinner />}
      {error && <ErrorBox message={apiError(error)} />}

      {data && (filtered.length === 0 ? (
        <EmptyState message="Nenhum item encontrado." />
      ) : (
        <>
          {/* Mobile: lista de cartões */}
          <div className="space-y-3 sm:hidden">
            {filtered.map((it) => (
              <Card key={it.id} className="flex items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-slate-800">{it.name}</p>
                    {it.product_name && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">{it.product_name}</span>}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{it.supplier_name}</p>
                  <p className="mt-2 text-sm text-slate-600">{brl(it.base_price)} <span className="text-xs text-slate-400">/ {it.unit}</span></p>
                </div>
                <ActionMenu actions={actionsFor(it)} />
              </Card>
            ))}
          </div>

          {/* Desktop: tabela */}
          <Card className="hidden p-0 sm:block">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 text-left text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Item</th>
                  <th className="px-5 py-3 font-medium">Produto</th>
                  <th className="px-5 py-3 font-medium">Fornecedor</th>
                  <th className="px-5 py-3 font-medium">Un.</th>
                  <th className="px-5 py-3 font-medium text-right">Preço base</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((it) => (
                  <tr key={it.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-3 font-medium text-slate-800">{it.name}</td>
                    <td className="px-5 py-3">
                      {it.product_name
                        ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">{it.product_name}</span>
                        : <span className="text-xs text-slate-300">—</span>}
                    </td>
                    <td className="px-5 py-3 text-slate-600">{it.supplier_name}</td>
                    <td className="px-5 py-3 text-slate-600">{it.unit}</td>
                    <td className="px-5 py-3 text-right text-slate-600">{brl(it.base_price)}</td>
                    <td className="px-5 py-3 text-right">
                      <ActionMenu actions={actionsFor(it)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      ))}

      {open && <ItemForm item={editing} defaultSupplier={supplierId} onClose={() => setOpen(false)} />}
    </div>
  );
}

function ItemForm({ item, defaultSupplier, onClose }: { item: Item | null; defaultSupplier?: number; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: suppliers } = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });
  const { data: products } = useQuery({ queryKey: ['products'], queryFn: productsApi.list });
  const [supplierId, setSupplierId] = useState<string>(String(item?.supplier_id ?? defaultSupplier ?? ''));
  const [name, setName] = useState(item?.name ?? '');
  const [supplierCode, setSupplierCode] = useState(item?.supplier_code ?? '');
  const [unit, setUnit] = useState(item?.unit ?? 'un');
  const [price, setPrice] = useState(item?.base_price ?? '');
  const [productId, setProductId] = useState<string>(item?.product_id ? String(item.product_id) : '');
  const [newProduct, setNewProduct] = useState('');
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: async (body: Partial<Item>) => {
      // "+ novo produto": cria antes e usa o id.
      if (productId === 'new' && newProduct.trim()) {
        const p = await productsApi.create(newProduct.trim());
        body = { ...body, product_id: p.id };
      } else if (productId === '') {
        body = { ...body, product_id: null };
      } else if (productId !== 'new') {
        body = { ...body, product_id: Number(productId) };
      }
      return item ? itemsApi.update(item.id, body) : itemsApi.create(body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['items'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['unmapped'] });
      onClose();
    },
    onError: (e) => setError(apiError(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!supplierId) { setError('Selecione o fornecedor'); return; }
    const parsedPrice = parseNum(String(price));
    save.mutate({
      supplier_id: Number(supplierId), name, unit,
      supplier_code: supplierCode.trim() || null,
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
        <Field label="Código do fornecedor (opcional)">
          <Input value={supplierCode} onChange={(e) => setSupplierCode(e.target.value)} placeholder="ex.: 0466" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Unidade"><Input value={unit} onChange={(e) => setUnit(e.target.value)} required /></Field>
          <Field label="Preço base"><Input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="12,90" /></Field>
        </div>
        <Field label="Produto (para comparar entre fornecedores)">
          <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">— nenhum —</option>
            <option value="new">+ novo produto</option>
            {products?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        {productId === 'new' && <Input value={newProduct} onChange={(e) => setNewProduct(e.target.value)} placeholder="Nome do produto (ex.: Acém)" />}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={save.isPending}>Salvar</Button>
        </div>
      </form>
    </Modal>
  );
}
