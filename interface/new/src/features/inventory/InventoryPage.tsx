import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';
import {
  getInventory,
  getInventoryDashboard,
  getInventoryItem,
  getInventoryTransactions,
  getInventoryCategories,
  getInventoryDepartments,
  createInventoryItem,
  updateInventoryItem,
  receiveStock,
  issueStock,
  transferStock,
  returnStock,
  adjustStock,
  getVendors,
  createVendor,
  getPurchaseOrders,
  createPurchaseOrder,
  receivePurchaseOrder,
  getReorderSuggestions,
  getForecast,
  getAccountingSummary,
  getInventoryRequests,
  createInventoryRequest,
  updateInventoryRequestStatus,
  orderInventoryRequest,
  importInventoryPriceList,
  lookupInventoryBarcode,
  type InventoryItem,
  type InventoryTransaction,
  type Vendor,
  type PurchaseOrder,
  type ReorderSuggestion,
  type ForecastRow,
  type InventoryRequest,
  type ImportPriceListResult,
} from '../../api/endpoints/inventory';
import BarcodeSvg from '../../components/common/BarcodeSvg';

const CATEGORIES = ['Medication', 'Laboratory', 'Medical Supplies', 'PPE', 'Consumables', 'Equipment', 'Other'];
const DEPARTMENTS = ['Pharmacy', 'Laboratory', 'Emergency', 'Outpatient', 'Inpatient / Ward', 'Operating Room', 'Radiology', 'Nursing', 'Administration', 'General Store'];

const CATEGORY_COLORS: Record<string, string> = {
  Medication: '#0d6efd',
  Laboratory: '#6f42c1',
  'Medical Supplies': '#198754',
  PPE: '#fd7e14',
  Consumables: '#0dcaf0',
  Equipment: '#e83e8c',
  Other: '#6c757d',
};

const STATUS_STYLES: Record<string, { bg: string; icon: string }> = {
  'In Stock': { bg: 'bg-success', icon: 'bi-check-circle' },
  'Low Stock': { bg: 'bg-warning text-dark', icon: 'bi-exclamation-triangle' },
  'Out of Stock': { bg: 'bg-danger', icon: 'bi-x-circle' },
  'Not Stocked': { bg: 'bg-secondary', icon: 'bi-dash-circle' },
  'Expiring Soon': { bg: 'bg-info text-dark', icon: 'bi-hourglass-split' },
  Expired: { bg: 'bg-dark', icon: 'bi-slash-circle' },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] || { bg: 'bg-secondary', icon: 'bi-dot' };
  return (
    <span className={`badge rounded-pill ${s.bg}`} style={{ fontSize: '0.7rem' }}>
      <i className={`bi ${s.icon} me-1`}></i>{status}
    </span>
  );
}

