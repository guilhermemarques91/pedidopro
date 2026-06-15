import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { quotationsApi } from '../../services/resources';
import { apiError } from '../../services/api';
import { useAuth } from '../../store/auth.store';
import { date } from '../../utils/format';
import { PageHeader } from '../../components/PageHeader';
import { Button, Card, Field, Input, Modal, Spinner, ErrorBox, EmptyState, Badge } from '../../components/ui';

export function Quotations() {
  const qc = useQueryClient();
  const canWrite = useAuth((s) => s.hasRole('admin', 'buyer'));
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');

  const { data, isLoading, error: qErr } = useQuery({ queryKey: ['quotations'], queryFn: quotationsApi.list });
  const create = useMutation({
    mutationFn: () => quotationsApi.create(title),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['quotations'] }); setOpen(false); setTitle(''); },
    onError: (e) => setError(apiError(e)),
  });

  function submit(e: FormEvent) { e.preventDefault(); setError(''); create.mutate(); }

  return (
    <div>
      <PageHeader
        title="Cotações"
        subtitle="Colete preços e compare fornecedores"
        action={canWrite && <Button onClick={() => setOpen(true)}><Plus size={16} /> Nova cotação</Button>}
      />

      {isLoading && <Spinner />}
      {qErr && <ErrorBox message={apiError(qErr)} />}

      {data && (data.length === 0 ? (
        <EmptyState message="Nenhuma cotação criada." />
      ) : (
        <Card className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Título</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Itens</th>
                <th className="px-5 py-3 font-medium">Criada em</th>
              </tr>
            </thead>
            <tbody>
              {data.map((q) => (
                <tr key={q.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <Link to={`/quotations/${q.id}`} className="font-medium text-emerald-700 hover:underline">{q.title}</Link>
                  </td>
                  <td className="px-5 py-3"><Badge status={q.status} /></td>
                  <td className="px-5 py-3 text-slate-600">{q.item_count ?? 0}</td>
                  <td className="px-5 py-3 text-slate-600">{date(q.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}

      {open && (
        <Modal title="Nova cotação" onClose={() => setOpen(false)}>
          <form onSubmit={submit} className="space-y-4">
            {error && <ErrorBox message={error} />}
            <Field label="Título"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Compras Junho/2026" required autoFocus /></Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={create.isPending}>Criar</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
