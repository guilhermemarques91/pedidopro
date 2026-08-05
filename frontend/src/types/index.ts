// Tipos compartilhados — espelham as respostas da API do backend.

// Papéis são dinâmicos (tabela roles); o valor é a `key` do papel.
export type UserRole = string;

export interface User {
  id: number;
  name: string;
  username: string;
  email?: string | null;
  role: UserRole;
  active: boolean;
  company_id: number | null;
  company_name?: string | null;
  permissions?: string[] | null;      // override individual (null = herda do papel)
  must_change_password?: number | boolean;
  effective_permissions?: string[];   // o que o usuário realmente pode fazer
  created_at: string;
}

export interface Role {
  id: number;
  key: string;
  label: string;
  permissions: string[];
  is_system: boolean;
}

/** Catálogo de permissões: módulo → { label, permissões: { chave → label } }. */
export type PermissionCatalog = Record<string, { label: string; items: Record<string, string> }>;

export interface AuditEntry {
  id: number;
  user_id: number | null;
  username: string | null;
  method: string;
  path: string;
  entity: string | null;
  entity_id: string | null;
  status: number | null;
  ip: string | null;
  created_at: string;
}

export interface Category {
  id: number;
  name: string;
  color: string | null;
  icon: string | null;
  active: boolean;
  created_at: string;
}

export type OrderType = 'portal' | 'whatsapp';

export interface Supplier {
  id: number;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  category_id: number | null;
  category_name?: string | null;
  order_type: OrderType;
  portal_url: string | null;
  whatsapp_number: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
}

export interface Product {
  id: number;
  name: string;
  tipo: string | null;         // eixo fixo (Mercadoria, Produto, Combo, Adicional…)
  category_id: number | null;
  category_name?: string | null;
  type_id: number | null;      // Classe de itens (product_types)
  type_name?: string | null;
  sub_classe_id: number | null;
  sub_classe_name?: string | null;
  production_printer_id?: number | null;   // impressora de produção (direcionamento de pedidos)
  production_printer_name?: string | null;
  supplier_id: number | null;
  supplier_name?: string | null;
  unit: string | null;          // unidade de venda
  purchase_unit?: string | null; // unidade de compra/produção
  cost_price: string | null;   // preço de compra
  sale_price: string | null;   // preço de venda
  // Informações fiscais
  ncm?: string | null;
  cest?: string | null;
  cfop?: string | null;             // CFOP de saída DENTRO do estado (padrão)
  cfop_saida_fora?: string | null;  // CFOP de saída FORA do estado (interestadual)
  cfop_entrada?: string | null;     // CFOP de entrada (compras)
  regime_tributario?: string | null;
  origem?: string | null;      // 0..8 (origem da mercadoria)
  cst_csosn?: string | null;
  gtin?: string | null;        // código de barras (EAN/GTIN)
  // Ficha técnica (campos livres)
  yield_qty?: string | null;
  yield_unit?: string | null;
  prep_time_min?: number | string | null;
  prep_method?: string | null;
  tech_notes?: string | null;
  image_data?: string | null;  // foto (data URL base64, thumbnail leve)
  stock_qty?: string;          // saldo atual (etapa 2 do estoque)
  avg_cost?: string | null;    // custo médio ponderado
  // Reposição: parâmetros usados pela contagem para sugerir a compra
  min_stock?: string | null;   // ponto de pedido (abaixo disso = crítico)
  max_stock?: string | null;   // alvo de reposição (a compra repõe até aqui)
  pack_size?: string | null;   // múltiplo de compra (caixa/fardo)
  item_count?: string;
  default_unit?: string | null;
  active: boolean;
  created_at: string;
}

/** Linha da ficha técnica (insumo/ingrediente de um produto). */
export interface RecipeLine {
  id?: number;
  component_id: number | null;
  component_name: string | null;
  component_product_name?: string | null;
  component_cost?: string | null;   // preço de compra do componente (para custo)
  quantity: string | number;
  unit: string | null;
  sort_order?: number;
}

export interface StockMove {
  id: number;
  product_id: number;
  product_name?: string;
  unit?: string | null;
  type: 'in' | 'out' | 'adjust';
  qty_delta: string;
  unit_cost: string | null;
  balance_after: string;
  ref: string | null;
  notes: string | null;
  user_name?: string | null;
  created_at: string;
}

