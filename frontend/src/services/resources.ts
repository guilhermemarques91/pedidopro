import { api } from './api';
import type {
  Category, Supplier, Item, Product, Quotation, QuotationDetail, ComparisonRow,
  Order, OrderDetail, User, UserRole, Role, PermissionCatalog, AuditEntry, ProductType, StockMove, PurchaseRequest, RequestDetail,
  DeliveryOrder, DeliveryOrderDetail, DeliveryStatus, DeliveryPlatform, Channel, DeliveryAlert, ReportSummary,
  Interruption, OpeningShift,
  MarmitexCompany, MarmitexCatalog, CatalogType, MarmitexOrder, MarmitexOrderDetail,
  MarmitexReport, MarmitexInvoice, MarmitexLabelData,
} from '../types';

// ---- Categories ----
export const categoriesApi = {
  list: () => api.get<Category[]>('/categories').then((r) => r.data),
  create: (body: Partial<Category>) => api.post<Category>('/categories', body).then((r) => r.data),
  update: (id: number, body: Partial<Category>) => api.put<Category>(`/categories/${id}`, body).then((r) => r.data),
  remove: (id: number) => api.delete(`/categories/${id}`).then((r) => r.data),
};

// ---- Suppliers ----
export const suppliersApi = {
  list: () => api.get<Supplier[]>('/suppliers').then((r) => r.data),
  create: (body: Partial<Supplier>) => api.post<Supplier>('/suppliers', body).then((r) => r.data),
  update: (id: number, body: Partial<Supplier>) => api.put<Supplier>(`/suppliers/${id}`, body).then((r) => r.data),
  remove: (id: number) => api.delete(`/suppliers/${id}`).then((r) => r.data),
};

// ---- Items ----
export const itemsApi = {
  list: (supplierId?: number) =>
    api.get<Item[]>('/items', { params: supplierId ? { supplier_id: supplierId } : {} }).then((r) => r.data),
  get: (id: number) => api.get<Item>(`/items/${id}`).then((r) => r.data),
  create: (body: Partial<Item>) => api.post<Item>('/items', body).then((r) => r.data),
  update: (id: number, body: Partial<Item>) => api.put<Item>(`/items/${id}`, body).then((r) => r.data),
  remove: (id: number) => api.delete(`/items/${id}`).then((r) => r.data),
  linkSupplier: (id: number, body: { supplier_id: number; supplier_code?: string | null; base_price?: number | null }) =>
    api.post<Item>(`/items/${id}/suppliers`, body).then((r) => r.data),
  unlinkSupplier: (id: number, supplierId: number) =>
    api.delete<Item>(`/items/${id}/suppliers/${supplierId}`).then((r) => r.data),
};

// ---- Products (produtos canônicos) ----
export interface ProductItem { id: number; name: string; unit: string; base_price: string | null; supplier_name: string }
export interface ProductDetail extends Product { items: ProductItem[] }
export interface UnmappedItem { id: number; name: string; unit: string; supplier_name: string }
export interface SuggestedGroup { suggested_name: string; item_ids: number[]; items: { id: number; name: string; supplier_name: string }[] }

export interface ProductInput {
  name: string;
  category_id?: number | null;
  type_id?: number | null;
  supplier_id?: number | null;
  unit?: string | null;
  cost_price?: number | null;
  sale_price?: number | null;
}
export interface ProductFilters {
  q?: string; category_id?: number; type_id?: number; supplier_id?: number;
  created_from?: string; created_to?: string;
  cost_min?: number; cost_max?: number; sale_min?: number; sale_max?: number;
}

