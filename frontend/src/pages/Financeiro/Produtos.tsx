import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { AlertTriangle, Info } from 'lucide-react';
import { financeiroApi } from '../../services/resources';
import { apiError } from '../../services/api';
import { Card, Select, Spinner, ErrorBox } from '../../components/ui';
import type { FinProductRow } from '../../types';
import { brl, pct, date } from '../../utils/format';
import { ExportButton, exportCsv, NoData } from './shared';

type SortKey = 'margin_pct' | 'margin' | 'sale_price' | 'cost' | 'item_name';

/**
 * Margem por prato, a partir do snapshot da ficha técnica.
 *
 * O seletor de canal aplica o take-rate REAL da plataforma (calculado das
 * planilhas do 99Food/iFood) sobre o preço de venda. É o que revela o prato que
 * fecha bem no balcão e afunda no aplicativo.
 */
export function Produtos() {
  const [snapshot, setSnapshot] = useState('');
  const [channel, setChannel] = useState('balcao');
  const [sort, setSort] = useState<SortKey>('margin_pct');
  const [search, setSearch] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['fin-produtos', snapshot, channel],
    queryFn: () => financeiroApi.produtos({ snapshot: snapshot || undefined, channel }),
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox message={apiError(error)} />;
  if (!data) return null;
  if (data.empty || !data.items.length) {
    return (
      <NoData
        what="Nenhuma ficha técnica importada."
        hint="Suba o relatório “Ficha Técnica — Produtos” do AllFood na aba Importações."
      />
    );
  }

  const q = search.trim().toLowerCase();
  const rows = data.items
    .filter((i) => !q || i.item_name.toLowerCase().includes(q) || (i.classe ?? '').toLowerCase().includes(q))
    .slice()
    .sort((a, b) => {
      if (sort === 'item_name') return a.item_name.localeCompare(b.item_name);
      const av = (a[sort] ?? -Infinity) as number;
      const bv = (b[sort] ?? -Infinity) as number;
      return av - bv;
    });

  const chartData = [...data.worst].reverse().slice(0, 12).map((i) => ({
    name: i.item_name.length > 22 ? i.item_name.slice(0, 21) + '…' : i.item_name,
    margem: i.margin ?? 0,
  }));

  const exportar = () => exportCsv(
    `margem-produtos-${data.snapshot}-${data.channel}.csv`,
    ['Item', 'Classe', 'Un', 'Custo', 'Preço de venda', 'Preço líquido no canal', 'Margem R$', 'Margem %', 'Markup', 'Custo % do preço'],
    data.items.map((i) => [
      i.item_name, i.classe, i.unit, i.cost, i.sale_price, i.net_price, i.margin, i.margin_pct, i.markup, i.cost_pct,
    ]),
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="w-44 text-sm">
            <span className="mb-1 block font-medium text-slate-600">Ficha técnica de</span>
            <Select value={snapshot || data.snapshot || ''} onChange={(e) => setSnapshot(e.target.value)}>
              {data.snapshots.map((s) => <option key={s} value={s}>{date(s)}</option>)}
            </Select>
          </label>
          <label className="w-60 text-sm">
            <span className="mb-1 block font-medium text-slate-600">Vendendo por</span>
            <Select value={channel} onChange={(e) => setChannel(e.target.value)}>
              {data.channels.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}{c.take_rate > 0 ? ` — ${pct(c.take_rate)}` : ''}
                </option>
              ))}
            </Select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-600">Ordenar por</span>
            <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="margin_pct">Menor margem %</option>
              <option value="margin">Menor margem R$</option>
              <option value="cost">Menor custo</option>
              <option value="sale_price">Menor preço</option>
              <option value="item_name">Nome</option>
            </Select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-600">Buscar</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Item ou classe..."
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
        </div>
        <ExportButton onClick={exportar} />
      </div>

      {data.take_rate > 0 && (
        <p className="-mt-2 text-xs text-slate-500">
          Simulando {pct(data.take_rate)} de comissão — take-rate real calculado das planilhas da plataforma.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Mini
          label="Itens calculáveis"
          value={String(data.summary.priced)}
          hint={`de ${data.summary.items} na ficha`}
        />
        <Mini label="Margem média" value={pct(data.summary.avg_margin_pct)} />
        <Mini label="Margem mediana" value={pct(data.summary.median_margin_pct)} />
        <Mini
          label="Itens no prejuízo"
          value={String(data.summary.negative)}
          tone={data.summary.negative > 0 ? 'bad' : 'good'}
          hint={data.summary.negative > 0 ? 'custo maior que o preço líquido' : 'nenhum item negativo'}
        />
      </div>

      {data.summary.no_cost > 0 && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
          <p className="flex items-center gap-2 font-medium">
            <Info size={16} /> {data.summary.no_cost} item(ns) sem ficha técnica cadastrada
          </p>
          <p className="mt-1 text-xs">
            Esses itens vieram sem composição na planilha, então o custo está zerado e a margem
            não é calculável — eles ficam de fora das estatísticas em vez de aparecerem com 100%
            de margem. Cadastre a ficha no AllFood e reimporte para incluí-los.
          </p>
        </div>
      )}

      {data.negatives.length > 0 && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle size={16} /> {data.negatives.length} item(ns) dão prejuízo neste canal
          </p>
          <p className="mt-1 text-xs">
            {data.negatives.slice(0, 8).map((i) => `${i.item_name} (${brl(i.margin)})`).join(' · ')}
            {data.negatives.length > 8 && ` … e mais ${data.negatives.length - 8}.`}
          </p>
        </div>
      )}

      <Card>
        <h3 className="mb-3 text-sm font-semibold text-slate-700">12 menores margens (R$ por unidade)</h3>
        <ResponsiveContainer width="100%" height={Math.max(240, chartData.length * 28)}>
          <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 24 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v: number) => brl(v)} />
            <YAxis type="category" dataKey="name" width={170} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v: number) => [brl(v), 'Margem']} />
            <Bar dataKey="margem" radius={[0, 4, 4, 0]}>
              {chartData.map((d, i) => (
                <Cell key={i} fill={d.margem < 0 ? '#e11d48' : d.margem < 5 ? '#f59e0b' : '#059669'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card className="p-0">
        <div className="border-b border-slate-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-700">Margem por item ({rows.length})</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[50rem] text-sm">
            <thead className="border-b border-slate-200 text-left text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Item</th>
                <th className="px-4 py-3 font-medium">Classe</th>
                <th className="px-4 py-3 text-right font-medium">Custo</th>
                <th className="px-4 py-3 text-right font-medium">Preço</th>
                {data.take_rate > 0 && <th className="px-4 py-3 text-right font-medium">Líquido</th>}
                <th className="px-4 py-3 text-right font-medium">Margem</th>
                <th className="px-4 py-3 text-right font-medium">Margem %</th>
                <th className="px-4 py-3 text-right font-medium">Markup</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => <ProductRow key={i.item_name} item={i} showNet={data.take_rate > 0} />)}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="flex items-start gap-2 text-xs text-slate-500">
        <Info size={14} className="mt-0.5 shrink-0" />
        {data.note}
      </p>
    </div>
  );
}

