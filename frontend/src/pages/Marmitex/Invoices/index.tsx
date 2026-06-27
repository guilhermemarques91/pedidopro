import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, RotateCcw } from 'lucide-react';
import { marmitexApi } from '../../../services/resources';
import { apiError } from '../../../services/api';
import type { MarmitexInvoice, MarmitexReportRow } from '../../../types';
import { PageHeader } from '../../../components/PageHeader';
import { Button, Card, Modal, Badge, Spinner, ErrorBox, EmptyState } from '../../../components/ui';
import { brl, date } from '../../../utils/format';

export function MarmitexInvoices() {
  const qc = useQueryClient();
  const [viewing, setViewing] = useState<MarmitexInvoice | null>(null);
  const { data, isLoading, error } = useQuery({ queryKey: ['marmitex-invoices'], queryFn: () => marmitexApi.invoices() });

  const cancel = useMutation({
    mutationFn: (id: number) => marmitexApi.cancelInvoice(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['marmitex-invoices'] });
      qc.invalidateQueries({ queryKey: ['marmitex-companies'] });
      qc.invalidateQueries({ queryKey: ['marmitex-report'] });
    },
    onError: (e) => alert(apiError(e)),
  });

  return (
    <div>
      <PageHeader title="Faturamentos" subtitle="Períodos já fechados (relatórios gerados)" />

      {isLoading && <Spinner />}
      {error && <ErrorBox message={apiError(error)} />}

      {data && (data.length === 0 ? (
        <EmptyState message="Nenhum período fechado ainda." />
      ) : (
        <Card className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">#</th>
                <th className="px-5 py-3 font-medium">Empresa</th>
                <th className="px-5 py-3 font-medium">Período</th>
                <th className="px-5 py-3 font-medium text-right">Marmitas</th>
                <th className="px-5 py-3 font-medium text-right">Total</th>
                <th className="px-5 py-3 font-medium">Situação</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {data.map((inv) => (
                <tr key={inv.id} className={`border-b border-slate-100 last:border-0 ${inv.status === 'cancelled' ? 'opacity-50' : ''}`}>
                  <td className="px-5 py-3 text-slate-500">{inv.id}</td>
                  <td className="px-5 py-3 font-medium text-slate-800">{inv.company_name}</td>
                  <td className="px-5 py-3 text-slate-600">{date(inv.period_start)} – {date(inv.period_end)}</td>
                  <td className="px-5 py-3 text-right text-slate-700">{inv.marmita_count}</td>
                  <td className="px-5 py-3 text-right font-medium text-slate-800">{brl(inv.total_amount)}</td>
                  <td className="px-5 py-3"><Badge status={inv.status} /></td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    <button onClick={() => setViewing(inv)} className="mr-3 text-slate-400 hover:text-emerald-600" title="Ver detalhes"><Eye size={16} /></button>
                    {inv.status === 'closed' && (
                      <button
                        onClick={() => { if (confirm('Cancelar este faturamento reabre as marmitas (voltam a aparecer como pendentes). Continuar?')) cancel.mutate(inv.id); }}
                        className="text-slate-400 hover:text-red-600"
                        title="Cancelar (reabrir marmitas)"
                      >
                        <RotateCcw size={16} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}

      {viewing && <InvoiceDetail invoice={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function InvoiceDetail({ invoice, onClose }: { invoice: MarmitexInvoice; onClose: () => void }) {
  let rows: MarmitexReportRow[] = [];
  try {
    const parsed = invoice.report_json ? JSON.parse(invoice.report_json) : null;
    rows = parsed?.rows ?? [];
  } catch {
    rows = [];
  }

  return (
    <Modal title={`Faturamento #${invoice.id} — ${invoice.company_name}`} onClose={onClose} size="xl">
      <p className="mb-3 text-sm text-slate-500">
        Período {date(invoice.period_start)} a {date(invoice.period_end)}
        {invoice.cnpj && <> · CNPJ {invoice.cnpj}</>}
      </p>
      {rows.length === 0 ? (
        <EmptyState message="Sem detalhamento armazenado." />
      ) : (
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 text-left text-slate-500">
            <tr>
              <th className="py-2 font-medium">Tamanho</th>
              <th className="py-2 font-medium">Proteína</th>
              <th className="py-2 font-medium text-right">Qtd.</th>
              <th className="py-2 font-medium text-right">Preço un.</th>
              <th className="py-2 font-medium text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-slate-100 last:border-0">
                <td className="py-2 font-medium text-slate-800">{r.size_name}</td>
                <td className="py-2 text-slate-600">{r.protein_name || '—'}</td>
                <td className="py-2 text-right text-slate-700">{r.quantity}</td>
                <td className="py-2 text-right text-slate-700">{brl(r.unit_price)}</td>
                <td className="py-2 text-right font-medium text-slate-800">{brl(r.line_total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-200">
              <td className="py-2 font-semibold text-slate-800" colSpan={2}>Total ({invoice.marmita_count})</td>
              <td colSpan={2} />
              <td className="py-2 text-right text-lg font-bold text-emerald-700">{brl(invoice.total_amount)}</td>
            </tr>
          </tfoot>
        </table>
      )}
      <div className="flex justify-end pt-4">
        <Button variant="secondary" onClick={onClose}>Fechar</Button>
      </div>
    </Modal>
  );
}
