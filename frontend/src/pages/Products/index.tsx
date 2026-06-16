import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Combine, Trash2, X, Sparkles, ChevronDown, ChevronRight, Check } from 'lucide-react';
import { productsApi, SuggestedGroup } from '../../services/resources';
import { apiError } from '../../services/api';
import { brl } from '../../utils/format';
import { PageHeader } from '../../components/PageHeader';
import { Button, Card, Input, Select, Modal, Spinner, ErrorBox, EmptyState } from '../../components/ui';

export function Products() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [target, setTarget] = useState('');        // id do produto existente ou 'new'
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');
  const [suggestOpen, setSuggestOpen] = useState(false);

  const products = useQuery({ queryKey: ['products'], queryFn: productsApi.list });
  const unmapped = useQuery({ queryKey: ['unmapped'], queryFn: productsApi.unmapped });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['products'] });
    qc.invalidateQueries({ queryKey: ['unmapped'] });
    qc.invalidateQueries({ queryKey: ['items'] });
    setSelected(new Set());
  };

  const assign = useMutation({
    mutationFn: async () => {
      let productId = Number(target);
      if (target === 'new') {
        const p = await productsApi.create(newName.trim());
        productId = p.id;
      }
      return productsApi.assign(productId, [...selected]);
    },
    onSuccess: () => { setNewName(''); setError(''); refresh(); },
    onError: (e) => setError(apiError(e)),
  });

  function doAssign() {
    setError('');
    if (!selected.size) { setError('Selecione itens para agrupar'); return; }
    if (!target) { setError('Escolha o produto de destino'); return; }
    if (target === 'new' && !newName.trim()) { setError('Dê um nome ao novo produto'); return; }
    assign.mutate();
  }

  const q = search.trim().toLowerCase();
  const filteredUnmapped = (unmapped.data ?? []).filter((i) => !q || i.name.toLowerCase().includes(q));

  function toggle(id: number) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  return (
    <div>
      <PageHeader
        title="Produtos"
        subtitle="Agrupe itens equivalentes de fornecedores diferentes para comparar preços"
        action={<Button variant="secondary" onClick={() => setSuggestOpen(true)}><Sparkles size={16} /> Sugerir agrupamentos (IA)</Button>}
      />

      {error && <div className="mb-3"><ErrorBox message={error} /></div>}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Produtos canônicos */}
        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Produtos ({products.data?.length ?? 0})</h2>
          {products.isLoading && <Spinner />}
          {products.data && (products.data.length === 0 ? (
            <EmptyState message="Nenhum produto ainda. Agrupe itens ao lado para criar." />
          ) : (
            <div className="space-y-2">
              {products.data.map((p) => <ProductCard key={p.id} id={p.id} name={p.name} count={Number(p.item_count ?? 0)} onChanged={refresh} />)}
            </div>
          ))}
        </div>

        {/* Itens não relacionados */}
        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Não relacionados ({unmapped.data?.length ?? 0})
          </h2>

          <Card className="mb-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Select value={target} onChange={(e) => setTarget(e.target.value)} className="flex-1">
                <option value="">— vincular {selected.size} item(ns) a… —</option>
                <option value="new">+ novo produto</option>
                {products.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
              <Button onClick={doAssign} disabled={assign.isPending || !selected.size}><Combine size={16} /> Vincular</Button>
            </div>
            {target === 'new' && <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nome do novo produto (ex.: Acém)" autoFocus />}
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar item…" />
          </Card>

          {unmapped.isLoading && <Spinner />}
          {unmapped.data && (filteredUnmapped.length === 0 ? (
            <EmptyState message="Nenhum item não relacionado." />
          ) : (
            <Card className="max-h-[60vh] overflow-y-auto p-0">
              <table className="w-full text-sm">
                <tbody>
                  {filteredUnmapped.map((it) => (
                    <tr key={it.id} className="border-b border-slate-50 last:border-0">
                      <td className="w-10 px-4 py-2"><input type="checkbox" checked={selected.has(it.id)} onChange={() => toggle(it.id)} className="h-4 w-4 accent-emerald-600" /></td>
                      <td className="py-2 font-medium text-slate-800">{it.name} <span className="text-xs text-slate-400">({it.unit})</span></td>
                      <td className="py-2 pr-4 text-right text-xs text-slate-400">{it.supplier_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ))}
        </div>
      </div>

      {suggestOpen && <SuggestModal onClose={() => setSuggestOpen(false)} onApplied={refresh} />}
    </div>
  );
}

function ProductCard({ id, name, count, onChanged }: { id: number; name: string; count: number; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const detail = useQuery({ queryKey: ['product', id], queryFn: () => productsApi.get(id), enabled: open });
  const unassign = useMutation({ mutationFn: (itemId: number) => productsApi.unassign([itemId]), onSuccess: () => { detail.refetch(); onChanged(); } });
  const remove = useMutation({ mutationFn: () => productsApi.remove(id), onSuccess: onChanged });

  return (
    <Card className="p-0">
      <div className="flex items-center justify-between px-4 py-3">
        <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 font-medium text-slate-800">
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          {name} <span className="text-xs font-normal text-slate-400">({count} {count === 1 ? 'item' : 'itens'})</span>
        </button>
        <button onClick={() => confirm(`Excluir o produto "${name}"? Os itens serão desvinculados.`) && remove.mutate()} className="text-slate-400 hover:text-red-600"><Trash2 size={15} /></button>
      </div>
      {open && (
        <div className="border-t border-slate-100 px-4 py-2">
          {detail.isLoading && <p className="py-2 text-sm text-slate-400">carregando…</p>}
          {detail.data?.items.length === 0 && <p className="py-2 text-sm text-slate-400">Nenhum item vinculado.</p>}
          {detail.data?.items.map((it) => (
            <div key={it.id} className="flex items-center justify-between py-1 text-sm">
              <span className="text-slate-700">{it.name} <span className="text-xs text-slate-400">· {it.supplier_name}</span></span>
              <span className="flex items-center gap-2 text-slate-500">{brl(it.base_price)}
                <button onClick={() => unassign.mutate(it.id)} className="text-slate-300 hover:text-red-600" title="desvincular"><X size={14} /></button>
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function SuggestModal({ onClose, onApplied }: { onClose: () => void; onApplied: () => void }) {
  const suggest = useQuery({ queryKey: ['suggest'], queryFn: productsApi.suggest });
  return (
    <Modal title="Sugestões de agrupamento (IA)" onClose={onClose} size="xl">
      <p className="mb-3 text-sm text-slate-500">
        A IA local propôs os grupos abaixo. <strong>Revise</strong> — ela pode errar. Ajuste o nome, desmarque itens errados e confirme os que fizerem sentido.
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
      <div className="mt-4 flex justify-end">
        <Button variant="secondary" onClick={onClose}>Fechar</Button>
      </div>
    </Modal>
  );
}

function SuggestionGroup({ group, onApplied }: { group: SuggestedGroup; onApplied: () => void }) {
  const [name, setName] = useState(group.suggested_name);
  const [chosen, setChosen] = useState<Set<number>>(new Set(group.item_ids));
  const [done, setDone] = useState(false);

  const apply = useMutation({
    mutationFn: async () => {
      const p = await productsApi.create(name.trim());
      return productsApi.assign(p.id, [...chosen]);
    },
    onSuccess: () => { setDone(true); onApplied(); },
  });

  function toggle(id: number) {
    setChosen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  if (done) return <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">✓ Produto "{name}" criado.</div>;

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="mb-2 flex items-center gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} className="max-w-xs" />
        <Button onClick={() => apply.mutate()} disabled={apply.isPending || chosen.size < 1 || !name.trim()}>
          <Check size={15} /> Criar e vincular
        </Button>
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
