import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, RefreshCw } from 'lucide-react';
import { channelsApi, merchantApi, storeSettingsApi } from '../../services/resources';
import { apiError } from '../../services/api';
import type { OpeningShift, StoreSettings } from '../../types';
import { PageHeader } from '../../components/PageHeader';
import { Button, Card, Field, Input, Select, Spinner, ErrorBox, EmptyState } from '../../components/ui';

const DAYS: { value: string; label: string }[] = [
  { value: 'MONDAY', label: 'Segunda' }, { value: 'TUESDAY', label: 'Terça' },
  { value: 'WEDNESDAY', label: 'Quarta' }, { value: 'THURSDAY', label: 'Quinta' },
  { value: 'FRIDAY', label: 'Sexta' }, { value: 'SATURDAY', label: 'Sábado' }, { value: 'SUNDAY', label: 'Domingo' },
];
const dayLabel = (d: string) => DAYS.find((x) => x.value === d)?.label ?? d;
const toMin = (hm: string) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
const fromMin = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

interface Row { dayOfWeek: string; start: string; end: string }

export function Store() {
  const { data: channels } = useQuery({ queryKey: ['channels'], queryFn: channelsApi.list });
  const ifoodChannels = useMemo(() => (channels ?? []).filter((c) => c.platform === 'ifood'), [channels]);
  const [channelId, setChannelId] = useState<number | null>(null);
  const cid = channelId ?? ifoodChannels[0]?.id ?? null;

  return (
    <div>
      <PageHeader title="Loja" subtitle="Endereço do estabelecimento, disponibilidade, pausas e horário de funcionamento (iFood)" />

      <div className="space-y-6">
        <StoreAddress />

        {!channels ? <Spinner /> : ifoodChannels.length === 0 ? (
          <EmptyState message="Nenhum canal iFood configurado. Cadastre em Integrações para gerenciar disponibilidade/horários." />
        ) : (
          <>
            {ifoodChannels.length > 1 && (
              <div className="max-w-xs">
                <Field label="Canal iFood">
                  <Select value={String(cid)} onChange={(e) => setChannelId(Number(e.target.value))}>
                    {ifoodChannels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                </Field>
              </div>
            )}
            {cid && (
              <>
                <StoreInfo cid={cid} />
                <Interruptions cid={cid} />
                <OpeningHours cid={cid} />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Endereço do estabelecimento — base para o cálculo de distância no mapa de pedidos. */
function StoreAddress() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['store-settings'], queryFn: storeSettingsApi.get });
  const [form, setForm] = useState<Partial<StoreSettings> | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (data && !form) setForm(data);
  }, [data, form]);

  const save = useMutation({
    mutationFn: (body: Partial<StoreSettings>) => storeSettingsApi.update(body),
    onSuccess: (updated) => { setErr(''); setForm(updated); qc.setQueryData(['store-settings'], updated); },
    onError: (e) => setErr(apiError(e)),
  });

  function set<K extends keyof StoreSettings>(key: K, value: StoreSettings[K]) {
    setForm((f) => ({ ...(f ?? {}), [key]: value }));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setErr('');
    if (!form) return;
    save.mutate({
      name: form.name ?? null,
      street: form.street ?? null,
      number: form.number ?? null,
      complement: form.complement ?? null,
      neighborhood: form.neighborhood ?? null,
      city: form.city ?? null,
      state: form.state ?? null,
      postal_code: form.postal_code ?? null,
    });
  }

  return (
    <Card>
      <h3 className="mb-1 text-sm font-semibold text-slate-700">Endereço do estabelecimento</h3>
      <p className="mb-3 text-xs text-slate-400">Usado para calcular a distância de cada pedido no Mapa &amp; Distâncias.</p>
      {isLoading && <Spinner />}
      {error && <ErrorBox message={apiError(error)} />}
      {err && <div className="mb-3"><ErrorBox message={err} /></div>}
      {form && (
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <Field label="Nome"><Input value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} /></Field>
            <div className="md:col-span-2">
              <Field label="Rua"><Input value={form.street ?? ''} onChange={(e) => set('street', e.target.value)} /></Field>
            </div>
            <Field label="Número"><Input value={form.number ?? ''} onChange={(e) => set('number', e.target.value)} /></Field>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <Field label="Complemento"><Input value={form.complement ?? ''} onChange={(e) => set('complement', e.target.value)} /></Field>
            <Field label="Bairro"><Input value={form.neighborhood ?? ''} onChange={(e) => set('neighborhood', e.target.value)} /></Field>
            <Field label="Cidade"><Input value={form.city ?? ''} onChange={(e) => set('city', e.target.value)} /></Field>
            <Field label="UF"><Input value={form.state ?? ''} maxLength={2} onChange={(e) => set('state', e.target.value.toUpperCase())} /></Field>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <Field label="CEP"><Input value={form.postal_code ?? ''} onChange={(e) => set('postal_code', e.target.value)} /></Field>
            <div className="flex items-end md:col-span-3">
              <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Salvando…' : 'Salvar endereço'}</Button>
            </div>
          </div>
          <p className="text-xs text-slate-400">
            {form.lat != null && form.lng != null
              ? `Coordenadas: ${form.lat.toFixed(6)}, ${form.lng.toFixed(6)}${form.geocoded_at ? ` (geocodificado em ${new Date(form.geocoded_at).toLocaleString('pt-BR')})` : ''}`
              : 'Sem coordenadas ainda — salve o endereço para geocodificar automaticamente (OpenStreetMap).'}
          </p>
        </form>
      )}
    </Card>
  );
}

/** Cenário 1: informações e disponibilidade da loja. */
function StoreInfo({ cid }: { cid: number }) {
  const details = useQuery({ queryKey: ['merchant-details', cid], queryFn: () => merchantApi.details(cid) });
  const status = useQuery({ queryKey: ['merchant-status', cid], queryFn: () => merchantApi.status(cid) });
  const statusArr = Array.isArray(status.data) ? status.data as Record<string, unknown>[] : null;

  return (
    <Card>
      <h3 className="mb-3 text-sm font-semibold text-slate-700">Informações da loja</h3>
      {details.isLoading && <Spinner />}
      {details.error && <ErrorBox message={apiError(details.error)} />}
      {details.data && (
        <div className="space-y-1 text-sm">
          <Row label="Nome" value={String(details.data.name ?? details.data.corporateName ?? '—')} />
          <Row label="ID" value={String(details.data.id ?? '—')} />
          {'status' in details.data && <Row label="Status" value={String(details.data.status)} />}
        </div>
      )}

      <h4 className="mb-2 mt-4 text-sm font-semibold text-slate-700">Disponibilidade</h4>
      {status.isLoading && <Spinner />}
      {status.error && <ErrorBox message={apiError(status.error)} />}
      {statusArr && (
        statusArr.length === 0 ? <p className="text-sm text-slate-400">Sem informação de disponibilidade.</p> : (
          <ul className="space-y-1 text-sm">
            {statusArr.map((s, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${s.available ? 'bg-emerald-500' : 'bg-red-500'}`} />
                <span className="text-slate-700">{String(s.operation ?? 'Operação')}</span>
                <span className="text-slate-500">— {s.available ? 'Disponível' : 'Indisponível'}{s.state ? ` (${String(s.state)})` : ''}</span>
              </li>
            ))}
          </ul>
        )
      )}

      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-slate-400">Ver detalhes completos (JSON)</summary>
        <pre className="mt-2 max-h-64 overflow-auto rounded bg-slate-50 p-2 text-xs text-slate-600">
{JSON.stringify({ details: details.data, status: status.data }, null, 2)}
        </pre>
      </details>
    </Card>
  );
}

/** Cenário 2: interrupções (pausas). */
function Interruptions({ cid }: { cid: number }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['merchant-interruptions', cid], queryFn: () => merchantApi.interruptions(cid) });
  const [description, setDescription] = useState('Pausa temporária');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [err, setErr] = useState('');

  const invalidate = () => qc.invalidateQueries({ queryKey: ['merchant-interruptions', cid] });
  const create = useMutation({
    mutationFn: (b: { description: string; start: string; end: string }) => merchantApi.createInterruption(cid, b),
    onSuccess: () => { invalidate(); setErr(''); },
    onError: (e) => setErr(apiError(e)),
  });
  const remove = useMutation({ mutationFn: (id: string) => merchantApi.deleteInterruption(cid, id), onSuccess: invalidate });

  function submit(e: FormEvent) {
    e.preventDefault();
    setErr('');
    if (!start || !end) { setErr('Informe início e fim'); return; }
    // datetime-local → ISO 8601 com fuso.
    create.mutate({ description, start: new Date(start).toISOString(), end: new Date(end).toISOString() });
  }

  return (
    <Card>
      <h3 className="mb-3 text-sm font-semibold text-slate-700">Interrupções (pausas)</h3>
      {err && <div className="mb-3"><ErrorBox message={err} /></div>}

      <form onSubmit={submit} className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-4">
        <Field label="Descrição"><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label="Início"><input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></Field>
        <Field label="Fim"><input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></Field>
        <div className="flex items-end"><Button type="submit" disabled={create.isPending}><Plus size={16} /> Criar pausa</Button></div>
      </form>

      {list.isLoading && <Spinner />}
      {list.error && <ErrorBox message={apiError(list.error)} />}
      {list.data && (list.data.length === 0 ? (
        <EmptyState message="Nenhuma pausa ativa." />
      ) : (
        <ul className="space-y-2">
          {list.data.map((it) => (
            <li key={it.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <div>
                <p className="font-medium text-slate-700">{it.description}</p>
                <p className="text-xs text-slate-400">{fmtDate(it.start)} → {fmtDate(it.end)}</p>
              </div>
              <button onClick={() => remove.mutate(it.id)} disabled={remove.isPending} className="text-slate-300 hover:text-red-600" title="Remover pausa">
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
      ))}
    </Card>
  );
}

/** Cenário 3: horário de funcionamento. */
function OpeningHours({ cid }: { cid: number }) {
  const qc = useQueryClient();
  const current = useQuery({ queryKey: ['merchant-hours', cid], queryFn: () => merchantApi.openingHours(cid) });
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState('');

  // Inicializa as linhas a partir do que o iFood devolve (uma vez).
  const apiShifts = current.data?.shifts;
  const initRows: Row[] = useMemo(() => (apiShifts ?? []).map((s) => ({
    dayOfWeek: s.dayOfWeek,
    start: s.start.slice(0, 5),
    end: fromMin(toMin(s.start.slice(0, 5)) + s.duration),
  })), [apiShifts]);
  const view = rows ?? initRows;

  const save = useMutation({
    mutationFn: (shifts: OpeningShift[]) => merchantApi.setOpeningHours(cid, shifts),
    onSuccess: () => { setErr(''); qc.invalidateQueries({ queryKey: ['merchant-hours', cid] }); setRows(null); },
    onError: (e) => setErr(apiError(e)),
  });

  function setRow(i: number, patch: Partial<Row>) {
    setRows(view.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addRow() { setRows([...view, { dayOfWeek: 'SATURDAY', start: '10:00', end: '19:00' }]); }
  function applyPreset() {
    setRows([
      { dayOfWeek: 'SATURDAY', start: '10:00', end: '19:00' },
      { dayOfWeek: 'SUNDAY', start: '09:00', end: '12:00' },
      { dayOfWeek: 'SUNDAY', start: '13:00', end: '16:00' },
      { dayOfWeek: 'SUNDAY', start: '17:00', end: '23:00' },
    ]);
  }
  function submit() {
    setErr('');
    const shifts: OpeningShift[] = [];
    for (const r of view) {
      const dur = toMin(r.end) - toMin(r.start);
      if (dur <= 0) { setErr(`Turno de ${dayLabel(r.dayOfWeek)} tem fim antes do início`); return; }
      shifts.push({ dayOfWeek: r.dayOfWeek, start: `${r.start}:00`, duration: dur });
    }
    if (!shifts.length) { setErr('Adicione ao menos um turno'); return; }
    save.mutate(shifts);
  }

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">Horário de funcionamento</h3>
        <button onClick={() => current.refetch()} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
          <RefreshCw size={13} /> Consultar
        </button>
      </div>
      {err && <div className="mb-3"><ErrorBox message={err} /></div>}
      {current.isLoading && <Spinner />}
      {current.error && <ErrorBox message={apiError(current.error)} />}

      <div className="space-y-2">
        {view.map((r, i) => (
          <div key={i} className="grid grid-cols-12 items-center gap-2">
            <Select value={r.dayOfWeek} onChange={(e) => setRow(i, { dayOfWeek: e.target.value })} className="col-span-5">
              {DAYS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </Select>
            <input type="time" value={r.start} onChange={(e) => setRow(i, { start: e.target.value })} className="col-span-3 rounded-lg border border-slate-300 px-2 py-2 text-sm" />
            <input type="time" value={r.end} onChange={(e) => setRow(i, { end: e.target.value })} className="col-span-3 rounded-lg border border-slate-300 px-2 py-2 text-sm" />
            <button onClick={() => setRows(view.filter((_, idx) => idx !== i))} className="col-span-1 flex justify-center text-slate-400 hover:text-red-600"><Trash2 size={16} /></button>
          </div>
        ))}
        {view.length === 0 && <p className="text-sm text-slate-400">Nenhum turno configurado.</p>}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={addRow} className="text-sm text-emerald-600 hover:underline">+ adicionar turno</button>
        <button onClick={applyPreset} className="ml-auto text-xs text-slate-500 hover:underline">Aplicar cenário de teste (sáb/dom)</button>
      </div>
      <div className="mt-3 flex justify-end">
        <Button onClick={submit} disabled={save.isPending}>Salvar horários</Button>
      </div>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between"><span className="text-slate-400">{label}</span><span className="text-slate-700">{value}</span></div>
  );
}
function fmtDate(iso: string) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
