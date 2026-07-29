import { KeyboardEvent, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save, CheckCircle2, ShoppingCart, Search, AlertTriangle } from 'lucide-react';
import { stockCountsApi, CountLineInput } from '../../services/resources';
import { apiError } from '../../services/api';
import { brl, datetime, parseNum } from '../../utils/format';
import type { StockCountItem, ReplenishStatus } from '../../types';
import { useAuth } from '../../store/auth.store';
import { PageHeader } from '../../components/PageHeader';
import { Button, Card, Input, Select, Badge, Spinner, ErrorBox, EmptyState } from '../../components/ui';

/** Valores digitados na folha (string, como o usuário digita). */
interface Draft { counted: string; order: string }

const STATUS_STYLE: Record<ReplenishStatus, { label: string; cls: string }> = {
  critico: { label: 'Crítico', cls: 'bg-red-100 text-red-700' },
  repor: { label: 'Repor', cls: 'bg-amber-100 text-amber-700' },
  ok: { label: 'OK', cls: 'bg-emerald-100 text-emerald-700' },
  sem_parametro: { label: 'Sem parâmetro', cls: 'bg-slate-100 text-slate-500' },
};

const fmtQty = (v: number | string | null | undefined): string => {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');
};

/**
 * Recalcula sugestão e situação com o que está sendo digitado AGORA.
 *
 * O alvo e o ponto de pedido vêm prontos do backend (não dependem do saldo), então
 * aqui só se aplica "quanto falta para o alvo" — a fonte da verdade continua sendo
 * App\Services\Replenishment, que refaz a conta ao salvar e ao gerar a lista.
 */
function live(item: StockCountItem, onHand: number): { suggested: number | null; status: ReplenishStatus } {
  if (item.target === null) {
    return { suggested: null, status: onHand <= 0 ? 'critico' : 'sem_parametro' };
  }
  const pack = item.pack_size ? Number(item.pack_size) : 0;
  const falta = item.target - onHand;
  let suggested = falta > 0 ? falta : 0;
  if (suggested > 0 && pack > 0) suggested = Math.ceil(suggested / pack) * pack;
  const reorder = item.reorder_point ?? 0;
  const status: ReplenishStatus = onHand <= reorder ? 'critico' : onHand < item.target ? 'repor' : 'ok';
  return { suggested: Math.round(suggested * 1000) / 1000, status };
}

