import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  MessageCircle, Check, Trash2, Plus, RefreshCw, AlertTriangle, ChevronLeft, Clock, Bot,
} from 'lucide-react';
import { marmitexApi } from '../../../services/resources';
import { apiError } from '../../../services/api';
import type { MarmitexWaDraft, MarmitexWaDraftLine } from '../../../types';
import { PageHeader } from '../../../components/PageHeader';
import { Button, Card, Field, Input, Select, Spinner, ErrorBox, EmptyState } from '../../../components/ui';

const hhmm = (ts: string | null) => (ts ? ts.slice(11, 16) : '');
const dmy = (d: string) => d.split('-').reverse().join('/');

/** Linha problemática precisa saltar aos olhos: é ela que segura o dia inteiro. */
function lineTone(status: MarmitexWaDraftLine['status']) {
  if (status === 'ok') return 'border-slate-200';
  if (status === 'cancelled' || status === 'superseded') return 'border-slate-200 bg-slate-50 opacity-60';
  return 'border-red-200 bg-red-50/50';
}

const STATUS_LABEL: Record<string, string> = {
  ok: 'ok',
  doubt: 'revisar',
  duplicate: 'duplicada',
  cancelled: 'cancelada no grupo',
  superseded: 'substituída',
};

function DraftList({ onOpen }: { onOpen: (id: number) => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['marmitex-wa-drafts'],
    queryFn: () => marmitexApi.whatsapp.drafts(),
    refetchInterval: 30_000,
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox message={apiError(error)} />;
  if (!data?.length) {
    return (
      <EmptyState message="Nenhum pedido lido do WhatsApp ainda. Configure o grupo da empresa em Empresas/Clientes → WhatsApp." />
    );
  }

  return (
    <div className="space-y-3">
      {data.map((d: MarmitexWaDraft) => {
        const doubt = Number(d.doubt_count ?? 0);
        const ok = Number(d.ok_count ?? 0);
        return (
          <Card key={d.id} className="cursor-pointer hover:border-emerald-300" onClick={() => onOpen(d.id)}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-slate-800">{d.company_name}</p>
                <p className="text-sm text-slate-500">
                  {dmy(d.service_date)} · {ok} marmita(s)
                  {doubt > 0 && <span className="font-medium text-red-600"> · {doubt} a revisar</span>}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {d.late && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
                    <Clock size={12} /> após o corte
                  </span>
                )}
                {d.auto_applied && d.status === 'applied' && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800">
                    <Bot size={12} /> automático
                  </span>
                )}
                {d.status === 'applied' && !d.auto_applied && (
                  <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800">aplicado</span>
                )}
                {d.status === 'pending' && (
                  <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-medium text-sky-800">aguardando revisão</span>
                )}
                {d.status === 'blocked' && (
                  <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-800">retido</span>
                )}
                {d.status === 'discarded' && (
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">descartado</span>
                )}
              </div>
            </div>
            {d.block_reason && <p className="mt-2 text-sm text-red-700">{d.block_reason}</p>}
          </Card>
        );
      })}
    </div>
  );
}

function DraftDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const draftQuery = useQuery({ queryKey: ['marmitex-wa-draft', id], queryFn: () => marmitexApi.whatsapp.draft(id) });
  const draft = draftQuery.data;
  const catalogQuery = useQuery({
    queryKey: ['marmitex-catalog', draft?.company_id],
    queryFn: () => marmitexApi.catalog(draft!.company_id),
    enabled: !!draft,
  });

  const sizes = useMemo(() => catalogQuery.data?.sizes.filter((s) => s.active) ?? [], [catalogQuery.data]);
  const proteins = useMemo(() => catalogQuery.data?.proteins.filter((p) => p.active) ?? [], [catalogQuery.data]);
  const sides = useMemo(() => catalogQuery.data?.sides.filter((s) => s.active) ?? [], [catalogQuery.data]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['marmitex-wa-draft', id] });
    qc.invalidateQueries({ queryKey: ['marmitex-wa-drafts'] });
    qc.invalidateQueries({ queryKey: ['marmitex-wa-count'] });
  };

  const saveLine = useMutation({
    mutationFn: (line: MarmitexWaDraftLine) => marmitexApi.whatsapp.updateLine(id, line.id, {
      person_name: line.person_name,
      size_id: Number(line.size_id),
      protein_id: line.protein_id ? Number(line.protein_id) : null,
      protein2_id: line.protein2_id ? Number(line.protein2_id) : null,
      side_ids: line.side_ids,
      observation: line.observation,
    }),
    onSuccess: () => { setError(''); refresh(); },
    onError: (e) => setError(apiError(e)),
  });

  const removeLine = useMutation({
    mutationFn: (lineId: number) => marmitexApi.whatsapp.removeLine(id, lineId),
    onSuccess: () => { setError(''); refresh(); },
    onError: (e) => setError(apiError(e)),
  });

  const addLine = useMutation({
    mutationFn: () => marmitexApi.whatsapp.addLine(id, {
      person_name: 'Novo', size_id: sizes[0]?.id ?? 0, protein_id: null, protein2_id: null, side_ids: [], observation: null,
    }),
    onSuccess: () => { setError(''); refresh(); },
    onError: (e) => setError(apiError(e)),
  });

  const apply = useMutation({
    mutationFn: () => marmitexApi.whatsapp.apply(id),
    onSuccess: (r) => {
      setError('');
      setMsg(`Pedido do dia gravado (#${r.order_id}).`);
      refresh();
      qc.invalidateQueries({ queryKey: ['marmitex-order'] });
    },
    onError: (e) => setError(apiError(e)),
  });

  const discard = useMutation({
    mutationFn: () => marmitexApi.whatsapp.discard(id),
    onSuccess: () => { setError(''); refresh(); onBack(); },
    onError: (e) => setError(apiError(e)),
  });

  const retry = useMutation({
    mutationFn: (messageId: number) => marmitexApi.whatsapp.retryMessage(messageId),
    onSuccess: () => { setError(''); setMsg('Mensagem recolocada na fila; o worker tenta de novo em instantes.'); refresh(); },
    onError: (e) => setError(apiError(e)),
  });

  if (draftQuery.isLoading || !draft) return <Spinner />;

  const active = draft.lines.filter((l) => l.status !== 'cancelled' && l.status !== 'superseded');
  const pendingDoubt = draft.counts.doubt;

  return (
    <div>
      <PageHeader
        title={`${draft.company_name} — ${dmy(draft.service_date)}`}
        subtitle={`${draft.counts.ok} marmita(s) prontas${pendingDoubt ? `, ${pendingDoubt} a revisar` : ''}`}
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={onBack}><ChevronLeft size={16} /> Voltar</Button>
            <Button variant="secondary" onClick={() => discard.mutate()} disabled={discard.isPending}>
              <Trash2 size={16} /> Descartar
            </Button>
            <Button onClick={() => apply.mutate()} disabled={apply.isPending || pendingDoubt > 0 || draft.counts.ok === 0}>
              <Check size={16} /> {apply.isPending ? 'Gravando…' : 'Aplicar pedido do dia'}
            </Button>
          </div>
        }
      />

      {msg && <div className="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{msg}</div>}
      {error && <div className="mb-4"><ErrorBox message={error} /></div>}
      {draft.block_reason && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /> <span>{draft.block_reason}</span>
        </div>
      )}
      {pendingDoubt > 0 && (
        <div className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Resolva as {pendingDoubt} linha(s) marcadas em vermelho (corrija e salve, ou remova) para liberar a aplicação.
        </div>
      )}
      <div className="mb-4 rounded-lg bg-slate-100 px-4 py-3 text-sm text-slate-600">
        Aplicar <b>substitui</b> o pedido deste dia pelas marmitas abaixo — inclusive o que tiver sido lançado à mão.
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[22rem_1fr]">
        {/* Mensagens cruas: a fonte da verdade quando a leitura sai estranha. */}
        <Card className="h-fit">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
            <MessageCircle size={16} /> Mensagens do grupo
          </h3>
          <div className="space-y-2">
            {draft.messages.map((m) => (
              <div
                key={m.id}
                className={`rounded-lg border px-3 py-2 text-sm ${
                  m.status === 'ignored' ? 'border-slate-200 bg-slate-50 text-slate-400'
                    : m.status === 'error' ? 'border-red-200 bg-red-50 text-red-700'
                    : 'border-slate-200 text-slate-700'
                }`}
              >
                <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                  <span className="font-medium">{m.sender_name ?? 'Desconhecido'}</span>
                  <span>{hhmm(m.message_ts)}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap">{m.body}</p>
                {m.ignore_reason && <p className="mt-1 text-xs italic">ignorada: {m.ignore_reason}</p>}
                {m.status === 'error' && (
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-xs">falhou {m.attempts}x: {m.error}</span>
                    <Button variant="secondary" onClick={() => retry.mutate(m.id)}><RefreshCw size={14} /> Tentar</Button>
                  </div>
                )}
                {/* Cadastrar um apelido não conserta o que já foi lido: a mensagem fica
                    'parsed' e o worker não volta nela. Sem este botão, corrigir o
                    dicionário só valia a partir da mensagem seguinte. */}
                {(m.status === 'parsed' || m.status === 'ignored') && (
                  <div className="mt-2 flex justify-end">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        if (confirm('Reler esta mensagem? As linhas que vieram dela são refeitas — o que você editou nelas à mão se perde.')) {
                          retry.mutate(m.id);
                        }
                      }}
                    >
                      <RefreshCw size={14} /> Reler
                    </Button>
                  </div>
                )}
              </div>
            ))}
            {!draft.messages.length && <p className="text-sm text-slate-400">Nenhuma mensagem registrada.</p>}
          </div>
        </Card>

        <div className="space-y-3">
          {active.length === 0 && <EmptyState message="Nenhuma marmita neste rascunho." />}
          {draft.lines.map((line) => (
            <LineCard
              key={line.id}
              line={line}
              sizes={sizes}
              proteins={proteins}
              sides={sides}
              onSave={(l) => saveLine.mutate(l)}
              onRemove={() => removeLine.mutate(line.id)}
              saving={saveLine.isPending}
            />
          ))}
          <Button variant="secondary" onClick={() => addLine.mutate()} disabled={!sizes.length || addLine.isPending}>
            <Plus size={16} /> Adicionar marmita
          </Button>
          {draft.applied_order_id && (
            <p className="text-sm text-slate-500">
              Já gravado como pedido #{draft.applied_order_id} —{' '}
              <Link to="/marmitex" className="text-emerald-700 underline">ver Pedidos do dia</Link>.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function LineCard({ line, sizes, proteins, sides, onSave, onRemove, saving }: {
  line: MarmitexWaDraftLine;
  sizes: { id: number; name: string }[];
  proteins: { id: number; name: string }[];
  sides: { id: number; name: string }[];
  onSave: (line: MarmitexWaDraftLine) => void;
  onRemove: () => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState(line);
  // Recarrega o estado local quando o servidor devolve a linha atualizada.
  useEffect(() => setDraft(line), [line]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(line);
  const frozen = line.status === 'cancelled' || line.status === 'superseded';
  const toggleSide = (sideId: number) =>
    setDraft((d) => ({
      ...d,
      side_ids: d.side_ids.includes(sideId) ? d.side_ids.filter((s) => s !== sideId) : [...d.side_ids, sideId],
    }));

  return (
    <Card className={lineTone(line.status)}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-slate-500">
          {line.raw_text ? <>“{line.raw_text}”</> : 'adicionada manualmente'}
        </span>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            line.status === 'ok' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'
          }`}
          >
            {STATUS_LABEL[line.status] ?? line.status}
          </span>
          <button onClick={onRemove} className="text-slate-400 hover:text-red-600" title="Remover linha">
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {line.issues.length > 0 && (
        <ul className="mb-3 list-disc pl-5 text-sm text-red-700">
          {line.issues.map((i) => <li key={i}>{i}</li>)}
        </ul>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Nome (etiqueta)">
          <Input
            value={draft.person_name ?? ''}
            disabled={frozen}
            onChange={(e) => setDraft({ ...draft, person_name: e.target.value })}
          />
        </Field>
        <Field label="Tamanho">
          <Select
            value={draft.size_id ?? ''}
            disabled={frozen}
            onChange={(e) => setDraft({ ...draft, size_id: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">Selecione…</option>
            {sizes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Proteína">
          <Select
            value={draft.protein_id ?? ''}
            disabled={frozen}
            onChange={(e) => setDraft({ ...draft, protein_id: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">Sem proteína</option>
            {proteins.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="2ª proteína (opcional)">
          <Select
            value={draft.protein2_id ?? ''}
            disabled={frozen}
            onChange={(e) => setDraft({ ...draft, protein2_id: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">Nenhuma</option>
            {proteins
              .filter((p) => p.id !== draft.protein_id)
              .map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Observação">
          <Input
            value={draft.observation ?? ''}
            disabled={frozen}
            onChange={(e) => setDraft({ ...draft, observation: e.target.value })}
          />
        </Field>
      </div>

      {sides.length > 0 && (
        <div className="mt-3">
          <span className="mb-1 block text-sm font-medium text-slate-700">Acompanhamentos</span>
          <div className="flex flex-wrap gap-2">
            {sides.map((s) => {
              const on = draft.side_ids.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  disabled={frozen}
                  onClick={() => toggleSide(s.id)}
                  className={`rounded-full border px-3 py-1 text-sm transition ${
                    on ? 'border-emerald-600 bg-emerald-50 text-emerald-700' : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {s.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {dirty && !frozen && (
        <div className="mt-3 flex justify-end">
          <Button onClick={() => onSave(draft)} disabled={saving}>
            <Check size={16} /> Salvar linha
          </Button>
        </div>
      )}
    </Card>
  );
}

export function MarmitexWhatsappReview() {
  const [openId, setOpenId] = useState<number | null>(null);

  if (openId) return <DraftDetail id={openId} onBack={() => setOpenId(null)} />;

  return (
    <div>
      <PageHeader
        title="Pedidos por WhatsApp"
        subtitle="O que o sistema leu dos grupos das empresas, esperando conferência"
      />
      <DraftList onOpen={setOpenId} />
    </div>
  );
}
