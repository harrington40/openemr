import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import nestClient from '../../api/nest-client';
import { useAuth } from '../../hooks/useAuth';
import { useCurrency } from '../../hooks/useCurrency';
import { formatMoney } from '../../utils/currency';
import CurrencySwitcher from '../../components/shared/CurrencySwitcher';

const CATEGORIES = [
  ['office', 'Office Visit'], ['lab', 'Lab'], ['imaging', 'Imaging'],
  ['procedure', 'Procedure'], ['supplies', 'Supplies'], ['room', 'Room & Board'],
  ['pharmacy', 'Pharmacy'], ['general', 'General'],
] as const;

type SortKey = 'code' | 'code_type' | 'description' | 'category' | 'cost' | 'fee' | 'margin';

const marginOf = (cost: number, fee: number): number | null => {
  if (!fee || fee <= 0) return null;
  return ((fee - cost) / fee) * 100;
};

const marginBadge = (m: number | null) => {
  if (m == null) return { cls: 'bg-light text-muted border', label: '—' };
  if (m >= 40) return { cls: 'bg-success bg-opacity-10 text-success border border-success', label: `${m.toFixed(0)}%` };
  if (m >= 20) return { cls: 'bg-warning bg-opacity-10 text-warning border border-warning', label: `${m.toFixed(0)}%` };
  return { cls: 'bg-danger bg-opacity-10 text-danger border border-danger', label: `${m.toFixed(0)}%` };
};

