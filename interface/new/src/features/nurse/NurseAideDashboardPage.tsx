import { useState, useMemo } from 'react';
import { formatDateTime } from '../../utils/date';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';
import { useDebounce } from '../../hooks/useDebounce';
import nestClient from '../../api/nest-client';
import PhoneInput from '../../components/shared/PhoneInput';
import CitySelect from '../../components/shared/CitySelect';
import {
  assessPatient,
  computeNEWS2,
  riskBadge,
  type VitalsSnapshot,
} from '../../utils/nursingSafety';
import { classifyBP, classifyPulse, classifyTemp, classifyResp, classifySpO2, vitalTrend, formatVital, formatBP } from '../../utils/vitalsClassify';
import { isInvalidLiberiaNationalNumber } from '../../utils/liberia';
import { LAB_TESTS } from '../labs/LabsPage';
import { formatPatientName, formatPatientNameLastFirst } from '../../utils/patientName';
import { chartPatientId } from '../../utils/patientChart';

/** Normalise a vitals row into a snapshot for the safety algorithm. */
function toSnapshot(v: any): VitalsSnapshot {
  const nz = (x: any): number | string | null => {
    const n = Number(x);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const temp = Number(v?.temperature);
  const tempC = Number.isFinite(temp) && temp > 45
    ? Math.round(((temp - 32) * 5 / 9) * 10) / 10
    : Number.isFinite(temp) && temp > 0 ? temp : null;
  return {
    bps: nz(v?.bps), bpd: nz(v?.bpd), pulse: nz(v?.pulse),
    temperature: tempC,
    respiration: nz(v?.respiration),
    oxygen_saturation: nz(v?.oxygen_saturation),
  };
}

function riskRank(level: string): number {
  switch (level) {
    case 'Critical': return 4;
    case 'High': return 3;
    case 'Moderate': return 2;
    case 'Low': return 1;
    default: return 0;
  }
}

const LAB_PANELS = Object.keys(LAB_TESTS);

// Pre-set dropdown values for human vitals (editable inputs with suggestions).
const VITAL_PRESETS: Record<string, string[]> = {
  bps: Array.from({ length: 121 }, (_, i) => String(80 + i)),            // 80–200
  bpd: Array.from({ length: 71 }, (_, i) => String(50 + i)),             // 50–120
  pulse: Array.from({ length: 111 }, (_, i) => String(40 + i)),          // 40–150
  temperature: Array.from({ length: 51 }, (_, i) => (35 + i * 0.1).toFixed(1)), // 35.0–40.0
  respiration: Array.from({ length: 21 }, (_, i) => String(10 + i)),     // 10–30
  oxygen_saturation: Array.from({ length: 13 }, (_, i) => String(88 + i)), // 88–100
  weight: Array.from({ length: 171 }, (_, i) => String(30 + i)),         // 30–200
  height: Array.from({ length: 121 }, (_, i) => String(100 + i)),        // 100–220
};

export default function NurseAideDashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const debounced = useDebounce(search, 250);
  const [selectedPatient, setSelectedPatient] = useState<any>(null);
  const [tab, setTab] = useState('overview');

  // ── Vitals / meds / labs / plan / note forms ────────────────────────────
  const [vitalsForm, setVitalsForm] = useState<any>({ bps: '', bpd: '', pulse: '', temperature: '', respiration: '', oxygen_saturation: '', weight: '', height: '' });
  const [planForm, setPlanForm] = useState({ description: '', care_plan_type: 'nursing' });
  const [noteForm, setNoteForm] = useState({ title: '', note: '' });
  const [labForm, setLabForm] = useState({ instructions: 'Complete Blood Count (CBC)', clinical_hx: '', priority: 'routine' });

  // New patient intake (triage) — nurse aide collects demographics + vitals for a new patient.
  const [showIntake, setShowIntake] = useState(false);
  const [intakeForm, setIntakeForm] = useState<any>({ fname: '', mname: '', lname: '', suffix: '', DOB: '', sex: '', phone_contact: '', street: '', city: '', bps: '', bpd: '', pulse: '', temperature: '', respiration: '', oxygen_saturation: '', weight: '', height: '' });
  /** Likely-existing patients that blocked this admit. */
  const [intakeDuplicates, setIntakeDuplicates] = useState<any[]>([]);
  /** Deliberate opt-in to create a second chart for a possible duplicate. */
  const [intakeOverride, setIntakeOverride] = useState(false);
  /** Existing chart chosen instead of creating a new one. */
  const [intakeTarget, setIntakeTarget] = useState<{ pid: number; public_id?: string } | null>(null);
  const [intakeResult, setIntakeResult] = useState('');

  // ── Nurse dashboard: all active ward patients + shared notes ────────────
  const { data: nurseData } = useQuery({
    queryKey: ['nurse-dashboard'],
    queryFn: async () => {
      try { const r = await nestClient.get('/nurse/dashboard'); return r.data; }
      catch { return { patients: [], assignedPatients: [], sharedNotes: [], unreadCount: 0 }; }
    },
    refetchInterval: 30000,
  });

  const patients = useMemo(() => {
    const list = nurseData?.patients || nurseData?.assignedPatients || [];
    const q = debounced.trim().toLowerCase();
    const filtered = q
      ? list.filter((p: any) => `${p.fname} ${p.lname}`.toLowerCase().includes(q))
      : list;
    return filtered
      .map((p: any) => ({ ...p, risk: assessPatient(toSnapshot(p), p.acuity_level) }))
      .sort((a: any, b: any) => riskRank(b.risk.level) - riskRank(a.risk.level));
  }, [nurseData, debounced]);

  const criticalCount = patients.filter((p: any) => p.risk.level === 'Critical').length;
  const highCount = patients.filter((p: any) => p.risk.level === 'High').length;
  const unreadCount = nurseData?.unreadCount || 0;

  const pid = selectedPatient?.pid ?? null;
  const chartShared = !!selectedPatient?.chart_shared;

  const lockedSection = (title: string) => (
    <div className="card border-0 shadow-sm" style={{ borderRadius: '16px', filter: 'grayscale(1)', opacity: 0.65 }}>
      <div className="card-body text-center py-5">
        <i className="bi bi-lock fs-1 text-muted d-block mb-2"></i>
        <h6 className="text-muted mb-1 fw-bold small">{title} — Locked</h6>
        <p className="small text-muted mb-0">Chart not shared with nursing. Request access from the doctor or registered nurse.</p>
      </div>
    </div>
  );

  // ── Patient detail queries ──────────────────────────────────────────────
  const { data: vitalsHistory = [] } = useQuery({
    queryKey: ['vitals', pid],
    queryFn: async () => (pid ? (await nestClient.get(`/patients/${pid}/vitals`)).data : []),
    enabled: !!pid,
  });
  const { data: medications = [] } = useQuery({
    queryKey: ['medications', pid],
    queryFn: async () => (pid ? (await nestClient.get(`/patients/${pid}/medications`)).data : []),
    enabled: !!pid,
  });
  const { data: allergies = [] } = useQuery({
    queryKey: ['allergies', pid],
    queryFn: async () => (pid ? (await nestClient.get(`/patients/${pid}/allergies`)).data : []),
    enabled: !!pid,
  });
  const { data: conditions = [] } = useQuery({
    queryKey: ['conditions', pid],
    queryFn: async () => (pid ? (await nestClient.get(`/patients/${pid}/conditions`)).data : []),
    enabled: !!pid,
  });
  const { data: carePlan = [] } = useQuery({
    queryKey: ['care-plan', pid],
    queryFn: async () => (pid ? (await nestClient.get(`/patients/${pid}/care-plan`)).data : []),
    enabled: !!pid,
  });
  const { data: notes = [] } = useQuery({
    queryKey: ['patient', pid, 'notes'],
    queryFn: async () => (pid ? (await nestClient.get(`/patients/${pid}/notes`)).data : []),
    enabled: !!pid,
  });
  const { data: labOrders = [] } = useQuery({
    queryKey: ['lab-orders', pid],
    queryFn: async () => (pid ? (await nestClient.get(`/patients/${pid}/procedures`)).data : []),
    enabled: !!pid,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['nurse-dashboard'] });
    qc.invalidateQueries({ queryKey: ['vitals', pid] });
    qc.invalidateQueries({ queryKey: ['medications', pid] });
    qc.invalidateQueries({ queryKey: ['allergies', pid] });
    qc.invalidateQueries({ queryKey: ['care-plan', pid] });
    qc.invalidateQueries({ queryKey: ['patient', pid, 'notes'] });
    qc.invalidateQueries({ queryKey: ['lab-orders', pid] });
  };

  // ── Mutations ───────────────────────────────────────────────────────────
  const recordVitals = useMutation({
    mutationFn: (d: any) => nestClient.post(`/patients/${pid}/vitals`, d),
    onSuccess: () => { invalidate(); setVitalsForm({ bps: '', bpd: '', pulse: '', temperature: '', respiration: '', oxygen_saturation: '', weight: '', height: '' }); },
  });
  const addCarePlan = useMutation({
    mutationFn: (d: any) => nestClient.post(`/patients/${pid}/care-plan`, d),
    onSuccess: () => { invalidate(); setPlanForm({ description: '', care_plan_type: 'nursing' }); },
  });
  const addNote = useMutation({
    mutationFn: (d: any) => nestClient.post(`/patients/${pid}/notes`, { title: 'Nurse Note', note: d.note, noteType: 'nurse', shareWithNursing: true }),
    onSuccess: () => { invalidate(); setNoteForm({ title: '', note: '' }); },
  });
  const orderLab = useMutation({
    mutationFn: (d: any) => nestClient.post(`/patients/${pid}/procedures`, d),
    onSuccess: () => { invalidate(); setLabForm({ instructions: 'Complete Blood Count (CBC)', clinical_hx: '', priority: 'routine' }); },
  });

  const markAllRead = useMutation({
    mutationFn: () => nestClient.post('/nurse/notes/read-all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['nurse-dashboard'] }),
  });

  const intakeMutation = useMutation({
    mutationFn: async () => {
      let pid: number;
      let publicId: string | null = null;
      let isExisting = false;

      if (intakeTarget) {
        // The nurse explicitly chose an existing chart for this person.
        pid = intakeTarget.pid;
        publicId = intakeTarget.public_id || null;
        isExisting = true;
      } else {
        const created = await nestClient.post('/patients', {
          fname: intakeForm.fname.trim(),
          mname: intakeForm.mname?.trim() || '',
          lname: intakeForm.lname.trim(),
          suffix: intakeForm.suffix || '',
          DOB: intakeForm.DOB || null,
          sex: intakeForm.sex || '',
          phone_contact: intakeForm.phone_contact || '',
          street: intakeForm.street || '',
          city: intakeForm.city || '',
          status: 'pending',
        });
        pid = created.data.pid;
        publicId = created.data.publicId;
      }

      const w = Number(intakeForm.weight);
      const h = Number(intakeForm.height);
      let bmi: number | null = null;
      if (w && h) bmi = Math.round((w / Math.pow(h / 100, 2)) * 10) / 10;
      await nestClient.post(`/patients/${pid}/vitals`, {
        bps: intakeForm.bps || null,
        bpd: intakeForm.bpd || null,
        pulse: intakeForm.pulse || null,
        temperature: intakeForm.temperature || null,
        respiration: intakeForm.respiration || null,
        oxygen_saturation: intakeForm.oxygen_saturation || null,
        weight: w || 0, height: h || 0, BMI: bmi || 0,
      });
      // Bill the triage intake (triage + vitals assessment) so the patient
      // shows up in billing as soon as they enter triage.
      await nestClient.post('/billing/triage-intake', { pid });
      return { pid, publicId, isExisting };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nurse-dashboard'] });
      setIntakeForm({ fname: '', mname: '', lname: '', suffix: '', DOB: '', sex: '', phone_contact: '', street: '', city: '', bps: '', bpd: '', pulse: '', temperature: '', respiration: '', oxygen_saturation: '', weight: '', height: '' });
      setIntakeDuplicates([]);
      setIntakeOverride(false);
      setIntakeTarget(null);
      setIntakeResult('');
      setShowIntake(false);
    },
  });

  /**
   * Admitting checks for an existing record first. A likely duplicate blocks the
   * admit and shows the matches, so a second chart is only ever created when the
   * override switch is deliberately turned on (or the existing chart is chosen).
   */
  const handleAdmit = async () => {
    setIntakeDuplicates([]);
    if (intakeOverride || intakeTarget) { intakeMutation.mutate(); return; }
    try {
      const r = await nestClient.get('/patients/check-duplicate', {
        params: {
          fname: intakeForm.fname.trim(),
          lname: intakeForm.lname.trim(),
          DOB: intakeForm.DOB || undefined,
          phone: intakeForm.phone_contact || undefined,
        },
      });
      const hits = Array.isArray(r.data) ? r.data : [];
      if (hits.length) { setIntakeDuplicates(hits); return; }
    } catch {
      // If the check itself fails, fall through and admit rather than block care.
    }
    intakeMutation.mutate();
  };

  const submitVitals = () => {
    const w = Number(vitalsForm.weight);
    const h = Number(vitalsForm.height);
    let bmi: number | null = null;
    if (w && h) bmi = Math.round((w / Math.pow(h / 100, 2)) * 10) / 10;
    recordVitals.mutate({
      bps: vitalsForm.bps || null,
      bpd: vitalsForm.bpd || null,
      pulse: vitalsForm.pulse || null,
      temperature: vitalsForm.temperature || null,
      respiration: vitalsForm.respiration || null,
      oxygen_saturation: vitalsForm.oxygen_saturation || null,
      weight: w || 0, height: h || 0, BMI: bmi || 0,
    });
  };

  const liveSnapshot: VitalsSnapshot = {
    bps: vitalsForm.bps, bpd: vitalsForm.bpd, pulse: vitalsForm.pulse,
    temperature: (() => { const t = Number(vitalsForm.temperature); return Number.isFinite(t) && t > 45 ? Math.round(((t - 32) * 5 / 9) * 10) / 10 : (Number.isFinite(t) ? t : null); })(),
    respiration: vitalsForm.respiration, oxygen_saturation: vitalsForm.oxygen_saturation,
  };
  const liveNews = computeNEWS2(liveSnapshot);

  const fmtDate = (d: string | null | undefined) => formatDateTime(d);

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
      <div className="rounded-4 p-4 mb-4 text-white" style={{ background: 'linear-gradient(135deg, #0d6efd 0%, #198754 50%, #20c997 100%)' }}>
        <div className="d-flex justify-content-between align-items-start flex-wrap gap-3">
          <div>
            <h2 className="mb-1 fw-bold"><i className="bi bi-clipboard2-pulse me-2"></i>Nurse Aide Dashboard</h2>
            <p className="mb-0 text-white text-opacity-75 small">
              Welcome, {user?.displayName || 'Nurse Aide'} — Safety-first patient care workspace
            </p>
          </div>
          <div className="d-flex gap-2">
            {unreadCount > 0 && (
              <button className="btn btn-light btn-sm rounded-pill" onClick={() => markAllRead.mutate()}>
                <i className="bi bi-envelope-open me-1"></i>Mark {unreadCount} note{unreadCount !== 1 ? 's' : ''} read
              </button>
            )}
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <div className="row g-3 mb-4">
        {[
          { label: 'Patients on Dashboard', value: patients.length, icon: 'bi-people-fill', color: '#0d6efd' },
          { label: 'Critical', value: criticalCount, icon: 'bi-exclamation-octagon-fill', color: '#dc3545' },
          { label: 'High Risk', value: highCount, icon: 'bi-exclamation-triangle-fill', color: '#fd7e14' },
          { label: 'Unread Clinical Notes', value: unreadCount, icon: 'bi-envelope-fill', color: '#6f42c1' },
        ].map((k, i) => (
          <div className="col-md-3" key={i}>
            <div className="card border-0 shadow-sm h-100" style={{ borderRadius: '16px' }}>
              <div className="card-body d-flex align-items-center gap-3">
                <div className="rounded-circle d-flex align-items-center justify-content-center" style={{ width: '46px', height: '46px', backgroundColor: k.color + '20' }}>
                  <i className={`bi ${k.icon} fs-5`} style={{ color: k.color }}></i>
                </div>
                <div>
                  <div className="text-muted small">{k.label}</div>
                  <div className="fw-bold fs-5">{k.value}</div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="row g-3">
        {/* Left: patient list + registration */}
        <div className="col-lg-4">
          {/* Patient search */}
          <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '16px' }}>
            <div className="card-body py-3">
              <div className="input-group">
                <span className="input-group-text bg-white border-end-0"><i className="bi bi-search text-muted"></i></span>
                <input className="form-control border-start-0" placeholder="Find patient by name…" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
            </div>
          </div>

          {/* New Patient Intake (triage) — opened from the workspace empty-state button */}
            {showIntake && createPortal(
              <div className="modal d-block" style={{ background: 'rgba(0,0,0,0.45)' }} onMouseDown={(e) => { if (e.target === e.currentTarget) setShowIntake(false); }}>
                <div className="modal-dialog modal-xl modal-dialog-scrollable">
                  <div className="modal-content" style={{ borderRadius: '20px' }}>
                    <div className="modal-header">
                      <h5 className="modal-title"><i className="bi bi-person-plus me-2 text-info"></i>New Patient Intake</h5>
                      <button className="btn-close" onClick={() => setShowIntake(false)}></button>
                    </div>
                    <div className="modal-body">
                      {intakeResult ? (
                        <div className="text-center py-5">
                          <i className="bi bi-check-circle-fill text-success" style={{ fontSize: '3.2rem' }}></i>
                          <h5 className="mt-3 fw-bold">Intake Submitted</h5>
                          <p className="text-muted mb-4">{intakeResult}</p>
                          <div className="d-flex justify-content-center gap-2">
                            <button className="btn btn-outline-secondary btn-sm rounded-pill" onClick={() => { setIntakeResult(''); setShowIntake(false); }}>Close</button>
                            <button className="btn btn-info btn-sm rounded-pill text-white" onClick={() => setIntakeResult('')}><i className="bi bi-person-plus me-1"></i>Add Another Patient</button>
                          </div>
                        </div>
                      ) : (<>
                      <div className="row g-2">
                        <div className="col-md-3"><label className="form-label small mb-0">First Name *</label><input className="form-control form-control-sm" value={intakeForm.fname} onChange={e => setIntakeForm({ ...intakeForm, fname: e.target.value })} /></div>
                        <div className="col-md-2"><label className="form-label small mb-0">Middle Init</label><input className="form-control form-control-sm" value={intakeForm.mname} onChange={e => setIntakeForm({ ...intakeForm, mname: e.target.value })} /></div>
                        <div className="col-md-3"><label className="form-label small mb-0">Last Name *</label><input className="form-control form-control-sm" value={intakeForm.lname} onChange={e => setIntakeForm({ ...intakeForm, lname: e.target.value })} /></div>
                        <div className="col-md-2"><label className="form-label small mb-0">Suffix</label><select className="form-select form-select-sm" value={intakeForm.suffix} onChange={e => setIntakeForm({ ...intakeForm, suffix: e.target.value })}><option value="">—</option><option>Jr</option><option>Sr</option><option>II</option><option>III</option><option>IV</option><option>MD</option><option>PhD</option></select></div>
                        <div className="col-md-2"><label className="form-label small mb-0">DOB</label><input type="date" className="form-control form-control-sm" value={intakeForm.DOB} onChange={e => setIntakeForm({ ...intakeForm, DOB: e.target.value })} /></div>
                        <div className="col-md-2"><label className="form-label small mb-0">Sex</label><select className="form-select form-select-sm" value={intakeForm.sex} onChange={e => setIntakeForm({ ...intakeForm, sex: e.target.value })}><option value="">—</option><option>Male</option><option>Female</option><option>Other</option></select></div>
                        <div className="col-md-4"><label className="form-label small mb-0">Phone</label><PhoneInput value={intakeForm.phone_contact} onChange={v => setIntakeForm({ ...intakeForm, phone_contact: v })} /></div>
                        <div className="col-md-4"><label className="form-label small mb-0">Street *</label><input className="form-control form-control-sm" placeholder="House no, street" value={intakeForm.street} onChange={e => setIntakeForm({ ...intakeForm, street: e.target.value })} /></div>
                        <div className="col-md-3"><label className="form-label small mb-0">City *</label><CitySelect value={intakeForm.city} onChange={v => setIntakeForm({ ...intakeForm, city: v })} className="form-select-sm" /></div>
                      </div>

                      {/* Duplicate guard — a second chart is only created when the
                          override is switched on deliberately. */}
                      {intakeDuplicates.length > 0 && (
                        <div className="alert alert-warning mt-3 mb-0 py-2">
                          <div className="fw-semibold small mb-2">
                            <i className="bi bi-shield-exclamation me-1"></i>
                            Admit blocked — this patient may already be on file
                          </div>
                          {intakeDuplicates.map((d: any) => (
                            <div key={d.id} className="d-flex align-items-center justify-content-between border-bottom py-1 small">
                              <div>
                                <strong>{d.fname} {d.lname}</strong>
                                <div className="text-muted">
                                  DOB: {d.DOB || '—'} · Phone: {d.phone_contact || '—'} · {d.public_id || '—'}
                                </div>
                              </div>
                              <button className="btn btn-sm btn-outline-primary rounded-pill px-3"
                                onClick={() => { setIntakeTarget({ pid: d.pid, public_id: d.public_id }); setIntakeOverride(false); setIntakeDuplicates([]); }}
                                title="Record this visit's vitals on the existing chart">
                                Use Existing <i className="bi bi-arrow-right ms-1"></i>
                              </button>
                            </div>
                          ))}
                          <div className="form-check form-switch mt-2 mb-1">
                            <input className="form-check-input" type="checkbox" role="switch"
                              id="intake-override-duplicate" checked={intakeOverride}
                              onChange={(e) => { setIntakeOverride(e.target.checked); if (e.target.checked) setIntakeTarget(null); }} />
                            <label className="form-check-label small fw-semibold" htmlFor="intake-override-duplicate">
                              Override — admit as a new patient anyway
                            </label>
                          </div>
                          <div className="text-muted" style={{ fontSize: '0.72rem' }}>
                            Only override if you are sure this is a different person (shared phone
                            number, common name). Otherwise use the existing chart so no duplicate is created.
                          </div>
                        </div>
                      )}

                      {intakeTarget && (
                        <div className="alert alert-info mt-3 mb-0 py-2 small d-flex align-items-center gap-2">
                          <i className="bi bi-link-45deg"></i>
                          Recording this visit on the existing chart #{intakeTarget.public_id || intakeTarget.pid}.
                          <button className="btn btn-sm btn-outline-secondary rounded-pill ms-auto"
                            onClick={() => setIntakeTarget(null)}>Change</button>
                        </div>
                      )}

                      <hr className="my-3" />
                      <div className="small fw-semibold text-muted mb-2"><i className="bi bi-heart-pulse me-1 text-danger"></i>Vitals</div>
                      <div className="row g-2">
                        {[
                          ['bps', 'Systolic'], ['bpd', 'Diastolic'], ['pulse', 'Pulse'], ['temperature', 'Temp °C'],
                          ['respiration', 'Resp'], ['oxygen_saturation', 'SpO₂ %'], ['weight', 'Weight kg'], ['height', 'Height cm'],
                        ].map(([k, l]) => (
                          <div className="col-6 col-md-3" key={k}>
                            <label className="form-label small mb-0">{l}</label>
                            <input
                              type="number"
                              className="form-control form-control-sm"
                              list={`intake-${k}`}
                              value={intakeForm[k]}
                              onChange={e => setIntakeForm({ ...intakeForm, [k]: e.target.value })}
                              placeholder="Type or pick"
                            />
                            <datalist id={`intake-${k}`}>
                              {(VITAL_PRESETS[k] || []).map(v => <option key={v} value={v} />)}
                            </datalist>
                          </div>
                        ))}
                      </div>
                      </>)}
                    </div>
                    {!intakeResult && (
                      <div className="modal-footer">
                        <button className="btn btn-outline-secondary btn-sm rounded-pill" onClick={() => setShowIntake(false)}>Cancel</button>
                        <button className="btn btn-info btn-sm rounded-pill text-white" onClick={handleAdmit} disabled={!intakeForm.fname.trim() || !intakeForm.lname.trim() || isInvalidLiberiaNationalNumber(intakeForm.phone_contact) || intakeMutation.isPending}>
                          {intakeMutation.isPending ? 'Admitting…' : <><i className="bi bi-person-check me-1"></i>{intakeTarget ? 'Admit to Existing Chart' : 'Admit Patient & Record Vitals'}</>}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>,
              document.body,
            )}

          {/* Prioritised patient list */}
          <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '16px', maxHeight: '420px' }}>
            <div className="card-header bg-white py-3 d-flex justify-content-between align-items-center">
              <h6 className="mb-0 fw-bold"><i className="bi bi-people me-2 text-primary"></i>My Patients</h6>
              <span className="badge bg-primary rounded-pill">{patients.length}</span>
            </div>
            <div className="card-body p-0" style={{ overflowY: 'auto' }}>
              {patients.length === 0 ? (
                <div className="text-center text-muted py-4 small">No patients found.</div>
              ) : (
                <div className="list-group list-group-flush">
                  {patients.map((p: any) => (
                    <button key={p.pid} type="button"
                      className={`list-group-item list-group-item-action d-flex justify-content-between align-items-center ${selectedPatient?.pid === p.pid ? 'active' : ''}`}
                      onClick={() => { setSelectedPatient(p); setTab('overview'); }}>
                      <div className="text-start">
                        <div className="fw-semibold small">
                          {formatPatientNameLastFirst(p)}
                          {p.is_assigned && <i className="bi bi-person-check ms-1 text-success" title="Assigned to you"></i>}
                          {p.awaiting_vitals && <span className="badge bg-warning text-dark ms-1" style={{ fontSize: '0.6rem' }}>Awaiting vitals</span>}
                        </div>
                        <div className={selectedPatient?.pid === p.pid ? 'text-white text-opacity-75' : 'text-muted'} style={{ fontSize: '0.72rem' }}>
                          {p.room ? `Room ${p.room} · ` : ''}DOB {p.DOB ? String(p.DOB).slice(0, 10) : '—'}
                        </div>
                      </div>
                      <span className={`badge rounded-pill ${riskBadge(p.risk.level)}`}>{p.risk.level}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

        </div>

        {/* Right: patient workspace */}
        <div className="col-lg-8">
          {!selectedPatient ? (
            <div className="card border-0 shadow-sm text-center py-5" style={{ borderRadius: '16px' }}>
              <div className="text-muted py-5">
                <i className="bi bi-arrow-left-circle fs-1 d-block mb-3"></i>
                <h5>Select a patient to begin care</h5>
                <p className="small">Vitals, labs, medications, care plan, and notes are all available here.</p>
                <button className="btn btn-info btn-lg rounded-pill text-white mt-3 px-5 py-3" onClick={() => { setShowIntake(true); setIntakeDuplicates([]); setIntakeOverride(false); setIntakeTarget(null); }}>
                  <i className="bi bi-person-plus me-2 fs-5"></i>New Patient Intake
                </button>
              </div>
            </div>
          ) : (
            <div>
              {/* Patient header + safety banner */}
              <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '16px', borderLeft: `5px solid ${selectedPatient.risk?.color || '#198754'}` }}>
                <div className="card-body py-3">
                  <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
                    <div>
                      <h5 className="mb-0 fw-bold">
                        {formatPatientName(selectedPatient)}
                        <span className={`badge rounded-pill ms-2 ${riskBadge(selectedPatient.risk?.level)}`}>
                          {selectedPatient.risk?.level} · NEWS2 {selectedPatient.risk?.total}
                        </span>
                      </h5>
                      <div className="text-muted small">
                        DOB {selectedPatient.DOB ? String(selectedPatient.DOB).slice(0, 10) : '—'} · {selectedPatient.sex || '—'}
                        {selectedPatient.room ? ` · Room ${selectedPatient.room}` : ''}
                        {selectedPatient.acuity_level ? ` · Acuity: ${selectedPatient.acuity_level}` : ''}
                      </div>
                    </div>
                    <div className="d-flex gap-2 flex-wrap">
                      <button className="btn btn-info btn-sm rounded-pill text-white" onClick={() => navigate(`/patients/${selectedPatient.id}/rounds`)}>
                        <i className="bi bi-clipboard2-pulse me-1"></i>Vital Signs Round
                      </button>
                      {selectedPatient.chart_shared ? (
                        <button className="btn btn-outline-primary btn-sm rounded-pill" onClick={() => { const cid = chartPatientId(selectedPatient.id, selectedPatient.pid); if (cid) navigate(`/patients/${cid}`); }}>
                          Full Chart <i className="bi bi-arrow-right ms-1"></i>
                        </button>
                      ) : (
                        <span className="badge bg-light text-muted border" title="Chart not shared with nursing — request access from the doctor or registered nurse">
                          <i className="bi bi-lock me-1"></i>Chart not shared
                        </span>
                      )}
                    </div>
                  </div>
                  {selectedPatient.risk?.flags?.length > 0 && (
                    <div className="alert alert-danger py-2 mt-2 mb-0 small">
                      <strong><i className="bi bi-shield-exclamation me-1"></i>Safety flags:</strong>{' '}
                      {selectedPatient.risk.flags.map((f: any) => `${f.label} (${f.action})`).join(' · ')}
                    </div>
                  )}
                </div>
              </div>

              {/* Tabs */}
              <ul className="nav nav-pills gap-2 mb-3">
                {[
                  { id: 'overview', label: 'Overview', icon: 'bi-speedometer2' },
                  { id: 'vitals', label: 'Vitals', icon: 'bi-heart-pulse' },
                  { id: 'labs', label: 'Labs', icon: 'bi-flask' },
                  { id: 'meds', label: 'Medications', icon: 'bi-capsule' },
                  { id: 'plan', label: 'Care Plan', icon: 'bi-clipboard-heart' },
                  { id: 'notes', label: 'Notes', icon: 'bi-journal-text' },
                ].map(t => (
                  <li className="nav-item" key={t.id}>
                    <button className={`nav-link ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
                      <i className={`bi ${t.icon} me-1`}></i>{t.label}
                    </button>
                  </li>
                ))}
              </ul>

              {/* Overview */}
              {tab === 'overview' && (
                <div className="row g-3">
                  <div className="col-md-6">
                    <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '16px' }}>
                      <div className="card-header bg-white py-2"><h6 className="mb-0 fw-bold small">Latest Vitals</h6></div>
                      <div className="card-body py-2 small">
                        {vitalsHistory[0] ? (
                          <div className="row g-2">
                            {[
                              ['BP', formatBP(vitalsHistory[0].bps, vitalsHistory[0].bpd)],
                              ['Pulse', formatVital(vitalsHistory[0].pulse)],
                              ['Temp', formatVital(vitalsHistory[0].temperature, 1)],
                              ['Resp', formatVital(vitalsHistory[0].respiration)],
                              ['SpO₂', formatVital(vitalsHistory[0].oxygen_saturation)],
                            ].map(([l, v]) => (
                              <div className="col-6" key={l as string}><span className="text-muted">{l}:</span> <strong>{v ?? '—'}</strong></div>
                            ))}
                          </div>
                        ) : <span className="text-muted">No vitals recorded yet.</span>}
                      </div>
                    </div>
                    <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '16px' }}>
                      <div className="card-header bg-white py-2"><h6 className="mb-0 fw-bold small">Conditions</h6></div>
                      <div className="card-body py-2">
                        {conditions.length === 0 ? <span className="text-muted small">None recorded.</span> : conditions.map((c: any) => (
                          <span className="badge bg-light text-dark border me-1 mb-1" key={c.id}>{c.title || c.diagnosis}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="col-md-6">
                    <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '16px' }}>
                      <div className="card-header bg-white py-2"><h6 className="mb-0 fw-bold small">Allergies</h6></div>
                      <div className="card-body py-2">
                        {allergies.length === 0 ? <span className="text-muted small">No known allergies.</span> : allergies.map((a: any) => (
                          <span className="badge bg-danger bg-opacity-10 text-danger border me-1 mb-1" key={a.id}>{a.allergen || a.title}</span>
                        ))}
                      </div>
                    </div>
                    <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '16px' }}>
                      <div className="card-header bg-white py-2"><h6 className="mb-0 fw-bold small">Active Medications</h6></div>
                      <div className="card-body py-2">
                        {medications.length === 0 ? <span className="text-muted small">None recorded.</span> : medications.map((m: any) => (
                          <div key={m.id} className="small">{m.drug} {m.dosage ? `— ${m.dosage}` : ''}</div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Vitals */}
              {tab === 'vitals' && (
                <div className="row g-3">
                  <div className="col-md-5">
                    <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
                      <div className="card-header bg-white py-2"><h6 className="mb-0 fw-bold small">Record Vitals</h6></div>
                      <div className="card-body">
                        <div className="row g-2">
                          {[
                            ['bps', 'Systolic BP', '120'], ['bpd', 'Diastolic BP', '80'],
                            ['pulse', 'Pulse', '72'], ['temperature', 'Temp (°C)', '37.0'],
                            ['respiration', 'Respiration', '16'], ['oxygen_saturation', 'SpO₂ %', '98'],
                            ['weight', 'Weight (kg)', '70'], ['height', 'Height (cm)', '170'],
                          ].map(([k, l, ph]) => (
                            <div className="col-6" key={k}>
                              <label className="form-label small mb-0">{l}</label>
                              <select className="form-select form-select-sm" value={vitalsForm[k]} onChange={e => setVitalsForm({ ...vitalsForm, [k]: e.target.value })}>
                                <option value="">{ph}</option>
                                {(VITAL_PRESETS[k] || []).map(v => <option key={v} value={v}>{v}</option>)}
                              </select>
                            </div>
                          ))}
                        </div>
                        <div className="alert py-2 px-2 mt-2 mb-2 small" style={{ backgroundColor: liveNews.color + '18', borderLeft: `4px solid ${liveNews.color}` }}>
                          <strong>NEWS2: {liveNews.total}</strong> — {liveNews.riskLevel}
                        </div>
                        <button className="btn btn-primary btn-sm rounded-pill w-100" onClick={submitVitals} disabled={recordVitals.isPending}>
                          {recordVitals.isPending ? 'Saving…' : <><i className="bi bi-check-lg me-1"></i>Save Vitals</>}
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="col-md-7">
                    <div className="card border-0 shadow-sm" style={{ borderRadius: '16px', maxHeight: '480px', overflowY: 'auto' }}>
                      <div className="card-header bg-white py-2"><h6 className="mb-0 fw-bold small">Vital History</h6></div>
                      <div className="card-body p-0">
                        {vitalsHistory.length === 0 ? (
                          <div className="text-center text-muted py-4 small">No vitals recorded.</div>
                        ) : (
                          <table className="table table-sm table-hover mb-0 small">
                            <thead className="table-light"><tr><th>When</th><th>BP</th><th>Pulse</th><th>Temp</th><th>Resp</th><th>SpO₂</th></tr></thead>
                            <tbody>
                              {vitalsHistory.map((v: any, i: number) => {
                                const bp = classifyBP(v.bps, v.bpd);
                                const trend = vitalTrend(v.bps, vitalsHistory[i + 1]?.bps);
                                return (
                                  <tr key={v.id}>
                                    <td>{fmtDate(v.date)}</td>
                                    <td>
                                      <span className="fw-semibold" style={{ color: bp.color }}>{formatBP(v.bps, v.bpd)}</span>
                                      {trend && <span className="ms-1" style={{ color: trend.color, fontSize: '0.7rem' }} title={trend.label}>{trend.symbol}</span>}
                                    </td>
                                    <td><span className="fw-semibold" style={{ color: classifyPulse(v.pulse).color }}>{formatVital(v.pulse)}</span></td>
                                    <td><span className="fw-semibold" style={{ color: classifyTemp(v.temperature).color }}>{formatVital(v.temperature, 1)}</span></td>
                                    <td><span className="fw-semibold" style={{ color: classifyResp(v.respiration).color }}>{formatVital(v.respiration)}</span></td>
                                    <td><span className="fw-semibold" style={{ color: classifySpO2(v.oxygen_saturation).color }}>{formatVital(v.oxygen_saturation)}</span></td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Labs */}
              {tab === 'labs' && (!chartShared ? lockedSection('Labs') : (
                <div className="row g-3">
                  <div className="col-md-5">
                    <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
                      <div className="card-header bg-white py-2"><h6 className="mb-0 fw-bold small">Order Lab</h6></div>
                      <div className="card-body">
                        <label className="form-label small mb-0">Test / Panel</label>
                        <select className="form-select form-select-sm" value={labForm.instructions} onChange={e => setLabForm({ ...labForm, instructions: e.target.value })}>
                          {LAB_PANELS.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                        <label className="form-label small mt-2 mb-0">Clinical indication</label>
                        <textarea className="form-control form-control-sm" rows={2} value={labForm.clinical_hx} onChange={e => setLabForm({ ...labForm, clinical_hx: e.target.value })} />
                        <label className="form-label small mt-2 mb-0">Priority</label>
                        <select className="form-select form-select-sm" value={labForm.priority} onChange={e => setLabForm({ ...labForm, priority: e.target.value })}>
                          <option value="routine">Routine</option><option value="stat">STAT</option><option value="urgent">Urgent</option>
                        </select>
                        <button className="btn btn-primary btn-sm rounded-pill w-100 mt-3" onClick={() => orderLab.mutate(labForm)} disabled={orderLab.isPending}>
                          {orderLab.isPending ? 'Ordering…' : <><i className="bi bi-flask me-1"></i>Order Lab</>}
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="col-md-7">
                    <div className="card border-0 shadow-sm" style={{ borderRadius: '16px', maxHeight: '480px', overflowY: 'auto' }}>
                      <div className="card-header bg-white py-2"><h6 className="mb-0 fw-bold small">Lab Orders & Results</h6></div>
                      <div className="card-body p-0">
                        {labOrders.length === 0 ? (
                          <div className="text-center text-muted py-4 small">No lab orders for this patient.</div>
                        ) : (
                          <div className="list-group list-group-flush">
                            {labOrders.map((o: any) => (
                              <div className="list-group-item" key={o.id}>
                                <div className="d-flex justify-content-between align-items-center">
                                  <span className="fw-semibold small">{o.instructions || 'Lab order'}</span>
                                  <span className="badge bg-secondary rounded-pill">{o.orderStatus || 'pending'}</span>
                                </div>
                                <div className="text-muted" style={{ fontSize: '0.72rem' }}>
                                  {o.specimenId ? `Specimen ${o.specimenId} · ` : ''}{o.hasResults ? 'Results available' : 'Awaiting results'}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {/* Medications (read-only for nurses) */}
              {tab === 'meds' && (!chartShared ? lockedSection('Medications') : (
                <div className="row g-3">
                  <div className="col-md-7">
                    <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
                      <div className="card-header bg-white py-2"><h6 className="mb-0 fw-bold small">Medication List</h6></div>
                      <div className="card-body p-0">
                        {medications.length === 0 ? (
                          <div className="text-center text-muted py-4 small">No medications recorded.</div>
                        ) : (
                          <table className="table table-sm table-hover mb-0 small">
                            <thead className="table-light"><tr><th>Drug</th><th>Dosage</th><th>Route</th><th>Note</th></tr></thead>
                            <tbody>
                              {medications.map((m: any) => (
                                <tr key={m.id}><td>{m.drug}</td><td>{m.dosage || '—'}</td><td>{m.route || '—'}</td><td>{m.note || '—'}</td></tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="col-md-5">
                    <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
                      <div className="card-header bg-white py-2"><h6 className="mb-0 fw-bold small">Allergies</h6></div>
                      <div className="card-body">
                        {allergies.length === 0 ? (
                          <div className="text-muted small">No known allergies.</div>
                        ) : (
                          allergies.map((a: any) => (
                            <span key={a.id} className="badge bg-danger bg-opacity-10 text-danger border me-1 mb-1">{a.allergen || a.title}</span>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {/* Care Plan */}
              {tab === 'plan' && (!chartShared ? lockedSection('Care Plan') : (
                <div className="row g-3">
                  <div className="col-md-5">
                    <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
                      <div className="card-header bg-white py-2"><h6 className="mb-0 fw-bold small">Add Care Plan Entry</h6></div>
                      <div className="card-body">
                        <label className="form-label small mb-0">Plan</label>
                        <textarea className="form-control form-control-sm" rows={3} placeholder="e.g., Monitor SpO₂ every 2 hours…" value={planForm.description} onChange={e => setPlanForm({ ...planForm, description: e.target.value })} />
                        <label className="form-label small mt-2 mb-0">Type</label>
                        <select className="form-select form-select-sm" value={planForm.care_plan_type} onChange={e => setPlanForm({ ...planForm, care_plan_type: e.target.value })}>
                          <option value="nursing">Nursing</option><option value="dietary">Dietary</option><option value="mobility">Mobility</option><option value="discharge">Discharge</option>
                        </select>
                        <button className="btn btn-primary btn-sm rounded-pill w-100 mt-3" onClick={() => addCarePlan.mutate(planForm)} disabled={!planForm.description || addCarePlan.isPending}>
                          {addCarePlan.isPending ? 'Adding…' : <><i className="bi bi-plus-lg me-1"></i>Add to Plan</>}
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="col-md-7">
                    <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
                      <div className="card-header bg-white py-2"><h6 className="mb-0 fw-bold small">Care Plan</h6></div>
                      <div className="card-body p-0">
                        {carePlan.length === 0 ? (
                          <div className="text-center text-muted py-4 small">No care plan entries.</div>
                        ) : (
                          <div className="list-group list-group-flush">
                            {carePlan.map((c: any) => (
                              <div className="list-group-item" key={c.id}>
                                <div className="d-flex justify-content-between">
                                  <span className="fw-semibold small">{c.description}</span>
                                  <span className="badge bg-light text-dark border small">{c.care_plan_type}</span>
                                </div>
                                <div className="text-muted" style={{ fontSize: '0.72rem' }}>{fmtDate(c.date)} · {c.plan_status}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {/* Notes */}
              {tab === 'notes' && (
                <div className="row g-3">
                  <div className="col-md-5">
                    <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
                      <div className="card-header bg-white py-2"><h6 className="mb-0 fw-bold small">Add Nurse Note</h6></div>
                      <div className="card-body">
                        <input className="form-control form-control-sm mb-2" placeholder="Title" value={noteForm.title} onChange={e => setNoteForm({ ...noteForm, title: e.target.value })} />
                        <textarea className="form-control form-control-sm" rows={4} placeholder="Nursing assessment…" value={noteForm.note} onChange={e => setNoteForm({ ...noteForm, note: e.target.value })} />
                        <button className="btn btn-primary btn-sm rounded-pill w-100 mt-2" onClick={() => addNote.mutate(noteForm)} disabled={!noteForm.note || addNote.isPending}>
                          {addNote.isPending ? 'Saving…' : <><i className="bi bi-journal-plus me-1"></i>Add Nurse Note</>}
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="col-md-7">
                    <div className="card border-0 shadow-sm" style={{ borderRadius: '16px', maxHeight: '480px', overflowY: 'auto' }}>
                      <div className="card-header bg-white py-2"><h6 className="mb-0 fw-bold small">Clinical Notes</h6></div>
                      <div className="card-body p-0">
                        {notes.length === 0 ? (
                          <div className="text-center text-muted py-4 small">No notes.</div>
                        ) : (
                          <div className="list-group list-group-flush">
                            {notes.map((n: any) => (
                              <div className="list-group-item" key={n.id}>
                                <div className="d-flex justify-content-between">
                                  <span className="fw-semibold small">{n.title || 'Note'}</span>
                                  <span className="text-muted" style={{ fontSize: '0.7rem' }}>{fmtDate(n.date)}</span>
                                </div>
                                <div className="small text-muted">{n.body}</div>
                                <div className="text-muted" style={{ fontSize: '0.7rem' }}>By {n.author_name || n.user || '—'}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
