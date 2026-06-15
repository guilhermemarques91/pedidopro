import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, CheckCircle2, AlertTriangle } from 'lucide-react';
import { importApi, ImportPreview, ImportResult } from '../../services/resources';
import { apiError } from '../../services/api';
import { PageHeader } from '../../components/PageHeader';
import { Button, Card, Spinner, ErrorBox } from '../../components/ui';

export function Import() {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');

  const doPreview = useMutation({
    mutationFn: () => importApi.preview(file!),
    onSuccess: (d) => { setPreview(d); setResult(null); setError(''); },
    onError: (e) => setError(apiError(e)),
  });
  const doCommit = useMutation({
    mutationFn: () => importApi.commit(file!),
    onSuccess: (d) => {
      setResult(d); setPreview(null);
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      qc.invalidateQueries({ queryKey: ['items'] });
      qc.invalidateQueries({ queryKey: ['categories'] });
    },
    onError: (e) => setError(apiError(e)),
  });

  function pick(f: File | null) {
    setFile(f); setPreview(null); setResult(null); setError('');
  }

  return (
    <div>
      <PageHeader title="Importação" subtitle="Planilha .xlsx gerada a partir das notas fiscais" />

      <Card className="mb-6">
        <div className="flex items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600 hover:border-emerald-500">
            <Upload size={18} />
            {file ? file.name : 'Escolher arquivo .xlsx'}
            <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
          </label>
          <Button disabled={!file || doPreview.isPending} onClick={() => doPreview.mutate()}>
            {doPreview.isPending ? 'Analisando...' : 'Pré-visualizar'}
          </Button>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Colunas: fornecedor, categoria, item, unidade, embalagem_qtd, embalagem_unidade, preco, whatsapp
        </p>
      </Card>

      {error && <ErrorBox message={error} />}
      {(doPreview.isPending || doCommit.isPending) && <Spinner />}

      {preview && (
        <Card>
          <h3 className="mb-3 text-lg font-semibold text-slate-800">Pré-visualização</h3>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Linhas válidas" value={preview.validRows} />
            <Stat label="Com erro" value={preview.errorRows} warn={preview.errorRows > 0} />
            <Stat label="Fornecedores novos" value={preview.newSuppliers.length} />
            <Stat label="Itens (novos/atualiz.)" value={`${preview.newItems}/${preview.updatedItems}`} />
          </div>
          {preview.newSuppliers.length > 0 && (
            <p className="mb-3 text-sm text-slate-600">
              <span className="font-medium">Novos fornecedores:</span> {preview.newSuppliers.slice(0, 8).join(', ')}
              {preview.newSuppliers.length > 8 && ` +${preview.newSuppliers.length - 8}`}
            </p>
          )}
          {preview.errorRows > 0 && (
            <div className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              <AlertTriangle size={16} className="mb-1 inline" /> {preview.errorRows} linha(s) serão ignoradas (dados incompletos).
            </div>
          )}
          <Button disabled={doCommit.isPending || preview.validRows === 0} onClick={() => doCommit.mutate()}>
            Confirmar importação de {preview.validRows} itens
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
            <Stat label="Fornecedores criados" value={result.suppliersCreated} />
            <Stat label="Categorias criadas" value={result.categoriesCreated} />
            <Stat label="Itens criados" value={result.itemsCreated} />
            <Stat label="Itens atualizados" value={result.itemsUpdated} />
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
