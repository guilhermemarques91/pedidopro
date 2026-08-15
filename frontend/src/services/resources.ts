import { api } from './api';
import type {
  Category, Supplier, Item, Product, Quotation, QuotationDetail, ComparisonRow,
  Order, OrderDetail, User, UserRole, Role, PermissionCatalog, AuditEntry, ProductType, Subclass, ProductionPrinter, RecipeLine, StockMove, StockCount, StockCountDetail, ReplenishRow, PurchaseRequest, RequestDetail,
  DeliveryOrder, DeliveryOrderDetail, DeliveryStatus, DeliveryPlatform, Channel, DeliveryAlert, ReportSummary,
  DeliveryMode, ReportCustomer, ReportItem, ReportPerformance, MenuEngineeringReport,
  MoveReason, StockMovesPage, StockReceipt, ScannedLine,
  Interruption, OpeningShift, StoreSettings, DeliveryMapResponse, GeocodeBackfillResult,
  MarmitexCompany, MarmitexCatalog, CatalogType, MarmitexOrder, MarmitexOrderDetail, ProductionSummary,
  MarmitexReport, MarmitexReportDetail, MarmitexInvoice, MarmitexLabelData,
  MarmitexWaConfig, MarmitexWaDraft, MarmitexWaDraftDetail,
  MenuCategory, MenuItem, MenuItemInput, MenuOptionGroup, MenuOptionGroupInput, MergeDuplicatesResult,
  VendasStation, VendasSale, VendasBoardCard, VendasCreateBody, BoardOrigin, PaymentMethod,
  PaymentLine, VendasPrep, VariationGroupInput,
  FinSource, FinImport, FinImportPreview, FinImportResult, FinAccount, FinAccountsResponse,
  FinSettings, FinDreResponse, FinChannelsResponse, FinProductsResponse, FinCmvResponse,
  FinBreakevenResponse, FinOverviewResponse,
  WaChat, WaMessage, WaUpdates,
  PriceHistoryResponse, AbcResponse,
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
  list: (filters?: number | ItemFilters) => {
    const params = typeof filters === 'number' ? { supplier_id: filters } : (filters ?? {});
    return api.get<Item[]>('/items', { params }).then((r) => r.data);
  },
  get: (id: number) => api.get<Item>(`/items/${id}`).then((r) => r.data),
  create: (body: Partial<Item>) => api.post<Item>('/items', body).then((r) => r.data),
  update: (id: number, body: Partial<Item>) => api.put<Item>(`/items/${id}`, body).then((r) => r.data),
  remove: (id: number) => api.delete(`/items/${id}`).then((r) => r.data),
  linkSupplier: (id: number, body: { supplier_id: number; supplier_code?: string | null; base_price?: number | null }) =>
    api.post<Item>(`/items/${id}/suppliers`, body).then((r) => r.data),
  unlinkSupplier: (id: number, supplierId: number) =>
    api.delete<Item>(`/items/${id}/suppliers/${supplierId}`).then((r) => r.data),
  priceHistory: (id: number) => api.get<PriceHistoryResponse>(`/items/${id}/price-history`).then((r) => r.data),
};

export interface ItemFilters { supplier_id?: number; type_id?: number; category_id?: number }

// ---- Products (produtos canônicos) ----
export interface ProductItem { id: number; name: string; unit: string; base_price: string | null; supplier_name: string }
export interface ProductDetail extends Product { items: ProductItem[]; recipe: RecipeLine[]; variation_groups: VariationGroupInput[] }
export interface UnmappedItem { id: number; name: string; unit: string; supplier_name: string }
export interface SuggestedGroup { suggested_name: string; item_ids: number[]; items: { id: number; name: string; supplier_name: string }[] }

