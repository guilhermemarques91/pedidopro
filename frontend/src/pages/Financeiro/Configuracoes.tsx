import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Info, Save, Search } from 'lucide-react';
import { financeiroApi } from '../../services/resources';
import { apiError } from '../../services/api';
import { Button, Card, Input, Select, Spinner, ErrorBox, EmptyState } from '../../components/ui';
import type { FinAccount, FinCostBehavior, FinSettings } from '../../types';
import { NoData } from './shared';

/**
 * Classificação do plano de contas — é o que transforma a planilha crua em
 * análise:
 *   - Grupo do DRE: em qual linha do demonstrativo a conta entra.
 *   - Fixo/variável: separa o que varia com a venda (CMV, comissão, taxa de
 *     cartão) do que existe mesmo sem vender (aluguel, folha) — base do ponto
 *     de equilíbrio.
 *   - Entra no DRE: desmarcar tira a conta do DRE GERENCIAL sem apagar o dado
 *     importado. É a saída para contas de trânsito lançadas como receita.
 *
 * Ao salvar, a conta deixa de ser classificada automaticamente e nenhuma
 * reimportação sobrescreve a escolha.
 */
export function Configuracoes() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [onlyManual, setOnlyManual] = useState(false);
  const [edits, setEdits] = useState<Record<string, Partial<FinAccount>>>({});
  const [saved, setSaved] = useState('');

  const accountsQ = useQuery({ queryKey: ['fin-accounts'], queryFn: () => financeiroApi.accounts() });
  const settingsQ = useQuery({ queryKey: ['fin-settings'], queryFn: financeiroApi.settings });

  const [form, setForm] = useState<FinSettings | null>(null);
  useEffect(() => { if (settingsQ.data) setForm(settingsQ.data); }, [settingsQ.data]);

  const saveAccounts = useMutation({
    mutationFn: () => financeiroApi.saveAccounts(
      Object.entries(edits).map(([code, patch]) => ({ code, ...patch })),
    ),
    onSuccess: (r) => {
      setEdits({});
      setSaved(`${r.updated} conta(s) atualizada(s).`);
      ['fin-accounts', 'fin-dre', 'fin-breakeven', 'fin-cmv', 'fin-overview']
        .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
  });

  const saveSettings = useMutation({
    mutationFn: () => financeiroApi.saveSettings(form!),
    onSuccess: () => {
      setSaved('Configurações salvas.');
      ['fin-settings', 'fin-produtos'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
  });

  const accounts = accountsQ.data?.accounts ?? [];
  const groups = accountsQ.data?.groups ?? {};

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return accounts.filter((a) => {
      if (onlyManual && a.auto_group) return false;
      if (!q) return true;
      return a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q);
    });
  }, [accounts, search, onlyManual]);

  const value = <K extends keyof FinAccount>(a: FinAccount, key: K): FinAccount[K] =>
    (edits[a.code]?.[key] ?? a[key]) as FinAccount[K];

  const patch = (code: string, p: Partial<FinAccount>) => {
    setEdits((prev) => ({ ...prev, [code]: { ...prev[code], ...p } }));
    setSaved('');
  };

  if (accountsQ.isLoading || settingsQ.isLoading) return <Spinner />;
  if (accountsQ.error) return <ErrorBox message={apiError(accountsQ.error)} />;

  return (
    <div className="space-y-5">
      {form && (
        <Card>
          <h3 className="text-sm font-semibold text-slate-700">Receita das plataformas</h3>
          <p className="mt-1 text-sm text-slate-500">
            O AllFood registra só balcão e comanda. Escolha de onde vem o faturamento de iFood e 99Food.
          </p>
          <div className="mt-3 space-y-2">
            {([
              {
                key: 'planilhas' as const,
                title: 'Das planilhas das plataformas (recomendado)',
                desc: 'Soma o faturamento pela DATA DA VENDA, como as plataformas reportam. '
                  + 'Respeita a competência do mês e traz junto comissão, ofertas e taxas como custo.',
              },
              {
                key: 'recebimentos' as const,
                title: 'Da conta de recebimentos do DRE',
                desc: 'Usa o que caiu em caixa no mês (conta 3.02). Casa com o extrato bancário, '
                  + 'mas joga a venda de junho no mês em que o repasse chegou. O valor já vem líquido de comissão.',
              },
              {
                key: 'off' as const,
                title: 'Não somar',
                desc: 'Só o que o DRE registra como venda. Use se o AllFood já receber os pedidos das plataformas.',
              },
            ]).map((opt) => (
              <label
                key={opt.key}
                className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition ${
                  form.platform_revenue_mode === opt.key
                    ? 'border-emerald-400 bg-emerald-50'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <input
                  type="radio"
                  name="platform_revenue_mode"
                  className="mt-1"
                  checked={form.platform_revenue_mode === opt.key}
                  onChange={() => setForm({ ...form, platform_revenue_mode: opt.key })}
                />
                <span>
                  <span className="block text-sm font-medium text-slate-800">{opt.title}</span>
                  <span className="block text-xs text-slate-500">{opt.desc}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="mt-3">
            <Button onClick={() => saveSettings.mutate()} disabled={saveSettings.isPending}>
              <Save size={16} /> {saveSettings.isPending ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        </Card>
      )}

      {form && (
        <Card>
          <h3 className="text-sm font-semibold text-slate-700">Parâmetros</h3>
          <div className="mt-3 flex flex-wrap items-end gap-4">
            <label className="w-44 text-sm">
              <span className="mb-1 block font-medium text-slate-600">Meta de margem (%)</span>
              <Input
                type="number"
                value={form.target_margin_pct}
                onChange={(e) => setForm({ ...form, target_margin_pct: Number(e.target.value) })}
              />
            </label>
            <label className="w-44 text-sm">
              <span className="mb-1 block font-medium text-slate-600">Alíquota de imposto (%)</span>
              <Input
                type="number"
                value={form.tax_rate_pct}
                onChange={(e) => setForm({ ...form, tax_rate_pct: Number(e.target.value) })}
              />
            </label>
            <Button onClick={() => saveSettings.mutate()} disabled={saveSettings.isPending}>
              <Save size={16} /> {saveSettings.isPending ? 'Salvando...' : 'Salvar parâmetros'}
            </Button>
          </div>
          <p className="mt-3 flex items-start gap-2 text-xs text-slate-500">
            <Info size={14} className="mt-0.5 shrink-0" />
            A comissão usada no simulador de margem por canal é calculada automaticamente das
            planilhas das plataformas (take-rate real do período). Não precisa cadastrar.
          </p>
        </Card>
      )}

      {!accounts.length ? (
        <NoData
          what="Nenhuma conta no plano de contas."
          hint="As contas são criadas automaticamente ao importar o DRE ou o contas a pagar do AllFood."
        />
      ) : (
        <Card className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-700">Plano de contas</h3>
              <p className="text-xs text-slate-500">{filtered.length} de {accounts.length} contas</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar conta..."
                  className="rounded-lg border border-slate-300 py-2 pl-8 pr-3 text-sm"
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input type="checkbox" checked={onlyManual} onChange={(e) => setOnlyManual(e.target.checked)} />
                Só classificadas à mão
              </label>
              <Button
                onClick={() => saveAccounts.mutate()}
                disabled={!Object.keys(edits).length || saveAccounts.isPending}
              >
                <Save size={16} />
                {saveAccounts.isPending ? 'Salvando...' : `Salvar ${Object.keys(edits).length || ''}`}
              </Button>
            </div>
          </div>

          {saved && <p className="border-b border-emerald-100 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{saved}</p>}
          {saveAccounts.error && (
            <div className="px-4 py-3"><ErrorBox message={apiError(saveAccounts.error)} /></div>
          )}

          {!filtered.length ? (
            <div className="p-4"><EmptyState message="Nenhuma conta encontrada." /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[52rem] text-sm">
                <thead className="border-b border-slate-200 text-left text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Conta</th>
                    <th className="px-4 py-3 font-medium">Grupo do DRE</th>
                    <th className="px-4 py-3 font-medium">Custo</th>
                    <th className="px-4 py-3 text-center font-medium" title="Desmarcar tira a conta do DRE gerencial">
                      Entra no DRE
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((a) => {
                    const dirty = !!edits[a.code];
                    return (
                      <tr key={a.code} className={`border-b border-slate-100 last:border-0 ${dirty ? 'bg-amber-50' : 'hover:bg-slate-50'}`}>
                        <td className="px-4 py-2">
                          <span style={{ paddingLeft: `${(a.level - 1) * 0.75}rem` }} className="block">
                            <span className="mr-2 text-xs text-slate-400 tabular-nums">{a.code}</span>
                            {a.name}
                            {!a.auto_group && (
                              <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600">manual</span>
                            )}
                          </span>
                        </td>
                        <td className="px-4 py-2">
                          <Select
                            value={value(a, 'dre_group') ?? ''}
                            onChange={(e) => patch(a.code, { dre_group: e.target.value || null })}
                          >
                            <option value="">Não classificado</option>
                            {Object.entries(groups).map(([k, label]) => (
                              <option key={k} value={k}>{label}</option>
                            ))}
                          </Select>
                        </td>
                        <td className="px-4 py-2">
                          <Select
                            value={value(a, 'cost_behavior')}
                            onChange={(e) => patch(a.code, { cost_behavior: e.target.value as FinCostBehavior })}
                          >
                            <option value="nao_classificado">—</option>
                            <option value="fixo">Fixo</option>
                            <option value="variavel">Variável</option>
                          </Select>
                        </td>
                        <td className="px-4 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={value(a, 'include_in_dre')}
                            onChange={(e) => patch(a.code, { include_in_dre: e.target.checked })}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
