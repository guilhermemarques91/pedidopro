import { FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Users } from 'lucide-react';
import { vendasApi } from '../../services/resources';
import { apiError } from '../../services/api';
import type { VendasStation } from '../../types';
import { PageHeader } from '../../components/PageHeader';
import { Button, Field, Input, Select, Modal, Spinner, ErrorBox, EmptyState } from '../../components/ui';
import { brl } from '../../utils/format';
import { NewOrderModal } from './NewOrderModal';
import { SaleDetailModal } from './SaleDetailModal';
import { PaymentModal } from './PaymentModal';
import { ElapsedBadge, useMinuteTick } from './shared';

type KindFilter = 'todas' | 'mesa' | 'comanda';
type Status = 'fechada' | 'aberta' | 'conta';
type StatusFilter = 'todas' | Status;

const KIND_FILTERS: { value: KindFilter; label: string }[] = [
  { value: 'todas', label: 'Todas' },
  { value: 'mesa', label: 'Mesas' },
  { value: 'comanda', label: 'Comandas' },
];

function statusOf(s: VendasStation): Status {
  if (!s.open_sale) return 'fechada';
  return s.open_sale.status === 'awaiting_payment' ? 'conta' : 'aberta';
}

const CARD_CLS: Record<Status, string> = {
  fechada: 'border-slate-200 bg-white hover:border-emerald-400 hover:bg-emerald-50/40',
  aberta: 'border-blue-300 bg-blue-50 hover:border-blue-400',
  conta: 'border-amber-300 bg-amber-50 hover:border-amber-400',
};

const STATUS_META: Record<Status, { label: string; chip: string; dot: string }> = {
  fechada: { label: 'Livre', chip: 'bg-slate-100 text-slate-500', dot: 'bg-slate-300' },
  aberta: { label: 'Aberta', chip: 'bg-blue-200 text-blue-800', dot: 'bg-blue-500' },
  conta: { label: 'Na conta', chip: 'bg-amber-200 text-amber-800', dot: 'bg-amber-500' },
};

/**
 * Mapa de mesas e comandas — livre: clique abre o lançamento; ocupada: clique abre o
 * pedido, com atalhos "+ Itens" e "Fechar conta"/"Receber" direto no card.
 */
