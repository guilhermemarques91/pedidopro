import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { EyeOff, TrendingDown, TrendingUp } from 'lucide-react';
import { financeiroApi } from '../../services/resources';
import { apiError } from '../../services/api';
import { Card, Spinner, ErrorBox } from '../../components/ui';
import type { FinDreLine, FinDreTotals, FinPlatformMode, FinPlatformTotals } from '../../types';
import { brl, pct, monthLabel } from '../../utils/format';
import { WarningList, MonthSelect, ExportButton, exportCsv, NoData } from './shared';

/**
 * Linhas do demonstrativo montadas a partir dos totais recalculados.
 *
 * A receita aparece quebrada em duas origens porque elas vêm de arquivos
 * diferentes: o balcão do DRE do AllFood e o delivery das planilhas das
 * plataformas (que o AllFood não registra como venda).
 */
const STATEMENT: { key: keyof FinDreTotals; label: string; sign: '+' | '-' | '='; strong?: boolean; sub?: boolean }[] = [
  { key: 'receita_dre', label: 'Balcão e comanda (DRE)', sign: '+', sub: true },
  { key: 'receita_plataformas', label: 'iFood e 99Food (planilhas)', sign: '+', sub: true },
  { key: 'receita_bruta', label: 'Receita bruta de vendas', sign: '=', strong: true },
  { key: 'deducoes', label: 'Deduções da receita', sign: '-' },
  { key: 'receita_liquida', label: 'Receita líquida', sign: '=', strong: true },
  { key: 'custos_dre', label: 'Custos do DRE (CMV + indiretos)', sign: '-', sub: true },
  { key: 'custo_plataformas', label: 'Comissão, ofertas e taxas das plataformas', sign: '-', sub: true },
  { key: 'custos', label: 'Custos totais', sign: '=' },
  { key: 'lucro_bruto', label: 'Lucro bruto', sign: '=', strong: true },
  { key: 'desp_comercial', label: 'Despesas comerciais', sign: '-' },
  { key: 'desp_financeira', label: 'Despesas financeiras', sign: '-' },
  { key: 'rec_financeira', label: 'Receitas financeiras', sign: '+' },
  { key: 'desp_admin', label: 'Despesas administrativas', sign: '-' },
  { key: 'outras_desp_op', label: 'Outras despesas operacionais', sign: '-' },
  { key: 'outras_rec_op', label: 'Outras receitas operacionais', sign: '+' },
  { key: 'lucro_operacional', label: 'Lucro operacional', sign: '=', strong: true },
  { key: 'desp_nao_op', label: 'Despesas não operacionais', sign: '-' },
  { key: 'rec_nao_op', label: 'Receitas não operacionais', sign: '+' },
  { key: 'imposto', label: 'Provisões e tributos', sign: '-' },
  { key: 'resultado_liquido', label: 'Resultado líquido', sign: '=', strong: true },
];

