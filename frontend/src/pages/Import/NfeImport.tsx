import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload, CheckCircle2, AlertTriangle } from 'lucide-react';
import { api, apiError } from '../../services/api';
import { brl } from '../../utils/format';
import { Button, Card, Spinner, ErrorBox, EmptyState } from '../../components/ui';

interface NfeItem {
  code: string; name: string; ncm: string; unit: string;
  quantity: number; unit_price: number; total: number;
  product_match_id: number | null; product_match_name: string | null;
}
interface NfePreview {
  key: string; number: string; issued_at: string | null; total: number | null;
  supplier: { cnpj: string; name: string; fantasia: string };
  supplier_match_id: number | null; supplier_match_name: string | null;
  duplicate: boolean; items: NfeItem[];
}
interface NfeHistoryRow {
  id: number; number: string | null; supplier_name: string | null;
  item_count: number; total: string | null; created_at: string; user_name?: string | null;
}

const fd = (file: File, extra?: Record<string, string>) => {
  const f = new FormData();
  f.append('file', file);
  Object.entries(extra ?? {}).forEach(([k, v]) => f.append(k, v));
  return f;
};

/** Entrada de estoque pelo XML da NF-e: upload → conferência → lançamento. */
export function NfeImport() {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<NfePreview | null>(null);
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [result, setResult] = useState<{ items_imported: number; products_created: number } | null>(null);
  const [error, setError] = useState('');

  const history = useQuery({
    queryKey: ['nfe-history'],
    queryFn: () => api.get<NfeHistoryRow[]>('/nfe/history').then((r) => r.data),
  });

  const doPreview = useMutation({
    mutationFn: () => api.post<NfePreview>('/nfe/preview', fd(file!)).then((r) => r.data),
    onSuccess: (d) => { setPreview(d); setSkip(new Set()); setResult(null); setError(''); },
    onError: (e) => setError(apiError(e)),
  });
  const doImport = useMutation({
    mutationFn: () => api.post('/nfe/import', fd(file!, { skip: [...skip].join(',') })).then((r) => r.data),
    onSuccess: (d) => {
      setResult(d); setPreview(null); setFile(null);
      history.refetch();
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['items'] });
      qc.invalidateQueries({ queryKey: ['suppliers'] });
    },
    onError: (e) => setError(apiError(e)),
  });

  const toggle = (i: number) => setSkip((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });

  return (
    <div>
      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600 hover:border-emerald-500">
            <Upload size={18} />
            {file ? file.name : 'Escolher XML da NF-e'}
            <input type="file" accept=".xml,text/xml" className="hidden"
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setResult(null); setError(''); }} />
          </label>
          <Button onClick={() => doPreview.mutate()} disabled={!file || doPreview.isPending}>Conferir nota</Button>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          O XML é o arquivo que o fornecedor envia junto com a nota (procNFe). Fornecedor é casado pelo CNPJ;
          produtos pelo nome — o que não existir é criado, e a entrada usa o custo da nota.
        </p>
      </Card>

      {error && <div className="mb-4"><ErrorBox message={error} /></div>}
      {(doPreview.isPending || doImport.isPending) && <Spinner />}

      {result && (
        <Card className="mb-4 flex items-center gap-3 border-emerald-200 bg-emerald-50">
          <CheckCircle2 className="text-emerald-600" size={22} />
          <p className="text-sm text-emerald-800">
            Entrada lançada: <strong>{result.items_imported}</strong> item(ns) no estoque
            {result.products_created > 0 && <> · {result.products_created} produto(s) novo(s) criado(s)</>}.
          </p>
        </Card>
      )}

      {preview && (
        <Card className="mb-4 p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <div>
              <p className="font-semibold text-slate-800">NF-e nº {preview.number} · {preview.total != null ? brl(String(preview.total)) : ''}</p>
              <p className="text-xs text-slate-500">
                {preview.supplier.name} — CNPJ {preview.supplier.cnpj}
                {preview.supplier_match_name
                  ? <span className="ml-1 text-emerald-600">✓ fornecedor cadastrado</span>
                  : <span className="ml-1 text-amber-600">novo fornecedor será criado</span>}
              </p>
            </div>
            {preview.duplicate ? (
              <span className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-1.5 text-sm text-amber-700"><AlertTriangle size={16} /> Nota já lançada</span>
            ) : (
              <Button onClick={() => doImport.mutate()} disabled={doImport.isPending || skip.size === preview.items.length}>
                Lançar entrada ({preview.items.length - skip.size} itens)
              </Button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="border-b border-slate-200 text-left text-slate-500">
                <tr>
                  <th className="w-10 px-4 py-2" />
                  <th className="px-2 py-2 font-medium">Item da nota</th>
                  <th className="px-2 py-2 text-right font-medium">Qtd</th>
                  <th className="px-2 py-2 text-right font-medium">Custo un.</th>
                  <th className="px-2 py-2 font-medium">Produto no estoque</th>
                </tr>
              </thead>
              <tbody>
                {preview.items.map((it, i) => (
                  <tr key={i} className={`border-b border-slate-50 last:border-0 ${skip.has(i) ? 'opacity-40' : ''}`}>
                    <td className="px-4 py-2"><input type="checkbox" checked={!skip.has(i)} onChange={() => toggle(i)} className="h-4 w-4 accent-emerald-600" /></td>
                    <td className="px-2 py-2 font-medium text-slate-800">{it.name} <span className="text-xs font-normal text-slate-400">({it.code})</span></td>
                    <td className="px-2 py-2 text-right text-slate-600">{it.quantity} {it.unit}</td>
                    <td className="px-2 py-2 text-right text-slate-600">{brl(String(it.unit_price))}</td>
                    <td className="px-2 py-2">
                      {it.product_match_name
                        ? <span className="text-emerald-700">✓ {it.product_match_name}</span>
                        : <span className="text-amber-600">será criado</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Notas já lançadas</h3>
      {history.data && (history.data.length === 0 ? (
        <EmptyState message="Nenhuma NF-e lançada ainda." />
      ) : (
        <Card className="divide-y divide-slate-100 p-0">
          {history.data.map((n) => (
            <div key={n.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <div>
                <span className="font-medium text-slate-800">NF {n.number}</span>
                <span className="ml-2 text-slate-500">{n.supplier_name}</span>
              </div>
              <span className="text-xs text-slate-400">
                {n.item_count} item(ns){n.total != null ? ` · ${brl(n.total)}` : ''} · {new Date(n.created_at).toLocaleDateString('pt-BR')}
              </span>
            </div>
          ))}
        </Card>
      ))}
    </div>
  );
}
