import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { vendasApi } from '../../services/resources';
import { apiError } from '../../services/api';
import type { VendasStation } from '../../types';
import { PageHeader } from '../../components/PageHeader';
import { Button, Card, Field, Input, Select, Modal, Spinner, ErrorBox, EmptyState } from '../../components/ui';

/** Cadastro fixo de mesas e comandas — evita digitar o número livremente na hora da venda. */
export function VendasStations() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<VendasStation | null>(null);
  const [open, setOpen] = useState(false);

  const { data, isLoading, error } = useQuery({ queryKey: ['vendas-stations'], queryFn: () => vendasApi.stations.list() });

  const remove = useMutation({
    mutationFn: vendasApi.stations.remove,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vendas-stations'] }),
  });

  function openNew() { setEditing(null); setOpen(true); }
  function openEdit(s: VendasStation) { setEditing(s); setOpen(true); }

  const mesas = (data ?? []).filter((s) => s.kind === 'mesa');
  const comandas = (data ?? []).filter((s) => s.kind === 'comanda');

  return (
    <div>
      <PageHeader
        title="Mesas & Comandas"
        subtitle="Cadastro fixo usado no lançamento de pedidos de Vendas"
        action={<Button onClick={openNew}><Plus size={16} /> Nova</Button>}
      />

      {isLoading && <Spinner />}
      {error && <ErrorBox message={apiError(error)} />}
      {remove.error && <div className="mb-3"><ErrorBox message={apiError(remove.error)} /></div>}

      {data && (
        <div className="grid gap-4 md:grid-cols-2">
          <StationGroup title="Mesas" items={mesas} onEdit={openEdit} onRemove={(id) => remove.mutate(id)} />
          <StationGroup title="Comandas" items={comandas} onEdit={openEdit} onRemove={(id) => remove.mutate(id)} />
        </div>
      )}

      {open && <StationForm station={editing} onClose={() => setOpen(false)} />}
    </div>
  );
}

function StationGroup({
  title, items, onEdit, onRemove,
}: { title: string; items: VendasStation[]; onEdit: (s: VendasStation) => void; onRemove: (id: number) => void }) {
  return (
    <Card className="p-0">
      <h3 className="border-b border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700">{title}</h3>
      {items.length === 0 ? (
        <div className="p-5"><EmptyState message={`Nenhuma ${title.toLowerCase()} cadastrada.`} /></div>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {items.map((s) => (
              <tr key={s.id} className="border-b border-slate-100 last:border-0">
                <td className="px-5 py-3 font-medium text-slate-800">{s.number}</td>
                <td className="px-5 py-3 text-slate-500">{s.label ?? '—'}</td>
                <td className="px-5 py-3">
                  {!!s.has_open_sale && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">Ocupada</span>}
                </td>
                <td className="px-5 py-3 text-right">
                  <button onClick={() => onEdit(s)} className="mr-2 text-slate-400 hover:text-emerald-600"><Pencil size={16} /></button>
                  <button
                    onClick={() => { if (confirm(`Remover "${s.number}"?`)) onRemove(s.id); }}
                    className="text-slate-400 hover:text-red-600"
                    disabled={!!s.has_open_sale}
                    title={s.has_open_sale ? 'Tem um pedido em aberto' : 'Remover'}
                  >
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
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