/** Situação de reposição de uma linha da contagem (ver App\Services\Replenishment). */
export type ReplenishStatus = 'critico' | 'repor' | 'ok' | 'sem_parametro';

/** Linha da folha de contagem: saldo, o que foi contado e a compra sugerida. */
export interface StockCountItem {
  id: number;
  count_id: number;
  product_id: number;
  product_name: string;
  category_name: string | null;
  supplier_name: string | null;
  unit: string | null;
  system_qty: string;        // saldo do sistema quando a folha foi aberta
  current_qty: string;       // saldo vivo do produto agora
  counted_qty: string | null;
  order_qty: string | null;  // quantidade de compra digitada (null = usa a sugerida)
  on_hand: number;           // base do cálculo: o contado, ou o do sistema enquanto não contar
  // Cálculo da sugestão
  min_stock: string | null;
  max_stock: string | null;
  pack_size: string | null;
  target: number | null;
  reorder_point: number | null;
  daily_usage: number | null;
  days_left: number | null;
  suggested: number | null;
  status: ReplenishStatus;
  basis: 'minmax' | 'consumo' | 'sem_parametro';
  unit_cost: string | null;
}

export interface StockCount {
  id: number;
  title: string;
  status: 'draft' | 'applied' | 'cancelled';
  coverage_days: number;
  notes: string | null;
  request_id: number | null;
  created_by_name: string;
  applied_by_name?: string | null;
  created_at: string;
  applied_at: string | null;
  item_count?: string;
  counted_count?: string;
}

export interface StockCountDetail extends StockCount {
  items: StockCountItem[];
  summary: { total: number; counted: number; to_buy: number; critical: number };
}

/** Linha da grade de parâmetros de reposição (mín/máx/embalagem em lote). */
export interface ReplenishRow {
  id: number;
  name: string;
  tipo: string | null;
  unit: string | null;
  purchase_unit: string | null;
  category_name: string | null;
  type_name: string | null;
  stock_qty: string;
  min_stock: string | null;
  max_stock: string | null;
  pack_size: string | null;
  daily_usage: number | null;   // consumo médio diário (saídas dos últimos 30 dias)
  unit_cost: string | null;
}

export interface ProductType {
  id: number;
  name: string;
  sort_order?: number;
}

export interface Subclass {
  id: number;
  name: string;
  type_id: number | null;      // Classe pai (product_types)
  type_name?: string | null;
  sort_order?: number;
}

export interface ProductionPrinter {
  id: number;
  name: string;
  sort_order?: number;
}

export interface ItemSupplierLink {
  supplier_id: number;
  supplier_name: string;
  supplier_code: string | null;
  base_price: string | null;
}

export interface Item {
  id: number;
  supplier_id: number | null;   // fornecedor de origem (legado); item é catálogo — fornecedores vivem em suppliers[]
  supplier_name?: string | null;
  product_id: number | null;
  product_name?: string | null;
  name: string;
  supplier_code: string | null;
  unit: string;
  package_size: string | null;
  package_unit: string | null;
  base_price: string | null;
  // Dados tributários de entrada
  ncm?: string | null;
  cest?: string | null;
  cfop?: string | null;
  origem?: string | null;       // 0..8 (origem da mercadoria)
  cst_csosn?: string | null;
  gtin?: string | null;         // código de barras (EAN/GTIN)
  active: boolean;
  created_at: string;
  supplier_count?: number;
  suppliers?: ItemSupplierLink[];
}

export type QuotationStatus = 'draft' | 'active' | 'closed';

export interface Quotation {
  id: number;
  title: string;
  status: QuotationStatus;
  created_by: number;
  created_by_name?: string;
  item_count?: string;
  created_at: string;
  closed_at: string | null;
}

export interface QuotationItem {
  id: number;
  quotation_id: number;
  item_id: number;
  supplier_id: number;
  price: string | null;
  quantity: string | null;
  notes: string | null;
  source: string;
  extracted_by_ai: boolean;
  reviewed: boolean;
  item_name: string;
  unit: string;
  supplier_name: string;
}

