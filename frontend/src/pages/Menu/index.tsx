import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Trash2, Pencil, UploadCloud, DownloadCloud, ChevronDown, ChevronUp, ChevronRight, Play, Pause, Search, Layers, Image as ImageIcon } from 'lucide-react';
import { channelsApi, menuApi, optionGroupsApi, productsApi } from '../../services/resources';
import { apiError } from '../../services/api';
import type { MenuCategory, MenuItem, MenuItemInput, MenuOption, MenuOptionGroup } from '../../types';
import { PageHeader } from '../../components/PageHeader';
import { Button, Card, Field, Input, Select, Spinner, ErrorBox, EmptyState, Modal } from '../../components/ui';
import { PhotoPicker } from '../../components/PhotoPicker';
import { brl, parseNum, numToInput } from '../../utils/format';

const PLATFORM_LABEL: Record<string, string> = { ifood: 'iFood', '99food': '99Food' };

export function MenuPage() {
  const qc = useQueryClient();
  const tree = useQuery({ queryKey: ['menu-tree'], queryFn: menuApi.tree });
  const { data: channels } = useQuery({ queryKey: ['channels'], queryFn: channelsApi.list });
  const activeChannels = useMemo(() => (channels ?? []).filter((c) => c.active), [channels]);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [editItem, setEditItem] = useState<{ item: MenuItem | null; categoryId: number } | null>(null);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');

  const invalidate = () => qc.invalidateQueries({ queryKey: ['menu-tree'] });

  const publish = useMutation({
    mutationFn: (channelId: number) => menuApi.publish(channelId),
    onSuccess: (r) => { setErr(''); setMsg(`Cardápio publicado: ${JSON.stringify(r)}`); invalidate(); },
    onError: (e) => { setMsg(''); setErr(apiError(e)); },
  });
  const importMenu = useMutation({
    mutationFn: (channelId: number) => menuApi.import(channelId),
    onSuccess: (r) => { setErr(''); setMsg(`Cardápio importado: ${JSON.stringify(r)}`); invalidate(); },
    onError: (e) => { setMsg(''); setErr(apiError(e)); },
  });

  const allCats = tree.data ?? [];
  const isEmpty = allCats.length === 0;
  // Pendências do de-para com o ERP: sem vínculo não há baixa de estoque. Contar aqui
  // evita ter que abrir item por item pra descobrir o que ficou de fora.
  const pending = useMemo(() => {
    let items = 0;
    // Complemento conta UMA vez: a classe é compartilhada, então a mesma opção aparece
    // em vários itens da árvore — mas vincular ao ERP é um trabalho só.
    const options = new Set<number>();
    for (const c of allCats) {
      for (const i of c.items) {
        if (!i.erp_product_id) items++;
        for (const g of i.groups ?? []) {
          for (const o of g.options ?? []) if (!o.erp_product_id) options.add(o.id);
        }
      }
    }
    return { items, options: options.size };
  }, [allCats]);
  const term = search.trim().toLowerCase();
  const visibleCats = allCats
    .filter((c) => catFilter === 'all' || String(c.id) === catFilter)
    .map((c) => ({ ...c, items: term ? c.items.filter((i) => i.name.toLowerCase().includes(term)) : c.items }))
    .filter((c) => !term || c.items.length > 0);

  return (
    <div>
      <PageHeader title="Cardápio" subtitle="Defina o que seus clientes pedem no iFood e 99Food — edite e pause com um clique" />

      {/* Ações por canal: publicar / importar */}
      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-700">Canais:</span>
          {activeChannels.length === 0 && <span className="text-sm text-slate-400">nenhum canal ativo (cadastre em Integrações)</span>}
          {activeChannels.map((c) => (
            <div key={c.id} className="flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1">
              <span className="text-sm text-slate-700">{PLATFORM_LABEL[c.platform] ?? c.platform} — {c.name}</span>
              <button
                onClick={() => publish.mutate(c.id)}
                disabled={publish.isPending || isEmpty}
                className="ml-1 flex items-center gap-1 text-xs text-emerald-600 hover:underline disabled:opacity-40"
                title="Publica o cardápio local inteiro neste canal"
              >
                <UploadCloud size={14} /> Publicar
              </button>
              {isEmpty && (
                <button
                  onClick={() => importMenu.mutate(c.id)}
                  disabled={importMenu.isPending}
                  className="ml-1 flex items-center gap-1 text-xs text-sky-600 hover:underline disabled:opacity-40"
                  title="Importa o cardápio que já existe neste canal para começar (só com o catálogo local vazio)"
                >
                  <DownloadCloud size={14} /> Importar
                </button>
              )}
            </div>
          ))}
          {(publish.isPending || importMenu.isPending) && <span className="text-xs text-slate-400">processando…</span>}
        </div>
        {msg && <p className="mt-2 text-xs text-emerald-700">{msg}</p>}
        {err && <div className="mt-2"><ErrorBox message={err} /></div>}
        <p className="mt-2 text-xs text-slate-400">
          Pausar item/complemento vale na hora aqui. Para refletir nas plataformas, use Publicar (no 99Food substitui o cardápio inteiro da loja).
        </p>
      </Card>

      {tree.isLoading && <Spinner />}
      {tree.error && <ErrorBox message={apiError(tree.error)} />}

      {tree.data && (pending.items > 0 || pending.options > 0) && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="font-semibold">Baixa de estoque incompleta:</span>{' '}
          {pending.items > 0 && `${pending.items} ${pending.items === 1 ? 'item' : 'itens'}`}
          {pending.items > 0 && pending.options > 0 && ' e '}
          {pending.options > 0 && `${pending.options} ${pending.options === 1 ? 'complemento' : 'complementos'}`}
          {' '}sem produto do ERP vinculado — o que vier neles não sai do estoque. Nos itens, abra o item e
          use o campo <em>Produto do ERP</em>; nos complementos, vá em{' '}
          <Link to="/cardapio/complementos" className="font-semibold underline">Complementos</Link>{' '}
          (o vínculo é da classe, então vale de uma vez em todos os itens que a usam).
        </div>
      )}

      {tree.data && (
        <>
          {/* Barra: buscar + filtrar categoria + adicionar categoria */}
          <Card className="mb-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-[200px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar um item" className="pl-9" />
              </div>
              <div className="min-w-[180px]">
                <Select value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
                  <option value="all">Todas as categorias</option>
                  {allCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </div>
              <NewCategoryButton onDone={invalidate} />
            </div>
          </Card>

          {isEmpty && <EmptyState message="Cardápio vazio. Adicione uma categoria ou importe o cardápio de um canal." />}
          <div className="space-y-4">
            {visibleCats.map((cat) => (
              <CategorySection
                key={cat.id}
                category={cat}
                onChanged={invalidate}
                onEditItem={(item) => setEditItem({ item, categoryId: cat.id })}
                onNewItem={() => setEditItem({ item: null, categoryId: cat.id })}
              />
            ))}
            {!isEmpty && visibleCats.length === 0 && <EmptyState message="Nenhum item encontrado para essa busca." />}
          </div>
        </>
      )}

      {editItem && (
        <ItemModal
          item={editItem.item}
          categoryId={editItem.categoryId}
          categories={tree.data ?? []}
          onClose={() => setEditItem(null)}
          onSaved={() => { setEditItem(null); invalidate(); }}
        />
      )}
    </div>
  );
}

