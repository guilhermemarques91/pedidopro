import { useState } from 'react';
import { PageHeader } from '../../components/PageHeader';
import { useAuth } from '../../store/auth.store';
import { Overview } from './Overview';
import { Dre } from './Dre';
import { Canais } from './Canais';
import { Produtos } from './Produtos';
import { Cmv } from './Cmv';
import { Breakeven } from './Breakeven';
import { Importacoes } from './Importacoes';
import { Configuracoes } from './Configuracoes';

/**
 * Módulo Financeiro — DRE, margens e análises sobre as planilhas importadas
 * (AllFood, 99Food e iFood). Não lê as vendas do ERP: tudo vem dos arquivos.
 *
 * As abas de importação e configuração exigem `financeiro:admin`; as demais só
 * leitura.
 */
const TABS = [
  { key: 'overview', label: 'Visão geral', admin: false },
  { key: 'dre', label: 'DRE', admin: false },
  { key: 'canais', label: 'Canais', admin: false },
  { key: 'produtos', label: 'Produtos & margem', admin: false },
  { key: 'cmv', label: 'CMV e custos', admin: false },
  { key: 'breakeven', label: 'Ponto de equilíbrio', admin: false },
  { key: 'importacoes', label: 'Importações', admin: true },
  { key: 'config', label: 'Configurações', admin: true },
] as const;
type TabKey = (typeof TABS)[number]['key'];

export function Financeiro() {
  const permissions = useAuth((s) => s.permissions);
  const isAdmin = permissions.includes('financeiro:admin');
  const tabs = TABS.filter((t) => !t.admin || isAdmin);
  const [tab, setTab] = useState<TabKey>('overview');

  return (
    <div>
      <PageHeader
        title="Financeiro"
        subtitle="DRE, margens e análises a partir das planilhas do AllFood, 99Food e iFood"
      />

      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition ${
              tab === t.key
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview onNavigate={setTab} canImport={isAdmin} />}
      {tab === 'dre' && <Dre />}
      {tab === 'canais' && <Canais />}
      {tab === 'produtos' && <Produtos />}
      {tab === 'cmv' && <Cmv />}
      {tab === 'breakeven' && <Breakeven />}
      {tab === 'importacoes' && isAdmin && <Importacoes />}
      {tab === 'config' && isAdmin && <Configuracoes />}
    </div>
  );
}
