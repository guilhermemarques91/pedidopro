import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, ListChecks, Pencil } from 'lucide-react';
import { requestsApi, productsApi, RequestItemInput } from '../../services/resources';
import { apiError } from '../../services/api';
import { useAuth } from '../../store/auth.store';
import { date } from '../../utils/format';
import { PageHeader } from '../../components/PageHeader';
import { Button, Card, Field, Input, Combobox, Modal, Badge, Spinner, ErrorBox, EmptyState, ComboOption } from '../../components/ui';

// Linha em edição na nova lista.
interface Draft { key: number; productId: string; freeText: string; quantity: string; unit: string }

// Status em que a lista ainda pode ser editada (funcionário: até submitted; admin: até allocated).
function canEdit(status: string, isAdmin: boolean): boolean {
  if (isAdmin) return ['draft', 'submitted', 'allocated'].includes(status);
  return ['draft', 'submitted'].includes(status);
}

export function Requests() {
  const qc = useQueryClient();
  const isAdmin = useAuth((s) => s.hasRole('admin'));
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
  const { data: products } = useQuery({ queryKey: ['products'], queryFn: productsApi.list });
  const { data: unmapped } = useQuery({ queryKey: ['products', 'unmapped'], queryFn: productsApi.unmapped });
  const { data: editing } = useQuery({
    queryKey: ['request', editId],
    queryFn: () => requestsApi.get(editId as number),
    enabled: !!editId,
  });
  const [title, setTitle] = useState('');
  const [lines, setLines] = useState<Draft[]>([]);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  // Pré-carrega título e linhas ao editar uma lista existente.
  if (editing && !loaded) {
    setLoaded(true);
    setTitle(editing.title);
    setLines(editing.items.map((it, i) => ({
      key: Date.now() + i,
      productId: it.product_id ? String(it.product_id) : '',
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

  // Unidade padrão de compra por opção do catálogo (produto → oferta mais barata; item → unidade do item).
  const unitByValue = new Map<string, string>();
  (products ?? []).forEach((p) => unitByValue.set(`p:${p.id}`, p.default_unit || 'un'));
  (unmapped ?? []).forEach((it) => unitByValue.set(`i:${it.id}`, it.unit || 'un'));

  // Sub-form da linha atual.
  const [mode, setMode] = useState<'product' | 'free'>('product');
  const [catalogSel, setCatalogSel] = useState('');
  const [freeText, setFreeText] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState('un');

  const create = useMutation({
    mutationFn: (submit: boolean) => {
      const items: RequestItemInput[] = lines.map((l) => ({
        product_id: l.productId ? Number(l.productId) : null,
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
    if (mode === 'free') {
      if (!freeText.trim()) { setError('Digite o nome do item'); return; }
      setLines((ls) => [...ls, { key: Date.now(), productId: '', freeText: freeText.trim(), quantity, unit }]);
    } else {
      if (!catalogSel) { setError('Escolha um produto ou item'); return; }
      const opt = catalog.find((o) => o.value === catalogSel);
      const [kind, idStr] = catalogSel.split(':');
      // Produto canônico → product_id. Item ainda não agrupado → texto livre com o nome do item.
      setLines((ls) => [...ls, {
        key: Date.now(),
        productId: kind === 'p' ? idStr : '',
        freeText: kind === 'p' ? '' : (opt?.label ?? ''),
        quantity, unit,
      }]);
    }
    setCatalogSel(''); setFreeText(''); setQuantity('1'); setUnit('un');
  }

  function nameOf(l: Draft): string {
    if (l.productId) return products?.find((p) => p.id === Number(l.productId))?.name ?? `Produto ${l.productId}`;
    return l.freeText;
  }

  return (
    <Modal title={editId ? 'Editar lista de compras' : 'Nova lista de compras'} onClose={onClose} size="xl">
      <div className="space-y-4">
        {error && <ErrorBox message={error} />}
        <Field label="Título (opcional)"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Compras da semana" /></Field>

        {/* Linhas adicionadas */}
        {lines.length > 0 && (
          <Card className="p-0">
            <table className="w-full text-sm">
              <tbody>
                {lines.map((l) => (
                  <tr key={l.key} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-2 font-medium text-slate-800">
                      {nameOf(l)}
                      {!l.productId && <span className="ml-2 text-xs text-amber-600">(fora do catálogo)</span>}
                    </td>
                    <td className="px-4 py-2 text-right text-slate-500">{l.quantity} {l.unit}</td>
                    <td className="w-10 px-4 py-2 text-right">
                      <button onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="text-slate-300 hover:text-red-600"><Trash2 size={15} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        {/* Adicionar item */}
        <Card className="space-y-3 bg-slate-50">
          <div className="flex gap-2 text-sm">
            <button onClick={() => setMode('product')} className={`rounded-lg px-3 py-1 font-medium ${mode === 'product' ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600'}`}>Do catálogo</button>
            <button onClick={() => setMode('free')} className={`rounded-lg px-3 py-1 font-medium ${mode === 'free' ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600'}`}>+ outro item</button>
          </div>
          {mode === 'product' ? (
            <Combobox
              options={catalog}
              value={catalogSel}
              onChange={(v) => { setCatalogSel(v); setUnit(unitByValue.get(v) || 'un'); }}
              placeholder="— selecione o produto ou item —"
            />
          ) : (
            <Input value={freeText} onChange={(e) => setFreeText(e.target.value)} placeholder="Nome do item (ex.: Cebola)" />
          )}
          <div className="flex gap-2">
            <Input value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="Qtd" className="w-24" />
            <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="un/kg/cx" className="w-28" />
            <Button type="button" variant="secondary" onClick={addLine}><Plus size={15} /> Adicionar</Button>
          </div>
        </Card>

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
