import { FormEvent, ReactNode, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Sparkles, Check, Tags as TagsIcon, Filter, Eye } from 'lucide-react';
import { productsApi, productTypesApi, categoriesApi, suppliersApi, ProductFilters, ProductInput, SuggestedGroup } from '../../services/resources';
import { apiError } from '../../services/api';
import { brl } from '../../utils/format';
import type { Product, ProductType } from '../../types';
import { PageHeader } from '../../components/PageHeader';
import { Button, Card, Input, Select, Modal, ViewModal, IconBtn, Spinner, ErrorBox, EmptyState } from '../../components/ui';

const numOrNull = (v: string): number | null => (v.trim() === '' ? null : Number(v));

export function Products() {
  const qc = useQueryClient();
  const [category, setCategory] = useState<number | ''>('');   // filtro do topo
  const [q, setQ] = useState('');
  const [type, setType] = useState<number | ''>('');
  const [supplier, setSupplier] = useState<number | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [costMin, setCostMin] = useState('');
  const [costMax, setCostMax] = useState('');
  const [saleMin, setSaleMin] = useState('');
  const [saleMax, setSaleMax] = useState('');
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [viewing, setViewing] = useState<Product | null>(null);
  const [typesOpen, setTypesOpen] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);

  const categories = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.list });
  const types = useQuery({ queryKey: ['product-types'], queryFn: productTypesApi.list });
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });

  const filters: ProductFilters = {
    q: q.trim() || undefined,
    category_id: category || undefined,
    type_id: type || undefined,
    supplier_id: supplier || undefined,
    created_from: from || undefined,
    created_to: to || undefined,
    cost_min: costMin ? Number(costMin) : undefined,
    cost_max: costMax ? Number(costMax) : undefined,
    sale_min: saleMin ? Number(saleMin) : undefined,
    sale_max: saleMax ? Number(saleMax) : undefined,
  };
  const products = useQuery({ queryKey: ['products', filters], queryFn: () => productsApi.list(filters) });

  const hasFilters = q || type || supplier || from || to || costMin || costMax || saleMin || saleMax;
  function clearFilters() {
    setQ(''); setType(''); setSupplier(''); setFrom(''); setTo(''); setCostMin(''); setCostMax(''); setSaleMin(''); setSaleMax('');
  }
  const remove = useMutation({
    mutationFn: (id: number) => productsApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
    onError: (e) => alert(apiError(e)),
  });

  return (
    <div>
      <PageHeader
        title="Produtos / Estoque"
        subtitle="Cadastro de matéria-prima, uso e consumo, cardápio, bebidas…"
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setSuggestOpen(true)}><Sparkles size={16} /> Agrupar (IA)</Button>
            <Button variant="secondary" onClick={() => setTypesOpen(true)}><TagsIcon size={16} /> Tipos</Button>
            <Button onClick={() => setEditing('new')}><Plus size={16} /> Novo cadastro</Button>
          </div>
        }
      />

      {/* Filtro de categorias no topo (chips) */}
      <div className="mb-4 flex flex-wrap gap-2">
        <Chip active={category === ''} onClick={() => setCategory('')}>Todas</Chip>
        {categories.data?.map((c) => (
          <Chip key={c.id} active={category === c.id} onClick={() => setCategory(c.id)}>{c.name}</Chip>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
        {/* Filtros laterais */}
        <Card className="h-max space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-600"><Filter size={15} /> Filtros</div>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome…" />
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Tipo</label>
            <Select value={type} onChange={(e) => setType(e.target.value ? Number(e.target.value) : '')}>
              <option value="">Todos</option>
              {types.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Fornecedor</label>
            <Select value={supplier} onChange={(e) => setSupplier(e.target.value ? Number(e.target.value) : '')}>
              <option value="">Todos</option>
              {suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Cadastrado (de / até)</label>
            <div className="space-y-2">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="min-w-0" />
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="min-w-0" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Compra (R$ min / máx)</label>
            <div className="grid grid-cols-2 gap-2">
              <Input type="number" step="0.01" value={costMin} onChange={(e) => setCostMin(e.target.value)} placeholder="mín" className="min-w-0" />
              <Input type="number" step="0.01" value={costMax} onChange={(e) => setCostMax(e.target.value)} placeholder="máx" className="min-w-0" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Venda (R$ min / máx)</label>
            <div className="grid grid-cols-2 gap-2">
              <Input type="number" step="0.01" value={saleMin} onChange={(e) => setSaleMin(e.target.value)} placeholder="mín" className="min-w-0" />
              <Input type="number" step="0.01" value={saleMax} onChange={(e) => setSaleMax(e.target.value)} placeholder="máx" className="min-w-0" />
            </div>
          </div>
          {hasFilters ? <button onClick={clearFilters} className="text-sm text-emerald-600 hover:underline">Limpar filtros</button> : null}
        </Card>

        {/* Lista */}
        <div>
          {products.isLoading && <Spinner />}
          {products.error && <ErrorBox message={apiError(products.error)} />}
          {products.data && (products.data.length === 0 ? (
            <EmptyState message={hasFilters || category ? 'Nenhum cadastro com esses filtros.' : 'Nenhum cadastro ainda. Clique em “Novo cadastro”.'} />
          ) : (
            <>
              {/* Mobile: só Nome, Tipo e Unidade + 👁 (detalhes), editar e excluir */}
              <div className="space-y-2 sm:hidden">
                {products.data.map((p) => (
                  <Card key={p.id} className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-800">{p.name}</p>
                      <p className="mt-0.5 truncate text-xs text-slate-500">
                        {p.type_name ?? 'sem tipo'} · {p.unit ?? p.default_unit ?? 's/ un.'}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <IconBtn title="Ver detalhes" onClick={() => setViewing(p)}><Eye size={17} /></IconBtn>
                      <IconBtn title="Editar" hover="emerald" onClick={() => setEditing(p)}><Pencil size={16} /></IconBtn>
                      <IconBtn title="Excluir" hover="red" onClick={() => { if (confirm(`Excluir o cadastro "${p.name}"?`)) remove.mutate(p.id); }}><Trash2 size={16} /></IconBtn>
                    </div>
                  </Card>
                ))}
              </div>

              {/* Desktop: tabela completa */}
              <Card className="hidden overflow-x-auto p-0 sm:block">
                <table className="w-full text-sm">
                  <thead className="border-b border-slate-200 text-left text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">Nome</th>
                      <th className="px-4 py-3 font-medium">Tipo</th>
                      <th className="px-4 py-3 font-medium">Categoria</th>
                      <th className="px-4 py-3 font-medium">Fornecedor</th>
                      <th className="px-4 py-3 font-medium">Un.</th>
                      <th className="px-4 py-3 text-right font-medium">Compra</th>
                      <th className="px-4 py-3 text-right font-medium">Venda</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {products.data.map((p) => (
                      <tr key={p.id} className="border-b border-slate-100 last:border-0">
                        <td className="px-4 py-3 font-medium text-slate-800">{p.name}
                          {Number(p.item_count ?? 0) > 0 && <span className="ml-2 text-xs text-slate-400">{p.item_count} item(ns)</span>}
                        </td>
                        <td className="px-4 py-3">{p.type_name ? <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{p.type_name}</span> : <span className="text-slate-300">—</span>}</td>
                        <td className="px-4 py-3 text-slate-600">{p.category_name ?? <span className="text-slate-300">—</span>}</td>
                        <td className="px-4 py-3 text-slate-600">{p.supplier_name ?? <span className="text-slate-300">—</span>}</td>
                        <td className="px-4 py-3 text-slate-600">{p.unit ?? p.default_unit ?? <span className="text-slate-300">—</span>}</td>
                        <td className="px-4 py-3 text-right text-slate-600">{p.cost_price != null ? brl(p.cost_price) : <span className="text-slate-300">—</span>}</td>
                        <td className="px-4 py-3 text-right font-medium text-slate-800">{p.sale_price != null ? brl(p.sale_price) : <span className="text-slate-300">—</span>}</td>
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => setEditing(p)} className="mr-3 text-slate-400 hover:text-emerald-600" title="Editar"><Pencil size={16} /></button>
                          <button onClick={() => { if (confirm(`Excluir o cadastro "${p.name}"?`)) remove.mutate(p.id); }} className="text-slate-400 hover:text-red-600" title="Excluir"><Trash2 size={16} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </>
          ))}
        </div>
      </div>

      {editing && (
        <ProductForm
          product={editing === 'new' ? null : editing}
          types={types.data ?? []}
          categories={categories.data ?? []}
          suppliers={suppliers.data ?? []}
          onClose={() => setEditing(null)}
        />
      )}
      {typesOpen && <TypesManager onClose={() => setTypesOpen(false)} />}
      {suggestOpen && <SuggestModal onClose={() => setSuggestOpen(false)} onApplied={() => qc.invalidateQueries({ queryKey: ['products'] })} />}
      {viewing && (
        <ViewModal
          title={viewing.name}
          onClose={() => setViewing(null)}
          onEdit={() => { setEditing(viewing); setViewing(null); }}
          fields={[
            { label: 'Tipo', value: viewing.type_name },
            { label: 'Categoria', value: viewing.category_name },
            { label: 'Fornecedor', value: viewing.supplier_name },
            { label: 'Unidade', value: viewing.unit ?? viewing.default_unit },
            { label: 'Preço de compra', value: viewing.cost_price != null ? brl(viewing.cost_price) : null },
            { label: 'Preço de venda', value: viewing.sale_price != null ? brl(viewing.sale_price) : null },
            { label: 'Itens de fornecedor vinculados', value: Number(viewing.item_count ?? 0) || null },
            { label: 'Cadastrado em', value: new Date(viewing.created_at).toLocaleDateString('pt-BR') },
          ]}
        />
      )}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-sm transition ${active ? 'border-emerald-600 bg-emerald-50 font-medium text-emerald-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
    >
      {children}
    </button>
  );
}

function ProductForm({ product, types, categories, suppliers, onClose }: {
  product: Product | null;
  types: ProductType[];
  categories: { id: number; name: string }[];
  suppliers: { id: number; name: string }[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(product?.name ?? '');
  const [typeId, setTypeId] = useState<number | ''>(product?.type_id ?? '');
  const [categoryId, setCategoryId] = useState<number | ''>(product?.category_id ?? '');
  const [supplierId, setSupplierId] = useState<number | ''>(product?.supplier_id ?? '');
  const [unit, setUnit] = useState(product?.unit ?? '');
  const [cost, setCost] = useState(product?.cost_price ?? '');
  const [sale, setSale] = useState(product?.sale_price ?? '');
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: () => {
      const body: ProductInput = {
        name: name.trim(),
        type_id: typeId || null,
        category_id: categoryId || null,
        supplier_id: supplierId || null,
        unit: unit.trim() || null,
        cost_price: numOrNull(String(cost)),
        sale_price: numOrNull(String(sale)),
      };
      return product ? productsApi.update(product.id, body) : productsApi.create(body);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['products'] }); onClose(); },
    onError: (e) => setError(apiError(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (name.trim().length < 1) { setError('Informe o nome.'); return; }
    save.mutate();
  }

  return (
    <Modal title={product ? 'Editar cadastro' : 'Novo cadastro'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorBox message={error} />}
        <Field label="Nome"><Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo">
            <Select value={typeId} onChange={(e) => setTypeId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">—</option>
              {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
          <Field label="Categoria">
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">—</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Fornecedor">
            <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">—</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Unidade"><Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="un, kg, L, prato…" /></Field>
          <Field label="Preço de compra (R$)"><Input type="number" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0,00" /></Field>
          <Field label="Preço de venda (R$)"><Input type="number" step="0.01" value={sale} onChange={(e) => setSale(e.target.value)} placeholder="0,00" /></Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={save.isPending}>Salvar</Button>
        </div>
      </form>
    </Modal>
  );
}

// Field local (o Field do ui.tsx é reusado se existir; replica compacta para o grid).
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

function TypesManager({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const types = useQuery({ queryKey: ['product-types'], queryFn: productTypesApi.list });
  const [name, setName] = useState('');
  const invalidate = () => { qc.invalidateQueries({ queryKey: ['product-types'] }); qc.invalidateQueries({ queryKey: ['products'] }); };
  const create = useMutation({ mutationFn: () => productTypesApi.create({ name: name.trim() }), onSuccess: () => { setName(''); invalidate(); }, onError: (e) => alert(apiError(e)) });
  const remove = useMutation({ mutationFn: (id: number) => productTypesApi.remove(id), onSuccess: invalidate, onError: (e) => alert(apiError(e)) });

  return (
    <Modal title="Tipos de produto" onClose={onClose}>
      <p className="mb-3 text-sm text-slate-500">Classificação usada no cadastro e nos filtros (matéria-prima, uso e consumo, cardápio, bebida…).</p>
      <div className="mb-3 flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Novo tipo…" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (name.trim()) create.mutate(); } }} />
        <Button onClick={() => name.trim() && create.mutate()} disabled={create.isPending}><Plus size={16} /></Button>
      </div>
      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {types.data?.map((t) => (
          <div key={t.id} className="flex items-center justify-between px-4 py-2.5">
            <span className="text-slate-800">{t.name}</span>
            <button onClick={() => { if (confirm(`Excluir o tipo "${t.name}"? Os produtos ficam sem tipo.`)) remove.mutate(t.id); }} className="text-slate-400 hover:text-red-600"><Trash2 size={16} /></button>
          </div>
        ))}
        {types.data?.length === 0 && <p className="px-4 py-3 text-sm text-slate-400">Nenhum tipo.</p>}
      </div>
    </Modal>
  );
}

// ---- Agrupamento por IA (mantido do fluxo anterior) ----
function SuggestModal({ onClose, onApplied }: { onClose: () => void; onApplied: () => void }) {
  const suggest = useQuery({ queryKey: ['suggest'], queryFn: productsApi.suggest });
  return (
    <Modal title="Sugestões de agrupamento (IA)" onClose={onClose} size="xl">
      <p className="mb-3 text-sm text-slate-500">
        A IA local agrupa itens de fornecedores que são o mesmo produto (para comparar preço). <strong>Revise</strong> antes de confirmar.
      </p>
      {suggest.isLoading && <div className="py-6"><Spinner /><p className="text-center text-sm text-slate-400">Analisando itens… (pode levar ~1 min na CPU)</p></div>}
      {suggest.error && <ErrorBox message={apiError(suggest.error)} />}
      {suggest.data && (suggest.data.length === 0 ? (
        <EmptyState message="A IA não encontrou agrupamentos claros." />
      ) : (
        <div className="space-y-3">
          {suggest.data.map((g, idx) => <SuggestionGroup key={idx} group={g} onApplied={onApplied} />)}
        </div>
      ))}
      <div className="mt-4 flex justify-end"><Button variant="secondary" onClick={onClose}>Fechar</Button></div>
    </Modal>
  );
}

function SuggestionGroup({ group, onApplied }: { group: SuggestedGroup; onApplied: () => void }) {
  const [name, setName] = useState(group.suggested_name);
  const [chosen, setChosen] = useState<Set<number>>(new Set(group.item_ids));
  const [done, setDone] = useState(false);
  const apply = useMutation({
    mutationFn: async () => {
      const p = await productsApi.create({ name: name.trim() });
      return productsApi.assign(p.id, [...chosen]);
    },
    onSuccess: () => { setDone(true); onApplied(); },
  });
  const toggle = (id: number) => setChosen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  if (done) return <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">✓ Produto "{name}" criado.</div>;
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="mb-2 flex items-center gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} className="max-w-xs" />
        <Button onClick={() => apply.mutate()} disabled={apply.isPending || chosen.size < 1 || !name.trim()}><Check size={15} /> Criar e vincular</Button>
      </div>
      <div className="space-y-1">
        {group.items.map((it) => (
          <label key={it.id} className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={chosen.has(it.id)} onChange={() => toggle(it.id)} className="h-4 w-4 accent-emerald-600" />
            {it.name} <span className="text-xs text-slate-400">· {it.supplier_name}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