export interface QuotationDetail extends Quotation {
  items: QuotationItem[];
}

export interface ComparisonOffer {
  supplier: string;
  price: number;
  qiId: number;
  isBest: boolean;
  itemName: string;
}
export interface ComparisonRow {
  item: string;
  unit: string;
  bestPrice: number;
  offers: ComparisonOffer[];
}

export type OrderStatus =
  | 'draft' | 'pending_approval' | 'approved' | 'sent' | 'received' | 'cancelled';

export interface Order {
  id: number;
  supplier_id: number;
  supplier_name?: string;
  quotation_id: number | null;
  status: OrderStatus;
  total_amount: string | null;
  notes: string | null;
  created_by: number;
  created_by_name?: string;
  approved_by: number | null;
  approved_by_name?: string | null;
  approved_at: string | null;
  sent_at: string | null;
  received_at: string | null;
  created_at: string;
}

export interface OrderItem {
  id: number;
  order_id: number;
  item_id: number;
  quantity: string;
  unit_price: string;
  subtotal: string;
  notes: string | null;
  item_name: string;
  unit: string;
}

export interface OrderApproval {
  id: number;
  order_id: number;
  action: 'approved' | 'rejected';
  user_id: number;
  user_name: string;
  comment: string | null;
  created_at: string;
}

export interface OrderDetail extends Order {
  order_type?: OrderType;
  whatsapp_number?: string | null;
  items: OrderItem[];
  approvals: OrderApproval[];
}

// ---- Lista de compras (purchase requests) ----
export type RequestStatus = 'draft' | 'submitted' | 'allocated' | 'ordered' | 'cancelled';

export interface PurchaseRequest {
  id: number;
  title: string;
  status: RequestStatus;
  notes: string | null;
  created_by: number;
  created_by_name?: string;
  item_count?: string;
  created_at: string;
  submitted_at: string | null;
}

export interface RequestItemOffer {
  product_id: number;
  item_id: number;
  supplier_id: number;
  supplier_name: string;
  name: string;
  unit: string;
  base_price: string | null;
}

export interface RequestItem {
  id: number;
  request_id: number;
  product_id: number | null;
  source_item_id: number | null;
  product_name: string | null;
  free_text: string | null;
  category_id: number | null;
  category_name: string | null;
  quantity: string;
  unit: string;
  notes: string | null;
  alloc_supplier_id: number | null;
  alloc_item_id: number | null;
  alloc_name: string | null;
  alloc_unit: string | null;
  alloc_price: string | null;
  offers: RequestItemOffer[];
}

export interface RequestDetail extends PurchaseRequest {
  items: RequestItem[];
}

// ---- Delivery (pedidos de clientes: iFood + 99Food) ----
export type DeliveryPlatform = 'ifood' | '99food';
export type DeliveryStatus =
  | 'placed' | 'confirmed' | 'preparing' | 'ready' | 'dispatched' | 'concluded' | 'cancelled';
/** Quem entrega — e portanto quem fica com a taxa. `unknown` = pedido sem o campo gravado. */
export type DeliveryMode = 'own' | 'partner' | 'unknown';

export interface DeliveryAddress {
  street: string | null;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  reference: string | null;
  formatted: string | null;
  lat: number | null;
  lng: number | null;
  /** `manual` = ponto fixado pelo operador; nunca é sobrescrito pelo backfill. */
  geocode_source?: 'platform' | 'nominatim' | 'manual' | null;
  geocode_failed?: string | null;
  geocoded_at?: string | null;
  suggested_neighborhood?: string | null;
  neighborhood_mismatch?: boolean | null;
  neighborhood_original?: string | null;
  neighborhood_corrected_at?: string | null;
}

