import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ShoppingCart } from 'lucide-react';
import { requestsApi, suppliersApi, AllocationInput } from '../../services/resources';
import { apiError } from '../../services/api';
import { useAuth } from '../../store/auth.store';
import type { RequestItem, RequestItemOffer } from '../../types';
import { parseNum, numToInput } from '../../utils/format';
import { PageHeader } from '../../components/PageHeader';
import { Button, Card, Select, Input, Badge, Spinner, ErrorBox } from '../../components/ui';

// Estado de alocação de uma linha.
interface Alloc { source: string; supplierId: string; itemId: number | null; name: string; unit: string; price: string }

// Fornecedor "principal" = oferta de menor preço base (ou a primeira cadastrada, se nenhuma tem preço).
function principalOffer(it: RequestItem): RequestItemOffer | null {
  const priced = it.offers.filter((o) => o.base_price != null);
  if (priced.length === 0) return it.offers[0] ?? null;
  return priced.reduce((a, b) => (Number(b.base_price) < Number(a.base_price) ? b : a));
}

function initAlloc(it: RequestItem): Alloc {
  if (it.alloc_supplier_id) {
    return {
      source: it.alloc_item_id ? `item:${it.alloc_item_id}` : 'manual',
      supplierId: String(it.alloc_supplier_id),
      itemId: it.alloc_item_id,
      name: it.alloc_name ?? '',
      unit: it.alloc_unit ?? it.unit,
      price: numToInput(it.alloc_price),
    };
  }
  // Pré-seleciona o fornecedor principal (menor preço, ou o primeiro se nenhum tem preço).
  const best = principalOffer(it);
  if (best) {
    return { source: `item:${best.item_id}`, supplierId: String(best.supplier_id), itemId: best.item_id, name: best.name, unit: best.unit, price: numToInput(best.base_price) };
  }
  return { source: '', supplierId: '', itemId: null, name: it.free_text ?? it.product_name ?? '', unit: it.unit, price: '' };
}

export function RequestDetailPage() {
  const { id } = useParams();
  const requestId = Number(id);
  const qc = useQueryClient();
  const isAdmin = useAuth((s) => s.hasRole('admin'));
  const { data, isLoading, error } = useQuery({ queryKey: ['request', requestId], queryFn: () => requestsApi.get(requestId) });
  const { data: suppliers } = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list, enabled: isAdmin });

  const [alloc, setAlloc] = useState<Record<number, Alloc>>({});
  const [msg, setMsg] = useState('');
  const [createdOrders, setCreatedOrders] = useState<number[]>([]);

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
        item_id: a.source.startsWith('item:') ? a.itemId : null,
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
      const offer = it.offers.find((o) => `item:${o.item_id}` === source)!;
      update(it.id, { source, itemId: offer.item_id, supplierId: String(offer.supplier_id), name: offer.name, unit: offer.unit, price: numToInput(offer.base_price) });
    }
  }

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorBox message={apiError(error) || 'Lista não encontrada'} />;

  // Agrupa por categoria (itens já vêm ordenados por categoria do backend).
  const groups = new Map<string, RequestItem[]>();
  for (const it of items) {
    const k = it.category_name ?? 'Sem categoria';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(it);
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

      {createdOrders.length > 0 && (
        <Card className="mb-4 border-emerald-300 bg-emerald-50">
          <p className="mb-2 font-medium text-emerald-800">✓ {createdOrders.length} pedido(s) gerado(s) — 1 por fornecedor:</p>
          <div className="flex flex-wrap gap-2">
            {createdOrders.map((oid) => (
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

      {data.status === 'ordered' && createdOrders.length === 0 && (
        <Card className="mb-4 border-emerald-200 bg-emerald-50 text-sm text-emerald-800">
          Esta lista já gerou pedidos. Veja-os em <Link to="/orders" className="font-medium underline">Pedidos</Link>.
        </Card>
      )}

      <div className="space-y-6">
        {[...groups.entries()].map(([cat, its]) => (
          <div key={cat}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{cat}</h2>
            <Card className="p-0">
              <table className="w-full text-sm">
                <tbody>
                  {its.map((it) => (
                    <tr key={it.id} className="border-b border-slate-100 align-top last:border-0">
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-800">{it.product_name ?? it.free_text}</p>
                        <p className="text-xs text-slate-400">{it.quantity} {it.unit}{!it.product_id && ' · fora do catálogo'}</p>
                      </td>
                      {allocatable ? (
                        <td className="px-4 py-3">
                          <AllocCell it={it} a={alloc[it.id]} suppliers={suppliers ?? []} onSource={onSource} update={update} />
                        </td>
                      ) : (
                        <td className="px-4 py-3 text-right text-slate-500">
                          {it.alloc_supplier_id ? (
                            <span>{suppliers?.find((s) => s.id === it.alloc_supplier_id)?.name ?? it.alloc_name ?? `Fornecedor ${it.alloc_supplier_id}`}</span>
                          ) : (() => {
                            const p = principalOffer(it);
                            if (!p) return <span className="text-xs text-slate-400">sem fornecedor cadastrado</span>;
                            return (
                              <span>
                                <span className="font-medium text-slate-700">{p.supplier_name}</span>
                                <span className="ml-1 text-xs text-slate-400">(principal)</span>
                              </span>
                            );
                          })()}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        ))}
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
      <Select value={a.source} onChange={(e) => onSource(it, e.target.value)}>
        <option value="">— de onde comprar —</option>
        {it.offers.map((o) => (
          <option key={o.item_id} value={`item:${o.item_id}`}>
            {o.supplier_name}
          </option>
        ))}
        <option value="manual">Outro fornecedor…</option>
      </Select>

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