export const productsApi = {
  list: (filters?: ProductFilters) => api.get<Product[]>('/products', { params: filters }).then((r) => r.data),
  get: (id: number) => api.get<ProductDetail>(`/products/${id}`).then((r) => r.data),
  unmapped: (forCatalog = false) =>
    api.get<UnmappedItem[]>('/products/unmapped', { params: forCatalog ? { for_catalog: 1 } : {} }).then((r) => r.data),
  suggest: () => api.post<SuggestedGroup[]>('/products/suggest').then((r) => r.data),
  create: (body: ProductInput) => api.post<Product>('/products', body).then((r) => r.data),
  update: (id: number, body: Partial<ProductInput>) => api.put<Product>(`/products/${id}`, body).then((r) => r.data),
  remove: (id: number) => api.delete(`/products/${id}`).then((r) => r.data),
  assign: (productId: number, itemIds: number[]) => api.post<{ assigned: number }>(`/products/${productId}/items`, { item_ids: itemIds }).then((r) => r.data),
  unassign: (itemIds: number[]) => api.post<{ unassigned: number }>('/products/unassign', { item_ids: itemIds }).then((r) => r.data),
};

// ---- Estoque: movimentações ----
export const stockApi = {
  moves: (productId?: number, limit = 30) =>
    api.get<StockMove[]>('/stock/moves', { params: { product_id: productId, limit } }).then((r) => r.data),
  move: (body: { product_id: number; type: 'in' | 'out' | 'adjust'; quantity: number; unit_cost?: number | null; notes?: string | null }) =>
    api.post('/stock/moves', body).then((r) => r.data),
};

export interface MarmitexContractData {
  sizes: { id: number; name: string; base_price: string; contract_price: string | null; enabled: boolean }[];
  proteins: { id: number; name: string; enabled: boolean }[];
  sides: { id: number; name: string; enabled: boolean }[];
  observations: { id: number; name: string; enabled: boolean }[];
}

// ---- Tipos de produto (eixo do cadastro de estoque) ----
export const productTypesApi = {
  list: () => api.get<ProductType[]>('/product-types').then((r) => r.data),
  create: (body: { name: string; sort_order?: number }) => api.post<ProductType>('/product-types', body).then((r) => r.data),
  update: (id: number, body: { name?: string; sort_order?: number }) => api.put<ProductType>(`/product-types/${id}`, body).then((r) => r.data),
  remove: (id: number) => api.delete(`/product-types/${id}`).then((r) => r.data),
};

// ---- Import ----
export interface ImportPreview {
  filename: string; totalRows: number; validRows: number; errorRows: number;
  newSuppliers: string[]; newCategories: string[]; newItems: number; updatedItems: number;
  errors: { rowNumber: number; errors: string[] }[];
}
export interface ImportResult {
  importId: number; totalRows: number; importedRows: number; errorRows: number;
  suppliersCreated: number; categoriesCreated: number; itemsCreated: number; itemsUpdated: number;
}
export const importApi = {
  preview: (file: File) => {
    const fd = new FormData(); fd.append('file', file);
    return api.post<ImportPreview>('/import/preview', fd).then((r) => r.data);
  },
  commit: (file: File) => {
    const fd = new FormData(); fd.append('file', file);
    return api.post<ImportResult>('/import', fd).then((r) => r.data);
  },
};

// ---- Quotations ----
export const quotationsApi = {
  list: () => api.get<Quotation[]>('/quotations').then((r) => r.data),
  get: (id: number) => api.get<QuotationDetail>(`/quotations/${id}`).then((r) => r.data),
  comparison: (id: number) => api.get<ComparisonRow[]>(`/quotations/${id}/comparison`).then((r) => r.data),
  create: (title: string) => api.post<Quotation>('/quotations', { title }).then((r) => r.data),
  close: (id: number) => api.post<Quotation>(`/quotations/${id}/close`).then((r) => r.data),
  remove: (id: number) => api.delete(`/quotations/${id}`).then((r) => r.data),
  addItem: (id: number, body: { item_id: number; supplier_id?: number; price?: number; quantity?: number }) =>
    api.post(`/quotations/${id}/items`, body).then((r) => r.data),
  removeItem: (id: number, itemId: number) => api.delete(`/quotations/${id}/items/${itemId}`).then((r) => r.data),
  extract: (id: number, supplierId: number, file: File) => {
    const fd = new FormData(); fd.append('file', file); fd.append('supplier_id', String(supplierId));
    return api.post(`/quotations/${id}/extract`, fd).then((r) => r.data);
  },
  extractText: (id: number, supplierId: number, text: string) =>
    api.post(`/quotations/${id}/extract-text`, { supplier_id: supplierId, text }).then((r) => r.data),
};