export interface DeliveryOrder {
  id: number;
  channel_id: number | null;
  platform: DeliveryPlatform;
  platform_order_id: string;
  display_id: string | null;
  locator: string | null;
  merchant_id: string | null;
  status: DeliveryStatus;
  platform_status: string | null;
  order_type: string;
  delivery_mode: DeliveryMode | null;
  delivery_address: DeliveryAddress | null;
  delivery_distance_m: number | null;
  eta: string | null;
  customer_id: number | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_notes: string | null;
  items_amount: string | null;
  delivery_fee: string | null;
  discount_merchant: string | null;
  discount_platform: string | null;
  customer_paid: string | null;
  commission: string | null;
  net_amount: string | null;
  placed_at: string | null;
  confirmed_at: string | null;
  ready_at: string | null;
  dispatched_at: string | null;
  concluded_at: string | null;
  cancelled_at: string | null;
  printed_at: string | null;
  stock_consumed_at: string | null;   // baixa de estoque já feita (null = ainda não / estornada)
  created_at: string;
  items_count?: number;
}

export interface DeliveryOrderItem {
  id: number;
  order_id: number;
  name: string;
  quantity: string;
  unit_price: string | null;
  total: string | null;
  observations: string | null;
  options: unknown;
}

export interface DeliveryOrderDetail extends DeliveryOrder {
  items: DeliveryOrderItem[];
}

// ---- Mapa de pedidos Delivery + relatório de distância ----
export interface StoreSettings {
  id: 1;
  name: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  formatted_address: string | null;
  lat: number | null;
  lng: number | null;
  geocoded_at: string | null;
}

export interface DeliveryMapOrder {
  id: number;
  display_id: string | null;
  platform: DeliveryPlatform;
  customer_name: string | null;
  customer_phone: string | null;
  delivery_mode: string | null;
  customer_paid: number | null;
  delivery_fee: number | null;
  created_at: string | null;
  address: DeliveryAddress | null;
  distance_m: number | null;
  needs_geocode: boolean;
  /** Por que ficou sem pin: 'not_found' (o mapa não conhece) ou 'far_from_store'. */
  geocode_failed: string | null;
}

export interface DeliveryMapResponse {
  store: StoreSettings;
  orders: DeliveryMapOrder[];
  stats: DeliveryMapStats;
}

export interface GeocodeBackfillResult {
  geocoded: number;
  reverse_geocoded: number;
  rejected: number; // resultado do Nominatim longe demais da loja (rua homônima em outra cidade)
  not_found: number; // endereço que o OpenStreetMap não conhece (fica sem pin, honesto)
  remaining: number;
}

export interface DeliveryAlert {
  id: number;
  order_id: number | null;
  platform: DeliveryPlatform;
  platform_order_id: string;
  type: string;
  external_id: string | null;
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  reason: string | null;
  created_at: string;
  // join com delivery_orders
  display_id: string | null;
  customer_name: string | null;
  customer_paid: string | null;
}

export interface Channel {
  id: number;
  platform: DeliveryPlatform;
  name: string;
  merchant_id: string | null;
  client_id: string | null;
  webhook_secret: string | null;
  has_client_secret: boolean;
  active: boolean;
  auto_confirm: boolean;
  commission_rate: number | string;
  created_at: string;
}

// ---- Loja (módulo Merchant iFood) ----
export interface Interruption {
  id: string;
  description: string;
  start: string;
  end: string;
}
export interface OpeningShift {
  id?: string;
  dayOfWeek: string; // MONDAY..SUNDAY
  start: string;     // 'HH:mm:ss'
  duration: number;  // minutos
}

// ---- Cardápio mestre local (delivery) ----
export interface MenuOption {
  id: number;
  group_id: number;
  name: string;
  description: string | null;
  price: number | string;
  image_data: string | null;
  erp_product_id: number | null;      // de-para c/ o ERP: baixa de estoque do complemento
  erp_qty: number | string;           // quanto do produto cada unidade consome (1 = ficha técnica)
  erp_product_name?: string | null;   // só leitura (vem do tree)
  erp_product_unit?: string | null;   // só leitura (vem do tree)
  sort: number;
  active: number | boolean;
}
/**
 * Classe de complementos ("Escolha sua proteína"): pertence à ORG, não a um item.
 * Vários itens usam a mesma classe — editar aqui vale em todos eles.
 */
