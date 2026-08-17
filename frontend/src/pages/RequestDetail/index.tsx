import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ShoppingCart, MessageCircle, Copy, X, AlertTriangle } from 'lucide-react';
import { requestsApi, suppliersApi, AllocationInput } from '../../services/resources';
import { apiError } from '../../services/api';
import { useAuth } from '../../store/auth.store';
import type { RequestItem, RequestItemOffer } from '../../types';
import { parseNum, numToInput, brl } from '../../utils/format';
import { PageHeader } from '../../components/PageHeader';
import { Button, Card, Select, Input, Badge, Spinner, ErrorBox } from '../../components/ui';

/** Mensagem simples pro fornecedor — mesmo espírito do WhatsApp de pedido, mas montada
 * aqui direto do estado de alocação (ainda não existe pedido pra buscar a mensagem pronta). */
function buildWhatsappMessage(supplierName: string, its: RequestItem[]): string {
  const today = new Date().toLocaleDateString('pt-BR');
  const lines = its.map((it) => `• ${it.quantity} ${it.unit} — ${it.product_name ?? it.free_text}`);
  return `🛒 Lista de compra — ${supplierName}\n📅 ${today}\n\n${lines.join('\n')}`;
}

// Estado de alocação de uma linha.
interface Alloc { source: string; supplierId: string; itemId: number | null; name: string; unit: string; price: string }

// Chave única da oferta (um item pode ter vários fornecedores vinculados).
const offerKey = (o: { item_id: number; supplier_id: number }) => `o:${o.item_id}:${o.supplier_id}`;

/**
 * Fornecedor "principal" de um item: o PADRÃO cadastrado no produto (fornecedor
 * principal, ganha de qualquer preço — é registro, não achado automático) quando ele
 * tem uma oferta correspondente; senão o de menor preço; senão o primeiro cadastrado.
 */
function principalOffer(it: RequestItem): RequestItemOffer | null {
  if (it.default_supplier_id != null) {
    const def = it.offers.find((o) => o.supplier_id === it.default_supplier_id);
    if (def) return def;
  }
  const priced = it.offers.filter((o) => o.base_price != null);
  if (priced.length === 0) return it.offers[0] ?? null;
  return priced.reduce((a, b) => (Number(b.base_price) < Number(a.base_price) ? b : a));
}

/**
 * Diferença percentual entre o preço em jogo na alocação e o custo de referência do
 * produto (mesma fonte da contagem de estoque: avg_cost com fallback pra cost_price).
 * null quando falta um dos dois lados — sem custo de referência não há o que comparar.
 */
function priceDivergencePct(refCost: string | null, price: string | number | null): number | null {
  const ref = refCost !== null ? Number(refCost) : NaN;
  // `price` pode vir cru do backend (ponto decimal, ex.: item.alloc_price) OU já
  // formatado pra input (vírgula, via numToInput — é o caso do estado de alocação em
  // edição) — parseNum() lê os dois; Number() direto quebrava em silêncio com vírgula.
  const p = typeof price === 'number' ? price : parseNum(price ?? '');
  if (!Number.isFinite(ref) || p === null || !Number.isFinite(p) || ref <= 0 || p <= 0) return null;
  return ((p - ref) / ref) * 100;
}

/**
 * Aviso de preço divergente entre a alocação e o custo de referência do produto.
 *
 * Existe porque os dois lados vêm de fontes diferentes e nada os compara hoje:
 * a contagem de estoque usa products.avg_cost/cost_price pro "custo estimado", e a
 * alocação usa items.base_price/item_suppliers.base_price — sem aviso, um preço
 * digitado errado (ou um custo de referência desatualizado) só aparece depois do
 * pedido enviado ao fornecedor.
 */
