import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';
import nestClient from '../../api/nest-client';
import RecentApprovalsPanel from '../../components/shared/RecentApprovalsPanel';
import { formatPatientName } from '../../utils/patientName';
import { computeRiskScore, calculateEDD, interpretApgar, apgarGuidance } from '../../utils/midwife';
import { MIN_CHILDBEARING_AGE, maternityApplicability } from '../../utils/maternity';

interface SelectedPatient {
  pid: number;
  id: number;
  fname: string;
  lname: string;
  /** Used to confirm the chart has a maternity record before filing against it. */
  sex?: string | null;
  DOB?: string | null;
}

interface ApgarSet {
  appearance: string;
  pulse: string;
  grimace: string;
  activity: string;
  respiration: string;
}

const APGAR_FIELDS: { key: keyof ApgarSet; label: string; icon: string }[] = [
  { key: 'appearance', label: 'Appearance (Color)', icon: 'bi-palette' },
  { key: 'pulse', label: 'Pulse (Heart Rate)', icon: 'bi-heart-pulse' },
  { key: 'grimace', label: 'Grimace (Reflex)', icon: 'bi-emoji-expressionless' },
  { key: 'activity', label: 'Activity (Tone)', icon: 'bi-person-arms-up' },
  { key: 'respiration', label: 'Respiration', icon: 'bi-lungs' },
];

const APGAR_DEFAULT: ApgarSet = {
  appearance: '2', pulse: '2', grimace: '2', activity: '2', respiration: '2',
};

const apgarSum = (set: ApgarSet) =>
  Object.values(set).reduce((s, v) => s + Number(v || 0), 0);