export interface MenuOptionGroup {
  id: number;
  org_id?: number;
  name: string;
  min: number;
  max: number;
  sort: number;              // ordem DENTRO do item (vem do vínculo)
  active: number | boolean;
  options: MenuOption[];
  used_in?: number;          // em quantos itens a classe está sendo usada
  items?: { id: number; name: string; active: number | boolean }[];
}
export interface MenuOptionGroupInput {
  name?: string;
  min?: number;
  max?: number;
  active?: boolean;
  options?: {
    id?: number;
    name: string;
    description?: string | null;
    price: number;
    image_data?: string | null;
    active?: boolean;
    erp_product_id?: number | null;
    erp_qty?: number | null;
  }[];
  item_ids?: number[];
}
export interface MergeDuplicatesResult {
  dry_run: boolean;
  classes_unificadas: number;
  classes_removidas: number;
  detalhe: { keep: number; name: string; removed: number[] }[];
}
export interface MenuItemChannelLink {
  channel_id: number;
  platform: DeliveryPlatform;
  channel_name: string;
  synced_at: string | null;
}
export interface MenuItem {
  id: number;
  category_id: number;
  name: string;
  description: string | null;
  price: number | string;
  original_price: number | string | null;
  image_url: string | null;
  image_data: string | null;
  external_code: string | null;
  erp_product_id: number | null;
  erp_qty: number | string;           // quanto do produto cada unidade vendida consome
  erp_product_name?: string | null;   // nome do produto do ERP vinculado (só leitura, vem do tree)
  sort: number;
  active: number | boolean;
  groups: MenuOptionGroup[];
  channels?: MenuItemChannelLink[];
}
export interface MenuCategory {
  id: number;
  name: string;
  sort: number;
  active: number | boolean;
  items: MenuItem[];
}
export interface MenuItemInput {
  category_id?: number;
  name?: string;
  description?: string | null;
  price?: number;
  original_price?: number | null;
  image_url?: string | null;
  image_data?: string | null;
  external_code?: string | null;
  erp_product_id?: number | null;
  erp_qty?: number | null;
  sort?: number;
  active?: boolean;
  /** Classes de complementos que o item usa, na ordem. O conteúdo delas é editado no módulo Complementos. */
  group_ids?: number[];
}

// ---- Relatórios de delivery ----
export interface ReportPlatformRow {
  platform: DeliveryPlatform;
  orders: number;
  items_amount: number;
  delivery_fee: number;
  own_delivery_fee: number;
  discount_merchant: number;
  discount_platform: number;
  customer_paid: number;
  commission_est: number;
  margin_est: number;
  avg_ticket: number;
}
export interface ReportModeRow {
  mode: DeliveryMode;
  orders: number;
  customer_paid: number;
  items_amount: number;
  /** Só é receita nossa quando `is_own_fee` (entrega própria). */
  delivery_fee: number;
  is_own_fee: boolean;
  orders_with_fee: number;
  avg_fee: number;
  avg_ticket: number;
}
export interface ReportSummary {
  from: string;
  to: string;
  platform: string | null;
  delivery_mode: string | null;
  totals: Omit<ReportPlatformRow, 'platform'>;
  by_platform: ReportPlatformRow[];
  by_delivery_mode: ReportModeRow[];
  cancellations: { orders: number; lost_amount: number; rate: number };
  customers: {
    new: number;
    /** Alias histórico de `returning`. */
    recurring: number;
    /** Já comprava antes do período (retenção da base antiga). */
    returning: number;
    /** Clientes distintos que pediram no período. */
    active: number;
    /** Tem mais de um pedido no histórico (fidelização). */
    repeat: number;
    one_time: number;
    repeat_rate: number;
  };
  top_regions: { region: string; orders: number; customer_paid: number }[];
}

export interface ReportCustomer {
  id: number;
  name: string | null;
  phone: string | null;
  platform: DeliveryPlatform;
  /** Pedidos dentro do período filtrado. */
  orders: number;
  /** Pedidos no histórico completo — é o que define a recorrência. */
  orders_total: number;
  spent: number;
  avg_ticket: number;
  first_order_at: string | null;
  last_order_at: string | null;
  days_since_last: number | null;
  is_recurring: boolean;
}

export interface ReportItem {
  name: string;
  qty: number;
  orders: number;
  revenue: number;
  avg_price: number;
}

