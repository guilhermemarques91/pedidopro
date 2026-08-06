import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ComposedChart, Bar, Line, LineChart, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { financeiroApi } from '../../services/resources';
import { apiError } from '../../services/api';
import { Card, Select, Spinner, ErrorBox } from '../../components/ui';
import { brl, pct, date, monthLabel } from '../../utils/format';
import { ExportButton, exportCsv, NoData } from './shared';

/**
 * CMV mês a mês e evolução do custo dos insumos.
 *
 * A curva de custo sai da comparação entre snapshots da ficha técnica: cada
 * importação guarda o custo médio unitário de cada insumo naquela data, então
 * duas importações já mostram para onde o custo andou.
 */
export function Cmv() {
  const [component, setComponent] = useState('');

  const { data, isLoading, error } = useQuery({ queryKey: ['fin-cmv'], queryFn: financeiroApi.cmv });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox message={apiError(error)} />;
  if (!data) return null;

  const hasSeries = data.series.length > 0;
  const names = Object.keys(data.components).sort();
  const selected = component || data.movers[0]?.component_name || names[0] || '';
  const points = (data.components[selected] ?? []).map((p) => ({
    label: date(p.snapshot_date),
    custo: p.unit_cost,
  }));

  const series = data.series.map((s) => ({
    label: monthLabel(s.ref_month),
    receita: s.receita_liquida,
    cmv: s.cmv,
    cmvPct: s.cmv_pct === null ? null : s.cmv_pct * 100,
  }));

  const exportar = () => exportCsv(
    'cmv-evolucao.csv',
    ['Insumo', 'De', 'Até', 'Custo inicial', 'Custo final', 'Variação R$', 'Variação %', 'Snapshots'],
    data.movers.map((m) => [
      m.component_name, m.from_date, m.to_date, m.from_cost, m.to_cost, m.delta, m.delta_pct, m.points,
    ]),
  );

  return (
    <div className="space-y-5">
      {!hasSeries && !names.length && (
        <NoData
          what="Sem dados de custo ainda."
          hint="Importe o DRE (para o CMV mensal) e a ficha técnica (para a evolução do custo dos insumos)."
        />
      )}

      {hasSeries && (
        <Card>
          <h3 className="mb-3 text-sm font-semibold text-slate-700">CMV e receita por competência</h3>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={series} margin={{ left: 0, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="l" tick={{ fontSize: 11 }} tickFormatter={(v: number) => (v / 1000).toFixed(0) + 'k'} />
              <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(v: number) => v.toFixed(0) + '%'} />
              <Tooltip formatter={(v: number, n) => (n === 'CMV %' ? [`${v.toFixed(1)}%`, n] : [brl(v), String(n)])} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="l" dataKey="receita" name="Receita líquida" fill="#cbd5e1" radius={[4, 4, 0, 0]} />
              <Bar yAxisId="l" dataKey="cmv" name="CMV" fill="#059669" radius={[4, 4, 0, 0]} />
              <Line yAxisId="r" type="monotone" dataKey="cmvPct" name="CMV %" stroke="#e11d48" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
      )}

      {names.length > 0 && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-700">Evolução do custo do insumo</h3>
              <div className="w-56">
                <Select value={selected} onChange={(e) => setComponent(e.target.value)}>
                  {names.map((n) => <option key={n} value={n}>{n}</option>)}
                </Select>
              </div>
            </div>
            {points.length < 2 ? (
              <p className="py-8 text-center text-sm text-slate-500">
                Só há um snapshot deste insumo. Importe outra ficha técnica de data diferente
                para ver a variação.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={points} margin={{ left: 0, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => brl(v)} width={80} />
                  <Tooltip formatter={(v: number) => [brl(v), 'Custo unitário']} />
                  <Line type="monotone" dataKey="custo" stroke="#059669" strokeWidth={2} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </Card>

          <Card className="p-0">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-700">Maiores variações de custo</h3>
              <ExportButton onClick={exportar} />
            </div>
            {!data.movers.length ? (
              <p className="p-6 text-center text-sm text-slate-500">
                É preciso ao menos duas fichas técnicas de datas diferentes para comparar custos.
              </p>
            ) : (
              <div className="max-h-[19rem] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 border-b border-slate-200 bg-white text-left text-slate-500">
                    <tr>
                      <th className="px-4 py-2 font-medium">Insumo</th>
                      <th className="px-4 py-2 text-right font-medium">De</th>
                      <th className="px-4 py-2 text-right font-medium">Para</th>
                      <th className="px-4 py-2 text-right font-medium">Variação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.movers.map((m) => {
                      const up = m.delta_pct >= 0;
                      const Icon = up ? TrendingUp : TrendingDown;
                      return (
                        <tr
                          key={m.component_name}
                          onClick={() => setComponent(m.component_name)}
                          className={`cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50 ${
                            selected === m.component_name ? 'bg-emerald-50' : ''
                          }`}
                        >
                          <td className="px-4 py-2">{m.component_name}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-slate-500">{brl(m.from_cost)}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{brl(m.to_cost)}</td>
                          <td className={`px-4 py-2 text-right font-medium tabular-nums ${up ? 'text-rose-600' : 'text-emerald-600'}`}>
                            <span className="inline-flex items-center gap-1">
                              <Icon size={12} /> {pct(Math.abs(m.delta_pct))}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {hasSeries && (
        <Card className="p-0">
          <div className="border-b border-slate-200 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-700">CMV por competência</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[38rem] text-sm">
              <thead className="border-b border-slate-200 text-left text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Competência</th>
                  <th className="px-4 py-3 text-right font-medium">Receita líquida</th>
                  <th className="px-4 py-3 text-right font-medium">CMV</th>
                  <th className="px-4 py-3 text-right font-medium">CMV %</th>
                  <th className="px-4 py-3 text-right font-medium">Lucro bruto</th>
                  <th className="px-4 py-3 text-right font-medium">Margem bruta</th>
                </tr>
              </thead>
              <tbody>
                {data.series.map((s) => (
                  <tr key={s.ref_month} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-4 py-2 capitalize">{monthLabel(s.ref_month)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{brl(s.receita_liquida)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{brl(s.cmv)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{pct(s.cmv_pct)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-emerald-700">{brl(s.lucro_bruto)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{pct(s.margem_bruta)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
