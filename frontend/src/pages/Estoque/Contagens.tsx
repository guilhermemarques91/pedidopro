import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, ClipboardCheck, ShoppingCart } from 'lucide-react';
import { stockCountsApi, categoriesApi, productTypesApi } from '../../services/resources';
import { apiError } from '../../services/api';
import { datetime } from '../../utils/format';
import { useAuth } from '../../store/auth.store';
import { PageHeader } from '../../components/PageHeader';
import { Button, Card, Field, Input, Select, Modal, Badge, IconBtn, Spinner, ErrorBox, EmptyState } from '../../components/ui';

// Tipos compráveis (espelha CountsController::COUNTABLE_TIPOS). Os demais são
// montados por ficha técnica ou não se repõem — não entram numa folha de contagem.
const TIPOS = ['Mercadoria', 'Matéria-prima', 'Uso e consumo', 'Item intermediário'];

export function Contagens() {
  const qc = useQueryClient();
  const canCount = useAuth((s) => s.can('estoque:contagem'));
  const [open, setOpen] = useState(false);
  const { data, isLoading, error } = useQuery({ queryKey: ['stock-counts'], queryFn: stockCountsApi.list });
  const remove = useMutation({
    mutationFn: (id: number) => stockCountsApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stock-counts'] }),
    onError: (e) => alert(apiError(e)),
  });

  return (
    <div>
      <PageHeader
        title="Contagem de estoque"
        subtitle="Conte o que tem na prateleira. O sistema corrige o saldo e sugere quanto comprar de cada item."
        action={canCount ? <Button onClick={() => setOpen(true)}><Plus size={16} /> Nova contagem</Button> : undefined}
      />

      {isLoading && <Spinner />}
      {error && <ErrorBox message={apiError(error)} />}

      {data && (data.length === 0 ? (
        <EmptyState message="Nenhuma contagem ainda. Abra a primeira folha para começar." />
      ) : (
        <div className="space-y-2">
          {data.map((c) => {
            const total = Number(c.item_count ?? 0);
            const counted = Number(c.counted_count ?? 0);
            return (
              <Card key={c.id} className="flex items-center justify-between transition hover:border-emerald-300">
                <Link to={`/estoque/contagem/${c.id}`} className="flex flex-1 items-center gap-3">
                  <ClipboardCheck size={18} className="text-emerald-600" />
                  <div>
                    <p className="font-medium text-slate-800">{c.title}</p>
                    <p className="text-xs text-slate-400">
                      {counted} de {total} contados · {c.created_by_name} · {datetime(c.created_at)}
                    </p>
                  </div>
                </Link>
                <div className="flex items-center gap-3">
                  {c.request_id && (
                    <Link
                      to={`/requests/${c.request_id}`}
                      className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline"
                      title="Abrir a lista de compras gerada"
                    >
                      <ShoppingCart size={14} /> Lista #{c.request_id}
                    </Link>
                  )}
                  <Badge status={c.status} />
                  {/* Concluída já mexeu no saldo: excluir só rascunho (o backend também barra). */}
                  {canCount && c.status === 'draft' && (
                    <IconBtn
                      title={`Excluir a contagem ${c.title}`}
                      hover="red"
                      onClick={() => { if (confirm(`Excluir a contagem "${c.title}"?`)) remove.mutate(c.id); }}
                    >
                      <Trash2 size={16} />
                    </IconBtn>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      ))}

      {open && <NewCountForm onClose={() => setOpen(false)} />}
    </div>
  );
}

/** Abre a folha: escolhe o recorte de produtos e por quantos dias a compra deve durar. */
function NewCountForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const categories = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.list });
  const types = useQuery({ queryKey: ['product-types'], queryFn: productTypesApi.list });

  const [title, setTitle] = useState('');
  const [coverage, setCoverage] = useState('7');
  const [tipo, setTipo] = useState('');
  const [category, setCategory] = useState<number | ''>('');
  const [type, setType] = useState<number | ''>('');
  const [error, setError] = useState('');

  const create = useMutation({
    mutationFn: () => stockCountsApi.create({
      title: title.trim() || undefined,
      coverage_days: Number(coverage) || 7,
      tipo: tipo || undefined,
      category_id: category || undefined,
      type_id: type || undefined,
    }),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['stock-counts'] });
      onClose();
      navigate(`/estoque/contagem/${c.id}`);
    },
    onError: (e) => setError(apiError(e)),
  });

  return (
    <Modal title="Nova contagem de estoque" onClose={onClose}>
      <div className="space-y-4">
        {error && <ErrorBox message={error} />}
        <Field label="Título (opcional)">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Contagem de segunda-feira" />
        </Field>
        <Field label="A compra deve durar quantos dias?">
          <Input value={coverage} onChange={(e) => setCoverage(e.target.value)} inputMode="numeric" placeholder="7" />
          <p className="mt-1 text-xs text-slate-500">
            Usado nos itens sem estoque máximo cadastrado: o alvo vira o consumo médio diário × esses dias.
          </p>
        </Field>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Tipo">
            <Select value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="">Todos os compráveis</option>
              {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </Field>
          <Field label="Categoria">
            <Select value={category} onChange={(e) => setCategory(e.target.value ? Number(e.target.value) : '')}>
              <option value="">Todas</option>
              {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Classe de itens">
            <Select value={type} onChange={(e) => setType(e.target.value ? Number(e.target.value) : '')}>
              <option value="">Todas</option>
              {types.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
        </div>
        <p className="text-xs text-slate-500">
          A folha nasce com o saldo atual de cada produto. Contar por categoria (ex.: só o hortifrúti)
          deixa a folha curta e a conferência mais rápida.
        </p>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="button" disabled={create.isPending} onClick={() => create.mutate()}>Abrir folha</Button>
        </div>
      </div>
    </Modal>
  );
}
