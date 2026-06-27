// Tipos compartilhados — espelham as respostas da API do backend.

export type UserRole = 'admin' | 'buyer' | 'approver' | 'requester' | 'company';

export interface User {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  company_id: number | null;
  company_name?: string | null;
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
  category_id: number | null;
  category_name?: string | null;
  item_count?: string;
  default_unit?: string | null;
  active: boolean;
  created_at: string;
}

export interface Item {
  id: number;
  supplier_id: number;
  supplier_name?: string;
  product_id: number | null;
  product_name?: string | null;
  name: string;
  supplier_code: string | null;
  unit: string;
  package_size: string | null;
  package_unit: string | null;
  base_price: string | null;
  active: boolean;
  created_at: string;
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
export type DeliveryMode = 'own' | 'partner';

export interface DeliveryOrder {
  id: number;
  channel_id: number | null;
  platform: DeliveryPlatform;
  platform_order_id: string;
  display_id: string | null;
  merchant_id: string | null;
  status: DeliveryStatus;
  platform_status: string | null;
  order_type: string;
  delivery_mode: DeliveryMode | null;
  delivery_address: Record<string, unknown> | null;
  delivery_distance_m: number | null;
  eta: string | null;
  customer_id: number | null;
  customer_name: string | null;
  customer_phone: string | null;
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
  created_at: string;
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
}
export interface MarmitexOption {
  id: number;
  name: string;
  sort_order: number;
  active: boolean;
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

export interface MarmitexOrder {
  id: number;
  company_id: number;
  company_name?: string;
  service_date: string;
  status: 'submitted' | 'cancelled';
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
