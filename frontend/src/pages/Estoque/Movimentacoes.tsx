import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { productsApi, stockApi } from '../../services/resources';
import type { MoveFilters } from '../../services/resources';
import { apiError } from '../../services/api';
import { PageHeader } from '../../components/PageHeader';
import { Button, Card, Combobox, Input, Select, Spinner, ErrorBox, EmptyState } from '../../components/ui';
import { MOVE_ORIGINS, MOVE_REASONS, REASON_LABEL, reasonsFor } from '../../config/estoque';
import { brl, datetime, fmtQty, parseNum } from '../../utils/format';
import { useAuth } from '../../store/auth.store';
import type { MoveReason } from '../../types';

const TYPE_LABEL: Record<string, string> = { in: 'Entrada', out: 'Saída', adjust: 'Ajuste' };
const TYPE_CHIP: Record<string, string> = {
  in: 'bg-emerald-50 text-emerald-700',
  out: 'bg-rose-50 text-rose-700',
  adjust: 'bg-sky-50 text-sky-700',
};

/**
 * Extrato de movimentações — a visão que não existia.
 *
 * O histórico só vivia dentro do modal de UM produto, então não havia como perguntar
 * "quanto se perdeu por vencimento este mês?" nem "de onde saiu tudo isso?". Aqui o
 * movimento é filtrável por tipo, motivo, origem e período, e vem com valor: a saída passou
 * a ser valorizada, então o total é CMV de verdade, não estimativa.
 */
