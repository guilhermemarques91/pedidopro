import { ChangeEvent, FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Pencil, UploadCloud, DownloadCloud, ChevronDown, ChevronRight } from 'lucide-react';
import { channelsApi, menuApi } from '../../services/resources';
import { apiError } from '../../services/api';
import type { MenuCategory, MenuItem, MenuItemInput } from '../../types';
import { PageHeader } from '../../components/PageHeader';
import { Button, Card, Field, Input, Select, Spinner, ErrorBox, EmptyState, Modal } from '../../components/ui';
import { brl, parseNum, numToInput } from '../../utils/format';

const PLATFORM_LABEL: Record<string, string> = { ifood: 'iFood', '99food': '99Food' };

const MAX_PHOTO_BYTES = 2 * 1024 * 1024; // ~2MB — cabe no MEDIUMTEXT e evita payloads gigantes

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Falha ao ler a imagem'));
    r.readAsDataURL(file);
  });
}

/** Seletor de foto: preview + enviar + remover. Guarda a imagem como data URL (base64). */
function PhotoPicker({
  value, onChange, size = 64, label = 'Foto',
}: {
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  size?: number;
  label?: string;
}) {
  const [err, setErr] = useState('');
  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite reenviar o mesmo arquivo
    if (!file) return;
    if (!file.type.startsWith('image/')) { setErr('Selecione uma imagem'); return; }
    if (file.size > MAX_PHOTO_BYTES) { setErr('Imagem muito grande (máx. 2MB)'); return; }
    try { setErr(''); onChange(await readFileAsDataUrl(file)); }
    catch { setErr('Falha ao ler a imagem'); }
  }
  return (
    <div className="flex items-center gap-2">
      {value ? (
        <img src={value} alt={label} className="rounded border border-slate-200 object-cover" style={{ width: size, height: size }} />
      ) : (
        <div className="flex items-center justify-center rounded border border-dashed border-slate-300 text-slate-300" style={{ width: size, height: size }}>
          <UploadCloud size={Math.round(size / 3)} />
        </div>
      )}
      <div className="flex flex-col gap-1">
        <label className="cursor-pointer text-xs text-emerald-600 hover:underline">
          {value ? 'Trocar foto' : 'Enviar foto'}
          <input type="file" accept="image/*" className="hidden" onChange={pick} />
        </label>
        {value && (
          <button type="button" onClick={() => onChange(null)} className="text-left text-xs text-slate-400 hover:text-red-600">Remover</button>
        )}
        {err && <span className="text-xs text-red-600">{err}</span>}
      </div>
    </div>
  );
}

