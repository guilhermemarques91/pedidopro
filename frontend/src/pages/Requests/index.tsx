import { KeyboardEvent, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, ListChecks, Pencil } from 'lucide-react';
import { requestsApi, productsApi, RequestItemInput } from '../../services/resources';
import { apiError } from '../../services/api';
import { useAuth } from '../../store/auth.store';
import { date } from '../../utils/format';
import { PageHeader } from '../../components/PageHeader';
import { Button, Card, Field, Input, Combobox, Modal, Badge, IconBtn, Spinner, ErrorBox, EmptyState, ComboOption } from '../../components/ui';

// Linha em edição na nova lista.
interface Draft { key: number; productId: string; sourceItemId: string; freeText: string; quantity: string; unit: string }

// Status em que a lista ainda pode ser editada (funcionário: até submitted; admin: até allocated).
function canEdit(status: string, isAdmin: boolean): boolean {
  if (isAdmin) return ['draft', 'submitted', 'allocated'].includes(status);
  return ['draft', 'submitted'].includes(status);
}

export function Requests() {
  const qc = useQueryClient();
  const isAdmin = useAuth((s) => s.can('compras:admin'));
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const { data, isLoading, error } = useQuery({ queryKey: ['requests'], queryFn: requestsApi.list });
  const remove = useMutation({
    mutationFn: (id: number) => requestsApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['requests'] }),
  });

  return (
    <div>
      <PageHeader
        title="Lista de compras"
        subtitle="Monte sua lista de itens. A compra é organizada e enviada pelo administrador."
        action={<Button onClick={() => setOpen(true)}><Plus size={16} /> Nova lista</Button>}
      />

      {isLoading && <Spinner />}
      {error && <ErrorBox message={apiError(error)} />}

      {data && (data.length === 0 ? (
        <EmptyState message="Nenhuma lista ainda. Crie a primeira." />
      ) : (
        <div className="space-y-2">
          {data.map((r) => (
            <Card key={r.id} className="flex items-center justify-between transition hover:border-emerald-300">
              <Link to={`/requests/${r.id}`} className="flex flex-1 items-center gap-3">
                <ListChecks size={18} className="text-emerald-600" />
                <div>
                  <p className="font-medium text-slate-800">{r.title}</p>
                  <p className="text-xs text-slate-400">
                    {r.item_count} item(ns) · {r.created_by_name} · {date(r.created_at)}
                  </p>
                </div>
              </Link>
              <div className="flex items-center gap-3">
                <Badge status={r.status} />
                {canEdit(r.status, isAdmin) && (
                  <button
                    onClick={() => { setEditId(r.id); setOpen(true); }}
                    className="text-slate-300 hover:text-emerald-600"
                    title="Editar lista"
                  >
                    <Pencil size={16} />
                  </button>
                )}
                <button
                  onClick={() => { if (confirm(`Excluir a lista "${r.title}"?`)) remove.mutate(r.id); }}
                  className="text-slate-300 hover:text-red-600"
                  title="Excluir lista"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </Card>
          ))}
        </div>
      ))}

      {open && <RequestForm editId={editId} onClose={() => { setOpen(false); setEditId(null); }} />}
    </div>
  );
}