export interface ReportPerformance {
  from: string;
  to: string;
  daily: { day: string; orders: number; revenue: number }[];
  hourly: { hour: number; orders: number; revenue: number }[];
  /** dow: 0 = domingo … 6 = sábado. */
  weekday: { dow: number; orders: number; revenue: number }[];
  timings: {
    to_confirm_min: number | null;
    to_ready_min: number | null;
    to_dispatch_min: number | null;
    to_conclude_min: number | null;
    total_min: number | null;
    concluded: number;
  };
}

/** Resumo de distância do mapa — descreve o período inteiro, não o filtro de faixa. */
export interface DeliveryMapStats {
  total: number;
  measured: number;
  without_coords: number;
  hidden_by_distance: number;
  avg_m: number | null;
  max_m: number | null;
  bands: { key: string; label: string; orders: number; revenue: number }[];
  /** Contagem CUMULATIVA dentro de cada raio (o anel desenhado no mapa). */
  radii: { radius_m: number; orders: number; revenue: number; share: number }[];
}

// ---- Marmitex (catering B2B) ----
export interface MarmitexCompany {
  id: number;
  name: string;
  cnpj: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  order_cutoff_time: string | null; // 'HH:MM:SS'
  active: boolean;
  pending_count?: number;
  created_at: string;
}

export interface MarmitexSize {
  id: number;
  name: string;
  price: string;
  sort_order: number;
  active: boolean;
  /** Produto cuja ficha técnica é explodida na baixa; null = não controla estoque. */
  product_id: number | null;
}
export interface MarmitexOption {
  id: number;
  name: string;
  sort_order: number;
  active: boolean;
  /** Ausente em `observations` (não vira consumo). */
  product_id?: number | null;
}
export interface MarmitexCatalog {
  sizes: MarmitexSize[];
  proteins: MarmitexOption[];
  sides: MarmitexOption[];
  observations: MarmitexOption[];
}
export type CatalogType = 'sizes' | 'proteins' | 'sides' | 'observations';

export interface MarmitaSide {
  id: number;
  name: string;
}
export interface Marmita {
  id: number;
  order_id: number;
  company_id: number;
  service_date: string;
  person_name: string | null;
  size_id: number | null;
  size_name: string;
  protein_id: number | null;
  protein_name: string | null;
  // Backend decodifica para array, mas tolera string (coluna JSON crua) por robustez.
  sides_json: MarmitaSide[] | string | null;
  observation: string | null;
  unit_price: string;
  billed_invoice_id: number | null;
}

/** Uma saída de estoque prevista (prévia) ou efetivada (retorno de `produce`). */
export interface ProductionMove {
  product_id: number;
  product_name: string;
  unit: string | null;
  quantity: number;
  /** Só na prévia: saldo antes da baixa. */
  stock_qty?: number;
  balance_after: number;
}
export interface ProductionSummary {
  moves: ProductionMove[];
  /** Itens do cardápio sem produto vinculado — não movimentam estoque. */
  unlinked: string[];
}

export interface MarmitexOrder {
  id: number;
  company_id: number;
  company_name?: string;
  service_date: string;
  /** 'produced' = produção fechada, estoque baixado; congela a edição. */
  status: 'submitted' | 'cancelled' | 'produced';
  produced_at?: string | null;
  notes: string | null;
  marmita_count?: number;
  total_amount?: string;
  billed_count?: number;
  order_cutoff_time?: string | null;
  created_at: string;
}
export interface MarmitexOrderDetail extends MarmitexOrder {
  marmitas: Marmita[];
}

export interface MarmitexReportRow {
  size_name: string;
  protein_name: string | null;
  unit_price: string;
  quantity: string;
  line_total: string;
}
export interface MarmitexReport {
  company: { id: number; name: string; cnpj: string | null } | null;
  period: { start: string | null; end: string | null };
  rows: MarmitexReportRow[];
  grand_total: number;
  marmita_count: number;
}

/** Uma marmita do período, sem agregação — para conferir nome/dia com a empresa. */
export interface MarmitexReportDetailRow {
  service_date: string;
  person_name: string | null;
  size_name: string;
  protein_name: string | null;
  sides_json: MarmitaSide[] | string | null;
  observation: string | null;
  unit_price: string;
}
export interface MarmitexReportDetail {
  company: { id: number; name: string; cnpj: string | null } | null;
  period: { start: string | null; end: string | null };
  rows: MarmitexReportDetailRow[];
  grand_total: number;
  marmita_count: number;
}

