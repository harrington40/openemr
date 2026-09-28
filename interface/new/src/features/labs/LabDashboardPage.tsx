import { useState, useMemo, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import nestClient from '../../api/nest-client';
import { useDebounce } from '../../hooks/useDebounce';
import { useAuth } from '../../hooks/useAuth';
import { groupOrdersByPatient } from '../../utils/groupOrdersByPatient';
import { formatPatientName } from '../../utils/patientName';
import { chartPatientId } from '../../utils/patientChart';
import Barcode from '../../components/shared/Barcode';
import LabResultEntry from './LabResultEntry';

const TEST_PANELS: { name: string; icon: string; tests: string[] }[] = [
  { name: 'Complete Blood Count (CBC)', icon: 'bi-droplet', tests: ['WBC', 'RBC', 'Hemoglobin', 'Hematocrit', 'MCV', 'MCH', 'MCHC', 'Platelets', 'Neutrophils', 'Lymphocytes', 'Monocytes', 'Eosinophils', 'Basophils'] },
  { name: 'Basic Metabolic Panel (BMP)', icon: 'bi-heart-pulse', tests: ['Glucose', 'Calcium', 'Sodium', 'Potassium', 'Chloride', 'CO2', 'BUN', 'Creatinine'] },
  { name: 'Comprehensive Metabolic Panel (CMP)', icon: 'bi-clipboard-pulse', tests: ['Glucose', 'Calcium', 'Sodium', 'Potassium', 'Chloride', 'CO2', 'BUN', 'Creatinine', 'Total Protein', 'Albumin', 'ALP', 'ALT', 'AST', 'Bilirubin'] },
  { name: 'Lipid Panel', icon: 'bi-heart', tests: ['Total Cholesterol', 'HDL', 'LDL', 'Triglycerides', 'VLDL', 'Chol/HDL Ratio'] },
  { name: 'Liver Function Test', icon: 'bi-shield', tests: ['ALT', 'AST', 'ALP', 'GGT', 'Total Bilirubin', 'Direct Bilirubin', 'Albumin', 'Total Protein'] },
  { name: 'Thyroid Panel', icon: 'bi-capsule', tests: ['TSH', 'Free T3', 'Free T4', 'T3 Total', 'T4 Total', 'Thyroglobulin'] },
  { name: 'Urinalysis', icon: 'bi-flask', tests: ['Color', 'Clarity', 'pH', 'Specific Gravity', 'Glucose', 'Protein', 'Ketones', 'Bilirubin', 'Blood', 'Nitrites', 'Leukocytes'] },
  { name: 'Coagulation Profile', icon: 'bi-water', tests: ['PT', 'PTT', 'INR', 'Fibrinogen', 'D-Dimer'] },
  { name: 'Malaria / Parasites', icon: 'bi-bug', tests: ['Malaria Smear', 'RDT', 'Parasite Count', 'Species ID'] },
  { name: 'STI Panel', icon: 'bi-gender-ambiguous', tests: ['HIV', 'Syphilis', 'Hepatitis B', 'Hepatitis C', 'HSV-1', 'HSV-2', 'Chlamydia', 'Gonorrhea'] },
];


/** Icons for the database-driven catalog categories (MJ-MC form sections). */
const CATEGORY_ICONS: Record<string, string> = {
  'HAEMATOLOGY/ IMMUNO-HAEMATOLOGY': 'bi-droplet',
  'IMMUNOLOGY & SEROLOGY': 'bi-shield-check',
  'BIOCHEMISTRY — GLUCOSE METABOLISM/DIABETES': 'bi-droplet-half',
  'BIOCHEMISTRY — LIPID METABOLISM PANEL': 'bi-heart',
  'BIOCHEMISTRY — HEART DISEASE PANEL': 'bi-heart-pulse',
  'BIOCHEMISTRY — LIVER FUNCTION TESTS': 'bi-shield',
  'BIOCHEMISTRY — KIDNEY FUNCTION TEST': 'bi-funnel',
  'BIOCHEMISTRY — ELECTROLYTES PANEL': 'bi-lightning-charge',
  'BIOCHEMISTRY — PANCREATIC FUNCTION PANEL': 'bi-activity',
  'BIOCHEMISTRY — THYROID FUNCTION TESTS': 'bi-capsule',
  'BIOCHEMISTRY — TUMAR MARKERS': 'bi-bullseye',
  'NUTRITIONAL PANEL': 'bi-egg-fried',
  'COAGULATION ACTIVITIES': 'bi-water',
  'INFERTILITY FEMALE': 'bi-gender-female',
  'INFERTILITY MALE': 'bi-gender-male',
  'EARLY PREGNANCY CHECK UP': 'bi-heart-fill',
  'COLORECTAL OCCUTE BLOOD TEST': 'bi-search-heart',
  'URINALYSIS — MACROSCOPIC EXAMINATION': 'bi-eye',
  'URINALYSIS — CHEMISTRY EXAMINATION': 'bi-flask',
  'URINALYSIS — MICROSCOPIC EXAMINATION': 'bi-search',
  'PARASITOLOGY STOOL (WET MOUNT) — MACROSCOPIC EXAMINATION': 'bi-eyedropper',
  'PARASITOLOGY STOOL (WET MOUNT) — MICROSCOPIC EXAMINATION': 'bi-bug',
};

const OUTSIDE_LABS = ['National Reference Lab', 'LACOM Labs', 'RiaLab Clinical', 'BioLab Diagnostics', 'MedPath West Africa', 'CDC Reference Lab'];

const STATUS_COLORS: Record<string, string> = { pending: '#fd7e14', collected: '#0dcaf0', processing: '#6f42c1', completed: '#198754', validated: '#0d6efd', rejected: '#dc3545', referred: '#ffc107' };

const testsForOrder = (o: any): string[] => {
  if (Array.isArray(o?.tests)) return o.tests;
  if (typeof o?.tests === 'string') {
    try { const a = JSON.parse(o.tests); if (Array.isArray(a)) return a; } catch { /* ignore */ }
  }
  return TEST_PANELS.find((p) => p.name === o.instructions)?.tests || [];
};

export default function LabDashboardPage() {
  const { user } = useAuth();
  const isLabStaff = user?.role === 'lab_tech' || user?.role === 'admin';
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'dashboard' | 'orders' | 'results' | 'referrals'>('dashboard');
  const [searchPid, setSearchPid] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [showResultForm, setShowResultForm] = useState(false);
  const [showReferForm, setShowReferForm] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [selectedPanel, setSelectedPanel] = useState('');
  const [orderForm, setOrderForm] = useState({ pid: '', instructions: '', clinical_hx: '', priority: 'routine' });
  const [referForm, setReferForm] = useState({ lab: '', notes: '' });
  const [sampleLabel, setSampleLabel] = useState('');
  const [duplicateNotice, setDuplicateNotice] = useState('');
  const [patientSearch, setPatientSearch] = useState('');
  const [selectedPatient, setSelectedPatient] = useState<any>(null);
  const [showPatientDropdown, setShowPatientDropdown] = useState(false);
  const debouncedPatientSearch = useDebounce(patientSearch, 300);
  // Patient whose lab group is open in the preview/validate dialog.
  const [previewPid, setPreviewPid] = useState<string | null>(null);
  const [groupToast, setGroupToast] = useState('');

  const { data: orders = [] } = useQuery({
    queryKey: ['all-lab-orders'],
    queryFn: async () => { const r = await nestClient.get('/lab/orders'); return r.data; },
  });

  // Whole-group preview for the selected patient (every open order + its results).
  const { data: groupPreview, isLoading: groupLoading } = useQuery({
    queryKey: ['lab-group-preview', previewPid],
    queryFn: async () => {
      const r = await nestClient.get(`/lab/patients/${previewPid}/validation-preview`);
      return r.data;
    },
    enabled: !!previewPid,
  });

  // One-shot validation of the patient's whole lab group + a single notification.
  const validateGroup = useMutation({
    mutationFn: (pid: string) => nestClient.post(`/lab/patients/${pid}/validate-all`, {}),
    onSuccess: (res: any) => {
      const d = res.data || {};
      qc.invalidateQueries({ queryKey: ['all-lab-orders'] });
      qc.invalidateQueries({ queryKey: ['provider-lab-orders'] });
      qc.invalidateQueries({ queryKey: ['provider-lab-notifications'] });
      qc.invalidateQueries({ queryKey: ['lab-group-preview'] });
      setGroupToast(
        d.validated
          ? `Validated ${d.validated} order(s) · ${d.resultCount} result(s). ` +
            (d.notified
              ? `Notification sent to provider #${d.provider}.`
              : 'No provider on file to notify.')
          : d.reason || 'Nothing to validate.',
      );
      setPreviewPid(null);
    },
    onError: (e: any) => setGroupToast(e?.response?.data?.message || 'Group validation failed'),
  });

  // Database-driven catalog — the same fields used by the Patient Lab Result Form.
  const { data: catalog = [] } = useQuery({
    queryKey: ['lab-catalog'],
    queryFn: async () => { const r = await nestClient.get('/lab/catalog'); return r.data || []; },
  });

  const { data: patientHits = [] } = useQuery({
    queryKey: ['lab-order-patients', debouncedPatientSearch],
    queryFn: async () => {
      if (!debouncedPatientSearch.trim()) return [];
      const r = await nestClient.get('/patients', { params: { search: debouncedPatientSearch, limit: 8 } });
      return r.data || [];
    },
    enabled: debouncedPatientSearch.trim().length >= 1,
  });

  const createOrder = useMutation({
    mutationFn: (d: any) => nestClient.post(`/patients/${d.pid}/procedures`, { patient_instructions: d.instructions, clinical_hx: d.clinical_hx, order_priority: d.priority, tests: d.tests, panel: d.panel, sample_label: d.label }),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['all-lab-orders'] });
      qc.invalidateQueries({ queryKey: ['provider-lab-orders'] });
      setOrderForm({ pid: '', instructions: '', clinical_hx: '', priority: 'routine' });
      setSelectedPanel('');
      setSampleLabel('');
      if (data?.duplicate) {
        setDuplicateNotice('Duplicate lab order blocked — this test was already ordered for the patient within the last hour.');
        setShowOrderForm(true);
      } else {
        setDuplicateNotice('');
        setShowOrderForm(false);
      }
    },
  });

  const validateOrder = useMutation({
    mutationFn: (d: any) => nestClient.post(`/lab/orders/${d.orderId}/validate`, { action: d.action }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['all-lab-orders'] }); qc.invalidateQueries({ queryKey: ['provider-lab-orders'] }); },
  });

  const referOrder = useMutation({
    mutationFn: (d: any) => nestClient.post(`/lab/orders/${d.orderId}/refer`, { outside_lab: d.lab, notes: d.notes }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['all-lab-orders'] }); qc.invalidateQueries({ queryKey: ['provider-lab-orders'] }); setShowReferForm(false); setReferForm({ lab: '', notes: '' }); },
  });

  const updateStatus = useMutation({
    mutationFn: (d: any) => nestClient.patch(`/lab/orders/${d.orderId}/status`, { status: d.status, sample_label: d.label }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['all-lab-orders'] }); qc.invalidateQueries({ queryKey: ['provider-lab-orders'] }); },
    onError: (e: any) => {
      const msg = e?.response?.data?.message || e?.message || 'Unable to update order status';
      alert(Array.isArray(msg) ? msg.join('\n') : msg);
    },
  });

  const filtered = orders
    .filter((o: any) => filterStatus === 'all' || o.orderStatus === filterStatus)
    .filter((o: any) => !searchPid || String(o.patientPid || o.patientId).includes(searchPid));

  const pending = orders.filter((o: any) => o.orderStatus === 'pending').length;
  const processing = orders.filter((o: any) => o.orderStatus === 'processing' || o.orderStatus === 'collected').length;
  const completed = orders.filter((o: any) => o.orderStatus === 'completed' || o.orderStatus === 'validated').length;
  const referred = orders.filter((o: any) => o.orderStatus === 'referred').length;

  const groupedOrders = useMemo(() => groupOrdersByPatient(filtered), [filtered]);

  /** Orders in a group that already have results and can be validated in one shot. */
  const readyToValidate = (g: any) =>
    (g?.orders || []).filter((o: any) => o.hasResults && o.orderStatus === 'completed');

  const generateLabel = () => {
    const label = `LAB-${Date.now().toString(36).toUpperCase().slice(-6)}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
    setSampleLabel(label);
    return label;
  };

  const handleOrderSubmit = () => {
    if (!selectedPatient?.pid) return;
    const panelTests = (groupedCatalog[selectedPanel] || []).map((t: any) => t.name);
    const label = generateLabel();
    createOrder.mutate({
      pid: selectedPatient.pid,
      instructions: selectedPanel || orderForm.instructions,
      clinical_hx: orderForm.clinical_hx,
      priority: orderForm.priority,
      tests: panelTests,
      panel: selectedPanel || 'Custom',
      label,
    });
  };

  const handleCollectSample = (order: any) => {
    const label = generateLabel();
    updateStatus.mutate({ orderId: order.id, status: 'collected', label });
  };

  const groupedCatalog = useMemo(() => {
    const m: Record<string, any[]> = {};
    for (const t of (catalog as any[])) (m[t.category] ||= []).push(t);
    return m;
  }, [catalog]);

  const tabs = [
    { id: 'dashboard' as const, label: 'Dashboard', icon: 'bi-speedometer2' },
    { id: 'orders' as const, label: 'Order Lab Tests', icon: 'bi-flask' },
    { id: 'results' as const, label: 'Results & Validate', icon: 'bi-clipboard-check' },
    { id: 'referrals' as const, label: 'Referrals', icon: 'bi-send' },
  ];

  return (
    <div className="glass-page position-relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #dbeafe 0%, #f5faff 45%, #d1fae5 100%)', borderRadius: '20px', minHeight: '100vh', padding: '16px' }}>
      <div className="position-absolute rounded-circle" style={{ width: '340px', height: '340px', top: '-80px', right: '-60px', background: 'radial-gradient(circle, rgba(13,110,253,0.30), transparent 70%)', filter: 'blur(20px)', zIndex: 0 }}></div>
      <div className="position-absolute rounded-circle" style={{ width: '400px', height: '400px', bottom: '8%', left: '-120px', background: 'radial-gradient(circle, rgba(0,201,167,0.30), transparent 70%)', filter: 'blur(20px)', zIndex: 0 }}></div>
      <style>{`
        .glass-page .card {
          position: relative;
          z-index: 1;
          background: rgba(255,255,255,0.60) !important;
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(255,255,255,0.9) !important;
          box-shadow: 0 22px 45px rgba(10,37,64,0.20), 0 6px 14px rgba(10,37,64,0.10) !important;
          transition: transform .25s ease, box-shadow .25s ease, background .25s ease;
        }
        .glass-page .card:hover {
          transform: translateY(-5px);
          background: rgba(255,255,255,0.70) !important;
          box-shadow: 0 30px 60px rgba(10,37,64,0.28), 0 10px 20px rgba(10,37,64,0.14) !important;
        }
        .glass-page .card .card-header,
        .glass-page .card-header {
          background: rgba(255,255,255,0.35) !important;
          border-bottom: 1px solid rgba(255,255,255,0.6) !important;
        }
        .glass-page .table thead.table-light {
          background: rgba(255,255,255,0.35) !important;
        }
      `}</style>
      {/* Header */}
      <div className="rounded-4 p-4 mb-4 text-white position-relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #fd7e14 0%, #dc3545 40%, #6f42c1 100%)' }}>
        <div className="position-absolute end-0 top-0 opacity-10" style={{ fontSize: '7rem', transform: 'rotate(10deg) translate(20px,-10px)' }}><i className="bi bi-flask"></i></div>
        <div className="position-relative">
          <div className="d-flex justify-content-between align-items-start flex-wrap gap-3">
            <div>
              <h2 className="mb-1 fw-bold"><i className="bi bi-flask me-2"></i>Laboratory Management</h2>
              <p className="mb-0 text-white text-opacity-75 small">Order tests · Collect samples · Enter results · Validate & refer</p>
            </div>
            <div className="d-flex gap-2">
              {[
                { v: orders.length, l: 'Total', c: '#fff' },
                { v: pending, l: 'Pending', c: '#fd7e14' },
                { v: processing, l: 'Processing', c: '#0dcaf0' },
                { v: completed, l: 'Completed', c: '#198754' },
                { v: referred, l: 'Referred', c: '#ffc107' },
              ].map(s => (
                <div key={s.l} className="text-center bg-white bg-opacity-15 rounded-3 px-3 py-2" style={{ minWidth: '60px' }}>
                  <div className="fw-bold fs-5 lh-1">{s.v}</div>
                  <small className="text-white text-opacity-75" style={{ fontSize: '0.6rem' }}>{s.l}</small>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="d-flex gap-2 mb-3">
        {tabs.map(t => (
          <button key={t.id} className={`btn rounded-pill ${activeTab === t.id ? 'btn-primary' : 'btn-outline-primary'}`}
            onClick={() => setActiveTab(t.id)}>
            <i className={`bi ${t.icon} me-1`}></i>{t.label}
          </button>
        ))}
        <div className="ms-auto d-flex gap-2">
          <input className="form-control form-control-sm rounded-pill" style={{ width: '200px' }} placeholder="Search by Patient ID..."
            value={searchPid} onChange={e => setSearchPid(e.target.value)} />
          <select className="form-select form-select-sm rounded-pill" style={{ width: '150px' }}
            value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="all">All Status</option>
            {Object.keys(STATUS_COLORS).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* Group validation toast */}
      {groupToast && (
        <div className="alert alert-info alert-dismissible py-2 small mb-3" role="alert">
          <i className="bi bi-info-circle me-1"></i>{groupToast}
          <button type="button" className="btn-close btn-sm" onClick={() => setGroupToast('')}></button>
        </div>
      )}

      {/* Group Preview & One-Shot Validation */}
      {previewPid && (
        <GroupValidateModal
          pid={previewPid}
          preview={groupPreview}
          loading={groupLoading}
          pending={validateGroup.isPending}
          onClose={() => setPreviewPid(null)}
          onValidate={() => validateGroup.mutate(previewPid)}
        />
      )}

      {/* Order Form Modal */}
      {showOrderForm && (
        <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '20px', border: '2px solid #fd7e14' }}>
          <div className="card-header text-white py-3 d-flex justify-content-between" style={{ background: 'linear-gradient(135deg, #fd7e14, #dc3545)', borderRadius: '18px 18px 0 0' }}>
            <h6 className="mb-0 fw-bold"><i className="bi bi-plus-circle me-2"></i>New Lab Order</h6>
            <button className="btn btn-sm btn-outline-light rounded-circle" style={{ width: '32px', height: '32px' }} onClick={() => setShowOrderForm(false)}><i className="bi bi-x-lg"></i></button>
          </div>
          <div className="card-body">
            <div className="row g-2 mb-3">
              <div className="col-md-12">
                <label className="form-label small fw-semibold">Patient *</label>
                {selectedPatient ? (
                  <div className="d-flex align-items-center gap-2 p-2 rounded-3" style={{ background: '#f0fdfa', border: '1px solid #c6f6e5' }}>
                    <span className="fw-semibold small">{formatPatientName(selectedPatient)} (PID {selectedPatient.pid})</span>
                    <button className="btn btn-sm btn-outline-secondary rounded-pill ms-auto" onClick={() => { setSelectedPatient(null); setPatientSearch(''); }}>Change</button>
                  </div>
                ) : (
                  <div className="position-relative">
                    <div className="input-group input-group-sm">
                      <span className="input-group-text"><i className="bi bi-search"></i></span>
                      <input className="form-control" placeholder="Search patient by name or ID…" value={patientSearch}
                        onChange={(e) => { setPatientSearch(e.target.value); setShowPatientDropdown(true); }}
                        onFocus={() => setShowPatientDropdown(true)} />
                    </div>
                    {showPatientDropdown && debouncedPatientSearch.trim().length >= 1 && (
                      <div className="list-group position-absolute w-100 shadow" style={{ zIndex: 20, borderRadius: '12px', overflow: 'hidden' }}>
                        {patientHits.map((p: any) => (
                          <button key={p.pid} type="button" className="list-group-item list-group-item-action d-flex justify-content-between align-items-center"
                            onClick={() => { setSelectedPatient(p); setPatientSearch(''); setShowPatientDropdown(false); }}>
                            <span><strong>{formatPatientName(p)}</strong> <span className="text-muted">(PID {p.pid})</span></span>
                            <small className="text-muted">{p.DOB?.split('T')[0]}</small>
                          </button>
                        ))}
                        {!patientHits.length && <div className="list-group-item text-muted small">No patients found</div>}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="col-md-3"><label className="form-label small fw-semibold">Priority</label><select className="form-select form-select-sm rounded-pill" value={orderForm.priority} onChange={e => setOrderForm({ ...orderForm, priority: e.target.value })}><option value="routine">Routine</option><option value="stat">STAT</option><option value="urgent">Urgent</option></select></div>
              <div className="col-md-6"><label className="form-label small fw-semibold">Instructions</label><input className="form-control form-control-sm rounded-pill" value={orderForm.instructions} onChange={e => setOrderForm({ ...orderForm, instructions: e.target.value })} placeholder="e.g. Fasting 12 hours, collect in EDTA tube..." /></div>
              <div className="col-md-12"><label className="form-label small fw-semibold">Clinical History</label><input className="form-control form-control-sm rounded-pill" value={orderForm.clinical_hx} onChange={e => setOrderForm({ ...orderForm, clinical_hx: e.target.value })} placeholder="Relevant clinical context..." /></div>
            </div>
            <h6 className="small fw-bold text-uppercase text-muted mb-2">Select Test Panel</h6>
            <div className="d-flex flex-wrap gap-1 mb-3">
              {Object.keys(groupedCatalog).map(cat => (
                <button key={cat} className={`btn btn-sm rounded-pill ${selectedPanel === cat ? 'btn-warning' : 'btn-outline-warning'}`}
                  onClick={() => setSelectedPanel(selectedPanel === cat ? '' : cat)}>
                  <i className={`bi ${CATEGORY_ICONS[cat] || 'bi-flask'} me-1`}></i>{cat}
                </button>
              ))}
              {Object.keys(groupedCatalog).length === 0 && <span className="text-muted small">Loading catalog…</span>}
            </div>
            {selectedPanel && (
              <div className="alert alert-warning py-2 mb-2 small rounded-3">
                <strong>{selectedPanel}</strong>: {(groupedCatalog[selectedPanel] || []).map((t: any) => t.name).join(', ')}
              </div>
            )}
            {sampleLabel && <div className="alert alert-info py-2 small rounded-3"><i className="bi bi-tag me-1"></i>Sample Label: <code>{sampleLabel}</code></div>}
            {duplicateNotice && (
              <div className="alert alert-warning py-1 px-2 small rounded-3">
                <i className="bi bi-exclamation-triangle me-1"></i>{duplicateNotice}
              </div>
            )}
            <button className="btn btn-warning rounded-pill" onClick={handleOrderSubmit} disabled={!selectedPatient?.pid || createOrder.isPending}>
              {createOrder.isPending ? <><span className="spinner-border spinner-border-sm me-1"></span>Ordering...</> : <><i className="bi bi-flask me-1"></i>Order Lab Tests</>}
            </button>
          </div>
        </div>
      )}

      {/* Lab Result Form (embedded) - replaces the old result entry modal */}
      {showResultForm && selectedOrder && (
        <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '20px', border: '2px solid #198754' }}>
          <div className="card-header text-white py-3 d-flex justify-content-between" style={{ background: 'linear-gradient(135deg, #198754, #0d6efd)', borderRadius: '18px 18px 0 0' }}>
            <h6 className="mb-0 fw-bold"><i className="bi bi-clipboard2-pulse me-2"></i>Lab Result Form — Order #{selectedOrder.id}</h6>
            <button className="btn btn-sm btn-outline-light rounded-circle" style={{ width: '32px', height: '32px' }} onClick={() => { setShowResultForm(false); setSelectedOrder(null); }}><i className="bi bi-x-lg"></i></button>
          </div>
          <div className="card-body">
            <LabResultEntry
              key={`order-${selectedOrder.id}`}
              orderId={selectedOrder.id}
              patientPid={String(selectedOrder.patientPid ?? selectedOrder.patientId ?? '')}
              panelLabel={selectedOrder.instructions || 'Custom'}
            />
          </div>
        </div>
      )}

      {/* Lab Analytics Dashboard */}
      <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '20px' }}>
        <div className="card-header text-white py-3" style={{ background: 'linear-gradient(135deg, #6f42c1, #0d6efd)', borderRadius: '18px 18px 0 0' }}>
          <h6 className="mb-0 fw-bold"><i className="bi bi-graph-up me-2"></i>Lab Analytics</h6>
        </div>
        <div className="card-body">
          <div className="row g-3">
            {/* Turnaround Summary */}
            <div className="col-12">
              <small className="fw-bold text-muted text-uppercase">Status Overview</small>
              <div className="row g-1 mt-1">
                {[
                  { l: 'Pending', c: '#fd7e14', v: orders.filter((o:any) => o.orderStatus === 'pending').length },
                  { l: 'Collected', c: '#0dcaf0', v: orders.filter((o:any) => o.orderStatus === 'collected').length },
                  { l: 'Processing', c: '#6f42c1', v: orders.filter((o:any) => o.orderStatus === 'processing').length },
                  { l: 'Completed', c: '#198754', v: orders.filter((o:any) => o.orderStatus === 'completed').length },
                  { l: 'Validated', c: '#0d6efd', v: 0 },
                ].map(s => {
                  const pct = orders.length > 0 ? Math.round((s.v / orders.length) * 100) : 0;
                  return (
                    <div key={s.l} className="col" style={{ fontSize: '0.7rem' }}>
                      <div className="d-flex justify-content-between mb-1">
                        <span>{s.l}</span><span className="fw-bold" style={{color:s.c}}>{s.v}</span>
                      </div>
                      <div className="progress" style={{height:'4px'}}>
                        <div className="progress-bar" style={{width:`${pct}%`, backgroundColor:s.c}}></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            {/* Quick Stats */}
            <div className="col-12">
              <div className="row g-2">
                {[
                  { v: orders.length, l: 'Total Orders', c: '#0d6efd', i: 'bi-clipboard-check' },
                  { v: orders.filter((o:any) => o.orderPriority === 'stat').length, l: 'STAT', c: '#dc3545', i: 'bi-exclamation-triangle' },
                  { v: orders.filter((o:any) => o.orderStatus === 'referred').length, l: 'Referred Out', c: '#ffc107', i: 'bi-send' },
                  { v: 0, l: 'External Results', c: '#20c997', i: 'bi-cloud-download' },
                ].map(s => (
                  <div className="col-3" key={s.l}>
                    <div className="p-2 rounded-3 text-center" style={{backgroundColor:`${s.c}10`}}>
                      <i className={`bi ${s.i} d-block mb-1`} style={{color:s.c,fontSize:'1.2rem'}}></i>
                      <div className="fw-bold" style={{color:s.c}}>{s.v}</div>
                      <small className="text-muted" style={{fontSize:'0.6rem'}}>{s.l}</small>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Refer Modal */}
      {showReferForm && selectedOrder && (
        <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '20px', border: '2px solid #ffc107' }}>
          <div className="card-header text-dark py-3 d-flex justify-content-between" style={{ background: 'linear-gradient(135deg, #ffc107, #fd7e14)', borderRadius: '18px 18px 0 0' }}>
            <h6 className="mb-0 fw-bold"><i className="bi bi-send me-2"></i>Refer Order #{selectedOrder.id} to Outside Lab</h6>
            <button className="btn btn-sm btn-outline-dark rounded-circle" style={{ width: '32px', height: '32px' }} onClick={() => setShowReferForm(false)}><i className="bi bi-x-lg"></i></button>
          </div>
          <div className="card-body">
            <div className="row g-2">
              <div className="col-md-6">
                <label className="form-label small fw-semibold">Outside Lab</label>
                <select className="form-select form-select-sm rounded-pill" value={referForm.lab} onChange={e => setReferForm({ ...referForm, lab: e.target.value })}>
                  <option value="">— Select Lab —</option>
                  {OUTSIDE_LABS.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <div className="col-md-6">
                <label className="form-label small fw-semibold">Notes</label>
                <input className="form-control form-control-sm rounded-pill" value={referForm.notes} onChange={e => setReferForm({ ...referForm, notes: e.target.value })} placeholder="Referral notes..." />
              </div>
            </div>
            <button className="btn btn-warning rounded-pill mt-2" onClick={() => referOrder.mutate({ orderId: selectedOrder.id, lab: referForm.lab, notes: referForm.notes })} disabled={!referForm.lab || referOrder.isPending}>
              <i className="bi bi-send me-1"></i>Refer to Outside Lab
            </button>
          </div>
        </div>
      )}

      {/* Orders Table */}
      <div className="card border-0 shadow-sm" style={{ borderRadius: '20px' }}>
        <div className="card-header bg-white d-flex justify-content-between py-3" style={{ borderRadius: '20px 20px 0 0' }}>
          <h6 className="mb-0 fw-bold"><i className="bi bi-list-ul me-2 text-primary"></i>Lab Orders ({filtered.length})</h6>
          <button className="btn btn-warning btn-sm rounded-pill" onClick={() => setShowOrderForm(true)}><i className="bi bi-plus-lg me-1"></i>New Lab Order</button>
        </div>
        <div className="card-body p-0">
          <div className="table-responsive">
            <table className="table table-hover mb-0 small">
              <thead className="table-light"><tr><th>Order #</th><th>Patient</th><th>Panel</th><th>Tests</th><th>Label</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {groupedOrders.map((g: any) => {
                  const color = g.hasStat ? '#dc3545' : g.pendingCount > 0 ? '#fd7e14' : g.completedCount === g.count ? '#198754' : '#0d6efd';
                  const initials = g.patientName?.split(' ').map((w: string) => w[0]).join('').slice(0, 2) || 'P';
                  return (
                    <Fragment key={g.key}>
                      <tr>
                        <td colSpan={7} className="p-1" style={{ background: 'transparent', border: 'none' }}>
                          <div className="d-flex align-items-center gap-2 px-3 py-2"
                            style={{ borderRadius: '10px', background: `linear-gradient(90deg, ${color}1f, ${color}05)`, borderLeft: `4px solid ${color}` }}>
                            <div className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                              style={{ width: '34px', height: '34px', backgroundColor: `${color}24` }}>
                              <span className="fw-bold" style={{ color, fontSize: '0.8rem' }}>{initials}</span>
                            </div>
                            <div className="flex-grow-1 min-w-0">
                              <div className="fw-bold small text-truncate" style={{ color }}>{g.patientName}</div>
                              <small className="text-muted">PID {g.patientPid ?? g.patientId} · {g.count} test{g.count !== 1 ? 's' : ''}</small>
                            </div>
                            {g.hasStat && <span className="badge bg-danger rounded-pill" style={{ fontSize: '0.6rem' }}>STAT</span>}
                            {g.pendingCount > 0 && <span className="badge rounded-pill" style={{ backgroundColor: '#fd7e14', color: '#fff', fontSize: '0.6rem' }}>{g.pendingCount} pending</span>}
                            {isLabStaff && readyToValidate(g).length > 0 && (
                              <button
                                className="btn btn-primary btn-sm rounded-pill"
                                title="Preview this patient's whole lab group and validate it in one shot"
                                onClick={() => { setGroupToast(''); setPreviewPid(String(g.patientPid ?? g.patientId)); }}>
                                <i className="bi bi-check2-square me-1"></i>
                                Validate group ({readyToValidate(g).length})
                              </button>
                            )}
                            {readyToValidate(g).length > 0 && !isLabStaff && (
                              <span className="badge bg-primary rounded-pill" style={{ fontSize: '0.6rem' }}>
                                {readyToValidate(g).length} ready to validate
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                      {g.orders.map((o: any) => {
                        const tests = testsForOrder(o);
                        return (
                        <tr key={o.id} style={{ cursor: 'pointer' }} onClick={() => { const cid = chartPatientId(o.chartId, o.patientPid, o.patientId); if (cid) navigate(`/patients/${cid}`); }}>
                          <td className="ps-4"><code>#{o.id}</code></td>
                          <td></td>
                          <td><span className="badge bg-light text-dark">{o.instructions || 'Custom'}</span></td>
                          <td><small>{tests.slice(0, 3).join(', ')}{tests.length > 3 ? ` +${tests.length - 3} more` : ''}</small></td>
                          <td>
                            <code className="small">{o.specimenId || `LAB-${o.id}`}</code>
                            <div className="mt-1"><Barcode seed={o.specimenId || `LAB-${o.id}`} width={92} height={26} /></div>
                          </td>
                          <td>
                            <span className="badge rounded-pill" style={{ backgroundColor: STATUS_COLORS[o.orderStatus] || '#6c757d', color: o.orderStatus === 'pending' || o.orderStatus === 'referred' ? '#000' : '#fff' }}>{o.orderStatus}</span>
                            {o.billingHeld && (
                              <span className="badge rounded-pill bg-danger ms-1" title={`Billing hold — $${o.billingHoldFee || 0} unpaid`}>
                                <i className="bi bi-lock-fill me-1"></i>Hold
                              </span>
                            )}
                          </td>
                          <td onClick={e => e.stopPropagation()}>
                            {isLabStaff ? (
                              o.billingHeld ? (
                                <span className="badge bg-danger bg-opacity-10 text-danger border border-danger rounded-pill px-2 py-2"
                                  title={`Billing hold — $${o.billingHoldFee || 0} must be cleared by billing before processing`}>
                                  <i className="bi bi-lock-fill me-1"></i>Billing hold — awaiting clearance
                                </span>
                              ) : (
                              <div className="d-flex gap-1">
                                {o.orderStatus === 'pending' && (
                                  <button className="btn btn-info btn-sm rounded-pill" title="Mark sample as collected" onClick={() => handleCollectSample(o)}><i className="bi bi-droplet me-1"></i>Collect</button>
                                )}
                                {o.orderStatus === 'collected' && (
                                  <button className="btn btn-secondary btn-sm rounded-pill" title="Move to processing" onClick={() => updateStatus.mutate({ orderId: o.id, status: 'processing' })}><i className="bi bi-cpu me-1"></i>Process</button>
                                )}
                                {(o.orderStatus === 'collected' || o.orderStatus === 'processing') && (
                                  <button className="btn btn-success btn-sm rounded-pill" title="Open the lab result form for this order" onClick={() => { setSelectedOrder(o); setShowResultForm(true); }}>
                                    <i className="bi bi-clipboard2-pulse me-1"></i>{o.orderStatus === 'processing' ? 'Enter Results' : 'Results'}
                                  </button>
                                )}
                                {(o.orderStatus === 'completed' || o.orderStatus === 'validated') && (
                                  <button className="btn btn-outline-success btn-sm rounded-pill" title="View the lab result form for this order" onClick={() => { setSelectedOrder(o); setShowResultForm(true); }}>
                                    <i className="bi bi-file-earmark-text me-1"></i>View Results
                                  </button>
                                )}
                                {o.orderStatus === 'completed' && (
                                  <>
                                    <button className="btn btn-primary btn-sm rounded-pill" onClick={() => validateOrder.mutate({ orderId: o.id, action: 'accept' })}><i className="bi bi-check-lg me-1"></i>Validate</button>
                                    <button className="btn btn-danger btn-sm rounded-pill" onClick={() => validateOrder.mutate({ orderId: o.id, action: 'reject' })}><i className="bi bi-x-lg me-1"></i>Reject</button>
                                  </>
                                )}
                                {(o.orderStatus === 'pending' || o.orderStatus === 'collected') && (
                                  <button className="btn btn-warning btn-sm rounded-pill" onClick={() => { setSelectedOrder(o); setShowReferForm(true); }}><i className="bi bi-send me-1"></i>Refer</button>
                                )}
                              </div>
                              )
                            ) : (o.orderStatus === 'completed' || o.orderStatus === 'validated') ? (
                              <button className="btn btn-outline-success btn-sm rounded-pill" title="View the lab result form for this order" onClick={() => { setSelectedOrder(o); setShowResultForm(true); }}>
                                <i className="bi bi-file-earmark-text me-1"></i>View Results
                              </button>
                            ) : (
                              <small className="text-muted">—</small>
                            )}
                          </td>
                        </tr>
                        );
                      })}
                    </Fragment>
                  );
                })}
                {filtered.length === 0 && <tr><td colSpan={7} className="text-center text-muted py-4">No lab orders found</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Group validate modal
 * Shows every open order for a patient together with its results so the
 * technician can preview the whole group and validate it in one shot.
 * ────────────────────────────────────────────────────────────────────────── */
function GroupValidateModal({
  pid, preview, loading, pending, onClose, onValidate,
}: {
  pid: string;
  preview: any;
  loading: boolean;
  pending: boolean;
  onClose: () => void;
  onValidate: () => void;
}) {
  return (
    <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '20px', border: '2px solid #0d6efd' }}>
      <div className="card-header text-white py-3 d-flex justify-content-between align-items-center"
        style={{ background: 'linear-gradient(135deg, #0d6efd, #6f42c1)', borderRadius: '18px 18px 0 0' }}>
        <div>
          <h6 className="mb-0 fw-bold"><i className="bi bi-check2-square me-2"></i>Validate Lab Group</h6>
          <small className="text-white text-opacity-75">
            {preview?.patient?.patientName || 'Loading…'} · PID {pid}
          </small>
        </div>
        <button className="btn btn-sm btn-outline-light rounded-circle" style={{ width: '32px', height: '32px' }}
          onClick={onClose}><i className="bi bi-x-lg"></i></button>
      </div>
      <div className="card-body">
        {loading ? (
          <div className="text-center py-4">
            <span className="spinner-border spinner-border-sm me-2"></span>Building group preview…
          </div>
        ) : !preview ? (
          <div className="alert alert-danger mb-0">Could not load the group preview.</div>
        ) : (
          <>
            {/* Summary */}
            <div className="row g-2 mb-3">
              {[
                { l: 'Orders to validate', v: preview.readyOrders, c: '#0d6efd', i: 'bi-clipboard-check' },
                { l: 'Results', v: preview.resultCount, c: '#198754', i: 'bi-list-check' },
                { l: 'Critical / abnormal', v: preview.criticalCount, c: preview.criticalCount ? '#dc3545' : '#6c757d', i: 'bi-exclamation-triangle' },
                { l: 'Awaiting results', v: (preview.withoutResults || []).length, c: '#fd7e14', i: 'bi-hourglass-split' },
              ].map((s) => (
                <div className="col-6 col-md-3" key={s.l}>
                  <div className="p-2 rounded-3 text-center" style={{ backgroundColor: `${s.c}10` }}>
                    <i className={`bi ${s.i} d-block mb-1`} style={{ color: s.c }}></i>
                    <div className="fw-bold" style={{ color: s.c }}>{s.v}</div>
                    <small className="text-muted" style={{ fontSize: '0.6rem' }}>{s.l}</small>
                  </div>
                </div>
              ))}
            </div>

            {/* Notification routing */}
            <div className={`alert ${preview.provider ? 'alert-info' : 'alert-warning'} py-2 small`}>
              <i className="bi bi-send me-1"></i>
              {preview.provider ? (
                <>Notification will be sent to <strong>provider #{preview.provider}</strong>{' '}
                  ({preview.providerSource === 'assigned' ? "the patient's assigned provider" : 'the ordering provider'}).</>
              ) : (
                <>No provider is set on the patient or their orders — results will be validated but no notification will be sent.</>
              )}
            </div>


            {/* Orders + their results */}
            {(preview.orders || []).map((o: any) => (
              <div key={o.id} className="border rounded-3 mb-2">
                <div className="d-flex align-items-center gap-2 px-3 py-2" style={{ background: '#f8f9fa' }}>
                  <code className="small">#{o.id}</code>
                  <span className="fw-semibold small">{o.instructions || 'Lab order'}</span>
                  {o.criticalCount > 0 && (
                    <span className="badge bg-danger rounded-pill" style={{ fontSize: '0.6rem' }}>{o.criticalCount} critical</span>
                  )}
                  <span className="badge bg-light text-dark border ms-auto" style={{ fontSize: '0.6rem' }}>{o.orderStatus}</span>
                </div>
                <table className="table table-sm small mb-0">
                  <thead className="table-light">
                    <tr><th>Test</th><th>Result</th><th>Units</th><th>Range</th><th>Flag</th></tr>
                  </thead>
                  <tbody>
                    {(o.results || []).map((r: any, i: number) => (
                      <tr key={r.id ?? i}>
                        <td className="fw-semibold">{r.result_text || r.result_code || '—'}</td>
                        <td>{r.result ?? '—'}</td>
                        <td>{r.units || '—'}</td>
                        <td className="text-muted">{r.range || '—'}</td>
                        <td>
                          {r.abnormal === 'Y'
                            ? <span className="badge bg-danger">Abnormal</span>
                            : <span className="badge bg-success">Normal</span>}
                        </td>
                      </tr>
                    ))}
                    {!(o.results || []).length && (
                      <tr><td colSpan={5} className="text-muted text-center">No results</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            ))}

            {(preview.withoutResults || []).length > 0 && (
              <div className="alert alert-warning py-2 small">
                <strong>Awaiting results:</strong>{' '}
                {(preview.withoutResults || []).map((o: any) => `#${o.id} ${o.instructions || ''}`).join(', ')}
                {' '}— these orders stay open.
              </div>
            )}

            {/* Actions */}
            <div className="d-flex align-items-center gap-2 mt-3 flex-wrap">
              <span className="text-muted small">
                Validating marks all {preview.readyOrders} order(s) as <strong>validated</strong>,
                files the results into the patient chart, and notifies the provider — in one shot.
              </span>
              <button className="btn btn-outline-secondary btn-sm rounded-pill ms-auto" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary btn-sm rounded-pill"
                disabled={pending || !preview.readyOrders}
                onClick={onValidate}>
                {pending
                  ? <><span className="spinner-border spinner-border-sm me-1"></span>Validating…</>
                  : <><i className="bi bi-check2-all me-1"></i>Validate all &amp; notify provider</>}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

