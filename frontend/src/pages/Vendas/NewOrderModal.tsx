import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Minus, Plus, Trash2, Armchair, Receipt, ShoppingBag, Bike, Search, ShoppingCart, Package } from 'lucide-react';
import { vendasApi, productsApi } from '../../services/resources';
import { apiError } from '../../services/api';
import type { VendasOrigin, VendasStation, Product } from '../../types';
import { Button, Field, Input, Modal, ErrorBox, EmptyState, Spinner } from '../../components/ui';
import { brl } from '../../utils/format';
import { PaymentSplitEditor, splitIsValid, splitToPayments, type SplitLine } from './shared';
import { PrepModal, type PrepResult } from './PrepModal';

const ORIGINS: { value: VendasOrigin; label: string; icon: typeof Armchair; hint: string }[] = [
  { value: 'mesa', label: 'Mesa', icon: Armchair, hint: 'Atendimento na mesa' },
  { value: 'comanda', label: 'Comanda', icon: Receipt, hint: 'Comanda numerada' },
  { value: 'retirada', label: 'Retirada', icon: Bike, hint: 'Cliente busca depois' },
  { value: 'balcao', label: 'Balcão', icon: ShoppingBag, hint: 'Paga na hora' },
];

// Vendável = Tipo Mercadoria/Produto/Combo (eixo fixo do cadastro) — Adicional fica de fora
// (taxas de entrega/plataforma, não lançadas manualmente no carrinho).
const SELLABLE_TIPOS = new Set(['Mercadoria', 'Produto', 'Combo']);

interface CartLine {
  uid: number;
  product: Product;
  quantity: number;
  unitPrice: number;
  notes: string | null;
  removed: { component_id: number; name: string }[];
  variations: { option_id: number; group: string; label: string }[];
}

