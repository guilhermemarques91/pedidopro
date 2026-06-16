import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, ListChecks } from 'lucide-react';
import { requestsApi, productsApi, RequestItemInput } from '../../services/resources';
import { apiError } from '../../services/api';
import type { Product } from '../../types';
import { date } from '../../utils/format';
import { PageHeader } from '../../components/PageHeader';
import { Button, Card, Field, Input, Select, Modal, Badge, Spinner, ErrorBox, EmptyState } from '../../components/ui';

// Linha em edição na nova lista.
interface Draft { key: number; productId: string; freeText: string; quantity: string; unit: string }

export function Requests() {
  const [open, setOpen] = useState(false);
  const { data, isLoading, error } = useQuery({ queryKey: ['requests'], queryFn: requestsApi.list });

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
            <Link key={r.id} to={`/requests/${r.id}`}>
              <Card className="flex items-center justify-between transition hover:border-emerald-300">
                <div className="flex items-center gap-3">
                  <ListChecks size={18} className="text-emerald-600" />
                  <div>
                    <p className="font-medium text-slate-800">{r.title}</p>
                    <p className="text-xs text-slate-400">
                      {r.item_count} item(ns) · {r.created_by_name} · {date(r.created_at)}
                    </p>
                  </div>
                </div>
                <Badge status={r.status} />
              </Card>
            </Link>
          ))}
        </div>
      ))}

      {open && <RequestForm onClose={() => setOpen(false)} />}
    </div>
  );
}

function RequestForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: products } = useQuery({ queryKey: ['products'], queryFn: productsApi.list });
  const [title, setTitle] = useState('');
  const [lines, setLines] = useState<Draft[]>([]);
  const [error, setError] = useState('');

  // Sub-form da linha atual.
  const [mode, setMode] = useState<'product' | 'free'>('product');
  const [productId, setProductId] = useState('');
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
      return requestsApi.create({ title: title.trim() || undefined, items }).then(async (r) => {
        if (submit) await requestsApi.submit(r.id);
        return r;
      });
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['requests'] });
      onClose();
      navigate(`/requests/${r.id}`);
    },
    onError: (e) => setError(apiError(e)),
  });

  function addLine() {
    setError('');
    if (mode === 'product' && !productId) { setError('Escolha um produto ou use texto livre'); return; }
    if (mode === 'free' && !freeText.trim()) { setError('Digite o nome do item'); return; }
    setLines((ls) => [...ls, {
      key: Date.now(),
      productId: mode === 'product' ? productId : '',
      freeText: mode === 'free' ? freeText.trim() : '',
      quantity, unit,
    }]);
    setProductId(''); setFreeText(''); setQuantity('1'); setUnit('un');
  }

  function nameOf(l: Draft): string {
    if (l.productId) return (products as Product[] | undefined)?.find((p) => p.id === Number(l.productId))?.name ?? `Produto ${l.productId}`;
    return l.freeText;
  }

  return (
    <Modal title="Nova lista de compras" onClose={onClose} size="xl">
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
            <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">— selecione o produto —</option>
              {products?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
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
          <Button type="button" variant="ghost" disabled={!lines.length || create.isPending} onClick={() => create.mutate(false)}>Salvar rascunho</Button>
          <Button type="button" disabled={!lines.length || create.isPending} onClick={() => create.mutate(true)}>Enviar para o admin</Button>
        </div>
      </div>
    </Modal>
  );
}