const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
const fmtDateTime = (d: string | null) => (d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const money = (v: number | null | undefined) =>
  v == null ? '—' : `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const errMsg = (err: any) => err?.response?.data?.message || err?.message || 'Something went wrong';

function CategoryDonut({ data }: { data: { category: string; count: number }[] }) {
  const total = data.reduce((s, d) => s + d.count, 0);
  const R = 42;
  const C = 2 * Math.PI * R;
  let offset = 0;
  const segments = data.map((d) => {
    const frac = total ? d.count / total : 0;
    const len = frac * C;
    const seg = { ...d, dash: len, offset };
    offset += len;
    return seg;
  });
  return (
    <div className="d-flex align-items-center gap-3 flex-wrap">
      <svg width="128" height="128" viewBox="0 0 120 120" className="flex-shrink-0">
        <circle cx="60" cy="60" r={R} fill="none" stroke="#e9ecef" strokeWidth="16" />
        {segments.map((s) => (
          <circle
            key={s.category}
            cx="60" cy="60" r={R} fill="none"
            stroke={CATEGORY_COLORS[s.category] || '#6c757d'} strokeWidth="16"
            strokeDasharray={`${s.dash} ${C - s.dash}`}
            strokeDashoffset={-s.offset}
            transform="rotate(-90 60 60)"
          />
        ))}
        <text x="60" y="58" textAnchor="middle" fontSize="18" fontWeight="700" fill="#212529">{total}</text>
        <text x="60" y="72" textAnchor="middle" fontSize="9" fill="#6c757d">items</text>
      </svg>
      <div className="flex-grow-1" style={{ minWidth: '150px' }}>
        {data.map((d) => (
          <div key={d.category} className="d-flex justify-content-between small mb-1">
            <span className="d-flex align-items-center">
              <span className="rounded-circle me-2" style={{ width: '9px', height: '9px', background: CATEGORY_COLORS[d.category] || '#6c757d' }}></span>
              {d.category}
            </span>
            <span className="text-muted fw-semibold">{d.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface ActionForm {
  type: 'receive' | 'issue' | 'transfer' | 'return' | 'adjust';
  item: InventoryItem;
}

export default function InventoryPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const role = user?.role || '';
  const canManage = role === 'admin' || role === 'inventory_manager';
  const canReceive = role === 'admin' || role === 'inventory_manager' || role === 'lab_tech';
  const canIssue = role === 'admin' || role === 'inventory_manager' || role === 'physician' || role === 'nurse' || role === 'lab_tech';
  const canTransfer = role === 'admin' || role === 'inventory_manager' || role === 'lab_tech';
  const canReturn = role === 'admin' || role === 'inventory_manager' || role === 'physician' || role === 'nurse' || role === 'lab_tech';
  const canAdjust = role === 'admin' || role === 'inventory_manager';

  const [filters, setFilters] = useState({ search: '', category: '', department: '', stockStatus: '', expiration: '' });
  const [page, setPage] = useState(1);
  const [activeTab, setActiveTab] = useState('inventory');
  const pageSize = 15;

  const [showAdd, setShowAdd] = useState(false);
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [action, setAction] = useState<ActionForm | null>(null);
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: string }[]>([]);
  const [showImport, setShowImport] = useState(false);
  const [importResult, setImportResult] = useState<ImportPriceListResult | null>(null);
  const [scan, setScan] = useState('');
  const [showPrint, setShowPrint] = useState(false);

  const pushToast = (msg: string, kind: 'success' | 'danger' = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['inventory'] });
  };

  const { data: dashboard, isLoading: dashLoading } = useQuery({
    queryKey: ['inventory', 'dashboard'],
    queryFn: getInventoryDashboard,
  });

  const { data: list, isLoading: listLoading } = useQuery({
    queryKey: ['inventory', 'list', filters, page],
    queryFn: () => getInventory({ ...filters, page, pageSize }),
  });

  const { data: categories = CATEGORIES } = useQuery({
    queryKey: ['inventory', 'categories'],
    queryFn: getInventoryCategories,
    initialData: CATEGORIES,
  });
  const { data: departments = DEPARTMENTS } = useQuery({
    queryKey: ['inventory', 'departments'],
    queryFn: getInventoryDepartments,
    initialData: DEPARTMENTS,
  });

  const { data: detail } = useQuery({
    queryKey: ['inventory', 'detail', detailId],
    queryFn: () => getInventoryItem(detailId!),
    enabled: detailId != null,
  });

  const { data: detailTx = [] } = useQuery({
    queryKey: ['inventory', 'transactions', detailId],
    queryFn: () => getInventoryTransactions(detailId!),
    enabled: detailId != null,
  });

  const itemsForTransfer = useMemo(() => list?.items || [], [list]);

  // ── Mutations ──────────────────────────────────────────────────────────
  const createMut = useMutation({
    mutationFn: (data: any) => createInventoryItem(data),
    onSuccess: () => { invalidate(); setShowAdd(false); pushToast('Inventory item created'); },
    onError: (e) => pushToast(errMsg(e), 'danger'),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => updateInventoryItem(id, data),
    onSuccess: () => { invalidate(); setEditItem(null); pushToast('Inventory item updated'); },
    onError: (e) => pushToast(errMsg(e), 'danger'),
  });
  const stockMut = useMutation({
    mutationFn: ({ id, type, data }: { id: number; type: string; data: any }) => {
      if (type === 'receive') return receiveStock(id, data);
      if (type === 'issue') return issueStock(id, data);
      if (type === 'transfer') return transferStock(id, data);
      if (type === 'return') return returnStock(id, data);
      return adjustStock(id, data);
    },
    onSuccess: () => {
      invalidate();
      setAction(null);
      pushToast('Stock transaction recorded');
    },
    onError: (e) => pushToast(errMsg(e), 'danger'),
  });
  const scanMut = useMutation({
    mutationFn: (code: string) => lookupInventoryBarcode(code),
    onSuccess: (item) => { setDetailId(item.id); setScan(''); },
    onError: (e) => pushToast(errMsg(e), 'danger'),
  });
  const importMut = useMutation({
    mutationFn: ({ file, currency }: { file: File; currency: string }) => importInventoryPriceList(file, currency),
    onSuccess: (res) => {
      setImportResult(res);
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['price-catalog'] });
      pushToast('Price list imported and applied system-wide');
    },
    onError: (e) => pushToast(errMsg(e), 'danger'),
  });

  const applyFilter = (patch: Partial<typeof filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };

  const totalPages = list ? Math.max(1, Math.ceil(list.total / list.pageSize)) : 1;

  const kpis = [
    { label: 'Total Items', value: dashboard?.summary.total ?? '—', icon: 'bi-box-seam', color: '#0d6efd', bg: '#0d6efd15', click: null as null | string },
    { label: 'Low Stock', value: dashboard?.summary.lowStock ?? '—', icon: 'bi-exclamation-triangle', color: '#fd7e14', bg: '#fd7e1415', click: 'LOW_STOCK' },
    { label: 'Out of Stock', value: dashboard?.summary.outOfStock ?? '—', icon: 'bi-x-circle', color: '#dc3545', bg: '#dc354515', click: 'OUT_OF_STOCK' },
    { label: 'Expiring Soon', value: dashboard?.summary.expiringSoon ?? '—', icon: 'bi-hourglass-split', color: '#0dcaf0', bg: '#0dcaf015', click: 'EXPIRING_SOON' },
    { label: 'Inventory Value', value: money(dashboard?.summary.inventoryValue), icon: 'bi-cash-stack', color: '#198754', bg: '#19875415', click: null },
  ];

  return (
    <div className="pb-4 inventory-glass position-relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #dbeafe 0%, #f5faff 45%, #d1fae5 100%)', borderRadius: '20px', minHeight: '100vh' }}>
      {/* Decorative blurred orbs behind the frosted cards */}
      <div className="position-absolute rounded-circle" style={{ width: '360px', height: '360px', top: '-80px', right: '-60px', background: 'radial-gradient(circle, rgba(13,110,253,0.35), transparent 70%)', filter: 'blur(20px)', zIndex: 0 }}></div>
      <div className="position-absolute rounded-circle" style={{ width: '420px', height: '420px', bottom: '10%', left: '-120px', background: 'radial-gradient(circle, rgba(0,201,167,0.35), transparent 70%)', filter: 'blur(20px)', zIndex: 0 }}></div>
      <div className="position-absolute rounded-circle" style={{ width: '280px', height: '280px', top: '38%', left: '42%', background: 'radial-gradient(circle, rgba(111,66,193,0.22), transparent 70%)', filter: 'blur(22px)', zIndex: 0 }}></div>

      <style>{`
        .inventory-glass .card {
          position: relative;
          z-index: 1;
          background: rgba(255,255,255,0.55) !important;
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(255,255,255,0.9) !important;
          box-shadow: 0 22px 45px rgba(10,37,64,0.22), 0 6px 14px rgba(10,37,64,0.10) !important;
          transition: transform 0.25s ease, box-shadow 0.25s ease, background 0.25s ease;
        }
        .inventory-glass .card:hover {
          transform: translateY(-5px);
          background: rgba(255,255,255,0.68) !important;
          box-shadow: 0 30px 60px rgba(10,37,64,0.30), 0 10px 20px rgba(10,37,64,0.14) !important;
        }
        .inventory-glass .card .card-header {
          background: rgba(255,255,255,0.35) !important;
          border-bottom: 1px solid rgba(255,255,255,0.6) !important;
        }
        .inventory-glass .table thead.table-light {
          background: rgba(255,255,255,0.35) !important;
        }
        .inventory-glass .list-group-flush .list-group-item {
          background: transparent !important;
        }
        .inventory-glass .list-group-item-action {
          background: transparent !important;
        }
      `}</style>
      {/* Header */}
      <div className="rounded-4 p-4 mb-4 text-white position-relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #0d6efd 0%, #198754 60%, #0dcaf0 100%)' }}>
        <div className="position-absolute end-0 top-0 opacity-10" style={{ fontSize: '7rem', transform: 'rotate(10deg) translate(20px,-15px)' }}><i className="bi bi-box-seam"></i></div>
        <div className="position-relative d-flex justify-content-between align-items-center flex-wrap gap-2">
          <div>
            <h3 className="mb-1 fw-bold"><i className="bi bi-boxes me-2"></i>Inventory Management</h3>
            <p className="mb-0 text-white text-opacity-75 small">Track stock, expiry, and movements across departments.</p>
          </div>
          {canManage && (
            <div className="d-flex gap-2 flex-wrap">
              <button className="btn btn-light btn-sm rounded-pill fw-semibold" onClick={() => { setShowImport(true); setImportResult(null); }}>
                <i className="bi bi-cloud-upload me-1"></i>Import Price List
              </button>
              <button className="btn btn-light btn-sm rounded-pill fw-semibold" onClick={() => { setEditItem(null); setShowAdd(true); }}>
                <i className="bi bi-plus-lg me-1"></i>Add Inventory Item
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Barcode scan / lookup */}
      <div className="d-flex gap-2 align-items-center mb-3">
        <div className="input-group input-group-sm" style={{ maxWidth: '380px' }}>
          <span className="input-group-text"><i className="bi bi-upc-scan"></i></span>
          <input
            className="form-control"
            placeholder="Scan barcode / SKU then press Enter"
            value={scan}
            onChange={(e) => setScan(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && scan.trim()) scanMut.mutate(scan.trim()); }}
          />
        </div>
        {scanMut.isPending && <span className="spinner-border spinner-border-sm text-primary" />}
        {scan && (
          <button className="btn btn-outline-secondary btn-sm rounded-pill" onClick={() => setScan('')}>
            <i className="bi bi-x-lg me-1"></i>Clear
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="d-flex flex-wrap gap-2 mb-3">
        {([
          ['inventory', 'Inventory', 'bi-box-seam'],
          ['purchase-orders', 'Purchase Orders', 'bi-receipt'],
          ['vendors', 'Vendors', 'bi-truck'],
          ['reorder', 'Reorder', 'bi-arrow-repeat'],
          ['requests', 'Requests', 'bi-clipboard-check'],
          ['reports', 'Forecast & Accounting', 'bi-graph-up'],
        ] as [string, string, string][]).map(([id, label, icon]) => (
          <button key={id} className={`btn btn-sm rounded-pill ${activeTab === id ? 'btn-primary' : 'btn-outline-primary'}`} onClick={() => setActiveTab(id)}>
            <i className={`bi ${icon} me-1`}></i>{label}
          </button>
        ))}
      </div>

      {activeTab === 'inventory' && (<>
      {/* KPI cards */}
      <div className="row g-3 mb-3">
        {kpis.map((k) => (
          <div className="col-6 col-md-4 col-lg" key={k.label}>
            <div className="card border-0 shadow-sm h-100" style={{ borderRadius: '16px', cursor: k.click ? 'pointer' : 'default' }}
              onClick={() => k.click && applyFilter({ stockStatus: k.click, expiration: '' })}>
              <div className="card-body d-flex align-items-center gap-3 py-3">
                <div className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0" style={{ width: '46px', height: '46px', backgroundColor: k.bg }}>
                  <i className={`bi ${k.icon}`} style={{ color: k.color, fontSize: '1.2rem' }}></i>
                </div>
                <div className="min-width-0">
                  <div className="fs-4 fw-bold lh-1" style={{ color: k.color }}>{k.value}</div>
                  <small className="text-muted">{k.label}</small>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Health + Category */}
      <div className="row g-3 mb-3">
        <div className="col-lg-5">
          <div className="card border-0 shadow-sm h-100" style={{ borderRadius: '16px' }}>
            <div className="card-header bg-white py-3" style={{ borderRadius: '16px 16px 0 0' }}>
              <h6 className="mb-0 fw-bold"><i className="bi bi-heart-pulse me-2 text-success"></i>Inventory Health</h6>
            </div>
            <div className="card-body">
              <div className="d-flex justify-content-between align-items-end mb-1">
                <span className="small text-muted">In stock</span>
                <strong>{dashboard?.health.inStockPercent ?? 0}%</strong>
              </div>
              <div className="progress mb-3" style={{ height: '10px', borderRadius: '8px' }}>
                <div className="progress-bar bg-success" style={{ width: `${dashboard?.health.inStockPercent ?? 0}%` }}></div>
              </div>
              <div className="row g-2 text-center">
                {[
                  { l: 'In Stock', v: dashboard?.health.inStockCount ?? 0, c: '#198754' },
                  { l: 'Low Stock', v: dashboard?.health.lowStockCount ?? 0, c: '#fd7e14' },
                  { l: 'Out of Stock', v: dashboard?.health.outOfStockCount ?? 0, c: '#dc3545' },
                  { l: 'Expired', v: dashboard?.health.expiredCount ?? 0, c: '#212529' },
                ].map((s) => (
                  <div className="col-3" key={s.l}>
                    <div className="rounded-3 py-2" style={{ backgroundColor: `${s.c}12` }}>
                      <div className="fw-bold" style={{ color: s.c }}>{s.v}</div>
                      <small className="text-muted" style={{ fontSize: '0.7rem' }}>{s.l}</small>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="col-lg-7">
          <div className="card border-0 shadow-sm h-100" style={{ borderRadius: '16px' }}>
            <div className="card-header bg-white py-3" style={{ borderRadius: '16px 16px 0 0' }}>
              <h6 className="mb-0 fw-bold"><i className="bi bi-pie-chart me-2 text-primary"></i>Inventory by Category</h6>
            </div>
            <div className="card-body">
              {dashLoading ? <div className="text-center py-4 text-muted">Loading…</div> : <CategoryDonut data={dashboard?.byCategory || []} />}
            </div>
          </div>
        </div>
      </div>

      {/* Low stock + Expiration */}
      <div className="row g-3 mb-3">
        <div className="col-lg-7">
          <div className="card border-0 shadow-sm h-100" style={{ borderRadius: '16px' }}>
            <div className="card-header bg-white d-flex justify-content-between align-items-center py-3" style={{ borderRadius: '16px 16px 0 0' }}>
              <h6 className="mb-0 fw-bold"><i className="bi bi-exclamation-triangle me-2 text-warning"></i>Low Stock</h6>
              <button className="btn btn-outline-warning btn-sm rounded-pill" onClick={() => applyFilter({ stockStatus: '', expiration: '', category: '', department: '', search: '' })}>
                View All Low Stock
              </button>
            </div>
            <div className="card-body p-0">
              {(dashboard?.lowStock || []).length === 0 ? (
                <div className="text-center text-muted py-4 small">No low-stock items</div>
              ) : (
                (dashboard?.lowStock || []).map((it) => (
                  <div key={it.id} className="d-flex align-items-center gap-3 px-3 py-2 border-bottom" style={{ cursor: 'pointer' }} onClick={() => setDetailId(it.id)}>
                    <div className="flex-grow-1 min-width-0">
                      <div className="fw-semibold small text-truncate">{it.item_name}</div>
                      <small className="text-muted">{it.department || '—'} · min {it.minimum_quantity} {it.unit || ''}</small>
                    </div>
                    <div className="text-end flex-shrink-0">
                      <div className="fw-bold" style={{ color: it.stock_status === 'OUT_OF_STOCK' ? '#dc3545' : '#fd7e14' }}>
                        {it.current_quantity} {it.unit || ''}
                      </div>
                      <StatusBadge status={it.status} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
        <div className="col-lg-5">
          <div className="card border-0 shadow-sm h-100" style={{ borderRadius: '16px' }}>
            <div className="card-header bg-white py-3" style={{ borderRadius: '16px 16px 0 0' }}>
              <h6 className="mb-0 fw-bold"><i className="bi bi-calendar-x me-2 text-info"></i>Expiration Alerts</h6>
            </div>
            <div className="card-body p-0">
              {[
                { label: 'Expiring within 30 days', items: dashboard?.expiring.within30 || [], color: '#dc3545' },
                { label: 'Expiring within 60 days', items: dashboard?.expiring.within60 || [], color: '#fd7e14' },
                { label: 'Expiring within 90 days', items: dashboard?.expiring.within90 || [], color: '#ffc107' },
                { label: 'Expired', items: dashboard?.expiring.expired || [], color: '#212529' },
              ].map((g) => (
                <div key={g.label} className="d-flex align-items-center gap-2 px-3 py-2 border-bottom">
                  <span className="rounded-circle flex-shrink-0" style={{ width: '10px', height: '10px', backgroundColor: g.color }}></span>
                  <span className="flex-grow-1 small">{g.label}</span>
                  <span className={`badge rounded-pill ${g.label === 'Expired' ? 'bg-dark' : 'bg-light text-dark border'}`}>{g.items.length}</span>
                </div>
              ))}
              {(dashboard?.expiring.expired || []).length > 0 && (
                <div className="px-3 py-2 bg-danger bg-opacity-10 small">
                  <i className="bi bi-exclamation-triangle text-danger me-1"></i>
                  {dashboard!.expiring.expired.length} expired item(s) are not usable — quarantine them.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Recent activity */}
      <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '16px' }}>
        <div className="card-header bg-white py-3" style={{ borderRadius: '16px 16px 0 0' }}>
          <h6 className="mb-0 fw-bold"><i className="bi bi-clock-history me-2 text-secondary"></i>Recent Inventory Activity</h6>
        </div>
        <div className="card-body p-0">
          {(dashboard?.recentActivity || []).length === 0 ? (
            <div className="text-center text-muted py-4 small">No activity recorded</div>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover small mb-0 align-middle">
                <thead className="table-light"><tr>
                  <th>Action</th><th>Item</th><th className="text-end">Qty</th><th>User</th><th>Location</th><th>Date / Time</th>
                </tr></thead>
                <tbody>
                  {(dashboard?.recentActivity || []).map((t: InventoryTransaction) => (
                    <tr key={t.id}>
                      <td><span className="badge bg-secondary rounded-pill" style={{ fontSize: '0.65rem' }}>{t.transaction_type}</span></td>
                      <td className="text-truncate" style={{ maxWidth: '200px' }}>{t.item_name}</td>
                      <td className="text-end fw-semibold">{t.quantity}</td>
                      <td>{t.performed_by_name || '—'}</td>
                      <td className="text-truncate" style={{ maxWidth: '160px' }}>{t.destination_location || t.source_location || '—'}</td>
                      <td className="text-nowrap">{fmtDateTime(t.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Main inventory table */}
      <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
        <div className="card-header bg-white py-3" style={{ borderRadius: '16px 16px 0 0' }}>
          <h6 className="mb-0 fw-bold"><i className="bi bi-list-ul me-2 text-primary"></i>Inventory Items</h6>
        </div>
        <div className="card-body">
          {/* Toolbar */}
          <div className="row g-2 mb-3">
            <div className="col-md-4">
              <div className="input-group input-group-sm">
                <span className="input-group-text bg-white border-end-0"><i className="bi bi-search text-muted"></i></span>
                <input className="form-control border-start-0" placeholder="Search item, SKU, lot, supplier…" value={filters.search}
                  onChange={(e) => applyFilter({ search: e.target.value })} />
              </div>
            </div>
            <div className="col-6 col-md-2">
              <select className="form-select form-select-sm" value={filters.category} onChange={(e) => applyFilter({ category: e.target.value })}>
                <option value="">All categories</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="col-6 col-md-2">
              <select className="form-select form-select-sm" value={filters.department} onChange={(e) => applyFilter({ department: e.target.value })}>
                <option value="">All departments</option>
                {departments.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="col-6 col-md-2">
              <select className="form-select form-select-sm" value={filters.stockStatus} onChange={(e) => applyFilter({ stockStatus: e.target.value })}>
                <option value="">All stock status</option>
                <option value="IN_STOCK">In Stock</option>
                <option value="LOW_STOCK">Low Stock</option>
                <option value="OUT_OF_STOCK">Out of Stock</option>
              </select>
            </div>
            <div className="col-6 col-md-2">
              <select className="form-select form-select-sm" value={filters.expiration} onChange={(e) => applyFilter({ expiration: e.target.value })}>
                <option value="">All expiration</option>
                <option value="EXPIRING_SOON">Expiring Soon</option>
                <option value="EXPIRED">Expired</option>
                <option value="OK">Valid</option>
                <option value="NO_EXPIRATION">No Expiration</option>
              </select>
            </div>
          </div>

          {listLoading ? (
            <div className="text-center py-5"><div className="spinner-border text-primary" /></div>
          ) : !list || list.items.length === 0 ? (
            <div className="text-center text-muted py-5">
              <i className="bi bi-box-seam fs-1 d-block mb-2 opacity-50"></i>No inventory items match your filters
            </div>
          ) : (
            <>
              <div className="table-responsive">
                <table className="table table-hover small align-middle mb-0">
                  <thead className="table-light">
                    <tr>
                      <th>Item</th><th>SKU</th><th>Category</th><th>Department</th><th>Location</th>
                      <th className="text-end">Qty</th><th className="text-end">Min</th><th>Unit</th>
                      <th>Lot</th><th>Expiration</th><th>Status</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.items.map((it) => (
                      <tr key={it.id} style={{ cursor: 'pointer' }} onClick={() => setDetailId(it.id)}>
                        <td className="fw-semibold text-truncate" style={{ maxWidth: '180px' }}>{it.item_name}</td>
                        <td><code style={{ fontSize: '0.7rem' }}>{it.item_code || '—'}</code></td>
                        <td><span className="badge bg-light text-dark border">{it.category}</span></td>
                        <td>{it.department || '—'}</td>
                        <td className="text-truncate" style={{ maxWidth: '100px' }}>{it.storage_location || '—'}</td>
                        <td className="text-end fw-bold">{it.current_quantity}</td>
                        <td className="text-end text-muted">{it.minimum_quantity}</td>
                        <td>{it.unit || '—'}</td>
                        <td className="text-truncate" style={{ maxWidth: '100px' }}>{it.lot_number || '—'}</td>
                        <td className="text-nowrap">{fmtDate(it.expiration_date)}</td>
                        <td><StatusBadge status={it.status} /></td>
                        <td className="text-nowrap text-end">
                          <button className="btn btn-outline-secondary btn-sm" onClick={(e) => { e.stopPropagation(); setDetailId(it.id); }} title="View details"><i className="bi bi-eye" /></button>
                          {canManage && (
                            <button className="btn btn-outline-secondary btn-sm ms-1" onClick={(e) => { e.stopPropagation(); setEditItem(it); setShowAdd(true); }} title="Edit"><i className="bi bi-pencil" /></button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="d-flex justify-content-between align-items-center mt-3">
                <small className="text-muted">Showing {list.items.length} of {list.total} items</small>
                <div className="btn-group btn-group-sm">
                  <button className="btn btn-outline-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><i className="bi bi-chevron-left" /></button>
                  <span className="btn btn-outline-secondary disabled" style={{ opacity: 1 }}>{page} / {totalPages}</span>
                  <button className="btn btn-outline-secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}><i className="bi bi-chevron-right" /></button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      </>)}

      {activeTab === 'purchase-orders' && <PurchaseOrdersTab canManage={canManage} />}
      {activeTab === 'vendors' && <VendorsTab canManage={canManage} />}
      {activeTab === 'reorder' && <ReorderTab canManage={canManage} />}
      {activeTab === 'requests' && <RequestsTab canManage={canManage} />}
      {activeTab === 'reports' && <ReportsTab />}

      {/* Add / edit modal */}
      {showAdd && (
        <ItemFormModal
          item={editItem}
          busy={createMut.isPending || updateMut.isPending}
          onClose={() => { setShowAdd(false); setEditItem(null); }}
          onSubmit={(data) => (editItem ? updateMut.mutate({ id: editItem.id, data }) : createMut.mutate(data))}
        />
      )}
      {showImport && (
        <PriceImportModal
          busy={importMut.isPending}
          result={importResult}
          onClose={() => { setShowImport(false); setImportResult(null); }}
          onImport={(file, currency) => importMut.mutate({ file, currency })}
        />
      )}

      {/* Detail drawer */}
      {detailId != null && detail && (
        <div className="offcanvas offcanvas-end show" tabIndex={-1} style={{ width: '520px', maxWidth: '100vw' }}>
          <div className="offcanvas-header border-bottom">
            <div className="min-width-0">
              <h5 className="offcanvas-title fw-bold text-truncate">{detail.item_name}</h5>
              <small className="text-muted">{detail.item_code || 'No SKU'} · {detail.category}</small>
            </div>
            <button type="button" className="btn-close" onClick={() => setDetailId(null)}></button>
          </div>
          <div className="offcanvas-body p-0 d-flex flex-column">
            <div className="p-3 border-bottom" style={{ backgroundColor: '#f8f9fa' }}>
              <div className="d-flex gap-2 mb-2 flex-wrap">
                <StatusBadge status={detail.status} />
                <span className="badge bg-light text-dark border" style={{ fontSize: '0.7rem' }}>Stock: {detail.stock_status.replace('_', ' ')}</span>
                {detail.expiration_status !== 'NO_EXPIRATION' && (
                  <span className="badge bg-light text-dark border" style={{ fontSize: '0.7rem' }}>Expiry: {detail.expiration_status.replace('_', ' ')}</span>
                )}
              </div>
              <div className="row g-2 small">
                {[
                  ['Current Qty', `${detail.current_quantity} ${detail.unit || ''}`],
                  ['Minimum', `${detail.minimum_quantity} ${detail.unit || ''}`],
                  ['Unit Cost', money(detail.unit_cost)],
                  ['Department', detail.department || '—'],
                  ['Storage', detail.storage_location || '—'],
                  ['Supplier', detail.supplier || '—'],
                  ['Lot / Batch', detail.lot_number || '—'],
                  ['Barcode', detail.barcode || '—'],
                  ['RFID Tag', detail.rfid_tag || '—'],
                  ['Expiration', fmtDate(detail.expiration_date)],
                  ['Created', fmtDateTime(detail.created_at)],
                  ['Last Updated', fmtDateTime(detail.updated_at)],
                ].map(([l, v]) => (
                  <div className="col-6" key={l}>
                    <div className="text-muted" style={{ fontSize: '0.68rem' }}>{l}</div>
                    <div className="fw-semibold text-break">{v}</div>
                  </div>
                ))}
              </div>
              <div className="mt-3 p-2 bg-white border rounded-3 text-center">
                <BarcodeSvg value={detail.barcode || detail.item_code || `INV-${detail.id}`} height={44} />
                <div className="small text-muted mt-1" style={{ fontFamily: 'monospace' }}>{detail.barcode || detail.item_code || `INV-${detail.id}`}</div>
                <button className="btn btn-sm btn-outline-primary mt-2 rounded-pill" onClick={() => setShowPrint(true)}>
                  <i className="bi bi-printer me-1"></i>Print Label
                </button>
              </div>
              {detail.description && <p className="text-muted small mt-2 mb-0">{detail.description}</p>}
            </div>

            {/* Actions */}
            <div className="p-3 border-bottom">
              <small className="text-muted d-block mb-2 text-uppercase fw-semibold" style={{ fontSize: '0.68rem' }}>Stock Actions</small>
              <div className="d-flex flex-wrap gap-1">
                {canReceive && <button className="btn btn-outline-success btn-sm" onClick={() => setAction({ type: 'receive', item: detail })}><i className="bi bi-box-arrow-in-down me-1"></i>Receive</button>}
                {canIssue && <button className="btn btn-outline-danger btn-sm" onClick={() => setAction({ type: 'issue', item: detail })}><i className="bi bi-box-arrow-up me-1"></i>Issue</button>}
                {canTransfer && <button className="btn btn-outline-primary btn-sm" onClick={() => setAction({ type: 'transfer', item: detail })}><i className="bi bi-arrow-left-right me-1"></i>Transfer</button>}
                {canReturn && <button className="btn btn-outline-secondary btn-sm" onClick={() => setAction({ type: 'return', item: detail })}><i className="bi bi-arrow-return-left me-1"></i>Return</button>}
                {canAdjust && <button className="btn btn-outline-warning btn-sm" onClick={() => setAction({ type: 'adjust', item: detail })}><i className="bi bi-sliders me-1"></i>Adjust</button>}
                {canManage && <button className="btn btn-outline-secondary btn-sm" onClick={() => { setEditItem(detail); setShowAdd(true); }}><i className="bi bi-pencil me-1"></i>Edit</button>}
              </div>
            </div>

            {/* Transaction history */}
            <div className="flex-grow-1 overflow-auto">
              <div className="p-3">
                <small className="text-muted d-block mb-2 text-uppercase fw-semibold" style={{ fontSize: '0.68rem' }}>Transaction History</small>
                {detailTx.length === 0 ? (
                  <div className="text-center text-muted small py-3">No transactions recorded</div>
                ) : (
                  detailTx.map((t: InventoryTransaction) => (
                    <div key={t.id} className="d-flex gap-2 py-2 border-bottom small">
                      <span className={`badge bg-secondary rounded-pill align-self-start`} style={{ fontSize: '0.62rem' }}>{t.transaction_type}</span>
                      <div className="flex-grow-1 min-width-0">
                        <div className="fw-semibold">{t.quantity} {t.unit || ''} · {t.reason || '—'}</div>
                        <div className="text-muted" style={{ fontSize: '0.7rem' }}>
                          {t.previous_quantity} → {t.new_quantity} · {t.performed_by_name || '—'} · {fmtDateTime(t.created_at)}
                        </div>
                        {t.destination_location && <div className="text-muted" style={{ fontSize: '0.7rem' }}>→ {t.destination_location}</div>}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
          {detailId != null && <div className="offcanvas-backdrop fade show" onClick={() => setDetailId(null)}></div>}
        </div>
      )}

      {/* Barcode label print */}
      {showPrint && detail && (
        <BarcodePrintModal item={detail} onClose={() => setShowPrint(false)} />
      )}

      {/* Stock action modal */}
      {action && (
        <StockActionModal
          action={action}
          items={itemsForTransfer}
          busy={stockMut.isPending}
          onClose={() => setAction(null)}
          onSubmit={(data) => stockMut.mutate({ id: action.item.id, type: action.type, data })}
        />
      )}

      {/* Toasts */}
      <div className="toast-container position-fixed bottom-0 end-0 p-3" style={{ zIndex: 2000 }}>
        {toasts.map((t) => (
          <div key={t.id} className={`toast show align-items-center text-bg-${t.kind === 'success' ? 'success' : 'danger'} border-0 mb-2`}>
            <div className="d-flex">
              <div className="toast-body"><i className={`bi ${t.kind === 'success' ? 'bi-check-circle' : 'bi-exclamation-triangle'} me-1`}></i>{t.msg}</div>
              <button type="button" className="btn-close btn-close-white me-2 m-auto" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Item form modal ──────────────────────────────────────────────────────

const EMPTY_FORM = {
  item_name: '', item_code: '', description: '', category: 'Medication', department: '',
  storage_location: '', quantity: '0', minimum_quantity: '0', unit: '', unit_cost: '',
  supplier: '', lot_number: '', expiration_date: '', reorder_quantity: '', barcode: '', rfid_tag: '', notes: '',
};

function ItemFormModal({ item, busy, onClose, onSubmit }: {
  item: InventoryItem | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (data: any) => void;
}) {
  const [f, setF] = useState<any>(() => (item ? {
    item_name: item.item_name, item_code: item.item_code || '', description: item.description || '',
    category: item.category, department: item.department || '', storage_location: item.storage_location || '',
    quantity: String(item.current_quantity), minimum_quantity: String(item.minimum_quantity),
    unit: item.unit || '', unit_cost: item.unit_cost == null ? '' : String(item.unit_cost),
    supplier: item.supplier || '', lot_number: item.lot_number || '', expiration_date: item.expiration_date || '',
    reorder_quantity: item.reorder_quantity == null ? '' : String(item.reorder_quantity),
    barcode: item.barcode || '', rfid_tag: item.rfid_tag || '', notes: '',
  } : EMPTY_FORM));

  const set = (k: string, v: any) => setF((prev: any) => ({ ...prev, [k]: v }));

  const submit = () => {
    if (!f.item_name.trim()) { alert('Item name is required'); return; }
    if (!f.category) { alert('Category is required'); return; }
    onSubmit({
      item_name: f.item_name.trim(),
      item_code: f.item_code.trim(),
      description: f.description,
      category: f.category,
      department: f.department,
      storage_location: f.storage_location,
      quantity: Number(f.quantity || 0),
      minimum_quantity: Number(f.minimum_quantity || 0),
      unit: f.unit,
      unit_cost: f.unit_cost === '' ? null : Number(f.unit_cost),
      supplier: f.supplier,
      lot_number: f.lot_number,
      expiration_date: f.expiration_date || null,
      reorder_quantity: f.reorder_quantity === '' ? null : Number(f.reorder_quantity),
      barcode: f.barcode || null,
      rfid_tag: f.rfid_tag || null,
      notes: f.notes,
    });
  };

  return (
    <div className="modal d-block fade show" tabIndex={-1}>
      <div className="modal-dialog modal-dialog-centered modal-lg modal-dialog-scrollable">
        <div className="modal-content" style={{ borderRadius: '18px' }}>
          <div className="modal-header">
            <h6 className="modal-title fw-bold">{item ? 'Edit Inventory Item' : 'Add Inventory Item'}</h6>
            <button type="button" className="btn-close" onClick={onClose}></button>
          </div>
          <div className="modal-body">
            <div className="row g-2">
              <div className="col-md-6"><label className="form-label small mb-0">Item Name *</label>
                <input className="form-control form-control-sm" value={f.item_name} onChange={(e) => set('item_name', e.target.value)} /></div>
              <div className="col-md-3"><label className="form-label small mb-0">Item Code / SKU</label>
                <input className="form-control form-control-sm" value={f.item_code} onChange={(e) => set('item_code', e.target.value)} /></div>
              <div className="col-md-3"><label className="form-label small mb-0">Category *</label>
                <select className="form-select form-select-sm" value={f.category} onChange={(e) => set('category', e.target.value)}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select></div>
              <div className="col-md-4"><label className="form-label small mb-0">Department</label>
                <select className="form-select form-select-sm" value={f.department} onChange={(e) => set('department', e.target.value)}>
                  <option value="">—</option>{DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select></div>
              <div className="col-md-4"><label className="form-label small mb-0">Storage Location</label>
                <input className="form-control form-control-sm" value={f.storage_location} onChange={(e) => set('storage_location', e.target.value)} /></div>
              <div className="col-md-4"><label className="form-label small mb-0">Unit</label>
                <input className="form-control form-control-sm" placeholder="e.g. boxes, capsules" value={f.unit} onChange={(e) => set('unit', e.target.value)} /></div>
              <div className="col-md-3"><label className="form-label small mb-0">{item ? 'Current Qty' : 'Quantity'}</label>
                <input type="number" min="0" className="form-control form-control-sm" value={f.quantity} onChange={(e) => set('quantity', e.target.value)} /></div>
              <div className="col-md-3"><label className="form-label small mb-0">Minimum Qty</label>
                <input type="number" min="0" className="form-control form-control-sm" value={f.minimum_quantity} onChange={(e) => set('minimum_quantity', e.target.value)} /></div>
              <div className="col-md-3"><label className="form-label small mb-0">Reorder Qty</label>
                <input type="number" min="0" className="form-control form-control-sm" value={f.reorder_quantity} onChange={(e) => set('reorder_quantity', e.target.value)} /></div>
              <div className="col-md-3"><label className="form-label small mb-0">Unit Cost</label>
                <input type="number" min="0" step="0.01" className="form-control form-control-sm" value={f.unit_cost} onChange={(e) => set('unit_cost', e.target.value)} /></div>
              <div className="col-md-3"><label className="form-label small mb-0">Lot / Batch</label>
                <input className="form-control form-control-sm" value={f.lot_number} onChange={(e) => set('lot_number', e.target.value)} /></div>
              <div className="col-md-3"><label className="form-label small mb-0">Barcode</label>
                <input className="form-control form-control-sm" placeholder="Auto if blank" value={f.barcode} onChange={(e) => set('barcode', e.target.value)} /></div>
              <div className="col-md-3"><label className="form-label small mb-0">RFID Tag</label>
                <input className="form-control form-control-sm" placeholder="Optional" value={f.rfid_tag} onChange={(e) => set('rfid_tag', e.target.value)} /></div>
              <div className="col-md-6"><label className="form-label small mb-0">Supplier</label>
                <input className="form-control form-control-sm" value={f.supplier} onChange={(e) => set('supplier', e.target.value)} /></div>
              <div className="col-md-3"><label className="form-label small mb-0">Expiration Date</label>
                <input type="date" className="form-control form-control-sm" value={f.expiration_date} onChange={(e) => set('expiration_date', e.target.value)} />
                <small className="text-muted" style={{ fontSize: '0.65rem' }}>Leave blank for non-expiring items (e.g. equipment)</small></div>
              <div className="col-md-3"><label className="form-label small mb-0">Description</label>
                <input className="form-control form-control-sm" value={f.description} onChange={(e) => set('description', e.target.value)} /></div>
              <div className="col-md-12"><label className="form-label small mb-0">Notes</label>
                <textarea className="form-control form-control-sm" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></div>
            </div>
          </div>
          <div className="modal-footer">
            <button className="btn btn-outline-secondary btn-sm" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={submit} disabled={busy}>
              {busy ? <span className="spinner-border spinner-border-sm" /> : item ? 'Save Changes' : 'Add Item'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Price list import modal ───────────────────────────────────────────────

function PriceImportModal({ busy, result, onClose, onImport }: {
  busy: boolean;
  result: ImportPriceListResult | null;
  onClose: () => void;
  onImport: (file: File, currency: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [currency, setCurrency] = useState('LRD');

  return (
    <div className="modal d-block" style={{ background: 'rgba(0,0,0,0.45)' }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-dialog modal-lg modal-dialog-scrollable">
        <div className="modal-content" style={{ borderRadius: '16px' }}>
          <div className="modal-header">
            <h5 className="modal-title"><i className="bi bi-cloud-upload me-2 text-primary"></i>Import Price List</h5>
            <button className="btn-close" onClick={onClose}></button>
          </div>
          <div className="modal-body">
            <div className="alert alert-info small py-2">
              <i className="bi bi-info-circle me-1"></i>
              Upload an Excel (.xlsx/.csv) or Word (.docx) document with columns <strong>No</strong>, <strong>Description</strong>, and <strong>Unit Price</strong>.
              Prices are converted to USD at the current system exchange rate and applied system-wide to billing.
            </div>

            {!result ? (
              <>
                <div className="row g-3">
                  <div className="col-md-7">
                    <label className="form-label small">Document</label>
                    <input type="file" className="form-control form-control-sm" accept=".xlsx,.xlsm,.xls,.csv,.txt,.docx"
                      onChange={(e) => setFile(e.target.files?.[0] || null)} />
                    {file && <div className="small text-muted mt-1"><i className="bi bi-paperclip me-1"></i>{file.name} ({(file.size / 1024).toFixed(1)} KB)</div>}
                  </div>
                  <div className="col-md-5">
                    <label className="form-label small">Prices are in</label>
                    <select className="form-select form-select-sm" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                      <option value="LRD">Liberian Dollars (LRD) — default</option>
                      <option value="USD">US Dollars (USD)</option>
                    </select>
                  </div>
                </div>
                <div className="mt-3 d-flex justify-content-end gap-2">
                  <button className="btn btn-outline-secondary btn-sm" onClick={onClose}>Cancel</button>
                  <button className="btn btn-primary btn-sm" disabled={!file || busy}
                    onClick={() => file && onImport(file, currency)}>
                    {busy ? <><span className="spinner-border spinner-border-sm me-1"></span>Importing...</> : <><i className="bi bi-cloud-upload me-1"></i>Upload & Apply</>}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="d-flex flex-wrap gap-2 mb-3">
                  <span className="badge bg-success"><i className="bi bi-check-lg me-1"></i>{result.applied} rows applied</span>
                  <span className="badge bg-light text-dark border">Exchange rate: {result.exchangeRate} LRD = 1 USD</span>
                  <span className="badge bg-light text-dark border">Source: {result.sourceCurrency}</span>
                </div>
                <div className="row g-2 small mb-3">
                  <div className="col-6 col-md-3"><div className="border rounded-3 p-2">Catalog updated<div className="fw-bold text-primary">{result.catalogUpdated}</div></div></div>
                  <div className="col-6 col-md-3"><div className="border rounded-3 p-2">Catalog created<div className="fw-bold text-primary">{result.catalogCreated}</div></div></div>
                  <div className="col-6 col-md-3"><div className="border rounded-3 p-2">Inventory updated<div className="fw-bold text-success">{result.inventoryUpdated}</div></div></div>
                  <div className="col-6 col-md-3"><div className="border rounded-3 p-2">Inventory created<div className="fw-bold text-success">{result.inventoryCreated}</div></div></div>
                </div>
                {result.preview && (
                  <details className="border rounded-3 p-2 small mb-3">
                    <summary className="fw-semibold text-muted" style={{ cursor: 'pointer' }}>Extracted content preview</summary>
                    <pre className="mb-0 mt-2" style={{ whiteSpace: 'pre-wrap', fontSize: '0.75rem', color: '#495057' }}>{result.preview}</pre>
                  </details>
                )}
                {result.rows.length > 0 && (
                  <div className="table-responsive" style={{ maxHeight: '280px' }}>
                    <table className="table table-sm small mb-0">
                      <thead className="table-light sticky-top">
                        <tr><th>No</th><th>Description</th><th>Category</th><th className="text-end">LRD</th><th className="text-end">USD</th><th>Catalog</th></tr>
                      </thead>
                      <tbody>
                        {result.rows.map((r, i) => (
                          <tr key={i}>
                            <td>{r.no || '—'}</td>
                            <td>{r.description}</td>
                            <td><span className="badge bg-light text-dark border">{r.category}</span></td>
                            <td className="text-end">{r.unitPriceLRD.toLocaleString()}</td>
                            <td className="text-end">${r.unitPriceUSD.toFixed(2)}</td>
                            <td><span className={`badge ${r.catalog === 'created' ? 'bg-warning text-dark' : 'bg-success'}`}>{r.catalog}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="mt-3 d-flex justify-content-end">
                  <button className="btn btn-primary btn-sm" onClick={onClose}>Done</button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Barcode label print modal ─────────────────────────────────────────────

function BarcodePrintModal({ item, onClose }: { item: InventoryItem; onClose: () => void }) {
  const barcode = item.barcode || item.item_code || `INV-${item.id}`;
  return (
    <div className="modal d-block" style={{ background: 'rgba(0,0,0,0.45)' }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-dialog modal-sm modal-dialog-centered">
        <div className="modal-content" style={{ borderRadius: '16px' }}>
          <div className="modal-header">
            <h6 className="modal-title mb-0">Barcode Label</h6>
            <button className="btn-close" onClick={onClose}></button>
          </div>
          <div className="modal-body">
            <style>{`
              @media print {
                body * { visibility: hidden !important; }
                #barcode-print-area, #barcode-print-area * { visibility: visible !important; }
                #barcode-print-area { position: absolute; left: 0; top: 0; width: 100%; }
              }
            `}</style>
            <div id="barcode-print-area" className="border rounded-3 p-3 text-center bg-white">
              <div className="fw-bold" style={{ fontSize: '0.85rem' }}>{item.item_name}</div>
              <div className="text-muted small">{item.item_code || '—'} · {item.category}</div>
              <BarcodeSvg value={barcode} height={52} fontSize={11} />
              <div className="small" style={{ fontFamily: 'monospace' }}>{barcode}</div>
              <div className="d-flex justify-content-center gap-3 small mt-2 flex-wrap">
                {item.lot_number && <span>Lot: <b>{item.lot_number}</b></span>}
                {item.expiration_date && <span>Exp: <b>{fmtDate(item.expiration_date)}</b></span>}
                {item.unit_price != null && <span>Price: <b>${Number(item.unit_price).toFixed(2)}</b></span>}
              </div>
            </div>
            <div className="d-flex justify-content-end gap-2 mt-3">
              <button className="btn btn-outline-secondary btn-sm" onClick={onClose}>Close</button>
              <button className="btn btn-primary btn-sm" onClick={() => window.print()}><i className="bi bi-printer me-1"></i>Print</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Stock action modal ───────────────────────────────────────────────────

function StockActionModal({ action, items, busy, onClose, onSubmit }: {
  action: ActionForm;
  items: InventoryItem[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (data: any) => void;
}) {
  const { item, type } = action;
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [destinationItemId, setDestinationItemId] = useState('');
  const [destinationLocation, setDestinationLocation] = useState('');

  const labels: Record<string, string> = {
    receive: 'Receive Stock',
    issue: 'Issue Stock',
    transfer: 'Transfer Stock',
    return: 'Return Stock',
    adjust: 'Adjust Quantity',
  };

  const submit = () => {
    const quantity = Number(qty);
    if (type !== 'adjust' && (!Number.isFinite(quantity) || quantity <= 0)) {
      alert('Enter a positive quantity'); return;
    }
    const base = { reason: reason.trim() || undefined, notes: notes || undefined };
    if (type === 'receive') onSubmit({ quantity, ...base });
    if (type === 'issue') onSubmit({ quantity, destinationLocation: destinationLocation || undefined, ...base });
    if (type === 'return') onSubmit({ quantity, ...base });
    if (type === 'adjust') {
      const target = Number(qty);
      if (!Number.isFinite(target) || target < 0) { alert('Enter a valid target quantity'); return; }
      if (!reason.trim()) { alert('A reason is required for adjustments'); return; }
      onSubmit({ newQuantity: target, reason: reason.trim(), notes: notes || undefined });
    }
    if (type === 'transfer') {
      if (!destinationItemId) { alert('Select a destination item'); return; }
      onSubmit({ quantity, destinationItemId: Number(destinationItemId), ...base });
    }
  };

  return (
    <div className="modal d-block fade show" tabIndex={-1}>
      <div className="modal-dialog modal-dialog-centered">
        <div className="modal-content" style={{ borderRadius: '18px' }}>
          <div className="modal-header">
            <h6 className="modal-title fw-bold">{labels[type]}</h6>
            <button type="button" className="btn-close" onClick={onClose}></button>
          </div>
          <div className="modal-body">
            <div className="small text-muted mb-2">{item.item_name} — current stock: <strong>{item.current_quantity} {item.unit || ''}</strong></div>

            {type === 'adjust' ? (
              <div className="mb-2"><label className="form-label small mb-0">Target Quantity *</label>
                <input type="number" min="0" className="form-control form-control-sm" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
            ) : (
              <div className="mb-2"><label className="form-label small mb-0">Quantity *</label>
                <input type="number" min="1" className="form-control form-control-sm" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
            )}

            {type === 'transfer' && (
              <div className="mb-2"><label className="form-label small mb-0">Destination Item *</label>
                <select className="form-select form-select-sm" value={destinationItemId} onChange={(e) => setDestinationItemId(e.target.value)}>
                  <option value="">Select destination item…</option>
                  {items.filter((i) => i.id !== item.id).map((i) => (
                    <option key={i.id} value={i.id}>{i.item_name} ({i.department || '—'})</option>
                  ))}
                </select></div>
            )}

            {type === 'issue' && (
              <div className="mb-2"><label className="form-label small mb-0">Issued To (department/location)</label>
                <input className="form-control form-control-sm" placeholder="e.g. Emergency" value={destinationLocation} onChange={(e) => setDestinationLocation(e.target.value)} /></div>
            )}

            <div className="mb-2"><label className="form-label small mb-0">Reason{type === 'adjust' ? ' *' : ''}</label>
              <input className="form-control form-control-sm" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
            <div className="mb-0"><label className="form-label small mb-0">Notes</label>
              <textarea className="form-control form-control-sm" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          </div>
          <div className="modal-footer">
            <button className="btn btn-outline-secondary btn-sm" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={submit} disabled={busy}>
              {busy ? <span className="spinner-border spinner-border-sm" /> : 'Submit'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Purchase orders tab ──────────────────────────────────────────────────

const PO_STATUS_STYLES: Record<string, string> = {
  DRAFT: 'bg-secondary',
  SUBMITTED: 'bg-info text-dark',
  APPROVED: 'bg-primary',
  RECEIVED: 'bg-success',
  PARTIALLY_RECEIVED: 'bg-warning text-dark',
  CANCELLED: 'bg-danger',
};

function PoStatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge rounded-pill ${PO_STATUS_STYLES[status] || 'bg-secondary'}`} style={{ fontSize: '0.7rem' }}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function PurchaseOrdersTab({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [vendorId, setVendorId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<any[]>([{ inventory_item_id: '', quantity: '' }]);
  const [msg, setMsg] = useState('');

  const { data: pos = [], isLoading } = useQuery({ queryKey: ['inventory', 'purchase-orders'], queryFn: getPurchaseOrders });
  const { data: vendors = [] } = useQuery({ queryKey: ['inventory', 'vendors'], queryFn: getVendors });
  const { data: poItems = [] } = useQuery({
    queryKey: ['inventory', 'items-for-po'],
    queryFn: () => getInventory({ pageSize: 100 }).then((d) => d.items),
  });

  const createMut = useMutation({
    mutationFn: (d: any) => createPurchaseOrder(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory'] }); setShowForm(false); setMsg('Purchase order created'); },
    onError: (e) => setMsg(errMsg(e)),
  });
  const receiveMut = useMutation({
    mutationFn: (id: number) => receivePurchaseOrder(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory'] }); setMsg('Purchase order received — stock updated'); },
    onError: (e) => setMsg(errMsg(e)),
  });

  const submit = () => {
    const clean = lines
      .filter((l) => l.inventory_item_id && Number(l.quantity) > 0)
      .map((l) => ({ inventory_item_id: Number(l.inventory_item_id), quantity: Number(l.quantity) }));
    if (!clean.length) { setMsg('Add at least one line item with a positive quantity'); return; }
    createMut.mutate({
      vendor_id: vendorId ? Number(vendorId) : null,
      expected_date: expectedDate || null,
      notes: notes || null,
      items: clean,
    });
  };

  return (
    <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
      <div className="card-header bg-white d-flex justify-content-between align-items-center py-3" style={{ borderRadius: '16px 16px 0 0' }}>
        <h6 className="mb-0 fw-bold"><i className="bi bi-receipt me-2 text-primary"></i>Purchase Orders</h6>
        {canManage && <button className="btn btn-primary btn-sm rounded-pill" onClick={() => { setMsg(''); setShowForm((v) => !v); }}><i className="bi bi-plus-lg me-1"></i>New PO</button>}
      </div>
      <div className="card-body p-0">
        {msg && <div className="alert alert-warning py-2 px-3 mx-3 mt-3 mb-0 small">{msg}</div>}

        {showForm && (
          <div className="p-3 border-bottom" style={{ backgroundColor: '#f8f9fa' }}>
            <div className="row g-2 mb-2">
              <div className="col-md-4"><label className="form-label small mb-0">Vendor</label>
                <select className="form-select form-select-sm" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
                  <option value="">— None —</option>
                  {vendors.map((v: Vendor) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select></div>
              <div className="col-md-4"><label className="form-label small mb-0">Expected Date</label>
                <input type="date" className="form-control form-control-sm" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} /></div>
              <div className="col-md-4"><label className="form-label small mb-0">Notes</label>
                <input className="form-control form-control-sm" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            </div>

            {lines.map((line, idx) => (
              <div className="row g-2 mb-1" key={idx}>
                <div className="col-md-8"><label className="form-label small mb-0">Item</label>
                  <select className="form-select form-select-sm" value={line.inventory_item_id} onChange={(e) => setLines((ls) => ls.map((l, i) => i === idx ? { ...l, inventory_item_id: e.target.value } : l))}>
                    <option value="">Select item…</option>
                    {poItems.map((it) => <option key={it.id} value={it.id}>{it.item_name} ({it.item_code || '—'})</option>)}
                  </select></div>
                <div className="col-md-3"><label className="form-label small mb-0">Qty</label>
                  <input type="number" min="1" className="form-control form-control-sm" value={line.quantity} onChange={(e) => setLines((ls) => ls.map((l, i) => i === idx ? { ...l, quantity: e.target.value } : l))} /></div>
                <div className="col-md-1 d-flex align-items-end">
                  <button className="btn btn-outline-danger btn-sm" onClick={() => setLines((ls) => ls.filter((_, i) => i !== idx))}><i className="bi bi-x" /></button>
                </div>
              </div>
            ))}
            <button className="btn btn-outline-secondary btn-sm mb-2" onClick={() => setLines((ls) => [...ls, { inventory_item_id: '', quantity: '' }])}><i className="bi bi-plus me-1"></i>Add line</button>
            <div>
              <button className="btn btn-primary btn-sm" onClick={submit} disabled={createMut.isPending}>
                {createMut.isPending ? <span className="spinner-border spinner-border-sm" /> : 'Create PO'}
              </button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="text-center py-5"><div className="spinner-border text-primary" /></div>
        ) : pos.length === 0 ? (
          <div className="text-center text-muted py-5"><i className="bi bi-receipt fs-1 d-block mb-2 opacity-50"></i>No purchase orders</div>
        ) : (
          <div className="table-responsive">
            <table className="table table-hover small align-middle mb-0">
              <thead className="table-light"><tr><th>PO #</th><th>Vendor</th><th>Status</th><th className="text-end">Total</th><th className="text-center">Items</th><th>Created</th><th></th></tr></thead>
              <tbody>
                {pos.map((po: PurchaseOrder) => (
                  <tr key={po.id}>
                    <td className="fw-semibold">{po.po_number}</td>
                    <td>{po.vendor_name || '—'}</td>
                    <td><PoStatusBadge status={po.status} /></td>
                    <td className="text-end">{money(po.total_cost)}</td>
                    <td className="text-center">{po.items.length}</td>
                    <td>{fmtDateTime(po.order_date)}</td>
                    <td className="text-end">
                      {canManage && !['RECEIVED', 'CANCELLED'].includes(po.status) && (
                        <button className="btn btn-outline-success btn-sm" disabled={receiveMut.isPending} onClick={() => receiveMut.mutate(po.id)}>Receive</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Vendors tab ──────────────────────────────────────────────────────────

function VendorsTab({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<any>({ name: '', contact_name: '', email: '', phone: '', address: '', categories: '' });
  const { data: vendors = [], isLoading } = useQuery({ queryKey: ['inventory', 'vendors'], queryFn: getVendors });

  const createMut = useMutation({
    mutationFn: (d: any) => createVendor(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory'] }); setShowForm(false); setForm({ name: '', contact_name: '', email: '', phone: '', address: '', categories: '' }); },
    onError: (e) => alert(errMsg(e)),
  });

  const portalUrl = (v: Vendor) => `${window.location.origin}/vendor/portal/${v.access_token}`;

  return (
    <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
      <div className="card-header bg-white d-flex justify-content-between align-items-center py-3" style={{ borderRadius: '16px 16px 0 0' }}>
        <h6 className="mb-0 fw-bold"><i className="bi bi-truck me-2 text-success"></i>Vendors</h6>
        {canManage && <button className="btn btn-primary btn-sm rounded-pill" onClick={() => setShowForm((v) => !v)}><i className="bi bi-plus-lg me-1"></i>Add Vendor</button>}
      </div>
      <div className="card-body p-0">
        {showForm && (
          <div className="p-3 border-bottom" style={{ backgroundColor: '#f8f9fa' }}>
            <div className="row g-2">
              <div className="col-md-6"><label className="form-label small mb-0">Name *</label>
                <input className="form-control form-control-sm" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div className="col-md-6"><label className="form-label small mb-0">Contact Name</label>
                <input className="form-control form-control-sm" value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} /></div>
              <div className="col-md-4"><label className="form-label small mb-0">Email</label>
                <input className="form-control form-control-sm" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              <div className="col-md-4"><label className="form-label small mb-0">Phone</label>
                <input className="form-control form-control-sm" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
              <div className="col-md-4"><label className="form-label small mb-0">Categories</label>
                <input className="form-control form-control-sm" value={form.categories} onChange={(e) => setForm({ ...form, categories: e.target.value })} /></div>
              <div className="col-md-12"><label className="form-label small mb-0">Address</label>
                <input className="form-control form-control-sm" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
            </div>
            <button className="btn btn-primary btn-sm mt-2" disabled={createMut.isPending} onClick={() => { if (!form.name.trim()) { alert('Vendor name is required'); return; } createMut.mutate(form); }}>
              {createMut.isPending ? <span className="spinner-border spinner-border-sm" /> : 'Save Vendor'}
            </button>
          </div>
        )}

        {isLoading ? (
          <div className="text-center py-5"><div className="spinner-border text-primary" /></div>
        ) : vendors.length === 0 ? (
          <div className="text-center text-muted py-5"><i className="bi bi-truck fs-1 d-block mb-2 opacity-50"></i>No vendors</div>
        ) : (
          <div className="table-responsive">
            <table className="table table-hover small align-middle mb-0">
              <thead className="table-light"><tr><th>Vendor</th><th>Contact</th><th>Email / Phone</th><th>Categories</th><th>Portal Link</th></tr></thead>
              <tbody>
                {vendors.map((v: Vendor) => (
                  <tr key={v.id}>
                    <td className="fw-semibold">{v.name}</td>
                    <td>{v.contact_name || '—'}</td>
                    <td>{v.email || '—'}<br /><small className="text-muted">{v.phone || ''}</small></td>
                    <td>{v.categories || '—'}</td>
                    <td>
                      <div className="input-group input-group-sm" style={{ minWidth: '220px' }}>
                        <input className="form-control" readOnly value={portalUrl(v)} style={{ fontSize: '0.68rem' }} />
                        <button className="btn btn-outline-secondary" title="Copy link" onClick={() => navigator.clipboard?.writeText(portalUrl(v))}><i className="bi bi-clipboard" /></button>
                        <a className="btn btn-outline-primary" title="Open portal" href={portalUrl(v)} target="_blank" rel="noreferrer"><i className="bi bi-box-arrow-up-right" /></a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Reorder tab ──────────────────────────────────────────────────────────

function ReorderTab({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const [msg, setMsg] = useState('');
  const { data: suggestions = [], isLoading } = useQuery({ queryKey: ['inventory', 'reorder'], queryFn: getReorderSuggestions });

  const createMut = useMutation({
    mutationFn: (d: any) => createPurchaseOrder(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory'] }); setMsg('Reorder PO created as DRAFT — review in Purchase Orders tab'); },
    onError: (e) => setMsg(errMsg(e)),
  });
  const requestMut = useMutation({
    mutationFn: (d: any) => createInventoryRequest(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory'] }); setMsg('Reorder request created — review in Requests tab for approval'); },
    onError: (e) => setMsg(errMsg(e)),
  });

  const createPoFromSuggestions = () => {
    if (!suggestions.length) return;
    createMut.mutate({ items: suggestions.map((s) => ({ inventory_item_id: s.id, quantity: s.suggested_quantity })) });
  };

  const createRequestFromSuggestions = () => {
    if (!suggestions.length) return;
    requestMut.mutate({
      department: 'General Store',
      reason: 'Auto reorder — stock at or below reorder point',
      items: suggestions.map((s) => ({ inventory_item_id: s.id, quantity: s.suggested_quantity })),
    });
  };

  return (
    <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
      <div className="card-header bg-white d-flex justify-content-between align-items-center py-3" style={{ borderRadius: '16px 16px 0 0' }}>
        <h6 className="mb-0 fw-bold"><i className="bi bi-arrow-repeat me-2 text-warning"></i>Auto-Reorder Suggestions</h6>
        {canManage && suggestions.length > 0 && (
          <div className="d-flex gap-1 flex-wrap">
            <button className="btn btn-outline-warning btn-sm rounded-pill" disabled={requestMut.isPending} onClick={createRequestFromSuggestions}>
              <i className="bi bi-clipboard-check me-1"></i>Create Request
            </button>
            <button className="btn btn-warning btn-sm rounded-pill" disabled={createMut.isPending} onClick={createPoFromSuggestions}>
              <i className="bi bi-receipt me-1"></i>Generate Reorder PO
            </button>
          </div>
        )}
      </div>
      <div className="card-body p-0">
        {msg && <div className="alert alert-info py-2 px-3 mx-3 mt-3 mb-0 small">{msg}</div>}
        {isLoading ? (
          <div className="text-center py-5"><div className="spinner-border text-primary" /></div>
        ) : suggestions.length === 0 ? (
          <div className="text-center text-muted py-5"><i className="bi bi-check2-circle fs-1 d-block mb-2 opacity-50"></i>All items are above their reorder point</div>
        ) : (
          <div className="table-responsive">
            <table className="table table-hover small align-middle mb-0">
              <thead className="table-light"><tr><th>Item</th><th>Department</th><th className="text-end">Current</th><th className="text-end">Minimum</th><th className="text-end">Reorder To</th><th className="text-end">Suggested Qty</th><th>Status</th></tr></thead>
              <tbody>
                {suggestions.map((s: ReorderSuggestion) => (
                  <tr key={s.id}>
                    <td className="fw-semibold">{s.item_name}<br /><small className="text-muted">{s.item_code || ''}</small></td>
                    <td>{s.department || '—'}</td>
                    <td className="text-end">{s.current_quantity}</td>
                    <td className="text-end">{s.minimum_quantity}</td>
                    <td className="text-end">{s.reorder_to}</td>
                    <td className="text-end fw-bold text-primary">{s.suggested_quantity}</td>
                    <td><StatusBadge status={s.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Forecast & accounting tab ────────────────────────────────────────────

function ReportsTab() {
  const { data: forecast = [], isLoading: fLoading } = useQuery({ queryKey: ['inventory', 'forecast'], queryFn: getForecast });
  const { data: accounting } = useQuery({ queryKey: ['inventory', 'accounting'], queryFn: getAccountingSummary });

  /**
   * The forecast returns one row per inventory item — 300+ on this dataset — so
   * the card used to run the length of the page, sorted arbitrarily and mostly
   * full of items that had not moved in 90 days.
   *
   * It is now a focused view: the things that need action come first, the dead
   * stock is tucked behind its own filter, and only a short window of rows is
   * rendered until the user asks for the rest.
   */
  const [fFilter, setFFilter] = useState<'attention' | 'inuse' | 'nouse' | 'all'>('attention');
  const [fSearch, setFSearch] = useState('');
  const [fShowAll, setFShowAll] = useState(false);

  /** Rows the user must act on soon; a shortage risk always counts. */
  const fIsAttention = (f: ForecastRow) =>
    f.projected_shortage || (f.days_remaining != null && f.days_remaining <= 14);

  /** Shortest runway first, then alphabetical, with untouched items last. */
  const fSorted = useMemo(() => {
    const noUse = (f: ForecastRow) => !(f.avg_daily_usage > 0);
    return [...forecast].sort((a, b) => {
      if (noUse(a) !== noUse(b)) return noUse(a) ? 1 : -1;
      const av = a.days_remaining ?? Number.MAX_SAFE_INTEGER;
      const bv = b.days_remaining ?? Number.MAX_SAFE_INTEGER;
      if (av !== bv) return av - bv;
      return String(a.item_name).localeCompare(String(b.item_name));
    });
  }, [forecast]);

  const fAttention = useMemo(() => fSorted.filter(fIsAttention), [fSorted]);
  const fInUse = useMemo(() => fSorted.filter((f: ForecastRow) => f.avg_daily_usage > 0), [fSorted]);
  const fNoUse = useMemo(
    () => fSorted.filter((f: ForecastRow) => !(f.avg_daily_usage > 0)),
    [fSorted],
  );

  const fVisible = useMemo(() => {
    const base =
      fFilter === 'attention' ? fAttention
      : fFilter === 'inuse' ? fInUse
      : fFilter === 'nouse' ? fNoUse
      : fSorted;
    const q = fSearch.trim().toLowerCase();
    if (!q) return base;
    return base.filter((f: ForecastRow) =>
      `${f.item_name} ${f.item_code || ''}`.toLowerCase().includes(q),
    );
  }, [fFilter, fSearch, fAttention, fInUse, fNoUse, fSorted]);

  // Short by default; the full list is one click away.
  const F_WINDOW = 6;
  const fRows = fShowAll ? fVisible : fVisible.slice(0, F_WINDOW);

  /**
   * `projected_shortage` is the backend's "at or below the reorder point" flag,
   * which is not the same as running out — an item can sit at its minimum with
   * months of cover. It gets its own wording so the badge is not alarming, and
   * the remaining labels come from the runway.
   */
  const fRisk = (f: ForecastRow) => {
    if (!(f.avg_daily_usage > 0)) return { label: 'No usage', cls: 'bg-light text-muted border' };
    const d = f.days_remaining;
    if (f.projected_shortage) return { label: 'Reorder now', cls: 'bg-danger' };
    if (d != null && d <= 7) return { label: 'Critical', cls: 'bg-danger' };
    if (d != null && d <= 14) return { label: 'Low', cls: 'bg-warning text-dark' };
    if (d != null && d <= 30) return { label: 'Watch', cls: 'bg-info text-dark' };
    return { label: 'Adequate', cls: 'bg-success' };
  };

  return (
    <div>
      <div className="row g-3 mb-3">
        {[
          { label: 'Inventory Value', value: money(accounting?.inventoryValue), icon: 'bi-cash-stack', color: '#198754' },
          { label: 'PO Spend (approved)', value: money(accounting?.purchaseOrderSpend), icon: 'bi-receipt', color: '#0d6efd' },
          { label: 'Issued Value', value: money(accounting?.issuedValue), icon: 'bi-box-arrow-up', color: '#fd7e14' },
        ].map((k) => (
          <div className="col-md-4" key={k.label}>
            <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
              <div className="card-body d-flex align-items-center gap-3 py-3">
                <div className="rounded-circle d-flex align-items-center justify-content-center" style={{ width: '46px', height: '46px', backgroundColor: `${k.color}15` }}>
                  <i className={`bi ${k.icon}`} style={{ color: k.color, fontSize: '1.2rem' }}></i>
                </div>
                <div><div className="fs-5 fw-bold">{k.value}</div><small className="text-muted">{k.label}</small></div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="row g-3">
        <div className="col-lg-5">
          <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
            <div className="card-header bg-white py-3" style={{ borderRadius: '16px 16px 0 0' }}>
              <h6 className="mb-0 fw-bold"><i className="bi bi-pie-chart me-2 text-primary"></i>Value by Category</h6>
            </div>
            <div className="card-body">
              {(accounting?.byCategoryValue || []).map((c) => (
                <div key={c.category} className="d-flex justify-content-between small mb-2">
                  <span>{c.category}</span>
                  <span className="fw-semibold">{money(c.value)}</span>
                </div>
              ))}
              {(!accounting?.byCategoryValue || accounting.byCategoryValue.length === 0) && <div className="text-muted small">No data</div>}
            </div>
          </div>
        </div>
        <div className="col-lg-7">
          <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
            <div className="card-header bg-white py-3" style={{ borderRadius: '16px 16px 0 0' }}>
              <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
                <h6 className="mb-0 fw-bold"><i className="bi bi-graph-up me-2 text-info"></i>Demand Forecast (90-day avg usage)</h6>
                <span className="text-muted small">{forecast.length} items tracked</span>
              </div>
            </div>

            {fLoading ? (
              <div className="text-center py-4"><div className="spinner-border text-primary" /></div>
            ) : (
              <>
                {/* Focus switch — only what needs action is shown to begin with. */}
                <div className="px-3 pt-3 d-flex flex-wrap align-items-center gap-2">
                  {([
                    ['attention', 'Needs attention', fAttention.length, 'bg-danger'],
                    ['inuse', 'In use', fInUse.length, 'bg-primary'],
                    ['nouse', 'No usage', fNoUse.length, 'bg-secondary'],
                    ['all', 'All', fSorted.length, 'bg-dark'],
                  ] as const).map(([key, label, count, tone]) => (
                    <button
                      key={key}
                      type="button"
                      className={`btn btn-sm rounded-pill ${fFilter === key ? 'btn-primary' : 'btn-outline-secondary'}`}
                      onClick={() => { setFFilter(key); setFShowAll(false); }}
                    >
                      {label}
                      <span className={`badge rounded-pill ms-1 ${fFilter === key ? 'bg-light text-dark' : tone}`}>{count}</span>
                    </button>
                  ))}
                  <div className="input-group input-group-sm ms-auto" style={{ maxWidth: 200 }}>
                    <span className="input-group-text bg-white"><i className="bi bi-search text-muted"></i></span>
                    <input
                      className="form-control"
                      placeholder="Find an item…"
                      value={fSearch}
                      onChange={e => { setFSearch(e.target.value); setFShowAll(false); }}
                    />
                  </div>
                </div>

                <div className="card-body pt-2">
                  {fRows.length === 0 ? (
                    <div className="text-center text-muted small py-4">
                      <i className={`bi ${fSearch ? 'bi-search' : 'bi-check2-circle'} me-1`}></i>
                      {fSearch
                        ? 'No item matches that search.'
                        : fFilter === 'attention'
                          ? 'Nothing needs attention in the next 14 days.'
                          : 'Nothing to show here.'}
                    </div>
                  ) : (
                    <>
                      <div className="table-responsive" style={{ maxHeight: fShowAll ? '60vh' : undefined }}>
                        <table className="table table-hover table-sm small align-middle mb-0">
                          <thead className="table-light">
                            <tr>
                              <th>Item</th>
                              <th className="text-end">Current</th>
                              <th className="text-end">Avg / day</th>
                              <th className="text-end">Days left</th>
                              <th className="text-center">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {fRows.map((f: ForecastRow) => {
                              const risk = fRisk(f);
                              return (
                                <tr key={f.id}>
                                  <td className="fw-semibold">
                                    <span className="text-truncate d-inline-block" style={{ maxWidth: 190 }} title={f.item_name}>
                                      {f.item_name}
                                    </span>
                                    {f.item_code && <span className="text-muted ms-1" style={{ fontSize: '0.68rem' }}>{f.item_code}</span>}
                                  </td>
                                  <td className="text-end">{f.current_quantity} {f.unit || ''}</td>
                                  <td className="text-end">{f.avg_daily_usage}</td>
                                  <td className="text-end">{f.days_remaining == null ? '—' : `${f.days_remaining}d`}</td>
                                  <td className="text-center">
                                    <span className={`badge rounded-pill ${risk.cls}`} style={{ fontSize: '0.66rem' }}>{risk.label}</span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {fVisible.length > F_WINDOW && (
                        <div className="text-center pt-1">
                          <button
                            type="button"
                            className="btn btn-sm btn-link text-decoration-none"
                            onClick={() => setFShowAll(v => !v)}
                          >
                            {fShowAll ? 'Show fewer' : `Show all ${fVisible.length}`}
                            <i className={`bi bi-chevron-${fShowAll ? 'up' : 'down'} ms-1`}></i>
                          </button>
                        </div>
                      )}

                      {fVisible.length > fRows.length && (
                        <div className="text-muted text-center pb-1" style={{ fontSize: '0.7rem' }}>
                          showing {fRows.length} of {fVisible.length}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Inventory requests (requisitions) ────────────────────────────────────

const REQUEST_STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-warning text-dark',
  APPROVED: 'bg-success',
  REJECTED: 'bg-danger',
  ORDERED: 'bg-primary',
};

function RequestStatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge rounded-pill ${REQUEST_STATUS_STYLES[status] || 'bg-secondary'}`} style={{ fontSize: '0.7rem' }}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function RequestsTab({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [department, setDepartment] = useState('Nursing');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<any[]>([{ inventory_item_id: '', quantity: '' }]);
  const [msg, setMsg] = useState('');

  const { data: requests = [], isLoading } = useQuery({ queryKey: ['inventory', 'requests'], queryFn: getInventoryRequests });
  const { data: reqItems = [] } = useQuery({
    queryKey: ['inventory', 'items-for-request'],
    queryFn: () => getInventory({ pageSize: 100 }).then((d) => d.items),
  });

  const createMut = useMutation({
    mutationFn: (d: any) => createInventoryRequest(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory'] }); setShowForm(false); setMsg('Request submitted — awaiting approval'); },
    onError: (e) => setMsg(errMsg(e)),
  });
  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => updateInventoryRequestStatus(id, status),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory'] }); setMsg('Request updated'); },
    onError: (e) => setMsg(errMsg(e)),
  });
  const orderMut = useMutation({
    mutationFn: (id: number) => orderInventoryRequest(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory'] }); setMsg('Purchase order created from request'); },
    onError: (e) => setMsg(errMsg(e)),
  });

  const submit = () => {
    const clean = lines
      .filter((l) => l.inventory_item_id && Number(l.quantity) > 0)
      .map((l) => ({ inventory_item_id: Number(l.inventory_item_id), quantity: Number(l.quantity) }));
    if (!clean.length) { setMsg('Add at least one item with a positive quantity'); return; }
    if (!department) { setMsg('Department is required'); return; }
    createMut.mutate({ department, reason: reason || null, items: clean });
  };

  return (
    <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
      <div className="card-header bg-white d-flex justify-content-between align-items-center py-3" style={{ borderRadius: '16px 16px 0 0' }}>
        <h6 className="mb-0 fw-bold"><i className="bi bi-clipboard-check me-2 text-primary"></i>Inventory Requests</h6>
        {canManage && <button className="btn btn-primary btn-sm rounded-pill" onClick={() => { setMsg(''); setShowForm((v) => !v); }}><i className="bi bi-plus-lg me-1"></i>New Request</button>}
      </div>
      <div className="card-body p-0">
        {msg && <div className="alert alert-info py-2 px-3 mx-3 mt-3 mb-0 small">{msg}</div>}

        {showForm && (
          <div className="p-3 border-bottom" style={{ backgroundColor: '#f8f9fa' }}>
            <div className="row g-2 mb-2">
              <div className="col-md-4"><label className="form-label small mb-0">Department *</label>
                <select className="form-select form-select-sm" value={department} onChange={(e) => setDepartment(e.target.value)}>
                  {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select></div>
              <div className="col-md-8"><label className="form-label small mb-0">Reason</label>
                <input className="form-control form-control-sm" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Weekly ward restock" /></div>
            </div>
            {lines.map((line, idx) => (
              <div className="row g-2 mb-1" key={idx}>
                <div className="col-md-8"><label className="form-label small mb-0">Item</label>
                  <select className="form-select form-select-sm" value={line.inventory_item_id} onChange={(e) => setLines((ls) => ls.map((l, i) => i === idx ? { ...l, inventory_item_id: e.target.value } : l))}>
                    <option value="">Select item…</option>
                    {reqItems.map((it) => <option key={it.id} value={it.id}>{it.item_name} ({it.item_code || '—'})</option>)}
                  </select></div>
                <div className="col-md-3"><label className="form-label small mb-0">Qty</label>
                  <input type="number" min="1" className="form-control form-control-sm" value={line.quantity} onChange={(e) => setLines((ls) => ls.map((l, i) => i === idx ? { ...l, quantity: e.target.value } : l))} /></div>
                <div className="col-md-1 d-flex align-items-end">
                  <button className="btn btn-outline-danger btn-sm" onClick={() => setLines((ls) => ls.filter((_, i) => i !== idx))}><i className="bi bi-x" /></button>
                </div>
              </div>
            ))}
            <button className="btn btn-outline-secondary btn-sm mb-2" onClick={() => setLines((ls) => [...ls, { inventory_item_id: '', quantity: '' }])}><i className="bi bi-plus me-1"></i>Add line</button>
            <div><button className="btn btn-primary btn-sm" onClick={submit} disabled={createMut.isPending}>{createMut.isPending ? <span className="spinner-border spinner-border-sm" /> : 'Submit Request'}</button></div>
          </div>
        )}

        {isLoading ? (
          <div className="text-center py-5"><div className="spinner-border text-primary" /></div>
        ) : requests.length === 0 ? (
          <div className="text-center text-muted py-5"><i className="bi bi-clipboard-check fs-1 d-block mb-2 opacity-50"></i>No inventory requests</div>
        ) : (
          <div className="table-responsive">
            <table className="table table-hover small align-middle mb-0">
              <thead className="table-light"><tr><th>Request #</th><th>Department</th><th>Requested By</th><th>Status</th><th>Approved By</th><th className="text-center">Items</th><th>Created</th><th></th></tr></thead>
              <tbody>
                {requests.map((r: InventoryRequest) => (
                  <tr key={r.id}>
                    <td className="fw-semibold">{r.request_number}</td>
                    <td>{r.department || '—'}</td>
                    <td>{r.requested_by_name || '—'}</td>
                    <td><RequestStatusBadge status={r.status} /></td>
                    <td>
                      {r.approved_by_name ? (
                        <>
                          <span className="fw-semibold">{r.approved_by_name}</span>
                          <br /><small className="text-muted">{fmtDateTime(r.approved_at)}</small>
                          {r.status === 'APPROVED' && (
                            <span className="badge bg-primary bg-opacity-10 text-primary ms-1" style={{ fontSize: '0.6rem' }}>→ Pharmacy</span>
                          )}
                        </>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="text-center">{r.items.length}</td>
                    <td>{fmtDateTime(r.created_at)}</td>
                    <td className="text-end text-nowrap">
                      {canManage && r.status === 'PENDING' && (
                        <>
                          <button className="btn btn-outline-success btn-sm me-1" onClick={() => statusMut.mutate({ id: r.id, status: 'APPROVED' })}>Approve</button>
                          <button className="btn btn-outline-danger btn-sm me-1" onClick={() => statusMut.mutate({ id: r.id, status: 'REJECTED' })}>Reject</button>
                        </>
                      )}
                      {canManage && r.status === 'APPROVED' && (
                        <button className="btn btn-outline-primary btn-sm" onClick={() => orderMut.mutate(r.id)}>Convert to PO</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