function LiveClock({ timezone, label }: { timezone: string; label: string }) {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="text-center px-3">
      <div className="text-white text-opacity-75" style={{ fontSize: '0.7rem' }}>{label}</div>
      <div className="fw-bold" style={{ fontSize: '1.1rem', fontVariantNumeric: 'tabular-nums' }}>
        {time.toLocaleTimeString('en-US', { timeZone: timezone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
      </div>
    </div>
  );
}

/** One APGAR column — the score is documented at 1 minute and again at 5. */
function ApgarColumn({
  title, set, onChange,
}: { title: string; set: ApgarSet; onChange: (next: ApgarSet) => void }) {
  const total = apgarSum(set);
  const interp = interpretApgar(total);
  return (
    <div className="col-lg-6">
      <div className="border rounded-3 p-3 h-100">
        <div className="fw-semibold small mb-2">{title}</div>
        {APGAR_FIELDS.map((f) => (
          <div className="mb-2" key={f.key}>
            <label className="form-label small mb-0">
              <i className={`${f.icon} me-1`}></i>{f.label}
            </label>
            <select
              className="form-select form-select-sm"
              value={set[f.key]}
              onChange={(e) => onChange({ ...set, [f.key]: e.target.value })}
            >
              <option value="0">0 — Absent</option>
              <option value="1">1 — Weak / Some</option>
              <option value="2">2 — Strong / Active</option>
            </select>
          </div>
        ))}
        <div className="d-flex align-items-center gap-2 mt-3 p-2 rounded-3"
          style={{ backgroundColor: interp.color + '15', borderLeft: `4px solid ${interp.color}` }}>
          <div className="rounded-circle d-flex align-items-center justify-content-center fw-bold text-white"
            style={{ width: '44px', height: '44px', backgroundColor: interp.color, fontSize: '1.1rem' }}>
            {total}
          </div>
          <div>
            <div className="fw-bold small" style={{ color: interp.color }}>{interp.interpretation}</div>
            <div className="text-muted" style={{ fontSize: '0.7rem' }}>{title} total</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function MidwifeDashboardPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Every calculator needs a patient before its result can be filed in a chart.
  const [patientSearch, setPatientSearch] = useState('');
  const [selectedPatient, setSelectedPatient] = useState<SelectedPatient | null>(null);

  /**
   * Belt and braces behind the sex/age filter on the search and roster: if a
   * selection still ends up on a chart that has no maternity record (an old
   * bookmarked link, a stale list), the calculators are withheld rather than
   * writing an obstetric assessment into the wrong chart.
   */
  const selectedEligibility = maternityApplicability(selectedPatient);
  const [saveNote, setSaveNote] = useState<{ text: string; ok: boolean } | null>(null);

  const [lmpInput, setLmpInput] = useState('');
  /** Cycle length for the EDD correction. Defaults to the 28-day Naegele assumption. */
  const [cycleLength, setCycleLength] = useState('28');
  const [eddResult, setEddResult] = useState<ReturnType<typeof calculateEDD> | null>(null);
  const [riskForm, setRiskForm] = useState({
    age: '28', parity: '1', gestationWeeks: '30',
    bpSystolic: '120', bpDiastolic: '80', hemoglobin: '12',
    hasDiabetes: false, hasPreeclampsia: false,
  });
  const [riskResult, setRiskResult] = useState<ReturnType<typeof computeRiskScore> | null>(null);
  const [apgar1, setApgar1] = useState<ApgarSet>({ ...APGAR_DEFAULT });
  const [apgar5, setApgar5] = useState<ApgarSet>({ ...APGAR_DEFAULT });

  const { data: maternalPatients = [] } = useQuery({
    queryKey: ['maternal-patients'],
    queryFn: async () => {
      // Same rule as the chart: female, childbearing age and over. A male chart
      // must never appear on a maternity roster.
      const r = await nestClient.get('/patients', { params: { sex: 'Female', ageMin: MIN_CHILDBEARING_AGE, ageMax: 55 } });
      return r.data;
    },
    refetchInterval: 30000,
  });

  // All scheduled deliveries for the current month — single shared queue
  const { data: deliveries = [] } = useQuery({
    queryKey: ['deliveries-month'],
    queryFn: async () => {
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const r = await nestClient.get('/appointments', {
        params: { startDate: fmt(firstDay), endDate: fmt(lastDay), category: 'Delivery' },
      });
      return r.data;
    },
    refetchInterval: 30000,
  });

  /** Search for the patient an assessment belongs to. */
  const { data: searchResults = [] } = useQuery({
    queryKey: ['midwife-patient-search', patientSearch],
    queryFn: async () => {
      // Filtered by sex and age at the API, not in the browser: before this the
      // search returned every patient, so a male chart could be selected and a
      // maternity assessment filed against it.
      const r = await nestClient.get('/patients', {
        params: { search: patientSearch, limit: 10, sex: 'Female', ageMin: MIN_CHILDBEARING_AGE },
      });
      return r.data;
    },
    enabled: patientSearch.trim().length >= 2,
  });

  /** Everything recorded against the selected patient's chart. */
  const { data: assessments = [] } = useQuery({
    queryKey: ['midwife-assessments', selectedPatient?.pid],
    queryFn: async () => {
      const r = await nestClient.get(`/midwife/patients/${selectedPatient!.pid}/assessments`);
      return r.data;
    },
    enabled: !!selectedPatient?.pid,
  });

  const saveAssessment = useMutation({
    mutationFn: async (body: Record<string, any>) =>
      nestClient.post(`/midwife/patients/${selectedPatient!.pid}/assessments`, body),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['midwife-assessments', selectedPatient?.pid] });
      const saved = res?.data || {};
      // The API refuses an identical assessment recorded moments ago, so say that
      // rather than reporting a save that did not happen.
      if (saved.duplicate) {
        setSaveNote({
          text: `Already on the chart — "${saved.summary}" was recorded a few minutes ago, so no duplicate was added.`,
          ok: true,
        });
        return;
      }
      setSaveNote({ text: `Saved to chart — ${saved.summary || 'recorded'}`, ok: true });
    },
    onError: (err: any) => {
      setSaveNote({
        text: err?.response?.data?.message || 'Could not save to the chart.',
        ok: false,
      });
    },
  });

  const deleteAssessment = useMutation({
    mutationFn: async (id: number) => nestClient.delete(`/midwife/assessments/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['midwife-assessments', selectedPatient?.pid] });
      setSaveNote({ text: 'Record removed.', ok: true });
    },
    onError: (err: any) => {
      setSaveNote({ text: err?.response?.data?.message || 'Could not remove the record.', ok: false });
    },
  });

  /** Guards every save: nothing is filed without a patient selected. */
  const saveToChart = (body: Record<string, any>) => {
    if (!selectedPatient) {
      setSaveNote({ text: 'Select a patient first — the result is filed in their chart.', ok: false });
      return;
    }
    saveAssessment.mutate(body);
  };

  const handleEddCalc = () => {
    if (!lmpInput) return;
    setEddResult(calculateEDD(lmpInput, new Date(), Number(cycleLength)));
  };

  const handleRiskCalc = () => {
    const result = computeRiskScore(
      Number(riskForm.age), Number(riskForm.parity), Number(riskForm.gestationWeeks),
      Number(riskForm.bpSystolic), Number(riskForm.bpDiastolic), Number(riskForm.hemoglobin),
      riskForm.hasDiabetes, riskForm.hasPreeclampsia,
    );
    setRiskResult(result);
  };

  const apgar1Total = apgarSum(apgar1);
  const apgar5Total = apgarSum(apgar5);
  /** The 5-minute score carries the interpretation, as on the record. */
  const apgarInterpretation = interpretApgar(apgar5Total);

  const maternalCount = maternalPatients.length;
  const activeLabor = deliveries.filter((d: any) => d.pc_apptstatus === 'Checked In').length;
  const monthlyDeliveries = deliveries.length;

  return (
    /* Glass needs something coloured behind it to blur. The layout provides a
       flat bg-light, over which translucent white is invisible, so this page
       carries its own soft wash — the same approach the other glass pages use. */
    <div
      className="mw-glass position-relative overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, #fdf2f8 0%, #f6f5ff 45%, #eef7f5 100%)',
        borderRadius: '20px',
        minHeight: '100vh',
        padding: '16px',
      }}
    >
      {/* Decorative colour, purely to give the glass something to pick up. */}
      <div className="position-absolute rounded-circle" style={{ width: '320px', height: '320px', top: '-90px', right: '-70px', background: 'radial-gradient(circle, rgba(232,62,140,0.32), transparent 70%)', filter: 'blur(20px)', zIndex: 0 }}></div>
      <div className="position-absolute rounded-circle" style={{ width: '380px', height: '380px', bottom: '8%', left: '-120px', background: 'radial-gradient(circle, rgba(111,66,193,0.26), transparent 70%)', filter: 'blur(20px)', zIndex: 0 }}></div>
      <style>{`
        /* Fluid glass cards, scoped to this dashboard. Sizes are clamp() rather
           than fixed so the radii and inner spacing scale with the viewport
           instead of stepping at breakpoints. */
        .mw-glass .card {
          position: relative;
          z-index: 1;
          border-radius: clamp(0.9rem, 0.62rem + 0.85vw, 1.4rem) !important;
          border: 1px solid rgba(255, 255, 255, 0.9) !important;
          /* !important is required here: these cards carry Bootstrap utilities
             such as .bg-white, which ship as !important and would otherwise
             leave the card opaque white and hide the glass completely. */
          background-color: rgba(255, 255, 255, 0.62) !important;
          background-image: linear-gradient(180deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.10) 55%, rgba(255,255,255,0) 100%);
          backdrop-filter: blur(16px) saturate(150%);
          -webkit-backdrop-filter: blur(16px) saturate(150%);
          box-shadow: 0 18px 40px rgba(10, 37, 64, 0.16), 0 4px 12px rgba(10, 37, 64, 0.08);
          transition: transform 0.22s ease, box-shadow 0.22s ease, background-color 0.22s ease;
        }
        /* The gloss: a hairline highlight along the top rounded edge. */
        .mw-glass .card::before {
          content: '';
          position: absolute;
          inset: 0 0 auto 0;
          height: 1px;
          border-radius: clamp(0.9rem, 0.62rem + 0.85vw, 1.4rem) clamp(0.9rem, 0.62rem + 0.85vw, 1.4rem) 0 0;
          background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.95) 18%, rgba(255,255,255,0.95) 82%, transparent 100%);
          pointer-events: none;
        }
        .mw-glass .card:hover {
          transform: translateY(-3px);
          background-color: rgba(255, 255, 255, 0.72) !important;
          box-shadow: 0 26px 55px rgba(10, 37, 64, 0.22), 0 8px 18px rgba(10, 37, 64, 0.12);
        }
        /* Card headers carry .bg-white, so without this they stay opaque white
           slabs sitting on top of a translucent body. */
        .mw-glass .card-header,
        .mw-glass .card-header.bg-white {
          background: rgba(255, 255, 255, 0.34) !important;
          border-bottom: 1px solid rgba(255, 255, 255, 0.6) !important;
        }
        /* Fluid inner spacing, matched to the fluid radius. */
        .mw-glass .card > .card-body {
          padding: clamp(0.85rem, 0.62rem + 0.55vw, 1.25rem);
        }
        /* Keep focus rings visible on the sheen — these screens are used by
           keyboard as much as by mouse. */
        .mw-glass .card :focus-visible {
          outline: 2px solid #0d6efd;
          outline-offset: 2px;
          border-radius: 0.35rem;
        }
        @media (prefers-reduced-motion: reduce) {
          .mw-glass .card { transition: none; }
          .mw-glass .card:hover { transform: none; }
        }
        /* Print: the glass is meaningless on paper and the shadow wastes toner. */
        @media print {
          .mw-glass .card {
            background: #fff !important;
            box-shadow: none !important;
            backdrop-filter: none !important;
          }
        }
      `}</style>

      {/* Header */}
      <div className="rounded-4 p-4 mb-4 text-white position-relative" style={{
        background: 'linear-gradient(135deg, #e83e8c 0%, #d63384 50%, #6f42c1 100%)',
        zIndex: 1,
      }}>
        <div className="d-flex justify-content-between align-items-start flex-wrap gap-3">
          <div>
            <h2 className="mb-1 fw-bold">
              <i className="bi bi-heart-fill me-2"></i>
              Midwife Dashboard
            </h2>
            <p className="mb-0 text-white text-opacity-75 small">
              Welcome, {user?.displayName || 'Midwife'} — Maternal Care & Delivery Management
            </p>
          </div>
          <div className="d-flex align-items-center gap-2">
            <LiveClock timezone="Africa/Monrovia" label="Monrovia" />
            <div className="vr opacity-50"></div>
            <LiveClock timezone="America/New_York" label="Florida (US)" />
          </div>
        </div>
      </div>

      {/* Patient context — every result below is filed against this chart */}
      <div className="card border-0 shadow-sm rounded-4 mb-3">
        <div className="card-body">
          <div className="row g-2 align-items-end">
            <div className="col-md-5">
              <label className="form-label small fw-semibold mb-1">
                <i className="bi bi-person-badge me-1"></i>Patient
              </label>
              <input
                type="text"
                className="form-control form-control-sm"
                placeholder="Search by name, chart number or phone…"
                value={patientSearch}
                onChange={(e) => setPatientSearch(e.target.value)}
              />
            </div>
            <div className="col-md-7">
              {selectedPatient ? (
                <div className="alert alert-success py-2 mb-0 d-flex align-items-center gap-2">
                  <i className="bi bi-check-circle-fill"></i>
                  <span className="small">
                    Recording against <strong>{selectedPatient.fname} {selectedPatient.lname}</strong>
                    <span className="text-muted"> · pid {selectedPatient.pid}</span>
                  </span>
                  <button className="btn btn-sm btn-outline-secondary rounded-pill ms-auto"
                    onClick={() => { setSelectedPatient(null); setPatientSearch(''); setSaveNote(null); }}>
                    Change
                  </button>
                </div>
              ) : (
                <div className="text-muted small">
                  No patient selected — pick one to file the risk score, EDD and APGAR in their chart.
                </div>
              )}
            </div>
          </div>

          {!selectedPatient && patientSearch.trim().length >= 2 && (
            <div className="mt-2 border rounded-3" style={{ maxHeight: '220px', overflowY: 'auto' }}>
              {searchResults.length === 0 ? (
                <div className="text-muted small p-2">No patients match “{patientSearch}”.</div>
              ) : (
                searchResults.map((p: any) => (
                  <button
                    key={p.id}
                    type="button"
                    className="btn btn-link text-decoration-none text-start w-100 border-bottom py-2 px-3"
                    onClick={() => {
                      setSelectedPatient({ pid: p.pid, id: p.id, fname: p.fname, lname: p.lname, sex: p.sex, DOB: p.DOB });
                      setPatientSearch('');
                      setSaveNote(null);
                    }}
                  >
                    <span className="fw-semibold small">{p.lname}, {p.fname}</span>
                    <span className="text-muted small ms-2">
                      {p.DOB ? `DOB ${String(p.DOB).slice(0, 10)}` : ''}
                      {p.public_id ? ` · ${p.public_id}` : ''}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}

          {saveNote && (
            <div className={`alert ${saveNote.ok ? 'alert-success' : 'alert-danger'} py-2 mt-2 mb-0 small d-flex align-items-center gap-2`}>
              <i className={`bi ${saveNote.ok ? 'bi-check-circle' : 'bi-exclamation-triangle'}`}></i>
              <span className="flex-grow-1">{saveNote.text}</span>
              <button className="btn btn-sm btn-outline-secondary rounded-pill" onClick={() => setSaveNote(null)}>Dismiss</button>
            </div>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="row g-3 mb-4">
        <div className="col-md-4">
          <div className="card border-0 shadow-sm rounded-4 h-100">
            <div className="card-body d-flex align-items-center gap-3">
              <div className="rounded-circle d-flex align-items-center justify-content-center"
                style={{ width: '48px', height: '48px', backgroundColor: '#e83e8c20' }}>
                <i className="bi bi-people-fill fs-5" style={{ color: '#e83e8c' }}></i>
              </div>
              <div className="flex-grow-1">
                <div className="text-muted small">Maternal Patients</div>
                <div className="fw-bold fs-5">{maternalCount}</div>
              </div>
              {/* The count alone was a dead end — this makes it actionable. */}
              {maternalCount > 0 && (
                <select
                  className="form-select form-select-sm"
                  style={{ width: '150px', fontSize: '0.72rem' }}
                  value=""
                  onChange={(e) => {
                    const p = maternalPatients.find((m: any) => String(m.id) === e.target.value);
                    if (p) { setSelectedPatient({ pid: p.pid, id: p.id, fname: p.fname, lname: p.lname }); setSaveNote(null); }
                  }}
                  title="Record an assessment for one of these patients"
                >
                  <option value="">Select…</option>
                  {maternalPatients.map((p: any) => (
                    <option key={p.id} value={p.id}>{p.lname}, {p.fname}</option>
                  ))}
                </select>
              )}
            </div>
          </div>
        </div>
        <div className="col-md-4">
          <div className="card border-0 shadow-sm rounded-4 h-100">
            <div className="card-body d-flex align-items-center gap-3">
              <div className="rounded-circle d-flex align-items-center justify-content-center"
                style={{ width: '48px', height: '48px', backgroundColor: '#fd7e1420' }}>
                <i className="bi bi-hourglass-split fs-5" style={{ color: '#fd7e14' }}></i>
              </div>
              <div>
                <div className="text-muted small">Active Labor</div>
                <div className="fw-bold fs-5">{activeLabor}</div>
              </div>
            </div>
          </div>
        </div>
        <div className="col-md-4">
          <div className="card border-0 shadow-sm rounded-4 h-100">
            <div className="card-body d-flex align-items-center gap-3">
              <div className="rounded-circle d-flex align-items-center justify-content-center"
                style={{ width: '48px', height: '48px', backgroundColor: '#19875420' }}>
                <i className="bi bi-check-circle fs-5" style={{ color: '#198754' }}></i>
              </div>
              <div>
                <div className="text-muted small">Deliveries This Month</div>
                <div className="fw-bold fs-5">{monthlyDeliveries}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="row g-3">
        {/* Left Column — EDD Calculator & Risk Assessment */}
        <div className="col-lg-6">
          {/* EDD Calculator */}
          <div className="card border-0 shadow-sm rounded-4 mb-3">
            <div className="card-header bg-white py-3 rounded-top-4">
              <h6 className="mb-0 fw-bold">
                <i className="bi bi-calendar-check me-2" style={{ color: '#e83e8c' }}></i>
                EDD Calculator — Naegele's Rule
              </h6>
            </div>
            <div className="card-body">
              <div className="row g-2 align-items-end">
                <div className="col-md-6">
                  <label className="form-label small fw-semibold">Last Menstrual Period (LMP)</label>
                  <input type="date" className="form-control" value={lmpInput}
                    onChange={e => setLmpInput(e.target.value)} />
                </div>
                <div className="col-md-3">
                  <label className="form-label small fw-semibold">Cycle length (days)</label>
                  <input type="number" min="20" max="45" className="form-control" value={cycleLength}
                    onChange={e => setCycleLength(e.target.value)} />
                </div>
                <div className="col-md-3">
                  <button className="btn btn-pink w-100" style={{ backgroundColor: '#e83e8c', color: '#fff' }}
                    onClick={handleEddCalc}>
                    <i className="bi bi-calculator me-1"></i>Calculate
                  </button>
                </div>
                <div className="col-md-3"></div>
              </div>
              <div className="form-text">
                Naegele&apos;s rule assumes a 28-day cycle. A longer cycle ovulates later, so the due
                date moves out by the difference.
              </div>
              {eddResult && (
                <div className="mt-3 p-3 rounded-3" style={{ backgroundColor: '#f8f9fa' }}>
                  <div className="row text-center">
                    <div className="col-4">
                      <div className="text-muted small">Estimated Due Date</div>
                      <div className="fw-bold fs-5" style={{ color: '#e83e8c' }}>{eddResult.edd}</div>
                    </div>
                    <div className="col-4">
                      <div className="text-muted small">Gestational Age</div>
                      <div className="fw-bold fs-5">{eddResult.gestationWeeks}w {eddResult.gestationDays}d</div>
                    </div>
                    <div className="col-4">
                      <div className="text-muted small">Trimester</div>
                      <div className="fw-bold fs-5">
                        {eddResult.gestationWeeks < 13 ? '1st' : eddResult.gestationWeeks < 27 ? '2nd' : '3rd'}
                      </div>
                    </div>
                  </div>
                  <div className="text-center mt-3">
                    <button className="btn btn-sm rounded-pill text-white"
                      style={{ backgroundColor: '#e83e8c' }}
                      disabled={!selectedPatient || !selectedEligibility.applicable || saveAssessment.isPending}
                      title={!selectedPatient ? 'Select a patient first' : !selectedEligibility.applicable ? 'Maternity does not apply to this patient' : 'File this EDD in the patient chart'}
                      onClick={() => saveToChart({ kind: 'edd', lmp: lmpInput, cycleLengthDays: Number(cycleLength) })}>
                      <i className="bi bi-folder-plus me-1"></i>
                      {saveAssessment.isPending ? 'Saving…' : 'Save EDD to chart'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Risk Assessment */}
          <div className="card border-0 shadow-sm rounded-4 mb-3">
            <div className="card-header bg-white py-3 rounded-top-4">
              <h6 className="mb-0 fw-bold">
                <i className="bi bi-shield-exclamation me-2" style={{ color: '#fd7e14' }}></i>
                Pregnancy Risk Assessment (PARs Algorithm)
              </h6>
            </div>
            <div className="card-body">
              <div className="row g-2">
                <div className="col-4">
                  <label className="form-label small fw-semibold">Age</label>
                  <input type="number" className="form-control form-control-sm" value={riskForm.age}
                    onChange={e => setRiskForm(p => ({ ...p, age: e.target.value }))} />
                </div>
                <div className="col-4">
                  <label className="form-label small fw-semibold">Parity</label>
                  <input type="number" className="form-control form-control-sm" value={riskForm.parity}
                    onChange={e => setRiskForm(p => ({ ...p, parity: e.target.value }))} />
                </div>
                <div className="col-4">
                  <label className="form-label small fw-semibold">Gest. Weeks</label>
                  <input type="number" className="form-control form-control-sm" value={riskForm.gestationWeeks}
                    onChange={e => setRiskForm(p => ({ ...p, gestationWeeks: e.target.value }))} />
                </div>
                <div className="col-4">
                  <label className="form-label small fw-semibold">BP Systolic</label>
                  <input type="number" className="form-control form-control-sm" value={riskForm.bpSystolic}
                    onChange={e => setRiskForm(p => ({ ...p, bpSystolic: e.target.value }))} />
                </div>
                <div className="col-4">
                  <label className="form-label small fw-semibold">BP Diastolic</label>
                  <input type="number" className="form-control form-control-sm" value={riskForm.bpDiastolic}
                    onChange={e => setRiskForm(p => ({ ...p, bpDiastolic: e.target.value }))} />
                </div>
                <div className="col-4">
                  <label className="form-label small fw-semibold">Hb (g/dL)</label>
                  <input type="number" step="0.1" className="form-control form-control-sm" value={riskForm.hemoglobin}
                    onChange={e => setRiskForm(p => ({ ...p, hemoglobin: e.target.value }))} />
                </div>
                <div className="col-6">
                  <div className="form-check mt-4">
                    <input className="form-check-input" type="checkbox" checked={riskForm.hasDiabetes}
                      onChange={e => setRiskForm(p => ({ ...p, hasDiabetes: e.target.checked }))} id="chkDiabetes" />
                    <label className="form-check-label small" htmlFor="chkDiabetes">Gestational Diabetes</label>
                  </div>
                </div>
                <div className="col-6">
                  <div className="form-check mt-4">
                    <input className="form-check-input" type="checkbox" checked={riskForm.hasPreeclampsia}
                      onChange={e => setRiskForm(p => ({ ...p, hasPreeclampsia: e.target.checked }))} id="chkPreeclampsia" />
                    <label className="form-check-label small" htmlFor="chkPreeclampsia">Pre-eclampsia</label>
                  </div>
                </div>
              </div>
              <button className="btn btn-warning btn-sm mt-3" onClick={handleRiskCalc}>
                <i className="bi bi-calculator me-1"></i>Assess Risk
              </button>
              {riskResult && (
                <div className="mt-3 p-3 rounded-3 d-flex align-items-center gap-3"
                  style={{ backgroundColor: riskResult.color + '15', borderLeft: `4px solid ${riskResult.color}` }}>
                  <div className="rounded-circle d-flex align-items-center justify-content-center fw-bold text-white"
                    style={{ width: '48px', height: '48px', backgroundColor: riskResult.color, fontSize: '1.2rem' }}>
                    {riskResult.score}
                  </div>
                  <div className="flex-grow-1">
                    <div className="fw-bold" style={{ color: riskResult.color }}>{riskResult.label}</div>
                    <div className="text-muted small">
                      PARs Score: {riskResult.score} of {riskResult.maxScore}
                    </div>
                    {/* Shows the score against the scale, so 5 of 27 does not look
                        the same as 5 of 10. */}
                    <div className="progress mt-1" style={{ height: '4px', maxWidth: '220px' }}>
                      <div
                        className="progress-bar"
                        style={{
                          width: `${Math.min(100, (riskResult.score / riskResult.maxScore) * 100)}%`,
                          backgroundColor: riskResult.color,
                        }}
                      />
                    </div>
                  </div>
                  <button className="btn btn-sm btn-outline-danger rounded-pill"
                    disabled={!selectedPatient || !selectedEligibility.applicable || saveAssessment.isPending}
                    title={!selectedPatient ? 'Select a patient first' : !selectedEligibility.applicable ? 'Maternity does not apply to this patient' : 'File this score in the patient chart'}
                    onClick={() => saveToChart({
                      kind: 'risk',
                      risk: {
                        age: Number(riskForm.age),
                        parity: Number(riskForm.parity),
                        gestationWeeks: Number(riskForm.gestationWeeks),
                        bpSystolic: Number(riskForm.bpSystolic),
                        bpDiastolic: Number(riskForm.bpDiastolic),
                        hemoglobin: Number(riskForm.hemoglobin),
                        hasDiabetes: riskForm.hasDiabetes,
                        hasPreeclampsia: riskForm.hasPreeclampsia,
                      },
                    })}>
                    <i className="bi bi-folder-plus me-1"></i>
                    {saveAssessment.isPending ? 'Saving…' : 'Save to chart'}
                  </button>
                </div>
              )}
              {riskResult && riskResult.factors.length > 0 && (
                /* Why the score is what it is. Without this the midwife sees a
                   number with no attribution and cannot check it against the
                   notes. */
                <div className="mt-3 pt-3 border-top">
                  <div className="text-muted small fw-semibold mb-2">Score breakdown</div>
                  <ul className="list-unstyled mb-0 small">
                    {riskResult.factors.map(f => (
                      <li key={f.label} className="d-flex justify-content-between align-items-start gap-3 py-1">
                        <span>
                          {f.label}
                          <span className="text-muted"> · {f.detail}</span>
                        </span>
                        <span className="badge rounded-pill text-bg-light">+{f.points}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {riskResult && riskResult.factors.length === 0 && (
                <div className="mt-3 pt-3 border-top text-muted small">
                  No risk factors recorded — every input is within normal limits.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column — APGAR & Active Labor */}
        <div className="col-lg-6">
          {/* APGAR Calculator */}
          <div className="card border-0 shadow-sm rounded-4 mb-3">
            <div className="card-header bg-white py-3 rounded-top-4">
              <h6 className="mb-0 fw-bold">
                <i className="bi bi-clipboard2-pulse me-2" style={{ color: '#0dcaf0' }}></i>
                APGAR Score — Newborn Assessment
              </h6>
            </div>
            <div className="card-body">
              <p className="text-muted small">
                Documented twice after birth — record both. The 5-minute score carries the
                interpretation that goes on the chart.
              </p>
              <div className="row g-3">
                <ApgarColumn title="At 1 minute" set={apgar1} onChange={setApgar1} />
                <ApgarColumn title="At 5 minutes" set={apgar5} onChange={setApgar5} />
              </div>
              <div className="d-flex align-items-center gap-2 mt-3">
                <span className="badge rounded-pill" style={{ backgroundColor: apgarInterpretation.color }}>
                  {apgarInterpretation.interpretation}
                </span>
                <span className="text-muted small">from the 5-minute score ({apgar5Total})</span>
                <button className="btn btn-sm btn-outline-info rounded-pill ms-auto"
                  disabled={!selectedPatient || !selectedEligibility.applicable || saveAssessment.isPending}
                  title={!selectedPatient ? 'Select a patient first' : !selectedEligibility.applicable ? 'Maternity does not apply to this patient' : 'File both APGAR scores in the patient chart'}
                  onClick={() => saveToChart({
                    kind: 'apgar',
                    apgar: {
                      oneMinute: {
                        appearance: Number(apgar1.appearance), pulse: Number(apgar1.pulse),
                        grimace: Number(apgar1.grimace), activity: Number(apgar1.activity),
                        respiration: Number(apgar1.respiration),
                      },
                      fiveMinute: {
                        appearance: Number(apgar5.appearance), pulse: Number(apgar5.pulse),
                        grimace: Number(apgar5.grimace), activity: Number(apgar5.activity),
                        respiration: Number(apgar5.respiration),
                      },
                    },
                  })}>
                  <i className="bi bi-folder-plus me-1"></i>
                  {saveAssessment.isPending ? 'Saving…' : `Save APGAR (1min ${apgar1Total} / 5min ${apgar5Total})`}
                </button>
              </div>
              {/* What to do next, based on the minute the score was taken. A
                  5-minute score below 7 is the case that needs ongoing
                  reassessment, and that is easy to miss once saved. */}
              <div className="mt-2 small">
                <div className="text-muted">
                  <span className="fw-semibold">At 1 min:</span>{' '}
                  {apgarGuidance(apgar1Total, 1)}
                </div>
                <div className="text-muted">
                  <span className="fw-semibold">At 5 min:</span>{' '}
                  {apgarGuidance(apgar5Total, 5)}
                </div>
              </div>
            </div>
          </div>

          {/* Scheduled Deliveries — current month */}
          <div className="card border-0 shadow-sm rounded-4">
            <div className="card-header bg-white py-3 rounded-top-4 d-flex justify-content-between align-items-center">
              <h6 className="mb-0 fw-bold">
                <i className="bi bi-clipboard-heart me-2" style={{ color: '#e83e8c' }}></i>
                Deliveries This Month
              </h6>
              <span className="badge rounded-pill" style={{ backgroundColor: '#e83e8c' }}>
                {deliveries.length} scheduled
              </span>
            </div>
            <div className="card-body p-0">
              {deliveries.length === 0 ? (
                <div className="text-center py-4 text-muted small">
                  <i className="bi bi-calendar-x fs-3 d-block mb-2"></i>
                  No deliveries scheduled this month
                </div>
              ) : (
                <div className="list-group list-group-flush" style={{ maxHeight: '320px', overflowY: 'auto' }}>
                  {deliveries.map((d: any, i: number) => (
                    <div key={i} className="list-group-item">
                      <div className="d-flex justify-content-between align-items-center">
                        <div className="fw-semibold small">{formatPatientName(d)}</div>
                        <span className={`badge rounded-pill ${
                          d.pc_apptstatus === 'Checked In' ? 'bg-warning text-dark' :
                          d.pc_apptstatus === 'Checked Out' ? 'bg-success' :
                          d.pc_apptstatus === 'Pending' ? 'bg-secondary' :
                          d.pc_apptstatus === 'Scheduled' ? 'bg-info' : 'bg-secondary'
                        }`}>
                          {d.pc_apptstatus || 'Scheduled'}
                        </span>
                      </div>
                      <div className="d-flex justify-content-between text-muted" style={{ fontSize: '0.75rem' }}>
                        <span><i className="bi bi-calendar-event me-1"></i>{d.eventDateStr || '—'}</span>
                        <span><i className="bi bi-clock me-1"></i>{d.pc_startTime || '—'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Recorded against the selected chart */}
      {selectedPatient && !selectedEligibility.applicable && (
        <div className="alert alert-warning d-flex align-items-start gap-2 mt-3 mb-0" role="alert">
          <i className="bi bi-exclamation-triangle-fill mt-1"></i>
          <div className="small">
            <strong>Maternity does not apply to {selectedPatient.fname} {selectedPatient.lname}.</strong>
            <div>{selectedEligibility.reason}</div>
            <div className="mt-1">No assessment can be filed here — pick another patient.</div>
          </div>
          <button className="btn btn-sm btn-outline-secondary rounded-pill ms-auto"
            onClick={() => { setSelectedPatient(null); setPatientSearch(''); setSaveNote(null); }}>
            Change
          </button>
        </div>
      )}

      {selectedPatient && (
        <div className="card border-0 shadow-sm rounded-4 mt-4">
          <div className="card-header bg-white py-3 rounded-top-4 d-flex justify-content-between align-items-center">
            <h6 className="mb-0 fw-bold">
              <i className="bi bi-archive me-2" style={{ color: '#6f42c1' }}></i>
              Recorded for {selectedPatient.fname} {selectedPatient.lname}
            </h6>
            <span className="badge bg-secondary rounded-pill">{assessments.length}</span>
          </div>
          <div className="card-body p-0">
            {assessments.length === 0 ? (
              <div className="text-center py-4 text-muted small">
                <i className="bi bi-inbox fs-3 d-block mb-2"></i>
                Nothing recorded for this patient yet.
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table table-sm table-hover mb-0" style={{ fontSize: '0.8rem' }}>
                  <thead className="table-light">
                    <tr>
                      <th>When</th><th>Type</th><th>Result</th><th>By</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {assessments.map((a: any) => (
                      <tr key={a.id}>
                        <td className="text-muted">
                          {a.recorded_at ? new Date(a.recorded_at).toLocaleString() : '—'}
                        </td>
                        <td>
                          <span className="badge bg-light text-dark border text-uppercase">{a.kind}</span>
                        </td>
                        <td>
                          <span className={
                            a.level === 'high' || a.level === 'Severely Depressed' ? 'text-danger fw-semibold'
                              : a.level === 'moderate' || a.level === 'Moderately Depressed' ? 'text-warning fw-semibold'
                              : a.level === 'low' || a.level === 'Normal' ? 'text-success fw-semibold'
                              : ''
                          }>
                            {a.summary}
                          </span>
                        </td>
                        <td className="text-muted">{a.author_name || '—'}</td>
                        <td className="text-end">
                          <button className="btn btn-sm btn-outline-danger rounded-pill"
                            title="Remove this record"
                            disabled={deleteAssessment.isPending}
                            onClick={() => deleteAssessment.mutate(a.id)}>
                            <i className="bi bi-trash"></i>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Shared: Recently Approved Patients — propagates from registrar */}
      <div className="mt-4">
        <RecentApprovalsPanel />
      </div>
    </div>
  );
}