// ---- Orders ----
export interface CreateOrderBody {
  supplier_id: number;
  quotation_id?: number;
  notes?: string;
  items: { item_id: number; quantity: number; unit_price: number; notes?: string }[];
}
export const ordersApi = {
  list: (status?: string) =>
    api.get<Order[]>('/orders', { params: status ? { status } : {} }).then((r) => r.data),
  get: (id: number) => api.get<OrderDetail>(`/orders/${id}`).then((r) => r.data),
  create: (body: CreateOrderBody) => api.post<OrderDetail>('/orders', body).then((r) => r.data),
  remove: (id: number) => api.delete(`/orders/${id}`).then((r) => r.data),
  update: (id: number, body: { notes?: string }) => api.patch<OrderDetail>(`/orders/${id}`, body).then((r) => r.data),
  addItem: (id: number, body: { item_id: number; quantity: number; unit_price: number }) =>
    api.post<OrderDetail>(`/orders/${id}/items`, body).then((r) => r.data),
  updateItem: (id: number, itemRowId: number, body: { quantity?: number; unit_price?: number }) =>
    api.put<OrderDetail>(`/orders/${id}/items/${itemRowId}`, body).then((r) => r.data),
  removeItem: (id: number, itemRowId: number) =>
    api.delete<OrderDetail>(`/orders/${id}/items/${itemRowId}`).then((r) => r.data),
  submit: (id: number) => api.post(`/orders/${id}/submit`).then((r) => r.data),
  approve: (id: number, comment?: string) => api.post(`/orders/${id}/approve`, { comment }).then((r) => r.data),
  reject: (id: number, comment?: string) => api.post(`/orders/${id}/reject`, { comment }).then((r) => r.data),
  send: (id: number) => api.post<{ order: Order; whatsappSent: boolean }>(`/orders/${id}/send`).then((r) => r.data),
  message: (id: number) =>
    api.get<{ message: string; whatsapp_number: string | null; order_type: string }>(`/orders/${id}/message`).then((r) => r.data),
  receive: (id: number) => api.post(`/orders/${id}/receive`).then((r) => r.data),
  cancel: (id: number) => api.post(`/orders/${id}/cancel`).then((r) => r.data),
};

// ---- Inbox (fila de revisão de preços do WhatsApp) ----
export interface InboxRow {
  id: number;
  supplier_id: number;
  supplier_name: string;
  message_key: string;
  raw_message: string | null;
  item_name: string;
  unit: string;
  price: string | null;
  quantity: string | null;
  notes: string | null;
  received_at: string | null;
}
// ---- Users (gestão de acesso — admin) ----
export const usersApi = {
  list: () => api.get<User[]>('/users').then((r) => r.data),
  create: (body: { name: string; username: string; password: string; role: UserRole; email?: string | null; company_id?: number | null; permissions?: string[] | null }) =>
    api.post<User>('/users', body).then((r) => r.data),
  update: (id: number, body: { name?: string; role?: UserRole; password?: string; company_id?: number | null; permissions?: string[] | null }) =>
    api.put<User>(`/users/${id}`, body).then((r) => r.data),
  setActive: (id: number, active: boolean) =>
    api.patch<User>(`/users/${id}/active`, { active }).then((r) => r.data),
  remove: (id: number) => api.delete(`/users/${id}`).then((r) => r.data),
};