function NewCategoryButton({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const create = useMutation({
    mutationFn: () => menuApi.createCategory({ name: name.trim() }),
    onSuccess: () => { setName(''); setErr(''); setOpen(false); onDone(); },
    onError: (e) => setErr(apiError(e)),
  });
  if (!open) {
    return (
      <Button type="button" variant="ghost" onClick={() => setOpen(true)}><Plus size={16} /> Adicionar categoria</Button>
    );
  }
  return (
    <form
      onSubmit={(e: FormEvent) => { e.preventDefault(); if (name.trim()) create.mutate(); }}
      className="flex items-center gap-2"
    >
      <Input value={name} placeholder="Nome da categoria" onChange={(e) => setName(e.target.value)} autoFocus />
      <Button type="submit" disabled={create.isPending || !name.trim()}>Criar</Button>
      <Button type="button" variant="ghost" onClick={() => { setOpen(false); setErr(''); }}>Cancelar</Button>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </form>
  );
}

const isActive = (v: number | boolean) => Boolean(Number(v));

/** Miniatura quadrada com placeholder quando não há imagem. */
function Thumb({ src, size = 44, alt = '' }: { src?: string | null; size?: number; alt?: string }) {
  return src ? (
    <img src={src} alt={alt} className="shrink-0 rounded-md object-cover" style={{ width: size, height: size }} />
  ) : (
    <div className="flex shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-300" style={{ width: size, height: size }}>
      <ImageIcon size={Math.round(size / 2.4)} />
    </div>
  );
}

/** Botão pausar/ativar no estilo iFood: Pause quando ativo, Play (âmbar) quando pausado. */
function PauseToggle({ active, onToggle, busy, title }: { active: boolean; onToggle: () => void; busy?: boolean; title?: string }) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onToggle}
      title={active ? (title ?? 'Pausar') : 'Ativar'}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition disabled:opacity-40 ${
        active ? 'border-slate-200 text-slate-500 hover:bg-slate-50' : 'border-amber-300 bg-amber-50 text-amber-600 hover:bg-amber-100'
      }`}
    >
      {active ? <Pause size={15} /> : <Play size={15} />}
    </button>
  );
}

/**
 * Vínculo com o ERP na linha do cardápio: verde = dá baixa de estoque; âmbar = não dá.
 * O âmbar é o que faz a pendência aparecer sem precisar abrir cada item.
 */
function ErpChip({ name, qty, unit }: { name?: string | null; qty?: number | string | null; unit?: string | null }) {
  if (!name) {
    return (
      <span
        className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700"
        title="Sem produto do ERP vinculado — este item não dá baixa de estoque"
      >
        sem estoque
      </span>
    );
  }
  const q = Number(qty ?? 1);
  const consumo = Number.isFinite(q) && q !== 1 ? ` · ${numToInput(q)}${unit ? ` ${unit}` : ''}` : '';
  return (
    <span
      className="max-w-[200px] shrink-0 truncate rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700"
      title={`Baixa de estoque: ${name}${consumo}`}
    >
      {name}{consumo}
    </span>
  );
}

function OptionRow({ option, onChanged }: { option: MenuOption; onChanged: () => void }) {
  const active = isActive(option.active);
  const avail = useMutation({ mutationFn: (a: boolean) => menuApi.setOptionAvailability(option.id, a), onSuccess: onChanged });
  return (
    <div className={`flex items-center gap-3 px-3 py-2 ${active ? '' : 'opacity-55'}`}>
      <Thumb src={option.image_data} size={36} alt={option.name} />
      <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{option.name}</span>
      <ErpChip name={option.erp_product_name} qty={option.erp_qty} unit={option.erp_product_unit} />
      <span className="w-24 shrink-0 text-right text-sm text-slate-500">{Number(option.price) > 0 ? brl(option.price) : 'Incluso'}</span>
      <PauseToggle active={active} busy={avail.isPending} onToggle={() => avail.mutate(!active)} title="Pausar complemento" />
    </div>
  );
}

function GroupBlock({ group, onChanged }: { group: MenuOptionGroup; onChanged: () => void }) {
  const active = isActive(group.active);
  const required = group.min >= 1;
  const usedIn = group.used_in ?? 0;
  const avail = useMutation({ mutationFn: (a: boolean) => menuApi.setGroupAvailability(group.id, a), onSuccess: onChanged });
  return (
    <div className={`overflow-hidden rounded-lg border border-slate-200 ${active ? '' : 'opacity-55'}`}>
      <div className="flex items-center gap-2 bg-slate-50 px-3 py-2">
        <span className="text-sm font-semibold text-slate-700">{group.name}</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${required ? 'bg-slate-800 text-white' : 'bg-slate-200 text-slate-600'}`}>
          {required ? 'Obrigatório' : 'Opcional'}
        </span>
        <span className="text-xs text-slate-400">mín {group.min} · máx {group.max}</span>
        {usedIn > 1 && (
          <Link
            to="/cardapio/complementos"
            className="flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700 hover:bg-sky-100"
            title={`Classe compartilhada: pausar ou editar aqui vale nos ${usedIn} itens que a usam`}
          >
            <Layers size={11} /> compartilhada · {usedIn} itens
          </Link>
        )}
        <div className="ml-auto">
          <PauseToggle
            active={active}
            busy={avail.isPending}
            onToggle={() => avail.mutate(!active)}
            title={usedIn > 1 ? `Pausar em ${usedIn} itens` : 'Pausar grupo'}
          />
        </div>
      </div>
      <div className="divide-y divide-slate-100">
        {(group.options ?? []).length === 0 && <p className="px-3 py-2 text-xs text-slate-400">Sem complementos.</p>}
        {(group.options ?? []).map((o) => <OptionRow key={o.id} option={o} onChanged={onChanged} />)}
      </div>
    </div>
  );
}

