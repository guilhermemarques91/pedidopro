import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Lock, Download } from 'lucide-react';
import { marmitexApi } from '../../../services/resources';
import { apiError } from '../../../services/api';
import type { MarmitexReport, MarmitexReportDetail } from '../../../types';
import { PageHeader } from '../../../components/PageHeader';
import { Button, Card, Field, Select, Spinner, ErrorBox, EmptyState } from '../../../components/ui';
import { brl, parseSides, proteinLabel } from '../../../utils/format';

const dmy = (d: string) => d.split('-').reverse().join('/');

/** Aba detalhada: uma linha por marmita, para conferir com a empresa antes de faturar. */
function DetailTable({ data }: { data: MarmitexReportDetail }) {
  function exportCsv() {
    const head = ['Data', 'Nome', 'Tamanho', 'Proteína', 'Acompanhamentos', 'Observação', 'Valor'];
    // Ponto e vírgula + BOM: é o que o Excel em pt-BR abre sem pedir importação.
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = data.rows.map((r) => [
      dmy(r.service_date),
      r.person_name ?? '',
      r.size_name,
      proteinLabel(r.protein_name, r.protein2_name),
      parseSides(r.sides_json).map((s) => s.name).join(', '),
      r.observation ?? '',
      String(r.unit_price).replace('.', ','),
    ].map(esc).join(';'));
    const csv = '﻿' + [head.map(esc).join(';'), ...lines].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `marmitex-${data.company?.name ?? 'empresa'}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  let lastDate = '';
  return (
    <>
      <div className="flex justify-end border-b border-slate-200 px-5 py-3">
        <Button variant="secondary" onClick={exportCsv}><Download size={16} /> Exportar CSV</Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm">
          <thead className="border-b border-slate-200 text-left text-slate-500">
            <tr>
              <th className="px-5 py-3 font-medium">Data</th>
              <th className="px-5 py-3 font-medium">Nome</th>
              <th className="px-5 py-3 font-medium">Tamanho</th>
              <th className="px-5 py-3 font-medium">Proteína</th>
              <th className="px-5 py-3 font-medium">Acompanhamentos</th>
              <th className="px-5 py-3 font-medium text-right">Valor</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => {
              const newDay = r.service_date !== lastDate;
              lastDate = r.service_date;
              return (
                <tr key={i} className={`border-b border-slate-100 last:border-0 ${newDay ? 'border-t border-slate-200' : ''}`}>
                  <td className="px-5 py-2 text-slate-500">{newDay ? dmy(r.service_date) : ''}</td>
                  <td className="px-5 py-2 font-medium text-slate-800">{r.person_name || '—'}</td>
                  <td className="px-5 py-2 text-slate-700">{r.size_name}</td>
                  <td className="px-5 py-2 text-slate-600">{proteinLabel(r.protein_name, r.protein2_name) || '—'}</td>
                  <td className="px-5 py-2 text-slate-500">
                    {parseSides(r.sides_json).map((s) => s.name).join(', ') || '—'}
                    {r.observation && <span className="block text-xs italic">{r.observation}</span>}
                  </td>
                  <td className="px-5 py-2 text-right text-slate-700">{brl(r.unit_price)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-200 bg-slate-50">
              <td className="px-5 py-3 font-semibold text-slate-800" colSpan={5}>{data.marmita_count} marmita(s)</td>
              <td className="px-5 py-3 text-right text-lg font-bold text-emerald-700">{brl(data.grand_total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

export function MarmitexReportPage() {
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [error, setError] = useState('');
  const [closed, setClosed] = useState('');
  const [tab, setTab] = useState<'resumo' | 'detalhe'>('resumo');

  const companies = useQuery({ queryKey: ['marmitex-companies'], queryFn: marmitexApi.companies.list });

  const report = useQuery({
    queryKey: ['marmitex-report', companyId, start, end],
    queryFn: () => marmitexApi.report({ company_id: companyId!, start: start || undefined, end: end || undefined }),
    enabled: !!companyId,
  });

  const detail = useQuery({
    queryKey: ['marmitex-report-detail', companyId, start, end],
    queryFn: () => marmitexApi.reportDetail({ company_id: companyId!, start: start || undefined, end: end || undefined }),
    enabled: !!companyId && tab === 'detalhe',
  });

  const close = useMutation({
    mutationFn: () => marmitexApi.closeReport({ company_id: companyId!, start, end }),
    onSuccess: (inv) => {
      setClosed(`Período fechado: faturamento #${inv.id} gerado com ${inv.marmita_count} marmita(s), total ${brl(inv.total_amount)}.`);
      setError('');
      qc.invalidateQueries({ queryKey: ['marmitex-report'] });
      qc.invalidateQueries({ queryKey: ['marmitex-report-detail'] });
      qc.invalidateQueries({ queryKey: ['marmitex-invoices'] });
      qc.invalidateQueries({ queryKey: ['marmitex-companies'] });
    },
    onError: (e) => { setError(apiError(e)); setClosed(''); },
  });

  function doClose() {
    setError(''); setClosed('');
    if (!companyId) { setError('Selecione a empresa.'); return; }
    if (!start || !end) { setError('Informe o início e o fim do período para fechar.'); return; }
    if (!confirm('Fechar o período gera o faturamento e marca as marmitas como faturadas (somem dos próximos relatórios). Continuar?')) return;
    close.mutate();
  }

  const data: MarmitexReport | undefined = report.data;
  const canClose = !!companyId && !!start && !!end && (data?.rows.length ?? 0) > 0;

  return (
    <div>
      <PageHeader title="Relatório / NF-e" subtitle="Consumo pendente agrupado por item e preço para emissão da nota" />

      <Card className="mb-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Empresa">
            <Select value={companyId ?? ''} onChange={(e) => { setCompanyId(e.target.value ? Number(e.target.value) : null); setClosed(''); }}>
              <option value="">Selecione…</option>
              {companies.data?.map((c) => <option key={c.id} value={c.id}>{c.name}{c.pending_count ? ` (${c.pending_count} pend.)` : ''}</option>)}
            </Select>
          </Field>
          <Field label="De">
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500" />
          </Field>
          <Field label="Até">
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500" />
          </Field>
        </div>
        <p className="mt-3 text-xs text-slate-400">Sem datas, mostra todo o consumo pendente. Para <b>fechar o período</b> é obrigatório informar o intervalo.</p>
      </Card>

      {closed && <div className="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{closed}</div>}
      {error && <div className="mb-4"><ErrorBox message={error} /></div>}

      {!companyId ? (
        <EmptyState message="Selecione a empresa para ver o consumo." />
      ) : report.isLoading ? (
        <Spinner />
      ) : report.error ? (
        <ErrorBox message={apiError(report.error)} />
      ) : data && data.rows.length === 0 ? (
        <EmptyState message="Nenhuma marmita pendente neste filtro." />
      ) : data && (
        <Card className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div>
              <p className="font-semibold text-slate-800">{data.company?.name}</p>
              {data.company?.cnpj && <p className="text-xs text-slate-500">CNPJ {data.company.cnpj}</p>}
            </div>
            <Button onClick={doClose} disabled={!canClose || close.isPending}>
              <Lock size={16} /> Gerar relatório / Fechar período
            </Button>
          </div>

          {/* Resumo é o que vai para a NF-e; detalhado é o que se confere com a empresa. */}
          <div className="flex gap-1 border-b border-slate-200 px-5 pt-3">
            {([['resumo', 'Resumo'], ['detalhe', 'Detalhado (por pessoa)']] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`rounded-t-lg px-4 py-2 text-sm font-medium transition ${
                  tab === key ? 'border-b-2 border-emerald-600 text-emerald-700' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'detalhe' ? (
            detail.isLoading ? <Spinner />
              : detail.error ? <ErrorBox message={apiError(detail.error)} />
              : detail.data ? <DetailTable data={detail.data} />
              : null
          ) : (
          <>
          <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead className="border-b border-slate-200 text-left text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Tamanho</th>
                <th className="px-5 py-3 font-medium">Proteína</th>
                <th className="px-5 py-3 font-medium text-right">Qtd.</th>
                <th className="px-5 py-3 font-medium text-right">Preço un.</th>
                <th className="px-5 py-3 font-medium text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={i} className="border-b border-slate-100 last:border-0">
                  <td className="px-5 py-3 font-medium text-slate-800">{r.size_name}</td>
                  <td className="px-5 py-3 text-slate-600">{proteinLabel(r.protein_name, r.protein2_name) || '—'}</td>
                  <td className="px-5 py-3 text-right text-slate-700">{r.quantity}</td>
                  <td className="px-5 py-3 text-right text-slate-700">{brl(r.unit_price)}</td>
                  <td className="px-5 py-3 text-right font-medium text-slate-800">{brl(r.line_total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50">
                <td className="px-5 py-3 font-semibold text-slate-800" colSpan={2}>Total geral</td>
                <td className="px-5 py-3 text-right font-semibold text-slate-800">{data.marmita_count}</td>
                <td />
                <td className="px-5 py-3 text-right text-lg font-bold text-emerald-700">{brl(data.grand_total)}</td>
              </tr>
            </tfoot>
          </table>
          </div>
          <p className="flex items-center gap-2 px-5 py-3 text-xs text-slate-400">
            <FileText size={14} /> Use estes valores para lançar a nota fiscal no seu ERP.
          </p>
          </>
          )}
        </Card>
      )}
    </div>
  );
}
