import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Lock } from 'lucide-react';
import { marmitexApi } from '../../../services/resources';
import { apiError } from '../../../services/api';
import type { MarmitexReport } from '../../../types';
import { PageHeader } from '../../../components/PageHeader';
import { Button, Card, Field, Select, Spinner, ErrorBox, EmptyState } from '../../../components/ui';
import { brl } from '../../../utils/format';

export function MarmitexReportPage() {
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [error, setError] = useState('');
  const [closed, setClosed] = useState('');

  const companies = useQuery({ queryKey: ['marmitex-companies'], queryFn: marmitexApi.companies.list });

  const report = useQuery({
    queryKey: ['marmitex-report', companyId, start, end],
    queryFn: () => marmitexApi.report({ company_id: companyId!, start: start || undefined, end: end || undefined }),
    enabled: !!companyId,
  });

  const close = useMutation({
    mutationFn: () => marmitexApi.closeReport({ company_id: companyId!, start, end }),
    onSuccess: (inv) => {
      setClosed(`Período fechado: faturamento #${inv.id} gerado com ${inv.marmita_count} marmita(s), total ${brl(inv.total_amount)}.`);
      setError('');
      qc.invalidateQueries({ queryKey: ['marmitex-report'] });
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
          <table className="w-full text-sm">
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
                  <td className="px-5 py-3 text-slate-600">{r.protein_name || '—'}</td>
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
          <p className="flex items-center gap-2 px-5 py-3 text-xs text-slate-400">
            <FileText size={14} /> Use estes valores para lançar a nota fiscal no seu ERP.
          </p>
        </Card>
      )}
    </div>
  );
}