// ---- Marmitex: pedidos lidos do grupo de WhatsApp ----
/** Apelidos da empresa: 'G' → 'Grande'. Editável na tela; é a alavanca de qualidade da leitura. */
export interface MarmitexWaAliases {
  sizes: Record<string, string>;
  proteins: Record<string, string>;
  sides: Record<string, string>;
  /** Texto livre para a observação — abreviação que é recado de cozinha, não item cobrado. */
  notes: Record<string, string>;
}
export interface MarmitexWaConfig {
  company_id: number;
  enabled: boolean;
  group_jid: string;
  /** 'list' = manda a lista inteira de uma vez; 'incremental' = uma pessoa por mensagem. */
  mode: 'list' | 'incremental';
  /** No modo lista, reenviar a lista substitui a anterior (em vez de somar). */
  list_replaces: boolean;
  /** Grava o pedido sozinho quando entendeu 100% das linhas. */
  auto_apply: boolean;
  auto_apply_after_cutoff: boolean;
  /** Responde no grupo confirmando o pedido registrado. */
  confirm_reply: boolean;
  default_size_id: number | null;
  /** Itens pedidos para o grupo, não para uma pessoa (refrigerante da mesa). */
  ownerless_size_ids: number[];
  ai_instructions: string | null;
  enabled_at: string | null;
  last_sweep_at: string | null;
  aliases: MarmitexWaAliases;
}

export type MarmitexWaDraftStatus = 'pending' | 'applied' | 'blocked' | 'discarded';
export type MarmitexWaLineStatus = 'ok' | 'doubt' | 'duplicate' | 'cancelled' | 'superseded';

export interface MarmitexWaDraft {
  id: number;
  company_id: number;
  company_name: string;
  service_date: string;
  status: MarmitexWaDraftStatus;
  block_reason: string | null;
  /** Mensagem chegou depois do horário de corte da empresa. */
  late: boolean;
  auto_applied: boolean;
  applied_order_id: number | null;
  applied_at: string | null;
  ok_count?: string;
  doubt_count?: string;
  line_count?: string;
  updated_at: string;
}

export interface MarmitexWaDraftLine {
  id: number;
  message_id: number | null;
  raw_text: string | null;
  person_name: string | null;
  size_id: number | null;
  protein_id: number | null;
  side_ids: number[];
  observation: string | null;
  status: MarmitexWaLineStatus;
  /** Por que a linha precisa de gente (tamanho fora do cardápio, sem nome, duplicada…). */
  issues: string[];
}

export interface MarmitexWaMessage {
  id: number;
  sender_name: string | null;
  body: string | null;
  message_ts: string | null;
  source: 'webhook' | 'sweep' | 'manual';
  status: 'pending' | 'parsing' | 'parsed' | 'ignored' | 'error' | 'revoked';
  ignore_reason: string | null;
  attempts: number;
  error: string | null;
}

export interface MarmitexWaDraftDetail extends MarmitexWaDraft {
  lines: MarmitexWaDraftLine[];
  messages: MarmitexWaMessage[];
  counts: { ok: number; doubt: number; total: number };
}

export interface MarmitexInvoice {
  id: number;
  company_id: number;
  company_name?: string;
  cnpj?: string | null;
  period_start: string;
  period_end: string;
  status: 'closed' | 'cancelled';
  total_amount: string;
  marmita_count: number;
  report_json: string | null;
  created_at: string;
}

export interface MarmitexLabelData {
  company: { id: number; name: string } | null;
  date: string;
  marmitas: Pick<Marmita, 'id' | 'person_name' | 'size_name' | 'protein_name' | 'sides_json' | 'observation'>[];
}

// ---- Vendas (balcão, retirada, mesas e comandas) ----
export type VendasOrigin = 'mesa' | 'comanda' | 'balcao' | 'retirada';
export type VendasStatus = 'sent' | 'ready' | 'awaiting_payment' | 'completed' | 'cancelled';
export type PaymentMethod = 'dinheiro' | 'debito' | 'credito' | 'pix' | 'outro';
/** Origem unificada do card no board (inclui as plataformas de delivery integrado). */
export type BoardOrigin = VendasOrigin | DeliveryPlatform;
export type BoardColumn = 'enviado' | 'pronto' | 'aguardando_pagamento' | 'concluido';

