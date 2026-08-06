import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';
import { AlertTriangle, Target } from 'lucide-react';
import { financeiroApi } from '../../services/resources';
import { apiError } from '../../services/api';
import { Card, Spinner, ErrorBox } from '../../components/ui';
import { brl, pct, monthLabel } from '../../utils/format';
import { WarningList, MonthSelect, NoData, Stat } from './shared';

/**
 * Ponto de equilíbrio: quanto a operação precisa faturar para pagar o custo fixo.
 *
 *   margem de contribuição = receita líquida − custos variáveis
 *   ponto de equilíbrio    = custo fixo ÷ margem de contribuição %
 *
 * A separação fixo/variável vem da classificação do plano de contas
 * (Configurações), então o número acompanha o julgamento do usuário.
 */
export function Breakeven() {
  const [month, setMonth] = useState('');

  const monthsQ = useQuery({ queryKey: ['fin-months'], queryFn: financeiroApi.months });
  const months = monthsQ.data?.map((m) => m.ref_month) ?? [];

  const { data, isLoading, error } = useQuery({
    queryKey: ['fin-breakeven', month],
    queryFn: () => financeiroApi.breakeven({ month: month || undefined }),
    enabled: monthsQ.isSuccess && months.length > 0,
  });

  if (monthsQ.isLoading) return <Spinner />;
  if (monthsQ.isSuccess && !months.length) {
    return <NoData what="Nenhum DRE importado ainda." hint="O ponto de equilíbrio é calculado a partir do DRE mensal do AllFood." />;
  }
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox message={apiError(error)} />;
  if (!data || data.empty) return null;

  const be = data.ponto_equilibrio;
  const atingiu = data.atingiu === true;

  const chart = [
    { name: 'Receita líquida', valor: data.receita_liquida, tipo: 'receita' },
    { name: 'Custo variável', valor: data.custo_variavel, tipo: 'custo' },
    { name: 'Margem contrib.', valor: data.margem_contribuicao, tipo: 'mc' },
    { name: 'Custo fixo', valor: data.custo_fixo, tipo: 'custo' },
    { name: 'Resultado', valor: data.resultado_liquido, tipo: 'resultado' },
  ];
  const color = (t: string, v: number) =>
    t === 'receita' ? '#0f766e'
      : t === 'custo' ? '#e11d48'
        : t === 'mc' ? '#059669'
          : v >= 0 ? '#059669' : '#e11d48';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <MonthSelect label="Competência" value={month || data.month || ''} months={months} onChange={setMonth} />
      </div>

      <WarningList warnings={data.warnings} />

      {data.nao_classificado_alerta && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle size={16} /> {brl(data.custo_nao_classificado)} em contas sem classificação fixo/variável
          </p>
          <p className="mt-1 text-xs">
            Esse valor fica de fora do cálculo. Classifique as contas em Configurações para o ponto
            de equilíbrio ficar preciso.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Custo fixo do mês" value={brl(data.custo_fixo)} hint="existe mesmo sem vender" />
        <Stat
          label="Margem de contribuição"
          value={pct(data.margem_contribuicao_pct)}
          hint={`${brl(data.margem_contribuicao)} de sobra`}
          tone="good"
        />
        <Stat
          label="Ponto de equilíbrio"
          value={be === null ? '—' : brl(be)}
          hint={data.dias_para_equilibrio ? `${data.dias_para_equilibrio} dias de venda média` : undefined}
          tone={atingiu ? 'good' : 'bad'}
        />
        <Stat
          label={atingiu ? 'Margem de segurança' : 'Faltou faturar'}
          value={data.margem_seguranca === null ? '—' : brl(Math.abs(data.margem_seguranca))}
          hint={data.margem_seguranca_pct !== null ? pct(Math.abs(data.margem_seguranca_pct)) + ' da receita' : undefined}
          tone={atingiu ? 'good' : 'bad'}
        />
      </div>

      <Card className={atingiu ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'}>
        <p className={`flex items-center gap-2 text-sm font-medium ${atingiu ? 'text-emerald-900' : 'text-rose-900'}`}>
          <Target size={18} />
          {be === null ? (
            'Não foi possível calcular o ponto de equilíbrio: a margem de contribuição do mês não é positiva.'
          ) : atingiu ? (
            <>
              Em {monthLabel(data.month!)} a operação passou do equilíbrio. Faturou {brl(data.receita_liquida)}{' '}
              contra os {brl(be)} necessários — uma folga de {brl(data.margem_seguranca)}.
            </>
          ) : (
            <>
              Em {monthLabel(data.month!)} a operação ficou abaixo do equilíbrio. Faturou{' '}
              {brl(data.receita_liquida)} e precisaria de {brl(be)} — faltaram{' '}
              {brl(Math.abs(data.margem_seguranca ?? 0))}.
            </>
          )}
        </p>
        {be !== null && (
          <p className={`mt-1 text-xs ${atingiu ? 'text-emerald-800' : 'text-rose-800'}`}>
            Cada real vendido deixa {pct(data.margem_contribuicao_pct)} para pagar o custo fixo de{' '}
            {brl(data.custo_fixo)}. Média diária no mês: {brl(data.receita_media_diaria)}.
          </p>
        )}
      </Card>

      <Card>
        <h3 className="mb-3 text-sm font-semibold text-slate-700">
          Estrutura do mês — a linha marca o ponto de equilíbrio
        </h3>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={chart} margin={{ left: 0, right: 16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => (v / 1000).toFixed(0) + 'k'} />
            <Tooltip formatter={(v: number) => [brl(v), 'Valor']} cursor={{ fill: '#f1f5f9' }} />
            {be !== null && (
              <ReferenceLine
                y={be}
                stroke="#0284c7"
                strokeDasharray="5 4"
                label={{ value: `Equilíbrio ${brl(be)}`, position: 'insideTopRight', fontSize: 11, fill: '#0284c7' }}
              />
            )}
            <Bar dataKey="valor" radius={[4, 4, 0, 0]}>
              {chart.map((d, i) => <Cell key={i} fill={color(d.tipo, d.valor)} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card className="p-0">
        <div className="border-b border-slate-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-700">Memória de cálculo</h3>
        </div>
        <table className="w-full text-sm">
          <tbody>
            <Row label="Receita líquida" value={brl(data.receita_liquida)} />
            <Row label="(−) Custos variáveis (CMV, comissões, taxas, deduções)" value={brl(data.custo_variavel)} />
            <Row label="(=) Margem de contribuição" value={`${brl(data.margem_contribuicao)} · ${pct(data.margem_contribuicao_pct)}`} strong />
            <Row label="(−) Custos fixos (administrativas e indiretos)" value={brl(data.custo_fixo)} />
            <Row label="(=) Resultado do mês" value={brl(data.resultado_liquido)} strong />
            <Row label="Ponto de equilíbrio = custo fixo ÷ margem de contribuição %" value={be === null ? '—' : brl(be)} strong />
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <tr className={`border-b border-slate-100 last:border-0 ${strong ? 'bg-slate-50 font-semibold' : ''}`}>
      <td className="px-4 py-2">{label}</td>
      <td className="px-4 py-2 text-right tabular-nums">{value}</td>
    </tr>
  );
}