function PriceDivergenceBadge({ refCost, price }: { refCost: string | null; price: string | number | null }) {
  const pct = priceDivergencePct(refCost, price);
  if (pct === null || Math.abs(pct) < 20) return null;
  const up = pct > 0;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${up ? 'bg-rose-100 text-rose-700' : 'bg-sky-100 text-sky-700'}`}
      title={`Custo de referência do produto (contagem de estoque): ${brl(refCost)}. Este preço está ${Math.abs(pct).toFixed(0)}% ${up ? 'acima' : 'abaixo'} — confira antes de gerar o pedido.`}
    >
      <AlertTriangle size={10} /> {up ? '+' : '−'}{Math.abs(pct).toFixed(0)}%
    </span>
  );
}

function initAlloc(it: RequestItem): Alloc {
  if (it.alloc_supplier_id) {
    return {
      source: it.alloc_item_id ? `o:${it.alloc_item_id}:${it.alloc_supplier_id}` : 'manual',
      supplierId: String(it.alloc_supplier_id),
      itemId: it.alloc_item_id,
      name: it.alloc_name ?? '',
      unit: it.alloc_unit ?? it.unit,
      price: numToInput(it.alloc_price),
    };
  }
  // Pré-seleciona o fornecedor principal (padrão cadastrado, senão o mais barato).
  const best = principalOffer(it);
  if (best) {
    return { source: offerKey(best), supplierId: String(best.supplier_id), itemId: best.item_id, name: best.name, unit: best.unit, price: numToInput(best.base_price) };
  }
  // Sem NENHUMA oferta cadastrada (o caso mais comum — a maioria dos itens de
  // fornecedor não está vinculada a um produto), mas o produto TEM fornecedor
  // padrão: pré-seleciona ele mesmo assim, em modo manual — falta só completar
  // preço/nome, não escolher o fornecedor de novo lista após lista.
  if (it.default_supplier_id != null) {
    return {
      source: 'manual', supplierId: String(it.default_supplier_id),
      itemId: null, name: it.free_text ?? it.product_name ?? '', unit: it.unit, price: '',
    };
  }
  return { source: '', supplierId: '', itemId: null, name: it.free_text ?? it.product_name ?? '', unit: it.unit, price: '' };
}

export function RequestDetailPage() {
  const { id } = useParams();
  const requestId = Number(id);
  const qc = useQueryClient();
  const isAdmin = useAuth((s) => s.can('compras:admin'));
  // A visão por fornecedor + WhatsApp é útil pra quem só CRIA a lista também, não só
  // pra quem aloca — solta a busca de fornecedores (antes só rodava pra admin).
  const canRequest = useAuth((s) => s.can('compras:requests'));
  const { data, isLoading, error } = useQuery({ queryKey: ['request', requestId], queryFn: () => requestsApi.get(requestId) });
  const { data: suppliers } = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list, enabled: isAdmin || canRequest });

  const [alloc, setAlloc] = useState<Record<number, Alloc>>({});
  const [msg, setMsg] = useState('');
  const [createdOrders, setCreatedOrders] = useState<number[]>([]);
  const [groupBy, setGroupBy] = useState<'category' | 'supplier'>('category');
  const [waBox, setWaBox] = useState<{ supplierName: string; message: string; whatsappNumber: string | null } | null>(null);
  const [copied, setCopied] = useState(false);
  // Seleção para alocar vários itens ao mesmo fornecedor num clique — antes cada
  // linha era uma decisão isolada, e uma lista de 20-30 itens do fornecedor de
  // sempre virava 20-30 trocas manuais de <select>.
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkSupplier, setBulkSupplier] = useState('');

  // Inicializa o estado de alocação quando os dados chegam.
  const items = data?.items ?? [];
  useEffect(() => {
    if (data) setAlloc(Object.fromEntries(data.items.map((it) => [it.id, initAlloc(it)])));
  }, [data]);

  const allocatable = isAdmin && (data?.status === 'submitted' || data?.status === 'allocated');

  const submit = useMutation({
    mutationFn: () => requestsApi.submit(requestId),
    onSuccess: () => {
      setMsg('Lista enviada para aprovação.');
      qc.invalidateQueries({ queryKey: ['request', requestId] });
      qc.invalidateQueries({ queryKey: ['requests'] });
    },
    onError: (e) => setMsg(apiError(e)),
  });

  const save = useMutation({
    mutationFn: () => requestsApi.saveAllocation(requestId, buildAllocations()),
    onSuccess: () => { setMsg('Alocação salva.'); qc.invalidateQueries({ queryKey: ['request', requestId] }); },
    onError: (e) => setMsg(apiError(e)),
  });

  const generate = useMutation({
    mutationFn: async () => {
      await requestsApi.saveAllocation(requestId, buildAllocations());
      return requestsApi.generateOrders(requestId);
    },
    onSuccess: (r) => {
      setCreatedOrders(r.orderIds);
      qc.invalidateQueries({ queryKey: ['request', requestId] });
      qc.invalidateQueries({ queryKey: ['requests'] });
      qc.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (e) => setMsg(apiError(e)),
  });

  function buildAllocations(): AllocationInput[] {
    const out: AllocationInput[] = [];
    for (const it of items) {
      const a = alloc[it.id];
      if (!a || !a.supplierId) continue; // preço não é mais obrigatório para salvar
      out.push({
        id: it.id,
        supplier_id: Number(a.supplierId),
        // `source` só assume '', 'manual' ou `o:<itemId>:<supplierId>` (ver offerKey).
        // A condição antiga testava o prefixo 'item:', que NUNCA existiu, então o
        // item_id ia sempre nulo e o backend recriava o item do fornecedor a cada
        // geração de pedido — foi o que produziu 21 duplicatas no catálogo.
        // Testar o caso fechado ('manual' é o único sem item) faz uma origem nova
        // no futuro falhar de forma segura.
        item_id: a.source === 'manual' ? null : a.itemId,
        name: a.source === 'manual' ? a.name : null,
        unit: a.source === 'manual' ? a.unit : null,
        price: parseNum(a.price),
      });
    }
    return out;
  }

  function update(itemId: number, patch: Partial<Alloc>) {
    setAlloc((s) => ({ ...s, [itemId]: { ...s[itemId], ...patch } }));
  }

  function onSource(it: RequestItem, source: string) {
    if (source === 'manual') {
      update(it.id, { source, itemId: null, name: it.free_text ?? it.product_name ?? '', unit: it.unit, supplierId: '', price: '' });
    } else {
      const offer = it.offers.find((o) => offerKey(o) === source)!;
      update(it.id, { source, itemId: offer.item_id, supplierId: String(offer.supplier_id), name: offer.name, unit: offer.unit, price: numToInput(offer.base_price) });
    }
  }

  function toggleSelect(id: number) {
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function toggleSelectGroup(its: RequestItem[]) {
    const ids = its.map((it) => it.id);
    const allSelected = ids.every((id) => selected.has(id));
    setSelected((s) => {
      const n = new Set(s);
      ids.forEach((id) => (allSelected ? n.delete(id) : n.add(id)));
      return n;
    });
  }

  /**
   * Aplica um fornecedor a TODOS os itens selecionados de uma vez, reusando a
   * mesma lógica de onSource() por item: se o fornecedor já tem oferta
   * cadastrada para o item, usa nome/unidade/preço dela; sem oferta, cai em
   * manual com o padrão do item e preço em branco — só essas exceções
   * precisam de complemento manual, não os 10 que já tinham o de sempre.
   */
  function applySupplierToSelection(supplierId: string) {
    if (!supplierId) return;
    const sid = Number(supplierId);
    items.forEach((it) => {
      if (!selected.has(it.id)) return;
      const offer = it.offers.find((o) => o.supplier_id === sid);
      if (offer) {
        update(it.id, { source: offerKey(offer), itemId: offer.item_id, supplierId: String(offer.supplier_id), name: offer.name, unit: offer.unit, price: numToInput(offer.base_price) });
      } else {
        update(it.id, { source: 'manual', itemId: null, name: it.free_text ?? it.product_name ?? '', unit: it.unit, supplierId: String(sid), price: '' });
      }
    });
    setSelected(new Set());
    setBulkSupplier('');
  }

  // Fornecedor mais usado na alocação atual — pré-seleciona a barra de aplicar em
  // massa com a escolha mais provável, poupando o primeiro clique no caso comum.
  const mostUsedSupplierId = useMemo(() => {
    const counts = new Map<string, number>();
    Object.values(alloc).forEach((a) => {
      if (!a.supplierId) return;
      counts.set(a.supplierId, (counts.get(a.supplierId) ?? 0) + 1);
    });
    let best = '';
    let bestN = 0;
    counts.forEach((n, sid) => { if (n > bestN) { best = sid; bestN = n; } });
    return best;
  }, [alloc]);

  // Pedidos gerados desta lista: o backend já devolve `order_ids` (persistente, sobrevive
  // a F5); `createdOrders` só cobre o instante entre o clique e o refetch do invalidate,
  // pra não piscar vazio até a query voltar.
  const orderIds = useMemo(() => {
    const ids = new Set([...(data?.order_ids ?? []), ...createdOrders]);
    return [...ids].sort((a, b) => a - b);
  }, [data?.order_ids, createdOrders]);

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorBox message={apiError(error) || 'Lista não encontrada'} />;

  // Agrupa por categoria (itens já vêm ordenados por categoria do backend) OU por
  // fornecedor alocado — a visão que dá pra montar a lista de WhatsApp por fornecedor.
  type Group = { label: string; whatsapp: string | null; its: RequestItem[] };
  const groups = new Map<string, Group>();
  if (groupBy === 'supplier') {
    for (const it of items) {
      const sid = alloc[it.id]?.supplierId || '';
      const supplier = sid ? suppliers?.find((s) => String(s.id) === sid) : undefined;
      const key = sid || 'sem-fornecedor';
      if (!groups.has(key)) {
        const label = supplier?.name ?? (sid ? (alloc[it.id]?.name || `Fornecedor ${sid}`) : 'Sem fornecedor alocado');
        groups.set(key, { label, whatsapp: supplier?.whatsapp_number ?? null, its: [] });
      }
      groups.get(key)!.its.push(it);
    }
  } else {
    for (const it of items) {
      const k = it.category_name ?? 'Sem categoria';
      if (!groups.has(k)) groups.set(k, { label: k, whatsapp: null, its: [] });
      groups.get(k)!.its.push(it);
    }
  }

  return (
    <div>
      <Link to="/requests" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"><ArrowLeft size={15} /> Voltar</Link>
      <PageHeader
        title={data.title}
        subtitle={`Criada por ${data.created_by_name}`}
        action={<Badge status={data.status} />}
      />

      {msg && <div className="mb-3"><ErrorBox message={msg} /></div>}

      {waBox && (
        <Card className="mb-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">Mensagem para {waBox.supplierName}</h3>
            <button onClick={() => { setWaBox(null); setCopied(false); }} className="text-slate-300 hover:text-slate-600"><X size={16} /></button>
          </div>
          {!waBox.whatsappNumber && (
            <p className="text-sm text-amber-700">Este fornecedor não tem WhatsApp cadastrado — copie a mensagem e envie por onde preferir.</p>
          )}
          <textarea
            readOnly
            value={waBox.message}
            rows={Math.min(16, waBox.message.split('\n').length + 1)}
            className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-700 outline-none"
            onFocus={(e) => e.currentTarget.select()}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => { navigator.clipboard.writeText(waBox.message); setCopied(true); }}
            >
              <Copy size={16} /> {copied ? 'Copiado!' : 'Copiar mensagem'}
            </Button>
            {waBox.whatsappNumber && (
              <a
                href={`https://wa.me/${waBox.whatsappNumber.replace(/\D/g, '')}?text=${encodeURIComponent(waBox.message)}`}
                target="_blank"
                rel="noreferrer"
              >
                <Button><MessageCircle size={16} /> Abrir WhatsApp</Button>
              </a>
            )}
          </div>
        </Card>
      )}

      {orderIds.length > 0 && (
        <Card className="mb-4 border-emerald-300 bg-emerald-50">
          <p className="mb-2 font-medium text-emerald-800">✓ {orderIds.length} pedido(s) gerado(s) desta lista — 1 por fornecedor:</p>
          <div className="flex flex-wrap gap-2">
            {orderIds.map((oid) => (
              <Link key={oid} to={`/orders/${oid}`}><Button variant="secondary"><ShoppingCart size={15} /> Pedido #{oid}</Button></Link>
            ))}
          </div>
        </Card>
      )}

      {data.status === 'draft' && (
        <Card className="mb-4 flex items-center justify-between border-amber-200 bg-amber-50">
          <p className="text-sm text-amber-800">Esta lista ainda é um rascunho. Envie para o administrador organizar a compra.</p>
          <Button disabled={submit.isPending} onClick={() => submit.mutate()}>Enviar para aprovação</Button>
        </Card>
      )}

      {data.status === 'ordered' && orderIds.length === 0 && (
        <Card className="mb-4 border-emerald-200 bg-emerald-50 text-sm text-emerald-800">
          Esta lista já gerou pedidos, mas eles não foram encontrados (podem ter sido excluídos).
          Veja em <Link to="/orders" className="font-medium underline">Pedidos</Link>.
        </Card>
      )}

      {/* Barra de alocação em massa: aparece com a seleção, some ao aplicar. Sem ela,
          alocar 20-30 itens ao fornecedor de sempre era uma troca de <select> por
          linha — aqui é selecionar e aplicar uma vez. */}
      {allocatable && selected.size > 0 && (
        <Card className="mb-4 flex flex-wrap items-center gap-3 border-emerald-300 bg-emerald-50">
          <span className="text-sm font-medium text-emerald-900">{selected.size} item(ns) selecionado(s)</span>
          <Select
            value={bulkSupplier || mostUsedSupplierId}
            onChange={(e) => setBulkSupplier(e.target.value)}
            className="max-w-xs"
          >
            <option value="">— escolha o fornecedor —</option>
            {(suppliers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Button
            type="button"
            disabled={!(bulkSupplier || mostUsedSupplierId)}
            onClick={() => applySupplierToSelection(bulkSupplier || mostUsedSupplierId)}
          >
            Aplicar à seleção
          </Button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-sm text-emerald-700 hover:underline"
          >
            Limpar seleção
          </button>
        </Card>
      )}

      {(isAdmin || canRequest) && (
        <div className="mb-4 inline-flex rounded-lg border border-slate-200 bg-white p-1">
          <button
            type="button"
            onClick={() => setGroupBy('category')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${groupBy === 'category' ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            Por categoria
          </button>
          <button
            type="button"
            onClick={() => setGroupBy('supplier')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${groupBy === 'supplier' ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            Por fornecedor
          </button>
        </div>
      )}

      <div className="space-y-6">
        {[...groups.entries()].map(([key, g]) => {
          const its = g.its;
          const allSelected = its.every((it) => selected.has(it.id));
          return (
          <div key={key}>
            <div className="mb-2 flex items-center gap-2">
              {allocatable && (
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() => toggleSelectGroup(its)}
                  className="h-4 w-4 accent-emerald-600"
                  aria-label={`Selecionar todos os itens de ${g.label}`}
                />
              )}
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{g.label}</h2>
              {groupBy === 'supplier' && key !== 'sem-fornecedor' && (
                <button
                  type="button"
                  onClick={() => setWaBox({ supplierName: g.label, message: buildWhatsappMessage(g.label, its), whatsappNumber: g.whatsapp })}
                  className="ml-auto flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline"
                >
                  <MessageCircle size={13} /> Enviar por WhatsApp
                </button>
              )}
            </div>
            <Card className="p-0">
              <table className="w-full text-sm">
                <tbody>
                  {its.map((it) => (
                    <tr key={it.id} className="border-b border-slate-100 align-top last:border-0">
                      {allocatable && (
                        <td className="w-10 px-3 py-3">
                          <input
                            type="checkbox"
                            checked={selected.has(it.id)}
                            onChange={() => toggleSelect(it.id)}
                            className="h-4 w-4 accent-emerald-600"
                            aria-label={`Selecionar ${it.product_name ?? it.free_text}`}
                          />
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-800">{it.product_name ?? it.free_text}</p>
                        <p className="text-xs text-slate-400">
                          {it.quantity} {it.unit}{!it.product_id && ' · fora do catálogo'}
                          {it.ref_cost && ` · custo ref. ${brl(it.ref_cost)}`}
                        </p>
                      </td>
                      {allocatable ? (
                        <td className="px-4 py-3">
                          <AllocCell it={it} a={alloc[it.id]} suppliers={suppliers ?? []} onSource={onSource} update={update} />
                        </td>
                      ) : (
                        <td className="px-4 py-3 text-right text-slate-500">
                          <div className="flex items-center justify-end gap-1.5">
                            <PriceDivergenceBadge refCost={it.ref_cost} price={it.alloc_price ?? principalOffer(it)?.base_price ?? null} />
                            {it.alloc_supplier_id ? (
                              <span>{suppliers?.find((s) => s.id === it.alloc_supplier_id)?.name ?? it.alloc_name ?? `Fornecedor ${it.alloc_supplier_id}`}</span>
                            ) : (() => {
                              const p = principalOffer(it);
                              if (p) {
                                const isDefault = it.default_supplier_id != null && p.supplier_id === it.default_supplier_id;
                                return (
                                  <span>
                                    <span className="font-medium text-slate-700">{p.supplier_name}</span>
                                    <span className="ml-1 text-xs text-slate-400">{isDefault ? '(padrão)' : '(mais barato)'}</span>
                                  </span>
                                );
                              }
                              // Sem NENHUMA oferta cadastrada, mas o produto tem fornecedor padrão.
                              if (it.default_supplier_name) {
                                return (
                                  <span>
                                    <span className="font-medium text-slate-700">{it.default_supplier_name}</span>
                                    <span className="ml-1 text-xs text-slate-400">(padrão)</span>
                                  </span>
                                );
                              }
                              return <span className="text-xs text-slate-400">sem fornecedor cadastrado</span>;
                            })()}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
          );
        })}
      </div>

      {allocatable && (
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" disabled={save.isPending} onClick={() => save.mutate()}>Salvar alocação</Button>
          <Button disabled={generate.isPending} onClick={() => generate.mutate()}><ShoppingCart size={16} /> Gerar pedidos</Button>
        </div>
      )}
    </div>
  );
}

function AllocCell({
  it, a, suppliers, onSource, update,
}: {
  it: RequestItem;
  a: Alloc | undefined;
  suppliers: { id: number; name: string }[];
  onSource: (it: RequestItem, source: string) => void;
  update: (itemId: number, patch: Partial<Alloc>) => void;
}) {
  if (!a) return null;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Select value={a.source} onChange={(e) => onSource(it, e.target.value)} className="flex-1">
          <option value="">— de onde comprar —</option>
          {it.offers.map((o) => (
            <option key={offerKey(o)} value={offerKey(o)}>
              {o.supplier_name}{o.base_price != null ? ` — R$ ${Number(o.base_price).toFixed(2).replace('.', ',')}` : ''}
              {it.default_supplier_id === o.supplier_id ? ' (padrão)' : ''}
            </option>
          ))}
          <option value="manual">Outro fornecedor…</option>
        </Select>
        <PriceDivergenceBadge refCost={it.ref_cost} price={a.price} />
      </div>

      {a.source === 'manual' && (
        <div className="flex flex-wrap gap-2">
          <SupplierSearch
            id={it.id}
            suppliers={suppliers}
            value={a.supplierId}
            onChange={(supplierId) => update(it.id, { supplierId })}
          />
          <Input value={a.name} onChange={(e) => update(it.id, { name: e.target.value })} placeholder="Nome no fornecedor" className="max-w-[12rem]" />
          <Input value={a.unit} onChange={(e) => update(it.id, { unit: e.target.value })} placeholder="un" className="w-20" />
        </div>
      )}
    </div>
  );
}

// Busca de fornecedores cadastrados (autocomplete nativo via datalist).
function SupplierSearch({
  id, suppliers, value, onChange,
}: {
  id: number;
  suppliers: { id: number; name: string }[];
  value: string;
  onChange: (supplierId: string) => void;
}) {
  const selected = suppliers.find((s) => String(s.id) === value);
  const [text, setText] = useState(selected?.name ?? '');
  useEffect(() => {
    setText(suppliers.find((s) => String(s.id) === value)?.name ?? '');
  }, [value, suppliers]);
  const listId = `suppliers-${id}`;
  return (
    <>
      <Input
        list={listId}
        value={text}
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          const match = suppliers.find((s) => s.name.toLowerCase() === v.trim().toLowerCase());
          onChange(match ? String(match.id) : '');
        }}
        placeholder="Buscar fornecedor cadastrado…"
        className="max-w-[14rem]"
      />
      <datalist id={listId}>
        {suppliers.map((s) => <option key={s.id} value={s.name} />)}
      </datalist>
    </>
  );
}
