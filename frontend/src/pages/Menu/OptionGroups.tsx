import { FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Pencil, Pause, Play, Search, Layers, Merge, Utensils } from 'lucide-react';
import { menuApi, optionGroupsApi, productsApi } from '../../services/resources';
import { apiError } from '../../services/api';
import type { MenuOptionGroup, MenuOptionGroupInput } from '../../types';
import { PageHeader } from '../../components/PageHeader';
import { Button, Card, Field, Input, Select, Spinner, ErrorBox, EmptyState, Modal } from '../../components/ui';
import { PhotoPicker } from '../../components/PhotoPicker';
import { brl, parseNum, numToInput } from '../../utils/format';

const isOn = (v: number | boolean) => Boolean(Number(v));

/**
 * Módulo de Complementos: as classes ("Escolha sua proteína", "Acompanhamentos") são
 * da loja, não do prato. Um item USA a classe; mudar a classe aqui — incluir opção,
 * pausar, mudar preço — vale na hora em todos os itens que a usam.
 */
export function OptionGroupsPage() {
  const qc = useQueryClient();
  const groups = useQuery({ queryKey: ['option-groups'], queryFn: optionGroupsApi.list });
  const tree = useQuery({ queryKey: ['menu-tree'], queryFn: menuApi.tree });
  const [editing, setEditing] = useState<MenuOptionGroup | null | 'new'>(null);
  const [search, setSearch] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['option-groups'] });
    qc.invalidateQueries({ queryKey: ['menu-tree'] });
  };

  // Todos os itens do cardápio (para o seletor "usada nestes itens").
  const allItems = useMemo(
    () => (tree.data ?? []).flatMap((c) => c.items.map((i) => ({ id: i.id, name: i.name, category: c.name }))),
    [tree.data],
  );

  const merge = useMutation({
    mutationFn: (dryRun: boolean) => optionGroupsApi.mergeDuplicates(dryRun),
    onSuccess: (r) => {
      setErr('');
      if (r.classes_unificadas === 0) {
        setMsg('Nenhuma classe duplicada encontrada — o cardápio já está sem repetição.');
        return;
      }
      if (r.dry_run) {
        const nomes = r.detalhe.map((d) => `${d.name} (${d.removed.length + 1}→1)`).join(', ');
        if (window.confirm(`Unificar ${r.classes_unificadas} classe(s) duplicada(s)?\n\n${nomes}\n\nOs itens que usavam as cópias passam a usar a mesma classe.`)) {
          merge.mutate(false);
        }
        return;
      }
      setMsg(`${r.classes_unificadas} classe(s) unificada(s); ${r.classes_removidas} cópia(s) removida(s).`);
      invalidate();
    },
    onError: (e) => { setMsg(''); setErr(apiError(e)); },
  });

  const term = search.trim().toLowerCase();
  const visible = (groups.data ?? []).filter(
    (g) => !term || g.name.toLowerCase().includes(term) || g.options.some((o) => o.name.toLowerCase().includes(term)),
  );
  const orphans = (groups.data ?? []).filter((g) => (g.used_in ?? 0) === 0).length;

  return (
    <div>
      <PageHeader
        title="Complementos"
        subtitle="Classes reutilizáveis — monte a lista de proteínas uma vez e use em todos os pratos"
      />

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar classe ou complemento" className="pl-9" />
          </div>
          <Button type="button" variant="ghost" disabled={merge.isPending} onClick={() => { setMsg(''); merge.mutate(true); }}>
            <Merge size={16} /> Unificar duplicadas
          </Button>
          <Button type="button" onClick={() => setEditing('new')}><Plus size={16} /> Nova classe</Button>
        </div>
        {msg && <p className="mt-2 text-xs text-emerald-700">{msg}</p>}
        {err && <div className="mt-2"><ErrorBox message={err} /></div>}
        <p className="mt-2 text-xs text-slate-400">
          Alterar uma classe (incluir complemento, pausar, mudar preço) vale na hora em todos os itens que a usam.
          Para refletir nas plataformas, publique o cardápio.
        </p>
      </Card>

      {orphans > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="font-semibold">{orphans} {orphans === 1 ? 'classe não está' : 'classes não estão'} em uso</span> —
          nenhum item do cardápio usa {orphans === 1 ? 'essa classe' : 'essas classes'}. Aplique a algum item ou exclua.
        </div>
      )}

      {(groups.isLoading || tree.isLoading) && <Spinner />}
      {groups.error && <ErrorBox message={apiError(groups.error)} />}

      {groups.data && visible.length === 0 && (
        <EmptyState message={term ? 'Nenhuma classe encontrada para essa busca.' : 'Nenhuma classe de complementos ainda. Crie a primeira (ex.: "Escolha sua proteína").'} />
      )}

      <div className="space-y-3">
        {visible.map((g) => <GroupCard key={g.id} group={g} onChanged={invalidate} onEdit={() => setEditing(g)} />)}
      </div>

      {editing && (
        <GroupModal
          group={editing === 'new' ? null : editing}
          allItems={allItems}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); invalidate(); }}
        />
      )}
    </div>
  );
}

