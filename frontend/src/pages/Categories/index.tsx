import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { categoriesApi } from '../../services/resources';
import { apiError } from '../../services/api';
import { useAuth } from '../../store/auth.store';
import type { Category } from '../../types';
import { PageHeader } from '../../components/PageHeader';
import { Button, Card, Field, Input, Modal, Spinner, ErrorBox, EmptyState } from '../../components/ui';

export function Categories() {
  const qc = useQueryClient();
  const isAdmin = useAuth((s) => s.hasRole('admin'));
  const [editing, setEditing] = useState<Category | null>(null);
  const [open, setOpen] = useState(false);

  const { data, isLoading, error } = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.list });

  const remove = useMutation({
    mutationFn: categoriesApi.remove,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });

  function openNew() { setEditing(null); setOpen(true); }
  function openEdit(c: Category) { setEditing(c); setOpen(true); }

  return (
    <div>
      <PageHeader
        title="Categorias"
        subtitle="Agrupe fornecedores por tipo de insumo"
        action={isAdmin && <Button onClick={openNew}><Plus size={16} /> Nova categoria</Button>}
      />

      {isLoading && <Spinner />}
      {error && <ErrorBox message={apiError(error)} />}

      {data && (data.length === 0 ? (
        <EmptyState message="Nenhuma categoria cadastrada." />
      ) : (
        <Card className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Nome</th>
                <th className="px-5 py-3 font-medium">Cor</th>
                {isAdmin && <th className="px-5 py-3" />}
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-5 py-3 font-medium text-slate-800">{c.name}</td>
                  <td className="px-5 py-3">
                    {c.color ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="h-4 w-4 rounded" style={{ background: c.color }} />
                        <span className="text-slate-500">{c.color}</span>
                      </span>
                    ) : '—'}
                  </td>
                  {isAdmin && (
                    <td className="px-5 py-3 text-right">
                      <button onClick={() => openEdit(c)} className="mr-2 text-slate-400 hover:text-emerald-600"><Pencil size={16} /></button>
                      <button onClick={() => confirm(`Excluir "${c.name}"?`) && remove.mutate(c.id)} className="text-slate-400 hover:text-red-600"><Trash2 size={16} /></button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}

      {open && <CategoryForm category={editing} onClose={() => setOpen(false)} />}
    </div>
  );
}

function CategoryForm({ category, onClose }: { category: Category | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(category?.name ?? '');
  const [color, setColor] = useState(category?.color ?? '#10b981');
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: (body: Partial<Category>) =>
      category ? categoriesApi.update(category.id, body) : categoriesApi.create(body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['categories'] }); onClose(); },
    onError: (e) => setError(apiError(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    save.mutate({ name, color });
  }

  return (
    <Modal title={category ? 'Editar categoria' : 'Nova categoria'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorBox message={error} />}
        <Field label="Nome"><Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus /></Field>
        <Field label="Cor">
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-10 w-20 rounded border border-slate-300" />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={save.isPending}>Salvar</Button>
        </div>
      </form>
    </Modal>
  );
}
