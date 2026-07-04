import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Lock, Unlock, Trash2, ShieldCheck } from 'lucide-react';
import { usersApi, rolesApi, marmitexApi } from '../../services/resources';
import { apiError } from '../../services/api';
import { useAuth } from '../../store/auth.store';
import type { User, Role, PermissionCatalog } from '../../types';
import { PageHeader } from '../../components/PageHeader';
import { Button, Card, Field, Input, Select, Modal, Spinner, ErrorBox, EmptyState } from '../../components/ui';

/** Duas listas de permissões representam o mesmo conjunto? (ordem-insensível) */
function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

/** Checkboxes de permissão agrupados por módulo, com toggle do módulo inteiro. */
function PermissionChecklist({
  catalog, value, onChange, disabled,
}: { catalog: PermissionCatalog; value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const toggle = (perm: string) =>
    onChange(value.includes(perm) ? value.filter((p) => p !== perm) : [...value, perm]);
  const toggleModule = (perms: string[], allOn: boolean) =>
    onChange(allOn ? value.filter((p) => !perms.includes(p)) : Array.from(new Set([...value, ...perms])));

  return (
    <div className="space-y-3">
      {Object.entries(catalog).map(([mod, group]) => {
        const perms = Object.keys(group.items);
        const allOn = perms.every((p) => value.includes(p));
        const someOn = perms.some((p) => value.includes(p));
        return (
          <div key={mod} className="rounded-lg border border-slate-200 p-3">
            <label className="flex items-center gap-2 font-medium text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 accent-emerald-600"
                checked={allOn}
                ref={(el) => { if (el) el.indeterminate = someOn && !allOn; }}
                onChange={() => toggleModule(perms, allOn)}
                disabled={disabled}
              />
              {group.label}
            </label>
            <div className="mt-2 grid gap-1.5 pl-6 sm:grid-cols-2">
              {Object.entries(group.items).map(([perm, label]) => (
                <label key={perm} className="flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-emerald-600"
                    checked={value.includes(perm)}
                    onChange={() => toggle(perm)}
                    disabled={disabled}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function UsersPage() {
  const qc = useQueryClient();
  const me = useAuth((s) => s.user);
  const [editing, setEditing] = useState<User | null>(null);
  const [open, setOpen] = useState(false);
  const [rolesOpen, setRolesOpen] = useState(false);

  const { data, isLoading, error } = useQuery({ queryKey: ['users'], queryFn: usersApi.list });
  const roles = useQuery({ queryKey: ['roles'], queryFn: rolesApi.list });
  const roleLabel = useMemo(() => {
    const m: Record<string, string> = {};
    roles.data?.forEach((r) => { m[r.key] = r.label; });
    return m;
  }, [roles.data]);

  const setActive = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => usersApi.setActive(id, active),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => usersApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
    onError: (e) => alert(apiError(e)),
  });

  return (
    <div>
      <PageHeader
        title="Usuários"
        subtitle="Cadastro de acessos — administradores e funcionários"
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setRolesOpen(true)}><ShieldCheck size={16} /> Papéis</Button>
            <Button onClick={() => { setEditing(null); setOpen(true); }}><Plus size={16} /> Novo usuário</Button>
          </div>
        }
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
                  <td className="px-5 py-3 text-slate-600">
                    {roleLabel[u.role] ?? u.role}
                    {u.permissions != null && <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700">personalizado</span>}
                  </td>
                  <td className="px-5 py-3">
                    {u.active
                      ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Liberado</span>
                      : <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">Bloqueado</span>}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button onClick={() => { setEditing(u); setOpen(true); }} className="mr-3 text-slate-400 hover:text-emerald-600" title="Editar"><Pencil size={16} /></button>
                    {u.id !== me?.id && (
                      <>
                        {u.active
                          ? <button onClick={() => setActive.mutate({ id: u.id, active: false })} className="mr-3 text-slate-400 hover:text-red-600" title="Bloquear acesso"><Lock size={16} /></button>
                          : <button onClick={() => setActive.mutate({ id: u.id, active: true })} className="mr-3 text-slate-400 hover:text-emerald-600" title="Liberar acesso"><Unlock size={16} /></button>}
                        <button onClick={() => { if (confirm(`Excluir o usuário "${u.name}"? Esta ação é permanente.`)) remove.mutate(u.id); }} className="text-slate-400 hover:text-red-600" title="Excluir usuário"><Trash2 size={16} /></button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}

      {open && <UserForm user={editing} roles={roles.data ?? []} onClose={() => setOpen(false)} />}
      {rolesOpen && <RolesManager onClose={() => setRolesOpen(false)} />}
    </div>
  );
}

function UserForm({ user, roles, onClose }: { user: User | null; roles: Role[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<string>(user?.role ?? 'requester');
  const [companyId, setCompanyId] = useState<number | null>(user?.company_id ?? null);
  const [perms, setPerms] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  const catalog = useQuery({ queryKey: ['permissions-catalog'], queryFn: rolesApi.catalog });
  const roleDef = (key: string) => roles.find((r) => r.key === key)?.permissions ?? [];

  // Inicializa os checkboxes: override do usuário (edição) ou o padrão do papel.
  useEffect(() => {
    if (ready || roles.length === 0) return;
    setPerms(user?.permissions ?? roleDef(user?.role ?? role));
    setReady(true);
  }, [roles, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  function changeRole(next: string) {
    setRole(next);
    setPerms(roleDef(next)); // ao trocar de papel, parte do padrão dele
  }

  // Empresas para vincular o login (só quando o papel é 'company').
  const companies = useQuery({
    queryKey: ['marmitex-companies'],
    queryFn: marmitexApi.companies.list,
    enabled: role === 'company',
  });

  const isAdmin = role === 'admin';
  const isCompany = role === 'company';
  const showPerms = !isAdmin && !isCompany;
  // Se os checkboxes divergem do padrão do papel, vira override; senão herda (null).
  const overrideValue = () => (sameSet(perms, roleDef(role)) ? null : perms);

  const save = useMutation({
    mutationFn: () => {
      const permissions = showPerms ? overrideValue() : null;
      if (user) {
        const body: { name?: string; role?: string; password?: string; company_id?: number | null; permissions?: string[] | null } =
          { name, role, permissions };
        if (isCompany) body.company_id = companyId;
        if (password.trim()) body.password = password.trim();
        return usersApi.update(user.id, body);
      }
      return usersApi.create({ name, email, password, role, company_id: isCompany ? companyId : null, permissions });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); onClose(); },
    onError: (e) => setError(apiError(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (isCompany && !companyId) { setError('Selecione a empresa vinculada ao login.'); return; }
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
          <Select value={role} onChange={(e) => changeRole(e.target.value)}>
            {roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </Select>
        </Field>

        {isCompany && (
          <Field label="Empresa vinculada">
            <Select value={companyId ?? ''} onChange={(e) => setCompanyId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Selecione…</option>
              {companies.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
        )}

        {isAdmin && (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
            Administrador tem <strong>acesso total</strong> a todos os módulos.
          </p>
        )}

        {showPerms && (
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">Permissões</span>
              {!sameSet(perms, roleDef(role))
                ? <button type="button" onClick={() => setPerms(roleDef(role))} className="text-xs text-emerald-600 hover:underline">Restaurar padrão do papel</button>
                : <span className="text-xs text-slate-400">Padrão do papel</span>}
            </div>
            {catalog.data
              ? <PermissionChecklist catalog={catalog.data} value={perms} onChange={setPerms} />
              : <Spinner />}
          </div>
        )}

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

/** Gerenciador de papéis: criar/editar/excluir papéis e suas permissões. */
function RolesManager({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const roles = useQuery({ queryKey: ['roles'], queryFn: rolesApi.list });
  const catalog = useQuery({ queryKey: ['permissions-catalog'], queryFn: rolesApi.catalog });
  const [editing, setEditing] = useState<Role | 'new' | null>(null);

  const invalidate = () => { qc.invalidateQueries({ queryKey: ['roles'] }); qc.invalidateQueries({ queryKey: ['users'] }); };
  const remove = useMutation({
    mutationFn: (id: number) => rolesApi.remove(id),
    onSuccess: invalidate,
    onError: (e) => alert(apiError(e)),
  });

  return (
    <Modal title="Papéis e permissões" onClose={onClose}>
      {editing ? (
        <RoleForm
          role={editing === 'new' ? null : editing}
          catalog={catalog.data ?? {}}
          onDone={() => { invalidate(); setEditing(null); }}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-500">Papéis são modelos de permissões. Ao criar um usuário, você escolhe o papel e pode ajustar as permissões dele individualmente.</p>
          {roles.isLoading && <Spinner />}
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {roles.data?.map((r) => (
              <div key={r.id} className="flex items-center justify-between px-4 py-2.5">
                <div>
                  <span className="font-medium text-slate-800">{r.label}</span>
                  {r.is_system && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">sistema</span>}
                  <span className="ml-2 text-xs text-slate-400">{r.key === 'admin' ? 'acesso total' : `${r.permissions.length} permissõe(s)`}</span>
                </div>
                <div className="flex items-center gap-3">
                  {r.key !== 'admin' && (
                    <button onClick={() => setEditing(r)} className="text-slate-400 hover:text-emerald-600" title="Editar"><Pencil size={16} /></button>
                  )}
                  {!r.is_system && (
                    <button onClick={() => { if (confirm(`Excluir o papel "${r.label}"?`)) remove.mutate(r.id); }} className="text-slate-400 hover:text-red-600" title="Excluir"><Trash2 size={16} /></button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end">
            <Button onClick={() => setEditing('new')}><Plus size={16} /> Novo papel</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function RoleForm({ role, catalog, onDone, onCancel }: { role: Role | null; catalog: PermissionCatalog; onDone: () => void; onCancel: () => void }) {
  const [label, setLabel] = useState(role?.label ?? '');
  const [perms, setPerms] = useState<string[]>(role?.permissions ?? []);
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: () => role
      ? rolesApi.update(role.id, { label, permissions: perms })
      : rolesApi.create({ label, permissions: perms }),
    onSuccess: onDone,
    onError: (e) => setError(apiError(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (label.trim().length < 2) { setError('Dê um nome ao papel.'); return; }
    save.mutate();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <ErrorBox message={error} />}
      <Field label="Nome do papel (ex.: Caixa, Garçom, Gerente)">
        <Input value={label} onChange={(e) => setLabel(e.target.value)} required autoFocus />
      </Field>
      <div>
        <span className="mb-1 block text-sm font-medium text-slate-700">Permissões</span>
        <PermissionChecklist catalog={catalog} value={perms} onChange={setPerms} />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>Voltar</Button>
        <Button type="submit" disabled={save.isPending}>Salvar papel</Button>
      </div>
    </form>
  );
}
