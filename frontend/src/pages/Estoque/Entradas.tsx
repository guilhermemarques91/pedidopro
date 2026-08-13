import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { PackageCheck, AlertTriangle, FileText } from 'lucide-react';
import { receiptsApi } from '../../services/resources';
import { apiError } from '../../services/api';
import { PageHeader } from '../../components/PageHeader';
import { Card, Select, Spinner, ErrorBox, EmptyState } from '../../components/ui';
import { RECEIPT_TONE, RECEIPT_SOURCE_LABEL } from '../../config/estoque';
import { brl } from '../../utils/format';
import type { ReceiptStatus } from '../../types';

/**
 * Fila de entradas: o pedido enviado espera aqui até a nota chegar.
 *
 * A mercadoria que já está na despensa mas não passou por aqui é justamente o que fazia o
 * saldo ficar negativo — por isso a fila abre em "aguardando", e não no histórico.
 */
export function Entradas() {
  const [params] = useSearchParams();
  // Vindo de "Conferir entrada" no pedido: mostra todas as situações e destaca a do pedido,
  // senão uma entrada já conferida sumiria e pareceria que o botão não fez nada.
  const fromOrder = Number(params.get('pedido')) || null;
  const [status, setStatus] = useState<ReceiptStatus | ''>(fromOrder ? '' : 'aguardando');
  const { data, isLoading, error } = useQuery({
    queryKey: ['stock-receipts', status],
    queryFn: () => receiptsApi.list(status || undefined),
    refetchInterval: 60_000,
  });

  const rows = useMemo(() => {
    const all = data ?? [];
    return fromOrder ? all.filter((r) => r.order_id === fromOrder) : all;
  }, [data, fromOrder]);

  return (
    <div>
      <PageHeader
        title="Entradas de mercadoria"
        subtitle="O pedido enviado espera aqui; a nota do fornecedor confirma e dá entrada no estoque"
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="w-56 text-sm">
          <span className="mb-1 block font-medium text-slate-600">Situação</span>
          <Select value={status} onChange={(e) => setStatus(e.target.value as ReceiptStatus | '')}>
            <option value="aguardando">Aguardando nota</option>
            <option value="conferida">Conferidas</option>
            <option value="cancelada">Canceladas</option>
            <option value="">Todas</option>
          </Select>
        </label>
        <span className="pb-2 text-sm text-slate-400">
          {isLoading ? 'carregando…' : `${rows.length} entrada(s)`}
        </span>
      </div>

      {isLoading && <Spinner />}
      {error && <ErrorBox message={apiError(error)} />}
      {!isLoading && rows.length === 0 && (
        <EmptyState
          message={
            status === 'aguardando'
              ? 'Nenhuma entrada esperando nota. Elas nascem quando um pedido de compra é enviado ao fornecedor.'
              : 'Nenhuma entrada nesta situação.'
          }
        />
      )}

      <div className="space-y-2">
        {rows.map((r) => {
          const tone = RECEIPT_TONE[r.status];
          const pending = r.pending_count ?? 0;
          const diverging = r.diverging_count ?? 0;
          return (
            <Link key={r.id} to={`/estoque/entradas/${r.id}`} className="block">
              <Card className="flex flex-wrap items-center gap-3 transition hover:border-slate-300">
                <FileText size={18} className="shrink-0 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-800">
                    {r.supplier_name ?? 'Fornecedor não identificado'}
                    {r.doc_number && <span className="ml-2 text-sm text-slate-400">nota {r.doc_number}</span>}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {RECEIPT_SOURCE_LABEL[r.source] ?? r.source}
                    {r.order_id && <> · pedido #{r.order_id}</>}
                    {' · '}
                    {r.line_count ?? 0} item(ns)
                    {' · '}
                    {new Date(r.created_at).toLocaleDateString('pt-BR')}
                  </p>
                </div>
                {pending > 0 && (
                  <span
                    className="flex shrink-0 items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700"
                    title="Itens sem produto vinculado — não vão baixar estoque enquanto ninguém resolver"
                  >
                    <AlertTriangle size={12} /> {pending} sem produto
                  </span>
                )}
                {diverging > 0 && (
                  <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                    {diverging} divergente(s)
                  </span>
                )}
                {r.doc_total != null && (
                  <span className="shrink-0 text-sm font-medium text-slate-700">{brl(r.doc_total)}</span>
                )}
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${tone.chip}`}>
                  {tone.label}
                </span>
                {r.status === 'conferida' && <PackageCheck size={16} className="shrink-0 text-emerald-600" />}
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
