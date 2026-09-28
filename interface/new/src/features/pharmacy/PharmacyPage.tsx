import { Fragment, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import nestClient from '../../api/nest-client';
import { useAuth } from '../../hooks/useAuth';
import { canViewFinancials } from '../../utils/permissions';
import { formatPatientNameLastFirst } from '../../utils/patientName';
import { formatDateTime } from '../../utils/date';
import { chartPatientId, patientChartPath } from '../../utils/patientChart';
import { NotificationFeedCard, NotificationFeedModal, FeedItem } from '../../components/notifications/NotificationFeed';

// ── Reference data ──────────────────────────────────────────────────

const COMMON_DRUGS = [
  { name: 'Amoxicillin', dose: '500mg', freq: 'TID', duration: '7 days', category: 'Antibiotic', ndc: '65862-0000-01' },
  { name: 'Lisinopril', dose: '10mg', freq: 'QD', duration: '30 days', category: 'ACE Inhibitor', ndc: '68180-0000-01' },
  { name: 'Metformin', dose: '500mg', freq: 'BID', duration: '30 days', category: 'Antidiabetic', ndc: '62037-0000-01' },
  { name: 'Omeprazole', dose: '20mg', freq: 'QD', duration: '14 days', category: 'PPI', ndc: '55111-0000-01' },
  { name: 'Atorvastatin', dose: '20mg', freq: 'QD', duration: '30 days', category: 'Statin', ndc: '60505-0000-01' },
  { name: 'Albuterol', dose: '90mcg', freq: 'Q4H PRN', duration: '30 days', category: 'Bronchodilator', ndc: '59310-0000-01' },
  { name: 'Ibuprofen', dose: '400mg', freq: 'TID PRN', duration: '10 days', category: 'NSAID', ndc: '49035-0000-01' },
  { name: 'Artemether/Lumefantrine', dose: '80/480mg', freq: 'BID', duration: '3 days', category: 'Antimalarial', ndc: '69097-0000-01' },
  { name: 'Warfarin', dose: '5mg', freq: 'QD', duration: '30 days', category: 'Anticoagulant', ndc: '00555-0000-01' },
  { name: 'Clopidogrel', dose: '75mg', freq: 'QD', duration: '30 days', category: 'Antiplatelet', ndc: '63653-0000-01' },
  { name: 'Spironolactone', dose: '25mg', freq: 'QD', duration: '30 days', category: 'Diuretic', ndc: '0378-0000-01' },
  { name: 'Aspirin', dose: '81mg', freq: 'QD', duration: '30 days', category: 'Antiplatelet', ndc: '0363-0000-01' },
];

// Known drug-drug interactions (lowercased partial-match pairs).
const INTERACTIONS: { a: string; b: string; risk: string; severity: 'high' | 'moderate' }[] = [
  { a: 'lisinopril', b: 'spironolactone', risk: 'Hyperkalemia risk', severity: 'high' },
  { a: 'lisinopril', b: 'potassium', risk: 'Hyperkalemia risk', severity: 'high' },
  { a: 'warfarin', b: 'aspirin', risk: 'Increased bleeding risk', severity: 'high' },
  { a: 'warfarin', b: 'ibuprofen', risk: 'Increased bleeding risk', severity: 'high' },
  { a: 'warfarin', b: 'amoxicillin', risk: 'Increased INR', severity: 'moderate' },
  { a: 'clopidogrel', b: 'omeprazole', risk: 'Reduced antiplatelet efficacy', severity: 'moderate' },
  { a: 'atorvastatin', b: 'clarithromycin', risk: 'Rhabdomyolysis risk', severity: 'high' },
  { a: 'metformin', b: 'contrast', risk: 'Lactic acidosis risk', severity: 'high' },
  { a: 'albuterol', b: 'propranolol', risk: 'Reduced bronchodilation', severity: 'moderate' },
  { a: 'ibuprofen', b: 'lisinopril', risk: 'Reduced antihypertensive effect', severity: 'moderate' },
];

// Simple deterministic barcode renderer (visual only).
function Barcode({ seed, width = 110 }: { seed: string; width?: number }) {
  const bars = useMemo(() => {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const out: number[] = [];
    let x = h >>> 0;
    for (let i = 0; i < 40; i++) {
      x = (Math.imul(x, 1103515245) + 12345) >>> 0;
      out.push((x >> 16) % 3 === 0 ? 1 : 2); // 1 = thin, 2 = thick
    }
    return out;
  }, [seed]);

  return (
    <svg width={width} height="34" viewBox="0 0 110 34" className="d-block">
      {bars.map((w, i) => (
        <rect key={i} x={i * 2.6} y={0} width={w === 2 ? 2.4 : 1.2} height="30" fill="#1e293b" rx="0.4" />
      ))}
    </svg>
  );
}

const categoryOf = (drug: string) =>
  COMMON_DRUGS.find((d) => d.name.toLowerCase() === drug?.toLowerCase())?.category || 'Other';

/** Deterministic NDC-style number generated from the drug name (no "N/A"). */
function generateDrugNumber(drug: string): string {
  if (!drug) return 'N/A';
  let h = 5381;
  for (let i = 0; i < drug.length; i++) h = ((h << 5) + h + drug.charCodeAt(i)) >>> 0;
  const a = String(10000 + (h % 90000));
  const b = String(100 + ((Math.imul(h, 2654435761) >>> 0) % 900));
  const c = String(10 + ((h >>> 8) % 90));
  return `${a}-${b}-${c}`;
}

const ndcOf = (drug: string) =>
  COMMON_DRUGS.find((d) => d.name.toLowerCase() === drug?.toLowerCase())?.ndc || generateDrugNumber(drug);

// ── Component ────────────────────────────────────────────────────────

export default function PharmacyPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState({ pid: '', drug: '', dosage: '', frequency: '', duration: '', quantity: '', refills: '0', pharmacy: '', notes: '' });
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');
  const [scan, setScan] = useState('');
  const [verified, setVerified] = useState<Record<string, boolean>>({});
  const [selectedDrugs, setSelectedDrugs] = useState<string[]>([]);
  const [printRx, setPrintRx] = useState<any>(null);

  const { data: prescriptions = [] } = useQuery({
    queryKey: ['all-prescriptions'],
    queryFn: async () => { const r = await nestClient.get('/prescriptions'); return r.data; },
    refetchInterval: 5000,
  });

  const { data: patients = [] } = useQuery({
    queryKey: ['pharmacy-patients'],
    queryFn: async () => { const r = await nestClient.get('/patients', { params: { limit: 50 } }); return r.data; },
  });

  const { data: inventory = [] } = useQuery({
    queryKey: ['pharmacy-inventory'],
    queryFn: async () => {
      try { const r = await nestClient.get('/inventory', { params: { limit: 200 } }); return r.data?.items || r.data || []; }
      catch { return []; }
    },
  });

  // Provider → pharmacist notifications.
  const { data: alertsData } = useQuery({
    queryKey: ['pharmacy-alerts'],
    queryFn: async () => { const r = await nestClient.get('/pharmacy/alerts'); return r.data; },
    refetchInterval: 5000,
  });
  const markRead = useMutation({
    mutationFn: () => nestClient.post('/pharmacy/alerts/read-all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pharmacy-alerts'] }),
  });

  /**
   * Provider → pharmacist orders folded into the shared notification shape so a
   * card opens into a modal with every specific of the order.
   */
  const [openFeed, setOpenFeed] = useState<FeedItem | null>(null);
  const pharmacyFeed: FeedItem[] = useMemo(
    () =>
      (alertsData?.alerts || []).map((a: any): FeedItem => ({
        id: a.id,
        title: a.drug || 'Prescription order',
        subtitle: a.patient_name && String(a.patient_name).trim()
          ? String(a.patient_name).trim()
          : `Patient #${a.pid}`,
        summary: a.message,
        at: a.created_at,
        icon: 'bi-capsule-pill',
        tone: '#0d6efd',
        status: a.is_read ? 'Read' : 'New',
        unread: !a.is_read,
        link: patientChartPath(a.patient_id, a.pid) || undefined,
        linkLabel: 'Open chart',
        metrics: [
          { label: 'Order type', value: 'Pharmacy', color: '#0d6efd' },
          { label: 'Received', value: formatDateTime(a.created_at), color: '#6f42c1' },
          { label: 'Status', value: a.is_read ? 'Read' : 'New', color: a.is_read ? '#198754' : '#dc3545' },
        ],
        fields: [
          ['Drug', a.drug],
          ['Patient', a.patient_name && String(a.patient_name).trim() ? String(a.patient_name).trim() : 'Unknown'],
          ['PID', a.pid],
          ['Received', formatDateTime(a.created_at)],
          ['Status', a.is_read ? 'Read' : 'New'],
        ],
        lists: a.message
          ? [{ title: 'Order note', lines: String(a.message).split(/\r?\n/).filter(Boolean) }]
          : undefined,
      })),
    [alertsData],
  );

  // Drug information / FDA lookup driven by the medication search.
  const firstActiveDrug = prescriptions.find((p: any) => p.active)?.drug || '';
  const drugInfoTerm = search.trim() || (selectedDrugs.length === 1 ? selectedDrugs[0] : '') || (selectedDrugs.length === 0 ? firstActiveDrug : '');
  const { data: drugInfo } = useQuery({
    queryKey: ['pharmacy-fda', drugInfoTerm],
    queryFn: async () => {
      if (!drugInfoTerm) return null;
      const r = await nestClient.get('/fda/smart/drug', { params: { drug: drugInfoTerm } });
      return r.data;
    },
    enabled: !!drugInfoTerm,
  });

  const createRx = useMutation({
    mutationFn: (d: any) => nestClient.post(`/patients/${d.pid}/prescriptions`, d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['all-prescriptions'] });
      setForm({ pid: '', drug: '', dosage: '', frequency: '', duration: '', quantity: '', refills: '0', pharmacy: '', notes: '' });
      setShowForm(false);
    },
  });

  const dispense = useMutation({
    mutationFn: (p: any) => nestClient.post('/inventory/dispense', { drug: p.drug, quantity: Number(p.quantity) || 1, patient_id: p.patient_id }),
    onSuccess: (res) => {
      alert(res.data?.dispensed
        ? `Dispensed — ${res.data.itemName} now at ${res.data.remaining}`
        : (res.data?.message || 'No matching inventory item'));
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['pharmacy-inventory'] });
    },
    onError: (e: any) => alert(e?.response?.data?.message || 'Dispense failed'),
  });

  // ── Smart algorithms ───────────────────────────────────────────────
  const activeRx = prescriptions.filter((p: any) => p.active);
  const names: string[] = activeRx.map((p: any) => p.drug?.toLowerCase() || '');

  const interactions = useMemo(() => {
    const flags: { a: string; b: string; risk: string; severity: string }[] = [];
    for (const rule of INTERACTIONS) {
      const hasA = names.some((n) => n.includes(rule.a));
      const hasB = names.some((n) => n.includes(rule.b));
      if (hasA && hasB) flags.push(rule);
    }
    return flags;
  }, [names.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedInteractions = useMemo(() => {
    if (selectedDrugs.length < 2) return [];
    const sels = selectedDrugs.map((d) => d.toLowerCase());
    return INTERACTIONS.filter((r) => sels.some((n) => n.includes(r.a)) && sels.some((n) => n.includes(r.b)));
  }, [selectedDrugs.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  const duplicateTherapies = useMemo(() => {
    const counts: Record<string, number> = {};
    activeRx.forEach((p: any) => { const c = categoryOf(p.drug); counts[c] = (counts[c] || 0) + 1; });
    return Object.entries(counts).filter(([, n]) => n > 1).map(([cat, n]) => ({ category: cat, count: n }));
  }, [activeRx]);

  const refillsDue = activeRx.filter((p: any) => Number(p.refills) > 0 && p.end_date && new Date(p.end_date) <= new Date(Date.now() + 7 * 86400000));

  const lowStock = inventory.filter((i: any) => Number(i.quantity) <= Number(i.reorder_level || 5));

  const q = search.trim().toLowerCase();
  const scanQ = scan.trim().toLowerCase();
  const filteredRx = activeRx.filter((p: any) => {
    const text = `${p.drug} ${p.patient_name || ''} ${p.dosage || ''}`.toLowerCase();
    if (q && !text.includes(q)) return false;
    if (scanQ) {
      const ndc = ndcOf(p.drug).toLowerCase();
      if (!ndc.includes(scanQ) && !p.drug?.toLowerCase().includes(scanQ)) return false;
    }
    return true;
  });

  // Group prescriptions so a patient with multiple meds shows under one name.
  const groupedRx = useMemo(() => {
    const groups: { name: string; meds: any[] }[] = [];
    const map = new Map<string, any[]>();
    for (const p of filteredRx) {
      const name = p.patient_name || `Patient #${p.patient_id}`;
      if (!map.has(name)) map.set(name, []);
      map.get(name)!.push(p);
    }
    map.forEach((meds, name) => groups.push({ name, meds }));
    return groups;
  }, [filteredRx]);

  const totalActive = activeRx.length;
  const verifiedCount = activeRx.filter((p: any) => verified[p.id]).length;
  const pendingVerification = activeRx.length - verifiedCount;

  return (
    <div className="glass-page position-relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #dbeafe 0%, #f5faff 45%, #d1fae5 100%)', borderRadius: '20px', minHeight: '100vh', padding: '16px' }}>
      <div className="position-absolute rounded-circle" style={{ width: '340px', height: '340px', top: '-80px', right: '-60px', background: 'radial-gradient(circle, rgba(13,110,253,0.30), transparent 70%)', filter: 'blur(20px)', zIndex: 0 }}></div>
      <div className="position-absolute rounded-circle" style={{ width: '400px', height: '400px', bottom: '8%', left: '-120px', background: 'radial-gradient(circle, rgba(0,201,167,0.30), transparent 70%)', filter: 'blur(20px)', zIndex: 0 }}></div>
      <style>{`
        .glass-page .card {
          position: relative; z-index: 1;
          background: rgba(255,255,255,0.60) !important;
          backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(255,255,255,0.9) !important;
          box-shadow: 0 22px 45px rgba(10,37,64,0.20), 0 6px 14px rgba(10,37,64,0.10) !important;
          transition: transform .25s ease, box-shadow .25s ease, background .25s ease;
        }
        .glass-page .card:hover { transform: translateY(-5px); background: rgba(255,255,255,0.70) !important; }
        .glass-page .card .card-header, .glass-page .card-header { background: rgba(255,255,255,0.35) !important; border-bottom: 1px solid rgba(255,255,255,0.6) !important; }
        .glass-page .table thead.table-light { background: rgba(255,255,255,0.35) !important; }
      `}</style>

      {/* Header */}
      <div className="rounded-4 p-4 mb-4 text-white position-relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #0d6efd 0%, #6f42c1 50%, #0dcaf0 100%)', zIndex: 1 }}>
        <div className="position-absolute end-0 top-0 opacity-10" style={{ fontSize: '8rem', transform: 'rotate(10deg) translate(30px,-10px)' }}><i className="bi bi-capsule"></i></div>
        <div className="position-relative d-flex justify-content-between align-items-start flex-wrap gap-3">
          <div>
            <h2 className="mb-1 fw-bold"><i className="bi bi-capsule-pill me-2"></i>Pharmacist Workstation</h2>
            <p className="mb-0 text-white text-opacity-75 small">
              {totalActive} active prescriptions · {pendingVerification} awaiting verification · {interactions.length} interaction flag{interactions.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="d-flex gap-2">
            <button className="btn btn-outline-light rounded-pill position-relative" title="New prescription orders"
              onClick={() => document.getElementById('rx-alerts')?.scrollIntoView({ behavior: 'smooth' })}>
              <i className="bi bi-bell"></i>
              {(alertsData?.unreadCount || 0) > 0 && (
                <span className="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger" style={{ fontSize: '0.6rem' }}>
                  {alertsData.unreadCount}
                </span>
              )}
            </button>
            <button className="btn btn-light rounded-pill" onClick={() => setShowForm(!showForm)}>
              <i className={`bi ${showForm ? 'bi-x-lg' : 'bi-plus-lg'} me-1`}></i>
              {showForm ? 'Cancel' : 'New Prescription'}
            </button>
          </div>
        </div>
      </div>

      {/* Search + barcode scan */}
      <div className="card mb-3">
        <div className="card-body py-2">
          <div className="row g-2 align-items-center">
            <div className="col-md-5">
              <div className="input-group">
                <span className="input-group-text bg-white border-end-0"><i className="bi bi-search text-muted"></i></span>
                <input className="form-control form-control-sm border-start-0" placeholder="Search medication, patient…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>
            <div className="col-md-5">
              <div className="input-group">
                <span className="input-group-text bg-white border-end-0"><i className="bi bi-upc-scan text-primary"></i></span>
                <input className="form-control form-control-sm border-start-0" placeholder="Scan / enter barcode or NDC…" value={scan} onChange={(e) => setScan(e.target.value)} />
                {scan && <button className="btn btn-outline-secondary btn-sm" onClick={() => setScan('')}><i className="bi bi-x-lg"></i></button>}
              </div>
            </div>
            <div className="col-md-2 text-end">
              <span className="badge bg-info rounded-pill"><i className="bi bi-upc me-1"></i>Barcode mode</span>
            </div>
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <div className="row g-3 mb-4">
        {[
          { v: totalActive, l: 'Active Rx', c: '#0d6efd', i: 'bi-capsule' },
          { v: pendingVerification, l: 'To Verify', c: '#fd7e14', i: 'bi-shield-check' },
          { v: interactions.length, l: 'Interactions', c: '#dc3545', i: 'bi-exclamation-triangle' },
          { v: refillsDue.length, l: 'Refills Due', c: '#6f42c1', i: 'bi-arrow-repeat' },
          { v: lowStock.length, l: 'Low Stock', c: '#198754', i: 'bi-boxes' },
          { v: duplicateTherapies.length, l: 'Duplicate Therapy', c: '#e83e8c', i: 'bi-layers' },
        ].map((s, i) => (
          <div className="col-md-2 col-sm-4" key={i}>
            <div className="card border-0 shadow-sm h-100" style={{ borderRadius: '16px' }}>
              <div className="card-body d-flex align-items-center gap-3 py-3">
                <div className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0" style={{ width: '44px', height: '44px', backgroundColor: `${s.c}18` }}>
                  <i className={`bi ${s.i} fs-5`} style={{ color: s.c }}></i>
                </div>
                <div><div className="fs-4 fw-bold" style={{ color: s.c }}>{s.v}</div><small className="text-muted">{s.l}</small></div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* New prescription form */}
      {showForm && (
        <div className="card mb-4">
          <div className="card-header py-2"><h6 className="mb-0 fw-bold"><i className="bi bi-prescription2 me-2 text-primary"></i>New Prescription</h6></div>
          <div className="card-body">
            <div className="row g-2">
              <div className="col-md-3"><label className="form-label small mb-0">Patient</label>
                <select className="form-select form-select-sm" value={form.pid} onChange={(e) => setForm({ ...form, pid: e.target.value })}>
                  <option value="">Select patient…</option>
                  {patients.map((p: any) => <option key={p.pid} value={p.pid}>{formatPatientNameLastFirst(p)} (#{p.public_id || p.pid})</option>)}
                </select>
              </div>
              <div className="col-md-3"><label className="form-label small mb-0">Medication</label>
                <input className="form-control form-control-sm" list="common-drugs" value={form.drug} onChange={(e) => setForm({ ...form, drug: e.target.value })} />
                <datalist id="common-drugs">{COMMON_DRUGS.map((d) => <option key={d.name} value={d.name} />)}</datalist>
              </div>
              <div className="col-md-2"><label className="form-label small mb-0">Dosage</label><input className="form-control form-control-sm" value={form.dosage} onChange={(e) => setForm({ ...form, dosage: e.target.value })} placeholder="500mg" /></div>
              <div className="col-md-2"><label className="form-label small mb-0">Frequency</label><input className="form-control form-control-sm" value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })} placeholder="TID" /></div>
              <div className="col-md-2"><label className="form-label small mb-0">Quantity</label><input className="form-control form-control-sm" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} placeholder="30" /></div>
              <div className="col-md-3"><label className="form-label small mb-0">Duration</label><input className="form-control form-control-sm" value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} placeholder="30 days" /></div>
              <div className="col-md-2"><label className="form-label small mb-0">Refills</label><input className="form-control form-control-sm" value={form.refills} onChange={(e) => setForm({ ...form, refills: e.target.value })} placeholder="0" /></div>
              <div className="col-md-4"><label className="form-label small mb-0">Pharmacy</label><input className="form-control form-control-sm" value={form.pharmacy} onChange={(e) => setForm({ ...form, pharmacy: e.target.value })} placeholder="e.g. Hospital Pharmacy" /></div>
              <div className="col-md-3"><label className="form-label small mb-0">Notes</label><input className="form-control form-control-sm" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
              <div className="col-md-2 d-flex align-items-end">
                <button className="btn btn-primary btn-sm rounded-pill w-100" onClick={() => createRx.mutate(form)} disabled={!form.pid || !form.drug || createRx.isPending}>
                  {createRx.isPending ? 'Saving…' : <><i className="bi bi-check-lg me-1"></i>Create</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="row g-3">
        {/* Medication list */}
        <div className="col-lg-8">
          <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
            <div className="card-header bg-white d-flex justify-content-between py-3" style={{ borderRadius: '16px 16px 0 0' }}>
              <h6 className="mb-0 fw-bold"><i className="bi bi-capsule me-2 text-primary"></i>Medication List</h6>
              <span className="badge bg-primary rounded-pill">{filteredRx.length} of {totalActive}</span>
            </div>
            <div className="card-body p-0">
              <div className="table-responsive">
                <table className="table table-hover align-middle mb-0 small">
                  <thead className="table-light">
                    <tr><th>Medication</th><th>Dosage</th><th>Refills</th><th>Billing</th><th>Barcode / NDC</th><th className="text-end">Actions</th></tr>
                  </thead>
                  <tbody>
                    {filteredRx.length === 0 ? (
                      <tr><td colSpan={6} className="text-center text-muted py-4">No medications found.</td></tr>
                    ) : groupedRx.map((g) => (
                      <Fragment key={g.name}>
                        <tr className="table-light">
                          <td colSpan={6} className="fw-semibold py-2">
                            <i className="bi bi-person-badge me-2"></i>{g.name}
                            <span className="badge bg-primary bg-opacity-10 text-primary ms-2">{g.meds.length} medication{g.meds.length !== 1 ? 's' : ''}</span>
                          </td>
                        </tr>
                        {g.meds.map((p: any) => {
                          const cat = categoryOf(p.drug);
                          const hasInteraction = interactions.some((r) => p.drug?.toLowerCase().includes(r.a) || p.drug?.toLowerCase().includes(r.b));
                          const isVerified = !!verified[p.id];
                          const isScanned = !!scanQ && (ndcOf(p.drug).toLowerCase().includes(scanQ) || p.drug?.toLowerCase().includes(scanQ));
                          return (
                            <tr key={p.id}
                              className={isVerified ? 'table-success' : isScanned ? 'table-warning' : selectedDrugs.includes(p.drug) ? 'table-primary' : ''}
                              style={{ cursor: 'pointer', boxShadow: isScanned ? 'inset 0 0 0 2px #fd7e14' : isVerified ? 'inset 0 0 0 2px #198754' : selectedDrugs.includes(p.drug) ? 'inset 0 0 0 2px #0d6efd' : 'none' }}
                              onClick={() => setSelectedDrugs((prev) => prev.includes(p.drug) ? prev.filter((d) => d !== p.drug) : [...prev, p.drug])}>
                              <td>
                                <div className="fw-semibold">{p.drug}</div>
                                <span className="badge bg-light text-dark border">{cat}</span>
                                {isScanned && <span className="badge bg-warning text-dark ms-1"><i className="bi bi-upc-scan me-1"></i>Scanned</span>}
                                {hasInteraction && <span className="badge bg-danger bg-opacity-10 text-danger ms-1" title="Potential interaction"><i className="bi bi-exclamation-triangle me-1"></i>Check</span>}
                                {p.billing_held && <span className="badge bg-danger ms-1" title="Billing hold — clear the bill to dispense"><i className="bi bi-lock-fill me-1"></i>Billing hold</span>}
                                {!p.billing_held && p.billed && p.billing_cleared && <span className="badge bg-success bg-opacity-10 text-success ms-1" title="Billing cleared — ready to dispense"><i className="bi bi-box-seam me-1"></i>Ready</span>}
                              </td>
                              <td>{p.dosage || '—'}</td>
                              <td>{p.refills ?? 0}</td>
                              <td>
                                {!canViewFinancials(user) ? (
                                  <span className="badge bg-light text-muted border" title="Restricted">xxxx</span>
                                ) : p.billing_held ? (
                                  <span className="badge bg-danger" title={`Billing hold — $${Number(p.hold_fee_usd || p.billed_amount_usd || 0).toFixed(2)} unpaid. Clear in Billing first.`}>
                                    <i className="bi bi-lock-fill me-1"></i>Awaiting clearance
                                  </span>
                                ) : !p.billed ? (
                                  <span className="badge bg-light text-muted border" title="Awaiting billing">Pending</span>
                                ) : p.paid ? (
                                  <span className="badge bg-success" title="Paid in full"><i className="bi bi-check-circle me-1"></i>Paid</span>
                                ) : (
                                  <span className="badge bg-warning text-dark" title={`$${Number(p.patient_balance_usd || 0).toFixed(2)} outstanding`}>
                                    ${Number(p.billed_amount_usd || 0).toFixed(2)} owed
                                  </span>
                                )}
                              </td>
                              <td>
                                <Barcode seed={p.drug} width={90} />
                                <small className="text-muted d-block" style={{ fontSize: '0.62rem' }}>{ndcOf(p.drug) || 'N/A'}</small>
                              </td>
                              <td className="text-end text-nowrap" onClick={(e) => e.stopPropagation()}>
                                <button className={`btn btn-sm rounded-pill ${isVerified ? 'btn-success' : 'btn-outline-secondary'}`} onClick={() => setVerified((v) => ({ ...v, [p.id]: !v[p.id] }))} title="Toggle verification">
                                  <i className={`bi ${isVerified ? 'bi-check-lg' : 'bi-shield-check'} me-1`}></i>{isVerified ? 'Verified' : 'Verify'}
                                </button>
                                <button className="btn btn-sm btn-primary rounded-pill ms-1" disabled={!!p.billing_held}
                                  onClick={() => dispense.mutate(p)}
                                  title={p.billing_held ? 'Billing hold — clear the bill before dispensing' : 'Dispense (decrements inventory)'}>
                                  <i className={`bi ${p.billing_held ? 'bi-lock-fill' : 'bi-box-arrow-down'} me-1`}></i>Dispense
                                </button>
                                <button className="btn btn-sm btn-outline-secondary rounded-pill ms-1" onClick={(e) => { e.stopPropagation(); setPrintRx(p); }} title="Print medication label">
                                  <i className="bi bi-printer"></i>
                                </button>
                                <button className="btn btn-sm btn-outline-secondary rounded-pill ms-1" onClick={(e) => { e.stopPropagation(); const cid = chartPatientId(p.patient_id, p.patientId, p.pid); if (cid) navigate(`/patients/${cid}`); }} title="Open patient chart">
                                  <i className="bi bi-person-badge"></i>
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Drug information & FDA lookup (based on medication search) */}
          <div className="card border-0 shadow-sm mt-3" style={{ borderRadius: '16px', borderLeft: '4px solid #6f42c1' }}>
            <div className="card-header bg-white py-2 d-flex justify-content-between align-items-center">
              <h6 className="mb-0 fw-bold"><i className="bi bi-capsule-pill me-2" style={{ color: '#6f42c1' }}></i>Drug Information & FDA Lookup</h6>
              <span className="badge" style={{ backgroundColor: '#6f42c1' }}>{drugInfo?.patientCount ?? 0} patients</span>
            </div>
            <div className="card-body">
              {selectedDrugs.length > 0 && (
                <div className="mb-2">
                  <div className="small fw-semibold text-muted mb-1">Selected medications ({selectedDrugs.length})</div>
                  <div className="d-flex flex-wrap gap-1">
                    {selectedDrugs.map((d) => <span key={d} className="badge bg-primary rounded-pill">{d}</span>)}
                  </div>
                  {selectedInteractions.length > 0 && (
                    <div className="mt-2">
                      <div className="small fw-semibold text-danger"><i className="bi bi-exclamation-triangle me-1"></i>Interactions among selected</div>
                      {selectedInteractions.map((r, i) => <div key={i} className="small text-muted">• {r.a} + {r.b}: {r.risk}</div>)}
                    </div>
                  )}
                </div>
              )}
              {drugInfo ? (
                <>
                  <div className="fw-semibold mb-1">{drugInfo.drugName}</div>
                  {drugInfo.fda?.openfda?.brand_name?.[0] && <div className="small text-muted mb-2">Brand: {drugInfo.fda.openfda.brand_name[0]}</div>}
                  {(drugInfo.interactionWarnings || []).length > 0 && (
                    <div className="mb-2">
                      <div className="small fw-semibold text-danger"><i className="bi bi-exclamation-triangle me-1"></i>Interaction Warnings</div>
                      {drugInfo.interactionWarnings.map((w: string, i: number) => <div key={i} className="small text-muted">• {w}</div>)}
                    </div>
                  )}
                  {(drugInfo.allergyWarnings || []).length > 0 && (
                    <div className="mb-2">
                      <div className="small fw-semibold text-danger"><i className="bi bi-shield-exclamation me-1"></i>Allergy Warnings</div>
                      {drugInfo.allergyWarnings.map((w: string, i: number) => <div key={i} className="small text-muted">• {w}</div>)}
                    </div>
                  )}
                  {(drugInfo.topAdverseReactions || []).length > 0 && (
                    <div>
                      <div className="small fw-semibold text-muted mb-1">Top adverse reactions</div>
                      <div className="d-flex flex-wrap gap-1">
                        {drugInfo.topAdverseReactions.map((r: any, i: number) => (
                          <span key={i} className="badge bg-light text-dark border">{r.term}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {!drugInfo.fda && drugInfo.patientCount === 0 && (drugInfo.interactionWarnings || []).length === 0 && (drugInfo.allergyWarnings || []).length === 0 && (drugInfo.topAdverseReactions || []).length === 0 && (
                    <div className="text-muted small">No FDA records found for "{drugInfoTerm}".</div>
                  )}
                </>
              ) : drugInfoTerm ? (
                <div className="text-center py-3"><div className="spinner-border spinner-border-sm"></div></div>
              ) : selectedDrugs.length > 1 ? (
                <div className="text-muted small"><i className="bi bi-arrow-left-right me-1"></i>Multiple medications selected — cross-interactions shown above.</div>
              ) : (
                <div className="text-muted small"><i className="bi bi-search me-1"></i>Select a medication from the list (or search) to load FDA drug information, interactions, and adverse reactions.</div>
              )}
            </div>
          </div>
        </div>

        {/* Smart alerts + queue + low stock */}
        <div className="col-lg-4">
          {/* Provider → pharmacist notification queue (shared card + modal viewer) */}
          <NotificationFeedCard
            title="New Prescription Orders"
            icon="bi-bell-fill"
            tone="#0d6efd"
            items={pharmacyFeed}
            emptyText="No pending orders"
            onOpen={(item) => setOpenFeed(item)}
          />

          {/* Smart alerts */}
          <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '16px', borderLeft: '4px solid #dc3545' }}>
            <div className="card-header bg-white py-2 d-flex justify-content-between align-items-center">
              <h6 className="mb-0 fw-bold"><i className="bi bi-shield-exclamation me-2 text-danger"></i>Smart Clinical Alerts</h6>
              <span className="badge bg-danger rounded-pill">{interactions.length + duplicateTherapies.length}</span>
            </div>
            <div className="card-body">
              {interactions.length === 0 && duplicateTherapies.length === 0 ? (
                <div className="text-muted small"><i className="bi bi-check-circle me-1 text-success"></i>No interaction or duplicate-therapy flags detected.</div>
              ) : (
                <>
                  {interactions.map((r, i) => (
                    <div key={i} className="d-flex gap-2 border-bottom py-2 small">
                      <i className={`bi bi-exclamation-triangle ${r.severity === 'high' ? 'text-danger' : 'text-warning'}`}></i>
                      <div><strong>{r.a} + {r.b}</strong><div className="text-muted">{r.risk}</div></div>
                    </div>
                  ))}
                  {duplicateTherapies.map((d) => (
                    <div key={d.category} className="d-flex gap-2 border-bottom py-2 small">
                      <i className="bi bi-layers text-warning"></i>
                      <div><strong>Duplicate therapy</strong><div className="text-muted">{d.category} × {d.count}</div></div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>

          {/* Verification queue */}
          <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '16px' }}>
            <div className="card-header bg-white py-2 d-flex justify-content-between align-items-center">
              <h6 className="mb-0 fw-bold"><i className="bi bi-shield-check me-2 text-warning"></i>Verification Queue</h6>
              <span className="badge bg-warning text-dark rounded-pill">{pendingVerification}</span>
            </div>
            <div className="card-body p-0">
              {activeRx.filter((p: any) => !verified[p.id]).slice(0, 6).map((p: any) => (
                <div key={p.id} className="d-flex justify-content-between align-items-center px-3 py-2 border-bottom small">
                  <span className="fw-semibold">{p.drug}</span>
                  <button className="btn btn-sm btn-outline-success py-0 px-2" onClick={() => setVerified((v) => ({ ...v, [p.id]: true }))}><i className="bi bi-check-lg"></i></button>
                </div>
              ))}
              {pendingVerification === 0 && <div className="text-muted small text-center py-3">All medications verified ✓</div>}
            </div>
          </div>

          {/* Low stock */}
          <div className="card border-0 shadow-sm" style={{ borderRadius: '16px', borderLeft: '4px solid #198754' }}>
            <div className="card-header bg-white py-2 d-flex justify-content-between align-items-center">
              <h6 className="mb-0 fw-bold"><i className="bi bi-boxes me-2 text-success"></i>Low Stock Alerts</h6>
              <span className="badge bg-success rounded-pill">{lowStock.length}</span>
            </div>
            <div className="card-body p-0">
              {lowStock.length === 0 ? (
                <div className="text-muted small text-center py-3">All inventory well stocked.</div>
              ) : lowStock.slice(0, 6).map((i: any) => (
                <div key={i.id} className="d-flex justify-content-between align-items-center px-3 py-2 border-bottom small">
                  <span className="fw-semibold text-truncate">{i.name}</span>
                  <span className={`badge ${Number(i.quantity) === 0 ? 'bg-danger' : 'bg-warning text-dark'}`}>{i.quantity} left</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {printRx && (
        <MedicationLabelModal p={printRx} onClose={() => setPrintRx(null)} />
      )}

      {/* Pharmacy order detail modal — every specific of the order */}
      <NotificationFeedModal
        item={openFeed}
        onClose={() => setOpenFeed(null)}
        onAck={() => { markRead.mutate(); setOpenFeed(null); }}
        ackPending={markRead.isPending}
        ackLabel="Mark all read"
        onNavigate={(link) => navigate(link)}
      />
    </div>
  );
}

// ── Standard pharmacy medication label (printable) ────────────────────────

function MedicationLabelModal({ p, onClose }: { p: any; onClose: () => void }) {
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  return (
    <div className="modal d-block" style={{ background: 'rgba(0,0,0,0.45)' }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-dialog modal-sm modal-dialog-centered">
        <div className="modal-content" style={{ borderRadius: '16px' }}>
          <div className="modal-header">
            <h6 className="modal-title mb-0">Medication Label</h6>
            <button className="btn-close" onClick={onClose}></button>
          </div>
          <div className="modal-body">
            <style>{`
              @media print {
                body * { visibility: hidden !important; }
                #med-label-print, #med-label-print * { visibility: visible !important; }
                #med-label-print { position: absolute; left: 0; top: 0; width: 100%; }
              }
            `}</style>
            <div id="med-label-print" className="border border-2 rounded-3 p-3 bg-white" style={{ fontFamily: 'Arial, sans-serif' }}>
              <div className="text-center border-bottom pb-2 mb-2">
                <div className="fw-bold" style={{ fontSize: '0.9rem' }}>Ma Juan Memorial Hospital Clinic</div>
                <div className="text-muted" style={{ fontSize: '0.65rem' }}>Pharmacy · Tel: +231 888 955552</div>
              </div>
              <div className="mb-1" style={{ fontSize: '0.8rem' }}><span className="text-muted">Patient:</span> <b>{p.patient_name || `#${p.patient_id}`}</b></div>
              <div className="mb-1" style={{ fontSize: '0.8rem' }}><span className="text-muted">Medication:</span> <b>{p.drug}</b></div>
              <div className="mb-1" style={{ fontSize: '0.8rem' }}>
                <span className="text-muted">Directions:</span> <b>{p.dosage || 'As directed'}</b>
                {p.note ? <div className="text-muted" style={{ fontSize: '0.65rem' }}>{p.note}</div> : null}
              </div>
              <div className="d-flex justify-content-between mb-2" style={{ fontSize: '0.8rem' }}>
                <span><span className="text-muted">Qty:</span> <b>{p.quantity || '—'}</b></span>
                <span><span className="text-muted">Refills:</span> <b>{p.refills ?? 0}</b></span>
                <span><span className="text-muted">Date:</span> <b>{today}</b></span>
              </div>
              <div className="text-center border-top pt-2">
                <Barcode seed={p.drug} width={180} />
                <div className="text-muted" style={{ fontFamily: 'monospace', fontSize: '0.65rem' }}>{ndcOf(p.drug)} · Rx #{p.id}</div>
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
