import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Eye, TrendingUp } from 'lucide-react';
import { itemsApi, suppliersApi, productsApi, productTypesApi, categoriesApi, ItemFilters } from '../../services/resources';
import { apiError } from '../../services/api';
import { useAuth } from '../../store/auth.store';
import type { Item } from '../../types';
import { brl, parseNum } from '../../utils/format';
import { PageHeader } from '../../components/PageHeader';
import { Button, Card, Field, Input, Select, Modal, ViewModal, Spinner, ErrorBox, EmptyState, ActionMenu, type MenuAction } from '../../components/ui';
import { PriceHistoryModal } from './PriceHistoryModal';

export function Items({ embedded = false }: { embedded?: boolean } = {}) {
  const qc = useQueryClient();
  const canWrite = useAuth((s) => s.can('compras:write'));
  const isAdmin = useAuth((s) => s.can('compras:admin'));
  const [filter, setFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Item | null>(null);
  const [viewing, setViewing] = useState<Item | null>(null);
  const [historyItem, setHistoryItem] = useState<Item | null>(null);
  const [open, setOpen] = useState(false);

  const { data: suppliers } = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });
  const { data: types } = useQuery({ queryKey: ['product-types'], queryFn: productTypesApi.list });
  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.list });
  const supplierId = filter ? Number(filter) : undefined;
  const itemFilters: ItemFilters = {
    supplier_id: supplierId,
    type_id: typeFilter ? Number(typeFilter) : undefined,
    category_id: categoryFilter ? Number(categoryFilter) : undefined,
  };
  const { data, isLoading, error } = useQuery({
    queryKey: ['items', itemFilters],
    queryFn: () => itemsApi.list(itemFilters),
  });
  const remove = useMutation({
    mutationFn: itemsApi.remove,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['items'] }),
  });

  const q = search.trim().toLowerCase();
  const filtered = (data ?? []).filter((i) => !q || i.name.toLowerCase().includes(q));

  function actionsFor(it: Item): MenuAction[] {
    const out: MenuAction[] = [
      { label: 'Ver detalhes', icon: <Eye size={16} />, onClick: () => setViewing(it) },
      { label: 'Histórico de preço', icon: <TrendingUp size={16} />, onClick: () => setHistoryItem(it) },
    ];
    if (canWrite) out.push({ label: 'Editar', icon: <Pencil size={16} />, onClick: () => { setEditing(it); setOpen(true); } });
    if (isAdmin) out.push({ label: 'Excluir', icon: <Trash2 size={16} />, danger: true, onClick: () => confirm(`Excluir "${it.name}"?`) && remove.mutate(it.id) });
    return out;
  }

  return (
    <div>
      {!embedded && (
        <PageHeader
          title="Itens"
          subtitle="Produtos e insumos por fornecedor"
          action={canWrite && <Button onClick={() => { setEditing(null); setOpen(true); }}><Plus size={16} /> Novo item</Button>}
        />
      )}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar item pelo nome…"
          className="sm:max-w-xs"
        />
        <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="sm:max-w-[12rem]">
          <option value="">Todos os fornecedores</option>
          {suppliers?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="sm:max-w-[10rem]">
          <option value="">Todas as classes</option>
          {types?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
        <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="sm:max-w-[10rem]">
          <option value="">Todas as categorias</option>
          {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        {embedded && canWrite && (
          <Button onClick={() => { setEditing(null); setOpen(true); }} className="sm:ml-auto"><Plus size={16} /> Novo item</Button>
        )}
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
                  <p className="mt-1 text-xs text-slate-500">
                    {it.supplier_name}
                    {it.supplier_count != null && it.supplier_count > 1 && <span className="ml-1 text-emerald-600">+{it.supplier_count - 1}</span>}
                  </p>
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
                    <td className="px-5 py-3 text-slate-600">
                      {it.supplier_name}
                      {it.supplier_count != null && it.supplier_count > 1 && (
                        <span className="ml-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">+{it.supplier_count - 1}</span>
                      )}
                    </td>
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

      {open && <ItemForm item={editing} onClose={() => setOpen(false)} />}
      {viewing && (
        <ViewModal
          title={viewing.name}
          onClose={() => setViewing(null)}
          onEdit={canWrite ? () => { setEditing(viewing); setViewing(null); setOpen(true); } : undefined}
          fields={[
            { label: 'Produto', value: viewing.product_name },
            { label: 'Fornecedor', value: viewing.supplier_name },
            { label: 'Unidade', value: viewing.unit },
            { label: 'Preço base', value: viewing.base_price != null ? brl(viewing.base_price) : null },
            { label: 'NCM', value: viewing.ncm },
            { label: 'CEST', value: viewing.cest },
            { label: 'CFOP', value: viewing.cfop },
            { label: 'CST/CSOSN', value: viewing.cst_csosn },
            { label: 'Origem', value: viewing.origem },
            { label: 'GTIN/EAN', value: viewing.gtin },
          ]}
        />
      )}
      {historyItem && (
        <PriceHistoryModal itemId={historyItem.id} itemName={historyItem.name} onClose={() => setHistoryItem(null)} />
      )}
    </div>
  );
}

function ItemForm({ item, onClose }: { item: Item | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: suppliers } = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });
  const { data: products } = useQuery({ queryKey: ['products'], queryFn: () => productsApi.list() });
  const [name, setName] = useState(item?.name ?? '');
  const [unit, setUnit] = useState(item?.unit ?? 'un');
  const [price, setPrice] = useState(item?.base_price ?? '');
  const [productId, setProductId] = useState<string>(item?.product_id ? String(item.product_id) : '');
  const [newProduct, setNewProduct] = useState('');
  // Dados tributários de entrada
  const [ncm, setNcm] = useState(item?.ncm ?? '');
  const [cest, setCest] = useState(item?.cest ?? '');
  const [cfop, setCfop] = useState(item?.cfop ?? '');
  const [origem, setOrigem] = useState(item?.origem ?? '');
  const [cstCsosn, setCstCsosn] = useState(item?.cst_csosn ?? '');
  const [gtin, setGtin] = useState(item?.gtin ?? '');
  const [error, setError] = useState('');

  // Em edição: carrega o item completo (com a lista de fornecedores vinculados).
  const { data: full } = useQuery({
    queryKey: ['item', item?.id],
    queryFn: () => itemsApi.get(item!.id),
    enabled: !!item,
  });
  const links = full?.suppliers ?? [];
  const [linkSupplierId, setLinkSupplierId] = useState('');
  const [linkPrice, setLinkPrice] = useState('');

  const link = useMutation({
    mutationFn: () => itemsApi.linkSupplier(item!.id, {
      supplier_id: Number(linkSupplierId),
      base_price: parseNum(linkPrice),
    }),
    onSuccess: () => {
      setLinkSupplierId(''); setLinkPrice('');
      qc.invalidateQueries({ queryKey: ['item', item!.id] });
      qc.invalidateQueries({ queryKey: ['items'] });
    },
    onError: (e) => setError(apiError(e)),
  });
  const unlink = useMutation({
    mutationFn: (supplierId: number) => itemsApi.unlinkSupplier(item!.id, supplierId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['item', item!.id] });
      qc.invalidateQueries({ queryKey: ['items'] });
    },
    onError: (e) => setError(apiError(e)),
  });

  const save = useMutation({
    mutationFn: async (body: Partial<Item>) => {
      // "+ novo produto": cria antes e usa o id.
      if (productId === 'new' && newProduct.trim()) {
        const p = await productsApi.create({ name: newProduct.trim() });
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
      if (item) qc.invalidateQueries({ queryKey: ['item', item.id] });
      onClose();
    },
    onError: (e) => setError(apiError(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const parsedPrice = parseNum(String(price));
    save.mutate({
      name, unit,
      base_price: parsedPrice === null ? undefined : (parsedPrice as unknown as string),
      // Dados tributários de entrada (opcionais)
      ncm: ncm.trim() || null,
      cest: cest.trim() || null,
      cfop: cfop.trim() || null,
      origem: origem.trim() || null,
      cst_csosn: cstCsosn.trim() || null,
      gtin: gtin.trim() || null,
    });
  }

  return (
    <Modal title={item ? 'Editar item' : 'Novo item'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorBox message={error} />}
        <Field label="Nome"><Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus /></Field>
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

        {/* Dados tributários de entrada */}
        <div className="rounded-lg border border-slate-200 p-3">
          <p className="mb-3 text-sm font-medium text-slate-700">Dados tributários de entrada</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="NCM"><Input value={ncm} onChange={(e) => setNcm(e.target.value)} placeholder="0000.00.00" maxLength={8} /></Field>
            <Field label="CEST"><Input value={cest} onChange={(e) => setCest(e.target.value)} placeholder="00.000.00" maxLength={7} /></Field>
            <Field label="CFOP"><Input value={cfop} onChange={(e) => setCfop(e.target.value)} placeholder="1102" maxLength={4} /></Field>
            <Field label="CST/CSOSN"><Input value={cstCsosn} onChange={(e) => setCstCsosn(e.target.value)} placeholder="102" maxLength={4} /></Field>
            <Field label="Origem">
              <Select value={origem} onChange={(e) => setOrigem(e.target.value)}>
                <option value="">—</option>
                <option value="0">0 - Nacional</option>
                <option value="1">1 - Estrangeira (importação direta)</option>
                <option value="2">2 - Estrangeira (mercado interno)</option>
                <option value="3">3 - Nacional (imp. 40–70%)</option>
                <option value="4">4 - Nacional (proc. produtivo básico)</option>
                <option value="5">5 - Nacional (imp. ≤40%)</option>
                <option value="6">6 - Estrangeira (imp. direta, sem similar)</option>
                <option value="7">7 - Estrangeira (merc. interno, sem similar)</option>
                <option value="8">8 - Nacional (imp. &gt;70%)</option>
              </Select>
            </Field>
            <Field label="GTIN/EAN"><Input value={gtin} onChange={(e) => setGtin(e.target.value)} placeholder="7891234567890" maxLength={14} /></Field>
          </div>
        </div>

        {item && (
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-sm font-medium text-slate-700">Fornecedores deste item</p>
            <p className="mb-2 text-xs text-slate-400">Preenchidos automaticamente ao lançar a NF-e de entrada, ou adicione manualmente abaixo.</p>
            <ul className="space-y-1">
              {links.map((l) => {
                const isOrigin = l.supplier_id === item.supplier_id;
                return (
                  <li key={l.supplier_id} className="flex items-center justify-between text-sm">
                    <span className="text-slate-700">
                      {l.supplier_name}
                      {isOrigin && <span className="ml-2 text-xs text-slate-400">(origem)</span>}
                      {l.base_price != null && <span className="ml-2 text-xs text-slate-400">{brl(l.base_price)}</span>}
                    </span>
                    {!isOrigin && (
                      <button type="button" onClick={() => unlink.mutate(l.supplier_id)} disabled={unlink.isPending} className="text-slate-300 hover:text-red-600" title="Remover vínculo">
                        <Trash2 size={15} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="mt-3 flex items-center gap-2">
              <Select value={linkSupplierId} onChange={(e) => setLinkSupplierId(e.target.value)} className="min-w-0 flex-1">
                <option value="">— vincular fornecedor —</option>
                {suppliers?.filter((s) => !links.some((l) => l.supplier_id === s.id)).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
              <Input value={linkPrice} onChange={(e) => setLinkPrice(e.target.value)} placeholder="0,00" className="shrink-0" style={{ width: '5.5rem' }} />
              <Button type="button" variant="secondary" disabled={!linkSupplierId || link.isPending} onClick={() => link.mutate()} className="shrink-0">
                <Plus size={15} /> Vincular
              </Button>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={save.isPending}>Salvar</Button>
        </div>
      </form>
    </Modal>
  );
}
