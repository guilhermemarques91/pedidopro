import { useQuery } from '@tanstack/react-query';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import { Coins, Percent, TrendingUp, Wallet } from 'lucide-react';
import { financeiroApi } from '../../services/resources';
import { apiError } from '../../services/api';
import { Card, Spinner, ErrorBox, Button } from '../../components/ui';
import { StatCard } from '../../components/StatCard';
import { brl, pct, monthLabel } from '../../utils/format';
import { WarningList, NoData } from './shared';

/** Variação relativa entre dois períodos, para o `delta` do StatCard (em %). */
const delta = (cur: number | null, prev: number | null | undefined): number | null => {
  if (cur === null || prev === null || prev === undefined || Math.abs(prev) < 0.005) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
};

export function Overview({ onNavigate, canImport }: { onNavigate: (t: 'importacoes') => void; canImport: boolean }) {
  const { data, isLoading, error } = useQuery({ queryKey: ['fin-overview'], queryFn: financeiroApi.overview });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox message={apiError(error)} />;
  if (!data) return null;

  if (data.empty || !data.current) {
    return (
      <div className="space-y-4">
        <NoData
          what="O módulo ainda não tem dados."
          hint="Importe as planilhas para liberar DRE, margens e análises."
        />
        <Card>
          <h3 className="text-sm font-semibold text-slate-700">Por onde começar</h3>
          <ol className="mt-2 list-inside list-decimal space-y-1 text-sm text-slate-600">
            <li><strong>Dashboard — DRE</strong> (AllFood): libera o DRE, o CMV mensal e o ponto de equilíbrio.</li>
            <li><strong>Ficha Técnica</strong> (AllFood): libera a margem por prato e a evolução de custo dos insumos.</li>
            <li><strong>Dados da loja</strong> (99Food) e <strong>Qualidade da operação</strong> (iFood): liberam a aba Canais.</li>
            <li><strong>Contas a pagar</strong> (AllFood): traz o detalhe das despesas por fornecedor.</li>
          </ol>
          {canImport && (
            <div className="mt-3">
              <Button onClick={() => onNavigate('importacoes')}>Ir para Importações</Button>
            </div>
          )}
        </Card>
      </div>
    );
  }

  const cur = data.current;
  const prev = data.previous;

  const series = data.series.map((s) => ({
    label: monthLabel(s.ref_month),
    receita: s.receita_liquida,
    custos: s.custos,
    resultado: s.resultado_liquido,
    margem: s.margem_liquida === null ? null : s.margem_liquida * 100,
  }));

  return (
    <div className="space-y-5">
      <WarningList warnings={data.warnings} />

      <p className="text-sm text-slate-500">
        Competência mais recente: <strong className="capitalize text-slate-700">{monthLabel(cur.ref_month)}</strong>
        {prev && <> · comparada com {monthLabel(prev.ref_month)}</>}
      </p>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon={Wallet}
          label="Receita líquida"
          value={brl(cur.receita_liquida)}
          tone="info"
          delta={delta(cur.receita_liquida, prev?.receita_liquida)}
        />
        <StatCard
          icon={Coins}
          label="CMV"
          value={brl(cur.cmv)}
          footer={<span>{pct(cur.cmv_pct)} da receita líquida</span>}
          tone={(cur.cmv_pct ?? 0) > 0.35 ? 'warn' : 'default'}
          delta={delta(cur.cmv, prev?.cmv)}
        />
        <StatCard
          icon={TrendingUp}
          label="Lucro bruto"
          value={brl(cur.lucro_bruto)}
          footer={<span>{pct(cur.margem_bruta)} de margem</span>}
          tone="success"
          delta={delta(cur.lucro_bruto, prev?.lucro_bruto)}
        />
        <StatCard
          icon={Percent}
          label="Resultado líquido"
          value={brl(cur.resultado_liquido)}
          footer={<span>{pct(cur.margem_liquida)} de margem</span>}
          tone={cur.resultado_liquido < 0 ? 'danger' : 'success'}
          delta={delta(cur.resultado_liquido, prev?.resultado_liquido)}
        />
      </div>

      <Card>
        <h3 className="mb-3 text-sm font-semibold text-slate-700">Evolução mensal</h3>
        {series.length < 2 ? (
          <p className="py-8 text-center text-sm text-slate-500">
            Só há uma competência importada. Importe outros meses do DRE para ver a evolução.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={series} margin={{ left: 0, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="l" tick={{ fontSize: 11 }} tickFormatter={(v: number) => (v / 1000).toFixed(0) + 'k'} />
              <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(v: number) => v.toFixed(0) + '%'} />
              <Tooltip formatter={(v: number, n) => (n === 'Margem líquida' ? [`${v.toFixed(1)}%`, n] : [brl(v), String(n)])} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="l" dataKey="receita" name="Receita líquida" fill="#cbd5e1" radius={[4, 4, 0, 0]} />
              <Bar yAxisId="l" dataKey="custos" name="Custos" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              <Bar yAxisId="l" dataKey="resultado" name="Resultado" fill="#059669" radius={[4, 4, 0, 0]} />
              <Line yAxisId="r" type="monotone" dataKey="margem" name="Margem líquida" stroke="#e11d48" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card className="p-0">
        <div className="border-b border-slate-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-700">Resumo por competência</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-sm">
            <thead className="border-b border-slate-200 text-left text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Competência</th>
                <th className="px-4 py-3 text-right font-medium">Receita bruta</th>
                <th className="px-4 py-3 text-right font-medium">Receita líquida</th>
                <th className="px-4 py-3 text-right font-medium">Custos</th>
                <th className="px-4 py-3 text-right font-medium">Lucro bruto</th>
                <th className="px-4 py-3 text-right font-medium">Resultado</th>
                <th className="px-4 py-3 text-right font-medium">Margem</th>
              </tr>
            </thead>
            <tbody>
              {[...data.series].reverse().map((s) => (
                <tr key={s.ref_month} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-2 capitalize">{monthLabel(s.ref_month)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{brl(s.receita_bruta)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{brl(s.receita_liquida)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{brl(s.custos)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-emerald-700">{brl(s.lucro_bruto)}</td>
                  <td className={`px-4 py-2 text-right font-medium tabular-nums ${s.resultado_liquido < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                    {brl(s.resultado_liquido)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{pct(s.margem_liquida)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