export function Movimentacoes() {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 29 * 86400_000).toISOString().slice(0, 10);
  const can = useAuth((s) => s.can);

  const [f, setF] = useState<MoveFilters>({ from: monthAgo, to: today, limit: 200 });
  const [launching, setLaunching] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['stock-ledger', f],
    queryFn: () => stockApi.ledger(f),
  });

  const set = (patch: Partial<MoveFilters>) => setF((prev) => ({ ...prev, ...patch }));
  const t = data?.totals;

  return (
    <div>
      <PageHeader title="Movimentações" subtitle="Tudo que entrou e saiu do estoque — por tipo, motivo e origem" />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-600">De</span>
          <Input type="date" value={f.from ?? ''} max={f.to} onChange={(e) => set({ from: e.target.value })} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-600">Até</span>
          <Input type="date" value={f.to ?? ''} min={f.from} onChange={(e) => set({ to: e.target.value })} />
        </label>
        <label className="w-36 text-sm">
          <span className="mb-1 block font-medium text-slate-600">Tipo</span>
          <Select value={f.type ?? ''} onChange={(e) => set({ type: (e.target.value || undefined) as MoveFilters['type'] })}>
            <option value="">Todos</option>
            <option value="in">Entrada</option>
            <option value="out">Saída</option>
            <option value="adjust">Ajuste</option>
          </Select>
        </label>
        <label className="w-52 text-sm">
          <span className="mb-1 block font-medium text-slate-600">Motivo</span>
          <Select value={f.reason ?? ''} onChange={(e) => set({ reason: e.target.value || undefined })}>
            <option value="">Todos</option>
            {MOVE_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </Select>
        </label>
        <label className="w-52 text-sm">
          <span className="mb-1 block font-medium text-slate-600">Origem</span>
          <Select value={f.ref ?? ''} onChange={(e) => set({ ref: e.target.value || undefined })}>
            <option value="">Todas</option>
            {MOVE_ORIGINS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </label>
        <label className="w-52 text-sm">
          <span className="mb-1 block font-medium text-slate-600">Produto</span>
          <Input value={f.q ?? ''} onChange={(e) => set({ q: e.target.value || undefined })} placeholder="Buscar…" />
        </label>
        {can('estoque:mover') && (
          <Button className="ml-auto" onClick={() => setLaunching((v) => !v)}>
            <Plus size={16} /> Lançar movimento
          </Button>
        )}
      </div>

      {launching && can('estoque:mover') && <BatchForm onDone={() => setLaunching(false)} />}

      {t && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Movimentos" value={String(t.moves)} />
          <Stat label="Entrou" value={fmtQty(t.qty_in)} hint={brl(t.value_in)} />
          <Stat label="Saiu" value={fmtQty(t.qty_out)} hint={brl(t.value_out)} />
          <Stat
            label="Custo da saída"
            value={brl(t.value_out)}
            hint="Valorizada pelo custo do insumo no momento da baixa"
          />
        </div>
      )}

      {isLoading && <Spinner />}
      {error && <ErrorBox message={apiError(error)} />}
      {data && data.moves.length === 0 && <EmptyState message="Nenhum movimento com esses filtros." />}

      {data && data.moves.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[52rem] text-sm">
            <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Quando</th>
                <th className="px-4 py-3 font-semibold">Produto</th>
                <th className="px-4 py-3 font-semibold">Tipo</th>
                <th className="px-4 py-3 text-right font-semibold">Quantidade</th>
                <th className="px-4 py-3 text-right font-semibold">Valor</th>
                <th className="px-4 py-3 text-right font-semibold">Saldo depois</th>
                <th className="px-4 py-3 font-semibold">Motivo / origem</th>
              </tr>
            </thead>
            <tbody>
              {data.moves.map((m) => {
                const qty = Number(m.qty_delta);
                const cost = m.unit_cost != null ? Number(m.unit_cost) : null;
                return (
                  <tr key={m.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-4 py-3 whitespace-nowrap text-slate-500">{datetime(m.created_at)}</td>
                    <td className="px-4 py-3 text-slate-800">{m.product_name}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${TYPE_CHIP[m.type]}`}>
                        {TYPE_LABEL[m.type]}
                      </span>
                    </td>
                    <td className={`px-4 py-3 text-right font-medium ${qty < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                      {qty > 0 ? '+' : ''}{fmtQty(qty)} <span className="text-xs text-slate-400">{m.unit ?? ''}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600">
                      {cost != null ? brl(Math.abs(qty) * cost) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className={`px-4 py-3 text-right ${Number(m.balance_after) < 0 ? 'text-rose-600' : 'text-slate-500'}`}>
                      {fmtQty(m.balance_after)}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {m.reason ? REASON_LABEL[m.reason] ?? m.reason : origemDe(m.ref)}
                      {m.notes && <p className="text-slate-400">{m.notes}</p>}
                      {m.user_name && <p className="text-slate-400">{m.user_name}</p>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

/** Rótulo legível da origem a partir do prefixo do `ref` (delivery:12 → Delivery). */
function origemDe(ref: string | null): string {
  if (!ref) return '—';
  const prefix = ref.split(':')[0];
  return MOVE_ORIGINS.find((o) => o.value === prefix)?.label ?? ref;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-800">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
    </Card>
  );
}

type Line = { product_id: string; quantity: string; unit_cost: string };
const emptyLine = (): Line => ({ product_id: '', quantity: '', unit_cost: '' });

/**
 * Lançamento em lote: a perda do dia inteira num envio só.
 *
 * Antes era um modal por produto, e o motivo virava texto livre — o que tornava impossível
 * separar "venceu" de "quebrou" depois. Aqui o motivo é escolhido uma vez e vale para todas
 * as linhas, que é como a perda realmente acontece.
 */
function BatchForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [type, setType] = useState<'in' | 'out' | 'adjust'>('out');
  const [reason, setReason] = useState<MoveReason | ''>('perda_vencimento');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [err, setErr] = useState('');

  const products = useQuery({ queryKey: ['products'], queryFn: () => productsApi.list() });
  const options = useMemo(
    () => (products.data ?? []).map((p) => ({
      value: String(p.id),
      label: p.name,
      hint: [p.tipo, p.unit, p.stock_qty != null ? `saldo ${fmtQty(p.stock_qty)}` : null].filter(Boolean).join(' · '),
    })),
    [products.data],
  );

  const save = useMutation({
    mutationFn: () => stockApi.batch({
      type,
      reason: reason || null,
      notes: notes.trim() || null,
      lines: lines
        .filter((l) => l.product_id && parseNum(l.quantity))
        .map((l) => ({
          product_id: Number(l.product_id),
          quantity: parseNum(l.quantity) as number,
          unit_cost: parseNum(l.unit_cost),
        })),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock-ledger'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      onDone();
    },
    onError: (e) => setErr(apiError(e)),
  });

  const valid = lines.filter((l) => l.product_id && (parseNum(l.quantity) ?? 0) > 0).length;
  const allowed = reasonsFor(type);

  return (
    <Card className="mb-4 border-slate-300">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">Novo lançamento</h3>
      {err && <div className="mb-3"><ErrorBox message={err} /></div>}

      <div className="mb-3 flex flex-wrap gap-3">
        <label className="w-40 text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-500">Tipo</span>
          <Select
            value={type}
            onChange={(e) => {
              const t = e.target.value as 'in' | 'out' | 'adjust';
              setType(t);
              // Motivo que não faz sentido no novo tipo é limpo em vez de virar erro no envio.
              if (!reasonsFor(t).some((r) => r.value === reason)) setReason('');
            }}
          >
            <option value="out">Saída</option>
            <option value="in">Entrada</option>
            <option value="adjust">Ajuste (saldo final)</option>
          </Select>
        </label>
        <label className="w-64 text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-500">Motivo</span>
          <Select value={reason} onChange={(e) => setReason(e.target.value as MoveReason | '')}>
            <option value="">Sem motivo</option>
            {allowed.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </Select>
        </label>
        <label className="min-w-52 flex-1 text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-500">Observação</span>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="opcional — vale para todas as linhas" />
        </label>
      </div>

      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <div className="min-w-56 flex-1">
              <Combobox
                options={options}
                value={l.product_id}
                placeholder="Escolha o produto…"
                onChange={(v) => {
                  setLines((ls) => ls.map((x, j) => (j === i ? { ...x, product_id: v } : x)));
                  // Escolher na última linha já abre a próxima: lançar 10 perdas sem clicar
                  // em "adicionar" 10 vezes.
                  setLines((ls) => (i === ls.length - 1 ? [...ls, emptyLine()] : ls));
                }}
              />
            </div>
            <label className="w-28 text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-500">
                {type === 'adjust' ? 'Novo saldo' : 'Quantidade'}
              </span>
              <Input
                value={l.quantity}
                onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))}
                inputMode="decimal"
                placeholder="0"
                aria-label={`Quantidade da linha ${i + 1}`}
              />
            </label>
            {type === 'in' && (
              <label className="w-32 text-sm">
                <span className="mb-1 block text-xs font-medium text-slate-500">Custo un.</span>
                <Input
                  value={l.unit_cost}
                  onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, unit_cost: e.target.value } : x)))}
                  inputMode="decimal"
                  placeholder="opcional"
                  aria-label={`Custo da linha ${i + 1}`}
                />
              </label>
            )}
            <button
              type="button"
              onClick={() => setLines((ls) => (ls.length === 1 ? [emptyLine()] : ls.filter((_, j) => j !== i)))}
              className="mb-1 rounded-lg p-2 text-slate-300 hover:text-rose-600"
              aria-label={`Remover linha ${i + 1}`}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        <span className="mr-auto text-xs text-slate-400">
          {valid} linha(s) válida(s) — o lançamento é uma transação só.
        </span>
        <Button variant="ghost" onClick={onDone}>Cancelar</Button>
        <Button onClick={() => save.mutate()} disabled={save.isPending || valid === 0}>Lançar</Button>
      </div>
    </Card>
  );
}
