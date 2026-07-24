import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Items } from '../Items';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Sparkles, Check, Tags as TagsIcon, FolderTree, Layers, Filter, ArrowDownUp, Receipt, Printer,
  LayoutGrid, ShoppingBag, Sandwich, Boxes, PlusCircle, Carrot, CookingPot, SprayCan, Building2, type LucideIcon } from 'lucide-react';
import { productsApi, productTypesApi, subclassesApi, printersApi, categoriesApi, suppliersApi, itemsApi, stockApi, ProductFilters, ProductInput, RecipeLineInput, SuggestedGroup } from '../../services/resources';
import { apiError } from '../../services/api';
import { brl } from '../../utils/format';
import type { Product, ProductType, Subclass, ProductionPrinter, RecipeLine, StockMove } from '../../types';
import { useAuth } from '../../store/auth.store';
import { PageHeader } from '../../components/PageHeader';
import { Button, Card, Input, Select, Textarea, Modal, IconBtn, Spinner, ErrorBox, EmptyState } from '../../components/ui';
import { PhotoPicker } from '../../components/PhotoPicker';

const numOrNull = (v: string): number | null => (v.trim() === '' ? null : Number(v));

// Eixo "Tipo" (abas de topo) — valores fixos, espelham o PDV/ERP do usuário.
const TIPOS: { value: string; label: string; Icon: LucideIcon }[] = [
  { value: 'Mercadoria', label: 'Mercadoria', Icon: ShoppingBag },
  { value: 'Produto', label: 'Produto', Icon: Sandwich },
  { value: 'Combo', label: 'Combo', Icon: Boxes },
  { value: 'Adicional', label: 'Adicional', Icon: PlusCircle },
  { value: 'Matéria-prima', label: 'Matéria-prima', Icon: Carrot },
  { value: 'Item intermediário', label: 'Item intermediário', Icon: CookingPot },
  { value: 'Uso e consumo', label: 'Uso e consumo', Icon: SprayCan },
  { value: 'Ativo imobilizado', label: 'Ativo imobilizado', Icon: Building2 },
];

// Tipos manipulados dentro da empresa (montados a partir de insumos): têm ficha
// técnica (receita p/ baixa de estoque) e NÃO têm fornecedor principal — os insumos
// é que vêm de fornecedores. Os demais tipos são mercadorias/insumos comprados:
// têm fornecedor e unidades de compra/venda, mas não têm ficha técnica.
const RECIPE_TIPOS = new Set(['Produto', 'Combo', 'Item intermediário']);
const usaFichaTecnica = (tipo: string) => RECIPE_TIPOS.has(tipo);

