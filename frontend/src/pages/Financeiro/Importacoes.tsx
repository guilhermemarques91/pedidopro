import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Trash2, Upload } from 'lucide-react';
import { financeiroApi } from '../../services/resources';
import { apiError } from '../../services/api';
import { Button, Card, Input, Spinner, ErrorBox, EmptyState } from '../../components/ui';
import type { FinImportPreview, FinImportResult } from '../../types';
import { date, datetime, monthLabel } from '../../utils/format';

/**
 * Importação das planilhas financeiras, no mesmo fluxo de duas fases dos outros
 * importadores do ERP: pré-visualizar → conferir → confirmar.
 *
 * A FONTE é detectada pelo conteúdo do arquivo, então é o mesmo botão para o DRE,
 * o contas a pagar, a ficha técnica e os relatórios das plataformas.
 */
const ACCEPTED = [
  'AllFood — Dashboard DRE (mensal)',
  'AllFood — Contas a pagar',
  'AllFood — Ficha técnica',
  '99Food — Dados da loja',
  'iFood — Qualidade da operação',
];

export function Importacoes() {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<FinImportPreview | null>(null);
  const [result, setResult] = useState<FinImportResult | null>(null);
  const [error, setError] = useState('');
  // Só usados quando o arquivo não traz a informação (ver avisos abaixo).
  const [year, setYear] = useState('');
  const [snapshot, setSnapshot] = useState('');

  const history = useQuery({ queryKey: ['fin-imports'], queryFn: financeiroApi.imports });

  const opts = () => ({
    year: year ? Number(year) : undefined,
    snapshot_date: snapshot || undefined,
  });

  const pick = (f: File | null) => {
    setFile(f);
    setPreview(null);
    setResult(null);
    setError('');
  };

  const doPreview = useMutation({
    mutationFn: () => financeiroApi.preview(file!, opts()),
    onSuccess: (d) => { setPreview(d); setResult(null); setError(''); },
    onError: (e) => setError(apiError(e)),
  });

  const doCommit = useMutation({
    mutationFn: () => financeiroApi.commit(file!, opts()),
    onSuccess: (d) => {
      setResult(d);
      setPreview(null);
      setFile(null);
      setError('');
      // Toda análise depende do que acabou de entrar.
      ['fin-imports', 'fin-months', 'fin-dre', 'fin-canais', 'fin-produtos', 'fin-cmv', 'fin-breakeven', 'fin-overview', 'fin-accounts']
        .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e) => setError(apiError(e)),
  });

  const remove = useMutation({
    mutationFn: (id: number) => financeiroApi.removeImport(id),
    onSuccess: () => {
      ['fin-imports', 'fin-months', 'fin-dre', 'fin-canais', 'fin-produtos', 'fin-cmv', 'fin-breakeven', 'fin-overview']
        .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e) => setError(apiError(e)),
  });

  const busy = doPreview.isPending || doCommit.isPending;
  const meta = (preview?.meta ?? {}) as Record<string, unknown>;
  const yearInferred = meta.year_was_inferred === true;
  const snapshotMissing = preview?.source === 'allfood_ficha' && meta.snapshot_from_sheet === false;

  return (
    <div className="space-y-5">
      <Card>
        <h3 className="text-sm font-semibold text-slate-700">Enviar planilha</h3>
        <p className="mt-1 text-sm text-slate-500">
          O sistema identifica sozinho qual relatório é. Aceita: {ACCEPTED.join(' · ')}.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600 hover:border-emerald-500">
            <Upload size={18} />
            {file ? file.name : 'Escolher planilha (.xlsx)'}
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => { pick(e.target.files?.[0] ?? null); e.target.value = ''; }}
            />
          </label>
          <Button disabled={!file || busy} onClick={() => doPreview.mutate()}>
            {doPreview.isPending ? 'Analisando...' : 'Pré-visualizar'}
          </Button>
          {busy && <Spinner />}
        </div>

        {error && <div className="mt-3"><ErrorBox message={error} /></div>}
      </Card>

      {preview && (
        <Card>
          <div className="flex flex-wrap items-center gap-2">
            <FileSpreadsheet size={18} className="text-emerald-600" />
            <span className="text-sm font-semibold text-slate-800">{preview.sourceLabel}</span>
            <span className="text-xs text-slate-500">{preview.filename}</span>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Box label="Linhas válidas" value={preview.validRows} />
            <Box label="Com erro" value={preview.errorRows} tone={preview.errorRows > 0 ? 'warn' : 'default'} />
            <Box label="Linhas no arquivo" value={preview.totalRows} />
            <Box
              label="Serão substituídas"
              value={preview.replaces}
              tone={preview.replaces > 0 ? 'warn' : 'default'}
            />
          </div>

          <MetaLine meta={meta} />

          {/* O relatório de qualidade do iFood não traz o ano em lugar nenhum. */}
          {yearInferred && (
            <Warn>
              Este relatório do iFood não informa o ano — assumi <strong>{String(meta.year_used)}</strong>.
              Se estiver errado, informe o ano correto e pré-visualize de novo.
              <div className="mt-2 w-32">
                <Input
                  type="number"
                  placeholder="Ano"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                />
              </div>
            </Warn>
          )}

          {snapshotMissing && (
            <Warn>
              Esta exportação da ficha técnica não traz a linha “Emissão:”. Usei{' '}
              <strong>{date(String(meta.snapshot_date))}</strong> (do nome do arquivo, ou a data de hoje).
              A data define o snapshot usado na evolução de custo — corrija se necessário.
              <div className="mt-2 w-44">
                <Input type="date" value={snapshot} onChange={(e) => setSnapshot(e.target.value)} />
              </div>
            </Warn>
          )}

          {preview.errorRows > 0 && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="flex items-center gap-2 font-medium"><AlertTriangle size={16} /> Linhas ignoradas</p>
              <ul className="mt-1 list-inside list-disc text-xs">
                {preview.errors.slice(0, 8).map((e, i) => (
                  <li key={i}>Linha {e.rowNumber}: {e.errors.join('; ')}</li>
                ))}
                {preview.errors.length > 8 && <li>… e mais {preview.errors.length - 8}.</li>}
              </ul>
            </div>
          )}

          {preview.sample.length > 0 && <SampleTable rows={preview.sample} />}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button disabled={busy || preview.validRows === 0} onClick={() => doCommit.mutate()}>
              {doCommit.isPending ? 'Importando...' : `Confirmar importação de ${preview.validRows} linha(s)`}
            </Button>
            <Button variant="secondary" onClick={() => pick(null)}>Cancelar</Button>
          </div>
        </Card>
      )}

      {result && (
        <Card className="border-emerald-200 bg-emerald-50">
          <p className="flex items-center gap-2 text-sm font-medium text-emerald-900">
            <CheckCircle2 size={18} /> {result.sourceLabel} importado — {result.importedRows} linha(s).
          </p>
          <p className="mt-1 text-xs text-emerald-800">
            {Object.entries(result)
              .filter(([k]) => !['importId', 'source', 'sourceLabel', 'filename', 'totalRows', 'importedRows', 'errorRows', 'errors'].includes(k))
              .map(([k, v]) => `${k}: ${String(v)}`)
              .join(' · ')}
          </p>
        </Card>
      )}

      <Card className="p-0">
        <div className="border-b border-slate-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-700">Importações anteriores</h3>
        </div>
        {history.isLoading ? (
          <div className="p-4"><Spinner /></div>
        ) : !history.data?.length ? (
          <div className="p-4"><EmptyState message="Nenhuma planilha importada ainda." /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead className="border-b border-slate-200 text-left text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Relatório</th>
                  <th className="px-4 py-3 font-medium">Arquivo</th>
                  <th className="px-4 py-3 font-medium">Período</th>
                  <th className="px-4 py-3 text-right font-medium">Linhas</th>
                  <th className="px-4 py-3 font-medium">Quando</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {history.data.map((imp) => (
                  <tr key={imp.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-4 py-2">{imp.source_label}</td>
                    <td className="max-w-[16rem] truncate px-4 py-2 text-xs text-slate-500" title={imp.filename}>
                      {imp.filename}
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-600">
                      {imp.ref_month
                        ? monthLabel(imp.ref_month)
                        : imp.period_start
                          ? `${date(imp.period_start)} – ${date(imp.period_end)}`
                          : '—'}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {imp.imported_rows}
                      {imp.error_rows > 0 && <span className="ml-1 text-xs text-amber-600">({imp.error_rows} erro)</span>}
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-500">{datetime(imp.created_at)}</td>
                    <td className="px-4 py-2 text-right">
                      <button
                        title="Desfazer esta importação (apaga as linhas que ela gravou)"
                        onClick={() => {
                          if (confirm('Desfazer esta importação? As linhas gravadas por ela serão apagadas.')) {
                            remove.mutate(imp.id);
                          }
                        }}
                        className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Box({ label, value, tone = 'default' }: { label: string; value: number; tone?: 'default' | 'warn' }) {
  return (
    <div className={`rounded-lg border p-3 ${tone === 'warn' ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-lg font-semibold ${tone === 'warn' ? 'text-amber-700' : 'text-slate-800'}`}>{value}</p>
    </div>
  );
}

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">{children}</div>
  );
}

/** Resumo do que o parser entendeu do arquivo (competência, período, plataforma). */
function MetaLine({ meta }: { meta: Record<string, unknown> }) {
  const parts: string[] = [];
  if (meta.ref_month) parts.push(`Competência: ${monthLabel(String(meta.ref_month))}`);
  if (meta.period_start && meta.period_end) parts.push(`Período: ${date(String(meta.period_start))} – ${date(String(meta.period_end))}`);
  if (meta.platform) parts.push(`Plataforma: ${String(meta.platform)}`);
  if (meta.snapshot_date) parts.push(`Snapshot: ${date(String(meta.snapshot_date))}`);
  if (meta.items) parts.push(`Itens: ${String(meta.items)}`);
  if (!parts.length) return null;
  return <p className="mt-3 text-xs text-slate-500">{parts.join(' · ')}</p>;
}

/** Primeiras linhas do arquivo já normalizadas — confere antes de gravar. */
function SampleTable({ rows }: { rows: Record<string, unknown>[] }) {
  const cols = Object.keys(rows[0]).filter((k) => k !== 'rowNumber' && k !== 'extra_json').slice(0, 9);
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-xs">
        <thead className="bg-slate-50 text-left text-slate-500">
          <tr>{cols.map((c) => <th key={c} className="px-3 py-2 font-medium">{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100">
              {cols.map((c) => (
                <td key={c} className="max-w-[14rem] truncate px-3 py-1.5 text-slate-700">
                  {r[c] === null || r[c] === undefined ? '—' : String(r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