// ---- Papéis (roles) + catálogo de permissões ----
export const rolesApi = {
  list: () => api.get<Role[]>('/roles').then((r) => r.data),
  catalog: () => api.get<{ catalog: PermissionCatalog }>('/permissions/catalog').then((r) => r.data.catalog),
  create: (body: { label: string; permissions: string[] }) =>
    api.post<Role>('/roles', body).then((r) => r.data),
  update: (id: number, body: { label?: string; permissions?: string[] }) =>
    api.put<Role>(`/roles/${id}`, body).then((r) => r.data),
  remove: (id: number) => api.delete(`/roles/${id}`).then((r) => r.data),
};

// ---- Trilha de auditoria ----
export const auditApi = {
  list: (params?: { entity?: string; user?: string; limit?: number }) =>
    api.get<AuditEntry[]>('/audit', { params }).then((r) => r.data),
};

// ---- Requests (listas de compra) ----
export interface RequestItemInput {
  product_id?: number | null;
  source_item_id?: number | null;
  free_text?: string | null;
  quantity: number;
  unit?: string;
  notes?: string;
}
export interface AllocationInput {
  id: number;
  supplier_id: number;
  item_id?: number | null;
  name?: string | null;
  unit?: string | null;
  price: number | null;
}
export const requestsApi = {
  list: () => api.get<PurchaseRequest[]>('/requests').then((r) => r.data),
  get: (id: number) => api.get<RequestDetail>(`/requests/${id}`).then((r) => r.data),
  create: (body: { title?: string; notes?: string; items: RequestItemInput[] }) =>
    api.post<PurchaseRequest>('/requests', body).then((r) => r.data),
  update: (id: number, body: { title?: string; notes?: string; items: RequestItemInput[] }) =>
    api.put<PurchaseRequest>(`/requests/${id}`, body).then((r) => r.data),
  submit: (id: number) => api.post<PurchaseRequest>(`/requests/${id}/submit`).then((r) => r.data),
  cancel: (id: number) => api.post<PurchaseRequest>(`/requests/${id}/cancel`).then((r) => r.data),
  remove: (id: number) => api.delete(`/requests/${id}`).then((r) => r.data),
  saveAllocation: (id: number, allocations: AllocationInput[]) =>
    api.put<RequestDetail>(`/requests/${id}/allocation`, { allocations }).then((r) => r.data),
  generateOrders: (id: number) =>
    api.post<{ orderIds: number[] }>(`/requests/${id}/generate-orders`).then((r) => r.data),
};

// ---- Delivery (pedidos de clientes: iFood + 99Food) ----
export interface DeliveryFilters { status?: DeliveryStatus; platform?: DeliveryPlatform; date?: string; all?: boolean }
export interface ChannelInput {
  platform: DeliveryPlatform;
  name: string;
  merchant_id?: string | null;
  client_id?: string | null;
  client_secret?: string | null;
  webhook_secret?: string | null;
  active?: boolean;
  auto_confirm?: boolean;
  commission_rate?: number;
}

export interface ReportFilters { from?: string; to?: string; platform?: DeliveryPlatform }
export const reportsApi = {
  summary: (f: ReportFilters = {}) =>
    api.get<ReportSummary>('/delivery/reports/summary', { params: f }).then((r) => r.data),
};