function GroupCard({ group, onChanged, onEdit }: { group: MenuOptionGroup; onChanged: () => void; onEdit: () => void }) {
  const [open, setOpen] = useState(false);
  const active = isOn(group.active);
  const usedIn = group.used_in ?? 0;
  const avail = useMutation({ mutationFn: (a: boolean) => optionGroupsApi.update(group.id, { active: a }), onSuccess: onChanged });
  const optAvail = useMutation({
    mutationFn: ({ id, a }: { id: number; a: boolean }) => menuApi.setOptionAvailability(id, a),
    onSuccess: onChanged,
  });

  return (
    <Card className={active ? '' : 'opacity-70'}>
      <div className="flex flex-wrap items-center gap-2">
        <Layers size={16} className="shrink-0 text-slate-400" />
        <button onClick={onEdit} className="text-sm font-bold text-slate-800 hover:text-emerald-700">{group.name}</button>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${group.min >= 1 ? 'bg-slate-800 text-white' : 'bg-slate-200 text-slate-600'}`}>
          {group.min >= 1 ? 'Obrigatório' : 'Opcional'}
        </span>
        <span className="text-xs text-slate-400">mín {group.min} · máx {group.max} · {group.options.length} {group.options.length === 1 ? 'complemento' : 'complementos'}</span>
        <span
          className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${usedIn > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}
          title={usedIn > 0 ? (group.items ?? []).map((i) => i.name).join(', ') : 'Nenhum item usa esta classe'}
        >
          <Utensils size={11} /> {usedIn > 0 ? `usada em ${usedIn} ${usedIn === 1 ? 'item' : 'itens'}` : 'sem uso'}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setOpen((v) => !v)} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50">
            {open ? 'Ocultar' : 'Ver complementos'}
          </button>
          <button onClick={onEdit} className="text-slate-300 hover:text-slate-600" title="Editar classe"><Pencil size={15} /></button>
          <button
            type="button"
            disabled={avail.isPending}
            onClick={() => avail.mutate(!active)}
            title={active ? `Pausar em ${usedIn} ${usedIn === 1 ? 'item' : 'itens'}` : 'Ativar'}
            className={`flex h-8 w-8 items-center justify-center rounded-lg border transition disabled:opacity-40 ${
              active ? 'border-slate-200 text-slate-500 hover:bg-slate-50' : 'border-amber-300 bg-amber-50 text-amber-600 hover:bg-amber-100'
            }`}
          >
            {active ? <Pause size={15} /> : <Play size={15} />}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-3 space-y-3">
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {group.options.length === 0 && <p className="px-3 py-2 text-xs text-slate-400">Sem complementos nesta classe.</p>}
            {group.options.map((o) => {
              const oActive = isOn(o.active);
              return (
                <div key={o.id} className={`flex items-center gap-3 px-3 py-2 ${oActive ? '' : 'opacity-55'}`}>
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{o.name}</span>
                  {o.erp_product_name ? (
                    <span className="shrink-0 truncate rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                      {o.erp_product_name}{Number(o.erp_qty ?? 1) !== 1 ? ` · ${numToInput(o.erp_qty)}${o.erp_product_unit ? ` ${o.erp_product_unit}` : ''}` : ''}
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700" title="Sem produto do ERP: não dá baixa de estoque">
                      sem estoque
                    </span>
                  )}
                  <span className="w-24 shrink-0 text-right text-sm text-slate-500">{Number(o.price) > 0 ? brl(o.price) : 'Incluso'}</span>
                  <button
                    type="button"
                    disabled={optAvail.isPending}
                    onClick={() => optAvail.mutate({ id: o.id, a: !oActive })}
                    title={oActive ? `Pausar em ${usedIn} ${usedIn === 1 ? 'item' : 'itens'}` : 'Ativar'}
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition disabled:opacity-40 ${
                      oActive ? 'border-slate-200 text-slate-500 hover:bg-slate-50' : 'border-amber-300 bg-amber-50 text-amber-600 hover:bg-amber-100'
                    }`}
                  >
                    {oActive ? <Pause size={15} /> : <Play size={15} />}
                  </button>
                </div>
              );
            })}
          </div>
          {(group.items ?? []).length > 0 && (
            <p className="text-xs text-slate-400">
              Usada em: {(group.items ?? []).map((i) => i.name).join(' · ')}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

interface OptionDraft {
  id?: number;
  name: string;
  price: string;
  image_data: string | null;
  active: boolean;
  erp_product_id: number | '';
  erp_qty: string;
}

function GroupModal({
  group, allItems, onClose, onSaved,
}: {
  group: MenuOptionGroup | null;
  allItems: { id: number; name: string; category: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(group?.name ?? '');
  const [min, setMin] = useState(group?.min ?? 0);
  const [max, setMax] = useState(group?.max ?? 1);
  const [itemIds, setItemIds] = useState<number[]>((group?.items ?? []).map((i) => i.id));
  const [options, setOptions] = useState<OptionDraft[]>(
    (group?.options ?? []).map((o) => ({
      id: o.id,
      name: o.name,
      price: numToInput(o.price),
      image_data: o.image_data ?? null,
      active: o.active === undefined ? true : Boolean(Number(o.active)),
      erp_product_id: o.erp_product_id ?? '',
      erp_qty: numToInput(o.erp_qty ?? 1),
    })),
  );
  const [err, setErr] = useState('');
  const { data: erpProducts } = useQuery({ queryKey: ['products'], queryFn: () => productsApi.list() });
  const unitOf = (id: number | '') => (id === '' ? null : (erpProducts ?? []).find((p) => p.id === Number(id))?.unit ?? null);

  const save = useMutation({
    mutationFn: (body: MenuOptionGroupInput) => (group ? optionGroupsApi.update(group.id, body) : optionGroupsApi.create(body)),
    onSuccess: onSaved,
    onError: (e) => setErr(apiError(e)),
  });
  const remove = useMutation({
    mutationFn: () => optionGroupsApi.remove(group!.id),
    onSuccess: onSaved,
    onError: (e) => setErr(apiError(e)),
  });

  const patchOpt = (i: number, patch: Partial<OptionDraft>) =>
    setOptions(options.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));

  function submit(e: FormEvent) {
    e.preventDefault();
    setErr('');
    if (!name.trim()) { setErr('Informe o nome da classe'); return; }
    save.mutate({
      name: name.trim(),
      min,
      max: Math.max(max, 1),
      options: options
        .filter((o) => o.name.trim())
        .map((o) => ({
          id: o.id,
          name: o.name.trim(),
          price: parseNum(o.price) ?? 0,
          image_data: o.image_data,
          active: o.active,
          erp_product_id: o.erp_product_id === '' ? null : Number(o.erp_product_id),
          erp_qty: parseNum(o.erp_qty) ?? 1,
        })),
      item_ids: itemIds,
    });
  }

  const usedIn = group?.used_in ?? 0;

  return (
    <Modal title={group ? `Editar classe — ${group.name}` : 'Nova classe de complementos'} onClose={onClose} size="xl">
      {err && <div className="mb-3"><ErrorBox message={err} /></div>}
      {usedIn > 1 && (
        <div className="mb-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
          Esta classe é usada em <strong>{usedIn} itens</strong>. O que você mudar aqui vale em todos eles.
        </div>
      )}
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-12 items-end gap-2">
          <div className="col-span-8">
            <Field label="Nome da classe (ex.: Escolha sua proteína)">
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus />
            </Field>
          </div>
          <div className="col-span-2">
            <Field label="Mín."><Input type="number" min={0} value={min} onChange={(e) => setMin(Number(e.target.value))} /></Field>
          </div>
          <div className="col-span-2">
            <Field label="Máx."><Input type="number" min={1} value={max} onChange={(e) => setMax(Number(e.target.value))} /></Field>
          </div>
        </div>
        <p className="-mt-1 text-xs text-slate-400">Mín. 0 = opcional; mín. ≥ 1 = obrigatório.</p>

        {/* Complementos da classe */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Complementos</span>
            <button
              type="button"
              onClick={() => setOptions([...options, { name: '', price: '', image_data: null, active: true, erp_product_id: '', erp_qty: '1' }])}
              className="text-xs text-emerald-600 hover:underline"
            >
              + complemento
            </button>
          </div>
          <div className="space-y-2">
            {options.length === 0 && <p className="text-xs text-slate-400">Nenhum complemento ainda.</p>}
            {options.map((o, i) => (
              <div key={i} className={`rounded-lg border border-slate-100 bg-slate-50/50 p-2 ${o.active ? '' : 'opacity-60'}`}>
                <div className="grid grid-cols-12 items-center gap-2">
                  <div className="col-span-6">
                    <Input placeholder="Complemento (ex.: Frango grelhado)" value={o.name} maxLength={100}
                      onChange={(e) => patchOpt(i, { name: e.target.value })} />
                  </div>
                  <div className="col-span-3">
                    <Input placeholder="R$ (0 = incluso)" inputMode="decimal" value={o.price}
                      onChange={(e) => patchOpt(i, { price: e.target.value })} />
                  </div>
                  <label className="col-span-2 flex cursor-pointer items-center gap-1 text-xs text-slate-500" title="Pausar/ativar em todos os itens">
                    <input type="checkbox" checked={o.active} onChange={(e) => patchOpt(i, { active: e.target.checked })} />
                    ativo
                  </label>
                  <button
                    type="button"
                    onClick={() => setOptions(options.filter((_, idx) => idx !== i))}
                    className="col-span-1 flex justify-end text-slate-300 hover:text-red-600"
                    title="Remover complemento"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-12 items-center gap-2">
                  <div className="col-span-8">
                    <Select
                      value={String(o.erp_product_id)}
                      onChange={(e) => patchOpt(i, { erp_product_id: e.target.value ? Number(e.target.value) : '' })}
                      aria-label={`Produto do ERP do complemento ${o.name || '(sem nome)'}`}
                    >
                      <option value="">— sem baixa de estoque —</option>
                      {(erpProducts ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </Select>
                  </div>
                  <div className="col-span-4">
                    <Input
                      value={o.erp_qty}
                      onChange={(e) => patchOpt(i, { erp_qty: e.target.value })}
                      inputMode="decimal"
                      disabled={o.erp_product_id === ''}
                      placeholder="Consumo"
                      aria-label={`Consumo por unidade do complemento ${o.name || '(sem nome)'}`}
                      title={`Quanto sai do estoque por unidade${unitOf(o.erp_product_id) ? ` (${unitOf(o.erp_product_id)})` : ''}`}
                    />
                  </div>
                </div>
                <div className="mt-2">
                  <PhotoPicker value={o.image_data} onChange={(v) => patchOpt(i, { image_data: v })} size={48} label="Foto do complemento" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Onde a classe é usada — o coração do reuso */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Usar nestes itens</span>
            <div className="flex gap-2 text-xs">
              <button type="button" className="text-emerald-600 hover:underline" onClick={() => setItemIds(allItems.map((i) => i.id))}>todos</button>
              <button type="button" className="text-slate-400 hover:underline" onClick={() => setItemIds([])}>nenhum</button>
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 p-2">
            {allItems.length === 0 && <p className="text-xs text-slate-400">Cardápio vazio.</p>}
            {allItems.map((it) => (
              <label key={it.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm text-slate-700 hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={itemIds.includes(it.id)}
                  onChange={(e) => setItemIds(e.target.checked ? [...itemIds, it.id] : itemIds.filter((x) => x !== it.id))}
                />
                <span className="truncate">{it.name}</span>
                <span className="ml-auto shrink-0 text-xs text-slate-400">{it.category}</span>
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-400">{itemIds.length} item(ns) selecionado(s).</p>
        </div>

        <div className="flex items-center justify-between pt-2">
          {group ? (
            <Button type="button" variant="danger" disabled={remove.isPending}
              onClick={() => { if (window.confirm(`Excluir a classe "${group.name}"? Ela sai de ${usedIn} item(ns).`)) remove.mutate(); }}>
              <Trash2 size={15} /> Excluir classe
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Salvando…' : 'Salvar'}</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