export function MenuPage() {
  const qc = useQueryClient();
  const tree = useQuery({ queryKey: ['menu-tree'], queryFn: menuApi.tree });
  const { data: channels } = useQuery({ queryKey: ['channels'], queryFn: channelsApi.list });
  const activeChannels = useMemo(() => (channels ?? []).filter((c) => c.active), [channels]);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [editItem, setEditItem] = useState<{ item: MenuItem | null; categoryId: number } | null>(null);

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

  const isEmpty = (tree.data ?? []).length === 0;

  return (
    <div>
      <PageHeader title="Cardápio" subtitle="Cardápio mestre local — edite aqui e publique para iFood e 99Food" />

      {/* Ações por canal: publicar / importar */}
      <Card className="mb-6">
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
          Publicar no 99Food substitui o cardápio inteiro da loja. No iFood, itens são criados/atualizados e itens desativados são pausados.
        </p>
      </Card>

      {tree.isLoading && <Spinner />}
      {tree.error && <ErrorBox message={apiError(tree.error)} />}

      {tree.data && (
        <div className="space-y-4">
          <NewCategory onDone={invalidate} />
          {tree.data.length === 0 && (
            <EmptyState message="Cardápio vazio. Crie uma categoria acima ou importe o cardápio de um canal." />
          )}
          {tree.data.map((cat) => (
            <CategoryCard
              key={cat.id}
              category={cat}
              onChanged={invalidate}
              onEditItem={(item) => setEditItem({ item, categoryId: cat.id })}
              onNewItem={() => setEditItem({ item: null, categoryId: cat.id })}
            />
          ))}
        </div>
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

function NewCategory({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const create = useMutation({
    mutationFn: () => menuApi.createCategory({ name }),
    onSuccess: () => { setName(''); setErr(''); onDone(); },
    onError: (e) => setErr(apiError(e)),
  });
  return (
    <Card>
      <form
        onSubmit={(e: FormEvent) => { e.preventDefault(); if (name.trim()) create.mutate(); }}
        className="flex items-end gap-3"
      >
        <div className="max-w-xs flex-1">
          <Field label="Nova categoria"><Input value={name} placeholder="Ex.: Lanches" onChange={(e) => setName(e.target.value)} /></Field>
        </div>
        <Button type="submit" disabled={create.isPending || !name.trim()}><Plus size={16} /> Adicionar</Button>
        {err && <span className="text-xs text-red-600">{err}</span>}
      </form>
    </Card>
  );
}

function CategoryCard({
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
  const availability = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => menuApi.setItemAvailability(id, active),
    onSuccess: (r) => { setErr(r.errors.length ? r.errors.map((x) => `${x.channel}: ${x.error}`).join(' | ') : ''); onChanged(); },
    onError: (e) => setErr(apiError(e)),
  });

  const catActive = Boolean(Number(category.active));

  return (
    <Card className={catActive ? '' : 'opacity-60'}>
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
            <h3 className="text-sm font-semibold text-slate-700">{category.name}</h3>
            <span className="text-xs text-slate-400">({category.items.length} {category.items.length === 1 ? 'item' : 'itens'})</span>
            <button onClick={() => setRenaming(category.name)} className="text-slate-300 hover:text-slate-600" title="Renomear"><Pencil size={14} /></button>
          </>
        )}
        <div className="ml-auto flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-1 text-xs text-slate-500">
            <input type="checkbox" checked={catActive} onChange={(e) => update.mutate({ active: e.target.checked })} />
            ativa
          </label>
          <button onClick={onNewItem} className="flex items-center gap-1 text-xs text-emerald-600 hover:underline"><Plus size={14} /> item</button>
          <button
            onClick={() => { if (confirm(`Excluir a categoria "${category.name}" e todos os seus itens?`)) remove.mutate(); }}
            className="text-slate-300 hover:text-red-600"
            title="Excluir categoria"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      {err && <div className="mt-2"><ErrorBox message={err} /></div>}

      {open && (
        <div className="mt-3 divide-y divide-slate-100">
          {category.items.length === 0 && <p className="py-2 text-sm text-slate-400">Nenhum item nesta categoria.</p>}
          {category.items.map((item) => {
            const active = Boolean(Number(item.active));
            return (
              <div key={item.id} className={`flex items-center gap-3 py-2 ${active ? '' : 'opacity-50'}`}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-700">{item.name}</p>
                  {item.description && <p className="truncate text-xs text-slate-400">{item.description}</p>}
                </div>
                <div className="flex items-center gap-1">
                  {(item.channels ?? []).map((l) => (
                    <span
                      key={l.channel_id}
                      title={`${PLATFORM_LABEL[l.platform] ?? l.platform}: publicado ${l.synced_at ? new Date(l.synced_at).toLocaleString('pt-BR') : ''}`}
                      className={`h-2 w-2 rounded-full ${l.platform === 'ifood' ? 'bg-red-400' : 'bg-yellow-400'}`}
                    />
                  ))}
                </div>
                {(item.groups ?? []).length > 0 && (
                  <span className="text-xs text-slate-400">{item.groups.length} grupo(s)</span>
                )}
                <span className="w-20 text-right text-sm text-slate-700">{brl(item.price)}</span>
                <label className="flex cursor-pointer items-center gap-1 text-xs text-slate-500" title="Pausar/reativar em todos os canais">
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={(e) => availability.mutate({ id: item.id, active: e.target.checked })}
                    disabled={availability.isPending}
                  />
                  à venda
                </label>
                <button onClick={() => onEditItem(item)} className="text-slate-300 hover:text-slate-600" title="Editar"><Pencil size={15} /></button>
              </div>
            );
          })}
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
}
interface GroupDraft {
  id?: number;
  name: string;
  min: number;
  max: number;
  options: OptionDraft[];
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
  const [imageData, setImageData] = useState<string | null>(item?.image_data ?? item?.image_url ?? null);
  const [groups, setGroups] = useState<GroupDraft[]>(
    (item?.groups ?? []).map((g) => ({
      id: g.id,
      name: g.name,
      min: g.min,
      max: g.max,
      options: g.options.map((o) => ({
        id: o.id,
        name: o.name,
        price: numToInput(o.price),
        image_data: o.image_data ?? null,
        active: o.active === undefined ? true : Boolean(Number(o.active)),
      })),
    })),
  );
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
      groups: groups
        .filter((g) => g.name.trim())
        .map((g) => ({
          id: g.id,
          name: g.name.trim(),
          min: g.min,
          max: Math.max(g.max, 1),
          options: g.options
            .filter((o) => o.name.trim())
            .map((o) => ({ id: o.id, name: o.name.trim(), price: parseNum(o.price) ?? 0, image_data: o.image_data, active: o.active })),
        })),
    });
  }

  function setGroup(i: number, patch: Partial<GroupDraft>) {
    setGroups(groups.map((g, idx) => (idx === i ? { ...g, ...patch } : g)));
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
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Preço (R$)"><Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" /></Field>
          <Field label='Preço "de" (riscado, opcional)'><Input value={originalPrice} onChange={(e) => setOriginalPrice(e.target.value)} inputMode="decimal" /></Field>
          <Field label="Código PDV (opcional)"><Input value={externalCode ?? ''} onChange={(e) => setExternalCode(e.target.value)} /></Field>
        </div>

        {/* Grupos de complementos */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Complementos</span>
            <button
              type="button"
              onClick={() => setGroups([...groups, { name: '', min: 0, max: 1, options: [{ name: '', price: '', image_data: null, active: true }] }])}
              className="text-xs text-emerald-600 hover:underline"
            >
              + grupo
            </button>
          </div>
          <div className="space-y-3">
            {groups.map((g, i) => (
              <div key={i} className="rounded-lg border border-slate-200 p-3">
                <div className="grid grid-cols-12 items-end gap-2">
                  <div className="col-span-6">
                    <Field label="Grupo (ex.: Escolha sua proteína)"><Input value={g.name} onChange={(e) => setGroup(i, { name: e.target.value })} maxLength={50} /></Field>
                  </div>
                  <div className="col-span-2">
                    <Field label="Mín."><Input type="number" min={0} value={g.min} onChange={(e) => setGroup(i, { min: Number(e.target.value) })} /></Field>
                  </div>
                  <div className="col-span-2">
                    <Field label="Máx."><Input type="number" min={1} value={g.max} onChange={(e) => setGroup(i, { max: Number(e.target.value) })} /></Field>
                  </div>
                  <button
                    type="button"
                    onClick={() => setGroups(groups.filter((_, idx) => idx !== i))}
                    className="col-span-2 flex justify-end pb-2 text-slate-300 hover:text-red-600"
                    title="Remover grupo"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <p className="mt-1 text-xs text-slate-400">Mín. 0 = opcional; mín. ≥ 1 = obrigatório.</p>
                <div className="mt-2 space-y-2">
                  {g.options.map((o, j) => {
                    const patchOpt = (patch: Partial<OptionDraft>) =>
                      setGroup(i, { options: g.options.map((x, idx) => (idx === j ? { ...x, ...patch } : x)) });
                    return (
                      <div key={j} className={`rounded-lg border border-slate-100 bg-slate-50/50 p-2 ${o.active ? '' : 'opacity-60'}`}>
                        <div className="grid grid-cols-12 items-center gap-2">
                          <div className="col-span-6">
                            <Input placeholder="Opção (ex.: Frango grelhado)" value={o.name} maxLength={50}
                              onChange={(e) => patchOpt({ name: e.target.value })} />
                          </div>
                          <div className="col-span-3">
                            <Input placeholder="R$ (0 = incluso)" inputMode="decimal" value={o.price}
                              onChange={(e) => patchOpt({ price: e.target.value })} />
                          </div>
                          <label className="col-span-2 flex cursor-pointer items-center gap-1 text-xs text-slate-500" title="Pausar/ativar complemento">
                            <input type="checkbox" checked={o.active} onChange={(e) => patchOpt({ active: e.target.checked })} />
                            ativo
                          </label>
                          <button
                            type="button"
                            onClick={() => setGroup(i, { options: g.options.filter((_, idx) => idx !== j) })}
                            className="col-span-1 flex justify-end text-slate-300 hover:text-red-600"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                        <div className="mt-2">
                          <PhotoPicker value={o.image_data} onChange={(v) => patchOpt({ image_data: v })} size={48} label="Foto do complemento" />
                        </div>
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setGroup(i, { options: [...g.options, { name: '', price: '', image_data: null, active: true }] })}
                    className="text-xs text-emerald-600 hover:underline"
                  >
                    + opção
                  </button>
                </div>
              </div>
            ))}
          </div>
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
