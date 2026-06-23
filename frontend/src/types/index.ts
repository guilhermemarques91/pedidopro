// Tipos compartilhados — espelham as respostas da API do backend.

export type UserRole = 'admin' | 'buyer' | 'approver' | 'requester';

export interface User {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
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
