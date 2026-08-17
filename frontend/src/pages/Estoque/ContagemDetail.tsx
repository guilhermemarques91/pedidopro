import { KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save, CheckCircle2, ShoppingCart, Search, AlertTriangle, Cloud, CloudOff, RotateCcw } from 'lucide-react';
import { stockCountsApi, CountLineInput } from '../../services/resources';
import { apiError } from '../../services/api';
import { brl, datetime, fmtQty, parseNum } from '../../utils/format';
import type { StockCountItem, ReplenishStatus } from '../../types';
import { useAuth } from '../../store/auth.store';
import { PageHeader } from '../../components/PageHeader';
import { Button, Card, Input, Select, Badge, Spinner, ErrorBox, EmptyState } from '../../components/ui';

/** Valores digitados na folha (string, como o usuário digita). */
interface Draft { counted: string; order: string; viaSistema?: boolean }

/**
 * Espelho local da digitação, por folha.
 *
 * Existe porque a contagem real levou 21 minutos e vivia só em memória: fechar a
 * aba perdia tudo. O autosave cobre o caso normal; este espelho cobre o que o
 * autosave não alcança — queda de rede, navegador morto, bateria acabando.
 */
const storageKey = (id: number) => `pedidopro:count:${id}`;

function lerEspelho(id: number): Record<number, Draft> | null {
  try {
    const raw = localStorage.getItem(storageKey(id));
    return raw ? (JSON.parse(raw) as Record<number, Draft>) : null;
  } catch {
    return null;
  }
}
function gravarEspelho(id: number, drafts: Record<number, Draft>) {
  try {
    localStorage.setItem(storageKey(id), JSON.stringify(drafts));
  } catch {
    /* quota/privacidade: o autosave continua sendo a proteção principal */
  }
}
function limparEspelho(id: number) {
  try { localStorage.removeItem(storageKey(id)); } catch { /* idem */ }
}

/**
 * Mantém do espelho só os produtos que existem NESTA folha.
 *
 * Um espelho pode sobreviver a uma folha que mudou (produto desativado, recorte
 * diferente). Sem esta poda, o aviso contaria lançamentos que não têm onde
 * pousar e o salvamento mandaria linhas que não casam com nada.
 */
function podarEspelho(espelho: Record<number, Draft>, idsDaFolha: Set<number>): Record<number, Draft> {
  const out: Record<number, Draft> = {};
  Object.keys(espelho).forEach((k) => {
    const id = Number(k);
    if (idsDaFolha.has(id)) out[id] = espelho[id];
  });
  return out;
}

/**
 * Quantos lançamentos do espelho ainda não chegaram ao servidor.
 *
 * Percorre só as chaves DO ESPELHO: ele guarda apenas o que estava sujo quando a
 * sessão morreu, então uma linha ausente ali significa "já salva", não "apagada".
 * Comparar os dois lados inteiros contava as linhas já salvas como pendentes.
 */
function pendentesNoEspelho(espelho: Record<number, Draft>, doServidor: Record<number, Draft>): number {
  let n = 0;
  Object.keys(espelho).forEach((k) => {
    const x = espelho[Number(k)];
    const y = doServidor[Number(k)] ?? { counted: '', order: '' };
    if (x.counted !== y.counted || x.order !== y.order) n++;
  });
  return n;
}

const STATUS_STYLE: Record<ReplenishStatus, { label: string; cls: string }> = {
  critico: { label: 'Crítico', cls: 'bg-red-100 text-red-700' },
  repor: { label: 'Repor', cls: 'bg-amber-100 text-amber-700' },
  ok: { label: 'OK', cls: 'bg-emerald-100 text-emerald-700' },
  sem_parametro: { label: 'Sem parâmetro', cls: 'bg-slate-100 text-slate-500' },
};


/**
 * Recalcula sugestão e situação com o que está sendo digitado AGORA.
 *
 * O alvo e o ponto de pedido vêm prontos do backend (não dependem do saldo), então
 * aqui só se aplica "quanto falta para o alvo" — a fonte da verdade continua sendo
 * App\Services\Replenishment, que refaz a conta ao salvar e ao gerar a lista.
 */