export function ContagemDetail() {
  const { id } = useParams();
  const countId = Number(id);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const canCount = useAuth((s) => s.can('estoque:contagem'));
  const canRequest = useAuth((s) => s.can('compras:requests'));

  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'todos' | 'faltando' | 'comprar'>('todos');
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  const { data, isLoading, error: loadError } = useQuery({
    queryKey: ['stock-count', countId],
    queryFn: () => stockCountsApi.get(countId),
    enabled: Number.isFinite(countId) && countId > 0,
  });

  // Carrega os valores já salvos uma única vez (depois quem manda é o que está na tela).
  if (data && !loaded) {
    setLoaded(true);
    const init: Record<number, Draft> = {};
    data.items.forEach((it) => {
      init[it.product_id] = {
        counted: it.counted_qty !== null ? String(Number(it.counted_qty)).replace('.', ',') : '',
        order: it.order_qty !== null ? String(Number(it.order_qty)).replace('.', ',') : '',
      };
    });
    setDrafts(init);
  }

  const isDraft = data?.status === 'draft';
  // Concluída trava a contagem, mas a quantidade de compra segue editável até a
  // lista ser gerada — é a janela de revisão da sugestão.
  const canEditOrder = canCount && (isDraft || (data?.status === 'applied' && !data?.request_id));
  const lines = data?.items ?? [];

  /** Linha + os números vivos (o que está digitado). */
  const computed = useMemo(() => lines.map((it) => {
    const d = drafts[it.product_id] ?? { counted: '', order: '' };
    const countedNum = parseNum(d.counted);
    const onHand = countedNum !== null ? countedNum : Number(it.system_qty);
    const calc = live(it, onHand);
    const orderNum = parseNum(d.order);
    // Espelha CountsController::buyQty — item não contado não entra na compra
    // sozinho (o saldo do sistema é justamente o número que não se confia);
    // só entra se alguém digitar a quantidade à mão.
    const finalQty = orderNum !== null ? orderNum : (countedNum !== null ? (calc.suggested ?? 0) : 0);
    return { it, draft: d, onHand, counted: countedNum, ...calc, finalQty };
  }), [lines, drafts]);

  const visible = computed.filter((r) => {
    if (q.trim() && !r.it.product_name.toLowerCase().includes(q.trim().toLowerCase())) return false;
    if (filter === 'faltando' && r.counted !== null) return false;
    if (filter === 'comprar' && r.finalQty <= 0) return false;
    return true;
  });

  const totals = useMemo(() => {
    let counted = 0, toBuy = 0, critical = 0, cost = 0;
    computed.forEach((r) => {
      if (r.counted !== null) counted++;
      if (r.finalQty > 0) { toBuy++; cost += r.finalQty * Number(r.it.unit_cost ?? 0); }
      // Só alerta de crítico o que foi conferido — senão a folha nasce toda vermelha.
      if (r.counted !== null && r.status === 'critico') critical++;
    });
    return { counted, toBuy, critical, cost, total: computed.length };
  }, [computed]);

  function payload(): CountLineInput[] {
    return computed.map((r) => ({
      product_id: r.it.product_id,
      counted_qty: r.counted,
      // Só grava order_qty quando o usuário mexeu; senão a sugestão segue viva.
      order_qty: parseNum(r.draft.order),
    }));
  }

  const save = useMutation({
    mutationFn: () => stockCountsApi.update(countId, { items: payload() }),
    onSuccess: () => { setError(''); qc.invalidateQueries({ queryKey: ['stock-count', countId] }); },
    onError: (e) => setError(apiError(e)),
  });

  // Concluir = salvar o que está na tela e ajustar o saldo pelo que foi contado.
  const apply = useMutation({
    mutationFn: async () => {
      await stockCountsApi.update(countId, { items: payload() });
      return stockCountsApi.apply(countId);
    },
    onSuccess: (r) => {
      setError('');
      qc.invalidateQueries({ queryKey: ['stock-count', countId] });
      qc.invalidateQueries({ queryKey: ['stock-counts'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      alert(`Contagem concluída. ${r.adjusted} produto(s) tiveram o saldo corrigido.`);
    },
    onError: (e) => setError(apiError(e)),
  });

  const generate = useMutation({
    mutationFn: () => stockCountsApi.generateRequest(countId),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['stock-counts'] });
      navigate(`/requests/${r.request_id}`);
    },
    onError: (e) => setError(apiError(e)),
  });

  function set(productId: number, field: keyof Draft, value: string) {
    setDrafts((d) => ({ ...d, [productId]: { ...(d[productId] ?? { counted: '', order: '' }), [field]: value } }));
  }

  /** Enter pula para o próximo campo da coluna: dá para contar a folha inteira sem o mouse. */
  function onEnterNext(e: KeyboardEvent<HTMLInputElement>, column: string, index: number) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const next = document.querySelector<HTMLInputElement>(`[data-cell="${column}-${index + 1}"]`);
    next?.focus();
    next?.select();
  }

  if (isLoading) return <Spinner />;
  if (loadError) return <ErrorBox message={apiError(loadError)} />;
  if (!data) return <EmptyState message="Contagem não encontrada." />;

  return (
    <div>
      <Link to="/estoque/contagem" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-emerald-600">
        <ArrowLeft size={15} /> Contagens
      </Link>

      <PageHeader
        title={data.title}
        subtitle={
          isDraft
            ? `Lance o que você contou na prateleira. A compra sugerida cobre ${data.coverage_days} dia(s).`
            : `Concluída por ${data.applied_by_name ?? '—'} em ${datetime(data.applied_at)}.`
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Badge status={data.status} />
            {isDraft && canCount && (
              <>
                <Button variant="secondary" disabled={save.isPending} onClick={() => save.mutate()}>
                  <Save size={16} /> Salvar
                </Button>
                <Button
                  disabled={apply.isPending || totals.counted === 0}
                  onClick={() => {
                    if (confirm(`Concluir a contagem? O saldo de ${totals.counted} produto(s) passa a ser o que você contou.`)) apply.mutate();
                  }}
                >
                  <CheckCircle2 size={16} /> Concluir contagem
                </Button>
              </>
            )}
            {/* Revisão pós-contagem: dá para mexer nas quantidades e só então gerar a lista. */}
            {!isDraft && !data.request_id && canEditOrder && (
              <Button variant="secondary" disabled={save.isPending} onClick={() => save.mutate()}>
                <Save size={16} /> Salvar quantidades
              </Button>
            )}
            {!isDraft && !data.request_id && canRequest && (
              <Button
                disabled={generate.isPending || totals.toBuy === 0}
                onClick={async () => {
                  // Grava o que está na tela antes de gerar: a lista sai com os números revisados.
                  if (canEditOrder) await save.mutateAsync();
                  generate.mutate();
                }}
              >
                <ShoppingCart size={16} /> Gerar lista de compras ({totals.toBuy})
              </Button>
            )}
            {data.request_id && (
              <Link to={`/requests/${data.request_id}`}>
                <Button variant="secondary"><ShoppingCart size={16} /> Ver lista #{data.request_id}</Button>
              </Link>
            )}
          </div>
        }
      />

      {error && <ErrorBox message={error} />}

      {/* Resumo */}
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Stat label="Itens na folha" value={String(totals.total)} />
        <Stat label="Já contados" value={`${totals.counted} de ${totals.total}`} />
        <Stat label="A comprar" value={String(totals.toBuy)} tone="emerald" />
        <Stat label="Custo estimado" value={brl(totals.cost)} tone="amber" />
      </div>

      {totals.critical > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertTriangle size={16} />
          {totals.critical} item(ns) no ponto de pedido ou abaixo dele.
        </div>
      )}

      {/* Filtros da folha */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar item…" className="w-56 pl-8" />
        </div>
        <Select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="w-52">
          <option value="todos">Todos os itens</option>
          <option value="faltando">Falta contar</option>
          <option value="comprar">Só o que vai ser comprado</option>
        </Select>
        <span className="text-xs text-slate-500">{visible.length} linha(s)</span>
      </div>

      {visible.length === 0 ? (
        <EmptyState message="Nenhuma linha com esse filtro." />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2.5 font-semibold">Item</th>
                <th className="px-3 py-2.5 text-right font-semibold">Sistema</th>
                <th className="px-3 py-2.5 text-right font-semibold">Contado</th>
                <th className="px-3 py-2.5 text-right font-semibold">Alvo</th>
                <th className="px-3 py-2.5 text-center font-semibold">Situação</th>
                <th className="px-3 py-2.5 text-right font-semibold">Sugerido</th>
                <th className="px-3 py-2.5 text-right font-semibold">Comprar</th>
                <th className="px-3 py-2.5 text-right font-semibold">Custo</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r, i) => {
                const st = STATUS_STYLE[r.status];
                const divergiu = r.counted !== null && Math.abs(r.counted - Number(r.it.system_qty)) > 0.0001;
                return (
                  <tr key={r.it.product_id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-3 py-2">
                      <p className="font-medium text-slate-800">{r.it.product_name}</p>
                      <p className="text-xs text-slate-400">
                        {r.it.category_name ?? 'sem categoria'}
                        {r.it.unit ? ` · ${r.it.unit}` : ''}
                        {/* Deixa explícito de onde saiu o alvo: cadastro ou histórico de consumo. */}
                        {r.it.basis === 'consumo' && r.it.daily_usage
                          ? ` · consumo ${fmtQty(r.it.daily_usage)}/dia`
                          : r.it.basis === 'minmax' ? ' · mín/máx cadastrado' : ' · sem parâmetro'}
                      </p>
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums ${divergiu ? 'text-slate-400 line-through' : 'text-slate-600'}`}>
                      {fmtQty(r.it.system_qty)}
                    </td>
                    <td className="w-28 px-2 py-2">
                      <Input
                        value={r.draft.counted}
                        onChange={(e) => set(r.it.product_id, 'counted', e.target.value)}
                        onKeyDown={(e) => onEnterNext(e, 'counted', i)}
                        data-cell={`counted-${i}`}
                        disabled={!isDraft || !canCount}
                        className="text-right"
                        inputMode="decimal"
                        placeholder="—"
                        aria-label={`Quantidade contada de ${r.it.product_name}`}
                      />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">{fmtQty(r.it.target)}</td>
                    {/* Sem contagem, "situação" e "sugerido" saem do saldo do sistema —
                        o número que a folha existe para conferir. Fica cinza e fora do
                        total, para não parecer decisão tomada. */}
                    <td className="px-3 py-2 text-center">
                      {r.counted === null ? (
                        <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-400">Falta contar</span>
                      ) : (
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>
                      )}
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${r.counted === null ? 'text-slate-300' : 'font-medium text-slate-700'}`}
                      title={r.counted === null ? 'Estimativa pelo saldo do sistema. Conte o item para valer como sugestão.' : undefined}
                    >
                      {fmtQty(r.suggested)}
                    </td>
                    <td className="w-28 px-2 py-2">
                      <Input
                        value={r.draft.order}
                        onChange={(e) => set(r.it.product_id, 'order', e.target.value)}
                        onKeyDown={(e) => onEnterNext(e, 'order', i)}
                        data-cell={`order-${i}`}
                        disabled={!canEditOrder}
                        className="text-right"
                        inputMode="decimal"
                        placeholder={fmtQty(r.suggested)}
                        aria-label={`Quantidade a comprar de ${r.it.product_name}`}
                      />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-amber-700">
                      {r.finalQty > 0 && r.it.unit_cost ? brl(r.finalQty * Number(r.it.unit_cost)) : <span className="text-slate-300">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">
            <span>
              Deixe “Comprar” em branco para usar a quantidade sugerida. <kbd className="rounded border border-slate-300 bg-white px-1">Enter</kbd> pula para a linha de baixo.
            </span>
            <span className="font-semibold">Total estimado: {brl(totals.cost)}</span>
          </div>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'emerald' | 'amber' }) {
  const color = tone === 'emerald' ? 'text-emerald-700' : tone === 'amber' ? 'text-amber-700' : 'text-slate-800';
  return (
    <Card className="py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-xl font-bold ${color}`}>{value}</p>
    </Card>
  );
}
