import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Printer, Save, UtensilsCrossed, Download, Upload, PackageMinus, Undo2 } from 'lucide-react';
import { marmitexApi, MarmitaInput } from '../../../services/resources';
import { apiError } from '../../../services/api';
import { useAuth } from '../../../store/auth.store';
import type { MarmitexCompany, ProductionSummary } from '../../../types';
import { PageHeader } from '../../../components/PageHeader';
import { Button, Card, Field, Select, Modal, Spinner, ErrorBox, EmptyState } from '../../../components/ui';
import { brl, parseSides } from '../../../utils/format';

const qty = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

/** Confirmação de "Fechar produção": mostra o consumo previsto antes de baixar o estoque. */
function ProductionModal({ preview, pending, onConfirm, onClose }: {
  preview: ProductionSummary; pending: boolean; onConfirm: () => void; onClose: () => void;
}) {
  const negativos = preview.moves.filter((m) => m.balance_after < 0);
  return (
    <Modal title="Fechar produção do dia" onClose={onClose} size="xl">
      <p className="text-sm text-slate-600">
        A ficha técnica de cada item do cardápio será explodida e estes insumos sairão do estoque:
      </p>

      {preview.moves.length === 0 ? (
        <div className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Nenhum insumo será movimentado — nenhum item deste pedido tem produto vinculado no cardápio.
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-slate-500">
              <tr>
                <th className="py-2 pr-3 font-medium">Insumo</th>
                <th className="py-2 pr-3 font-medium">Consumo</th>
                <th className="py-2 pr-3 font-medium">Saldo atual</th>
                <th className="py-2 font-medium">Depois</th>
              </tr>
            </thead>
            <tbody>
              {preview.moves.map((m) => (
                <tr key={m.product_id} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 pr-3 font-medium text-slate-800">{m.product_name}</td>
                  <td className="py-2 pr-3 text-slate-700">{qty(m.quantity)} {m.unit ?? ''}</td>
                  <td className="py-2 pr-3 text-slate-500">{qty(m.stock_qty ?? 0)}</td>
                  <td className={`py-2 font-medium ${m.balance_after < 0 ? 'text-red-600' : 'text-slate-700'}`}>
                    {qty(m.balance_after)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {negativos.length > 0 && (
        <div className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {negativos.length} insumo(s) ficarão com saldo negativo. A baixa é registrada mesmo assim — confira o estoque.
        </div>
      )}
      {preview.unlinked.length > 0 && (
        <div className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <b>Sem produto vinculado</b> (não movimentam estoque): {preview.unlinked.join(', ')}.
          <span className="block text-xs">Vincule um produto na tela de Cardápio para que passem a baixar insumos.</span>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-4">
        <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button type="button" onClick={onConfirm} disabled={pending}>
          {pending ? 'Baixando…' : 'Confirmar e baixar estoque'}
        </Button>
      </div>
    </Modal>
  );
}

interface Line {
  key: string;
  person_name: string;
  size_id: string;
  protein_id: string;
  /** Segunda proteína ("costelinha e omelete"): vazia na maioria das marmitas. */
  protein2_id: string;
  side_ids: number[];
  observation: string;
}

let keySeq = 1;
const newLine = (): Line => ({ key: `l${keySeq++}`, person_name: '', size_id: '', protein_id: '', protein2_id: '', side_ids: [], observation: '' });
const today = () => new Date().toISOString().slice(0, 10);

export function CompanyOrder() {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const can = useAuth((s) => s.can);
  const isCompany = user?.role === 'company';

  const [companyId, setCompanyId] = useState<number | null>(isCompany ? user?.company_id ?? null : null);
  const [date, setDate] = useState(today());
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [importErrors, setImportErrors] = useState<{ row: number; messages: string[] }[]>([]);
  const [preview, setPreview] = useState<ProductionSummary | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const contextRef = useRef(''); // empresa|data já carregada (ver effect abaixo)

  const catalogQuery = useQuery({ queryKey: ['marmitex-catalog', companyId], queryFn: () => marmitexApi.catalog(companyId) });
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
  // Só aguarda a 1ª carga da chave (isLoading); em refetch de uma chave já em
  // cache o dado vem na hora — não pode "voltar" a data e a lista sumir.
  useEffect(() => {
    if (orderQuery.isLoading) return;
    const order = orderQuery.data;
    if (order && order.marmitas.length) {
      setLines(order.marmitas.map((m) => ({
        key: `l${keySeq++}`,
        person_name: m.person_name ?? '',
        size_id: m.size_id ? String(m.size_id) : '',
        protein_id: m.protein_id ? String(m.protein_id) : '',
        protein2_id: m.protein2_id ? String(m.protein2_id) : '',
        side_ids: parseSides(m.sides_json).map((s) => s.id),
        observation: m.observation ?? '',
      })));
    } else {
      setLines([newLine()]);
    }
    // Só limpa os avisos ao TROCAR de empresa/data. O effect também roda quando o pedido
    // é recarregado (salvar, fechar produção, reabrir) — aí a mensagem de sucesso tem de
    // sobreviver, senão pisca e some.
    const key = `${companyId}|${date}`;
    if (contextRef.current !== key) {
      contextRef.current = key;
      setMsg('');
      setError('');
      setImportErrors([]);
    }
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
  // Produção fechada = estoque já baixado; para editar é preciso reabrir (estorna a baixa).
  const produced = orderQuery.data?.status === 'produced';
  const locked = billed || produced;
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
        protein2_id: l.protein2_id ? Number(l.protein2_id) : null,
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

  const downloadTemplate = useMutation({
    mutationFn: () => marmitexApi.orderTemplate(),
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'modelo-pedido-marmitex.xlsx';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    },
    onError: (e) => setError(apiError(e)),
  });

  const importMut = useMutation({
    mutationFn: (file: File) => marmitexApi.importSheet(file),
    onSuccess: (res) => {
      setImportErrors(res.errors);
      setMsg(''); setError('');
      if (res.marmitas.length) {
        setLines(res.marmitas.map((m) => ({
          key: `l${keySeq++}`,
          person_name: m.person_name ?? '',
          size_id: String(m.size_id),
          protein_id: m.protein_id ? String(m.protein_id) : '',
          protein2_id: m.protein2_id ? String(m.protein2_id) : '',
          side_ids: m.side_ids ?? [],
          observation: m.observation ?? '',
        })));
      } else if (!res.errors.length) {
        setError('A planilha não tinha nenhuma marmita preenchida.');
      }
    },
    onError: (e) => setError(apiError(e)),
  });

  function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) importMut.mutate(file);
  }

  const orderId = orderQuery.data?.id ?? null;
  const refreshOrder = () => {
    qc.invalidateQueries({ queryKey: ['marmitex-order', companyId, date] });
    qc.invalidateQueries({ queryKey: ['products'] }); // saldos mudaram
  };

  const produce = useMutation({
    mutationFn: () => marmitexApi.orders.produce(orderId!),
    onSuccess: (res) => {
      setPreview(null);
      setMsg(`Produção fechada: ${res.moves.length} insumo(s) baixado(s) do estoque.`);
      refreshOrder();
    },
    onError: (e) => { setPreview(null); setError(apiError(e)); },
  });

  const reopen = useMutation({
    mutationFn: () => marmitexApi.orders.reopen(orderId!),
    onSuccess: () => { setMsg('Produção reaberta: a baixa de estoque foi estornada.'); refreshOrder(); },
    onError: (e) => setError(apiError(e)),
  });

  const loadPreview = useMutation({
    mutationFn: () => marmitexApi.orders.productionPreview(orderId!),
    onSuccess: setPreview,
    onError: (e) => setError(apiError(e)),
  });

  if (catalogQuery.isLoading) return <Spinner />;

  return (
    <div>
      <PageHeader
        title="Pedido do dia"
        subtitle={company ? company.name : 'Monte a lista de marmitas e envie'}
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={openLabels} disabled={!companyId}><Printer size={16} /> Etiquetas</Button>
            {can('marmitex:admin') && orderId && !billed && (
              produced ? (
                <Button variant="secondary" onClick={() => { setError(''); setMsg(''); reopen.mutate(); }} disabled={reopen.isPending}>
                  <Undo2 size={16} /> Reabrir produção
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => { setError(''); setMsg(''); loadPreview.mutate(); }} disabled={loadPreview.isPending}>
                  <PackageMinus size={16} /> {loadPreview.isPending ? 'Calculando…' : 'Fechar produção'}
                </Button>
              )
            )}
            <Button onClick={submit} disabled={save.isPending || locked}><Save size={16} /> Salvar pedido</Button>
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
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
          <span className="text-sm text-slate-500">Ou lance por planilha:</span>
          <Button variant="secondary" onClick={() => downloadTemplate.mutate()} disabled={downloadTemplate.isPending}>
            <Download size={16} /> Baixar modelo
          </Button>
          <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={!companyId || importMut.isPending || locked}>
            <Upload size={16} /> {importMut.isPending ? 'Importando…' : 'Importar planilha'}
          </Button>
          <input ref={fileRef} type="file" accept=".xlsx" onChange={onFilePicked} className="hidden" />
          <span className="w-full text-xs text-slate-400 sm:w-auto">Importar substitui as marmitas abaixo; revise e clique em <b>Salvar pedido</b>.</span>
        </div>
      </Card>

      {msg && <div className="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{msg}</div>}
      {error && <div className="mb-4"><ErrorBox message={error} /></div>}
      {importErrors.length > 0 && (
        <div className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="font-medium">Algumas linhas da planilha foram ignoradas (corrija na planilha ou ajuste manualmente):</p>
          <ul className="mt-1 list-disc pl-5">
            {importErrors.map((er) => <li key={er.row}>Linha {er.row}: {er.messages.join('; ')}</li>)}
          </ul>
        </div>
      )}
      {billed && <div className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">Este pedido já foi faturado e não pode mais ser alterado.</div>}
      {produced && !billed && (
        <div className="mb-4 rounded-lg bg-slate-100 px-4 py-3 text-sm text-slate-700">
          <b>Produção fechada.</b> Os insumos já saíram do estoque. Para alterar as marmitas, reabra a produção — a baixa será estornada.
        </div>
      )}

      {preview && (
        <ProductionModal
          preview={preview}
          pending={produce.isPending}
          onConfirm={() => produce.mutate()}
          onClose={() => setPreview(null)}
        />
      )}

      {/* Sugestões de observações para o datalist compartilhado */}
      <datalist id="marmitex-observations">
        {activeObs.map((o) => <option key={o.id} value={o.name} />)}
      </datalist>

      {!companyId ? (
        <EmptyState message="Selecione a empresa para começar." />
      ) : (
        <div className="space-y-3">
          {lines.map((line, idx) => (
            <Card key={line.key} className={locked ? 'opacity-60' : ''}>
              <div className="mb-3 flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-semibold text-slate-600"><UtensilsCrossed size={16} /> Marmita {idx + 1}</span>
                {lines.length > 1 && !locked && (
                  <button onClick={() => setLines((ls) => ls.filter((l) => l.key !== line.key))} className="text-slate-400 hover:text-red-600"><Trash2 size={16} /></button>
                )}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Nome (etiqueta)">
                  <input
                    value={line.person_name}
                    onChange={(e) => updateLine(line.key, { person_name: e.target.value })}
                    disabled={locked}
                    placeholder="ex.: João"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                  />
                </Field>
                <Field label="Tamanho">
                  <Select value={line.size_id} onChange={(e) => updateLine(line.key, { size_id: e.target.value })} disabled={locked}>
                    <option value="">Selecione…</option>
                    {activeSizes.map((s) => <option key={s.id} value={s.id}>{s.name} — {brl(s.price)}</option>)}
                  </Select>
                </Field>
                <Field label="Proteína">
                  <Select value={line.protein_id} onChange={(e) => updateLine(line.key, { protein_id: e.target.value })} disabled={locked}>
                    <option value="">Sem proteína</option>
                    {activeProteins.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </Select>
                </Field>
                <Field label="2ª proteína (opcional)">
                  <Select value={line.protein2_id} onChange={(e) => updateLine(line.key, { protein2_id: e.target.value })} disabled={locked}>
                    <option value="">Nenhuma</option>
                    {activeProteins
                      .filter((p) => String(p.id) !== line.protein_id)
                      .map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </Select>
                </Field>
                <Field label="Observação">
                  <input
                    value={line.observation}
                    onChange={(e) => updateLine(line.key, { observation: e.target.value })}
                    disabled={locked}
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
                          disabled={locked}
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

          {!locked && (
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
