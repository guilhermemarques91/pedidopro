import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Lock, Unlock } from 'lucide-react';
import { usersApi } from '../../services/resources';
import { apiError } from '../../services/api';
import { useAuth } from '../../store/auth.store';
import type { User, UserRole } from '../../types';
import { PageHeader } from '../../components/PageHeader';
import { Button, Card, Field, Input, Select, Modal, Spinner, ErrorBox, EmptyState } from '../../components/ui';

const roleLabel: Record<string, string> = {
  admin: 'Administrador',
  requester: 'Funcionário',
  buyer: 'Comprador',
  approver: 'Aprovador',
};

export function UsersPage() {
  const qc = useQueryClient();
  const me = useAuth((s) => s.user);
  const [editing, setEditing] = useState<User | null>(null);
  const [open, setOpen] = useState(false);

  const { data, isLoading, error } = useQuery({ queryKey: ['users'], queryFn: usersApi.list });
  const setActive = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => usersApi.setActive(id, active),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  return (
    <div>
      <PageHeader
        title="Usuários"
        subtitle="Cadastro de acessos — administradores e funcionários"
        action={<Button onClick={() => { setEditing(null); setOpen(true); }}><Plus size={16} /> Novo usuário</Button>}
      />

      {isLoading && <Spinner />}
      {error && <ErrorBox message={apiError(error)} />}

      {data && (data.length === 0 ? (
        <EmptyState message="Nenhum usuário." />
      ) : (
        <Card className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Nome</th>
                <th className="px-5 py-3 font-medium">E-mail</th>
                <th className="px-5 py-3 font-medium">Papel</th>
                <th className="px-5 py-3 font-medium">Acesso</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {data.map((u) => (
                <tr key={u.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-5 py-3 font-medium text-slate-800">{u.name}{u.id === me?.id && <span className="ml-2 text-xs text-slate-400">(você)</span>}</td>
                  <td className="px-5 py-3 text-slate-600">{u.email}</td>
                  <td className="px-5 py-3 text-slate-600">{roleLabel[u.role] ?? u.role}</td>
                  <td className="px-5 py-3">
                    {u.active
                      ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Liberado</span>
                      : <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">Bloqueado</span>}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button onClick={() => { setEditing(u); setOpen(true); }} className="mr-3 text-slate-400 hover:text-emerald-600" title="Editar"><Pencil size={16} /></button>
                    {u.id !== me?.id && (
                      u.active
                        ? <button onClick={() => setActive.mutate({ id: u.id, active: false })} className="text-slate-400 hover:text-red-600" title="Bloquear acesso"><Lock size={16} /></button>
                        : <button onClick={() => setActive.mutate({ id: u.id, active: true })} className="text-slate-400 hover:text-emerald-600" title="Liberar acesso"><Unlock size={16} /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}

      {open && <UserForm user={editing} onClose={() => setOpen(false)} />}
    </div>
  );
}

function UserForm({ user, onClose }: { user: User | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>(user?.role ?? 'requester');
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: () => {
      if (user) {
        const body: { name?: string; role?: UserRole; password?: string } = { name, role };
        if (password.trim()) body.password = password.trim();
        return usersApi.update(user.id, body);
      }
      return usersApi.create({ name, email, password, role });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); onClose(); },
    onError: (e) => setError(apiError(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    save.mutate();
  }

  return (
    <Modal title={user ? 'Editar usuário' : 'Novo usuário'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorBox message={error} />}
        <Field label="Nome"><Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus /></Field>
        <Field label="E-mail">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={!!user} />
        </Field>
        <Field label="Papel">
          <Select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            <option value="requester">Funcionário (só cria listas de compra)</option>
            <option value="admin">Administrador (acesso total)</option>
          </Select>
        </Field>
        <Field label={user ? 'Nova senha (deixe em branco para manter)' : 'Senha'}>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required={!user} placeholder={user ? '••••••' : ''} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={save.isPending}>Salvar</Button>
        </div>
      </form>
    </Modal>
  );
}