function live(item: StockCountItem, onHand: number): { suggested: number | null; status: ReplenishStatus } {
  if (item.target === null) {
    return { suggested: null, status: onHand <= 0 ? 'critico' : 'sem_parametro' };
  }
  const pack = item.pack_size ? Number(item.pack_size) : 0;
  const falta = item.target - onHand;
  let suggested = falta > 0 ? falta : 0;
  if (suggested > 0 && pack > 0) suggested = Math.ceil(suggested / pack) * pack;
  const reorder = item.reorder_point ?? 0;
  const status: ReplenishStatus = onHand <= reorder ? 'critico' : onHand < item.target ? 'repor' : 'ok';
  return { suggested: Math.round(suggested * 1000) / 1000, status };
}

export function ContagemDetail() {
  const { id } = useParams();
  const countId = Number(id);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const canCount = useAuth((s) => s.can('estoque:contagem'));
  const canRequest = useAuth((s) => s.can('compras:requests'));

  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'todos' | 'faltando' | 'comprar'>('todos');
  const [subFilter, setSubFilter] = useState<number | ''>('');
  const [error, setError] = useState('');
  const [confirmMsg, setConfirmMsg] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  /** Rascunho local mais recente que o do servidor, esperando decisão do usuário. */
  const [recuperavel, setRecuperavel] = useState<{ drafts: Record<number, Draft>; n: number } | null>(null);

  /** product_ids alterados desde o último salvamento confirmado. */
  const sujos = useRef<Set<number>>(new Set());
  const draftsRef = useRef<Record<number, Draft>>({});
  draftsRef.current = drafts;

  const { data, isLoading, error: loadError } = useQuery({
    queryKey: ['stock-count', countId],
    queryFn: () => stockCountsApi.get(countId),
    enabled: Number.isFinite(countId) && countId > 0,
  });

  // Carrega os valores já salvos uma única vez (depois quem manda é o que está na tela).
  if (data && !loaded) {
    setLoaded(true);
    const init: Record<number, Draft> = {};
    data.items.forEach((it) => {
      init[it.product_id] = {
        counted: it.counted_qty !== null ? String(Number(it.counted_qty)).replace('.', ',') : '',
        order: it.order_qty !== null ? String(Number(it.order_qty)).replace('.', ',') : '',
        viaSistema: it.counted_via === 'sistema',
      };
    });
    setDrafts(init);
    // Espelho local à frente do servidor = sessão anterior interrompida. Nunca
    // mesclar em silêncio: o usuário decide se recupera ou descarta.
    const bruto = lerEspelho(countId);
    if (bruto) {
      const espelho = podarEspelho(bruto, new Set(data.items.map((it) => it.product_id)));
      const n = pendentesNoEspelho(espelho, init);
      // Recuperado herda o que já estava salvo: recuperar não pode apagar o resto.
      if (n > 0) setRecuperavel({ drafts: { ...init, ...espelho }, n });
      else limparEspelho(countId);
    }
  }

  const isDraft = data?.status === 'draft';
  // Concluída trava a contagem, mas a quantidade de compra segue editável até a
  // lista ser gerada — é a janela de revisão da sugestão.
  const canEditOrder = canCount && (isDraft || (data?.status === 'applied' && !data?.request_id));
  const lines = data?.items ?? [];

  /** Linha + os números vivos (o que está digitado). */
  const computed = useMemo(() => lines.map((it) => {
    const d = drafts[it.product_id] ?? { counted: '', order: '' };
    const countedNum = parseNum(d.counted);
    const onHand = countedNum !== null ? countedNum : Number(it.system_qty);
    const calc = live(it, onHand);
    const orderNum = parseNum(d.order);
    // Espelha CountsController::buyQty — item não contado não entra na compra
    // sozinho (o saldo do sistema é justamente o número que não se confia);
    // só entra se alguém digitar a quantidade à mão.
    const finalQty = orderNum !== null ? orderNum : (countedNum !== null ? (calc.suggested ?? 0) : 0);
    return { it, draft: d, onHand, counted: countedNum, ...calc, finalQty };
  }), [lines, drafts]);

  // Busca sem acento: "acucar" precisa achar "Açúcar" — quem conta digita rápido.
  const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

  const visible = computed.filter((r) => {
    if (q.trim() && !norm(r.it.product_name).includes(norm(q.trim()))) return false;
    if (filter === 'faltando' && r.counted !== null) return false;
    if (filter === 'comprar' && r.finalQty <= 0) return false;
    if (subFilter !== '' && r.it.sub_classe_id !== subFilter) return false;
    return true;
  });

  /**
   * Linhas agrupadas pela prateleira, na ordem que o backend já devolve.
   * `flat` é o índice global da linha: o Enter continua andando pela folha inteira,
   * atravessando grupos, em vez de parar no fim de cada seção.
   */
  const grupos = useMemo(() => {
    const out: { key: string; nome: string; rows: (typeof visible[number] & { flat: number })[] }[] = [];
    visible.forEach((r, i) => {
      const nome = r.it.sub_classe_name ?? 'Sem sub-classe';
      const key = String(r.it.sub_classe_id ?? 'sem');
      let g = out[out.length - 1];
      if (!g || g.key !== key) { g = { key, nome, rows: [] }; out.push(g); }
      g.rows.push({ ...r, flat: i });
    });
    return out;
  }, [visible]);

  /** Sub-classes presentes na folha, para o filtro. */
  const subClasses = useMemo(() => {
    const m = new Map<number, string>();
    computed.forEach((r) => { if (r.it.sub_classe_id) m.set(r.it.sub_classe_id, r.it.sub_classe_name ?? '—'); });
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  }, [computed]);

  const [colapsados, setColapsados] = useState<Set<string>>(new Set());
  const alternarGrupo = (key: string) =>
    setColapsados((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const totals = useMemo(() => {
    let counted = 0, toBuy = 0, critical = 0, cost = 0;
    computed.forEach((r) => {
      if (r.counted !== null) counted++;
      if (r.finalQty > 0) { toBuy++; cost += r.finalQty * Number(r.it.unit_cost ?? 0); }
      // Só alerta de crítico o que foi conferido — senão a folha nasce toda vermelha.
      if (r.counted !== null && r.status === 'critico') critical++;
    });
    return { counted, toBuy, critical, cost, total: computed.length };
  }, [computed]);

  function payload(): CountLineInput[] {
    return computed.map((r) => ({
      product_id: r.it.product_id,
      counted_qty: r.counted,
      counted_via: r.draft.viaSistema ? 'sistema' : 'manual',
      // Só grava order_qty quando o usuário mexeu; senão a sugestão segue viva.
      order_qty: parseNum(r.draft.order),
    }));
  }

  /**
   * Só as linhas mexidas desde o último salvamento confirmado.
   *
   * O backend atualiza linha a linha (`WHERE count_id=? AND product_id=?`), então
   * o envio parcial é seguro — e é o que permite dois celulares contarem a mesma
   * folha sem um sobrescrever o outro.
   */
  const payloadSujo = useCallback((): CountLineInput[] => {
    const d = draftsRef.current;
    return [...sujos.current].map((pid) => ({
      product_id: pid,
      counted_qty: parseNum(d[pid]?.counted ?? ''),
      counted_via: d[pid]?.viaSistema ? 'sistema' : 'manual',
      order_qty: parseNum(d[pid]?.order ?? ''),
    }));
  }, []);

  const save = useMutation({
    mutationFn: () => stockCountsApi.update(countId, { items: payloadSujo() }),
    onSuccess: () => {
      setError(''); setSaveFailed(false); setSavedAt(new Date());
      sujos.current.clear();
      limparEspelho(countId);
      qc.invalidateQueries({ queryKey: ['stock-count', countId] });
    },
    onError: (e) => { setSaveFailed(true); setError(apiError(e)); },
  });

  /**
   * Autosave: dispara ~1,2 s depois que a digitação para.
   * Não roda enquanto há rascunho pendente de recuperação — gravar antes de o
   * usuário decidir apagaria justamente o que ele talvez queira de volta.
   */
  useEffect(() => {
    if (!loaded || !canEditOrder || recuperavel) return;
    if (sujos.current.size === 0 || save.isPending) return;
    const t = setTimeout(() => { if (sujos.current.size > 0) save.mutate(); }, 1200);
    return () => clearTimeout(t);
  }, [drafts, loaded, canEditOrder, recuperavel]);

  /**
   * Última chance quando a aba está indo embora. `fetch(keepalive)` e não
   * `sendBeacon`, porque esta API exige o header Authorization e o beacon não
   * carrega header.
   */
  useEffect(() => {
    function flush() {
      if (sujos.current.size === 0) return;
      gravarEspelho(countId, draftsRef.current);
      const token = localStorage.getItem('pedidopro_token');
      if (!token) return;
      try {
        fetch(`${import.meta.env.VITE_API_URL ?? ''}/api/stock/counts/${countId}`, {
          method: 'PUT',
          keepalive: true,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ items: payloadSujo() }),
        });
      } catch { /* a aba está fechando; o espelho local já foi gravado */ }
    }
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (sujos.current.size === 0) return;
      flush();
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', onBeforeUnload);
    // Navegação dentro do app não passa por pagehide: o flush no desmonte cobre.
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', onBeforeUnload);
      flush();
    };
  }, [countId, payloadSujo]);

  // Concluir = salvar o que está na tela e ajustar o saldo pelo que foi contado.
  const apply = useMutation({
    mutationFn: async () => {
      await stockCountsApi.update(countId, { items: payload() });
      return stockCountsApi.apply(countId);
    },
    onSuccess: (r) => {
      setError('');
      qc.invalidateQueries({ queryKey: ['stock-count', countId] });
      qc.invalidateQueries({ queryKey: ['stock-counts'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      alert(`Contagem concluída. ${r.adjusted} produto(s) tiveram o saldo corrigido.`);
    },
    onError: (e) => setError(apiError(e)),
  });

  // Reabrir desfaz o ajuste de estoque da conclusão (estorno, não sobrescrita — ver
  // CountsController::reopen) e volta a folha pra rascunho, com o que já foi contado
  // intacto: é pra corrigir a linha que saiu errada, não pra recontar tudo de novo.
  const reopen = useMutation({
    mutationFn: () => stockCountsApi.reopen(countId),
    onSuccess: (r) => {
      setError('');
      qc.invalidateQueries({ queryKey: ['stock-count', countId] });
      qc.invalidateQueries({ queryKey: ['stock-counts'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      alert(`Contagem reaberta. ${r.reverted} produto(s) tiveram o ajuste de estoque desfeito.`);
    },
    onError: (e) => setError(apiError(e)),
  });

  const generate = useMutation({
    mutationFn: () => stockCountsApi.generateRequest(countId),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['stock-counts'] });
      navigate(`/requests/${r.request_id}`);
    },
    onError: (e) => setError(apiError(e)),
  });

  function set(productId: number, field: keyof Draft, value: string) {
    sujos.current.add(productId);
    setDrafts((d) => {
      const next = { ...d, [productId]: { ...(d[productId] ?? { counted: '', order: '' }), [field]: value } };
      // Espelho a cada tecla: é síncrono e barato, e é o que sobrevive a uma queda.
      gravarEspelho(countId, next);
      return next;
    });
  }

  /**
   * Grava o "contei" junto da origem (digitado à mão x aceito via "Conferir resto").
   * Separado de set() porque a contagem é o único campo cuja origem importa depois de
   * salva — digitar por cima de um valor aceito em massa volta a ser "manual".
   */
  function setCounted(productId: number, value: string, viaSistema: boolean) {
    sujos.current.add(productId);
    setDrafts((d) => {
      const next = { ...d, [productId]: { ...(d[productId] ?? { counted: '', order: '' }), counted: value, viaSistema } };
      gravarEspelho(countId, next);
      return next;
    });
  }

  /** Aceita o rascunho local recuperado — passa a valer e o autosave o sincroniza. */
  function recuperar() {
    if (!recuperavel) return;
    Object.keys(recuperavel.drafts).forEach((k) => sujos.current.add(Number(k)));
    setDrafts(recuperavel.drafts);
    setRecuperavel(null);
  }
  function descartarRecuperacao() {
    limparEspelho(countId);
    setRecuperavel(null);
  }

  /** Enter pula para o próximo campo da coluna: dá para contar a folha inteira sem o mouse. */
  function onEnterNext(e: KeyboardEvent<HTMLInputElement>, column: string, index: number) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const next = document.querySelector<HTMLInputElement>(`[data-cell="${column}-${index + 1}"]`);
    next?.focus();
    next?.select();
  }

  /**
   * "Conferir o resto desta prateleira": aceita o saldo do sistema como contado nas
   * linhas do grupo que AINDA estão vazias — nunca sobrescreve o que já foi digitado.
   *
   * Existe porque numa prateleira onde a maioria bate com o sistema, a folha ainda
   * exigia digitar o mesmo número de novo, célula a célula. Continua reversível: o
   * campo segue editável depois, e cai no mesmo autosave/espelho local de sempre.
   *
   * Pula saldo NEGATIVO de propósito: o backend rejeita `counted_qty < 0` (não existe
   * "contei -25 unidades" numa prateleira de verdade — negativo é sinal de que o
   * sistema já está errado), e aceitar cegamente travaria o autosave da folha
   * inteira. Esses casos ficam para o usuário contar de verdade.
   */
  function conferirResto(g: { rows: (typeof visible[number] & { flat: number })[] }) {
    let n = 0;
    let pulados = 0;
    g.rows.forEach((r) => {
      if (r.counted !== null) return;
      const saldo = Number(r.it.system_qty);
      if (saldo < 0) { pulados++; return; }
      setCounted(r.it.product_id, String(saldo).replace('.', ','), true);
      n++;
    });
    const partes = [];
    if (n > 0) partes.push(`${n} item(ns) marcados como conferidos (saldo do sistema)`);
    if (pulados > 0) partes.push(`${pulados} com saldo negativo ficaram para contar na mão`);
    setConfirmMsg(partes.length > 0 ? partes.join(' · ') + '.' : 'Esta prateleira já está toda contada.');
  }

  if (isLoading) return <Spinner />;
  if (loadError) return <ErrorBox message={apiError(loadError)} />;
  if (!data) return <EmptyState message="Contagem não encontrada." />;

  return (
    <div>
      <Link to="/estoque/contagem" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-emerald-600">
        <ArrowLeft size={15} /> Contagens
      </Link>

      <PageHeader
        title={data.title}
        subtitle={
          isDraft
            ? `Lance o que você contou na prateleira. A compra sugerida cobre ${data.coverage_days} dia(s).`
            : `Concluída por ${data.applied_by_name ?? '—'} em ${datetime(data.applied_at)}.`
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            {/* Estado do salvamento sempre à vista: quem já perdeu uma contagem
                precisa ver que o trabalho está guardado, não confiar que está. */}
            {canEditOrder && (
              <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${saveFailed ? 'text-red-600' : 'text-slate-500'}`}>
                {saveFailed ? <CloudOff size={14} /> : <Cloud size={14} />}
                {save.isPending ? 'salvando…'
                  : saveFailed ? 'falha ao salvar'
                  : sujos.current.size > 0 ? 'alterações não salvas'
                  : savedAt ? `salvo às ${savedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
                  : 'tudo salvo'}
              </span>
            )}
            <Badge status={data.status} />
            {isDraft && canCount && (
              <>
                <Button variant="secondary" disabled={save.isPending} onClick={() => save.mutate()}>
                  <Save size={16} /> Salvar
                </Button>
                <Button
                  disabled={apply.isPending || totals.counted === 0}
                  onClick={() => {
                    if (confirm(`Concluir a contagem? O saldo de ${totals.counted} produto(s) passa a ser o que você contou.`)) apply.mutate();
                  }}
                >
                  <CheckCircle2 size={16} /> Concluir contagem
                </Button>
              </>
            )}
            {/* Revisão pós-contagem: dá para mexer nas quantidades e só então gerar a lista. */}
            {!isDraft && !data.request_id && canEditOrder && (
              <Button variant="secondary" disabled={save.isPending} onClick={() => save.mutate()}>
                <Save size={16} /> Salvar quantidades
              </Button>
            )}
            {/* Reabrir só cabe antes da lista de compras existir — depois disso a
                contagem já virou decisão de compra, desfazer o saldo bagunçaria o que
                foi pedido. */}
            {data.status === 'applied' && !data.request_id && canCount && (
              <Button
                variant="secondary"
                disabled={reopen.isPending}
                onClick={() => {
                  if (confirm('Reabrir esta contagem? O ajuste de estoque feito na conclusão será desfeito (estornado, sem apagar movimentos que aconteceram depois) e a folha volta a ser rascunho — o que já foi contado continua lançado, só editável de novo.')) reopen.mutate();
                }}
              >
                <RotateCcw size={16} /> Reabrir contagem
              </Button>
            )}
            {!isDraft && !data.request_id && canRequest && (
              <Button
                disabled={generate.isPending || totals.toBuy === 0}
                onClick={async () => {
                  // Grava o que está na tela antes de gerar: a lista sai com os números revisados.
                  if (canEditOrder) await save.mutateAsync();
                  generate.mutate();
                }}
              >
                <ShoppingCart size={16} /> Gerar lista de compras ({totals.toBuy})
              </Button>
            )}
            {data.request_id && (
              <Link to={`/requests/${data.request_id}`}>
                <Button variant="secondary"><ShoppingCart size={16} /> Ver lista #{data.request_id}</Button>
              </Link>
            )}
          </div>
        }
      />

      {error && <ErrorBox message={error} />}
      {confirmMsg && (
        <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {confirmMsg}
        </div>
      )}

      {/* Rascunho de uma sessão interrompida. Decisão explícita — nunca mesclar sozinho. */}
      {recuperavel && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          <RotateCcw size={16} className="shrink-0" />
          <span className="flex-1">
            Você tem <strong>{recuperavel.n} lançamento(s)</strong> desta folha que não chegaram a ser salvos.
          </span>
          <Button className="px-3 py-1.5 text-xs" onClick={recuperar}>Recuperar</Button>
          <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={descartarRecuperacao}>Descartar</Button>
        </div>
      )}

      {/* Resumo */}
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Stat label="Itens na folha" value={String(totals.total)} />
        <Stat label="Já contados" value={`${totals.counted} de ${totals.total}`} />
        <Stat label="A comprar" value={String(totals.toBuy)} tone="emerald" />
        <Stat label="Custo estimado" value={brl(totals.cost)} tone="amber" />
      </div>

      {totals.critical > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertTriangle size={16} />
          {totals.critical} item(ns) no ponto de pedido ou abaixo dele.
        </div>
      )}

      {/* Filtros da folha */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar item…" className="w-56 pl-8" />
        </div>
        <Select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="w-52">
          <option value="todos">Todos os itens</option>
          <option value="faltando">Falta contar</option>
          <option value="comprar">Só o que vai ser comprado</option>
        </Select>
        {subClasses.length > 1 && (
          <Select
            value={subFilter}
            onChange={(e) => setSubFilter(e.target.value ? Number(e.target.value) : '')}
            className="w-52"
            aria-label="Filtrar por prateleira"
          >
            <option value="">Todas as prateleiras</option>
            {subClasses.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
          </Select>
        )}
        <span className="text-xs text-slate-500">{visible.length} linha(s)</span>
      </div>

      {visible.length === 0 ? (
        <EmptyState message="Nenhuma linha com esse filtro." />
      ) : (
        <>
        {/* CELULAR: um cartão por item. Esta é a tela que se usa andando pela
            prateleira com o telefone na mão — tabela de 8 colunas com rolagem
            lateral ali é inutilizável. O campo "contei" vem grande e sozinho;
            o resto é leitura. */}
        <div className="space-y-2 md:hidden">
          {grupos.map((g) => {
            const contados = g.rows.filter((r) => r.counted !== null).length;
            const fechado = colapsados.has(g.key);
            return (
              <div key={g.key} className="space-y-2">
                {/* Cabeçalho da prateleira, fixo ao rolar: no celular é ele que diz
                    onde você está e permite fechar a prateleira já conferida. */}
                <div className="sticky top-0 z-10 flex items-center gap-1 rounded-lg border border-slate-200 bg-white/95 px-1.5 py-1.5 backdrop-blur">
                  <button
                    type="button"
                    onClick={() => alternarGrupo(g.key)}
                    className="flex flex-1 items-center justify-between px-1.5 py-0.5 text-left"
                  >
                    <span className="text-sm font-semibold text-slate-700">{g.nome}</span>
                    <span className="text-xs font-medium text-slate-500">
                      {contados} de {g.rows.length} · {fechado ? 'abrir' : 'fechar'}
                    </span>
                  </button>
                  {isDraft && canCount && contados < g.rows.length && (
                    <button
                      type="button"
                      onClick={() => conferirResto(g)}
                      className="shrink-0 rounded-md bg-emerald-50 px-2 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                      title="Marcar o saldo do sistema como contado nos itens ainda vazios desta prateleira"
                    >
                      Conferir resto
                    </button>
                  )}
                </div>
                {!fechado && g.rows.map((r) => {
            const i = r.flat;
            const st = STATUS_STYLE[r.status];
            return (
              <Card key={r.it.product_id} className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-800">{r.it.product_name}</p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      Sistema: {fmtQty(r.it.system_qty)} {r.it.unit ?? ''}
                      {r.it.target !== null && ` · alvo ${fmtQty(r.it.target)}`}
                      {!!r.it.incoming && <span className="text-sky-600"> · a caminho {fmtQty(r.it.incoming)}</span>}
                      <UnidadeCompraHint it={r.it} />
                    </p>
                  </div>
                  {r.counted === null ? (
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-400">Falta contar</span>
                  ) : (
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>
                  )}
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-500">
                      Contei
                      {r.draft.viaSistema && <ViaSistemaBadge />}
                    </span>
                    <Input
                      value={r.draft.counted}
                      onChange={(e) => setCounted(r.it.product_id, e.target.value, false)}
                      onKeyDown={(e) => onEnterNext(e, 'counted-m', i)}
                      data-cell={`counted-m-${i}`}
                      disabled={!isDraft || !canCount}
                      className="text-right text-base"
                      inputMode="decimal"
                      placeholder="—"
                      aria-label={`Quantidade contada de ${r.it.product_name}`}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-slate-500">
                      Comprar {r.suggested ? <span className="text-emerald-600">(sug. {fmtQty(r.suggested)})</span> : null}
                    </span>
                    <Input
                      value={r.draft.order}
                      onChange={(e) => set(r.it.product_id, 'order', e.target.value)}
                      onKeyDown={(e) => onEnterNext(e, 'order-m', i)}
                      data-cell={`order-m-${i}`}
                      disabled={!canEditOrder}
                      className="text-right text-base"
                      inputMode="decimal"
                      placeholder={fmtQty(r.suggested)}
                      aria-label={`Quantidade a comprar de ${r.it.product_name}`}
                    />
                  </label>
                </div>
              </Card>
            );
                })}
              </div>
            );
          })}
        </div>

        {/* DESKTOP: a tabela densa, que é onde ela funciona bem. */}
        <Card className="hidden overflow-x-auto p-0 md:block">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2.5 font-semibold">Item</th>
                <th className="px-3 py-2.5 text-right font-semibold">Sistema</th>
                <th className="px-3 py-2.5 text-right font-semibold">A caminho</th>
                <th className="px-3 py-2.5 text-right font-semibold">Contado</th>
                <th className="px-3 py-2.5 text-right font-semibold">Alvo</th>
                <th className="px-3 py-2.5 text-center font-semibold">Situação</th>
                <th className="px-3 py-2.5 text-right font-semibold">Sugerido</th>
                <th className="px-3 py-2.5 text-right font-semibold">Comprar</th>
                <th className="px-3 py-2.5 text-right font-semibold">Custo</th>
              </tr>
            </thead>
            {/* Um tbody por prateleira: HTML válido e dá a faixa de agrupamento
                sem quebrar o alinhamento das colunas. */}
            {grupos.map((g) => {
              const contados = g.rows.filter((r) => r.counted !== null).length;
              const fechado = colapsados.has(g.key);
              return (
            <tbody key={g.key}>
              <tr>
                <td colSpan={9} className="border-y border-slate-200 bg-slate-100/70 px-3 py-1.5">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => alternarGrupo(g.key)}
                      className="flex flex-1 items-center gap-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 hover:text-emerald-700"
                    >
                      <span>{g.nome}</span>
                      <span className="font-medium normal-case tracking-normal text-slate-500">
                        {contados} de {g.rows.length} contados
                      </span>
                      <span className="ml-auto font-medium normal-case tracking-normal text-slate-400">
                        {fechado ? 'abrir' : 'fechar'}
                      </span>
                    </button>
                    {isDraft && canCount && contados < g.rows.length && (
                      <button
                        type="button"
                        onClick={() => conferirResto(g)}
                        className="shrink-0 rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium normal-case tracking-normal text-emerald-700 hover:bg-emerald-100"
                        title="Marcar o saldo do sistema como contado nos itens ainda vazios desta prateleira"
                      >
                        Conferir resto
                      </button>
                    )}
                  </div>
                </td>
              </tr>
              {!fechado && g.rows.map((r) => {
                const i = r.flat;
                const st = STATUS_STYLE[r.status];
                const divergiu = r.counted !== null && Math.abs(r.counted - Number(r.it.system_qty)) > 0.0001;
                return (
                  <tr key={r.it.product_id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-3 py-2">
                      <p className="font-medium text-slate-800">{r.it.product_name}</p>
                      {/* A prateleira já é o cabeçalho do grupo e a categoria está
                          preenchida em 1 de 202 produtos — as duas só ocupavam a linha.
                          Fica o que muda por item: unidade e de onde saiu o alvo. */}
                      <p className="text-xs text-slate-400">
                        {r.it.unit ?? 'sem unidade'}
                        {r.it.basis === 'consumo' && r.it.daily_usage
                          ? ` · consumo ${fmtQty(r.it.daily_usage)}/dia`
                          : r.it.basis === 'minmax' ? ' · mín/máx cadastrado' : ' · sem parâmetro'}
                        <UnidadeCompraHint it={r.it} />
                      </p>
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums ${divergiu ? 'text-slate-400 line-through' : 'text-slate-600'}`}>
                      {fmtQty(r.it.system_qty)}
                    </td>
                    <td
                      className="px-3 py-2 text-right tabular-nums text-sky-700"
                      title="Já comprado e ainda não recebido (entradas aguardando nota)"
                    >
                      {r.it.incoming ? fmtQty(r.it.incoming) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="w-28 px-2 py-2">
                      <div className="flex items-center justify-end gap-1">
                        {r.draft.viaSistema && <ViaSistemaBadge />}
                        <Input
                          value={r.draft.counted}
                          onChange={(e) => setCounted(r.it.product_id, e.target.value, false)}
                          onKeyDown={(e) => onEnterNext(e, 'counted', i)}
                          data-cell={`counted-${i}`}
                          disabled={!isDraft || !canCount}
                          className="text-right"
                          inputMode="decimal"
                          placeholder="—"
                          aria-label={`Quantidade contada de ${r.it.product_name}`}
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">{fmtQty(r.it.target)}</td>
                    {/* Sem contagem, "situação" e "sugerido" saem do saldo do sistema —
                        o número que a folha existe para conferir. Fica cinza e fora do
                        total, para não parecer decisão tomada. */}
                    <td className="px-3 py-2 text-center">
                      {r.counted === null ? (
                        <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-400">Falta contar</span>
                      ) : (
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>
                      )}
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${r.counted === null ? 'text-slate-300' : 'font-medium text-slate-700'}`}
                      title={r.counted === null ? 'Estimativa pelo saldo do sistema. Conte o item para valer como sugestão.' : undefined}
                    >
                      {fmtQty(r.suggested)}
                    </td>
                    <td className="w-28 px-2 py-2">
                      <Input
                        value={r.draft.order}
                        onChange={(e) => set(r.it.product_id, 'order', e.target.value)}
                        onKeyDown={(e) => onEnterNext(e, 'order', i)}
                        data-cell={`order-${i}`}
                        disabled={!canEditOrder}
                        className="text-right"
                        inputMode="decimal"
                        placeholder={fmtQty(r.suggested)}
                        aria-label={`Quantidade a comprar de ${r.it.product_name}`}
                      />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-amber-700">
                      {r.finalQty > 0 && r.it.unit_cost ? brl(r.finalQty * Number(r.it.unit_cost)) : <span className="text-slate-300">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
              );
            })}
          </table>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">
            <span>
              Deixe “Comprar” em branco para usar a quantidade sugerida. <kbd className="rounded border border-slate-300 bg-white px-1">Enter</kbd> pula para a linha de baixo.
            </span>
            <span className="font-semibold">Total estimado: {brl(totals.cost)}</span>
          </div>
        </Card>
        </>
      )}
    </div>
  );
}

/**
 * Aviso de que o produto é comprado numa unidade diferente da de estoque (ex.:
 * "CX" vs "un") sem fator de conversão cadastrado — o saldo mostrado ao lado
 * está sempre em unidade de estoque, nunca convertido pra caixa/fardo.
 *
 * Existe porque a folha chegou a rotular "Sistema: 240" como se fosse em CX
 * quando eram 240 unidades — um erro de dezenas de caixas se alguém comprasse
 * por esse número. Sem o fator (Estoque › Parâmetros, campo "múltiplo de
 * compra") não dá pra converter direito, então o aviso é o que existe hoje.
 */
function UnidadeCompraHint({ it }: { it: StockCountItem }) {
  if (!it.purchase_unit || it.purchase_unit === it.unit) return null;
  const semFator = !it.pack_size || Number(it.pack_size) <= 0;
  return (
    <span
      className="text-amber-600"
      title={
        semFator
          ? `Comprado em "${it.purchase_unit}", sem fator de conversão cadastrado — o saldo já está em ${it.unit ?? 'unidade de estoque'}, não em ${it.purchase_unit}. Cadastre o múltiplo de compra em Estoque › Parâmetros para converter certo.`
          : `Comprado em "${it.purchase_unit}" (${it.pack_size} ${it.unit} por ${it.purchase_unit}).`
      }
    >
      {' '}· compra em {it.purchase_unit}{semFator ? ' ⚠' : ''}
    </span>
  );
}

/** Selo do que foi aceito via "Conferir resto" — não é uma contagem física real. */
function ViaSistemaBadge() {
  return (
    <span
      className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500"
      title="Aceito pelo saldo do sistema via &quot;Conferir resto&quot; — não foi contado fisicamente."
    >
      sistema
    </span>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'emerald' | 'amber' }) {
  const color = tone === 'emerald' ? 'text-emerald-700' : tone === 'amber' ? 'text-amber-700' : 'text-slate-800';
  return (
    <Card className="py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-xl font-bold ${color}`}>{value}</p>
    </Card>
  );
}
