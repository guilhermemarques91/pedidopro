import { AlertTriangle, Download } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button, Card, Select } from '../../components/ui';
import type { FinWarning } from '../../types';
import { monthLabel } from '../../utils/format';

/**
 * Avisos de inconsistência do DRE importado. Não são erros do sistema: apontam
 * onde o dado que veio do AllFood provavelmente não representa operação (o caso
 * clássico é o recebimento de cartão lançado como receita, que conta a mesma
 * venda duas vezes e infla o lucro).
 */
export function WarningList({ warnings }: { warnings: FinWarning[] }) {
  if (!warnings.length) return null;
  return (
    <div className="mb-4 space-y-2">
      {warnings.map((w, i) => (
        <div key={w.code ?? i} className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
          <div>
            <p className="font-medium">{w.name}</p>
            <p className="mt-0.5 text-amber-800">{w.message}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Seletor de competência (AAAA-MM) alimentado pelos meses já importados. */
export function MonthSelect({
  label, value, months, onChange, allowEmpty,
}: {
  label: string;
  value: string;
  months: string[];
  onChange: (v: string) => void;
  allowEmpty?: string;
}) {
  return (
    <label className="w-52 text-sm">
      <span className="mb-1 block font-medium text-slate-600">{label}</span>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        {allowEmpty !== undefined && <option value="">{allowEmpty}</option>}
        {months.map((m) => (
          <option key={m} value={m}>{monthLabel(m)}</option>
        ))}
      </Select>
    </label>
  );
}

/** Rótulo + valor, para as fichas de resumo dentro de um Card. */
export function Stat({
  label, value, hint, tone = 'default',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'good' | 'bad' | 'muted';
}) {
  const color = {
    default: 'text-slate-900',
    good: 'text-emerald-700',
    bad: 'text-rose-700',
    muted: 'text-slate-500',
  }[tone];
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${color}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </Card>
  );
}

/**
 * Exporta linhas para CSV no formato que o Excel pt-BR abre direto:
 * BOM + ponto e vírgula como separador + vírgula decimal.
 */
export function exportCsv(filename: string, head: string[], rows: (string | number | null)[][]): void {
  const esc = (v: string | number | null) => {
    if (v === null || v === undefined) return '""';
    const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };
  const csv = '﻿' + [head.map(esc).join(';'), ...rows.map((r) => r.map(esc).join(';'))].join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function ExportButton({ onClick, label = 'Exportar CSV' }: { onClick: () => void; label?: string }) {
  return (
    <Button variant="secondary" onClick={onClick}>
      <Download size={16} /> {label}
    </Button>
  );
}

/** Mensagem padrão quando ainda não há planilha importada para a análise. */
export function NoData({ what, hint }: { what: string; hint?: string }) {
  return (
    <Card className="text-center">
      <p className="text-sm font-medium text-slate-700">{what}</p>
      <p className="mt-1 text-sm text-slate-500">
        {hint ?? 'Importe a planilha correspondente na aba Importações para liberar esta análise.'}
      </p>
    </Card>
  );
}