export function Products() {
  const qc = useQueryClient();
  // Visão unificada: "produtos" (cadastro central) ou "itens" (SKUs por fornecedor).
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'itens' ? 'itens' : 'produtos';
  const setView = (v: string) => setParams(v === 'itens' ? { view: 'itens' } : {}, { replace: true });
  const [tipo, setTipo] = useState('');                        // aba de topo (eixo Tipo)
  const [category, setCategory] = useState<number | ''>('');
  const [q, setQ] = useState('');
  const [type, setType] = useState<number | ''>('');           // Classe de itens
  const [subClasse, setSubClasse] = useState<number | ''>('');
  const [supplier, setSupplier] = useState<number | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [costMin, setCostMin] = useState('');
  const [costMax, setCostMax] = useState('');
  const [saleMin, setSaleMin] = useState('');
  const [saleMax, setSaleMax] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [fiscalOf, setFiscalOf] = useState<Product | null>(null);
  const [typesOpen, setTypesOpen] = useState(false);
  const [catsOpen, setCatsOpen] = useState(false);
  const [subsOpen, setSubsOpen] = useState(false);
  const [printersOpen, setPrintersOpen] = useState(false);
  const [stockOf, setStockOf] = useState<Product | null>(null);
  const canMove = useAuth((st) => st.can('estoque:mover'));
  const [suggestOpen, setSuggestOpen] = useState(false);

  const categories = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.list });
  const types = useQuery({ queryKey: ['product-types'], queryFn: productTypesApi.list });
  const subclasses = useQuery({ queryKey: ['product-subclasses'], queryFn: () => subclassesApi.list() });
  const printers = useQuery({ queryKey: ['production-printers'], queryFn: printersApi.list });
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });

  const filters: ProductFilters = {
    q: q.trim() || undefined,
    tipo: tipo || undefined,
    category_id: category || undefined,
    type_id: type || undefined,
    sub_classe_id: subClasse || undefined,
    supplier_id: supplier || undefined,
    created_from: from || undefined,
    created_to: to || undefined,
    cost_min: costMin ? Number(costMin) : undefined,
    cost_max: costMax ? Number(costMax) : undefined,
    sale_min: saleMin ? Number(saleMin) : undefined,
    sale_max: saleMax ? Number(saleMax) : undefined,
    includeInactive: showInactive || undefined,
  };
  const products = useQuery({ queryKey: ['products', filters], queryFn: () => productsApi.list(filters) });

  // Sub-classes visíveis no filtro lateral: todas, ou as da Classe selecionada.
  const subOptions = (subclasses.data ?? []).filter((s) => !type || s.type_id === type);
  const hasFilters = q || type || subClasse || category || supplier || from || to || costMin || costMax || saleMin || saleMax || showInactive;
  function clearFilters() {
    setQ(''); setType(''); setSubClasse(''); setCategory(''); setSupplier(''); setFrom(''); setTo('');
    setCostMin(''); setCostMax(''); setSaleMin(''); setSaleMax(''); setShowInactive(false);
  }
  const remove = useMutation({
    mutationFn: (id: number) => productsApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
    onError: (e) => alert(apiError(e)),
  });

  return (
    <div>
      <PageHeader
        title="Itens & Produtos"
        subtitle={view === 'produtos'
          ? 'Cadastro central do estoque: matéria-prima, uso e consumo, cardápio, bebidas…'
          : 'Itens por fornecedor (preço e código de cada um) usados em cotações e pedidos'}
        action={view === 'produtos' ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setSuggestOpen(true)}><Sparkles size={16} /> Agrupar (IA)</Button>
            <Button variant="secondary" onClick={() => setCatsOpen(true)}><FolderTree size={16} /> Categorias</Button>
            <Button variant="secondary" onClick={() => setTypesOpen(true)}><TagsIcon size={16} /> Classes</Button>
            <Button variant="secondary" onClick={() => setSubsOpen(true)}><Layers size={16} /> Sub-classes</Button>
            <Button variant="secondary" onClick={() => setPrintersOpen(true)}><Printer size={16} /> Impressoras</Button>
            <Button onClick={() => setEditing('new')}><Plus size={16} /> Novo cadastro</Button>
          </div>
        ) : undefined}
      />

      {/* Alternador de visão */}
      <div className="mb-4 inline-flex rounded-lg border border-slate-200 bg-white p-1">
        <SegBtn active={view === 'produtos'} onClick={() => setView('produtos')}>Produtos</SegBtn>
        <SegBtn active={view === 'itens'} onClick={() => setView('itens')}>Itens de fornecedor</SegBtn>
      </div>

      {view === 'itens' ? (
        <Items embedded />
      ) : (
      <>
      {/* Abas por Tipo (eixo fixo, estilo PDV) */}
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg bg-slate-800 p-1">
        <TipoTab active={tipo === ''} onClick={() => setTipo('')} Icon={LayoutGrid} label="TODOS" />
        {TIPOS.map((t) => (
          <TipoTab key={t.value} active={tipo === t.value} onClick={() => setTipo(t.value)} Icon={t.Icon} label={t.label} />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[15rem_1fr]">
        {/* Filtros laterais */}
        <Card className="h-max space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-600"><Filter size={15} /> Filtros</div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Cód / Descrição</label>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar…" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Classe de itens</label>
            <Select value={type} onChange={(e) => { setType(e.target.value ? Number(e.target.value) : ''); setSubClasse(''); }}>
              <option value="">TODAS</option>
              {types.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Sub-classe</label>
            <Select value={subClasse} onChange={(e) => setSubClasse(e.target.value ? Number(e.target.value) : '')}>
              <option value="">TODAS</option>
              {subOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Categoria</label>
            <Select value={category} onChange={(e) => setCategory(e.target.value ? Number(e.target.value) : '')}>
              <option value="">TODAS</option>
              {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Fornecedor</label>
            <Select value={supplier} onChange={(e) => setSupplier(e.target.value ? Number(e.target.value) : '')}>
              <option value="">TODOS</option>
              {suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Custo de compra (R$ min / máx)</label>
            <div className="grid grid-cols-2 gap-2">
              <Input type="number" step="0.01" value={costMin} onChange={(e) => setCostMin(e.target.value)} placeholder="mín" className="min-w-0" />
              <Input type="number" step="0.01" value={costMax} onChange={(e) => setCostMax(e.target.value)} placeholder="máx" className="min-w-0" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Valor de venda (R$ min / máx)</label>
            <div className="grid grid-cols-2 gap-2">
              <Input type="number" step="0.01" value={saleMin} onChange={(e) => setSaleMin(e.target.value)} placeholder="mín" className="min-w-0" />
              <Input type="number" step="0.01" value={saleMax} onChange={(e) => setSaleMax(e.target.value)} placeholder="máx" className="min-w-0" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Cadastrado (de / até)</label>
            <div className="space-y-2">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="min-w-0" />
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="min-w-0" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="h-4 w-4 accent-emerald-600" />
            Exibir desativados
          </label>
          {hasFilters ? <button onClick={clearFilters} className="text-sm text-emerald-600 hover:underline">Limpar filtros</button> : null}
        </Card>

        {/* Lista */}
        <div>
          {products.isLoading && <Spinner />}
          {products.error && <ErrorBox message={apiError(products.error)} />}
          {products.data && (products.data.length === 0 ? (
            <EmptyState message={hasFilters || tipo ? 'Nenhum cadastro com esses filtros.' : 'Nenhum cadastro ainda. Clique em “Novo cadastro”.'} />
          ) : (
            <>
              {/* Mobile: cartões compactos */}
              <div className="space-y-2 sm:hidden">
                {products.data.map((p) => (
                  <Card key={p.id} className="flex items-center justify-between gap-3 p-3">
                    <div className="flex min-w-0 items-center gap-3">
                      {p.image_data
                        ? <img src={p.image_data} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
                        : <div className="h-10 w-10 shrink-0 rounded bg-slate-100" />}
                      <div className="min-w-0">
                      <p className="truncate font-medium text-slate-800"><span className="mr-1 text-xs text-slate-400">{p.id}</span>{p.name}</p>
                      <p className="mt-0.5 truncate text-xs text-slate-500">
                        {p.tipo ?? 'sem tipo'} · {p.type_name ?? 's/ classe'} · {p.unit ?? p.default_unit ?? 's/ un.'}
                      </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <IconBtn title="Situação tributária" onClick={() => setFiscalOf(p)}><Receipt size={16} /></IconBtn>
                      {canMove && <IconBtn title="Movimentar estoque" hover="emerald" onClick={() => setStockOf(p)}><ArrowDownUp size={16} /></IconBtn>}
                      <IconBtn title="Editar" hover="emerald" onClick={() => setEditing(p)}><Pencil size={16} /></IconBtn>
                      <IconBtn title="Excluir" hover="red" onClick={() => { if (confirm(`Excluir o cadastro "${p.name}"?`)) remove.mutate(p.id); }}><Trash2 size={16} /></IconBtn>
                    </div>
                  </Card>
                ))}
                <p className="px-1 pt-1 text-right text-xs font-medium text-slate-500">Itens: {products.data.length}</p>
              </div>

              {/* Desktop: tabela no padrão do PDV */}
              <Card className="hidden overflow-x-auto p-0 sm:block">
                <table className="w-full text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2.5 font-semibold">Cód. Int.</th>
                      <th className="px-3 py-2.5 font-semibold">Descrição interna</th>
                      <th className="px-3 py-2.5 font-semibold">Tipo</th>
                      <th className="px-3 py-2.5 font-semibold">Classe de itens</th>
                      <th className="px-3 py-2.5 font-semibold">Sub-classe</th>
                      <th className="px-3 py-2.5 font-semibold">Un. venda</th>
                      <th className="px-3 py-2.5 font-semibold">Un. compra</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Valor de venda</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Custo médio</th>
                      <th className="px-3 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {products.data.map((p) => {
                      const custo = p.avg_cost ?? p.cost_price;
                      return (
                      <tr key={p.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                        <td className="px-3 py-2.5 font-semibold text-slate-500">{p.id}</td>
                        <td className="px-3 py-2.5 font-medium text-slate-800">
                          <div className="flex items-center gap-2">
                            {p.image_data
                              ? <img src={p.image_data} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
                              : <div className="h-8 w-8 shrink-0 rounded bg-slate-100" />}
                            <span>{p.name}
                              {Number(p.item_count ?? 0) > 0 && <span className="ml-2 text-xs text-slate-400">{p.item_count} item(ns)</span>}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-slate-600">{p.tipo ?? <span className="text-slate-300">—</span>}</td>
                        <td className="px-3 py-2.5 text-slate-600">{p.type_name ?? <span className="text-slate-300">—</span>}</td>
                        <td className="px-3 py-2.5 text-slate-600">{p.sub_classe_name ?? <span className="text-slate-300">—</span>}</td>
                        <td className="px-3 py-2.5 text-emerald-600">{p.unit ?? p.default_unit ?? <span className="text-slate-300">***</span>}</td>
                        <td className="px-3 py-2.5 text-slate-500">{p.purchase_unit ?? <span className="text-slate-300">***</span>}</td>
                        <td className="px-3 py-2.5 text-right font-medium text-slate-800">{p.sale_price != null ? brl(p.sale_price) : <span className="text-slate-300">—</span>}</td>
                        <td className="px-3 py-2.5 text-right text-amber-700">{custo != null ? brl(custo) : <span className="text-slate-300">***</span>}</td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">
                          <button onClick={() => setFiscalOf(p)} className="mr-2 text-slate-400 hover:text-blue-600" title="Situação tributária"><Receipt size={16} /></button>
                          {canMove && <button onClick={() => setStockOf(p)} className="mr-2 text-slate-400 hover:text-emerald-600" title="Movimentar estoque"><ArrowDownUp size={16} /></button>}
                          <button onClick={() => setEditing(p)} className="mr-2 text-slate-400 hover:text-emerald-600" title="Editar"><Pencil size={16} /></button>
                          <button onClick={() => { if (confirm(`Excluir o cadastro "${p.name}"?`)) remove.mutate(p.id); }} className="text-slate-400 hover:text-red-600" title="Excluir"><Trash2 size={16} /></button>
                        </td>
                      </tr>
                    ); })}
                  </tbody>
                </table>
                <div className="border-t border-slate-200 bg-slate-50 px-4 py-2 text-right text-xs font-semibold text-slate-600">Itens: {products.data.length}</div>
              </Card>
            </>
          ))}
        </div>
      </div>

      </>
      )}

      {editing && (
        <ProductForm
          product={editing === 'new' ? null : editing}
          defaultTipo={tipo || undefined}
          types={types.data ?? []}
          subclasses={subclasses.data ?? []}
          printers={printers.data ?? []}
          categories={categories.data ?? []}
          suppliers={suppliers.data ?? []}
          onClose={() => setEditing(null)}
        />
      )}
      {typesOpen && <TypesManager onClose={() => setTypesOpen(false)} />}
      {catsOpen && <CategoriesManager onClose={() => setCatsOpen(false)} />}
      {subsOpen && <SubclassesManager onClose={() => setSubsOpen(false)} />}
      {printersOpen && <PrintersManager onClose={() => setPrintersOpen(false)} />}
      {stockOf && <StockModal product={stockOf} onClose={() => { setStockOf(null); qc.invalidateQueries({ queryKey: ['products'] }); }} />}
      {suggestOpen && <SuggestModal onClose={() => setSuggestOpen(false)} onApplied={() => qc.invalidateQueries({ queryKey: ['products'] })} />}
      {fiscalOf && <FiscalModal product={fiscalOf} onClose={() => setFiscalOf(null)} />}
    </div>
  );
}

const fmtQty = (v?: string | null) => {
  const n = Number(v ?? 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace('.', ',');
};

const MOVE_LABEL: Record<string, string> = { in: 'Entrada', out: 'Saída', adjust: 'Ajuste' };

/** Movimentação de estoque de um produto: form + últimas movimentações. */
function StockModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const qc = useQueryClient();
  const [type, setType] = useState<'in' | 'out' | 'adjust'>('in');
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saldo, setSaldo] = useState(product.stock_qty ?? '0');

  const moves = useQuery({ queryKey: ['stock-moves', product.id], queryFn: () => stockApi.moves(product.id) });
  const save = useMutation({
    mutationFn: () => stockApi.move({
      product_id: product.id, type, quantity: Number(qty.replace(',', '.')),
      unit_cost: type === 'in' && cost ? Number(cost.replace(',', '.')) : null,
      notes: notes.trim() || null,
    }),
    onSuccess: (r: { stock_qty: string }) => {
      setSaldo(r.stock_qty); setQty(''); setCost(''); setNotes(''); setError('');
      moves.refetch(); qc.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (e) => setError(apiError(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const n = Number(qty.replace(',', '.'));
    if (Number.isNaN(n) || (type !== 'adjust' && n <= 0) || n < 0) { setError('Informe uma quantidade válida.'); return; }
    save.mutate();
  }

  const unit = product.unit ?? product.default_unit ?? '';
  return (
    <Modal title={`Estoque — ${product.name}`} onClose={onClose} size="xl">
      <p className="mb-3 text-sm text-slate-600">
        Saldo atual: <strong className={Number(saldo) < 0 ? 'text-red-600' : 'text-slate-800'}>{fmtQty(saldo)} {unit}</strong>
        {product.avg_cost != null && <span className="ml-3 text-slate-400">custo médio {brl(product.avg_cost)}</span>}
      </p>
      <form onSubmit={submit} className="mb-4 space-y-3 rounded-lg border border-slate-200 p-3">
        {error && <ErrorBox message={error} />}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Tipo</span>
            <Select value={type} onChange={(e) => setType(e.target.value as 'in' | 'out' | 'adjust')}>
              <option value="in">Entrada</option>
              <option value="out">Saída</option>
              <option value="adjust">Ajuste (saldo final)</option>
            </Select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">{type === 'adjust' ? 'Novo saldo' : 'Quantidade'}</span>
            <Input value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0" inputMode="decimal" required />
          </label>
          {type === 'in' && (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Custo unit. (R$)</span>
              <Input value={cost} onChange={(e) => setCost(e.target.value)} placeholder="opcional" inputMode="decimal" />
            </label>
          )}
          <label className={`block ${type === 'in' ? '' : 'sm:col-span-2'}`}>
            <span className="mb-1 block text-xs font-medium text-slate-500">Observação</span>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="opcional" />
          </label>
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={save.isPending}>Lançar</Button>
        </div>
      </form>

      <h4 className="mb-2 text-sm font-semibold text-slate-600">Últimas movimentações</h4>
      {moves.isLoading && <Spinner />}
      {moves.data && (moves.data.length === 0 ? (
        <EmptyState message="Nenhuma movimentação ainda." />
      ) : (
        <div className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
          {moves.data.map((m: StockMove) => (
            <div key={m.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <div>
                <span className={`mr-2 rounded px-1.5 py-0.5 text-xs font-semibold ${m.type === 'in' ? 'bg-emerald-50 text-emerald-700' : m.type === 'out' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>{MOVE_LABEL[m.type]}</span>
                <span className={Number(m.qty_delta) < 0 ? 'text-red-600' : 'text-emerald-700'}>{Number(m.qty_delta) > 0 ? '+' : ''}{fmtQty(m.qty_delta)}</span>
                <span className="ml-2 text-xs text-slate-400">
                  saldo {fmtQty(m.balance_after)}{m.unit_cost != null ? ` · ${brl(m.unit_cost)}/un` : ''}{m.ref && m.ref !== 'manual' ? ` · ${m.ref.replace('order:', 'pedido #')}` : ''}
                </span>
                {m.notes && <p className="text-xs text-slate-400">{m.notes}</p>}
              </div>
              <span className="shrink-0 text-xs text-slate-400">{new Date(m.created_at).toLocaleString('pt-BR')}<br />{m.user_name ?? ''}</span>
            </div>
          ))}
        </div>
      ))}
      <div className="mt-4 flex justify-end"><Button variant="secondary" onClick={onClose}>Fechar</Button></div>
    </Modal>
  );
}

function SegBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${active ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
    >
      {children}
    </button>
  );
}

/** Aba de Tipo (barra escura de topo, estilo PDV). */
function TipoTab({ active, onClick, Icon, label }: { active: boolean; onClick: () => void; Icon: LucideIcon; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${active ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-300 hover:bg-slate-700 hover:text-white'}`}
    >
      <Icon size={16} className={active ? 'text-emerald-600' : ''} /> {label}
    </button>
  );
}

// Regimes tributários e operações fiscais de entrada (CFOP) — espelham o PDV.
const REGIMES = ['1 - Simples Nacional', '2 - Simples Nacional (excesso de sublimite)', '3 - Regime Normal'];
const CFOP_ENTRADA: [string, string][] = [
  ['1101', '1101 - Compra Manipulação 18% MG (T)'],
  ['1102', '1102 - Compra para comercialização MG (T)'],
  ['1401', '1401 - Compra Manipulação MG (ST)'],
  ['1403', '1403 - Compra para comercialização MG (ST)'],
  ['1407', '1407 - Compra Uso e Consumo MG ST'],
  ['1551', '1551 - Compra de ativo imobilizado'],
  ['1556', '1556 - Compra para uso e consumo'],
  ['2101', '2101 - Compra Manipulação outros (T)'],
  ['2102', '2102 - Compra para comercialização outros (T)'],
];
// Operações fiscais de SAÍDA. Dentro do estado = 5xxx; fora do estado (interestadual) = 6xxx.
const CFOP_SAIDA_DENTRO: [string, string][] = [
  ['5101', '5101 - Venda de produção do estabelecimento (T)'],
  ['5102', '5102 - Venda de mercadoria de terceiros (T)'],
  ['5103', '5103 - Venda de produção — não contribuinte'],
  ['5405', '5405 - Venda de mercadoria de terceiros (ST)'],
  ['5401', '5401 - Venda de produção sujeita a ST'],
  ['5933', '5933 - Prestação de serviço (ISSQN)'],
];
const CFOP_SAIDA_FORA: [string, string][] = [
  ['6101', '6101 - Venda de produção do estabelecimento (T)'],
  ['6102', '6102 - Venda de mercadoria de terceiros (T)'],
  ['6108', '6108 - Venda de merc. de terceiros — consumidor final'],
  ['6403', '6403 - Venda de produção sujeita a ST'],
  ['6404', '6404 - Venda de mercadoria de terceiros (ST)'],
  ['6933', '6933 - Prestação de serviço (ISSQN)'],
];

// component_id → produto insumo; item_id → item de fornecedor ainda sem produto
// (no save vira um produto matéria-prima); free/component_name → insumo avulso (texto).
type RecipeRow = { component_id: number | ''; item_id?: number; component_name: string; free: boolean; quantity: string; unit: string };
// Variações de ficha técnica (grupos de escolha do PDV)
type VarOptRow = { name: string; component_id: number | ''; quantity: string; price_delta: string };
type VarGroupRow = { name: string; required: boolean; options: VarOptRow[] };

const ORIGENS = [
  ['0', '0 - Nacional'],
  ['1', '1 - Estrangeira (importação direta)'],
  ['2', '2 - Estrangeira (mercado interno)'],
  ['3', '3 - Nacional c/ importação > 40%'],
  ['4', '4 - Nacional (processos produtivos básicos)'],
  ['5', '5 - Nacional c/ importação ≤ 40%'],
  ['6', '6 - Estrangeira (import. direta, s/ similar)'],
  ['7', '7 - Estrangeira (merc. interno, s/ similar)'],
  ['8', '8 - Nacional c/ importação > 70%'],
];

function ProductForm({ product, defaultTipo, types, subclasses, printers, categories, suppliers, onClose }: {
  product: Product | null;
  defaultTipo?: string;
  types: ProductType[];
  subclasses: Subclass[];
  printers: ProductionPrinter[];
  categories: { id: number; name: string }[];
  suppliers: { id: number; name: string }[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  // Informações básicas
  const [name, setName] = useState(product?.name ?? '');
  const [tipo, setTipo] = useState(product?.tipo ?? defaultTipo ?? 'Produto');
  const [typeId, setTypeId] = useState<number | ''>(product?.type_id ?? '');
  const [subClasseId, setSubClasseId] = useState<number | ''>(product?.sub_classe_id ?? '');
  const [categoryId, setCategoryId] = useState<number | ''>(product?.category_id ?? '');
  const [printerId, setPrinterId] = useState<number | ''>(product?.production_printer_id ?? '');
  const [supplierId, setSupplierId] = useState<number | ''>(product?.supplier_id ?? '');
  const [unit, setUnit] = useState(product?.unit ?? '');
  const [purchaseUnit, setPurchaseUnit] = useState(product?.purchase_unit ?? '');
  const [cost, setCost] = useState(product?.cost_price ?? '');
  const [sale, setSale] = useState(product?.sale_price ?? '');
  const [imageData, setImageData] = useState<string | null>(product?.image_data ?? null);
  // Ficha técnica (campos livres)
  const [yieldQty, setYieldQty] = useState(product?.yield_qty ?? '');
  const [yieldUnit, setYieldUnit] = useState(product?.yield_unit ?? '');
  const [prepTime, setPrepTime] = useState(product?.prep_time_min != null ? String(product.prep_time_min) : '');
  const [prepMethod, setPrepMethod] = useState(product?.prep_method ?? '');
  const [techNotes, setTechNotes] = useState(product?.tech_notes ?? '');
  // Ficha técnica (receita)
  const [recipe, setRecipe] = useState<RecipeRow[]>([]);
  // Variações de ficha técnica (grupos de escolha no PDV, ex.: "Proteína" do Executivo)
  const [varGroups, setVarGroups] = useState<VarGroupRow[]>([]);
  // Tributação (situação tributária do item)
  const [origem, setOrigem] = useState(product?.origem ?? '');
  const [ncm, setNcm] = useState(product?.ncm ?? '');
  const [cest, setCest] = useState(product?.cest ?? '');
  const [cfop, setCfop] = useState(product?.cfop ?? '');
  const [cfopSaidaFora, setCfopSaidaFora] = useState(product?.cfop_saida_fora ?? '');
  const [cst, setCst] = useState(product?.cst_csosn ?? '');
  const [gtin, setGtin] = useState(product?.gtin ?? '');
  const [regime, setRegime] = useState(product?.regime_tributario ?? REGIMES[0]);
  const [cfopEntrada, setCfopEntrada] = useState(product?.cfop_entrada ?? '');
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');

  const usesRecipe = usaFichaTecnica(tipo);

  // Catálogo de produtos para escolher insumos da receita (exclui o próprio produto).
  const allProducts = useQuery({ queryKey: ['products'], queryFn: () => productsApi.list() });
  const componentOptions = (allProducts.data ?? []).filter((p) => p.id !== product?.id);
  // Itens de fornecedor ainda SEM produto: também podem ser insumos (viram produto no save).
  const allItems = useQuery({ queryKey: ['items'], queryFn: () => itemsApi.list() });
  const itemById = useMemo(() => new Map((allItems.data ?? []).map((it) => [it.id, it])), [allItems.data]);
  const unmappedItems = (allItems.data ?? []).filter((it) => it.product_id == null);
  // Custo do insumo = custo médio de compra (avg_cost) com fallback ao preço de compra,
  // espelhando a coluna "MÉDIO COMPRA" da ficha técnica do PDV.
  const costById = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of allProducts.data ?? []) {
      const c = p.avg_cost ?? p.cost_price;
      if (c != null) m.set(p.id, Number(c));
    }
    return m;
  }, [allProducts.data]);
  // Custo unitário de uma linha (produto: custo médio; item: preço base).
  const unitCostOf = (r: RecipeRow): number => r.item_id
    ? Number(itemById.get(r.item_id)?.base_price ?? 0)
    : (r.component_id ? costById.get(Number(r.component_id)) ?? 0 : 0);
  // Unidade padrão de cada produto: usada para preencher a coluna "un" automaticamente
  // ao escolher o insumo (deixa de ser digitada à mão).
  const unitByProduct = useMemo(() => {
    const m = new Map<number, string>();
    for (const p of allProducts.data ?? []) {
      const u = p.unit ?? p.default_unit;
      if (u) m.set(p.id, u);
    }
    return m;
  }, [allProducts.data]);

  // Em edição: carrega a receita salva.
  const detail = useQuery({ queryKey: ['product', product?.id], queryFn: () => productsApi.get(product!.id), enabled: !!product });
  useEffect(() => {
    if (detail.data?.recipe) {
      setRecipe(detail.data.recipe.map((r: RecipeLine) => ({
        component_id: r.component_id ?? '',
        component_name: r.component_name ?? '',
        free: r.component_id == null,
        quantity: r.quantity != null ? String(r.quantity) : '',
        unit: r.unit ?? '',
      })));
    }
    if (detail.data?.variation_groups) {
      setVarGroups(detail.data.variation_groups.map((g) => ({
        name: g.name,
        required: g.required,
        options: g.options.map((o) => ({
          name: o.name,
          component_id: o.component_id ?? '',
          quantity: o.quantity != null ? String(o.quantity) : '1',
          price_delta: o.price_delta != null && Number(o.price_delta) !== 0 ? String(o.price_delta) : '',
        })),
      })));
    }
  }, [detail.data]);

  const recipeCost = useMemo(() => recipe.reduce((sum, r) => {
    const q = Number(String(r.quantity).replace(',', '.')) || 0;
    return sum + unitCostOf(r) * q;
  }, 0), [recipe, costById, itemById]); // eslint-disable-line react-hooks/exhaustive-deps

  const emptyRow = (): RecipeRow => ({ component_id: '', component_name: '', free: false, quantity: '', unit: '' });
  const addRow = () => setRecipe((rs) => [...rs, emptyRow()]);
  const setRow = (i: number, patch: Partial<RecipeRow>) => setRecipe((rs) => rs.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const delRow = (i: number) => setRecipe((rs) => rs.filter((_, idx) => idx !== i));
  // Ao escolher um insumo na ÚLTIMA linha, abre outra linha vazia embaixo — assim dá para
  // lançar vários insumos em sequência sem clicar em "Insumo" a cada item.
  const appendIfLast = (i: number) => setRecipe((rs) => i === rs.length - 1 ? [...rs, emptyRow()] : rs);
  // Linha p/ a qual o mini-cadastro de insumo (matéria-prima) está aberto; null = fechado.
  const [newInsumoRow, setNewInsumoRow] = useState<number | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      // Insumos escolhidos a partir de itens de fornecedor (sem produto): cria um produto
      // matéria-prima e vincula o item — mesma lógica da entrada por NF-e.
      let rows = recipe;
      if (usesRecipe) {
        rows = await Promise.all(recipe.map(async (r) => {
          if (!r.item_id) return r;
          const it = itemById.get(r.item_id);
          const np = await productsApi.create({
            name: it?.name ?? 'Insumo',
            tipo: 'Matéria-prima',
            unit: it?.unit ?? null,
            cost_price: it?.base_price != null ? Number(it.base_price) : null,
          });
          await productsApi.assign(np.id, [r.item_id]);
          return { ...r, component_id: np.id, item_id: undefined };
        }));
      }
      const body: ProductInput = {
        name: name.trim(),
        tipo: tipo || null,
        type_id: typeId || null,
        sub_classe_id: subClasseId || null,
        category_id: categoryId || null,
        production_printer_id: printerId || null,
        // Produto manipulado não tem fornecedor principal (os insumos é que têm).
        supplier_id: usesRecipe ? null : (supplierId || null),
        unit: unit.trim() || null,
        // Produto não tem unidade de compra: é produzido, não comprado.
        purchase_unit: usesRecipe ? null : (purchaseUnit.trim() || null),
        // Produto: custo = total da ficha técnica; Mercadoria: preço de compra digitado.
        cost_price: usesRecipe ? (recipeCost > 0 ? recipeCost : null) : numOrNull(String(cost)),
        sale_price: numOrNull(String(sale)),
        yield_qty: numOrNull(String(yieldQty)),
        yield_unit: yieldUnit.trim() || null,
        prep_time_min: prepTime.trim() ? Number(prepTime) : null,
        prep_method: prepMethod.trim() || null,
        tech_notes: techNotes.trim() || null,
        image_data: imageData,
        // Tributação (passo 3)
        origem: origem || null,
        ncm: ncm.trim() || null,
        cest: cest.trim() || null,
        cfop: cfop || null,
        cfop_saida_fora: cfopSaidaFora || null,
        cst_csosn: cst.trim() || null,
        gtin: gtin.trim() || null,
        regime_tributario: regime || null,
        cfop_entrada: cfopEntrada || null,
        // Variações de ficha técnica (só faz sentido com receita).
        variation_groups: !usesRecipe ? [] : varGroups
          .filter((g) => g.name.trim() !== '' && g.options.some((o) => o.name.trim() !== ''))
          .map((g) => ({
            name: g.name.trim(),
            required: g.required,
            options: g.options
              .filter((o) => o.name.trim() !== '')
              .map((o) => ({
                name: o.name.trim(),
                component_id: o.component_id === '' ? null : Number(o.component_id),
                quantity: Number(String(o.quantity).replace(',', '.')) || 1,
                price_delta: Number(String(o.price_delta).replace(',', '.')) || 0,
              })),
          })),
        // Mercadoria não tem ficha técnica: envia lista vazia (limpa receita anterior).
        recipe: !usesRecipe ? [] : rows
          .filter((r) => r.component_id !== '' || r.component_name.trim() !== '')
          .map((r): RecipeLineInput => ({
            component_id: r.component_id === '' ? null : Number(r.component_id),
            component_name: r.component_id === '' ? (r.component_name.trim() || null) : null,
            quantity: Number(String(r.quantity).replace(',', '.')) || 0,
            unit: r.unit.trim() || null,
          })),
      };
      return product ? productsApi.update(product.id, body) : productsApi.create(body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['items'] });
      qc.invalidateQueries({ queryKey: ['unmapped'] });
      if (product) qc.invalidateQueries({ queryKey: ['product', product.id] });
      onClose();
    },
    onError: (e) => setError(apiError(e)),
  });

  // Passos do cadastro. Mercadoria não tem ficha técnica: pula o passo 2.
  const steps = usesRecipe
    ? ['Informações básicas', 'Ficha técnica', 'Tributação']
    : ['Informações básicas', 'Tributação'];
  const idx = Math.min(step, steps.length - 1);
  const current = steps[idx];

  function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    // Enter / botão avança pelos passos; só salva no último.
    if (idx < steps.length - 1) { setStep(idx + 1); return; }
    if (name.trim().length < 1) { setStep(0); setError('Informe o nome.'); return; }
    save.mutate();
  }

  return (
    <>
    <Modal title={product ? 'Editar cadastro' : 'Novo cadastro'} onClose={onClose} size="xl">
      <form onSubmit={submit} className="space-y-5">
        {/* Passos do cadastro */}
        <div className="flex gap-1 border-b border-slate-200">
          {steps.map((label, i) => (
            <TabBtn key={label} active={idx === i} onClick={() => setStep(i)}>{`${i + 1}. ${label}`}</TabBtn>
          ))}
        </div>

        {error && <ErrorBox message={error} />}

        {current === 'Informações básicas' && (
          <div className="space-y-3">
            <div className="flex items-start gap-4">
              <PhotoPicker value={imageData} onChange={setImageData} size={80} label="Foto do produto" maxDim={640} />
              <div className="flex-1">
                <Field label="Nome"><Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus /></Field>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tipo">
                <Select value={tipo} onChange={(e) => setTipo(e.target.value)}>
                  {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
              </Field>
              <Field label="Classe de itens">
                <Select value={typeId} onChange={(e) => { setTypeId(e.target.value ? Number(e.target.value) : ''); setSubClasseId(''); }}>
                  <option value="">—</option>
                  {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
              </Field>
              <Field label="Sub-classe">
                <Select value={subClasseId} onChange={(e) => setSubClasseId(e.target.value ? Number(e.target.value) : '')}>
                  <option value="">—</option>
                  {subclasses.filter((s) => !typeId || s.type_id === typeId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
              <Field label="Categoria">
                <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : '')}>
                  <option value="">—</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label="Impressora de produção">
                <Select value={printerId} onChange={(e) => setPrinterId(e.target.value ? Number(e.target.value) : '')}>
                  <option value="">— nenhuma —</option>
                  {printers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </Field>
              <Field label="Unidade de venda"><Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="un, kg, L, prato…" /></Field>
              {!usesRecipe && (
                <>
                  <Field label="Unidade de compra"><Input value={purchaseUnit} onChange={(e) => setPurchaseUnit(e.target.value)} placeholder="cx, kg, fardo…" /></Field>
                  <Field label="Fornecedor principal">
                    <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : '')}>
                      <option value="">—</option>
                      {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Preço de compra (R$)"><Input type="number" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0,00" /></Field>
                </>
              )}
              {usesRecipe && (
                <Field label="Preço de custo (ficha técnica)">
                  <Input readOnly value={recipeCost > 0 ? brl(recipeCost) : '—'} className="bg-slate-50 text-slate-600" title="Calculado pela ficha técnica (custo médio dos insumos)" />
                </Field>
              )}
              <Field label="Preço de venda (R$)"><Input type="number" step="0.01" value={sale} onChange={(e) => setSale(e.target.value)} placeholder="0,00" /></Field>
            </div>
          </div>
        )}

        {current === 'Ficha técnica' && (
          <div className="space-y-3">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-600">Receita (insumos)</span>
                <Button type="button" variant="secondary" onClick={addRow}><Plus size={15} /> Insumo</Button>
              </div>
              {recipe.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-400">Nenhum insumo. Clique em “Insumo” para montar a receita.</p>
              ) : (
                <div className="space-y-2">
                  {recipe.map((r, i) => {
                    const lineCost = unitCostOf(r) * (Number(String(r.quantity).replace(',', '.')) || 0);
                    return (
                      <div key={i} className="grid grid-cols-[1fr_5rem_4rem_auto] items-center gap-2">
                        {r.free ? (
                          <Input value={r.component_name} onChange={(e) => setRow(i, { component_name: e.target.value })} placeholder="Insumo avulso…" autoFocus />
                        ) : (
                          <Select
                            value={r.item_id ? `item:${r.item_id}` : r.component_id}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v === 'free') { setRow(i, { free: true, component_id: '', item_id: undefined, component_name: '' }); return; }
                              if (v === 'new') { setNewInsumoRow(i); return; }
                              if (v.startsWith('item:')) {
                                const itId = Number(v.slice(5));
                                // Preenche a unidade a partir do insumo (só se ainda vazia — não sobrescreve o que foi digitado).
                                setRow(i, { item_id: itId, component_id: '', component_name: '', unit: r.unit || (itemById.get(itId)?.unit ?? '') });
                              } else {
                                const pid = v ? Number(v) : '';
                                setRow(i, { component_id: pid, item_id: undefined, component_name: '', unit: r.unit || (pid ? unitByProduct.get(pid) ?? '' : '') });
                              }
                              if (v) appendIfLast(i); // escolheu na última linha → abre a próxima
                            }}
                          >
                            <option value="">— escolher insumo —</option>
                            <option value="new">➕ novo insumo (matéria-prima)…</option>
                            <option value="free">✎ digitar avulso</option>
                            {componentOptions.length > 0 && (
                              <optgroup label="Produtos">
                                {componentOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                              </optgroup>
                            )}
                            {unmappedItems.length > 0 && (
                              <optgroup label="Itens de fornecedor">
                                {unmappedItems.map((it) => <option key={`item:${it.id}`} value={`item:${it.id}`}>{it.name}</option>)}
                              </optgroup>
                            )}
                          </Select>
                        )}
                        <Input value={r.quantity} onChange={(e) => setRow(i, { quantity: e.target.value })} placeholder="qtd" inputMode="decimal" className="text-right" />
                        <Input value={r.unit} onChange={(e) => setRow(i, { unit: e.target.value })} placeholder="un" />
                        <div className="flex w-16 items-center justify-end gap-1">
                          {lineCost > 0 && <span className="text-xs text-slate-400">{brl(lineCost)}</span>}
                          <button type="button" onClick={() => delRow(i)} className="text-slate-300 hover:text-red-600" title="Remover"><Trash2 size={15} /></button>
                        </div>
                      </div>
                    );
                  })}
                  {recipeCost > 0 && (
                    <p className="pt-1 text-right text-sm text-slate-600">Custo total da ficha técnica <span className="text-xs text-slate-400">(custo médio de compra)</span>: <strong className="text-slate-800">{brl(recipeCost)}</strong></p>
                  )}
                </div>
              )}
            </div>

            {/* Variações de ficha técnica: grupos de escolha que o PDV mostra na tela de
                observações (ex.: "Proteína" do Executivo — a base é a mesma, muda a proteína). */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-600">
                  Variações <span className="text-xs font-normal text-slate-400">(escolhas no PDV — ex.: proteína do executivo)</span>
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setVarGroups((gs) => [...gs, { name: '', required: true, options: [{ name: '', component_id: '', quantity: '1', price_delta: '' }] }])}
                >
                  <Plus size={15} /> Grupo
                </Button>
              </div>
              {varGroups.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-200 px-3 py-3 text-center text-sm text-slate-400">
                  Sem variações. Crie um grupo (ex.: “Proteína”) com as opções que o PDV deve oferecer.
                </p>
              ) : (
                <div className="space-y-3">
                  {varGroups.map((g, gi) => (
                    <div key={gi} className="rounded-lg border border-slate-200 p-3">
                      <div className="mb-2 flex items-center gap-2">
                        <Input
                          value={g.name}
                          onChange={(e) => setVarGroups((gs) => gs.map((x, i) => i === gi ? { ...x, name: e.target.value } : x))}
                          placeholder="Nome do grupo (ex.: Proteína)"
                        />
                        <label className="flex shrink-0 items-center gap-1.5 text-xs text-slate-600">
                          <input
                            type="checkbox"
                            checked={g.required}
                            onChange={(e) => setVarGroups((gs) => gs.map((x, i) => i === gi ? { ...x, required: e.target.checked } : x))}
                            className="h-4 w-4 accent-emerald-600"
                          />
                          Obrigatório
                        </label>
                        <button
                          type="button"
                          title="Remover grupo"
                          onClick={() => setVarGroups((gs) => gs.filter((_, i) => i !== gi))}
                          className="shrink-0 text-slate-300 hover:text-red-600"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                      <div className="space-y-2">
                        <div className="hidden grid-cols-[1fr_1fr_4rem_5rem_auto] gap-2 text-[11px] font-medium uppercase text-slate-400 sm:grid">
                          <span>Opção</span><span>Baixa no estoque (produto)</span><span>Qtd</span><span>± Preço</span><span />
                        </div>
                        {g.options.map((o, oi) => {
                          const setOpt = (patch: Partial<VarOptRow>) => setVarGroups((gs) => gs.map((x, i) => i === gi
                            ? { ...x, options: x.options.map((y, j) => j === oi ? { ...y, ...patch } : y) }
                            : x));
                          return (
                            <div key={oi} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_4rem_5rem_auto]">
                              <Input value={o.name} onChange={(e) => setOpt({ name: e.target.value })} placeholder="Ex.: Frango grelhado" />
                              <Select
                                value={o.component_id}
                                onChange={(e) => setOpt({ component_id: e.target.value ? Number(e.target.value) : '' })}
                              >
                                <option value="">— não baixa estoque —</option>
                                {componentOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                              </Select>
                              <Input value={o.quantity} onChange={(e) => setOpt({ quantity: e.target.value })} placeholder="1" inputMode="decimal" className="text-right" />
                              <Input value={o.price_delta} onChange={(e) => setOpt({ price_delta: e.target.value })} placeholder="+0,00" inputMode="decimal" className="text-right" />
                              <button
                                type="button"
                                title="Remover opção"
                                onClick={() => setVarGroups((gs) => gs.map((x, i) => i === gi ? { ...x, options: x.options.filter((_, j) => j !== oi) } : x))}
                                className="justify-self-end text-slate-300 hover:text-red-600"
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          );
                        })}
                        <button
                          type="button"
                          onClick={() => setVarGroups((gs) => gs.map((x, i) => i === gi ? { ...x, options: [...x.options, { name: '', component_id: '', quantity: '1', price_delta: '' }] } : x))}
                          className="text-xs font-medium text-emerald-700 underline"
                        >
                          + Opção
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="Rendimento"><Input value={yieldQty} onChange={(e) => setYieldQty(e.target.value)} placeholder="ex.: 10" inputMode="decimal" /></Field>
              <Field label="Unidade do rendimento"><Input value={yieldUnit} onChange={(e) => setYieldUnit(e.target.value)} placeholder="porções, kg…" /></Field>
              <Field label="Tempo de preparo (min)"><Input value={prepTime} onChange={(e) => setPrepTime(e.target.value)} placeholder="min" inputMode="numeric" /></Field>
            </div>
            <Field label="Modo de preparo"><Textarea value={prepMethod} onChange={(e) => setPrepMethod(e.target.value)} rows={3} placeholder="Passo a passo do preparo…" /></Field>
            <Field label="Observações"><Textarea value={techNotes} onChange={(e) => setTechNotes(e.target.value)} rows={2} placeholder="Validade, armazenamento, alergênicos…" /></Field>
          </div>
        )}

        {current === 'Tributação' && (
          <div className="space-y-4">
            <Field label="Origem da mercadoria">
              <Select value={origem} onChange={(e) => setOrigem(e.target.value)}>
                <option value="">—</option>
                {ORIGENS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="NCM"><Input value={ncm} onChange={(e) => setNcm(e.target.value)} placeholder="00000000" maxLength={8} /></Field>
              <Field label="CEST"><Input value={cest} onChange={(e) => setCest(e.target.value)} placeholder="0000000" maxLength={7} /></Field>
              <Field label="CST / CSOSN"><Input value={cst} onChange={(e) => setCst(e.target.value)} placeholder="102" maxLength={4} /></Field>
              <Field label="GTIN / EAN"><Input value={gtin} onChange={(e) => setGtin(e.target.value)} placeholder="cód. de barras" maxLength={14} /></Field>
            </div>
            <Field label="Regime tributário">
              <Select value={regime} onChange={(e) => setRegime(e.target.value)}>
                {REGIMES.map((r) => <option key={r} value={r}>{r}</option>)}
              </Select>
            </Field>
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Operações fiscais de saída</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="SAÍDA — dentro do estado (padrão)">
                  <Select value={cfop} onChange={(e) => setCfop(e.target.value)}>
                    <option value="">—</option>
                    {CFOP_SAIDA_DENTRO.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </Select>
                </Field>
                <Field label="SAÍDA — fora do estado (interestadual)">
                  <Select value={cfopSaidaFora} onChange={(e) => setCfopSaidaFora(e.target.value)}>
                    <option value="">—</option>
                    {CFOP_SAIDA_FORA.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </Select>
                </Field>
              </div>
              <p className="mt-2 text-xs text-slate-400">Aplicado conforme o endereço do cliente da nota. Sem cliente vinculado, usa a saída <span className="font-medium text-slate-500">dentro do estado</span>.</p>
            </div>
            <Field label="Operação fiscal — ENTRADA (Compras)">
              <Select value={cfopEntrada} onChange={(e) => setCfopEntrada(e.target.value)}>
                <option value="">—</option>
                {CFOP_ENTRADA.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </Field>
            <p className="text-xs text-red-500">ATENÇÃO: o preenchimento da situação tributária é de responsabilidade do usuário. Em caso de dúvida, consulte seu contador.</p>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <div className="flex gap-2">
            {idx > 0 && <Button type="button" variant="secondary" onClick={() => setStep(idx - 1)}>Voltar</Button>}
            {idx < steps.length - 1
              ? <Button type="button" onClick={() => setStep(idx + 1)}>Próximo</Button>
              : <Button type="submit" disabled={save.isPending}>Salvar</Button>}
          </div>
        </div>
      </form>
    </Modal>
    {newInsumoRow !== null && (
      <NewInsumoModal
        onClose={() => setNewInsumoRow(null)}
        onCreated={(p) => {
          const row = recipe[newInsumoRow];
          setRow(newInsumoRow, { component_id: p.id, item_id: undefined, component_name: '', free: false, unit: (row?.unit || p.unit) ?? '' });
          appendIfLast(newInsumoRow);
        }}
      />
    )}
    </>
  );
}

/** Mini-cadastro de insumo (matéria-prima) direto da ficha técnica — evita sair do form. */
function NewInsumoModal({ onClose, onCreated }: { onClose: () => void; onCreated: (p: Product) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [cost, setCost] = useState('');
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: () => productsApi.create({
      name: name.trim(),
      tipo: 'Matéria-prima',
      unit: unit.trim() || null,
      cost_price: cost.trim() ? Number(cost.replace(',', '.')) : null,
    }),
    onSuccess: (p) => { qc.invalidateQueries({ queryKey: ['products'] }); onCreated(p as Product); onClose(); },
    onError: (e) => setError(apiError(e)),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim().length < 1) { setError('Informe o nome do insumo.'); return; }
    save.mutate();
  }
  return (
    <Modal title="Novo insumo (matéria-prima)" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {error && <ErrorBox message={error} />}
        <Field label="Nome"><Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus placeholder="Ex.: Filé de frango" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Unidade"><Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="kg, g, un, L…" /></Field>
          <Field label="Custo de compra (R$)"><Input value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0,00" inputMode="decimal" /></Field>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={save.isPending}>Criar e usar</Button>
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

/** Modal "Atualizar situação tributária" — abas Dados fiscais + Operações fiscais. */
function FiscalModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'dados' | 'operacoes'>('dados');
  const [origem, setOrigem] = useState(product.origem ?? '');
  const [ncm, setNcm] = useState(product.ncm ?? '');
  const [cest, setCest] = useState(product.cest ?? '');
  const [cfop, setCfop] = useState(product.cfop ?? '');
  const [cfopSaidaFora, setCfopSaidaFora] = useState(product.cfop_saida_fora ?? '');
  const [cst, setCst] = useState(product.cst_csosn ?? '');
  const [gtin, setGtin] = useState(product.gtin ?? '');
  const [regime, setRegime] = useState(product.regime_tributario ?? REGIMES[0]);
  const [cfopEntrada, setCfopEntrada] = useState(product.cfop_entrada ?? '');
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: () => productsApi.update(product.id, {
      origem: origem || null, ncm: ncm.trim() || null, cest: cest.trim() || null,
      cfop: cfop || null, cfop_saida_fora: cfopSaidaFora || null, cst_csosn: cst.trim() || null, gtin: gtin.trim() || null,
      regime_tributario: regime || null, cfop_entrada: cfopEntrada || null,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['products'] }); onClose(); },
    onError: (e) => setError(apiError(e)),
  });

  return (
    <Modal title="Atualizar a situação tributária do item" onClose={onClose} size="xl">
      {/* Abas */}
      <div className="mb-4 flex gap-1 border-b border-slate-200">
        <TabBtn active={tab === 'dados'} onClick={() => setTab('dados')}>Dados fiscais do item</TabBtn>
        <TabBtn active={tab === 'operacoes'} onClick={() => setTab('operacoes')}>Operações fiscais / Tributação</TabBtn>
      </div>

      {error && <ErrorBox message={error} />}

      {/* Cabeçalho: dados do item */}
      <div className="mb-4 grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-3 text-sm">
        <div><span className="block text-xs text-slate-400">Tipo</span><span className="font-medium text-slate-700">{product.tipo ?? '—'}</span></div>
        <div><span className="block text-xs text-slate-400">Código</span><span className="font-medium text-slate-700">{product.id}</span></div>
        <div><span className="block text-xs text-slate-400">Descrição</span><span className="font-medium text-blue-700">{product.name}</span></div>
      </div>

      {tab === 'dados' ? (
        <div className="space-y-4">
          <Field label="Origem da mercadoria">
            <Select value={origem} onChange={(e) => setOrigem(e.target.value)}>
              <option value="">—</option>
              {ORIGENS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="NCM"><Input value={ncm} onChange={(e) => setNcm(e.target.value)} placeholder="00000000" maxLength={8} /></Field>
            <Field label="CEST"><Input value={cest} onChange={(e) => setCest(e.target.value)} placeholder="0000000" maxLength={7} /></Field>
            <Field label="CST / CSOSN"><Input value={cst} onChange={(e) => setCst(e.target.value)} placeholder="102" maxLength={4} /></Field>
            <Field label="GTIN / EAN"><Input value={gtin} onChange={(e) => setGtin(e.target.value)} placeholder="cód. de barras" maxLength={14} /></Field>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="Regime tributário">
            <Select value={regime} onChange={(e) => setRegime(e.target.value)}>
              {REGIMES.map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          </Field>
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Operações fiscais de saída</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="SAÍDA — dentro do estado (padrão)">
                <Select value={cfop} onChange={(e) => setCfop(e.target.value)}>
                  <option value="">—</option>
                  {CFOP_SAIDA_DENTRO.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
              </Field>
              <Field label="SAÍDA — fora do estado (interestadual)">
                <Select value={cfopSaidaFora} onChange={(e) => setCfopSaidaFora(e.target.value)}>
                  <option value="">—</option>
                  {CFOP_SAIDA_FORA.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
              </Field>
            </div>
            <p className="mt-2 text-xs text-slate-400">Aplicado conforme o endereço do cliente da nota. Sem cliente vinculado, usa a saída <span className="font-medium text-slate-500">dentro do estado</span>.</p>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Operação fiscal de entrada</p>
            <Field label="ENTRADA (Compras)">
              <Select value={cfopEntrada} onChange={(e) => setCfopEntrada(e.target.value)}>
                <option value="">—</option>
                {CFOP_ENTRADA.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </Field>
          </div>
        </div>
      )}

      <p className="mt-4 text-xs text-red-500">ATENÇÃO: O preenchimento das informações da situação tributária é de responsabilidade do usuário. Em caso de dúvida, consulte seu contador.</p>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button onClick={() => save.mutate()} disabled={save.isPending}><Check size={16} /> Atualizar</Button>
      </div>
    </Modal>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${active ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
    >
      {children}
    </button>
  );
}

/** Gestor de sub-classes (filhas de uma Classe). */
function SubclassesManager({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const subs = useQuery({ queryKey: ['product-subclasses'], queryFn: () => subclassesApi.list() });
  const types = useQuery({ queryKey: ['product-types'], queryFn: productTypesApi.list });
  const [name, setName] = useState('');
  const [typeId, setTypeId] = useState<number | ''>('');
  const invalidate = () => { qc.invalidateQueries({ queryKey: ['product-subclasses'] }); qc.invalidateQueries({ queryKey: ['products'] }); };
  const create = useMutation({ mutationFn: () => subclassesApi.create({ name: name.trim(), type_id: typeId || null }), onSuccess: () => { setName(''); invalidate(); }, onError: (e) => alert(apiError(e)) });
  const remove = useMutation({ mutationFn: (id: number) => subclassesApi.remove(id), onSuccess: invalidate, onError: (e) => alert(apiError(e)) });

  return (
    <Modal title="Sub-classes" onClose={onClose}>
      <p className="mb-3 text-sm text-slate-500">Subdivisão de uma Classe de itens (ex.: Classe "Refeição" → Sub-classe "Executivo").</p>
      <div className="mb-3 grid grid-cols-[1fr_auto] gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nova sub-classe…" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (name.trim()) create.mutate(); } }} />
        <Button onClick={() => name.trim() && create.mutate()} disabled={create.isPending}><Plus size={16} /></Button>
        <Select value={typeId} onChange={(e) => setTypeId(e.target.value ? Number(e.target.value) : '')} className="col-span-2">
          <option value="">— sem classe (solta) —</option>
          {types.data?.map((t) => <option key={t.id} value={t.id}>Classe: {t.name}</option>)}
        </Select>
      </div>
      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {subs.data?.map((s) => (
          <div key={s.id} className="flex items-center justify-between px-4 py-2.5">
            <span className="text-slate-800">{s.name} {s.type_name && <span className="ml-1 text-xs text-slate-400">· {s.type_name}</span>}</span>
            <button onClick={() => { if (confirm(`Excluir a sub-classe "${s.name}"?`)) remove.mutate(s.id); }} className="text-slate-400 hover:text-red-600"><Trash2 size={16} /></button>
          </div>
        ))}
        {subs.data?.length === 0 && <p className="px-4 py-3 text-sm text-slate-400">Nenhuma sub-classe.</p>}
      </div>
    </Modal>
  );
}

/** Gestor de impressoras de produção (direcionamento de impressão dos pedidos). */
function PrintersManager({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const printers = useQuery({ queryKey: ['production-printers'], queryFn: printersApi.list });
  const [name, setName] = useState('');
  const invalidate = () => { qc.invalidateQueries({ queryKey: ['production-printers'] }); qc.invalidateQueries({ queryKey: ['products'] }); };
  const create = useMutation({ mutationFn: () => printersApi.create({ name: name.trim() }), onSuccess: () => { setName(''); invalidate(); }, onError: (e) => alert(apiError(e)) });
  const remove = useMutation({ mutationFn: (id: number) => printersApi.remove(id), onSuccess: invalidate, onError: (e) => alert(apiError(e)) });

  return (
    <Modal title="Impressoras de produção" onClose={onClose}>
      <p className="mb-3 text-sm text-slate-500">Para onde os pedidos deste item serão impressos (ex.: Cozinha, Bar, Chapa). Usado pelo futuro módulo de vendas.</p>
      <div className="mb-3 flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nova impressora…" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (name.trim()) create.mutate(); } }} />
        <Button onClick={() => name.trim() && create.mutate()} disabled={create.isPending}><Plus size={16} /></Button>
      </div>
      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {printers.data?.map((p) => (
          <div key={p.id} className="flex items-center justify-between px-4 py-2.5">
            <span className="flex items-center gap-2 text-slate-800"><Printer size={15} className="text-slate-400" /> {p.name}</span>
            <button onClick={() => { if (confirm(`Excluir a impressora "${p.name}"? Os itens ficam sem impressora.`)) remove.mutate(p.id); }} className="text-slate-400 hover:text-red-600"><Trash2 size={16} /></button>
          </div>
        ))}
        {printers.data?.length === 0 && <p className="px-4 py-3 text-sm text-slate-400">Nenhuma impressora cadastrada.</p>}
      </div>
    </Modal>
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
    <Modal title="Classes de produto" onClose={onClose}>
      <p className="mb-3 text-sm text-slate-500">Classificação usada no cadastro e nos filtros (matéria-prima, uso e consumo, cardápio, bebida…).</p>
      <div className="mb-3 flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nova classe…" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (name.trim()) create.mutate(); } }} />
        <Button onClick={() => name.trim() && create.mutate()} disabled={create.isPending}><Plus size={16} /></Button>
      </div>
      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {types.data?.map((t) => (
          <div key={t.id} className="flex items-center justify-between px-4 py-2.5">
            <span className="text-slate-800">{t.name}</span>
            <button onClick={() => { if (confirm(`Excluir a classe "${t.name}"? Os produtos ficam sem classe.`)) remove.mutate(t.id); }} className="text-slate-400 hover:text-red-600"><Trash2 size={16} /></button>
          </div>
        ))}
        {types.data?.length === 0 && <p className="px-4 py-3 text-sm text-slate-400">Nenhuma classe.</p>}
      </div>
    </Modal>
  );
}

/** Gestor de categorias (eixo do topo do cadastro): criar, renomear e excluir. */
function CategoriesManager({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const cats = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.list });
  const [name, setName] = useState('');
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const invalidate = () => { qc.invalidateQueries({ queryKey: ['categories'] }); qc.invalidateQueries({ queryKey: ['products'] }); };
  const create = useMutation({ mutationFn: () => categoriesApi.create({ name: name.trim() }), onSuccess: () => { setName(''); invalidate(); }, onError: (e) => alert(apiError(e)) });
  const update = useMutation({ mutationFn: () => categoriesApi.update(editId!, { name: editName.trim() }), onSuccess: () => { setEditId(null); setEditName(''); invalidate(); }, onError: (e) => alert(apiError(e)) });
  const remove = useMutation({ mutationFn: (id: number) => categoriesApi.remove(id), onSuccess: invalidate, onError: (e) => alert(apiError(e)) });

  return (
    <Modal title="Categorias" onClose={onClose}>
      <p className="mb-3 text-sm text-slate-500">Filtro do topo do cadastro. Um produto pertence a uma categoria (ex.: Carnes, Hortifruti, Bebidas…).</p>
      <div className="mb-3 flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nova categoria…" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (name.trim()) create.mutate(); } }} />
        <Button onClick={() => name.trim() && create.mutate()} disabled={create.isPending}><Plus size={16} /></Button>
      </div>
      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {cats.data?.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
            {editId === c.id ? (
              <>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (editName.trim()) update.mutate(); } }} />
                <Button onClick={() => editName.trim() && update.mutate()} disabled={update.isPending}><Check size={16} /></Button>
                <Button variant="secondary" onClick={() => { setEditId(null); setEditName(''); }}>Cancelar</Button>
              </>
            ) : (
              <>
                <span className="text-slate-800">{c.name}</span>
                <div className="flex shrink-0 items-center gap-1">
                  <button onClick={() => { setEditId(c.id); setEditName(c.name); }} className="text-slate-400 hover:text-emerald-600" title="Renomear"><Pencil size={16} /></button>
                  <button onClick={() => { if (confirm(`Excluir a categoria "${c.name}"? Os produtos ficam sem categoria.`)) remove.mutate(c.id); }} className="text-slate-400 hover:text-red-600" title="Excluir"><Trash2 size={16} /></button>
                </div>
              </>
            )}
          </div>
        ))}
        {cats.data?.length === 0 && <p className="px-4 py-3 text-sm text-slate-400">Nenhuma categoria.</p>}
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
