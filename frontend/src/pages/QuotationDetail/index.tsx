import { FormEvent, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash2, Lock, Sparkles, Trophy } from 'lucide-react';
import { quotationsApi, suppliersApi, itemsApi } from '../../services/resources';
import { apiError } from '../../services/api';
import { useAuth } from '../../store/auth.store';
import { brl, parseNum } from '../../utils/format';
import { Button, Card, Field, Input, Select, Modal, Spinner, ErrorBox, EmptyState, Badge } from '../../components/ui';

export function QuotationDetailPage() {
  const { id } = useParams();
  const qid = Number(id);
  const qc = useQueryClient();
  const canWrite = useAuth((s) => s.hasRole('admin', 'buyer'));
  const [addOpen, setAddOpen] = useState(false);
  const [extractOpen, setExtractOpen] = useState(false);

  const { data, isLoading, error } = useQuery({ queryKey: ['quotation', qid], queryFn: () => quotationsApi.get(qid) });
  const { data: comparison } = useQuery({ queryKey: ['comparison', qid], queryFn: () => quotationsApi.comparison(qid) });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['quotation', qid] });
    qc.invalidateQueries({ queryKey: ['comparison', qid] });
  };
  const removeItem = useMutation({ mutationFn: (itemId: number) => quotationsApi.removeItem(qid, itemId), onSuccess: invalidate });
  const close = useMutation({ mutationFn: () => quotationsApi.close(qid), onSuccess: invalidate });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox message={apiError(error)} />;
  if (!data) return null;

  const editable = data.status !== 'closed' && canWrite;

  return (
    <div>
      <Link to="/quotations" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"><ArrowLeft size={16} /> Cotações</Link>
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-slate-800">{data.title}</h1>
          <Badge status={data.status} />
        </div>
        {editable && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setExtractOpen(true)}><Sparkles size={16} /> Extrair por IA</Button>
            <Button variant="secondary" onClick={() => setAddOpen(true)}><Plus size={16} /> Lançar preço</Button>
            <Button onClick={() => confirm('Fechar a cotação? Os preços irão para o histórico e não poderão mais ser editados.') && close.mutate()}><Lock size={16} /> Fechar</Button>
          </div>
        )}
      </div>

      {/* Comparativo */}
      {comparison && comparison.length > 0 && (
        <Card className="mb-6">
          <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold text-slate-800"><Trophy size={18} className="text-amber-500" /> Comparativo de preços</h3>
          <div className="space-y-3">
            {comparison.map((row) => (
              <div key={row.item} className="rounded-lg border border-slate-200 p-3">
                <p className="mb-2 font-medium text-slate-800">{row.item} <span className="text-xs text-slate-400">({row.unit})</span></p>
                <div className="flex flex-wrap gap-2">
                  {row.offers.map((o) => (
                    <span key={o.qiId} className={`rounded-md px-2.5 py-1 text-sm ${o.isBest ? 'bg-emerald-100 font-semibold text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
                      {o.supplier}: {brl(o.price)} {o.isBest && '🏆'}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Lançamentos */}
      <Card className="p-0">
        <h3 className="px-5 pt-4 text-lg font-semibold text-slate-800">Lançamentos ({data.items.length})</h3>
        {data.items.length === 0 ? (
          <div className="p-5"><EmptyState message="Nenhum preço lançado ainda." /></div>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Item</th>
                <th className="px-5 py-3 font-medium">Fornecedor</th>
                <th className="px-5 py-3 font-medium text-right">Preço</th>
                <th className="px-5 py-3 font-medium">Origem</th>
                {editable && <th className="px-5 py-3" />}
              </tr>
            </thead>
            <tbody>
              {data.items.map((it) => (
                <tr key={it.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-5 py-3 font-medium text-slate-800">{it.item_name}</td>
                  <td className="px-5 py-3 text-slate-600">{it.supplier_name}</td>
                  <td className="px-5 py-3 text-right text-slate-600">{brl(it.price)}</td>
                  <td className="px-5 py-3">
                    <span className="text-xs text-slate-500">
                      {it.source}{it.extracted_by_ai && ' 🤖'}{!it.reviewed && it.extracted_by_ai && <span className="ml-1 text-amber-600">(revisar)</span>}
                    </span>
                  </td>
                  {editable && (
                    <td className="px-5 py-3 text-right">
                      <button onClick={() => removeItem.mutate(it.id)} className="text-slate-400 hover:text-red-600"><Trash2 size={16} /></button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {addOpen && <AddPriceForm qid={qid} onClose={() => { setAddOpen(false); invalidate(); }} />}
      {extractOpen && <ExtractForm qid={qid} onClose={() => { setExtractOpen(false); invalidate(); }} />}
    </div>
  );
}

function AddPriceForm({ qid, onClose }: { qid: number; onClose: () => void }) {
  const { data: suppliers } = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });
  const [supplierId, setSupplierId] = useState('');
  const { data: items } = useQuery({
    queryKey: ['items', supplierId ? Number(supplierId) : undefined],
    queryFn: () => itemsApi.list(supplierId ? Number(supplierId) : undefined),
    enabled: !!supplierId,
  });
  const [itemId, setItemId] = useState('');
  const [price, setPrice] = useState('');
  const [error, setError] = useState('');

  const add = useMutation({
    mutationFn: () => quotationsApi.addItem(qid, {
      item_id: Number(itemId), supplier_id: Number(supplierId), price: parseNum(price) ?? undefined,
    }),
    onSuccess: onClose,
    onError: (e) => setError(apiError(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault(); setError('');
    if (!itemId) { setError('Selecione o item'); return; }
    add.mutate();
  }

  return (
    <Modal title="Lançar preço" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorBox message={error} />}
        <Field label="Fornecedor">
          <Select value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setItemId(''); }} required>
            <option value="">— selecione —</option>
            {suppliers?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Item">
          <Select value={itemId} onChange={(e) => setItemId(e.target.value)} disabled={!supplierId} required>
            <option value="">— selecione —</option>
            {items?.map((it) => <option key={it.id} value={it.id}>{it.name} ({it.unit})</option>)}
          </Select>
        </Field>
        <Field label="Preço"><Input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="12,90" required /></Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={add.isPending}>Lançar</Button>
        </div>
      </form>
    </Modal>
  );
}

function ExtractForm({ qid, onClose }: { qid: number; onClose: () => void }) {
  const { data: suppliers } = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });
  const [mode, setMode] = useState<'text' | 'file'>('text');
  const [supplierId, setSupplierId] = useState('');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');

  const extract = useMutation({
    mutationFn: () =>
      mode === 'text'
        ? quotationsApi.extractText(qid, Number(supplierId), text)
        : quotationsApi.extract(qid, Number(supplierId), file!),
    onSuccess: onClose,
    onError: (e) => setError(apiError(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault(); setError('');
    if (!supplierId) { setError('Selecione o fornecedor'); return; }
    if (mode === 'text' && text.trim().length < 3) { setError('Cole o texto do orçamento'); return; }
    if (mode === 'file' && !file) { setError('Selecione o arquivo'); return; }
    extract.mutate();
  }

  const tab = (m: 'text' | 'file', label: string) => (
    <button
      type="button"
      onClick={() => { setMode(m); setError(''); }}
      className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
        mode === m ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
      }`}
    >
      {label}
    </button>
  );

  return (
    <Modal title="Extrair preços por IA" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorBox message={error} />}

        <div className="flex gap-2">
          {tab('text', '💬 Colar texto')}
          {tab('file', '📄 PDF / imagem')}
        </div>

        <Field label="Fornecedor">
          <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
            <option value="">— selecione —</option>
            {suppliers?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>

        {mode === 'text' ? (
          <Field label="Mensagem / orçamento">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={7}
              placeholder={'Cole aqui a mensagem do WhatsApp, ex.:\nFrango congelado 12,90 o kg\nPicanha 69,90/kg\nEmbalagem 500ml cx c/100 - 0,85'}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
            />
          </Field>
        ) : (
          <Field label="Documento (PDF ou imagem)">
            <input type="file" accept=".pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
          </Field>
        )}

        <p className="text-xs text-slate-400">
          A IA local (Ollama) extrai os itens e preços para o fornecedor selecionado. Itens entram marcados para revisão.
        </p>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={extract.isPending}>{extract.isPending ? 'Extraindo...' : 'Extrair'}</Button>
        </div>
      </form>
    </Modal>
  );
}
