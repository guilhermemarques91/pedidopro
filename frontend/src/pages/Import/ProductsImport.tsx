import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, CheckCircle2, AlertTriangle } from 'lucide-react';
import { productsImportApi, ProductsImportPreview, ProductsImportResult } from '../../services/resources';
import { apiError } from '../../services/api';
import { Button, Card, Spinner, ErrorBox } from '../../components/ui';
import { brl } from '../../utils/format';

/** Importa o cadastro de Produtos/Estoque a partir do relatório "Lista completa de itens
 * cadastrados" do sistema atual do usuário (AllFood): cria/atualiza Classe, Sub-Classe e produtos. */
export function ProductsImport() {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ProductsImportPreview | null>(null);
  const [result, setResult] = useState<ProductsImportResult | null>(null);
  const [error, setError] = useState('');

  const doPreview = useMutation({
    mutationFn: () => productsImportApi.preview(file!),
    onSuccess: (d) => { setPreview(d); setResult(null); setError(''); },
    onError: (e) => setError(apiError(e)),
  });
  const doCommit = useMutation({
    mutationFn: () => productsImportApi.commit(file!),
    onSuccess: (d) => {
      setResult(d); setPreview(null);
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['product-types'] });
    },
    onError: (e) => setError(apiError(e)),
  });

  function pick(f: File | null) {
    setFile(f); setPreview(null); setResult(null); setError('');
  }

  return (
    <div>
      <Card className="mb-6">
        <div className="flex items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600 hover:border-emerald-500">
            <Upload size={18} />
            {file ? file.name : 'Escolher planilha (.xlsx)'}
            <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
          </label>
          <Button disabled={!file || doPreview.isPending} onClick={() => doPreview.mutate()}>
            {doPreview.isPending ? 'Analisando...' : 'Pré-visualizar'}
          </Button>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Relatório "Lista completa de itens cadastrados" exportado do sistema atual (AllFood). Casa pelo código
          interno quando existente no cadastro; senão pelo nome. Classe/Sub-Classe são criadas automaticamente.
        </p>
      </Card>

      {error && <div className="mb-4"><ErrorBox message={error} /></div>}
      {(doPreview.isPending || doCommit.isPending) && <Spinner />}

      {preview && (
        <Card>
          <h3 className="mb-3 text-lg font-semibold text-slate-800">Pré-visualização</h3>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Linhas válidas" value={preview.validRows} />
            <Stat label="Com erro" value={preview.errorRows} warn={preview.errorRows > 0} />
            <Stat label="Produtos (novos/atualiz.)" value={`${preview.newProducts}/${preview.updatedProducts}`} />
            <Stat label="Classes/Sub-classes novas" value={`${preview.newClasses.length}/${preview.newSubclasses.length}`} />
          </div>
          {preview.newClasses.length > 0 && (
            <p className="mb-2 text-sm text-slate-600">
              <span className="font-medium">Classes novas:</span> {preview.newClasses.slice(0, 10).join(', ')}
              {preview.newClasses.length > 10 && ` +${preview.newClasses.length - 10}`}
            </p>
          )}
          {preview.errorRows > 0 && (
            <div className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              <AlertTriangle size={16} className="mb-1 inline" /> {preview.errorRows} linha(s) serão ignoradas (dados incompletos).
            </div>
          )}

          {preview.sample.length > 0 && (
            <div className="mb-4 overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="bg-slate-50 text-left text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Descrição</th>
                    <th className="px-3 py-2 font-medium">Tipo</th>
                    <th className="px-3 py-2 font-medium">Classe / Sub-classe</th>
                    <th className="px-3 py-2 text-right font-medium">Venda</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.sample.map((r) => (
                    <tr key={r.rowNumber} className="border-t border-slate-100">
                      <td className="px-3 py-2 text-slate-800">{r.name}</td>
                      <td className="px-3 py-2 text-slate-600">{r.tipo}</td>
                      <td className="px-3 py-2 text-slate-500">{r.classe ?? '—'}{r.sub_classe ? ` / ${r.sub_classe}` : ''}</td>
                      <td className="px-3 py-2 text-right text-slate-700">{r.sale_price != null ? brl(r.sale_price) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Button disabled={doCommit.isPending || preview.validRows === 0} onClick={() => doCommit.mutate()}>
            Confirmar importação de {preview.validRows} produtos
          </Button>
        </Card>
      )}

      {result && (
        <Card>
          <div className="flex items-center gap-2 text-emerald-700">
            <CheckCircle2 size={22} />
            <h3 className="text-lg font-semibold">Importação concluída!</h3>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Produtos criados" value={result.productsCreated} />
            <Stat label="Produtos atualizados" value={result.productsUpdated} />
            <Stat label="Classes criadas" value={result.classesCreated} />
            <Stat label="Sub-classes criadas" value={result.subclassesCreated} />
          </div>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: number | string; warn?: boolean }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <p className={`text-2xl font-bold ${warn ? 'text-amber-600' : 'text-slate-800'}`}>{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}
