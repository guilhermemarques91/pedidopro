import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Minus, Plus, Trash2, Armchair, Receipt, ShoppingBag, Bike, Search, ShoppingCart, Package } from 'lucide-react';
import { vendasApi, productsApi } from '../../services/resources';
import { apiError } from '../../services/api';
import type { VendasOrigin, VendasStation, PaymentMethod, Product } from '../../types';
import { Button, Field, Input, Select, Modal, ErrorBox, EmptyState, Spinner } from '../../components/ui';
import { brl } from '../../utils/format';

const ORIGINS: { value: VendasOrigin; label: string; icon: typeof Armchair; hint: string }[] = [
  { value: 'mesa', label: 'Mesa', icon: Armchair, hint: 'Atendimento na mesa' },
  { value: 'comanda', label: 'Comanda', icon: Receipt, hint: 'Comanda numerada' },
  { value: 'retirada', label: 'Retirada', icon: Bike, hint: 'Cliente busca depois' },
  { value: 'balcao', label: 'Balcão', icon: ShoppingBag, hint: 'Paga na hora' },
];

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'debito', label: 'Cartão de débito' },
  { value: 'credito', label: 'Cartão de crédito' },
  { value: 'pix', label: 'Pix' },
  { value: 'outro', label: 'Outro' },
];

interface CartLine { product: Product; quantity: number }

