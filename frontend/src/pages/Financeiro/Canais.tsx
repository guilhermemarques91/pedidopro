import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import { Info } from 'lucide-react';
import { financeiroApi } from '../../services/resources';
import { apiError } from '../../services/api';
import { Card, Spinner, ErrorBox } from '../../components/ui';
import type { FinChannelRow } from '../../types';
import { brl, pct, dmy } from '../../utils/format';
import { ExportButton, exportCsv, NoData } from './shared';

const LABEL: Record<string, string> = { ifood: 'iFood', '99food': '99Food' };
const label = (p: string) => LABEL[p] ?? p;

/**
 * Rentabilidade por canal. O número que importa é o TAKE-RATE efetivo —
 * comissão + ofertas + taxa de pagamento sobre a receita bruta —, porque é ele
 * que diz quanto de cada real vendido no app fica na plataforma.
 *
 * Cobre só iFood e 99Food: são as plataformas que têm planilha. Balcão e
 * marmitex aparecem apenas de forma agregada no DRE.
 */
export function Canais() {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(new Date(Date.now() - 89 * 86400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(today);

  const { data, isLoading, error } = useQuery({
    queryKey: ['fin-canais', from, to],
    queryFn: () => financeiroApi.canais({ from, to }),
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox message={apiError(error)} />;
  if (!data) return null;
  if (!data.platforms.length) {
    return (
      <div className="space-y-4">
        <RangeBar from={from} to={to} today={today} setFrom={setFrom} setTo={setTo} />
        <NoData
          what="Nenhum dado de plataforma no período."
          hint="Importe “Dados da loja” (99Food) ou “Qualidade da operação” (iFood) na aba Importações."
        />
      </div>
    );
  }

  const t = data.totals;
  const chart = data.platforms.map((p) => ({
    name: label(p.platform),
    liquido: p.net_revenue,
    comissao: p.commission,
    ofertas: p.offers_cost,
    taxa: p.payment_fee,
  }));

  // Série diária consolidada (soma das plataformas por dia).
  const byDay = new Map<string, { date: string; bruto: number; custo: number; pedidos: number }>();
  for (const d of data.daily) {
    const cur = byDay.get(d.stat_date) ?? { date: d.stat_date, bruto: 0, custo: 0, pedidos: 0 };
    cur.bruto += d.gross_revenue;
    cur.custo += d.platform_cost;
    cur.pedidos += d.orders;
    byDay.set(d.stat_date, cur);
  }
  const daily = [...byDay.values()].map((d) => ({
    ...d,
    label: dmy(d.date),
    take: d.bruto > 0 ? (d.custo / d.bruto) * 100 : 0,
  }));

  const exportar = () => exportCsv(
    `canais-${from}-a-${to}.csv`,
    ['Plataforma', 'Dias', 'Pedidos', 'Receita bruta', 'Comissão', 'Ofertas', 'Taxa pagamento',
      'Custo plataforma', 'Take-rate', 'Receita líquida', 'Ticket médio', 'Cancelados', 'Nota'],
    data.platforms.map((p) => [
      label(p.platform), p.days, p.orders, p.gross_revenue, p.commission, p.offers_cost,
      p.payment_fee, p.platform_cost, p.take_rate, p.net_revenue, p.avg_ticket,
      p.cancelled_orders, p.rating,
    ]),
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <RangeBar from={from} to={to} today={today} setFrom={setFrom} setTo={setTo} />
        <ExportButton onClick={exportar} />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Mini label="Receita bruta" value={brl(t.gross_revenue)} hint={`${t.orders} pedidos`} />
        <Mini label="Custo das plataformas" value={brl(t.platform_cost)} hint="comissão + ofertas + taxa" tone="bad" />
        <Mini label="Take-rate efetivo" value={pct(t.take_rate)} hint="do faturamento fica na plataforma" tone="bad" />
        <Mini label="Receita líquida" value={brl(t.net_revenue)} hint={`ticket médio ${brl(t.avg_ticket)}`} tone="good" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Para onde vai o faturamento de cada canal</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chart} margin={{ left: 0, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => (v / 1000).toFixed(0) + 'k'} />
              <Tooltip formatter={(v: number, n) => [brl(v), String(n)]} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="liquido" name="Fica com a loja" stackId="a" fill="#059669" />
              <Bar dataKey="comissao" name="Comissão" stackId="a" fill="#e11d48" />
              <Bar dataKey="ofertas" name="Ofertas" stackId="a" fill="#f59e0b" />
              <Bar dataKey="taxa" name="Taxa de pagamento" stackId="a" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Faturamento diário e take-rate</h3>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={daily} margin={{ left: 0, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis yAxisId="l" tick={{ fontSize: 11 }} tickFormatter={(v: number) => (v / 1000).toFixed(1) + 'k'} />
              <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(v: number) => v.toFixed(0) + '%'} />
              <Tooltip formatter={(v: number, n) => (n === 'Take-rate' ? [`${v.toFixed(1)}%`, n] : [brl(v), String(n)])} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line yAxisId="l" type="monotone" dataKey="bruto" name="Receita bruta" stroke="#059669" strokeWidth={2} dot={false} />
              <Line yAxisId="r" type="monotone" dataKey="take" name="Take-rate" stroke="#e11d48" strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card className="p-0">
        <div className="border-b border-slate-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-700">Comparativo por canal</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[54rem] text-sm">
            <thead className="border-b border-slate-200 text-left text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Canal</th>
                <th className="px-4 py-3 text-right font-medium">Pedidos</th>
                <th className="px-4 py-3 text-right font-medium">Receita bruta</th>
                <th className="px-4 py-3 text-right font-medium">Comissão</th>
                <th className="px-4 py-3 text-right font-medium">Ofertas</th>
                <th className="px-4 py-3 text-right font-medium">Taxa pag.</th>
                <th className="px-4 py-3 text-right font-medium">Take-rate</th>
                <th className="px-4 py-3 text-right font-medium">Receita líquida</th>
                <th className="px-4 py-3 text-right font-medium">Ticket</th>
                <th className="px-4 py-3 text-right font-medium">Nota</th>
              </tr>
            </thead>
            <tbody>
              {data.platforms.map((p) => <ChannelRow key={p.platform} row={p} />)}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                <td className="px-4 py-3">Total</td>
                <td className="px-4 py-3 text-right tabular-nums">{t.orders}</td>
                <td className="px-4 py-3 text-right tabular-nums">{brl(t.gross_revenue)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{brl(t.commission)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{brl(t.offers_cost)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{brl(t.payment_fee)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{pct(t.take_rate)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-emerald-700">{brl(t.net_revenue)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{brl(t.avg_ticket)}</td>
                <td className="px-4 py-3" />
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {data.platforms.some((p) => p.gross_revenue === 0 && p.orders > 0) && (
        <p className="flex items-start gap-2 text-xs text-slate-500">
          <Info size={14} className="mt-0.5 shrink-0" />
          Canal com pedidos e faturamento zerado significa que só o relatório operacional foi
          importado. O relatório de qualidade do iFood traz pedidos, nota e cancelamentos, mas não
          traz faturamento nem comissão — para isso é preciso o extrato financeiro da plataforma.
        </p>
      )}
    </div>
  );
}

function ChannelRow({ row }: { row: FinChannelRow }) {
  return (
    <tr className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
      <td className="px-4 py-2 font-medium">{label(row.platform)}</td>
      <td className="px-4 py-2 text-right tabular-nums">
        {row.orders}
        {row.cancelled_orders > 0 && (
          <span className="ml-1 text-xs text-rose-600" title="Pedidos cancelados">(-{row.cancelled_orders})</span>
        )}
      </td>
      <td className="px-4 py-2 text-right tabular-nums">{brl(row.gross_revenue)}</td>
      <td className="px-4 py-2 text-right tabular-nums">{brl(row.commission)}</td>
      <td className="px-4 py-2 text-right tabular-nums">{brl(row.offers_cost)}</td>
      <td className="px-4 py-2 text-right tabular-nums">{brl(row.payment_fee)}</td>
      <td className="px-4 py-2 text-right font-medium tabular-nums text-rose-700">{pct(row.take_rate)}</td>
      <td className="px-4 py-2 text-right tabular-nums text-emerald-700">{brl(row.net_revenue)}</td>
      <td className="px-4 py-2 text-right tabular-nums">{brl(row.avg_ticket)}</td>
      <td className="px-4 py-2 text-right tabular-nums">{row.rating ?? '—'}</td>
    </tr>
  );
}

function Mini({ label: l, value, hint, tone = 'default' }: {
  label: string; value: string; hint?: string; tone?: 'default' | 'good' | 'bad';
}) {
  const color = { default: 'text-slate-900', good: 'text-emerald-700', bad: 'text-rose-700' }[tone];
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{l}</p>
      <p className={`mt-1 text-xl font-semibold ${color}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </Card>
  );
}

function RangeBar({ from, to, today, setFrom, setTo }: {
  from: string; to: string; today: string;
  setFrom: (v: string) => void; setTo: (v: string) => void;
}) {
  const day = (n: number) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-sm">
        <span className="mb-1 block font-medium text-slate-600">De</span>
        <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)}
               className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </label>
      <label className="text-sm">
        <span className="mb-1 block font-medium text-slate-600">Até</span>
        <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)}
               className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </label>
      <div className="flex gap-1">
        {[{ l: '30 dias', d: 29 }, { l: '90 dias', d: 89 }, { l: '12 meses', d: 364 }].map((o) => (
          <button
            key={o.l}
            onClick={() => { setFrom(day(o.d)); setTo(today); }}
            className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            {o.l}
          </button>
        ))}
      </div>
    </div>
  );
}