function RequestForm({ onClose, editId }: { onClose: () => void; editId?: number | null }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: products } = useQuery({ queryKey: ['products'], queryFn: () => productsApi.list() });
  const { data: unmapped } = useQuery({ queryKey: ['unmapped', 'catalog'], queryFn: () => productsApi.unmapped(true) });
  const { data: editing } = useQuery({
    queryKey: ['request', editId],
    queryFn: () => requestsApi.get(editId as number),
    enabled: !!editId,
  });
  const [title, setTitle] = useState('');
  const [lines, setLines] = useState<Draft[]>([]);
  const [error, setError] = useState('');
  const searchRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);

  // Pré-carrega título e linhas ao editar uma lista existente.
  if (editing && !loaded) {
    setLoaded(true);
    setTitle(editing.title);
    setLines(editing.items.map((it, i) => ({
      key: Date.now() + i,
      productId: it.product_id ? String(it.product_id) : '',
      sourceItemId: it.source_item_id ? String(it.source_item_id) : '',
      freeText: it.product_id ? '' : (it.free_text ?? ''),
      quantity: String(Number(it.quantity)),
      unit: it.unit,
    })));
  }

  // Catálogo completo: produtos canônicos (agrupados) + itens ainda não agrupados.
  // Os produtos agrupados substituem os itens que incorporam.
  const catalog: ComboOption[] = [
    ...(products ?? []).map((p) => ({ value: `p:${p.id}`, label: p.name, hint: p.category_name ?? undefined })),
    ...(unmapped ?? []).map((it) => ({ value: `i:${it.id}`, label: it.name, hint: it.supplier_name })),
  ].sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));

  // Itens criados manualmente nesta sessão (não estão no catálogo): viram opções selecionáveis.
  const [created, setCreated] = useState<ComboOption[]>([]);
  const catalogWithCreated = [...catalog, ...created].sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));

  // Unidade padrão de compra por opção do catálogo (produto → oferta mais barata; item → unidade do item).
  const unitByValue = new Map<string, string>();
  (products ?? []).forEach((p) => unitByValue.set(`p:${p.id}`, p.default_unit || 'un'));
  (unmapped ?? []).forEach((it) => unitByValue.set(`i:${it.id}`, it.unit || 'un'));

  // Sub-form da linha atual.
  const [catalogSel, setCatalogSel] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState('un');

  const create = useMutation({
    mutationFn: (submit: boolean) => {
      const items: RequestItemInput[] = lines.map((l) => ({
        product_id: l.productId ? Number(l.productId) : null,
        source_item_id: !l.productId && l.sourceItemId ? Number(l.sourceItemId) : null,
        free_text: l.productId ? null : l.freeText,
        quantity: Number(l.quantity.replace(',', '.')) || 1,
        unit: l.unit || 'un',
      }));
      if (editId) {
        return requestsApi.update(editId, { title: title.trim() || undefined, items });
      }
      return requestsApi.create({ title: title.trim() || undefined, items }).then(async (r) => {
        if (submit) await requestsApi.submit(r.id);
        return r;
      });
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['requests'] });
      if (editId) qc.invalidateQueries({ queryKey: ['request', editId] });
      onClose();
      navigate(`/requests/${r.id}`);
    },
    onError: (e) => setError(apiError(e)),
  });

  function addLine() {
    setError('');
    if (!catalogSel) { setError('Escolha ou crie um item'); return; }
    const opt = catalogWithCreated.find((o) => o.value === catalogSel);
    const [kind, idStr] = catalogSel.split(':');
    // Produto canônico → product_id. Item não agrupado → referência do item (source) + nome.
    // Item criado manualmente (new:) → fora do catálogo (free_text).
    setLines((ls) => [...ls, {
      key: Date.now(),
      productId: kind === 'p' ? idStr : '',
      sourceItemId: kind === 'i' ? idStr : '',
      freeText: kind === 'p' ? '' : (opt?.label ?? ''),
      quantity, unit,
    }]);
    setCatalogSel(''); setQuantity('1'); setUnit('un');
    // Devolve o foco ao campo de busca: lançar 20 itens não pode exigir voltar o mouse
    // ao campo a cada um. O Combobox é um <button>, então miramos ele dentro do wrapper.
    requestAnimationFrame(() => searchRef.current?.querySelector('button')?.focus());
  }

  /** Enter em Qtd/Unidade lança a linha (sem submeter o formulário). */
  function onEnterAdd(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); addLine(); }
  }

  function nameOf(l: Draft): string {
    if (l.productId) return products?.find((p) => p.id === Number(l.productId))?.name ?? `Produto ${l.productId}`;
    return l.freeText;
  }

  return (
    <Modal title={editId ? 'Editar lista de compras' : 'Nova lista de compras'} onClose={onClose} size="wide">
      <div className="space-y-4">
        {error && <ErrorBox message={error} />}
        <Field label="Título (opcional)"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Compras da semana" /></Field>

        {/* Adicionar item vem ANTES da lista: com 20 itens lançados, um painel embaixo
            sairia da tela e obrigaria a rolar a cada item. */}
        <Card className="space-y-3 border-emerald-100 bg-emerald-50/40">
          <div className="grid gap-2 sm:grid-cols-[1fr_6rem_7rem_auto]">
            <div ref={searchRef}>
              <Combobox
                options={catalogWithCreated}
                value={catalogSel}
                onChange={(v) => { setCatalogSel(v); setUnit(unitByValue.get(v) || 'un'); }}
                onCreate={(name) => {
                  const v = `new:${name}`;
                  setCreated((c) => (c.some((o) => o.value === v) ? c : [...c, { value: v, label: name, hint: 'novo item' }]));
                  setCatalogSel(v); setUnit('un');
                }}
                placeholder="Buscar item ou criar novo…"
              />
            </div>
            {/* Enter lança a linha: dá para cadastrar a lista inteira sem soltar o teclado. */}
            <Input value={quantity} onChange={(e) => setQuantity(e.target.value)} onKeyDown={onEnterAdd} placeholder="Qtd" inputMode="decimal" aria-label="Quantidade" />
            <Input value={unit} onChange={(e) => setUnit(e.target.value)} onKeyDown={onEnterAdd} placeholder="un/kg/cx" aria-label="Unidade" />
            <Button type="button" onClick={addLine}><Plus size={15} /> Adicionar</Button>
          </div>
          <p className="text-xs text-slate-500">Escolha o item, ajuste a quantidade e tecle <kbd className="rounded border border-slate-300 bg-white px-1">Enter</kbd> para lançar.</p>
        </Card>

        {/* Linhas adicionadas — quantidade e unidade editáveis aqui mesmo: antes era
            preciso excluir e relançar o item só para corrigir um número. */}
        {lines.length === 0 ? (
          <EmptyState message="Nenhum item na lista ainda. Use o campo acima para lançar." />
        ) : (
          <Card className="p-0">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
              <span className="text-sm font-semibold text-slate-700">Itens da lista</span>
              <span className="text-xs font-medium text-slate-500">{lines.length} {lines.length === 1 ? 'item' : 'itens'}</span>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {lines.map((l) => (
                  <tr key={l.key} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-2 font-medium text-slate-800">
                      {nameOf(l)}
                      {!l.productId && <span className="ml-2 text-xs text-amber-600">(fora do catálogo)</span>}
                    </td>
                    <td className="w-24 px-2 py-2">
                      <Input
                        value={l.quantity}
                        onChange={(e) => setLines((ls) => ls.map((x) => x.key === l.key ? { ...x, quantity: e.target.value } : x))}
                        className="text-right"
                        inputMode="decimal"
                        aria-label={`Quantidade de ${nameOf(l)}`}
                      />
                    </td>
                    <td className="w-24 px-2 py-2">
                      <Input
                        value={l.unit}
                        onChange={(e) => setLines((ls) => ls.map((x) => x.key === l.key ? { ...x, unit: e.target.value } : x))}
                        aria-label={`Unidade de ${nameOf(l)}`}
                      />
                    </td>
                    <td className="w-12 px-3 py-2 text-right">
                      <IconBtn title={`Remover ${nameOf(l)}`} hover="red" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                        <Trash2 size={15} />
                      </IconBtn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          {editId ? (
            <Button type="button" disabled={!lines.length || create.isPending} onClick={() => create.mutate(false)}>Salvar alterações</Button>
          ) : (
            <>
              <Button type="button" variant="ghost" disabled={!lines.length || create.isPending} onClick={() => create.mutate(false)}>Salvar rascunho</Button>
              <Button type="button" disabled={!lines.length || create.isPending} onClick={() => create.mutate(true)}>Enviar para o admin</Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
