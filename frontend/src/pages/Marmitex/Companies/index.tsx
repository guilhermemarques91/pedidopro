import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, UserPlus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { marmitexApi } from '../../../services/resources';
import { apiError } from '../../../services/api';
import type { MarmitexCompany } from '../../../types';
import { PageHeader } from '../../../components/PageHeader';
import { Button, Card, Field, Input, Modal, Spinner, ErrorBox, EmptyState } from '../../../components/ui';

export function MarmitexCompanies() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<MarmitexCompany | null>(null);
  const [open, setOpen] = useState(false);
  const { data, isLoading, error } = useQuery({ queryKey: ['marmitex-companies'], queryFn: marmitexApi.companies.list });

  const toggle = useMutation({
    mutationFn: (c: MarmitexCompany) => marmitexApi.companies.update(c.id, { active: !c.active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['marmitex-companies'] }),
  });

  return (
    <div>
      <PageHeader
        title="Empresas"
        subtitle="Clientes que enviam os pedidos de marmitex"
        action={<Button onClick={() => { setEditing(null); setOpen(true); }}><Plus size={16} /> Nova empresa</Button>}
      />

      {isLoading && <Spinner />}
      {error && <ErrorBox message={apiError(error)} />}

      {data && (data.length === 0 ? (
        <EmptyState message="Nenhuma empresa cadastrada." />
      ) : (
        <Card className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Empresa</th>
                <th className="px-5 py-3 font-medium">CNPJ</th>
                <th className="px-5 py-3 font-medium">Corte</th>
                <th className="px-5 py-3 font-medium">Pendentes</th>
                <th className="px-5 py-3 font-medium">Situação</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} className={`border-b border-slate-100 last:border-0 ${!c.active ? 'opacity-50' : ''}`}>
                  <td className="px-5 py-3">
                    <p className="font-medium text-slate-800">{c.name}</p>
                    {c.contact_name && <p className="text-xs text-slate-500">{c.contact_name}</p>}
                  </td>
                  <td className="px-5 py-3 text-slate-600">{c.cnpj || '—'}</td>
                  <td className="px-5 py-3 text-slate-600">{c.order_cutoff_time ? c.order_cutoff_time.slice(0, 5) : 'sem corte'}</td>
                  <td className="px-5 py-3 text-slate-600">{c.pending_count ?? 0}</td>
                  <td className="px-5 py-3 text-slate-500">{c.active ? 'Ativa' : 'Inativa'}</td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    <button onClick={() => { setEditing(c); setOpen(true); }} className="mr-2 text-slate-400 hover:text-emerald-600"><Pencil size={16} /></button>
                    <button onClick={() => toggle.mutate(c)} className="text-xs font-medium text-slate-400 hover:text-emerald-600">
                      {c.active ? 'Desativar' : 'Ativar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}

      <p className="mt-4 flex items-center gap-2 text-sm text-slate-500">
        <UserPlus size={16} />
        Para dar acesso a uma empresa, crie um usuário com papel <b>Empresa</b> em <Link to="/users" className="text-emerald-600 hover:underline">Usuários</Link> e vincule-o a ela.
      </p>

      {open && <CompanyForm company={editing} onClose={() => setOpen(false)} />}
    </div>
  );
}

function CompanyForm({ company, onClose }: { company: MarmitexCompany | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: company?.name ?? '',
    cnpj: company?.cnpj ?? '',
    contact_name: company?.contact_name ?? '',
    phone: company?.phone ?? '',
    email: company?.email ?? '',
    order_cutoff_time: company?.order_cutoff_time ? company.order_cutoff_time.slice(0, 5) : '',
    notes: company?.notes ?? '',
  });
  const [error, setError] = useState('');
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: (body: Partial<MarmitexCompany>) => (company ? marmitexApi.companies.update(company.id, body) : marmitexApi.companies.create(body)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['marmitex-companies'] }); onClose(); },
    onError: (e) => setError(apiError(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    save.mutate({
      name: form.name,
      cnpj: form.cnpj || null,
      contact_name: form.contact_name || null,
      phone: form.phone || null,
      email: form.email || null,
      order_cutoff_time: form.order_cutoff_time || null,
      notes: form.notes || null,
    });
  }

  return (
    <Modal title={company ? 'Editar empresa' : 'Nova empresa'} onClose={onClose} size="xl">
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorBox message={error} />}
        <Field label="Nome da empresa"><Input value={form.name} onChange={set('name')} required autoFocus /></Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="CNPJ"><Input value={form.cnpj} onChange={set('cnpj')} placeholder="00.000.000/0000-00" /></Field>
          <Field label="Horário de corte (HH:MM)"><Input value={form.order_cutoff_time} onChange={set('order_cutoff_time')} placeholder="ex.: 10:00" /></Field>
          <Field label="Responsável"><Input value={form.contact_name} onChange={set('contact_name')} /></Field>
          <Field label="Telefone"><Input value={form.phone} onChange={set('phone')} /></Field>
        </div>
        <Field label="E-mail"><Input type="email" value={form.email} onChange={set('email')} /></Field>
        <Field label="Observações"><Input value={form.notes} onChange={set('notes')} /></Field>
        <p className="text-xs text-slate-400">Sem horário de corte, a empresa pode editar o pedido enquanto for do dia atual ou futuro.</p>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={save.isPending}>Salvar</Button>
        </div>
      </form>
    </Modal>
  );
}