// ---- Loja (módulo Merchant iFood) ----
export const merchantApi = {
  details: (channelId: number) => api.get<Record<string, unknown>>(`/delivery/merchant/${channelId}/details`).then((r) => r.data),
  status: (channelId: number) => api.get<unknown>(`/delivery/merchant/${channelId}/status`).then((r) => r.data),
  interruptions: (channelId: number) => api.get<Interruption[]>(`/delivery/merchant/${channelId}/interruptions`).then((r) => r.data),
  createInterruption: (channelId: number, body: { description: string; start: string; end: string }) =>
    api.post(`/delivery/merchant/${channelId}/interruptions`, body).then((r) => r.data),
  deleteInterruption: (channelId: number, id: string) =>
    api.delete(`/delivery/merchant/${channelId}/interruptions/${id}`).then((r) => r.data),
  openingHours: (channelId: number) => api.get<{ shifts?: OpeningShift[] }>(`/delivery/merchant/${channelId}/opening-hours`).then((r) => r.data),
  setOpeningHours: (channelId: number, shifts: OpeningShift[]) =>
    api.put(`/delivery/merchant/${channelId}/opening-hours`, { shifts }).then((r) => r.data),
};

export const deliveryApi = {
  list: (f: DeliveryFilters = {}) =>
    api.get<DeliveryOrder[]>('/delivery/orders', { params: f }).then((r) => r.data),
  get: (id: number) => api.get<DeliveryOrderDetail>(`/delivery/orders/${id}`).then((r) => r.data),
  confirm: (id: number) => api.post<DeliveryOrderDetail>(`/delivery/orders/${id}/confirm`).then((r) => r.data),
  ready: (id: number) => api.post<DeliveryOrderDetail>(`/delivery/orders/${id}/ready`).then((r) => r.data),
  dispatch: (id: number) => api.post<DeliveryOrderDetail>(`/delivery/orders/${id}/dispatch`).then((r) => r.data),
  cancel: (id: number) => api.post<DeliveryOrderDetail>(`/delivery/orders/${id}/cancel`).then((r) => r.data),
  tracking: (id: number) => api.get<Record<string, unknown>>(`/delivery/orders/${id}/tracking`).then((r) => r.data),
  sync: () => api.post<{ ok: boolean; channels: { channel: string; platform: string; ingested: number; duplicated: number }[] }>('/delivery/sync').then((r) => r.data),
  alerts: () => api.get<DeliveryAlert[]>('/delivery/alerts').then((r) => r.data),
  acceptAlert: (id: number) => api.post(`/delivery/alerts/${id}/accept`).then((r) => r.data),
  rejectAlert: (id: number) => api.post(`/delivery/alerts/${id}/reject`).then((r) => r.data),
};

export const channelsApi = {
  list: () => api.get<Channel[]>('/delivery/channels').then((r) => r.data),
  create: (body: ChannelInput) => api.post<Channel>('/delivery/channels', body).then((r) => r.data),
  update: (id: number, body: Partial<ChannelInput>) => api.put<Channel>(`/delivery/channels/${id}`, body).then((r) => r.data),
  test: (id: number) =>
    api.post<{ ok: boolean; authenticated: boolean; error?: string; merchants?: { id: string; name: string }[] }>(`/delivery/channels/${id}/test`).then((r) => r.data),
};

export const inboxApi = {
  list: () => api.get<InboxRow[]>('/inbox').then((r) => r.data),
  count: () => api.get<{ count: number }>('/inbox/count').then((r) => r.data.count),
  sync: () => api.post<{ suppliers: number; messagesScanned: number; candidates: number; itemsAdded: number; pending: number }>('/inbox/sync').then((r) => r.data),
  update: (id: number, body: Partial<Pick<InboxRow, 'item_name' | 'unit'>> & { price?: number | null; quantity?: number | null; notes?: string | null }) =>
    api.put<InboxRow>(`/inbox/${id}`, body).then((r) => r.data),
  approve: (ids: number[], quotationId: number) =>
    api.post<{ approved: number; added: number }>('/inbox/approve', { ids, quotation_id: quotationId }).then((r) => r.data),
  discard: (ids: number[]) => api.post<{ discarded: number }>('/inbox/discard', { ids }).then((r) => r.data),
};

