import { KeyboardEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save, Search, Wand2, Eraser } from 'lucide-react';
import { replenishmentApi, categoriesApi, productTypesApi, ReplenishFilters, ReplenishParamInput } from '../../services/resources';
import { apiError } from '../../services/api';
import { parseNum } from '../../utils/format';
import type { ReplenishRow } from '../../types';
import { useAuth } from '../../store/auth.store';
import { PageHeader } from '../../components/PageHeader';
import { Button, Card, Input, Select, Spinner, ErrorBox, EmptyState } from '../../components/ui';

// Espelha CountsController::COUNTABLE_TIPOS.
const TIPOS = ['Mercadoria', 'Matéria-prima', 'Uso e consumo', 'Item intermediário'];

interface Draft { min: string; max: string; pack: string }

const toInput = (v: string | null): string =>
  v === null || v === '' ? '' : String(Number(v)).replace('.', ',');

const fmt = (v: number | null | undefined): string => {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');
};

export function Parametros() {
  const qc = useQueryClient();
  const canWrite = useAuth((s) => s.can('compras:write'));

  const [q, setQ] = useState('');
  const [tipo, setTipo] = useState('');
  const [category, setCategory] = useState<number | ''>('');
  const [type, setType] = useState<number | ''>('');
  const [onlyMissing, setOnlyMissing] = useState(false);
  // Regra do preenchimento automático: o mínimo cobre o tempo até a próxima compra
  // chegar; o máximo, o ciclo inteiro de reposição.
  const [leadDays, setLeadDays] = useState('3');
  const [coverDays, setCoverDays] = useState('7');

  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  const filters: ReplenishFilters = {
    q: q.trim() || undefined,
    tipo: tipo || undefined,
    category_id: category || undefined,
    type_id: type || undefined,
    only_missing: onlyMissing ? 1 : undefined,
  };
  const categories = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.list });
  const types = useQuery({ queryKey: ['product-types'], queryFn: productTypesApi.list });
  const rows = useQuery({ queryKey: ['replenishment', filters], queryFn: () => replenishmentApi.list(filters) });

  /** Valor atual de uma célula: o que está sendo digitado ou o que veio do banco. */
  function cell(r: ReplenishRow, field: keyof Draft): string {
    const d = drafts[r.id];
    if (d && d[field] !== undefined) return d[field];
    return toInput(field === 'min' ? r.min_stock : field === 'max' ? r.max_stock : r.pack_size);
  }

  function set(id: number, field: keyof Draft, value: string) {
    setOk('');
    setDrafts((prev) => {
      const base = prev[id] ?? { min: undefined, max: undefined, pack: undefined } as unknown as Draft;
      return { ...prev, [id]: { ...base, [field]: value } };
    });
  }

  /** Linhas realmente alteradas — só elas vão para o servidor. */
  const changed = useMemo(() => {
    const out: ReplenishParamInput[] = [];
    (rows.data ?? []).forEach((r) => {
      const d = drafts[r.id];
      if (!d) return;
      const body: ReplenishParamInput = { product_id: r.id };
      let dirty = false;
      ([['min', 'min_stock'], ['max', 'max_stock'], ['pack', 'pack_size']] as const).forEach(([k, col]) => {
        if (d[k] === undefined) return;
        const novo = parseNum(d[k]);
        const atual = r[col] === null || r[col] === '' ? null : Number(r[col]);
        if (novo !== atual) { body[col] = novo; dirty = true; }
      });
      if (dirty) out.push(body);
    });
    return out;
  }, [rows.data, drafts]);

  const save = useMutation({
    mutationFn: () => replenishmentApi.save(changed),
    onSuccess: (r) => {
      setError(''); setOk(`${r.saved} produto(s) salvos.`); setDrafts({});
      qc.invalidateQueries({ queryKey: ['replenishment'] });
      qc.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (e) => setError(apiError(e)),
  });

  /**
   * Preenche mín/máx pelo consumo das linhas visíveis que ainda têm histórico.
   * Não sobrescreve nada: quem já tem número cadastrado fica como está — o botão
   * serve para o cadastro inicial de 200 itens, não para refazer decisão tomada.
   */
  function fillFromUsage() {
    const lead = Number(leadDays.replace(',', '.')) || 0;
    const cover = Number(coverDays.replace(',', '.')) || 0;
    if (lead <= 0 || cover <= 0) { setError('Informe os dias de entrega e de cobertura.'); return; }
    setError(''); setOk('');
    const next = { ...drafts };
    let n = 0;
    (rows.data ?? []).forEach((r) => {
      if (!r.daily_usage) return;
      const jaTem = r.max_stock !== null && r.max_stock !== '';
      if (jaTem) return;
      const round = (x: number) => Math.round(x * 1000) / 1000;
      next[r.id] = {
        ...(next[r.id] ?? {} as Draft),
        min: String(round(r.daily_usage * lead)).replace('.', ','),
        max: String(round(r.daily_usage * cover)).replace('.', ','),
        pack: next[r.id]?.pack ?? toInput(r.pack_size),
      };
      n++;
    });
    setDrafts(next);
    setOk(n > 0 ? `${n} linha(s) preenchidas pelo consumo. Revise e salve.` : 'Nenhuma linha com histórico de consumo e sem máximo cadastrado.');
  }

  function clearDrafts() { setDrafts({}); setOk(''); setError(''); }

  /** Enter desce para a mesma coluna da linha seguinte (cadastro em série). */
  function onEnterNext(e: KeyboardEvent<HTMLInputElement>, column: string, index: number) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const next = document.querySelector<HTMLInputElement>(`[data-cell="${column}-${index + 1}"]`);
    next?.focus();
    next?.select();
  }

  const list = rows.data ?? [];
  const semParametro = list.filter((r) => r.max_stock === null || r.max_stock === '').length;

  return (
    <div>
      <PageHeader
        title="Parâmetros de reposição"
        subtitle="Estoque mínimo, máximo e embalagem de compra. É o que deixa a sugestão da contagem precisa."
        action={
          <div className="flex flex-wrap items-center gap-2">
            {changed.length > 0 && <span className="text-sm font-medium text-amber-700">{changed.length} alterado(s)</span>}
            {changed.length > 0 && (
              <Button variant="ghost" onClick={clearDrafts}><Eraser size={16} /> Descartar</Button>
            )}
            <Button disabled={!canWrite || changed.length === 0 || save.isPending} onClick={() => save.mutate()}>
              <Save size={16} /> Salvar
            </Button>
          </div>
        }
      />

      {error && <ErrorBox message={error} />}
      {ok && <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{ok}</div>}

      {/* Preenchimento automático pelo histórico */}
      <Card className="mb-4 border-emerald-100 bg-emerald-50/40">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Dias até a compra chegar</label>
            <Input value={leadDays} onChange={(e) => setLeadDays(e.target.value)} className="w-28" inputMode="decimal" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Dias de cobertura</label>
            <Input value={coverDays} onChange={(e) => setCoverDays(e.target.value)} className="w-28" inputMode="decimal" />
          </div>
          <Button type="button" variant="secondary" onClick={fillFromUsage}>
            <Wand2 size={16} /> Preencher pelo consumo
          </Button>
          <p className="max-w-xl text-xs text-slate-600">
            Calcula <strong>mínimo = consumo/dia × dias até chegar</strong> e <strong>máximo = consumo/dia × cobertura</strong>.
            Só toca em quem tem histórico e ainda não tem máximo — nada já cadastrado é sobrescrito. Nada é gravado antes de você conferir e salvar.
          </p>
        </div>
      </Card>

      {/* Filtros */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar item…" className="w-56 pl-8" />
        </div>
        <Select value={tipo} onChange={(e) => setTipo(e.target.value)} className="w-48">
          <option value="">Todos os tipos</option>
          {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
        <Select value={category} onChange={(e) => setCategory(e.target.value ? Number(e.target.value) : '')} className="w-48">
          <option value="">Todas as categorias</option>
          {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select value={type} onChange={(e) => setType(e.target.value ? Number(e.target.value) : '')} className="w-48">
          <option value="">Todas as classes</option>
          {types.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} className="h-4 w-4 accent-emerald-600" />
          Só os sem máximo
        </label>
        <span className="text-xs text-slate-500">{list.length} item(ns) · {semParametro} sem máximo</span>
      </div>

      {rows.isLoading && <Spinner />}
      {rows.error && <ErrorBox message={apiError(rows.error)} />}

      {rows.data && (list.length === 0 ? (
        <EmptyState message="Nenhum item com esses filtros." />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2.5 font-semibold">Item</th>
                <th className="px-3 py-2.5 text-right font-semibold">Saldo</th>
                <th className="px-3 py-2.5 text-right font-semibold">Consumo/dia</th>
                <th className="px-3 py-2.5 text-right font-semibold">Mínimo</th>
                <th className="px-3 py-2.5 text-right font-semibold">Máximo (alvo)</th>
                <th className="px-3 py-2.5 text-right font-semibold">Múltiplo</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r, i) => {
                const dirty = changed.some((c) => c.product_id === r.id);
                return (
                  <tr key={r.id} className={`border-b border-slate-100 last:border-0 ${dirty ? 'bg-amber-50/60' : 'hover:bg-slate-50'}`}>
                    <td className="px-3 py-2">
                      <p className="font-medium text-slate-800">{r.name}</p>
                      <p className="text-xs text-slate-400">
                        {r.tipo ?? 'sem tipo'} · {r.category_name ?? 'sem categoria'}
                        {r.purchase_unit || r.unit ? ` · ${r.purchase_unit ?? r.unit}` : ''}
                      </p>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{fmt(Number(r.stock_qty))}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                      {r.daily_usage ? fmt(r.daily_usage) : <span className="text-slate-300">sem histórico</span>}
                    </td>
                    <td className="w-28 px-2 py-2">
                      <Input
                        value={cell(r, 'min')} onChange={(e) => set(r.id, 'min', e.target.value)}
                        onKeyDown={(e) => onEnterNext(e, 'min', i)} data-cell={`min-${i}`}
                        disabled={!canWrite} className="text-right" inputMode="decimal" placeholder="—"
                        aria-label={`Estoque mínimo de ${r.name}`}
                      />
                    </td>
                    <td className="w-28 px-2 py-2">
                      <Input
                        value={cell(r, 'max')} onChange={(e) => set(r.id, 'max', e.target.value)}
                        onKeyDown={(e) => onEnterNext(e, 'max', i)} data-cell={`max-${i}`}
                        disabled={!canWrite} className="text-right" inputMode="decimal" placeholder="—"
                        aria-label={`Estoque máximo de ${r.name}`}
                      />
                    </td>
                    <td className="w-28 px-2 py-2">
                      <Input
                        value={cell(r, 'pack')} onChange={(e) => set(r.id, 'pack', e.target.value)}
                        onKeyDown={(e) => onEnterNext(e, 'pack', i)} data-cell={`pack-${i}`}
                        disabled={!canWrite} className="text-right" inputMode="decimal" placeholder="—"
                        aria-label={`Múltiplo de compra de ${r.name}`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="border-t border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">
            Item sem máximo cai no consumo médio dos últimos 30 dias. <kbd className="rounded border border-slate-300 bg-white px-1">Enter</kbd> desce para a linha seguinte.
          </div>
        </Card>
      ))}
    </div>
  );
}
