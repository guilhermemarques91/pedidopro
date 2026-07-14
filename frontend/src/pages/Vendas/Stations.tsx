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

type KindFilter = 'todas' | 'mesa' | 'comanda';
type StatusFilter = 'todas' | 'fechada' | 'aberta' | 'conta';

const KIND_FILTERS: { value: KindFilter; label: string }[] = [
  { value: 'todas', label: 'Todas' },
  { value: 'mesa', label: 'Mesas' },
  { value: 'comanda', label: 'Comandas' },
];

const STATUS_FILTERS: { value: StatusFilter; label: string; dot: string }[] = [
  { value: 'todas', label: 'Todas', dot: 'bg-slate-300' },
  { value: 'fechada', label: 'Fechadas', dot: 'bg-slate-400' },
  { value: 'aberta', label: 'Abertas', dot: 'bg-blue-500' },
  { value: 'conta', label: 'Pedido de conta', dot: 'bg-emerald-500' },
];

function statusOf(s: VendasStation): 'fechada' | 'aberta' | 'conta' {
  if (!s.open_sale) return 'fechada';
  return s.open_sale.status === 'awaiting_payment' ? 'conta' : 'aberta';
}

const CARD_CLS: Record<'fechada' | 'aberta' | 'conta', string> = {
  fechada: 'border-slate-200 bg-slate-50 hover:border-slate-300',
  aberta: 'border-blue-300 bg-blue-50 hover:border-blue-400',
  conta: 'border-emerald-300 bg-emerald-50 hover:border-emerald-400',
};

const STATUS_LABEL: Record<'fechada' | 'aberta' | 'conta', string> = {
  fechada: 'Livre',
  aberta: 'Aberta',
  conta: 'Pedido de conta',
};

/** Mapa de mesas e comandas — clicar numa livre inicia um lançamento; numa ocupada, envia mais um round. */
export function VendasStations() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<VendasStation | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [kindFilter, setKindFilter] = useState<KindFilter>('todas');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('todas');
  const [launching, setLaunching] = useState<VendasStation | null>(null);
  const [viewingSaleId, setViewingSaleId] = useState<number | null>(null);

  const { data, isLoading, error } = useQuery({ queryKey: ['vendas-stations'], queryFn: () => vendasApi.stations.list() });

  const remove = useMutation({
    mutationFn: vendasApi.stations.remove,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vendas-stations'] }),
  });

  function openNew() { setEditing(null); setFormOpen(true); }
  function openEdit(s: VendasStation) { setEditing(s); setFormOpen(true); }

  const filtered = useMemo(() => {
    return (data ?? []).filter((s) => {
      if (kindFilter !== 'todas' && s.kind !== kindFilter) return false;
      if (statusFilter !== 'todas' && statusOf(s) !== statusFilter) return false;
      return true;
    });
  }, [data, kindFilter, statusFilter]);

  return (
    <div>
      <PageHeader
        title="Mesas & Comandas"
        subtitle="Mapa de ocupação — clique numa mesa/comanda para lançar um pedido"
        action={<Button onClick={openNew}><Plus size={16} /> Nova</Button>}
      />

      <div className="mb-3 flex flex-wrap gap-2">
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
      <div className="mb-4 flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setStatusFilter(f.value)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
              statusFilter === f.value ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${f.dot}`} />
            {f.label}
          </button>
        ))}
      </div>

      {isLoading && <Spinner />}
      {error && <ErrorBox message={apiError(error)} />}
      {remove.error && <div className="mb-3"><ErrorBox message={apiError(remove.error)} /></div>}

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
                onClick={() => setLaunching(s)}
                className={`flex cursor-pointer flex-col gap-1 rounded-xl border p-3 text-left transition ${CARD_CLS[status]}`}
              >
                <div className="flex items-start justify-between gap-1">
                  <div>
                    <span className="text-[10px] font-medium uppercase text-slate-400">{s.kind === 'mesa' ? 'Mesa' : 'Comanda'}</span>
                    <div className="text-lg font-semibold text-slate-800">{s.number}</div>
                    {s.label && <div className="text-xs text-slate-500">{s.label}</div>}
                  </div>
                  <div className="flex shrink-0 gap-1">
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

                <span
                  className={`w-fit rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                    status === 'fechada' ? 'bg-slate-200 text-slate-600' : status === 'aberta' ? 'bg-blue-200 text-blue-800' : 'bg-emerald-200 text-emerald-800'
                  }`}
                >
                  {STATUS_LABEL[status]}
                </span>

                {sale && (
                  <div className="mt-1 space-y-0.5 text-xs text-slate-600">
                    {sale.customer_name && <div className="truncate font-medium text-slate-700">{sale.customer_name}</div>}
                    {sale.party_size != null && (
                      <div className="flex items-center gap-1 text-slate-500"><Users size={12} /> {sale.party_size} pessoa{sale.party_size === 1 ? '' : 's'}</div>
                    )}
                    <div className="font-semibold text-slate-800">{brl(sale.total_amount)}</div>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setViewingSaleId(sale.id); }}
                      className="mt-1 text-[11px] font-medium text-emerald-700 underline"
                    >
                      Ver pedido
                    </button>
                  </div>
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
    </div>
  );
}

function StationForm({ station, onClose }: { station: VendasStation | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<'mesa' | 'comanda'>(station?.kind ?? 'mesa');
  const [number, setNumber] = useState(station?.number ?? '');
  const [label, setLabel] = useState(station?.label ?? '');
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: () => (station
      ? vendasApi.stations.update(station.id, { number, label: label || null })
      : vendasApi.stations.create({ kind, number, label: label || null })),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vendas-stations'] }); onClose(); },
    onError: (e) => setError(apiError(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    save.mutate();
  }

  return (
    <Modal title={station ? 'Editar' : 'Nova mesa/comanda'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorBox message={error} />}
        {!station && (
          <Field label="Tipo">
            <Select value={kind} onChange={(e) => setKind(e.target.value as 'mesa' | 'comanda')}>
              <option value="mesa">Mesa</option>
              <option value="comanda">Comanda</option>
            </Select>
          </Field>
        )}
        <Field label="Número"><Input value={number} onChange={(e) => setNumber(e.target.value)} required autoFocus maxLength={10} /></Field>
        <Field label="Apelido (opcional)"><Input value={label ?? ''} onChange={(e) => setLabel(e.target.value)} /></Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={save.isPending}>Salvar</Button>
        </div>
      </form>
    </Modal>
  );
}