export function NewOrderModal({
  onClose, presetOrigin, presetStationId,
}: { onClose: () => void; presetOrigin?: VendasOrigin; presetStationId?: number }) {
  const qc = useQueryClient();
  const [origin, setOrigin] = useState<VendasOrigin | null>(presetOrigin ?? null);
  const [stationId, setStationId] = useState<number | null>(presetStationId ?? null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [search, setSearch] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('dinheiro');
  const [customerName, setCustomerName] = useState('');
  const [partySize, setPartySize] = useState('');
  const [cartView, setCartView] = useState<'menu' | 'review'>('menu');
  const [activeTab, setActiveTab] = useState<string | null>(null);

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
    () => (products ?? []).filter((p) => p.active && ['Cardápio', 'Bebida'].includes(p.type_name ?? '')),
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
  const total = cart.reduce((sum, l) => sum + Number(l.product.sale_price ?? 0) * l.quantity, 0);

  function addProduct(p: Product) {
    setCart((prev) => {
      const found = prev.find((l) => l.product.id === p.id);
      if (found) return prev.map((l) => (l.product.id === p.id ? { ...l, quantity: l.quantity + 1 } : l));
      return [...prev, { product: p, quantity: 1 }];
    });
  }
  function changeQty(productId: number, delta: number) {
    setCart((prev) => prev
      .map((l) => (l.product.id === productId ? { ...l, quantity: l.quantity + delta } : l))
      .filter((l) => l.quantity > 0));
  }
  function removeLine(productId: number) {
    setCart((prev) => prev.filter((l) => l.product.id !== productId));
  }

  const selectedStation = stations?.find((s) => s.id === stationId);
  const isFreshStationSale = needsStation && !selectedStation?.open_sale;

  const create = useMutation({
    mutationFn: () => vendasApi.create({
      origin: origin as VendasOrigin,
      station_id: stationId ?? undefined,
      payment_method: origin === 'balcao' ? paymentMethod : undefined,
      customer_name: isFreshStationSale && customerName.trim() ? customerName.trim() : undefined,
      party_size: isFreshStationSale && partySize ? Number(partySize) : undefined,
      items: cart.map((l) => ({ product_id: l.product.id, quantity: l.quantity })),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vendas-board'] }); qc.invalidateQueries({ queryKey: ['vendas-stations'] }); onClose(); },
  });

  return (
    <Modal title="Novo pedido" onClose={onClose} size="xl">
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
                  className="flex flex-col items-center gap-2 rounded-xl border border-slate-200 p-4 text-center hover:border-emerald-400 hover:bg-emerald-50"
                >
                  <Icon size={26} className="text-emerald-600" />
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
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {stations?.map((s: VendasStation) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStationId(s.id)}
                  className={`rounded-lg border p-3 text-center text-sm font-medium ${
                    s.has_open_sale
                      ? 'border-amber-300 bg-amber-50 text-amber-800'
                      : 'border-slate-200 text-slate-700 hover:border-emerald-400 hover:bg-emerald-50'
                  }`}
                >
                  {s.number}
                  {s.label && <div className="text-xs font-normal text-slate-500">{s.label}</div>}
                  <div className="mt-1 text-[10px] uppercase">{s.has_open_sale ? 'Ocupada' : 'Livre'}</div>
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
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-slate-500">
                Origem: <span className="font-medium text-slate-800">{ORIGINS.find((o) => o.value === origin)?.label}</span>
                {selectedStation && <> — {selectedStation.number}{selectedStation.label ? ` (${selectedStation.label})` : ''}</>}
              </span>
              <button
                type="button"
                className="text-xs text-slate-500 underline"
                onClick={() => { setStationId(null); if (!needsStation) setOrigin(null); }}
              >
                Trocar
              </button>
            </div>

            {isFreshStationSale && (
              <div className="mb-3 grid grid-cols-2 gap-2">
                <Field label="Cliente (opcional)">
                  <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} maxLength={120} />
                </Field>
                <Field label="Pessoas (opcional)">
                  <Input type="number" min={1} value={partySize} onChange={(e) => setPartySize(e.target.value)} />
                </Field>
              </div>
            )}

            {cartView === 'menu' && (
              <div>
                <div className="relative mb-3">
                  <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input
                    placeholder="Buscar produto…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>

                {!search && tabs.length > 0 && (
                  <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
                    {tabs.map((t) => (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => setActiveTab(t.key)}
                        className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${
                          effectiveTab === t.key ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                )}

                {loadingProducts && <Spinner />}
                <div className="grid max-h-[26rem] grid-cols-2 gap-3 overflow-y-auto pb-2 sm:grid-cols-3">
                  {filtered.length === 0 && !loadingProducts && <EmptyState message="Nenhum produto vendável encontrado." />}
                  {filtered.map((p) => {
                    const qty = cart.find((l) => l.product.id === p.id)?.quantity ?? 0;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => addProduct(p)}
                        className="relative flex flex-col items-center gap-1.5 rounded-xl border border-slate-200 p-3 text-center hover:border-emerald-400 hover:bg-emerald-50"
                      >
                        {qty > 0 && (
                          <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-600 px-1 text-xs font-bold text-white">
                            {qty}
                          </span>
                        )}
                        <Package size={22} className="text-slate-300" />
                        <span className="line-clamp-2 text-xs font-medium text-slate-800">{p.name}</span>
                        <span className="text-xs font-semibold text-emerald-700">{brl(p.sale_price)}</span>
                      </button>
                    );
                  })}
                </div>

                {cartCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setCartView('review')}
                    className="mt-3 flex w-full items-center justify-between rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-700"
                  >
                    <span className="flex items-center gap-2"><ShoppingCart size={16} /> {cartCount} {cartCount === 1 ? 'item' : 'itens'}</span>
                    <span>{brl(total)} · Ver carrinho</span>
                  </button>
                )}
              </div>
            )}

            {cartView === 'review' && (
              <div>
                <button type="button" className="mb-3 text-xs text-slate-500 underline" onClick={() => setCartView('menu')}>
                  ← Voltar ao cardápio
                </button>

                {cart.length === 0 && <EmptyState message="Adicione itens ao pedido." />}
                <div className="space-y-2">
                  {cart.map((l) => (
                    <div key={l.product.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                      <span className="flex-1 truncate text-slate-800">{l.product.name}</span>
                      <button type="button" onClick={() => changeQty(l.product.id, -1)} className="text-slate-400 hover:text-slate-700"><Minus size={14} /></button>
                      <span className="w-6 text-center font-medium">{l.quantity}</span>
                      <button type="button" onClick={() => changeQty(l.product.id, 1)} className="text-slate-400 hover:text-slate-700"><Plus size={14} /></button>
                      <span className="w-16 text-right font-medium text-slate-700">{brl(Number(l.product.sale_price ?? 0) * l.quantity)}</span>
                      <button type="button" onClick={() => removeLine(l.product.id)} className="text-slate-400 hover:text-red-600"><Trash2 size={14} /></button>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-3 text-sm font-semibold text-slate-800">
                  <span>Total</span>
                  <span>{brl(total)}</span>
                </div>

                {origin === 'balcao' && (
                  <div className="mt-3">
                    <Field label="Forma de pagamento (recebido agora)">
                      <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}>
                        {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                      </Select>
                    </Field>
                  </div>
                )}
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
              {cartView === 'review' && (
                <Button type="button" disabled={cart.length === 0 || create.isPending} onClick={() => create.mutate()}>
                  Enviar pedido
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
