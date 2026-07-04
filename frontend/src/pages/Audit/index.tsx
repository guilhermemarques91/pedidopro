import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { auditApi } from '../../services/resources';
import { apiError } from '../../services/api';
import { PageHeader } from '../../components/PageHeader';
import { Card, Input, Spinner, ErrorBox, EmptyState } from '../../components/ui';

const methodColor: Record<string, string> = {
  POST: 'bg-emerald-50 text-emerald-700',
  PUT: 'bg-blue-50 text-blue-700',
  PATCH: 'bg-blue-50 text-blue-700',
  DELETE: 'bg-red-50 text-red-700',
};

function statusColor(status: number | null): string {
  if (status == null) return 'text-slate-400';
  if (status >= 500) return 'text-red-600';
  if (status >= 400) return 'text-amber-600';
  return 'text-emerald-600';
}

export function AuditPage() {
  const [term, setTerm] = useState('');
  const { data, isLoading, error } = useQuery({
    queryKey: ['audit', term],
    queryFn: () => auditApi.list({ user: term || undefined, limit: 200 }),
  });

  return (
    <div>
      <PageHeader
        title="Auditoria"
        subtitle="Registro das ações que alteram dados — quem fez o quê e quando"
      />

      <div className="mb-4 max-w-sm">
        <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Filtrar por usuário…" />
      </div>

      {isLoading && <Spinner />}
      {error && <ErrorBox message={apiError(error)} />}

      {data && (data.length === 0 ? (
        <EmptyState message="Nenhum registro de auditoria." />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[42rem] text-sm">
            <thead className="border-b border-slate-200 text-left text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Quando</th>
                <th className="px-5 py-3 font-medium">Usuário</th>
                <th className="px-5 py-3 font-medium">Ação</th>
                <th className="px-5 py-3 font-medium">Recurso</th>
                <th className="px-5 py-3 font-medium">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {data.map((e) => (
                <tr key={e.id} className="border-b border-slate-100 last:border-0">
                  <td className="whitespace-nowrap px-5 py-3 text-slate-600">{new Date(e.created_at).toLocaleString('pt-BR')}</td>
                  <td className="px-5 py-3 font-medium text-slate-800">{e.username ?? <span className="text-slate-400">—</span>}</td>
                  <td className="px-5 py-3">
                    <span className={`mr-2 rounded px-1.5 py-0.5 text-xs font-semibold ${methodColor[e.method] ?? 'bg-slate-100 text-slate-600'}`}>{e.method}</span>
                    <span className="text-slate-600">{e.path}</span>
                  </td>
                  <td className="px-5 py-3 text-slate-600">{e.entity}{e.entity_id ? ` #${e.entity_id}` : ''}</td>
                  <td className={`px-5 py-3 font-medium ${statusColor(e.status)}`}>{e.status ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
    </div>
  );
}