export function VendasStations() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<VendasStation | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [kindFilter, setKindFilter] = useState<KindFilter>('todas');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('todas');
  const [launching, setLaunching] = useState<VendasStation | null>(null);
  const [viewingSaleId, setViewingSaleId] = useState<number | null>(null);
  const [paying, setPaying] = useState<{ id: number; total: number } | null>(null);
  useMinuteTick();

  const { data, isLoading, error } = useQuery({
    queryKey: ['vendas-stations'],
    queryFn: () => vendasApi.stations.list(),
    refetchInterval: 15_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['vendas-stations'] });
    qc.invalidateQueries({ queryKey: ['vendas-board'] });
  };
  const remove = useMutation({ mutationFn: vendasApi.stations.remove, onSuccess: invalidate });
  const closeBill = useMutation({ mutationFn: vendasApi.close, onSuccess: invalidate });
  const reopenBill = useMutation({ mutationFn: vendasApi.reopen, onSuccess: invalidate });

  function openNew() { setEditing(null); setFormOpen(true); }
  function openEdit(s: VendasStation) { setEditing(s); setFormOpen(true); }

  const stations = data ?? [];
  const summary = useMemo(() => {
    const acc = { fechada: 0, aberta: 0, conta: 0, total: 0 };
    for (const s of stations) {
      acc[statusOf(s)] += 1;
      if (s.open_sale) acc.total += Number(s.open_sale.total_amount);
    }
    return acc;
  }, [stations]);

  const filtered = useMemo(() => stations.filter((s) => {
    if (kindFilter !== 'todas' && s.kind !== kindFilter) return false;
    if (statusFilter !== 'todas' && statusOf(s) !== statusFilter) return false;
    return true;
  }), [stations, kindFilter, statusFilter]);

  const statusChips: { value: StatusFilter; label: string; dot: string; count?: number }[] = [
    { value: 'todas', label: 'Todas', dot: 'bg-slate-300' },
    { value: 'fechada', label: 'Livres', dot: STATUS_META.fechada.dot, count: summary.fechada },
    { value: 'aberta', label: 'Abertas', dot: STATUS_META.aberta.dot, count: summary.aberta },
    { value: 'conta', label: 'Na conta', dot: STATUS_META.conta.dot, count: summary.conta },
  ];

  return (
    <div>
      <PageHeader
        title="Mesas & Comandas"
        subtitle="Mapa de ocupação — clique numa livre para lançar; numa ocupada para ver o pedido"
        action={<Button onClick={openNew}><Plus size={16} /> Nova</Button>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-2">
          {KIND_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setKindFilter(f.value)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                kindFilter === f.value ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="mx-1 hidden h-5 w-px bg-slate-200 sm:block" />
        <div className="flex flex-wrap gap-2">
          {statusChips.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setStatusFilter(f.value)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                statusFilter === f.value ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${f.dot}`} />
              {f.label}{f.count !== undefined ? ` ${f.count}` : ''}
            </button>
          ))}
        </div>
        {summary.total > 0 && (
          <span className="ml-auto rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800">
            Em aberto: <span className="font-bold">{brl(summary.total)}</span>
          </span>
        )}
      </div>

      {isLoading && <Spinner />}
      {error && <ErrorBox message={apiError(error)} />}
      {(remove.error || closeBill.error || reopenBill.error) && (
        <div className="mb-3"><ErrorBox message={apiError(remove.error || closeBill.error || reopenBill.error)} /></div>
      )}

      {data && filtered.length === 0 && <EmptyState message="Nenhuma mesa/comanda encontrada para este filtro." />}

      {data && filtered.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          {filtered.map((s) => {
            const status = statusOf(s);
            const sale = s.open_sale;
            return (
              <div
                key={s.id}
                role="button"
                tabIndex={0}
                onClick={() => (sale ? setViewingSaleId(sale.id) : setLaunching(s))}
                onKeyDown={(e) => { if (e.key === 'Enter') (sale ? setViewingSaleId(sale.id) : setLaunching(s)); }}
                className={`flex cursor-pointer flex-col gap-1.5 rounded-xl border p-3 text-left transition ${CARD_CLS[status]}`}
              >
                <div className="flex items-start justify-between gap-1">
                  <div>
                    <span className="text-[10px] font-medium uppercase text-slate-400">{s.kind === 'mesa' ? 'Mesa' : 'Comanda'}</span>
                    <div className="text-xl font-bold leading-tight text-slate-800">{s.number}</div>
                    {s.label && <div className="text-xs text-slate-500">{s.label}</div>}
                  </div>
                  <div className="flex shrink-0 gap-0.5">
                    <button
                      type="button"
                      title="Editar"
                      onClick={(e) => { e.stopPropagation(); openEdit(s); }}
                      className="rounded p-1 text-slate-400 hover:bg-white hover:text-emerald-600"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      title={sale ? 'Tem um pedido em aberto' : 'Remover'}
                      disabled={!!sale}
                      onClick={(e) => { e.stopPropagation(); if (confirm(`Remover "${s.number}"?`)) remove.mutate(s.id); }}
                      className="rounded p-1 text-slate-400 hover:bg-white hover:text-red-600 disabled:opacity-30"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`w-fit rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${STATUS_META[status].chip}`}>
                    {STATUS_META[status].label}
                  </span>
                  {sale && <ElapsedBadge since={sale.created_at} muted={status === 'conta'} />}
                </div>

                {sale && (
                  <>
                    <div className="text-xs text-slate-600">
                      {(sale.customer_name || sale.party_size != null) && (
                        <div className="flex items-center gap-2">
                          {sale.customer_name && <span className="truncate font-medium text-slate-700">{sale.customer_name}</span>}
                          {sale.party_size != null && (
                            <span className="flex shrink-0 items-center gap-0.5 text-slate-500"><Users size={11} /> {sale.party_size}</span>
                          )}
                        </div>
                      )}
                      <div className="mt-0.5 text-base font-bold text-slate-800">{brl(sale.total_amount)}</div>
                    </div>
                    <div className="mt-auto flex gap-1.5 pt-1">
                      {status === 'aberta' && (
                        <>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setLaunching(s); }}
                            className="flex-1 rounded-lg bg-white px-2 py-1.5 text-xs font-semibold text-blue-700 ring-1 ring-blue-200 transition hover:bg-blue-100"
                          >
                            + Itens
                          </button>
                          <button
                            type="button"
                            disabled={closeBill.isPending}
                            onClick={(e) => { e.stopPropagation(); closeBill.mutate(sale.id); }}
                            className="flex-1 rounded-lg bg-white px-2 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-100 disabled:opacity-50"
                          >
                            Fechar conta
                          </button>
                        </>
                      )}
                      {status === 'conta' && (
                        <>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setPaying({ id: sale.id, total: Number(sale.total_amount) }); }}
                            className="flex-1 rounded-lg bg-emerald-600 px-2 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700"
                          >
                            Receber {brl(sale.total_amount)}
                          </button>
                          <button
                            type="button"
                            title="O cliente vai pedir mais — volta a mesa para aberta"
                            disabled={reopenBill.isPending}
                            onClick={(e) => { e.stopPropagation(); reopenBill.mutate(sale.id); }}
                            className="rounded-lg bg-white px-2 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-100 disabled:opacity-50"
                          >
                            Reabrir
                          </button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {formOpen && <StationForm station={editing} onClose={() => setFormOpen(false)} />}
      {launching && (
        <NewOrderModal
          presetOrigin={launching.kind}
          presetStationId={launching.id}
          onClose={() => setLaunching(null)}
        />
      )}
      {viewingSaleId !== null && <SaleDetailModal saleId={viewingSaleId} onClose={() => setViewingSaleId(null)} />}
      {paying && <PaymentModal saleId={paying.id} totalAmount={paying.total} onClose={() => setPaying(null)} />}
    </div>
  );
}

function StationForm({ station, onClose }: { station: VendasStation | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<'mesa' | 'comanda'>(station?.kind ?? 'mesa');
  const [mode, setMode] = useState<'uma' | 'lote'>('uma');
  const [number, setNumber] = useState(station?.number ?? '');
  const [label, setLabel] = useState(station?.label ?? '');
  const [from, setFrom] = useState('1');
  const [to, setTo] = useState('30');
  const [error, setError] = useState('');
  const [batchInfo, setBatchInfo] = useState('');

  const isBatch = !station && mode === 'lote';

  const save = useMutation({
    mutationFn: async () => {
      if (station) return vendasApi.stations.update(station.id, { number, label: label || null });
      if (isBatch) return vendasApi.stations.createBatch({ kind, from: Number(from), to: Number(to) });
      return vendasApi.stations.create({ kind, number, label: label || null });
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['vendas-stations'] });
      if (isBatch && result && 'created' in result) {
        const parts = [`${result.created} criada${result.created === 1 ? '' : 's'}`];
        if (result.reactivated > 0) parts.push(`${result.reactivated} reativada${result.reactivated === 1 ? '' : 's'}`);
        if (result.skipped > 0) parts.push(`${result.skipped} já existia${result.skipped === 1 ? '' : 'm'}`);
        setBatchInfo(parts.join(', ') + '.');
        return; // deixa o modal aberto mostrando o resultado
      }
      onClose();
    },
    onError: (e) => setError(apiError(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBatchInfo('');
    save.mutate();
  }

  return (
    <Modal title={station ? 'Editar' : 'Nova mesa/comanda'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorBox message={error} />}
        {batchInfo && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">{batchInfo}</p>
        )}
        {!station && (
          <>
            <Field label="Tipo">
              <Select value={kind} onChange={(e) => setKind(e.target.value as 'mesa' | 'comanda')}>
                <option value="mesa">Mesa</option>
                <option value="comanda">Comanda</option>
              </Select>
            </Field>
            <div className="flex gap-2">
              {(['uma', 'lote'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                    mode === m
                      ? 'border-emerald-600 bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {m === 'uma' ? 'Uma só' : 'Em lote (faixa)'}
                </button>
              ))}
            </div>
          </>
        )}

        {isBatch ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Do número">
              <Input type="number" min={1} value={from} onChange={(e) => setFrom(e.target.value)} required autoFocus />
            </Field>
            <Field label="Até o número">
              <Input type="number" min={1} value={to} onChange={(e) => setTo(e.target.value)} required />
            </Field>
          </div>
        ) : (
          <>
            <Field label="Número"><Input value={number} onChange={(e) => setNumber(e.target.value)} required autoFocus maxLength={10} /></Field>
            <Field label="Apelido (opcional)"><Input value={label ?? ''} onChange={(e) => setLabel(e.target.value)} /></Field>
          </>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>{batchInfo ? 'Fechar' : 'Cancelar'}</Button>
          <Button type="submit" disabled={save.isPending}>
            {isBatch ? `Criar ${Math.max(0, Number(to) - Number(from) + 1) || ''} ${kind === 'mesa' ? 'mesas' : 'comandas'}` : 'Salvar'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