export default function ChargeCatalogPanel() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { currency, exchangeRate } = useCurrency();
  const isAdmin = user?.role === 'admin';
  // Only the administrator (supervisor) or a user granted the special
  // "edit charges" privilege may add/update/deactivate charges.
  const canEditCharges = isAdmin || user?.can_edit_charges === true;

  const [form, setForm] = useState({ code: '', code_type: 'CPT4', description: '', category: 'general', cost: '', fee: '' });
  const [editing, setEditing] = useState<Record<number, { fee: string; cost: string }>>({});
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [sortKey, setSortKey] = useState<SortKey>('code');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const { data: catalog = [] } = useQuery({
    queryKey: ['price-catalog'],
    queryFn: async () => { const r = await nestClient.get('/billing/price-catalog'); return r.data; },
  });

  const { data: ar } = useQuery({
    queryKey: ['accounts-receivable'],
    queryFn: async () => { const r = await nestClient.get('/billing/accounts-receivable'); return r.data; },
  });

  const createMutation = useMutation({
    mutationFn: (d: any) => nestClient.post('/billing/price-catalog', d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['price-catalog'] });
      setForm({ code: '', code_type: 'CPT4', description: '', category: 'general', cost: '', fee: '' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, d }: { id: number; d: any }) => nestClient.put(`/billing/price-catalog/${id}`, d),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['price-catalog'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => nestClient.delete(`/billing/price-catalog/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['price-catalog'] }),
  });

  const bulkDeactivate = useMutation({
    mutationFn: async (ids: number[]) => {
      for (const id of ids) await nestClient.delete(`/billing/price-catalog/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['price-catalog'] });
      setSelected(new Set());
    },
  });

  const suggestMutation = useMutation({
    mutationFn: (d: any) => nestClient.post('/billing/price-catalog/suggest', d),
  });

  const handleSuggest = () => {
    suggestMutation.mutate(
      { category: form.category, cost: Number(form.cost) || 0 },
      { onSuccess: (res: any) => setForm((f) => ({ ...f, fee: String(res.suggestedFee) })) },
    );
  };

  const handleAdd = () => {
    createMutation.mutate({
      code: form.code.trim(),
      code_type: form.code_type,
      description: form.description || form.code.trim(),
      category: form.category,
      cost: Number(form.cost) || 0,
      fee: Number(form.fee) || undefined,
    });
  };

  const saveEdit = (id: number) => {
    const e = editing[id];
    if (!e) return;
    updateMutation.mutate({ id, d: { fee: Number(e.fee), cost: Number(e.cost) } });
    setEditing((prev) => { const n = { ...prev }; delete n[id]; return n; });
  };

  // ── Smart grid: filter + sort ──────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (catalog as any[]).filter((c) =>
      (catFilter === 'all' || c.category === catFilter) &&
      (!q || `${c.code} ${c.description} ${c.category}`.toLowerCase().includes(q)),
    );
  }, [catalog, search, catFilter]);

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a: any, b: any) => {
      const val = (x: any) => {
        if (sortKey === 'margin') return marginOf(Number(x.cost) || 0, Number(x.fee) || 0) ?? -999;
        if (sortKey === 'cost' || sortKey === 'fee') return Number(x[sortKey]) || 0;
        return String(x[sortKey] || '').toLowerCase();
      };
      const av = val(a); const bv = val(b);
      return av < bv ? -dir : av > bv ? dir : 0;
    });
  }, [filtered, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  const allVisibleSelected = sorted.length > 0 && sorted.every((c: any) => selected.has(c.id));

  const toggleRow = (id: number) => {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const toggleAll = () => {
    setSelected(allVisibleSelected ? new Set() : new Set(sorted.map((c: any) => c.id)));
  };

  const selectionTotal = useMemo(
    () => sorted.filter((c: any) => selected.has(c.id)).reduce((s: number, c: any) => s + (Number(c.fee) || 0), 0),
    [sorted, selected],
  );

  const avgMargin = useMemo(() => {
    const ms = filtered
      .map((c: any) => marginOf(Number(c.cost) || 0, Number(c.fee) || 0))
      .filter((m): m is number => m != null);
    return ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : null;
  }, [filtered]);

  const sortArrow = (key: SortKey) =>
    sortKey !== key ? <i className="bi bi-arrow-down-up ms-1 opacity-25"></i>
      : <i className={`bi ${sortDir === 'asc' ? 'bi-sort-down' : 'bi-sort-up'} ms-1`}></i>;

  const th = (label: string, key: SortKey, cls = '') => (
    <th className={`user-select-none ${cls}`} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }} onClick={() => toggleSort(key)}>
      {label}{sortArrow(key)}
    </th>
  );

  return (
    <div className="mt-4">
      {/* Accounts Receivable aging */}
      {ar && (
        <div className="row g-3 mb-3">
          {[
            { label: 'Total Charges', value: ar.totalCharges, color: '#0d6efd', icon: 'bi-receipt' },
            { label: 'Payments Received', value: ar.totalPayments, color: '#198754', icon: 'bi-cash-stack' },
            { label: 'Outstanding Balance', value: ar.balance, color: '#dc3545', icon: 'bi-exclamation-circle' },
            { label: '90+ Days (Aging)', value: ar.aging.days_90_plus, color: '#6f42c1', icon: 'bi-hourglass-bottom' },
          ].map((k, i) => (
            <div className="col-md-3" key={i}>
              <div className="card border-0 shadow-sm h-100" style={{ borderRadius: '16px' }}>
                <div className="card-body d-flex align-items-center gap-3">
                  <div className="rounded-circle d-flex align-items-center justify-content-center" style={{ width: '44px', height: '44px', backgroundColor: k.color + '18' }}>
                    <i className={`bi ${k.icon} fs-5`} style={{ color: k.color }}></i>
                  </div>
                  <div><div className="text-muted small">{k.label}</div><div className="fw-bold fs-5">{formatMoney(k.value, currency, exchangeRate)}</div></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Charge Catalog */}
      <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
        <div className="card-header bg-white d-flex justify-content-between align-items-center py-3" style={{ borderRadius: '16px 16px 0 0' }}>
          <h6 className="mb-0 fw-bold"><i className="bi bi-tags me-2 text-primary"></i>Charge Catalog & Pricing</h6>
          <div className="d-flex align-items-center gap-3">
            <CurrencySwitcher />
            <span className="badge bg-primary rounded-pill">{catalog.length} charges</span>
          </div>
        </div>
        <div className="card-body">
          {/* Add / smart-price form (permission-gated) */}
          {!canEditCharges && (
            <div className="alert alert-warning py-2 px-3 small d-flex align-items-center rounded-3 mb-3">
              <i className="bi bi-lock-fill me-2"></i>
              Read-only — only a supervisor or a user with charge-edit permission can add or change charges.
            </div>
          )}
          {canEditCharges && (
          <div className="row g-2 align-items-end mb-3">
            <div className="col-md-2"><label className="form-label small mb-0">Code *</label><input className="form-control form-control-sm" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="99213" /></div>
            <div className="col-md-2"><label className="form-label small mb-0">Type</label>
              <select className="form-select form-select-sm" value={form.code_type} onChange={(e) => setForm({ ...form, code_type: e.target.value })}>
                <option>CPT4</option><option>HCPCS</option><option>ICD10</option>
              </select>
            </div>
            <div className="col-md-2"><label className="form-label small mb-0">Category</label>
              <select className="form-select form-select-sm" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="col-md-2"><label className="form-label small mb-0">Description</label><input className="form-control form-control-sm" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div className="col-md-1"><label className="form-label small mb-0">Cost</label><input className="form-control form-control-sm" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} /></div>
            <div className="col-md-1"><label className="form-label small mb-0">Fee</label><input className="form-control form-control-sm" value={form.fee} onChange={(e) => setForm({ ...form, fee: e.target.value })} /></div>
            <div className="col-md-2 d-flex gap-1">
              <button className="btn btn-outline-primary btn-sm rounded-pill" onClick={handleSuggest} disabled={suggestMutation.isPending} title="Smart price from cost">✨</button>
              <button className="btn btn-primary btn-sm rounded-pill" onClick={handleAdd} disabled={!form.code.trim() || createMutation.isPending}>Add</button>
            </div>
          </div>
          )}

          {/* Smart grid toolbar: search + category filter + summary */}
          <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
            <div className="input-group input-group-sm" style={{ maxWidth: '280px' }}>
              <span className="input-group-text bg-white"><i className="bi bi-search text-muted"></i></span>
              <input className="form-control" placeholder="Search code, description…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <select className="form-select form-select-sm rounded-pill" style={{ width: '170px' }} value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
              <option value="all">All categories</option>
              {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            {(search || catFilter !== 'all') && (
              <button className="btn btn-sm btn-outline-secondary rounded-pill" onClick={() => { setSearch(''); setCatFilter('all'); }}>
                <i className="bi bi-x-lg me-1"></i>Clear
              </button>
            )}
            <div className="ms-auto d-flex align-items-center gap-2 small">
              <span className="badge bg-light text-dark border">{sorted.length} shown</span>
              {avgMargin != null && (
                <span className={`badge rounded-pill ${marginBadge(avgMargin).cls}`} title="Average margin">
                  avg margin {avgMargin.toFixed(0)}%
                </span>
              )}
            </div>
          </div>

          {/* Bulk action bar */}
          {selected.size > 0 && (
            <div className="d-flex align-items-center gap-2 mb-2 px-3 py-2 rounded-3 border"
              style={{ backgroundColor: '#0d6efd0d', borderColor: '#0d6efd33' }}>
              <span className="small fw-semibold text-primary">
                <i className="bi bi-check2-square me-1"></i>{selected.size} selected · {formatMoney(selectionTotal, currency, exchangeRate)} total fee
              </span>
              <div className="ms-auto d-flex gap-2">
                {canEditCharges && (
                  <button className="btn btn-sm btn-outline-danger rounded-pill" disabled={bulkDeactivate.isPending}
                    onClick={() => bulkDeactivate.mutate([...selected])}>
                    <i className="bi bi-trash me-1"></i>Deactivate selected
                  </button>
                )}
                <button className="btn btn-sm btn-outline-secondary rounded-pill" onClick={() => setSelected(new Set())}>Clear</button>
              </div>
            </div>
          )}

          <div className="table-responsive border rounded-3" style={{ maxHeight: '520px', overflow: 'auto' }}>
            <table className="table table-sm table-hover align-middle mb-0 small">
              <thead className="table-light" style={{ position: 'sticky', top: 0, zIndex: 2 }}>
                <tr>
                  <th style={{ width: '36px' }} className="ps-3">
                    <input type="checkbox" className="form-check-input" checked={allVisibleSelected} onChange={toggleAll} title="Select all" />
                  </th>
                  {th('Code', 'code')}
                  {th('Type', 'code_type')}
                  {th('Description', 'description')}
                  {th('Category', 'category')}
                  {th('Cost', 'cost', 'text-end')}
                  {th('Margin', 'margin', 'text-center')}
                  {th('Fee', 'fee', 'text-end')}
                  <th className="text-end pe-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((c: any) => {
                  const e = editing[c.id];
                  const isSel = selected.has(c.id);
                  const m = marginOf(Number(c.cost) || 0, Number(c.fee) || 0);
                  const mb = marginBadge(m);
                  return (
                    <tr key={c.id}
                      className={`${c.active ? '' : 'text-muted text-decoration-line-through'} ${isSel ? 'table-primary' : ''}`}
                      style={{ cursor: 'pointer' }}
                      onClick={() => { if (!e) toggleRow(c.id); }}>
                      <td className="ps-3" onClick={(ev) => ev.stopPropagation()}>
                        <input type="checkbox" className="form-check-input" checked={isSel} onChange={() => toggleRow(c.id)} />
                      </td>
                      <td><code className="fw-semibold">{c.code}</code></td>
                      <td><span className="badge bg-light text-dark border">{c.code_type}</span></td>
                      <td className="text-truncate" style={{ maxWidth: '260px' }} title={c.description}>{c.description}</td>
                      <td><span className="badge bg-light text-dark border">{c.category}</span></td>
                      <td className="text-end" onClick={(ev) => e && ev.stopPropagation()}>
                        {e
                          ? <input className="form-control form-control-sm text-end" style={{ width: '84px', display: 'inline-block' }} value={e.cost} onChange={(ev) => setEditing({ ...editing, [c.id]: { ...e, cost: ev.target.value } })} />
                          : formatMoney(Number(c.cost), currency, exchangeRate)}
                      </td>
                      <td className="text-center">
                        <span className={`badge rounded-pill ${mb.cls}`}>{mb.label}</span>
                      </td>
                      <td className="text-end" onClick={(ev) => e && ev.stopPropagation()}>
                        {e
                          ? <input className="form-control form-control-sm text-end" style={{ width: '84px', display: 'inline-block' }} value={e.fee} onChange={(ev) => setEditing({ ...editing, [c.id]: { ...e, fee: ev.target.value } })} />
                          : <strong>{formatMoney(Number(c.fee), currency, exchangeRate)}</strong>}
                      </td>
                      <td className="text-end text-nowrap pe-3" onClick={(ev) => ev.stopPropagation()}>
                        {e ? (
                          <>
                            <button className="btn btn-sm btn-outline-success py-0 px-1" onClick={() => saveEdit(c.id)} title="Save"><i className="bi bi-check-lg"></i></button>
                            <button className="btn btn-sm btn-outline-secondary py-0 px-1 ms-1" onClick={() => { const n = { ...editing }; delete n[c.id]; setEditing(n); }} title="Cancel"><i className="bi bi-x-lg"></i></button>
                          </>
                        ) : canEditCharges ? (
                          <>
                            <button className="btn btn-sm btn-outline-primary py-0 px-1" onClick={() => setEditing({ ...editing, [c.id]: { fee: String(c.fee), cost: String(c.cost) } })} title="Edit price"><i className="bi bi-pencil"></i></button>
                            <button className="btn btn-sm btn-outline-danger py-0 px-1 ms-1" onClick={() => deleteMutation.mutate(c.id)} title="Deactivate"><i className="bi bi-trash"></i></button>
                          </>
                        ) : (
                          <span className="text-muted" title="Read-only"><i className="bi bi-lock"></i></span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {sorted.length === 0 && (
                  <tr><td colSpan={9} className="text-center text-muted py-4">
                    <i className="bi bi-inbox me-1"></i>No charges match your search
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
