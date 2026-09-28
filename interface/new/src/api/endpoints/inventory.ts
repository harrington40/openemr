import nestClient from '../nest-client';

export interface InventoryItem {
  id: number;
  item_name: string;
  item_code: string | null;
  description: string | null;
  category: string;
  department: string | null;
  storage_location: string | null;
  current_quantity: number;
  minimum_quantity: number;
  unit: string | null;
  unit_cost: number | null;
  unit_price: number | null;
  supplier: string | null;
  lot_number: string | null;
  expiration_date: string | null;
  reorder_quantity: number | null;
  barcode: string | null;
  rfid_tag: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  stock_status: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';
  expiration_status: 'OK' | 'EXPIRING_SOON' | 'EXPIRED' | 'NO_EXPIRATION';
  days_to_expiration: number | null;
  status: string;
}

export interface InventoryListResponse {
  items: InventoryItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface InventoryDashboard {
  summary: {
    total: number;
    lowStock: number;
    outOfStock: number;
    expiringSoon: number;
    expired: number;
    inStock: number;
    inventoryValue: number;
  };
  health: {
    total: number;
    inStockCount: number;
    lowStockCount: number;
    outOfStockCount: number;
    expiredCount: number;
    inStockPercent: number;
  };
  byCategory: { category: string; count: number }[];
  lowStock: InventoryItem[];
  expiring: {
    within30: InventoryItem[];
    within60: InventoryItem[];
    within90: InventoryItem[];
    expired: InventoryItem[];
  };
  recentActivity: InventoryTransaction[];
}

export interface InventoryTransaction {
  id: number;
  inventory_item_id: number;
  transaction_type: string;
  quantity: number;
  source_location: string | null;
  destination_location: string | null;
  performed_by_name: string | null;
  reason: string | null;
  notes: string | null;
  previous_quantity: number;
  new_quantity: number;
  created_at: string;
  item_name?: string;
  item_code?: string;
  unit?: string;
}

export interface InventoryFilters {
  search?: string;
  category?: string;
  department?: string;
  stockStatus?: string;
  expiration?: string;
  page?: number;
  pageSize?: number;
}

export interface Vendor {
  id: number;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  categories: string | null;
  access_token: string | null;
  is_active: boolean;
}

export interface PurchaseOrderItem {
  id: number;
  purchase_order_id: number;
  inventory_item_id: number;
  quantity: number;
  unit_cost: number | null;
  received_quantity: number;
  item_name?: string;
  item_code?: string;
  unit?: string;
}

export interface PurchaseOrder {
  id: number;
  vendor_id: number | null;
  vendor_name?: string | null;
  po_number: string;
  status: string;
  order_date: string;
  expected_date: string | null;
  total_cost: number;
  notes: string | null;
  created_by_name: string | null;
  created_at: string;
  items: PurchaseOrderItem[];
}

export interface ReorderSuggestion extends InventoryItem {
  reorder_to: number;
  suggested_quantity: number;
}

export interface ForecastRow {
  id: number;
  item_name: string;
  item_code: string | null;
  unit: string | null;
  current_quantity: number;
  minimum_quantity: number;
  avg_daily_usage: number;
  days_remaining: number | null;
  projected_shortage: boolean;
  suggested_reorder: number;
}

export interface AccountingSummary {
  inventoryValue: number;
  byCategoryValue: { category: string; value: number }[];
  purchaseOrderSpend: number;
  issuedValue: number;
}

export const getInventory = (filters: InventoryFilters = {}): Promise<InventoryListResponse> =>
  nestClient.get('/inventory', { params: filters }).then((r) => r.data);

export const getInventoryDashboard = (): Promise<InventoryDashboard> =>
  nestClient.get('/inventory/dashboard').then((r) => r.data);

export const getInventoryItem = (id: number): Promise<InventoryItem> =>
  nestClient.get(`/inventory/${id}`).then((r) => r.data);

export const lookupInventoryBarcode = (code: string): Promise<InventoryItem> =>
  nestClient.get(`/inventory/lookup-barcode/${encodeURIComponent(code)}`).then((r) => r.data);

export const getInventoryTransactions = (id: number): Promise<InventoryTransaction[]> =>
  nestClient.get(`/inventory/${id}/transactions`).then((r) => r.data);

export const getInventoryCategories = (): Promise<string[]> =>
  nestClient.get('/inventory/categories').then((r) => r.data);

export const getInventoryDepartments = (): Promise<string[]> =>
  nestClient.get('/inventory/departments').then((r) => r.data);

export const createInventoryItem = (data: any): Promise<InventoryItem> =>
  nestClient.post('/inventory', data).then((r) => r.data);

export const updateInventoryItem = (id: number, data: any): Promise<InventoryItem> =>
  nestClient.put(`/inventory/${id}`, data).then((r) => r.data);

export const receiveStock = (id: number, data: any): Promise<InventoryItem> =>
  nestClient.post(`/inventory/${id}/receive`, data).then((r) => r.data);

export const issueStock = (id: number, data: any): Promise<InventoryItem> =>
  nestClient.post(`/inventory/${id}/issue`, data).then((r) => r.data);

export const transferStock = (id: number, data: any): Promise<InventoryItem> =>
  nestClient.post(`/inventory/${id}/transfer`, data).then((r) => r.data);

export const returnStock = (id: number, data: any): Promise<InventoryItem> =>
  nestClient.post(`/inventory/${id}/return`, data).then((r) => r.data);

export const adjustStock = (id: number, data: any): Promise<InventoryItem> =>
  nestClient.post(`/inventory/${id}/adjust`, data).then((r) => r.data);

// ── Vendors ──────────────────────────────────────────────────────────────

export const getVendors = (): Promise<Vendor[]> =>
  nestClient.get('/inventory/vendors').then((r) => r.data);

export const createVendor = (data: any): Promise<Vendor> =>
  nestClient.post('/inventory/vendors', data).then((r) => r.data);

export const updateVendor = (id: number, data: any): Promise<Vendor> =>
  nestClient.put(`/inventory/vendors/${id}`, data).then((r) => r.data);

// ── Purchase orders ──────────────────────────────────────────────────────

export const getPurchaseOrders = (): Promise<PurchaseOrder[]> =>
  nestClient.get('/inventory/purchase-orders').then((r) => r.data);

export const getPurchaseOrder = (id: number): Promise<PurchaseOrder> =>
  nestClient.get(`/inventory/purchase-orders/${id}`).then((r) => r.data);

export const createPurchaseOrder = (data: any): Promise<PurchaseOrder> =>
  nestClient.post('/inventory/purchase-orders', data).then((r) => r.data);

export const updatePurchaseOrderStatus = (id: number, status: string): Promise<PurchaseOrder> =>
  nestClient.put(`/inventory/purchase-orders/${id}/status`, { status }).then((r) => r.data);

export const receivePurchaseOrder = (id: number, data?: any): Promise<PurchaseOrder> =>
  nestClient.post(`/inventory/purchase-orders/${id}/receive`, data || {}).then((r) => r.data);

// ── Reorder / forecast / accounting ──────────────────────────────────────

export const getReorderSuggestions = (): Promise<ReorderSuggestion[]> =>
  nestClient.get('/inventory/reorder-suggestions').then((r) => r.data);

export const getForecast = (): Promise<ForecastRow[]> =>
  nestClient.get('/inventory/forecast').then((r) => r.data);

export const getAccountingSummary = (): Promise<AccountingSummary> =>
  nestClient.get('/inventory/accounting/summary').then((r) => r.data);

// ── Vendor portal (public) ───────────────────────────────────────────────

export const getVendorPortal = (token: string): Promise<any> =>
  nestClient.get(`/vendor/portal/${token}`).then((r) => r.data);

export const acknowledgePurchaseOrderVendor = (token: string, orderId: number): Promise<any> =>
  nestClient.post(`/vendor/portal/${token}/orders/${orderId}/acknowledge`).then((r) => r.data);

// ── Inventory requests (requisitions) ────────────────────────────────────

export interface InventoryRequestItem {
  id: number;
  request_id: number;
  inventory_item_id: number;
  quantity: number;
  approved_quantity: number;
  item_name?: string;
  item_code?: string;
  unit?: string;
}

export interface InventoryRequest {
  id: number;
  request_number: string;
  department: string | null;
  status: string;
  requested_by_name: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  reason: string | null;
  notes: string | null;
  created_at: string;
  item_count?: number;
  items: InventoryRequestItem[];
}

export const getInventoryRequests = (): Promise<InventoryRequest[]> =>
  nestClient.get('/inventory/requests').then((r) => r.data);

export const createInventoryRequest = (data: any): Promise<InventoryRequest> =>
  nestClient.post('/inventory/requests', data).then((r) => r.data);

export const updateInventoryRequestStatus = (id: number, status: string): Promise<InventoryRequest> =>
  nestClient.put(`/inventory/requests/${id}/status`, { status }).then((r) => r.data);

export const orderInventoryRequest = (id: number): Promise<any> =>
  nestClient.post(`/inventory/requests/${id}/order`).then((r) => r.data);

// ── Price list import (Excel / CSV / Word) ───────────────────────────────

export interface ImportPriceListRow {
  no: string;
  description: string;
  category: string;
  unitPriceLRD: number;
  unitPriceUSD: number;
  inventory: 'updated' | 'created' | null;
  catalog: 'updated' | 'created';
}

export interface ImportPriceListResult {
  fileName: string;
  sourceCurrency: string;
  systemCurrency: string;
  exchangeRate: number;
  preview?: string;
  totalRows: number;
  applied: number;
  catalogUpdated: number;
  catalogCreated: number;
  inventoryUpdated: number;
  inventoryCreated: number;
  rows: ImportPriceListRow[];
}

export const importInventoryPriceList = (file: File, sourceCurrency = 'LRD'): Promise<ImportPriceListResult> => {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('sourceCurrency', sourceCurrency);
  return nestClient
    .post('/inventory/import-prices', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
    .then((r) => r.data);
};