/**
 * Código PDV/ERP (externalCode) editável direto na linha do cardápio — evita abrir o item
 * só para digitar o código. Salva ao sair do campo (blur) ou no Enter, e só se mudou.
 */
function PdvCodeInput({ item, onChanged }: { item: MenuItem; onChanged: () => void }) {
  const [code, setCode] = useState(item.external_code ?? '');
  const save = useMutation({
    mutationFn: (v: string) => menuApi.updateItem(item.id, { external_code: v.trim() || null }),
    onSuccess: onChanged,
  });
  // Reflete alterações vindas de fora (ex.: edição pelo modal do item).
  useEffect(() => { setCode(item.external_code ?? ''); }, [item.external_code]);
  const commit = () => {
    if (code.trim() === (item.external_code ?? '')) return; // sem mudança
    save.mutate(code);
  };
  return (
    <input
      value={code}
      onChange={(e) => setCode(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
      placeholder="Cód. PDV"
      // O placeholder some ao digitar e se repete em toda linha: o nome acessível precisa
      // ser explícito e dizer de QUAL item é este campo.
      aria-label={`Código PDV de ${item.name}`}
      title="Código PDV / ERP (externalCode) — salva automaticamente"
      className={`w-24 shrink-0 rounded-lg border px-2.5 py-1.5 text-right text-sm text-slate-700 focus:border-emerald-400 focus:outline-none ${save.isPending ? 'opacity-60' : ''} ${save.isError ? 'border-red-400' : 'border-slate-200'}`}
    />
  );
}

function ItemRow({ item, onEdit, onChanged }: { item: MenuItem; onEdit: (item: MenuItem) => void; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const active = isActive(item.active);
  const groups = item.groups ?? [];
  const avail = useMutation({ mutationFn: (a: boolean) => menuApi.setItemAvailability(item.id, a), onSuccess: onChanged });
  return (
    <div className="border-t border-slate-100 first:border-t-0">
      <div className={`flex items-center gap-3 py-2.5 ${active ? '' : 'opacity-55'}`}>
        <Thumb src={item.image_data ?? item.image_url} alt={item.name} />
        <div className="min-w-0 flex-1">
          <button onClick={() => onEdit(item)} className="block max-w-full truncate text-left text-sm font-semibold text-slate-800 hover:text-emerald-700">
            {item.name}
          </button>
          {item.description && <p className="truncate text-xs text-slate-400">{item.description}</p>}
        </div>
        <ErpChip name={item.erp_product_name} qty={item.erp_qty} />
        {groups.length > 0 && (
          <button
            onClick={() => setOpen((v) => !v)}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition ${
              open ? 'bg-slate-800 text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
            title="Ver e pausar complementos"
          >
            Complementos
            <span className={`rounded-full px-1.5 text-[11px] ${open ? 'bg-white/20' : 'bg-slate-100'}`}>{groups.length}</span>
          </button>
        )}
        <span className="w-20 shrink-0 text-right text-sm font-semibold text-slate-700">{brl(item.price)}</span>
        <button onClick={() => onEdit(item)} className="shrink-0 text-slate-300 hover:text-slate-600" title="Editar item"><Pencil size={15} /></button>
        <PauseToggle active={active} busy={avail.isPending} onToggle={() => avail.mutate(!active)} title="Pausar item" />
        <PdvCodeInput item={item} onChanged={onChanged} />
      </div>
      {open && groups.length > 0 && (
        <div className="mb-3 ml-6 space-y-2 border-l-2 border-slate-100 pl-4">
          {groups.map((g) => <GroupBlock key={g.id} group={g} onChanged={onChanged} />)}
        </div>
      )}
    </div>
  );
}

function CategorySection({
  category, onChanged, onEditItem, onNewItem,
}: {
  category: MenuCategory;
  onChanged: () => void;
  onEditItem: (item: MenuItem) => void;
  onNewItem: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const active = isActive(category.active);

  const update = useMutation({
    mutationFn: (body: Partial<{ name: string; active: boolean }>) => menuApi.updateCategory(category.id, body),
    onSuccess: () => { setRenaming(null); setErr(''); onChanged(); },
    onError: (e) => setErr(apiError(e)),
  });
  const remove = useMutation({
    mutationFn: () => menuApi.deleteCategory(category.id),
    onSuccess: onChanged,
    onError: (e) => setErr(apiError(e)),
  });

  return (
    <Card className={active ? '' : 'opacity-70'}>
      <div className="flex items-center gap-2">
        <button onClick={() => setOpen(!open)} className="text-slate-400 hover:text-slate-600">
          {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </button>
        {renaming !== null ? (
          <form
            onSubmit={(e) => { e.preventDefault(); if (renaming.trim()) update.mutate({ name: renaming.trim() }); }}
            className="flex items-center gap-2"
          >
            <Input value={renaming} onChange={(e) => setRenaming(e.target.value)} className="max-w-xs" autoFocus />
            <Button type="submit" disabled={update.isPending}>Salvar</Button>
            <Button type="button" variant="ghost" onClick={() => setRenaming(null)}>Cancelar</Button>
          </form>
        ) : (
          <>
            <h3 className="text-sm font-bold text-slate-800">{category.name}</h3>
            <span className="text-xs text-slate-400">({category.items.length} {category.items.length === 1 ? 'item' : 'itens'})</span>
            <button onClick={() => setRenaming(category.name)} className="text-slate-300 hover:text-slate-600" title="Renomear categoria"><Pencil size={13} /></button>
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={onNewItem} className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50"><Plus size={14} /> item</button>
          <button
            onClick={() => { if (confirm(`Excluir a categoria "${category.name}" e todos os seus itens?`)) remove.mutate(); }}
            className="text-slate-300 hover:text-red-600"
            title="Excluir categoria"
          >
            <Trash2 size={15} />
          </button>
          <PauseToggle active={active} busy={update.isPending} onToggle={() => update.mutate({ active: !active })} title="Pausar categoria" />
        </div>
      </div>
      {err && <div className="mt-2"><ErrorBox message={err} /></div>}

      {open && (
        <div className="mt-2">
          {category.items.length === 0 && <p className="py-3 text-sm text-slate-400">Nenhum item nesta categoria.</p>}
          {category.items.map((item) => <ItemRow key={item.id} item={item} onEdit={onEditItem} onChanged={onChanged} />)}
        </div>
      )}
    </Card>
  );
}

function ItemModal({
  item, categoryId, categories, onClose, onSaved,
}: {
  item: MenuItem | null;
  categoryId: number;
  categories: MenuCategory[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(item?.name ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [price, setPrice] = useState(numToInput(item?.price ?? ''));
  const [originalPrice, setOriginalPrice] = useState(numToInput(item?.original_price ?? ''));
  const [externalCode, setExternalCode] = useState(item?.external_code ?? '');
  const [catId, setCatId] = useState(item?.category_id ?? categoryId);
  const [erpProductId, setErpProductId] = useState<number | ''>(item?.erp_product_id ?? '');
  const [erpQty, setErpQty] = useState(numToInput(item?.erp_qty ?? 1));
  const [imageData, setImageData] = useState<string | null>(item?.image_data ?? item?.image_url ?? null);
  // Produtos do ERP p/ o de-para (baixa de estoque por ficha técnica + foto herdada).
  const { data: erpProducts } = useQuery({ queryKey: ['products'], queryFn: () => productsApi.list() });
  // Unidade do produto vinculado — mostra ao lado do consumo (0,15 do quê?).
  const unitOf = (id: number | '') => (id === '' ? null : (erpProducts ?? []).find((p) => p.id === Number(id))?.unit ?? null);
  const erpUnit = unitOf(erpProductId);
  // Classes de complementos que o item usa, na ordem. O item apenas ANEXA — o conteúdo
  // da classe é editado no módulo Complementos, e vale em todos os itens que a usam.
  const [groupIds, setGroupIds] = useState<number[]>((item?.groups ?? []).map((g) => g.id));
  const { data: allGroups } = useQuery({ queryKey: ['option-groups'], queryFn: optionGroupsApi.list });
  const [err, setErr] = useState('');

  const remove = useMutation({
    mutationFn: () => menuApi.deleteItem(item!.id),
    onSuccess: onSaved,
    onError: (e) => setErr(apiError(e)),
  });
  const save = useMutation({
    mutationFn: (body: MenuItemInput) => (item ? menuApi.updateItem(item.id, body) : menuApi.createItem(body)),
    onSuccess: onSaved,
    onError: (e) => setErr(apiError(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setErr('');
    const p = parseNum(price);
    if (!name.trim()) { setErr('Informe o nome do item'); return; }
    if (p === null || p < 0) { setErr('Preço inválido'); return; }
    const op = originalPrice.trim() === '' ? null : parseNum(originalPrice);
    save.mutate({
      category_id: catId,
      name: name.trim(),
      description: description.trim() || null,
      price: p,
      original_price: op,
      image_data: imageData,
      external_code: externalCode.trim() || null,
      erp_product_id: erpProductId === '' ? null : Number(erpProductId),
      erp_qty: parseNum(erpQty) ?? 1,
      group_ids: groupIds,
    });
  }

  /** Move a classe na ordem em que aparece para o cliente dentro deste item. */
  function moveGroup(id: number, delta: number) {
    const i = groupIds.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= groupIds.length) return;
    const next = [...groupIds];
    [next[i], next[j]] = [next[j], next[i]];
    setGroupIds(next);
  }

  return (
    <Modal title={item ? `Editar item — ${item.name}` : 'Novo item'} onClose={onClose} size="xl">
      {err && <div className="mb-3"><ErrorBox message={err} /></div>}
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Nome"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} /></Field>
          <Field label="Categoria">
            <Select value={String(catId)} onChange={(e) => setCatId(Number(e.target.value))}>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Descrição"><Input value={description ?? ''} onChange={(e) => setDescription(e.target.value)} maxLength={300} /></Field>
        <Field label="Foto do item">
          <PhotoPicker value={imageData} onChange={setImageData} size={72} label="Foto do item" />
        </Field>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="md:col-span-3">
            <Field label="Produto do ERP (baixa de estoque · foto)">
              <Select value={String(erpProductId)} onChange={(e) => setErpProductId(e.target.value ? Number(e.target.value) : '')}>
                <option value="">— nenhum (sem baixa de estoque) —</option>
                {(erpProducts ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
          </div>
          <Field label={`Consumo por unidade${erpUnit ? ` (${erpUnit})` : ''}`}>
            <Input value={erpQty} onChange={(e) => setErpQty(e.target.value)} inputMode="decimal" disabled={erpProductId === ''} />
          </Field>
        </div>
        <p className="-mt-1 text-xs text-slate-400">
          Vincula este item a um produto do cadastro: dá baixa de estoque pela ficha técnica quando o
          pedido entra{!imageData ? ' e usa a foto do produto (o item está sem foto própria)' : ''}.
          Deixe o consumo em 1 quando o produto tem ficha técnica (é ela que diz quanto sai de cada insumo).
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Preço (R$)"><Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" /></Field>
          <Field label='Preço "de" (riscado, opcional)'><Input value={originalPrice} onChange={(e) => setOriginalPrice(e.target.value)} inputMode="decimal" /></Field>
          <Field label="Código PDV (opcional)"><Input value={externalCode ?? ''} onChange={(e) => setExternalCode(e.target.value)} /></Field>
        </div>

        {/* Classes de complementos: o item ESCOLHE quais usa. Editar o conteúdo de
            uma classe é no módulo Complementos — e vale em todos os itens que a usam. */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Complementos</span>
            <Link to="/cardapio/complementos" className="text-xs text-emerald-600 hover:underline">gerenciar classes</Link>
          </div>
          {(allGroups ?? []).length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400">
              Nenhuma classe de complementos cadastrada.{' '}
              <Link to="/cardapio/complementos" className="text-emerald-600 hover:underline">Criar a primeira</Link>
              {' '}(ex.: "Escolha sua proteína") — depois é só marcar aqui.
            </p>
          ) : (
            <>
              {/* Selecionadas primeiro, na ordem em que o cliente vê */}
              {groupIds.length > 0 && (
                <ul className="mb-2 space-y-1">
                  {groupIds.map((gid, idx) => {
                    const g = (allGroups ?? []).find((x) => x.id === gid);
                    if (!g) return null;
                    const usedIn = g.used_in ?? 0;
                    return (
                      <li key={gid} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/60 px-2 py-1.5 text-sm">
                        <span className="w-5 shrink-0 text-center text-xs text-slate-400">{idx + 1}</span>
                        <span className="min-w-0 flex-1 truncate text-slate-700">{g.name}</span>
                        <span className="shrink-0 text-xs text-slate-400">
                          {g.options.length} compl. · {g.min >= 1 ? 'obrigatório' : 'opcional'}
                        </span>
                        {usedIn > 1 && (
                          <span className="shrink-0 rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700" title={(g.items ?? []).map((i) => i.name).join(', ')}>
                            compartilhada · {usedIn} itens
                          </span>
                        )}
                        <button type="button" onClick={() => moveGroup(gid, -1)} disabled={idx === 0}
                          className="shrink-0 text-slate-300 hover:text-slate-600 disabled:opacity-30" title="Subir"><ChevronUp size={15} /></button>
                        <button type="button" onClick={() => moveGroup(gid, 1)} disabled={idx === groupIds.length - 1}
                          className="shrink-0 text-slate-300 hover:text-slate-600 disabled:opacity-30" title="Descer"><ChevronDown size={15} /></button>
                        <button type="button" onClick={() => setGroupIds(groupIds.filter((x) => x !== gid))}
                          className="shrink-0 text-slate-300 hover:text-red-600" title="Tirar deste item"><Trash2 size={14} /></button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-200 p-2">
                {(allGroups ?? []).filter((g) => !groupIds.includes(g.id)).length === 0 && (
                  <p className="text-xs text-slate-400">Todas as classes já estão neste item.</p>
                )}
                {(allGroups ?? []).filter((g) => !groupIds.includes(g.id)).map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => setGroupIds([...groupIds, g.id])}
                    className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <Plus size={13} className="shrink-0 text-emerald-600" />
                    <span className="min-w-0 flex-1 truncate">{g.name}</span>
                    <span className="shrink-0 text-xs text-slate-400">{g.options.length} compl.</span>
                    {!isActive(g.active) && <span className="shrink-0 text-[10px] font-semibold text-amber-600">pausada</span>}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-between pt-2">
          {item ? (
            <Button type="button" variant="danger" disabled={remove.isPending}
              onClick={() => { if (confirm(`Excluir o item "${item.name}"?`)) remove.mutate(); }}>
              <Trash2 size={15} /> Excluir item
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Salvando…' : 'Salvar'}</Button>
          </div>
        </div>
        <p className="text-xs text-slate-400">Alterações locais só valem nas plataformas depois de Publicar (exceto pausar/reativar, que sincroniza na hora).</p>
      </form>
    </Modal>
  );
}