export function Dre() {
  const [month, setMonth] = useState('');
  const [compare, setCompare] = useState('');
  const [mode, setMode] = useState<'gerencial' | 'original'>('gerencial');
  const [showAll, setShowAll] = useState(false);

  const monthsQ = useQuery({ queryKey: ['fin-months'], queryFn: financeiroApi.months });
  const months = monthsQ.data?.map((m) => m.ref_month) ?? [];

  const { data, isLoading, error } = useQuery({
    queryKey: ['fin-dre', month, compare, mode],
    queryFn: () => financeiroApi.dre({
      month: month || undefined,
      compare: compare || undefined,
      mode,
    }),
    enabled: monthsQ.isSuccess && months.length > 0,
  });

  if (monthsQ.isLoading) return <Spinner />;
  if (monthsQ.isSuccess && !months.length) {
    return <NoData what="Nenhum DRE importado ainda." hint="Suba o relatório “Dashboard — DRE” do AllFood na aba Importações." />;
  }
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox message={apiError(error)} />;
  if (!data) return null;

  const t = data.totals;
  const prev = data.compare_totals;
  const visible = showAll ? data.lines : data.lines.filter((l) => l.level <= 2);

  const exportar = () => exportCsv(
    `dre-${data.month}-${data.mode}.csv`,
    ['Conta', 'Descrição', 'Nível', 'Sinal', 'Valor', '% venda bruta', 'Grupo', 'Entra no DRE', 'Mês anterior', 'Variação %'],
    data.lines.map((l) => [
      l.code.startsWith('@') ? '' : l.code, l.name, l.level, l.sign ?? '',
      l.amount, l.pct_gross, l.group_label, l.include_in_dre ? 'sim' : 'não',
      l.compare_amount, l.delta_pct,
    ]),
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <MonthSelect label="Competência" value={month || data.month} months={months} onChange={setMonth} />
        <MonthSelect
          label="Comparar com"
          value={compare || data.compare || ''}
          months={months.filter((m) => m !== (month || data.month))}
          onChange={setCompare}
          allowEmpty="Sem comparação"
        />
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-600">Modo</span>
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
            {(['gerencial', 'original'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition ${
                  mode === m ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </label>
        <ExportButton onClick={exportar} />
      </div>

      <p className="-mt-2 text-xs text-slate-500">
        {mode === 'gerencial'
          ? 'Modo gerencial: as contas marcadas como fora do DRE em Configurações são abatidas do resultado.'
          : 'Modo original: reproduz exatamente o que veio da planilha do AllFood, para conferência.'}
      </p>

      <WarningList warnings={data.warnings} />

      <RevenueSources totals={t} platform={data.platform} mode={data.platform_mode} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Receita líquida" value={brl(t.receita_liquida)} prev={prev?.receita_liquida} current={t.receita_liquida} />
        <Kpi label="CMV" value={brl(t.cmv)} hint={pct(t.cmv_pct) + ' da receita líquida'} prev={prev?.cmv} current={t.cmv} invert />
        <Kpi label="Lucro bruto" value={brl(t.lucro_bruto)} hint={pct(t.margem_bruta) + ' de margem'} prev={prev?.lucro_bruto} current={t.lucro_bruto} />
        <Kpi
          label="Resultado líquido"
          value={brl(t.resultado_liquido)}
          hint={pct(t.margem_liquida) + ' de margem'}
          prev={prev?.resultado_liquido}
          current={t.resultado_liquido}
        />
      </div>

      <Waterfall totals={t} />

      <Card className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-700">
            Demonstrativo — {monthLabel(data.month)}
            {data.compare && <span className="font-normal text-slate-500"> vs. {monthLabel(data.compare)}</span>}
          </h3>
        </div>
        <table className="w-full min-w-[40rem] text-sm">
          <tbody>
            {STATEMENT.map((row) => {
              const value = t[row.key] as number;
              const before = prev ? (prev[row.key] as number) : null;
              const delta = before !== null && Math.abs(before) > 0.005 ? (value - before) / Math.abs(before) : null;
              return (
                <tr key={row.key} className={`border-b border-slate-100 last:border-0 ${row.strong ? 'bg-slate-50 font-semibold' : ''}`}>
                  <td className="w-10 px-4 py-2 text-center text-slate-400">{row.sign}</td>
                  <td className={`px-2 py-2 ${row.sub ? 'pl-6 text-slate-600' : ''}`}>{row.label}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{brl(value)}</td>
                  <td className="w-24 px-4 py-2 text-right text-xs text-slate-500 tabular-nums">
                    {t.receita_bruta > 0 ? pct(value / t.receita_bruta) : '—'}
                  </td>
                  <td className="w-28 px-4 py-2 text-right text-xs tabular-nums">
                    {delta === null ? <span className="text-slate-400">—</span> : <Delta value={delta} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Card className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-700">Plano de contas do mês</h3>
          <button
            onClick={() => setShowAll((v) => !v)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            {showAll ? 'Mostrar só os níveis principais' : 'Mostrar todas as contas'}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] text-sm">
            <thead className="border-b border-slate-200 text-left text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Conta</th>
                <th className="px-4 py-3 text-right font-medium">Valor</th>
                <th className="px-4 py-3 text-right font-medium">% venda bruta</th>
                <th className="px-4 py-3 text-right font-medium">Mês anterior</th>
                <th className="px-4 py-3 text-right font-medium">Variação</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((l) => <AccountRow key={l.code} line={l} managerial={data.mode === 'gerencial'} />)}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/**
 * De onde vem a receita do mês e como ela se compara ao dinheiro que entrou.
 *
 * As duas colunas medem coisas diferentes de propósito: a receita é do mês da
 * VENDA (competência) e o recebimento é do mês em que o repasse caiu (caixa).
 * O repasse das plataformas atrasa semanas, então a diferença é normal — o que
 * importa é ela não crescer sem explicação mês a mês.
 */
function RevenueSources({
  totals, platform, mode,
}: {
  totals: FinDreTotals;
  platform: FinPlatformTotals;
  mode: FinPlatformMode;
}) {
  const gap = totals.recebimentos - totals.receita_bruta;
  return (
    <Card>
      <h3 className="mb-3 text-sm font-semibold text-slate-700">Composição da receita</h3>
      <div className="grid gap-4 sm:grid-cols-3">
        <Source
          label="Balcão e comanda"
          value={totals.receita_dre}
          total={totals.receita_bruta}
          hint="conta 3.01.01 do DRE"
        />
        <Source
          label="iFood e 99Food"
          value={totals.receita_plataformas}
          total={totals.receita_bruta}
          hint={
            mode === 'planilhas'
              ? `${platform.orders} pedidos · ${platform.platforms} plataforma(s)`
              : mode === 'recebimentos'
                ? 'conta de recebimentos do DRE (caixa)'
                : 'desligado nas Configurações'
          }
        />
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Repasses recebidos no mês</p>
          <p className="mt-1 text-lg font-semibold text-slate-700">{brl(totals.recebimentos)}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {gap >= 0 ? 'Entrou ' : 'Faltou entrar '}
            <strong>{brl(Math.abs(gap))}</strong> em relação ao vendido — diferença de prazo de repasse.
          </p>
        </div>
      </div>
      {mode === 'planilhas' && totals.custo_plataformas > 0 && (
        <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
          Do faturamento de plataforma, {brl(totals.custo_plataformas)} ficam com elas
          (comissão, ofertas e taxa de pagamento) e entram como custo acima.
        </p>
      )}
    </Card>
  );
}

function Source({ label, value, total, hint }: { label: string; value: number; total: number; hint: string }) {
  const share = total > 0 ? value / total : 0;
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-900">{brl(value)}</p>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(share * 100, 100)}%` }} />
      </div>
      <p className="mt-1 text-xs text-slate-500">{pct(share)} da receita · {hint}</p>
    </div>
  );
}

function AccountRow({ line, managerial }: { line: FinDreLine; managerial: boolean }) {
  const excluded = managerial && !line.include_in_dre;
  const isSubtotal = line.line_type === 'subtotal';
  return (
    <tr className={`border-b border-slate-100 last:border-0 hover:bg-slate-50 ${isSubtotal ? 'bg-slate-50 font-semibold' : ''} ${excluded ? 'opacity-45' : ''}`}>
      <td className="px-4 py-2">
        <span style={{ paddingLeft: `${(line.level - 1) * 1.25}rem` }} className="inline-flex items-center gap-2">
          {line.sign && <span className="text-slate-400">{line.sign}</span>}
          <span>
            {!isSubtotal && <span className="mr-2 text-xs text-slate-400 tabular-nums">{line.code}</span>}
            {line.name}
          </span>
          {excluded && (
            <span
              className="inline-flex items-center gap-1 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-600"
              title="Conta excluída do DRE gerencial em Configurações — o valor foi abatido do resultado."
            >
              <EyeOff size={11} /> fora do DRE
            </span>
          )}
        </span>
      </td>
      <td className="px-4 py-2 text-right tabular-nums">{brl(line.amount)}</td>
      <td className="px-4 py-2 text-right text-xs text-slate-500 tabular-nums">{pct(line.pct_gross)}</td>
      <td className="px-4 py-2 text-right text-xs text-slate-500 tabular-nums">
        {line.compare_amount === null ? '—' : brl(line.compare_amount)}
      </td>
      <td className="px-4 py-2 text-right text-xs tabular-nums">
        {line.delta_pct === null ? <span className="text-slate-400">—</span> : <Delta value={line.delta_pct} />}
      </td>
    </tr>
  );
}

/** Variação vs. o mês de comparação. Subir não é sempre bom — só colore a direção. */
function Delta({ value }: { value: number }) {
  const up = value >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 ${up ? 'text-emerald-600' : 'text-rose-600'}`}>
      <Icon size={12} /> {pct(Math.abs(value))}
    </span>
  );
}

function Kpi({
  label, value, hint, prev, current, invert,
}: {
  label: string; value: string; hint?: string;
  prev?: number | null; current: number; invert?: boolean;
}) {
  const delta = prev !== null && prev !== undefined && Math.abs(prev) > 0.005
    ? (current - prev) / Math.abs(prev)
    : null;
  // Em CMV/custo, cair é bom — o `invert` troca a cor sem trocar a seta.
  const good = delta === null ? null : (invert ? delta < 0 : delta > 0);
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      {delta !== null && (
        <p className={`mt-1 text-xs font-medium ${good ? 'text-emerald-600' : 'text-rose-600'}`}>
          {delta >= 0 ? '▲' : '▼'} {pct(Math.abs(delta))} vs. mês anterior
        </p>
      )}
    </Card>
  );
}

/**
 * Cascata do resultado: mostra de onde a receita sai e onde ela some. Cada barra
 * flutua sobre a anterior (a base é uma barra transparente empilhada).
 */
function Waterfall({ totals }: { totals: FinDreTotals }) {
  const steps: { label: string; value: number }[] = [
    { label: 'Receita líq.', value: totals.receita_liquida },
    { label: 'Custos', value: -totals.custos },
    { label: 'Desp. fin.', value: -totals.desp_financeira },
    { label: 'Rec. fin.', value: totals.rec_financeira },
    { label: 'Desp. admin', value: -totals.desp_admin },
    { label: 'Outras', value: totals.outras_rec_op - totals.outras_desp_op - totals.desp_comercial },
    { label: 'Não oper.', value: totals.rec_nao_op - totals.desp_nao_op },
    { label: 'Tributos', value: -totals.imposto },
  ];

  let running = 0;
  const data = steps.map((s) => {
    const base = s.value >= 0 ? running : running + s.value;
    running += s.value;
    return { label: s.label, base, delta: Math.abs(s.value), value: s.value };
  });
  data.push({ label: 'Resultado', base: 0, delta: Math.abs(running), value: running });

  return (
    <Card>
      <h3 className="mb-3 text-sm font-semibold text-slate-700">Como a receita vira resultado</h3>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ left: 0, right: 16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => (v / 1000).toFixed(0) + 'k'} />
          <Tooltip
            cursor={{ fill: '#f1f5f9' }}
            formatter={(_v, _n, item) => [brl((item?.payload as { value: number })?.value), 'Efeito']}
          />
          <Bar dataKey="base" stackId="a" fill="transparent" isAnimationActive={false} />
          <Bar dataKey="delta" stackId="a" radius={[4, 4, 0, 0]}>
            {data.map((d, i) => (
              <Cell
                key={i}
                fill={i === data.length - 1 ? '#0f766e' : d.value >= 0 ? '#059669' : '#e11d48'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}