// ---- Marmitex (catering B2B) ----
export interface MarmitaInput {
  person_name?: string | null;
  size_id: number;
  protein_id?: number | null;
  side_ids?: number[];
  observation?: string | null;
}
export interface SaveOrderBody {
  company_id?: number;
  service_date: string;
  notes?: string | null;
  marmitas: MarmitaInput[];
}
export interface CatalogItemBody { name?: string; price?: number; sort_order?: number; active?: boolean }

export const marmitexApi = {
  catalog: (companyId?: number | null) =>
    api.get<MarmitexCatalog>('/marmitex/catalog', { params: companyId ? { company_id: companyId } : {} }).then((r) => r.data),
  contract: {
    get: (companyId: number) => api.get<MarmitexContractData>(`/marmitex/companies/${companyId}/contract`).then((r) => r.data),
    update: (companyId: number, body: { prices: { size_id: number; price: number | null }[]; hidden: Record<string, number[]> }) =>
      api.put<MarmitexContractData>(`/marmitex/companies/${companyId}/contract`, body).then((r) => r.data),
  },
  catalogCreate: (type: CatalogType, body: CatalogItemBody) =>
    api.post(`/marmitex/catalog/${type}`, body).then((r) => r.data),
  catalogUpdate: (type: CatalogType, id: number, body: CatalogItemBody) =>
    api.put(`/marmitex/catalog/${type}/${id}`, body).then((r) => r.data),
  catalogRemove: (type: CatalogType, id: number) =>
    api.delete(`/marmitex/catalog/${type}/${id}`).then((r) => r.data),

  companies: {
    list: () => api.get<MarmitexCompany[]>('/marmitex/companies').then((r) => r.data),
    get: (id: number) => api.get<MarmitexCompany>(`/marmitex/companies/${id}`).then((r) => r.data),
    create: (body: Partial<MarmitexCompany>) => api.post<MarmitexCompany>('/marmitex/companies', body).then((r) => r.data),
    update: (id: number, body: Partial<MarmitexCompany>) => api.put<MarmitexCompany>(`/marmitex/companies/${id}`, body).then((r) => r.data),
  },

  orders: {
    list: (params: { company_id?: number; date?: string } = {}) =>
      api.get<MarmitexOrder[]>('/marmitex/orders', { params }).then((r) => r.data),
    get: (id: number) => api.get<MarmitexOrderDetail>(`/marmitex/orders/${id}`).then((r) => r.data),
    save: (body: SaveOrderBody) => api.post<MarmitexOrderDetail>('/marmitex/orders', body).then((r) => r.data),
    remove: (id: number) => api.delete(`/marmitex/orders/${id}`).then((r) => r.data),
  },

  labels: (params: { date: string; company_id?: number }) =>
    api.get<MarmitexLabelData>('/marmitex/labels', { params }).then((r) => r.data),

  orderTemplate: () => api.get('/marmitex/orders/template', { responseType: 'blob' }).then((r) => r.data as Blob),
  importSheet: (file: File) => {
    const fd = new FormData(); fd.append('file', file);
    return api.post<{ marmitas: MarmitaInput[]; errors: { row: number; messages: string[] }[]; imported: number }>(
      '/marmitex/orders/import', fd,
    ).then((r) => r.data);
  },

  report: (params: { company_id: number; start?: string; end?: string }) =>
    api.get<MarmitexReport>('/marmitex/report', { params }).then((r) => r.data),
  closeReport: (body: { company_id: number; start: string; end: string }) =>
    api.post<MarmitexInvoice>('/marmitex/report/close', body).then((r) => r.data),
  invoices: (companyId?: number) =>
    api.get<MarmitexInvoice[]>('/marmitex/invoices', { params: companyId ? { company_id: companyId } : {} }).then((r) => r.data),
  invoice: (id: number) => api.get<MarmitexInvoice>(`/marmitex/invoices/${id}`).then((r) => r.data),
  cancelInvoice: (id: number) => api.post<MarmitexInvoice>(`/marmitex/invoices/${id}/cancel`).then((r) => r.data),
};
