import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Printer, Save, UtensilsCrossed } from 'lucide-react';
import { marmitexApi, MarmitaInput } from '../../../services/resources';
import { apiError } from '../../../services/api';
import { useAuth } from '../../../store/auth.store';
import type { MarmitexCompany } from '../../../types';
import { PageHeader } from '../../../components/PageHeader';
import { Button, Card, Field, Select, Spinner, ErrorBox, EmptyState } from '../../../components/ui';
import { brl } from '../../../utils/format';

interface Line {
  key: string;
  person_name: string;
  size_id: string;
  protein_id: string;
  side_ids: number[];
  observation: string;
}

let keySeq = 1;
const newLine = (): Line => ({ key: `l${keySeq++}`, person_name: '', size_id: '', protein_id: '', side_ids: [], observation: '' });
const today = () => new Date().toISOString().slice(0, 10);

export function CompanyOrder() {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const isCompany = user?.role === 'company';

  const [companyId, setCompanyId] = useState<number | null>(isCompany ? user?.company_id ?? null : null);
  const [date, setDate] = useState(today());
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const catalogQuery = useQuery({ queryKey: ['marmitex-catalog'], queryFn: marmitexApi.catalog });
  const adminCompanies = useQuery({ queryKey: ['marmitex-companies'], queryFn: marmitexApi.companies.list, enabled: !isCompany });
  const ownCompany = useQuery({
    queryKey: ['marmitex-company', companyId],
    queryFn: () => marmitexApi.companies.get(companyId!),
    enabled: isCompany && !!companyId,
  });

  const orderQuery = useQuery({
    queryKey: ['marmitex-order', companyId, date],
    queryFn: async () => {
      const list = await marmitexApi.orders.list({ company_id: companyId ?? undefined, date });
      return list.length ? marmitexApi.orders.get(list[0].id) : null;
    },
    enabled: !!companyId && !!date,
  });

  // Carrega o pedido existente do dia (ou começa com uma linha em branco).
  useEffect(() => {
    const order = orderQuery.data;
    if (orderQuery.isFetching) return;
    if (order && order.marmitas.length) {
      setLines(order.marmitas.map((m) => ({
        key: `l${keySeq++}`,
        person_name: m.person_name ?? '',
        size_id: m.size_id ? String(m.size_id) : '',
        protein_id: m.protein_id ? String(m.protein_id) : '',
        side_ids: (m.sides_json ?? []).map((s) => s.id),
        observation: m.observation ?? '',
      })));
    } else {
      setLines([newLine()]);
    }
    setMsg('');
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderQuery.data, companyId, date]);

  const catalog = catalogQuery.data;
  const activeSizes = useMemo(() => catalog?.sizes.filter((s) => s.active) ?? [], [catalog]);
  const activeProteins = useMemo(() => catalog?.proteins.filter((s) => s.active) ?? [], [catalog]);
  const activeSides = useMemo(() => catalog?.sides.filter((s) => s.active) ?? [], [catalog]);
  const activeObs = useMemo(() => catalog?.observations.filter((s) => s.active) ?? [], [catalog]);

  const company: MarmitexCompany | undefined = isCompany
    ? ownCompany.data
    : adminCompanies.data?.find((c) => c.id === companyId);

  const billed = (orderQuery.data?.marmitas ?? []).some((m) => m.billed_invoice_id !== null);
  const sizePrice = (sizeId: string) => Number(activeSizes.find((s) => String(s.id) === sizeId)?.price ?? 0);
  const total = lines.reduce((sum, l) => sum + sizePrice(l.size_id), 0);

  const updateLine = (key: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const toggleSide = (key: string, sideId: number) =>
    setLines((ls) => ls.map((l) => (l.key === key
      ? { ...l, side_ids: l.side_ids.includes(sideId) ? l.side_ids.filter((s) => s !== sideId) : [...l.side_ids, sideId] }
      : l)));

  const save = useMutation({
    mutationFn: () => {
      const marmitas: MarmitaInput[] = lines.map((l) => ({
        person_name: l.person_name.trim() || null,
        size_id: Number(l.size_id),
        protein_id: l.protein_id ? Number(l.protein_id) : null,
        side_ids: l.side_ids,
        observation: l.observation.trim() || null,
      }));
      return marmitexApi.orders.save({ company_id: isCompany ? undefined : companyId ?? undefined, service_date: date, marmitas });
    },
    onSuccess: () => {
      setMsg('Pedido salvo com sucesso.');
      qc.invalidateQueries({ queryKey: ['marmitex-order', companyId, date] });
      qc.invalidateQueries({ queryKey: ['marmitex-companies'] });
    },
    onError: (e) => setError(apiError(e)),
  });

  function submit() {
    setError(''); setMsg('');
    if (!companyId) { setError('Selecione a empresa.'); return; }
    if (lines.some((l) => !l.size_id)) { setError('Toda marmita precisa de um tamanho.'); return; }
    save.mutate();
  }

  function openLabels() {
    const params = new URLSearchParams({ date });
    if (!isCompany && companyId) params.set('company_id', String(companyId));
    window.open(`/marmitex/labels/print?${params.toString()}`, '_blank');
  }

  if (catalogQuery.isLoading) return <Spinner />;

  return (
    <div>
      <PageHeader
        title="Pedido do dia"
        subtitle={company ? company.name : 'Monte a lista de marmitas e envie'}
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={openLabels} disabled={!companyId}><Printer size={16} /> Etiquetas</Button>
            <Button onClick={submit} disabled={save.isPending || billed}><Save size={16} /> Salvar pedido</Button>
          </div>
        }
      />

      {!activeSizes.length && <ErrorBox message="Nenhum tamanho ativo no cardápio. Cadastre o cardápio antes de receber pedidos." />}

      <Card className="mb-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {!isCompany && (
            <Field label="Empresa">
              <Select value={companyId ?? ''} onChange={(e) => setCompanyId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Selecione…</option>
                {adminCompanies.data?.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Data do consumo">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
            />
          </Field>
        </div>
        {company?.order_cutoff_time && (
          <p className="mt-3 text-xs text-slate-500">Horário-limite para alterações: <b>{company.order_cutoff_time.slice(0, 5)}</b> do dia do consumo.</p>
        )}
      </Card>

      {msg && <div className="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{msg}</div>}
      {error && <div className="mb-4"><ErrorBox message={error} /></div>}
      {billed && <div className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">Este pedido já foi faturado e não pode mais ser alterado.</div>}

      {/* Sugestões de observações para o datalist compartilhado */}
      <datalist id="marmitex-observations">
        {activeObs.map((o) => <option key={o.id} value={o.name} />)}
      </datalist>

      {!companyId ? (
        <EmptyState message="Selecione a empresa para começar." />
      ) : (
        <div className="space-y-3">
          {lines.map((line, idx) => (
            <Card key={line.key} className={billed ? 'opacity-60' : ''}>
              <div className="mb-3 flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-semibold text-slate-600"><UtensilsCrossed size={16} /> Marmita {idx + 1}</span>
                {lines.length > 1 && !billed && (
                  <button onClick={() => setLines((ls) => ls.filter((l) => l.key !== line.key))} className="text-slate-400 hover:text-red-600"><Trash2 size={16} /></button>
                )}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Nome (etiqueta)">
                  <input
                    value={line.person_name}
                    onChange={(e) => updateLine(line.key, { person_name: e.target.value })}
                    disabled={billed}
                    placeholder="ex.: João"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                  />
                </Field>
                <Field label="Tamanho">
                  <Select value={line.size_id} onChange={(e) => updateLine(line.key, { size_id: e.target.value })} disabled={billed}>
                    <option value="">Selecione…</option>
                    {activeSizes.map((s) => <option key={s.id} value={s.id}>{s.name} — {brl(s.price)}</option>)}
                  </Select>
                </Field>
                <Field label="Proteína">
                  <Select value={line.protein_id} onChange={(e) => updateLine(line.key, { protein_id: e.target.value })} disabled={billed}>
                    <option value="">Sem proteína</option>
                    {activeProteins.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </Select>
                </Field>
                <Field label="Observação">
                  <input
                    value={line.observation}
                    onChange={(e) => updateLine(line.key, { observation: e.target.value })}
                    disabled={billed}
                    list="marmitex-observations"
                    placeholder="ex.: sem cebola"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                  />
                </Field>
              </div>
              {activeSides.length > 0 && (
                <div className="mt-3">
                  <span className="mb-1 block text-sm font-medium text-slate-700">Acompanhamentos</span>
                  <div className="flex flex-wrap gap-2">
                    {activeSides.map((s) => {
                      const on = line.side_ids.includes(s.id);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          disabled={billed}
                          onClick={() => toggleSide(line.key, s.id)}
                          className={`rounded-full border px-3 py-1 text-sm transition ${
                            on ? 'border-emerald-600 bg-emerald-50 text-emerald-700' : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          {s.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </Card>
          ))}

          {!billed && (
            <Button variant="secondary" onClick={() => setLines((ls) => [...ls, newLine()])}><Plus size={16} /> Adicionar marmita</Button>
          )}

          <div className="flex items-center justify-between border-t border-slate-200 pt-4">
            <span className="text-sm text-slate-500">{lines.length} marmita(s)</span>
            <span className="text-lg font-semibold text-slate-800">Total: {brl(total)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
