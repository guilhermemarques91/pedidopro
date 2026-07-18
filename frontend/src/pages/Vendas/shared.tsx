import { useEffect, useState } from 'react';
import { Clock, Banknote, CreditCard, QrCode, Wallet, Plus, Trash2 } from 'lucide-react';
import type { VendasBoardCard, BoardOrigin, PaymentMethod, PaymentLine } from '../../types';
import { Select, Input } from '../../components/ui';
import { brl, parseNum } from '../../utils/format';

export const ORIGIN_META: Record<BoardOrigin, { label: string; cls: string }> = {
  mesa: { label: 'Mesa', cls: 'bg-emerald-100 text-emerald-700' },
  comanda: { label: 'Comanda', cls: 'bg-blue-100 text-blue-700' },
  balcao: { label: 'Balcão', cls: 'bg-purple-100 text-purple-700' },
  retirada: { label: 'Retirada', cls: 'bg-orange-100 text-orange-700' },
  ifood: { label: 'iFood', cls: 'bg-red-100 text-red-700' },
  '99food': { label: '99Food', cls: 'bg-yellow-100 text-yellow-800' },
};

export const PAYMENT_METHODS: { value: PaymentMethod; label: string; icon: typeof Banknote }[] = [
  { value: 'dinheiro', label: 'Dinheiro', icon: Banknote },
  { value: 'pix', label: 'Pix', icon: QrCode },
  { value: 'debito', label: 'Débito', icon: CreditCard },
  { value: 'credito', label: 'Crédito', icon: CreditCard },
  { value: 'outro', label: 'Outro', icon: Wallet },
];

export const PAYMENT_LABEL: Record<PaymentMethod | 'multi', string> = {
  dinheiro: 'Dinheiro', pix: 'Pix', debito: 'Débito', credito: 'Crédito', outro: 'Outro', multi: 'Dividido',
};

export function cardTitle(c: Pick<VendasBoardCard, 'source' | 'id' | 'display_id' | 'station' | 'daily_number'>): string {
  if (c.source === 'delivery') return c.display_id ? `#${c.display_id}` : `#${c.id}`;
  if (c.station) return `${c.station.kind === 'mesa' ? 'Mesa' : 'Comanda'} ${c.station.number}`;
  return c.daily_number ? `#${c.daily_number}` : `#${c.id}`;
}

export function minutesSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T')).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 60_000));
}

export function elapsedLabel(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

/** Re-renderiza a cada minuto para os timers de espera andarem sozinhos. */
export function useMinuteTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  return tick;
}

/**
 * Badge de tempo de espera com cor de urgência (verde <10min, âmbar <20, vermelho 20+)
 * — padrão de KDS: o que está esperando demais grita sozinho.
 */
export function ElapsedBadge({ since, muted }: { since: string | null | undefined; muted?: boolean }) {
  const min = minutesSince(since);
  if (min === null) return null;
  const cls = muted
    ? 'bg-slate-100 text-slate-500'
    : min >= 20
      ? 'bg-red-100 text-red-700'
      : min >= 10
        ? 'bg-amber-100 text-amber-700'
        : 'bg-emerald-50 text-emerald-700';
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>
      <Clock size={11} /> {elapsedLabel(min)}
    </span>
  );
}

// ---- pagamento dividido ----

export interface SplitLine { method: PaymentMethod; amount: string }

export function sumSplit(lines: SplitLine[]): number {
  return lines.reduce((s, l) => s + (parseNum(l.amount) ?? 0), 0);
}

/** true quando dá pra enviar: forma única, ou dividido com a soma batendo com o total. */
export function splitIsValid(lines: SplitLine[], total: number): boolean {
  if (lines.length <= 1) return true;
  return Math.abs(sumSplit(lines) - total) <= 0.01;
}

/** Monta o payload: forma única vira uma linha com o total; dividido usa os valores digitados. */
export function splitToPayments(lines: SplitLine[], total: number): PaymentLine[] {
  if (lines.length <= 1) return [{ method: lines[0]?.method ?? 'dinheiro', amount: Math.round(total * 100) / 100 }];
  return lines.map((l) => ({ method: l.method, amount: parseNum(l.amount) ?? 0 }));
}

/**
 * Editor de pagamento: uma forma só (botões grandes) ou dividido em várias
 * (parte em dinheiro, parte em cartão...), com indicador do restante.
 */
export function PaymentSplitEditor({
  total, lines, onChange, disabled,
}: { total: number; lines: SplitLine[]; onChange: (lines: SplitLine[]) => void; disabled?: boolean }) {
  const single = lines.length <= 1;
  const remaining = total - sumSplit(lines);

  function setLine(i: number, patch: Partial<SplitLine>) {
    onChange(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  if (single) {
    return (
      <div className="space-y-2">
        <PayMethodPicker
          value={lines[0]?.method ?? 'dinheiro'}
          onChange={(m) => onChange([{ method: m, amount: String(total) }])}
          disabled={disabled}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange([
            { method: lines[0]?.method ?? 'dinheiro', amount: '' },
            { method: 'credito', amount: '' },
          ])}
          className="text-xs font-medium text-emerald-700 underline disabled:opacity-50"
        >
          Dividir em mais de uma forma
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {lines.map((l, i) => (
        <div key={i} className="flex items-center gap-2">
          <Select
            value={l.method}
            onChange={(e) => setLine(i, { method: e.target.value as PaymentMethod })}
            className="flex-1"
          >
            {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </Select>
          <div className="w-24 shrink-0">
            <Input
              inputMode="decimal"
              placeholder="0,00"
              value={l.amount}
              onChange={(e) => setLine(i, { amount: e.target.value })}
              className="text-right"
            />
          </div>
          <button
            type="button"
            title="Remover forma"
            disabled={disabled}
            onClick={() => onChange(lines.filter((_, idx) => idx !== i))}
            className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <div className="flex items-center justify-between text-xs">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange([...lines, { method: 'dinheiro', amount: remaining > 0 ? remaining.toFixed(2).replace('.', ',') : '' }])}
          className="flex items-center gap-1 font-medium text-emerald-700 underline disabled:opacity-50"
        >
          <Plus size={12} /> Adicionar forma
        </button>
        {Math.abs(remaining) <= 0.01 ? (
          <span className="font-medium text-emerald-700">Valores conferem ✓</span>
        ) : remaining > 0 ? (
          <span className="font-medium text-amber-700">Falta {brl(remaining)}</span>
        ) : (
          <span className="font-medium text-red-600">Excede em {brl(-remaining)}</span>
        )}
      </div>
    </div>
  );
}

/** Seleção de forma de pagamento em botões grandes (amigável a touch), no lugar de <select>. */
export function PayMethodPicker({
  value, onChange, disabled,
}: { value: PaymentMethod; onChange: (m: PaymentMethod) => void; disabled?: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {PAYMENT_METHODS.map((m) => {
        const Icon = m.icon;
        const active = value === m.value;
        return (
          <button
            key={m.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(m.value)}
            className={`flex flex-col items-center gap-1 rounded-lg border p-2.5 text-xs font-medium transition disabled:opacity-50 ${
              active
                ? 'border-emerald-600 bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600'
                : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
            }`}
          >
            <Icon size={18} className={active ? 'text-emerald-600' : 'text-slate-400'} />
            {m.label}
          </button>
        );
      })}
    </div>
  );
}
