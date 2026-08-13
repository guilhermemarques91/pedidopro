import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, ClipboardCheck, ShoppingCart } from 'lucide-react';
import { stockCountsApi, categoriesApi, productTypesApi } from '../../services/resources';
import { COUNTABLE_TIPOS } from '../../config/compras';
import { apiError } from '../../services/api';
import { datetime } from '../../utils/format';
import { useAuth } from '../../store/auth.store';
import { PageHeader } from '../../components/PageHeader';
import { Button, Card, Field, Input, Select, Modal, Badge, IconBtn, Spinner, ErrorBox, EmptyState } from '../../components/ui';

const TIPOS = COUNTABLE_TIPOS;

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

/** "contado há 3 dias" a partir da data da última folha daquele recorte. */
function haQuantosDias(iso: string | null): string {
  if (!iso) return 'nunca contado';
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (dias <= 0) return 'contado hoje';
  if (dias === 1) return 'contado ontem';
  return `contado há ${dias} dias`;
}

/**
 * Abre a folha escolhendo a PRATELEIRA, não um filtro genérico.
 *
 * A versão anterior oferecia três selects (Tipo/Categoria/Classe) e o padrão era
 * "tudo": a folha real nasceu com 202 linhas, das quais 18 foram contadas — o
 * usuário queria os descartáveis e teve de garimpar. Categoria, além disso, está
 * preenchida em 1 de 105 produtos, então nunca ia ajudar.
 *
 * Aqui cada sub-classe é um cartão com o número de itens que ela traz. Um toque
 * escolhe e o título se preenche sozinho. Os filtros antigos continuam existindo,
 * recolhidos, para quem precisar de um recorte diferente.
 */
function NewCountForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const scopes = useQuery({ queryKey: ['count-scopes'], queryFn: stockCountsApi.scopes });
  const categories = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.list });
  const types = useQuery({ queryKey: ['product-types'], queryFn: productTypesApi.list });

  const [subClasse, setSubClasse] = useState<number | ''>('');
  const [title, setTitle] = useState('');
  const [tituloEditado, setTituloEditado] = useState(false);
  const [coverage, setCoverage] = useState('7');
  const [tipo, setTipo] = useState('');
  const [category, setCategory] = useState<number | ''>('');
  const [type, setType] = useState<number | ''>('');
  const [maisFiltros, setMaisFiltros] = useState(false);
  const [error, setError] = useState('');

  const escolhido = (scopes.data ?? []).find((s) => s.sub_classe_id === subClasse);
  // Quantos itens a folha vai trazer — visível ANTES de criar, que é a informação
  // que faltava para perceber que a folha viria com o catálogo inteiro.
  const totalCompravel = (scopes.data ?? []).reduce((a, s) => a + Number(s.product_count), 0);
  const previsao = escolhido ? Number(escolhido.product_count) : totalCompravel;

  function escolher(s: { sub_classe_id: number; sub_classe_name: string; product_count: string }) {
    const igual = subClasse === s.sub_classe_id;
    setSubClasse(igual ? '' : s.sub_classe_id);
    if (!tituloEditado) setTitle(igual ? '' : `Contagem — ${s.sub_classe_name}`);
  }

  const create = useMutation({
    mutationFn: () => stockCountsApi.create({
      title: title.trim() || undefined,
      coverage_days: Number(coverage) || 7,
      sub_classe_id: subClasse || undefined,
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
    <Modal title="Nova contagem de estoque" onClose={onClose} size="full">
      <div className="space-y-4">
        {error && <ErrorBox message={error} />}

        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">O que você vai contar?</p>
          {scopes.isLoading && <Spinner />}
          <div className="grid gap-2 sm:grid-cols-3">
            {(scopes.data ?? []).map((s) => {
              const n = Number(s.product_count);
              const vazio = n === 0;
              const ativo = subClasse === s.sub_classe_id;
              return (
                <button
                  key={s.sub_classe_id}
                  type="button"
                  disabled={vazio}
                  onClick={() => escolher(s)}
                  className={`rounded-xl border p-3 text-left transition ${
                    ativo
                      ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500'
                      : vazio
                        ? 'cursor-not-allowed border-slate-200 bg-slate-50 opacity-60'
                        : 'border-slate-200 hover:border-emerald-300 hover:bg-slate-50'
                  }`}
                >
                  <p className={`font-medium ${ativo ? 'text-emerald-900' : 'text-slate-800'}`}>{s.sub_classe_name}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {vazio ? 'nenhum item comprável' : `${n} ${n === 1 ? 'item' : 'itens'} · ${haQuantosDias(s.last_counted_at)}`}
                  </p>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Sem escolher nada, a folha vem com <strong>todos os {totalCompravel} itens compráveis</strong>.
            Contar uma prateleira por vez deixa a conferência curta.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Título">
            <Input
              value={title}
              onChange={(e) => { setTitle(e.target.value); setTituloEditado(true); }}
              placeholder="Ex.: Contagem de segunda-feira"
            />
          </Field>
          <Field label="A compra deve durar quantos dias?">
            <Input value={coverage} onChange={(e) => setCoverage(e.target.value)} inputMode="numeric" placeholder="7" />
          </Field>
        </div>

        {/* Filtros antigos: continuam disponíveis, fora do caminho principal. */}
        <div>
          <button
            type="button"
            onClick={() => setMaisFiltros((v) => !v)}
            className="text-sm font-medium text-emerald-700 hover:underline"
          >
            {maisFiltros ? '− Menos filtros' : '+ Mais filtros (tipo, categoria, classe)'}
          </button>
          {maisFiltros && (
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Field label="Tipo">
                <Select value={tipo} onChange={(e) => setTipo(e.target.value)}>
                  <option value="">Todos os compráveis</option>
                  {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
                </Select>
              </Field>
              <Field label="Classe de itens">
                <Select value={type} onChange={(e) => setType(e.target.value ? Number(e.target.value) : '')}>
                  <option value="">Todas</option>
                  {types.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
              </Field>
              <Field label="Categoria">
                <Select value={category} onChange={(e) => setCategory(e.target.value ? Number(e.target.value) : '')}>
                  <option value="">Todas</option>
                  {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 pt-3">
          <span className="mr-auto text-sm text-slate-600">
            A folha virá com <strong className="text-slate-800">{previsao} {previsao === 1 ? 'item' : 'itens'}</strong>
            {escolhido ? ` de ${escolhido.sub_classe_name}` : ''}.
          </span>
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="button" disabled={create.isPending} onClick={() => create.mutate()}>Abrir folha</Button>
        </div>
      </div>
    </Modal>
  );
}