function ProductRow({ item, showNet }: { item: FinProductRow; showNet: boolean }) {
  const negative = (item.margin ?? 0) < 0 && item.margin !== null;
  return (
    <tr className={`border-b border-slate-100 last:border-0 hover:bg-slate-50 ${negative ? 'bg-rose-50/60' : ''} ${!item.has_cost ? 'opacity-60' : ''}`}>
      <td className="px-4 py-2 font-medium">
        {item.item_name}
        {!item.has_cost && (
          <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
            sem ficha
          </span>
        )}
      </td>
      <td className="px-4 py-2 text-xs text-slate-500">{item.classe ?? '—'}</td>
      <td className="px-4 py-2 text-right tabular-nums">{item.has_cost ? brl(item.cost) : '—'}</td>
      <td className="px-4 py-2 text-right tabular-nums">{brl(item.sale_price)}</td>
      {showNet && <td className="px-4 py-2 text-right tabular-nums text-slate-500">{brl(item.net_price)}</td>}
      <td className={`px-4 py-2 text-right font-medium tabular-nums ${negative ? 'text-rose-700' : 'text-emerald-700'}`}>
        {brl(item.margin)}
      </td>
      <td className={`px-4 py-2 text-right tabular-nums ${negative ? 'text-rose-700' : ''}`}>{pct(item.margin_pct)}</td>
      <td className="px-4 py-2 text-right text-xs text-slate-500 tabular-nums">
        {item.markup === null ? '—' : `${item.markup.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}x`}
      </td>
    </tr>
  );
}

function Mini({ label, value, hint, tone = 'default' }: {
  label: string; value: string; hint?: string; tone?: 'default' | 'good' | 'bad';
}) {
  const color = { default: 'text-slate-900', good: 'text-emerald-700', bad: 'text-rose-700' }[tone];
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${color}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </Card>
  );
}