export interface RecipeLineInput {
  component_id: number | null;
  component_name: string | null;
  quantity: number | string;
  unit: string | null;
}
export interface ProductInput {
  name: string;
  tipo?: string | null;
  category_id?: number | null;
  type_id?: number | null;
  sub_classe_id?: number | null;
  production_printer_id?: number | null;
  supplier_id?: number | null;
  unit?: string | null;
  purchase_unit?: string | null;
  cost_price?: number | null;
  sale_price?: number | null;
  // Reposição (alimenta a sugestão de compra da contagem de estoque)
  min_stock?: number | null;
  max_stock?: number | null;
  pack_size?: number | null;
  // Fiscais
  ncm?: string | null;
  cest?: string | null;
  cfop?: string | null;
  cfop_saida_fora?: string | null;
  cfop_entrada?: string | null;
  regime_tributario?: string | null;
  origem?: string | null;
  cst_csosn?: string | null;
  gtin?: string | null;
  // Ficha técnica (campos livres)
  yield_qty?: number | null;
  yield_unit?: string | null;
  prep_time_min?: number | null;
  prep_method?: string | null;
  tech_notes?: string | null;
  image_data?: string | null;   // foto (data URL base64, thumbnail leve)
  // Ficha técnica (receita)
  recipe?: RecipeLineInput[];
  // Variações de ficha técnica (grupos de escolha do PDV)
  variation_groups?: VariationGroupInput[];
}
export interface ProductFilters {
  q?: string; tipo?: string; category_id?: number; type_id?: number; sub_classe_id?: number; supplier_id?: number;
  created_from?: string; created_to?: string;
  cost_min?: number; cost_max?: number; sale_min?: number; sale_max?: number;
  includeInactive?: boolean;
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
export interface MoveFilters {
  product_id?: number; type?: 'in' | 'out' | 'adjust'; reason?: string;
  ref?: string; from?: string; to?: string; q?: string; limit?: number; offset?: number;
}

export const stockApi = {
  moves: (productId?: number, limit = 30) =>
    api.get<StockMove[]>('/stock/moves', { params: { product_id: productId, limit } }).then((r) => r.data),
  /** Extrato: mesma rota, com filtros e totais (o modal do produto segue usando `moves`). */
  ledger: (f: MoveFilters = {}) =>
    api.get<StockMovesPage>('/stock/moves', { params: { ...f, totals: '1' } }).then((r) => r.data),
  move: (body: {
    product_id: number; type: 'in' | 'out' | 'adjust'; quantity: number;
    unit_cost?: number | null; notes?: string | null; reason?: MoveReason | null;
  }) => api.post('/stock/moves', body).then((r) => r.data),
  /** Lançamento em lote: uma transação só — meia perda lançada parece conferida. */
  batch: (body: {
    type: 'in' | 'out' | 'adjust'; reason?: MoveReason | null; notes?: string | null;
    lines: { product_id: number; quantity: number; unit_cost?: number | null }[];
  }) => api.post<{ ok: boolean; moves: unknown[] }>('/stock/moves/batch', body).then((r) => r.data),
};

// ---- Entradas de mercadoria (pedido enviado → nota confirma → estoque) ----
export const receiptsApi = {
  list: (status?: string) =>
    api.get<StockReceipt[]>('/stock/receipts', { params: status ? { status } : {} }).then((r) => r.data),
  get: (id: number) => api.get<StockReceipt>(`/stock/receipts/${id}`).then((r) => r.data),
  /** Entrada avulsa: sem pedido, sem documento — só o fornecedor pra começar a lançar. */
  create: (supplierId: number) =>
    api.post<StockReceipt>('/stock/receipts', { supplier_id: supplierId }).then((r) => r.data),
  update: (id: number, body: { supplier_id?: number; doc_number?: string; doc_date?: string; doc_total?: number }) =>
    api.put<StockReceipt>(`/stock/receipts/${id}`, body).then((r) => r.data),
  addLine: (id: number, body: { product_id: number; doc_name?: string; doc_unit?: string; qty_received: number; price_received?: number | null }) =>
    api.post<StockReceipt>(`/stock/receipts/${id}/items`, body).then((r) => r.data),
  updateLine: (id: number, lineId: number, body: { qty_received?: number | null; price_received?: number | null }) =>
    api.put(`/stock/receipts/${id}/items/${lineId}`, body).then((r) => r.data),
  linkLine: (id: number, lineId: number, productId: number) =>
    api.post(`/stock/receipts/${id}/items/${lineId}/link`, { product_id: productId }).then((r) => r.data),
  confirm: (id: number) =>
    api.post<{ ok: boolean; moved: number; skipped: string[]; order_status: string | null }>(
      `/stock/receipts/${id}/confirm`,
    ).then((r) => r.data),
  cancel: (id: number) => api.post(`/stock/receipts/${id}/cancel`).then((r) => r.data),
  /** Foto/PDF da nota → linhas de rascunho pela IA local. Nada é gravado aqui. */
  scan: (id: number, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api
      .post<{ receipt_id: number; lines: ScannedLine[] }>(`/stock/receipts/${id}/scan`, fd, { timeout: 600000 })
      .then((r) => r.data);
  },
  applyScan: (id: number, lines: { name: string; unit?: string; quantity: number; unit_price?: number }[], docNumber?: string) =>
    api.post(`/stock/receipts/${id}/apply-scan`, { lines, doc_number: docNumber ?? null }).then((r) => r.data),
};

// ---- Curva ABC de compras ----
export const purchasesApi = {
  abc: (params: { from?: string; to?: string; dimension?: 'product' | 'supplier' }) =>
    api.get<AbcResponse>('/purchases/abc', { params }).then((r) => r.data),
};

// ---- Busca global (Ctrl+K) ----
export interface SearchHit { type: string; label: string; hint: string | null; to: string }

export const searchApi = {
  query: (q: string) => api.get<{ results: SearchHit[] }>('/search', { params: { q } }).then((r) => r.data),
};

// ---- Estoque: contagem (inventário) → compra sugerida ----
export interface CountLineInput { product_id: number; counted_qty?: number | null; order_qty?: number | null }

/** Recorte possível para abrir uma folha (sub-classe + quantos itens traz). */
export interface CountScope {
  sub_classe_id: number;
  sub_classe_name: string;
  type_id: number | null;
  type_name: string | null;
  product_count: string;
  last_counted_at: string | null;
}

export const stockCountsApi = {
  scopes: () => api.get<CountScope[]>('/stock/counts/scopes').then((r) => r.data),
  list: () => api.get<StockCount[]>('/stock/counts').then((r) => r.data),
  get: (id: number) => api.get<StockCountDetail>(`/stock/counts/${id}`).then((r) => r.data),
  create: (body: { title?: string; coverage_days?: number; tipo?: string; category_id?: number; type_id?: number; sub_classe_id?: number }) =>
    api.post<StockCountDetail>('/stock/counts', body).then((r) => r.data),
  update: (id: number, body: { title?: string; notes?: string | null; coverage_days?: number; items?: CountLineInput[] }) =>
    api.put<StockCountDetail>(`/stock/counts/${id}`, body).then((r) => r.data),
  apply: (id: number) =>
    api.post<{ adjusted: number; count: StockCountDetail }>(`/stock/counts/${id}/apply`).then((r) => r.data),
  generateRequest: (id: number) =>
    api.post<{ request_id: number; items: number }>(`/stock/counts/${id}/generate-request`).then((r) => r.data),
  remove: (id: number) => api.delete(`/stock/counts/${id}`).then((r) => r.data),
};

// ---- Estoque: parâmetros de reposição (mín/máx/embalagem) em lote ----
export interface ReplenishParamInput {
  product_id: number;
  min_stock?: number | null;
  max_stock?: number | null;
  pack_size?: number | null;
}
export interface ReplenishFilters {
  q?: string; tipo?: string; category_id?: number; type_id?: number; sub_classe_id?: number; only_missing?: 1;
}

export const replenishmentApi = {
  list: (filters?: ReplenishFilters) =>
    api.get<ReplenishRow[]>('/stock/replenishment', { params: filters }).then((r) => r.data),
  save: (items: ReplenishParamInput[]) =>
    api.put<{ saved: number }>('/stock/replenishment', { items }).then((r) => r.data),
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

// ---- Sub-classes (filhas da Classe) ----
export const subclassesApi = {
  list: (typeId?: number) =>
    api.get<Subclass[]>('/product-subclasses', { params: typeId ? { type_id: typeId } : {} }).then((r) => r.data),
  create: (body: { name: string; type_id?: number | null; sort_order?: number }) => api.post<Subclass>('/product-subclasses', body).then((r) => r.data),
  update: (id: number, body: { name?: string; type_id?: number | null; sort_order?: number }) => api.put<Subclass>(`/product-subclasses/${id}`, body).then((r) => r.data),
  remove: (id: number) => api.delete(`/product-subclasses/${id}`).then((r) => r.data),
};

// ---- Impressoras de produção ----
export const printersApi = {
  list: () => api.get<ProductionPrinter[]>('/production-printers').then((r) => r.data),
  create: (body: { name: string; sort_order?: number }) => api.post<ProductionPrinter>('/production-printers', body).then((r) => r.data),
  update: (id: number, body: { name?: string; sort_order?: number }) => api.put<ProductionPrinter>(`/production-printers/${id}`, body).then((r) => r.data),
  remove: (id: number) => api.delete(`/production-printers/${id}`).then((r) => r.data),
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

export interface ProductsImportRow {
  rowNumber: number; external_code: string | null; name: string; tipo: string;
  classe: string | null; sub_classe: string | null; unit: string | null; purchase_unit: string | null;
  sale_price: number | null; cost_price: number | null;
}
export interface ProductsImportPreview {
  filename: string; totalRows: number; validRows: number; errorRows: number;
  newClasses: string[]; newSubclasses: string[]; newProducts: number; updatedProducts: number;
  errors: { rowNumber: number; errors: string[] }[];
  sample: ProductsImportRow[];
}
export interface ProductsImportResult {
  importId: number; totalRows: number; importedRows: number; errorRows: number;
  classesCreated: number; subclassesCreated: number; productsCreated: number; productsUpdated: number;
}
export const productsImportApi = {
  preview: (file: File) => {
    const fd = new FormData(); fd.append('file', file);
    return api.post<ProductsImportPreview>('/import/products/preview', fd).then((r) => r.data);
  },
  commit: (file: File) => {
    const fd = new FormData(); fd.append('file', file);
    return api.post<ProductsImportResult>('/import/products', fd).then((r) => r.data);
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

export interface ReportFilters {
  from?: string;
  to?: string;
  platform?: DeliveryPlatform;
  delivery_mode?: DeliveryMode;
}
export const reportsApi = {
  summary: (f: ReportFilters = {}) =>
    api.get<ReportSummary>('/delivery/reports/summary', { params: f }).then((r) => r.data),
  customers: (
    f: ReportFilters & {
      limit?: number; recurring?: '1'; q?: string;
      sort?: 'spent' | 'orders' | 'name' | 'recent';
    } = {},
  ) =>
    api.get<{ customers: ReportCustomer[] }>('/delivery/reports/customers', { params: f }).then((r) => r.data.customers),
  items: (f: ReportFilters & { limit?: number; q?: string; sort?: 'qty' | 'revenue' | 'name' } = {}) =>
    api.get<{ items: ReportItem[] }>('/delivery/reports/items', { params: f }).then((r) => r.data.items),
  performance: (f: ReportFilters = {}) =>
    api.get<ReportPerformance>('/delivery/reports/performance', { params: f }).then((r) => r.data),
  menuEngineering: (f: ReportFilters = {}) =>
    api.get<MenuEngineeringReport>('/delivery/reports/menu-engineering', { params: f }).then((r) => r.data),
};

// ---- Mapa de pedidos Delivery + relatório de distância ----
export interface MapFilters {
  from?: string;
  to?: string;
  platform?: DeliveryPlatform;
  delivery_mode?: DeliveryMode;
  /** Faixa de distância até a loja, em km (linha reta). */
  min_km?: number;
  max_km?: number;
  /** '1' = só os pedidos sem coordenada (os que precisam de correção manual). */
  without_coords?: '1';
  /** Busca livre: nome do cliente, nº do pedido ou endereço. */
  q?: string;
}

/** Correção manual do endereço; `lat`/`lng` fixam o ponto quando o mapa não acha. */
export interface AddressPatch {
  street?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  lat?: number;
  lng?: number;
}
export const storeSettingsApi = {
  get: () => api.get<StoreSettings>('/delivery/settings/store').then((r) => r.data),
  update: (body: Partial<StoreSettings>) => api.put<StoreSettings>('/delivery/settings/store', body).then((r) => r.data),
};
export const mapApi = {
  list: (f: MapFilters = {}) => api.get<DeliveryMapResponse>('/delivery/map', { params: f }).then((r) => r.data),
  backfill: (limit = 15) =>
    // Cada endereço custa ~2×(1.1s de pausa + rede) no Nominatim: um lote de 15 pode
    // passar de 60s — timeout folgado para não estourar no meio do lote.
    api.post<GeocodeBackfillResult>('/delivery/map/backfill', { limit }, { timeout: 120000 }).then((r) => r.data),
  correctNeighborhood: (orderId: number, neighborhood: string) =>
    api.patch<DeliveryOrderDetail>(`/delivery/orders/${orderId}/address`, { neighborhood }).then((r) => r.data),
  updateAddress: (orderId: number, body: AddressPatch) =>
    api.patch<DeliveryOrderDetail>(`/delivery/orders/${orderId}/address`, body).then((r) => r.data),
  /** Tenta localizar UM pedido agora (após corrigir o endereço à mão). */
  geocodeOne: (orderId: number) =>
    api.post<{ ok: boolean; reason: string | null; lat: number | null; lng: number | null }>(
      `/delivery/orders/${orderId}/geocode`, {}, { timeout: 30000 },
    ).then((r) => r.data),
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
  // 99Food: abre/fecha a loja (setStatus). auto_switch: 1 abre auto, 2 fecha auto, 3 ambos.
  setStoreStatus: (channelId: number, open: boolean, autoSwitch = 3) =>
    api.post(`/delivery/merchant/${channelId}/status`, { open, auto_switch: autoSwitch }).then((r) => r.data),
};

// ---- Cardápio mestre local (publicado p/ iFood e 99Food) ----
export const menuApi = {
  tree: () => api.get<MenuCategory[]>('/delivery/menu').then((r) => r.data),
  remote: (channelId: number) => api.get<Record<string, unknown>>(`/delivery/menu/remote/${channelId}`).then((r) => r.data),
  createCategory: (body: { name: string; sort?: number; active?: boolean }) =>
    api.post<MenuCategory>('/delivery/menu/categories', body).then((r) => r.data),
  updateCategory: (id: number, body: Partial<{ name: string; sort: number; active: boolean }>) =>
    api.put<MenuCategory>(`/delivery/menu/categories/${id}`, body).then((r) => r.data),
  deleteCategory: (id: number) => api.delete(`/delivery/menu/categories/${id}`).then((r) => r.data),
  createItem: (body: MenuItemInput) => api.post<MenuItem>('/delivery/menu/items', body).then((r) => r.data),
  updateItem: (id: number, body: Partial<MenuItemInput>) => api.put<MenuItem>(`/delivery/menu/items/${id}`, body).then((r) => r.data),
  deleteItem: (id: number) => api.delete(`/delivery/menu/items/${id}`).then((r) => r.data),
  setItemAvailability: (id: number, active: boolean) =>
    api.post<{ ok: boolean; active: boolean; errors: { channel: string; error: string }[] }>(`/delivery/menu/items/${id}/availability`, { active }).then((r) => r.data),
  setOptionAvailability: (id: number, active: boolean) =>
    api.post<{ ok: boolean; active: boolean }>(`/delivery/menu/options/${id}/availability`, { active }).then((r) => r.data),
  setGroupAvailability: (id: number, active: boolean) =>
    api.post<{ ok: boolean; active: boolean }>(`/delivery/menu/groups/${id}/availability`, { active }).then((r) => r.data),
  publish: (channelId: number) =>
    api.post<Record<string, unknown>>(`/delivery/menu/publish/${channelId}`, undefined, { timeout: 120000 }).then((r) => r.data),
  import: (channelId: number) =>
    api.post<Record<string, unknown>>(`/delivery/menu/import/${channelId}`, undefined, { timeout: 120000 }).then((r) => r.data),
  /**
   * Preço por canal. `price: null` APAGA o override e devolve o item ao preço base —
   * omitir a linha do lote não mexe nela, então limpar precisa ser explícito.
   */
  setChannelPrices: (
    channelId: number,
    prices: { entity_type: 'item' | 'option'; local_id: number; price: number | null }[],
  ) =>
    api
      .put<{ saved: number; cleared: number }>('/delivery/menu/channel-prices', { channel_id: channelId, prices })
      .then((r) => r.data),
  setChannelMarkup: (channelId: number, markupPct: number | null) =>
    api
      .put<{ channel_id: number; price_markup_pct: number | null }>(`/delivery/menu/channels/${channelId}/markup`, {
        price_markup_pct: markupPct,
      })
      .then((r) => r.data),
};

/**
 * Classes de complementos (Proteínas, Acompanhamentos...): entidades da org, usadas
 * por vários itens. Editar aqui vale em todos os itens que usam a classe.
 */
export const optionGroupsApi = {
  list: () => api.get<MenuOptionGroup[]>('/delivery/menu/option-groups').then((r) => r.data),
  create: (body: MenuOptionGroupInput) =>
    api.post<MenuOptionGroup>('/delivery/menu/option-groups', body).then((r) => r.data),
  update: (id: number, body: Partial<MenuOptionGroupInput>) =>
    api.put<MenuOptionGroup>(`/delivery/menu/option-groups/${id}`, body).then((r) => r.data),
  remove: (id: number) => api.delete(`/delivery/menu/option-groups/${id}`).then((r) => r.data),
  setItems: (id: number, itemIds: number[]) =>
    api.put<MenuOptionGroup>(`/delivery/menu/option-groups/${id}/items`, { item_ids: itemIds }).then((r) => r.data),
  mergeDuplicates: (dryRun: boolean) =>
    api.post<MergeDuplicatesResult>('/delivery/menu/option-groups/merge-duplicates', { dry_run: dryRun }).then((r) => r.data),
};

export const deliveryApi = {
  list: (f: DeliveryFilters = {}) =>
    api.get<DeliveryOrder[]>('/delivery/orders', { params: f }).then((r) => r.data),
  get: (id: number) => api.get<DeliveryOrderDetail>(`/delivery/orders/${id}`).then((r) => r.data),
  confirm: (id: number) => api.post<DeliveryOrderDetail>(`/delivery/orders/${id}/confirm`).then((r) => r.data),
  ready: (id: number) => api.post<DeliveryOrderDetail>(`/delivery/orders/${id}/ready`).then((r) => r.data),
  dispatch: (id: number) => api.post<DeliveryOrderDetail>(`/delivery/orders/${id}/dispatch`).then((r) => r.data),
  conclude: (id: number) => api.post<DeliveryOrderDetail>(`/delivery/orders/${id}/conclude`).then((r) => r.data),
  cancel: (id: number) => api.post<DeliveryOrderDetail>(`/delivery/orders/${id}/cancel`).then((r) => r.data),
  printed: (id: number) => api.post<{ claimed: boolean }>(`/delivery/orders/${id}/printed`).then((r) => r.data),
  printReset: (id: number) => api.post<{ ok: boolean }>(`/delivery/orders/${id}/print-reset`).then((r) => r.data),
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
  authorizationUrl: (id: number) =>
    api.post<{ url: string }>(`/delivery/channels/${id}/authorization-url`).then((r) => r.data),
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
  /** Segunda proteína da mesma marmita ("costelinha e omelete"). */
  protein2_id?: number | null;
  side_ids?: number[];
  observation?: string | null;
}
export interface SaveOrderBody {
  company_id?: number;
  service_date: string;
  notes?: string | null;
  marmitas: MarmitaInput[];
}
export interface CatalogItemBody {
  name?: string; price?: number; sort_order?: number; active?: boolean;
  /** null desvincula o item do produto (deixa de baixar estoque). */
  product_id?: number | null;
}

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
    /** Consumo previsto, sem gravar nada (alimenta o modal de confirmação). */
    productionPreview: (id: number) =>
      api.get<ProductionSummary>(`/marmitex/orders/${id}/production`).then((r) => r.data),
    /** Fecha a produção: baixa os insumos pela ficha técnica e congela o pedido. */
    produce: (id: number) =>
      api.post<ProductionSummary & { order: MarmitexOrderDetail }>(`/marmitex/orders/${id}/produce`).then((r) => r.data),
    /** Estorna a baixa e devolve o pedido para edição. */
    reopen: (id: number) => api.post<MarmitexOrderDetail>(`/marmitex/orders/${id}/reopen`).then((r) => r.data),
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

  /** Pedidos lidos do grupo de WhatsApp: configuração por empresa + fila de revisão. */
  whatsapp: {
    config: (companyId: number) =>
      api.get<MarmitexWaConfig>(`/marmitex/whatsapp/config/${companyId}`).then((r) => r.data),
    saveConfig: (companyId: number, body: Partial<MarmitexWaConfig>) =>
      api.put<MarmitexWaConfig>(`/marmitex/whatsapp/config/${companyId}`, body).then((r) => r.data),
    drafts: (params: { company_id?: number; status?: string; date?: string } = {}) =>
      api.get<MarmitexWaDraft[]>('/marmitex/whatsapp/drafts', { params }).then((r) => r.data),
    count: () => api.get<{ count: number }>('/marmitex/whatsapp/drafts/count').then((r) => r.data.count),
    draft: (id: number) => api.get<MarmitexWaDraftDetail>(`/marmitex/whatsapp/drafts/${id}`).then((r) => r.data),
    addLine: (id: number, body: MarmitaInput) =>
      api.post<{ id: number }>(`/marmitex/whatsapp/drafts/${id}/lines`, body).then((r) => r.data),
    updateLine: (id: number, lineId: number, body: MarmitaInput) =>
      api.put(`/marmitex/whatsapp/drafts/${id}/lines/${lineId}`, body).then((r) => r.data),
    removeLine: (id: number, lineId: number) =>
      api.delete(`/marmitex/whatsapp/drafts/${id}/lines/${lineId}`).then((r) => r.data),
    /** Substitui o pedido daquele dia pelo conteúdo do rascunho. */
    apply: (id: number) =>
      api.post<{ order_id: number }>(`/marmitex/whatsapp/drafts/${id}/apply`).then((r) => r.data),
    discard: (id: number) => api.post(`/marmitex/whatsapp/drafts/${id}/discard`).then((r) => r.data),
    retryMessage: (id: number) => api.post(`/marmitex/whatsapp/messages/${id}/retry`).then((r) => r.data),
    /** Enfileira uma mensagem de teste; a leitura roda no worker (a IA é lenta demais para o HTTP). */
    simulate: (companyId: number, text: string) =>
      api.post<{ queued: boolean; message_id: number }>('/marmitex/whatsapp/simulate', {
        company_id: companyId, text,
      }).then((r) => r.data),
  },

  report: (params: { company_id: number; start?: string; end?: string }) =>
    api.get<MarmitexReport>('/marmitex/report', { params }).then((r) => r.data),
  reportDetail: (params: { company_id: number; start?: string; end?: string }) =>
    api.get<MarmitexReportDetail>('/marmitex/report/detail', { params }).then((r) => r.data),
  closeReport: (body: { company_id: number; start: string; end: string }) =>
    api.post<MarmitexInvoice>('/marmitex/report/close', body).then((r) => r.data),
  invoices: (companyId?: number) =>
    api.get<MarmitexInvoice[]>('/marmitex/invoices', { params: companyId ? { company_id: companyId } : {} }).then((r) => r.data),
  invoice: (id: number) => api.get<MarmitexInvoice>(`/marmitex/invoices/${id}`).then((r) => r.data),
  cancelInvoice: (id: number) => api.post<MarmitexInvoice>(`/marmitex/invoices/${id}/cancel`).then((r) => r.data),
};

// ---- Vendas (balcão, retirada, mesas e comandas) ----
export const vendasApi = {
  board: (origin?: BoardOrigin | '') =>
    api.get<{ cards: VendasBoardCard[] }>('/vendas/board', { params: origin ? { origin } : {} }).then((r) => r.data.cards),
  get: (id: number) => api.get<VendasSale>(`/vendas/${id}`).then((r) => r.data),
  prep: (productId: number) => api.get<VendasPrep>(`/vendas/products/${productId}/prep`).then((r) => r.data),
  create: (body: VendasCreateBody) => api.post<VendasSale>('/vendas', body).then((r) => r.data),
  ready: (id: number) => api.post<VendasSale>(`/vendas/${id}/ready`).then((r) => r.data),
  close: (id: number) => api.post<VendasSale>(`/vendas/${id}/close`).then((r) => r.data),
  reopen: (id: number) => api.post<VendasSale>(`/vendas/${id}/reopen`).then((r) => r.data),
  pay: (id: number, payments?: PaymentLine[] | PaymentMethod) =>
    api.post<VendasSale>(`/vendas/${id}/pay`,
      Array.isArray(payments) ? { payments } : payments ? { payment_method: payments } : {},
    ).then((r) => r.data),
  cancel: (id: number) => api.post<VendasSale>(`/vendas/${id}/cancel`).then((r) => r.data),
  updateItem: (saleId: number, itemId: number, quantity: number) =>
    api.put<VendasSale>(`/vendas/${saleId}/items/${itemId}`, { quantity }).then((r) => r.data),
  removeItem: (saleId: number, itemId: number) =>
    api.delete<VendasSale>(`/vendas/${saleId}/items/${itemId}`).then((r) => r.data),

  stations: {
    list: (kind?: 'mesa' | 'comanda') =>
      api.get<VendasStation[]>('/vendas/stations', { params: kind ? { kind } : {} }).then((r) => r.data),
    create: (body: { kind: 'mesa' | 'comanda'; number: string; label?: string | null }) =>
      api.post<VendasStation>('/vendas/stations', body).then((r) => r.data),
    createBatch: (body: { kind: 'mesa' | 'comanda'; from: number; to: number }) =>
      api.post<{ created: number; reactivated: number; skipped: number }>('/vendas/stations/batch', body).then((r) => r.data),
    update: (id: number, body: Partial<{ number: string; label: string | null; active: boolean }>) =>
      api.put<VendasStation>(`/vendas/stations/${id}`, body).then((r) => r.data),
    remove: (id: number) => api.delete(`/vendas/stations/${id}`).then((r) => r.data),
  },
};

// ---- Financeiro ----
export interface FinChannelsFilters { from: string; to: string }
export interface FinImportOptions {
  /** Ano do relatório de qualidade do iFood (o arquivo não traz o ano). */
  year?: number;
  /** Data do snapshot da ficha técnica, quando a planilha não traz "Emissão:". */
  snapshot_date?: string;
  /** Força a fonte quando a detecção automática erra. */
  source?: FinSource;
}

const finFormData = (file: File, opts?: FinImportOptions) => {
  const fd = new FormData();
  fd.append('file', file);
  if (opts?.year) fd.append('year', String(opts.year));
  if (opts?.snapshot_date) fd.append('snapshot_date', opts.snapshot_date);
  if (opts?.source) fd.append('source', opts.source);
  return fd;
};

export const financeiroApi = {
  preview: (file: File, opts?: FinImportOptions) =>
    api.post<FinImportPreview>('/financeiro/import/preview', finFormData(file, opts)).then((r) => r.data),
  commit: (file: File, opts?: FinImportOptions) =>
    api.post<FinImportResult>('/financeiro/import', finFormData(file, opts)).then((r) => r.data),
  imports: () => api.get<{ imports: FinImport[] }>('/financeiro/imports').then((r) => r.data.imports),
  removeImport: (id: number) => api.delete(`/financeiro/imports/${id}`).then((r) => r.data),

  accounts: (month?: string) =>
    api.get<FinAccountsResponse>('/financeiro/contas', { params: month ? { month } : {} }).then((r) => r.data),
  saveAccounts: (accounts: Partial<FinAccount>[]) =>
    api.put<{ updated: number }>('/financeiro/contas', { accounts }).then((r) => r.data),
  settings: () => api.get<{ settings: FinSettings }>('/financeiro/settings').then((r) => r.data.settings),
  saveSettings: (settings: Partial<FinSettings>) =>
    api.put<{ settings: FinSettings }>('/financeiro/settings', { settings }).then((r) => r.data.settings),

  months: () => api.get<{ months: { ref_month: string; lines: number }[] }>('/financeiro/dre/meses').then((r) => r.data.months),
  dre: (params: { month?: string; compare?: string; mode?: 'gerencial' | 'original' }) =>
    api.get<FinDreResponse>('/financeiro/dre', { params }).then((r) => r.data),
  canais: (params: FinChannelsFilters) =>
    api.get<FinChannelsResponse>('/financeiro/canais', { params }).then((r) => r.data),
  produtos: (params: { snapshot?: string; channel?: string }) =>
    api.get<FinProductsResponse>('/financeiro/produtos', { params }).then((r) => r.data),
  cmv: () => api.get<FinCmvResponse>('/financeiro/cmv').then((r) => r.data),
  breakeven: (params: { month?: string }) =>
    api.get<FinBreakevenResponse>('/financeiro/breakeven', { params }).then((r) => r.data),
  overview: () => api.get<FinOverviewResponse>('/financeiro/overview').then((r) => r.data),
};

/**
 * Caixa de entrada do WhatsApp (janela flutuante da barra superior).
 * Tudo lê do espelho local do backend; a Evolution só entra em `send`,
 * `read` e `backfill`. Ver App\Services\WaInbox.
 */
export const waInboxApi = {
  /** Endpoint quente do polling: devolve só o delta. */
  updates: (since: number) =>
    api.get<WaUpdates>('/whatsapp/inbox/updates', { params: { since } }).then((r) => r.data),
  chats: () => api.get<WaChat[]>('/whatsapp/inbox/chats').then((r) => r.data),
  messages: (chatId: number, before?: number) =>
    api.get<WaMessage[]>(`/whatsapp/inbox/chats/${chatId}/messages`, { params: { before } }).then((r) => r.data),
  read: (chatId: number) => api.post(`/whatsapp/inbox/chats/${chatId}/read`).then((r) => r.data),
  send: (chatId: number, text: string) =>
    api.post<{ id: number; message_ts: string }>(`/whatsapp/inbox/chats/${chatId}/send`, { text }).then((r) => r.data),
  /** Puxa o histórico da Evolution na primeira vez que a conversa é aberta. */
  backfill: (chatId: number) =>
    api.post<{ fetched: number; stored: number }>(`/whatsapp/inbox/chats/${chatId}/backfill`).then((r) => r.data),
};