export interface VendasStationOpenSale {
  id: number;
  status: VendasStatus;
  payment_status: 'pending' | 'paid';
  customer_name: string | null;
  party_size: number | null;
  total_amount: number;
  created_at: string;
}

export interface VendasStation {
  id: number;
  org_id: number;
  kind: 'mesa' | 'comanda';
  number: string;
  label: string | null;
  active: boolean;
  created_at: string;
  has_open_sale?: boolean;
  open_sale?: VendasStationOpenSale | null;
}

export interface SalePayment { id: number; method: PaymentMethod; amount: string | number }
export interface PaymentLine { method: PaymentMethod; amount: number }

export interface SaleItemRemoved { component_id: number | null; name: string }
export interface SaleItemVariation {
  group_id: number;
  group_name: string;
  option_id: number;
  option_name: string;
  component_id: number | null;
  quantity: number;
  price_delta: number;
}

export interface VendasSaleItem {
  id: number;
  sale_id: number;
  product_id: number;
  product_name: string;
  unit_price: string;
  quantity: string;
  subtotal: string;
  round_no: number;
  sent_at: string;
  notes: string | null;
  removed: SaleItemRemoved[];
  variation: SaleItemVariation[];
}

// Tela de observações de preparo do PDV (GET /vendas/products/:id/prep)
export interface VendasPrepRecipeLine { component_id: number | null; name: string; quantity: string; unit: string | null }
export interface VendasPrepOption { id: number; name: string; price_delta: string | number }
export interface VendasPrepGroup { id: number; name: string; required: boolean; options: VendasPrepOption[] }
export interface VendasPrep {
  product_id: number;
  name: string;
  sale_price: number;
  recipe: VendasPrepRecipeLine[];
  groups: VendasPrepGroup[];
}

// Variações de ficha técnica (cadastro do produto)
export interface VariationOptionInput {
  id?: number;
  name: string;
  component_id: number | null;
  component_product_name?: string | null;
  quantity: string | number;
  price_delta: string | number;
}
export interface VariationGroupInput {
  id?: number;
  name: string;
  required: boolean;
  options: VariationOptionInput[];
}

export interface VendasSale {
  id: number;
  org_id: number;
  origin: VendasOrigin;
  station_id: number | null;
  daily_number: number | null;
  status: VendasStatus;
  payment_method: PaymentMethod | 'multi' | null;
  payment_status: 'pending' | 'paid';
  total_amount: string;
  notes: string | null;
  customer_name: string | null;
  party_size: number | null;
  created_by: number | null;
  created_at: string;
  ready_at: string | null;
  paid_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancelled_by: number | null;
  station_kind: 'mesa' | 'comanda' | null;
  station_number: string | null;
  station_label: string | null;
  items: VendasSaleItem[];
  payments: SalePayment[];
}

/** Card unificado do board: uma sales (source 'vendas') ou um delivery_orders (source 'delivery'). */
export interface VendasBoardCard {
  source: 'vendas' | 'delivery';
  id: number;
  origin: BoardOrigin;
  column: BoardColumn | null; // null = cancelado (mostrado à parte)
  status: string;
  payment_status: 'pending' | 'paid';
  payment_method: PaymentMethod | 'multi' | null;
  daily_number: number | null;
  station: { id: number; kind: 'mesa' | 'comanda'; number: string; label: string | null } | null;
  total_amount: number;
  items_count: number;
  created_at: string;
  ready_at: string | null;
  display_id?: string | null;   // só delivery
  customer_name?: string | null;
  party_size?: number | null;   // só vendas
}

export interface VendasCartItem {
  product_id: number;
  quantity: number;
  notes?: string;
  removed_component_ids?: number[];
  variation_option_ids?: number[];
}
export interface VendasCreateBody {
  origin: VendasOrigin;
  station_id?: number;
  payment_method?: PaymentMethod;
  payments?: PaymentLine[];   // pagamento dividido (balcão)
  customer_name?: string;
  party_size?: number;
  items: VendasCartItem[];
}
