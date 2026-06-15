import { api } from './api';
import type {
  Category, Supplier, Item, Quotation, QuotationDetail, ComparisonRow,
  Order, OrderDetail,
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
  create: (body: Partial<Item>) => api.post<Item>('/items', body).then((r) => r.data),
  update: (id: number, body: Partial<Item>) => api.put<Item>(`/items/${id}`, body).then((r) => r.data),
  remove: (id: number) => api.delete(`/items/${id}`).then((r) => r.data),
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
  submit: (id: number) => api.post(`/orders/${id}/submit`).then((r) => r.data),
  approve: (id: number, comment?: string) => api.post(`/orders/${id}/approve`, { comment }).then((r) => r.data),
  reject: (id: number, comment?: string) => api.post(`/orders/${id}/reject`, { comment }).then((r) => r.data),
  send: (id: number) => api.post<{ order: Order; whatsappSent: boolean }>(`/orders/${id}/send`).then((r) => r.data),
  receive: (id: number) => api.post(`/orders/${id}/receive`).then((r) => r.data),
  cancel: (id: number) => api.post(`/orders/${id}/cancel`).then((r) => r.data),
};