export function NewOrderModal({
  onClose, presetOrigin, presetStationId,
}: { onClose: () => void; presetOrigin?: VendasOrigin; presetStationId?: number }) {
  const qc = useQueryClient();
  const [origin, setOrigin] = useState<VendasOrigin | null>(presetOrigin ?? null);
  const [stationId, setStationId] = useState<number | null>(presetStationId ?? null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [search, setSearch] = useState('');
  const [payLines, setPayLines] = useState<SplitLine[]>([{ method: 'dinheiro', amount: '' }]);
  const [customerName, setCustomerName] = useState('');
  const [partySize, setPartySize] = useState('');
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [prepping, setPrepping] = useState<Product | null>(null);
  const nextUid = useRef(1);

  const needsStation = origin === 'mesa' || origin === 'comanda';
  const step: 'origin' | 'station' | 'cart' = !origin ? 'origin' : (needsStation && !stationId) ? 'station' : 'cart';

  const { data: stations, isLoading: loadingStations } = useQuery({
    queryKey: ['vendas-stations', origin],
    queryFn: () => vendasApi.stations.list(origin as 'mesa' | 'comanda'),
    enabled: needsStation,
  });

  const { data: products, isLoading: loadingProducts } = useQuery({
    queryKey: ['products', 'vendaveis'],
    queryFn: () => productsApi.list(),
    enabled: step === 'cart',
  });
  const sellable = useMemo(
    () => (products ?? []).filter((p) => p.active && SELLABLE_TIPOS.has(p.tipo ?? '')),
    [products],
  );

  // Abas do cardápio: uma por Subclasse com produto vendável + "Outros" para quem não tem subclasse.
  const tabs = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of sellable) {
      const key = p.sub_classe_id != null ? String(p.sub_classe_id) : 'outros';
      const label = p.sub_classe_id != null ? (p.sub_classe_name ?? 'Sem nome') : 'Outros';
      if (!map.has(key)) map.set(key, label);
    }
    return Array.from(map.entries())
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => (a.key === 'outros' ? 1 : b.key === 'outros' ? -1 : a.label.localeCompare(b.label, 'pt-BR')));
  }, [sellable]);
  const effectiveTab = activeTab ?? tabs[0]?.key ?? null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q) return sellable.filter((p) => p.name.toLowerCase().includes(q));
    if (effectiveTab === null) return sellable;
    return sellable.filter((p) => (p.sub_classe_id != null ? String(p.sub_classe_id) : 'outros') === effectiveTab);
  }, [sellable, search, effectiveTab]);

  const cartCount = cart.reduce((sum, l) => sum + l.quantity, 0);
  const total = cart.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  const qtyByProduct = useMemo(() => {
    const m = new Map<number, number>();
    for (const l of cart) m.set(l.product.id, (m.get(l.product.id) ?? 0) + l.quantity);
    return m;
  }, [cart]);

  function addFromPrep(product: Product, r: PrepResult) {
    setCart((prev) => [...prev, {
      uid: nextUid.current++,
      product,
      quantity: r.quantity,
      unitPrice: r.unitPrice,
      notes: r.notes,
      removed: r.removed,
      variations: r.variations,
    }]);
    setPrepping(null);
  }
  function changeQty(uid: number, delta: number) {
    setCart((prev) => prev
      .map((l) => (l.uid === uid ? { ...l, quantity: l.quantity + delta } : l))
      .filter((l) => l.quantity > 0));
  }
  function removeLine(uid: number) {
    setCart((prev) => prev.filter((l) => l.uid !== uid));
  }

  const selectedStation = stations?.find((s) => s.id === stationId);
  const isFreshStationSale = needsStation && !selectedStation?.open_sale;
  const payValid = origin !== 'balcao' || splitIsValid(payLines, total);

  const create = useMutation({
    mutationFn: () => vendasApi.create({
      origin: origin as VendasOrigin,
      station_id: stationId ?? undefined,
      payments: origin === 'balcao' ? splitToPayments(payLines, total) : undefined,
      customer_name: isFreshStationSale && customerName.trim() ? customerName.trim() : undefined,
      party_size: isFreshStationSale && partySize ? Number(partySize) : undefined,
      items: cart.map((l) => ({
        product_id: l.product.id,
        quantity: l.quantity,
        notes: l.notes ?? undefined,
        removed_component_ids: l.removed.length ? l.removed.map((r) => r.component_id) : undefined,
        variation_option_ids: l.variations.length ? l.variations.map((v) => v.option_id) : undefined,
      })),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vendas-board'] }); qc.invalidateQueries({ queryKey: ['vendas-stations'] }); onClose(); },
  });

  const originLabel = ORIGINS.find((o) => o.value === origin)?.label;

  const cartPanel = (
    <div className="flex h-full flex-col rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
        <ShoppingCart size={15} /> Pedido
        {cartCount > 0 && (
          <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-bold text-white">{cartCount}</span>
        )}
      </h3>

      {isFreshStationSale && (
        <div className="mb-2 grid grid-cols-[1fr_5rem] gap-2">
          <Field label="Cliente (opcional)">
            <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} maxLength={120} />
          </Field>
          <Field label="Pessoas">
            <Input type="number" min={1} value={partySize} onChange={(e) => setPartySize(e.target.value)} />
          </Field>
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
        {cart.length === 0 && (
          <p className="py-6 text-center text-xs text-slate-400">Toque nos produtos ao lado para adicionar.</p>
        )}
        {cart.map((l) => (
          <div key={l.uid} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm">
            <div className="flex items-center gap-1.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-slate-800">{l.product.name}</p>
                <p className="text-[11px] text-slate-500">{brl(l.unitPrice * l.quantity)}</p>
              </div>
              <button type="button" onClick={() => changeQty(l.uid, -1)}
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Minus size={14} /></button>
              <span className="w-5 text-center text-sm font-semibold">{l.quantity}</span>
              <button type="button" onClick={() => changeQty(l.uid, 1)}
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Plus size={14} /></button>
              <button type="button" onClick={() => removeLine(l.uid)}
                className="rounded-md p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-600"><Trash2 size={14} /></button>
            </div>
            {(l.variations.length > 0 || l.removed.length > 0 || l.notes) && (
              <div className="mt-0.5 space-y-0.5 text-[11px] leading-tight">
                {l.variations.map((v) => (
                  <p key={v.option_id} className="text-emerald-700">{v.group}: {v.label}</p>
                ))}
                {l.removed.map((r) => (
                  <p key={r.component_id} className="text-red-600">Sem {r.name}</p>
                ))}
                {l.notes && <p className="italic text-slate-500">{l.notes}</p>}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-2 border-t border-slate-200 pt-2">
        <div className="mb-2 flex items-center justify-between text-sm font-semibold text-slate-800">
          <span>Total</span>
          <span className="text-lg">{brl(total)}</span>
        </div>
        {origin === 'balcao' && cart.length > 0 && (
          <div className="mb-2">
            <Field label="Pagamento (recebido agora)">
              <PaymentSplitEditor total={total} lines={payLines} onChange={setPayLines} disabled={create.isPending} />
            </Field>
          </div>
        )}
        <Button
          type="button"
          className="w-full justify-center py-2.5"
          disabled={cart.length === 0 || create.isPending || !payValid}
          onClick={() => create.mutate()}
        >
          {origin === 'balcao' ? `Cobrar ${brl(total)}` : 'Enviar pedido'}
        </Button>
      </div>
    </div>
  );

  return (
    <Modal
      title={step === 'cart' && originLabel
        ? `Novo pedido — ${originLabel}${selectedStation ? ` ${selectedStation.number}` : ''}`
        : 'Novo pedido'}
      onClose={onClose}
      size="full"
    >
      <div className="space-y-4">
        {create.error && <ErrorBox message={apiError(create.error)} />}

        {step === 'origin' && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {ORIGINS.map((o) => {
              const Icon = o.icon;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setOrigin(o.value)}
                  className="flex flex-col items-center gap-2 rounded-xl border border-slate-200 p-5 text-center transition hover:border-emerald-400 hover:bg-emerald-50"
                >
                  <Icon size={28} className="text-emerald-600" />
                  <span className="font-medium text-slate-800">{o.label}</span>
                  <span className="text-xs text-slate-500">{o.hint}</span>
                </button>
              );
            })}
          </div>
        )}

        {step === 'station' && (
          <div>
            <p className="mb-3 text-sm text-slate-600">Escolha {origin === 'mesa' ? 'a mesa' : 'a comanda'}:</p>
            {loadingStations && <Spinner />}
            {stations && stations.length === 0 && (
              <EmptyState message={`Nenhuma ${origin === 'mesa' ? 'mesa' : 'comanda'} cadastrada. Cadastre em Vendas → Mesas & Comandas.`} />
            )}
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {stations?.map((s: VendasStation) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStationId(s.id)}
                  className={`rounded-lg border p-3 text-center text-sm font-medium transition ${
                    s.has_open_sale
                      ? 'border-amber-300 bg-amber-50 text-amber-800 hover:border-amber-400'
                      : 'border-slate-200 text-slate-700 hover:border-emerald-400 hover:bg-emerald-50'
                  }`}
                >
                  {s.number}
                  {s.label && <div className="text-xs font-normal text-slate-500">{s.label}</div>}
                  <div className="mt-1 text-[10px] uppercase">{s.has_open_sale ? 'Ocupada · + itens' : 'Livre'}</div>
                </button>
              ))}
            </div>
            <div className="mt-4">
              <Button type="button" variant="secondary" onClick={() => setOrigin(null)}>Voltar</Button>
            </div>
          </div>
        )}

        {step === 'cart' && (
          <div>
            <div className="mb-3 flex items-center justify-between text-xs">
              <button
                type="button"
                className="text-slate-500 underline"
                onClick={() => { setStationId(null); if (!needsStation) setOrigin(null); }}
              >
                ← Trocar {needsStation ? (origin === 'mesa' ? 'mesa' : 'comanda') : 'origem'}
              </button>
              {selectedStation?.open_sale && (
                <span className="rounded bg-blue-50 px-2 py-1 font-medium text-blue-700">
                  Conta aberta: {brl(selectedStation.open_sale.total_amount)} — os itens entram como novo round
                </span>
              )}
            </div>

            <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
              {/* Cardápio — altura FIXA: trocar de aba não muda o tamanho da tela */}
              <div className="flex h-[60vh] min-w-0 flex-col">
                <div className="relative mb-3 shrink-0">
                  <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input
                    placeholder="Buscar produto…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9"
                    autoFocus
                  />
                </div>

                {!search && tabs.length > 0 && (
                  <div className="mb-3 flex shrink-0 gap-2 overflow-x-auto pb-1">
                    {tabs.map((t) => (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => setActiveTab(t.key)}
                        className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                          effectiveTab === t.key ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                )}

                {loadingProducts && <Spinner />}
                <div className="grid min-h-0 flex-1 grid-cols-2 content-start gap-2 overflow-y-auto pb-2 sm:grid-cols-3 xl:grid-cols-4">
                  {filtered.length === 0 && !loadingProducts && <EmptyState message="Nenhum produto vendável encontrado." />}
                  {filtered.map((p) => {
                    const qty = qtyByProduct.get(p.id) ?? 0;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setPrepping(p)}
                        className={`relative flex h-fit flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition active:scale-[0.98] ${
                          qty > 0 ? 'border-emerald-400 bg-emerald-50/60' : 'border-slate-200 hover:border-emerald-400 hover:bg-emerald-50'
                        }`}
                      >
                        {qty > 0 && (
                          <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-600 px-1 text-xs font-bold text-white">
                            {qty}
                          </span>
                        )}
                        <Package size={20} className="text-slate-300" />
                        <span className="line-clamp-2 text-xs font-medium text-slate-800">{p.name}</span>
                        <span className="text-xs font-semibold text-emerald-700">{brl(p.sale_price)}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Mobile: barra que abre o carrinho (no desktop ele fica sempre visível ao lado) */}
                {cartCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setMobileCartOpen(true)}
                    className="mt-3 flex w-full shrink-0 items-center justify-between rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-700 lg:hidden"
                  >
                    <span className="flex items-center gap-2"><ShoppingCart size={16} /> {cartCount} {cartCount === 1 ? 'item' : 'itens'}</span>
                    <span>{brl(total)} · Ver pedido</span>
                  </button>
                )}
              </div>

              {/* Carrinho fixo (desktop) — mesma altura do cardápio */}
              <div className="hidden h-[60vh] lg:block">{cartPanel}</div>
            </div>

            {/* Carrinho em overlay (mobile) */}
            {mobileCartOpen && (
              <div className="fixed inset-0 z-50 flex items-end bg-black/40 lg:hidden" onClick={() => setMobileCartOpen(false)}>
                <div className="max-h-[85vh] w-full overflow-y-auto rounded-t-2xl bg-white p-4" onClick={(e) => e.stopPropagation()}>
                  <button type="button" className="mb-2 text-xs text-slate-500 underline" onClick={() => setMobileCartOpen(false)}>
                    ← Voltar ao cardápio
                  </button>
                  {cartPanel}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {prepping && (
        <PrepModal
          product={prepping}
          onClose={() => setPrepping(null)}
          onConfirm={(r) => addFromPrep(prepping, r)}
        />
      )}
    </Modal>
  );
}
