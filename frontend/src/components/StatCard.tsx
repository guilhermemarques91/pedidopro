import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, ArrowDownRight, type LucideIcon } from 'lucide-react';

/**
 * Cartão de indicador (KPI) no padrão dos painéis modernos: selo de ícone colorido no
 * topo, rótulo, número grande — opcionalmente sobre um total — e uma linha de variação
 * contra o período anterior.
 *
 * A cor NÃO é decoração: o `tone` classifica o indicador (neutro / bom / atenção /
 * crítico), então o operador varre a linha de cartões e enxerga na hora o que precisa
 * de ação. Por isso o tom também aparece no selo do ícone, não só no número.
 */
export type StatTone = 'default' | 'info' | 'success' | 'warn' | 'danger';

const tones: Record<StatTone, { badge: string; surface: string }> = {
  // O selo carrega a cor; a superfície fica branca para a linha não virar um arco-íris.
  default: { badge: 'bg-slate-100 text-slate-600', surface: 'bg-white' },
  info: { badge: 'bg-sky-100 text-sky-600', surface: 'bg-white' },
  success: { badge: 'bg-emerald-100 text-emerald-600', surface: 'bg-white' },
  // Atenção e crítico ganham um leve degradê: destacam-se sem precisar de borda forte.
  warn: { badge: 'bg-amber-100 text-amber-600', surface: 'bg-gradient-to-b from-amber-50/80 to-white' },
  danger: { badge: 'bg-rose-100 text-rose-600', surface: 'bg-gradient-to-b from-rose-50/80 to-white' },
};

export function StatCard({
  icon: Icon, label, value, total, tone = 'default', delta, deltaLabel = 'vs. mês anterior', to, footer,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  /** Denominador opcional, exibido menor ao lado do valor (ex.: 12 / 24). */
  total?: ReactNode;
  tone?: StatTone;
  /** Variação percentual. Positivo sobe (verde), negativo desce (vermelho). */
  delta?: number | null;
  deltaLabel?: string;
  to?: string;
  footer?: ReactNode;
}) {
  const t = tones[tone];
  const up = (delta ?? 0) >= 0;
  const DeltaIcon = up ? ArrowUpRight : ArrowDownRight;

  const body = (
    <div
      className={`flex h-full flex-col rounded-2xl border border-slate-200/70 p-4 shadow-[var(--shadow-sm)] transition-shadow ${t.surface} ${
        to ? 'hover:shadow-[var(--shadow-md)]' : ''
      }`}
    >
      <span className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${t.badge}`}>
        <Icon size={19} />
      </span>

      <p className="mt-3 truncate text-sm font-medium text-slate-500" title={label}>{label}</p>

      <p className="mt-1 flex items-baseline gap-1.5">
        <span className="text-3xl font-bold leading-none tracking-tight text-slate-900">{value}</span>
        {total != null && <span className="text-base font-medium text-slate-400">/ {total}</span>}
      </p>

      {delta != null && (
        <p className="mt-2 flex items-center gap-1 text-xs">
          <DeltaIcon size={14} className={up ? 'text-emerald-600' : 'text-rose-600'} />
          <span className={`font-semibold ${up ? 'text-emerald-600' : 'text-rose-600'}`}>
            {up ? '+' : ''}{delta}%
          </span>
          <span className="truncate text-slate-400">{deltaLabel}</span>
        </p>
      )}

      {footer && <div className="mt-auto pt-3">{footer}</div>}
    </div>
  );

  // O cartão inteiro é o alvo de clique quando há destino — alvo grande, bom no toque.
  return to ? (
    <Link to={to} className="block h-full rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">
      {body}
    </Link>
  ) : body;
}
