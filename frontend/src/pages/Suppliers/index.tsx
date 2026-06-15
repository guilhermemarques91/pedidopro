import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, MessageCircle, Globe } from 'lucide-react';
import { suppliersApi, categoriesApi } from '../../services/resources';
import { apiError } from '../../services/api';
import { useAuth } from '../../store/auth.store';
import type { Supplier, OrderType } from '../../types';
import { PageHeader } from '../../components/PageHeader';
import { Button, Card, Field, Input, Select, Modal, Spinner, ErrorBox, EmptyState } from '../../components/ui';

export function Suppliers() {
  const qc = useQueryClient();
  const canWrite = useAuth((s) => s.hasRole('admin', 'buyer'));
  const isAdmin = useAuth((s) => s.hasRole('admin'));
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  const { data, isLoading, error } = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });
  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.list });
  const remove = useMutation({
    mutationFn: suppliersApi.remove,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['suppliers'] }),
  });

  const q = search.trim().toLowerCase();
  const filtered = (data ?? []).filter((s) =>
    (!q || s.name.toLowerCase().includes(q)) &&
    (!categoryFilter || s.category_id === Number(categoryFilter))
  );

  return (
    <div>
      <PageHeader
        title="Fornecedores"
        subtitle="Cadastro com tipo de pedido (portal ou WhatsApp)"
        action={canWrite && <Button onClick={() => { setEditing(null); setOpen(true); }}><Plus size={16} /> Novo fornecedor</Button>}
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar fornecedor pelo nome…"
          className="sm:max-w-sm"
        />
        <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="sm:max-w-xs">
          <option value="">Todas as categorias</option>
          {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </div>

      {isLoading && <Spinner />}
      {error && <ErrorBox message={apiError(error)} />}

      {data && (filtered.length === 0 ? (
        <EmptyState message="Nenhum fornecedor encontrado." />
      ) : (
        <Card className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Nome</th>
                <th className="px-5 py-3 font-medium">Categoria</th>
                <th className="px-5 py-3 font-medium">Tipo</th>
                <th className="px-5 py-3 font-medium">Contato</th>
                {canWrite && <th className="px-5 py-3" />}
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-5 py-3 font-medium text-slate-800">{s.name}</td>
                  <td className="px-5 py-3 text-slate-600">{s.category_name ?? '—'}</td>
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center gap-1.5 text-slate-600">
                      {s.order_type === 'whatsapp' ? <MessageCircle size={15} className="text-emerald-600" /> : <Globe size={15} className="text-blue-600" />}
                      {s.order_type === 'whatsapp' ? 'WhatsApp' : 'Portal'}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-slate-600">{s.whatsapp_number ?? s.contact_name ?? '—'}</td>
                  {canWrite && (
                    <td className="px-5 py-3 text-right">
                      <button onClick={() => { setEditing(s); setOpen(true); }} className="mr-2 text-slate-400 hover:text-emerald-600"><Pencil size={16} /></button>
                      {isAdmin && <button onClick={() => confirm(`Excluir "${s.name}"?`) && remove.mutate(s.id)} className="text-slate-400 hover:text-red-600"><Trash2 size={16} /></button>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}

      {open && <SupplierForm supplier={editing} onClose={() => setOpen(false)} />}
    </div>
  );
}

function SupplierForm({ supplier, onClose }: { supplier: Supplier | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.list });
  const [name, setName] = useState(supplier?.name ?? '');
  const [orderType, setOrderType] = useState<OrderType>(supplier?.order_type ?? 'whatsapp');
  const [whatsapp, setWhatsapp] = useState(supplier?.whatsapp_number ?? '');
  const [portalUrl, setPortalUrl] = useState(supplier?.portal_url ?? '');
  const [contact, setContact] = useState(supplier?.contact_name ?? '');
  const [categoryId, setCategoryId] = useState<string>(supplier?.category_id ? String(supplier.category_id) : '');
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: (body: Partial<Supplier>) =>
      supplier ? suppliersApi.update(supplier.id, body) : suppliersApi.create(body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['suppliers'] }); onClose(); },
    onError: (e) => setError(apiError(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const body: Partial<Supplier> = {
      name, order_type: orderType, contact_name: contact || undefined,
      category_id: categoryId ? Number(categoryId) : undefined,
    };
    if (orderType === 'whatsapp') body.whatsapp_number = whatsapp;
    else body.portal_url = portalUrl;
    save.mutate(body);
  }

  return (
    <Modal title={supplier ? 'Editar fornecedor' : 'Novo fornecedor'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorBox message={error} />}
        <Field label="Nome"><Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus /></Field>
        <Field label="Categoria">
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">— sem categoria —</option>
            {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Tipo de pedido">
          <Select value={orderType} onChange={(e) => setOrderType(e.target.value as OrderType)}>
            <option value="whatsapp">WhatsApp</option>
            <option value="portal">Portal</option>
          </Select>
        </Field>
        {orderType === 'whatsapp' ? (
          <Field label="Número WhatsApp (com DDI 55)">
            <Input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="5535999999999" required />
          </Field>
        ) : (
          <Field label="URL do portal">
            <Input value={portalUrl} onChange={(e) => setPortalUrl(e.target.value)} placeholder="https://..." required />
          </Field>
        )}
        <Field label="Contato (opcional)"><Input value={contact} onChange={(e) => setContact(e.target.value)} /></Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={save.isPending}>Salvar</Button>
        </div>
      </form>
    </Modal>
  );
}
