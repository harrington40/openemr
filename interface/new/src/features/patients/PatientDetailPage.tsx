import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';
import { criticalFlags } from '../../utils/nursingSafety';
import { canManageChartRecords, canRecordObservations, canRecordVitals } from '../../utils/clinicalPermissions';
import { getPatient } from '../../api/endpoints/patients';
import { getPatientAllergies } from '../../api/endpoints/allergies';
import { getPatientMedications } from '../../api/endpoints/medications';
import { getPatientInsurance } from '../../api/endpoints/insurance';
import { getPatientConditions } from '../../api/endpoints/conditions';
import { getPatientImmunizations } from '../../api/endpoints/immunizations';
import SummaryTab from './tabs/SummaryTab';
import DemographicsTab from './tabs/DemographicsTab';
import InsuranceTab from './tabs/InsuranceTab';
import AllergiesTab from './tabs/AllergiesTab';
import MedicationsTab from './tabs/MedicationsTab';
import ConditionsTab from './tabs/ConditionsTab';
import ImmunizationsTab from './tabs/ImmunizationsTab';
import VitalsTab from './tabs/VitalsTab';
import MaternityTab from './tabs/MaternityTab';
import EmergencyTab from './tabs/EmergencyTab';
import QuickAssign from './components/QuickAssign';
import NotesTab from './tabs/NotesTab';
import ObservationsTab from './tabs/ObservationsTab';
import { maternityApplicability } from '../../utils/maternity';
import { emergencyBanner } from '../../utils/triage';
import { chartTheme, darken } from '../../utils/chartTheme';
import nestClient from '../../api/nest-client';
import { formatPatientName, formatPatientNameLastFirst } from '../../utils/patientName';
import { formatDateOnly } from '../../utils/date';
import Barcode from '../../components/shared/Barcode';

type TabId = 'summary' | 'observations' | 'notes' | 'vitals' | 'allergies' | 'medications' | 'conditions' | 'immunizations' | 'demographics' | 'insurance' | 'maternity' | 'triage';

const tabs: { id: TabId; label: string; icon: string; color: string }[] = [
  { id: 'summary', label: 'Overview', icon: 'bi-person-vcard', color: '#0d6efd' },
  { id: 'observations', label: 'Observations', icon: 'bi-journal-check', color: '#198754' },
  { id: 'notes', label: 'Notes', icon: 'bi-pencil-square', color: '#e83e8c' },
  { id: 'vitals', label: 'Vitals', icon: 'bi-heart-pulse', color: '#dc3545' },
  { id: 'maternity', label: 'Maternity', icon: 'bi-clipboard-heart', color: '#d63384' },
  { id: 'triage', label: 'Emergency', icon: 'bi-clipboard2-pulse', color: '#fd7e14' },
  { id: 'allergies', label: 'Allergies', icon: 'bi-exclamation-triangle', color: '#fd7e14' },
  { id: 'medications', label: 'Medications', icon: 'bi-capsule', color: '#6f42c1' },
  { id: 'conditions', label: 'Diagnoses', icon: 'bi-clipboard2-pulse', color: '#0dcaf0' },
  { id: 'immunizations', label: 'Immunizations', icon: 'bi-syringe', color: '#198754' },
  { id: 'demographics', label: 'Demographics', icon: 'bi-person-lines-fill', color: '#6c757d' },
  { id: 'insurance', label: 'Insurance', icon: 'bi-shield-check', color: '#20c997' },
];

/**
 * Chart menu sections — clinical work first, then the record lists, then
 * administration. Purely presentational: the tab ids and the tab content are
 * unchanged, so the chart itself renders exactly as before.
 */
const TAB_GROUPS: { id: string; label: string; icon: string; ids: TabId[] }[] = [
  { id: 'clinical', label: 'Clinical', icon: 'bi-activity', ids: ['summary', 'observations', 'notes', 'vitals', 'maternity', 'triage'] },
  { id: 'records', label: 'Records', icon: 'bi-folder2-open', ids: ['allergies', 'medications', 'conditions', 'immunizations'] },
  { id: 'admin', label: 'Administration', icon: 'bi-sliders2', ids: ['demographics', 'insurance'] },
];

export default function PatientDetailPage() {
  const { user } = useAuth();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabId>('summary');
  const [menuQuery, setMenuQuery] = useState('');
  const queryClient = useQueryClient();

  // Access control: registrar and billing need admin-granted privilege
  const canViewChart = user?.role === 'admin' || user?.role === 'physician' || user?.role === 'nurse' ||
    (user?.role === 'billing' && user?.can_view_charts === true) ||
    (user?.role === 'front_desk' && user?.can_view_charts === true) ||
    (user?.role === 'midwife') || (user?.role === 'lab_tech');

  // Who may write what is decided per tab by canManageChartRecords /
  // canRecordObservations / canRecordVitals, which mirror the API's @Roles lists.
  // A single role check here is what hid the Save button from nurses on a tab the
  // API accepts nurses for.

  // Doctor / registered nurse / admin can share (or unshare) the chart with nursing.
  const shareChart = useMutation({
    mutationFn: async (shared: boolean) => nestClient.post(`/patients/${id}/share-chart`, { shared }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['patient', id] }),
  });

  if (!canViewChart) {
    return (
      <div className="d-flex align-items-center justify-content-center" style={{ minHeight: '60vh' }}>
        <div className="text-center">
          <i className="bi bi-shield-lock fs-1 d-block mb-3 text-danger opacity-50"></i>
          <h5 className="fw-bold">Access Restricted</h5>
          <p className="text-muted">
            {user?.role === 'front_desk'
              ? 'Registrars do not have access to patient charts.'
              : 'You do not have permission to view patient charts. Please contact an administrator.'}
          </p>
          <button className="btn btn-primary rounded-pill" onClick={() => navigate(-1)}>
            <i className="bi bi-arrow-left me-1"></i>Go Back
          </button>
        </div>
      </div>
    );
  }

  const { data: patient, isLoading, error } = useQuery({ queryKey: ['patient', id], queryFn: () => getPatient(id!), enabled: !!id });
  // Canonical key for everything chart-scoped: the tabs invalidate with the pid,
  // so the page must key its queries the same way or a save silently fails to
  // refresh the chart.
  const pidKey = String(patient?.pid ?? id ?? '');
  const { data: allergies } = useQuery({ queryKey: ['patient', pidKey, 'allergies'], queryFn: () => getPatientAllergies(String(patient?.pid ?? id)), enabled: !!patient?.pid });
  const { data: enrichedAllergies } = useQuery({
    queryKey: ['patient', pidKey, 'allergies-enriched'],
    queryFn: async () => { const r = await nestClient.get(`/patients/${patient?.pid ?? id}/allergies/enriched`); return r.data; },
    enabled: !!patient?.pid,
  });
  const { data: medications } = useQuery({ queryKey: ['patient', pidKey, 'medications'], queryFn: () => getPatientMedications(String(patient?.pid ?? id)), enabled: !!patient?.pid });
  const { data: insurance } = useQuery({ queryKey: ['patient', pidKey, 'insurance'], queryFn: () => getPatientInsurance(String(patient?.pid ?? id)), enabled: !!patient?.pid && activeTab === 'insurance' });
  const { data: conditions } = useQuery({ queryKey: ['patient', pidKey, 'conditions'], queryFn: () => getPatientConditions(String(patient?.pid ?? id)), enabled: !!patient?.pid });
  const { data: immunizations } = useQuery({ queryKey: ['patient', pidKey, 'immunizations'], queryFn: () => getPatientImmunizations(String(patient?.pid ?? id)), enabled: !!patient?.pid && activeTab === 'immunizations' });
  const { data: vitals } = useQuery({ queryKey: ['patient', pidKey, 'vitals'], queryFn: async () => { const r = await nestClient.get(`/patients/${patient?.pid ?? id}/vitals`); return r.data; }, enabled: !!patient?.pid });
  const { data: notes } = useQuery({ queryKey: ['patient', pidKey, 'notes'], queryFn: async () => { const r = await nestClient.get(`/patients/${patient?.pid ?? id}/notes`); return r.data; }, enabled: !!patient?.pid });
  const { data: labOrders } = useQuery({ queryKey: ['patient', pidKey, 'procedures'], queryFn: async () => { const r = await nestClient.get(`/patients/${patient?.pid ?? id}/procedures`); return r.data; }, enabled: !!patient?.pid });
  // Patient-scoped lab results — this is the chart source, so validated results
  // released by the lab appear here immediately.
  const { data: labResults } = useQuery({
    queryKey: ['patient', pidKey, 'lab-results'],
    queryFn: async () => {
      const r = await nestClient.get(`/lab/patients/${patient?.pid ?? id}/results`, { params: { limit: 100 } });
      return r.data;
    },
    enabled: !!patient?.pid,
  });

  // Menu badge for Observations. Same query key as the tab uses, so the tab opens
  // instantly from cache and the count shown is the real number.
  const { data: observations } = useQuery({
    queryKey: ['patient', pidKey, 'observations'],
    queryFn: async () => {
      try { const r = await nestClient.get(`/patients/${patient?.pid ?? id}/observations`); return r.data || []; }
      catch { return []; }
    },
    enabled: !!patient?.pid,
  });

  if (isLoading) return <div className="text-center py-5"><div className="spinner-grow text-primary" style={{ width: '3rem', height: '3rem' }} /><p className="text-muted mt-2">Loading chart...</p></div>;
  if (error || !patient) {
    // Distinguish "no patient reference at all" from "that patient is gone" so a
    // broken link (e.g. /patients/0) reads clearly instead of a bare failure.
    const numericId = Number(id);
    const invalidId = !id || !Number.isFinite(numericId) || numericId <= 0;
    return (
      <div className="text-center py-5">
        <i className="bi bi-exclamation-triangle fs-1 text-danger"></i>
        <h5>{invalidId ? 'No patient selected' : 'Patient not found'}</h5>
        <p className="text-muted small mb-0">
          {invalidId
            ? 'This link did not contain a valid patient reference.'
            : `The chart for patient #${id} could not be loaded.`}
        </p>
        <button className="btn btn-outline-primary rounded-pill mt-3" onClick={() => navigate('/patients')}>
          <i className="bi bi-arrow-left me-1"></i>Back to patients
        </button>
      </div>
    );
  }

  const initials = `${patient.fname?.[0] || ''}${patient.lname?.[0] || ''}`;
  const age = patient.dob ? Math.floor((Date.now() - new Date(patient.dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000)) : null;

  // ── Clinical safety algorithm (error prevention) ─────────────────────────
  const latestVital = (vitals || [])[0];
  const vitalFlags = (() => {
    if (!latestVital) return [];
    const t = Number(latestVital.temperature);
    const tempC = Number.isFinite(t) && t > 45 ? Math.round(((t - 32) * 5 / 9) * 10) / 10 : (Number.isFinite(t) ? t : null);
    return criticalFlags({
      bps: latestVital.bps, bpd: latestVital.bpd, pulse: latestVital.pulse,
      temperature: tempC, respiration: latestVital.respiration,
      oxygen_saturation: latestVital.oxygen_saturation,
    });
  })();

  const allergyList = (enrichedAllergies && enrichedAllergies.length) ? enrichedAllergies : (allergies || []);
  const allergyNames = (allergyList as any[]).map((a: any) => String(a.allergen || a.title || '').toLowerCase()).filter(Boolean);
  const drugAllergyWarnings = (medications || []).filter((m: any) => {
    const drug = String(m.drug || '').toLowerCase();
    return allergyNames.some(a => drug.includes(a));
  });
  const polypharmacy = (medications || []).length >= 5;
  const safetyAlerts = [
    ...(allergyList as any[]).map((a: any) => ({ severity: 'danger', icon: 'bi-exclamation-triangle', text: `Allergy: ${a.allergen || a.title}` })),
    ...drugAllergyWarnings.map((m: any) => ({ severity: 'danger', icon: 'bi-capsule', text: `Drug-allergy interaction: ${m.drug}` })),
    ...vitalFlags.map((f: any) => ({ severity: f.severity === 'critical' ? 'danger' : 'warning', icon: 'bi-heart-pulse', text: `${f.label} — ${f.action}` })),
    ...(polypharmacy ? [{ severity: 'warning', icon: 'bi-capsule-pill', text: `Polypharmacy: ${(medications || []).length} active medications` }] : []),
  ];

  // Theme color of the currently-selected chart tab.
  const activeColor = (tabs.find((t) => t.id === activeTab) || tabs[0]).color;

  // ── Chart menu data ──────────────────────────────────────────────────────
  // Live counts from data the chart has already loaded, so the menu shows where
  // the record actually has content instead of only a label.
  const menuCounts: Partial<Record<TabId, { n: number; tone: string; title: string }>> = {
    observations: { n: (observations || []).length, tone: '#198754', title: 'observations recorded' },
    notes: { n: (notes || []).length, tone: '#e83e8c', title: 'clinical notes' },
    vitals: { n: (vitals || []).length, tone: '#dc3545', title: 'vitals recordings' },
    allergies: { n: (allergyList || []).length, tone: '#fd7e14', title: 'allergies on file' },
    medications: { n: (medications || []).length, tone: '#6f42c1', title: 'medications on the list' },
    conditions: { n: (conditions || []).length, tone: '#0dcaf0', title: 'diagnoses on the problem list' },
    immunizations: { n: (immunizations || []).length, tone: '#198754', title: 'immunizations recorded' },
  };

  // Weighted readiness from the backend (registration + assignment + clinical
  // baseline). Falls back to nothing when an older payload has no score.
  const readiness = (patient as any).chart_readiness as
    | { score: number; nextAction: string; missing: string[] } | undefined;

  const menuFilter = menuQuery.trim().toLowerCase();

  // Maternity only exists for a patient who can have one — a male chart or a
  // young child must never be offered the tab. The backend decides (see
  // maternity_eligibility on the patient payload); this does not re-derive it.
  const maternity = maternityApplicability(patient as any);
  // Emergency history appears only once there is any — an always-present empty
  // tab is clutter on 99% of charts.
  const emergency = (patient as any)?.emergency as { total?: number } | undefined;
  const hasEmergency = (emergency?.total || 0) > 0;
  const banner = emergencyBanner(emergency);

  const applicableTabs = patient
    ? tabs.filter((t) => (t.id === 'maternity' ? maternity.applicable : t.id === 'triage' ? hasEmergency : true))
    : tabs;

  /**
   * The page theme. While the patient is in the department the card theme is
   * their triage level colour — the same colour the board, the banner and the
   * chart menu all use — and it falls back to the open section's colour on an
   * ordinary chart. See utils/chartTheme.ts.
   */
  const theme = chartTheme({
    level: banner?.level ?? null,
    inDepartment: !!banner,
    tabColor: activeColor,
  });

  const visibleGroups = TAB_GROUPS
    .map((group) => ({
      ...group,
      items: group.ids
        .map((tid) => applicableTabs.find((t) => t.id === tid))
        .filter((t): t is (typeof tabs)[number] => !!t && (!menuFilter || t.label.toLowerCase().includes(menuFilter))),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="chart-page position-relative overflow-hidden"
      style={{
        // Fluid wash: the level colour, faintly, behind everything. Also exposed
        // as CSS variables so every card inherits the same theme.
        background: `radial-gradient(1200px 600px at 12% -10%, ${theme.tint}, transparent 60%), linear-gradient(135deg, #f4f8ff 0%, #fdfefe 45%, #f2fbf7 100%)`,
        borderRadius: '20px',
        minHeight: '100vh',
        padding: '16px',
        ['--chart-accent' as any]: theme.accent,
        ['--chart-tint' as any]: theme.tint,
        ['--chart-ring' as any]: theme.ring,
        ['--chart-shadow' as any]: theme.shadow,
        ['--chart-shadow-hover' as any]: theme.shadowHover,
      }}>
      <div className="position-absolute rounded-circle" style={{ width: '340px', height: '340px', top: '-80px', right: '-60px', background: `radial-gradient(circle, ${theme.ring}, transparent 70%)`, filter: 'blur(24px)', zIndex: 0, transition: 'background .6s ease' }}></div>
      <div className="position-absolute rounded-circle" style={{ width: '400px', height: '400px', bottom: '8%', left: '-120px', background: `radial-gradient(circle, ${theme.tint}, transparent 70%)`, filter: 'blur(24px)', zIndex: 0, transition: 'background .6s ease' }}></div>
      <style>{`
        .chart-page .card {
          position: relative;
          z-index: 1;
          background: rgba(255,255,255,0.72) !important;
          backdrop-filter: blur(16px) saturate(140%);
          -webkit-backdrop-filter: blur(16px) saturate(140%);
          border: 1px solid rgba(255,255,255,0.9) !important;
          /* Layered + accent-tinted, so the level colour reads as the card theme
             rather than a grey drop shadow sitting under it. */
          box-shadow: var(--chart-shadow) !important;
          /* Fluid: everything that changes animates, on one easing curve. */
          transition:
            transform .32s cubic-bezier(.22,.61,.36,1),
            box-shadow .32s cubic-bezier(.22,.61,.36,1),
            background .32s ease,
            border-color .32s ease;
        }
        .chart-page .card:hover {
          transform: translateY(-4px);
          background: rgba(255,255,255,0.82) !important;
          box-shadow: var(--chart-shadow-hover) !important;
        }
        .chart-page .card .card-header,
        .chart-page .card-header {
          background: linear-gradient(180deg, rgba(255,255,255,0.55), rgba(255,255,255,0.30)) !important;
          border-bottom: 1px solid var(--chart-ring) !important;
          transition: border-color .32s ease;
        }
        .chart-page .list-group-item {
          background: transparent !important;
        }
        .chart-page .table thead.table-light {
          background: rgba(255,255,255,0.45) !important;
        }
        /* The content panel eases in when the section changes, instead of
           snapping from one tab to the next. */
        .chart-panel-enter { animation: chartPanelIn .34s cubic-bezier(.22,.61,.36,1); }
        @keyframes chartPanelIn {
          from { opacity: 0; transform: translateY(8px) scale(.995); }
          to   { opacity: 1; transform: none; }
        }
        .chart-page .progress-bar { transition: width .5s cubic-bezier(.22,.61,.36,1), background .4s ease; }
        .chart-page .badge { transition: background .3s ease, color .3s ease; }
        .chart-page .chart-menu-item { transition: background .22s ease, transform .22s ease, box-shadow .22s ease; }
        .chart-page .chart-menu-item:hover { transform: translateX(3px); box-shadow: 0 6px 16px -10px var(--chart-accent); }
        .chart-page .chart-menu-item.active:hover { transform: none; }
        /* Respect a reduced-motion preference: the theme still applies, the
           movement does not. */
        @media (prefers-reduced-motion: reduce) {
          .chart-page .card,
          .chart-page .card:hover,
          .chart-page .chart-menu-item,
          .chart-page .chart-menu-item:hover,
          .chart-page .progress-bar,
          .chart-page .badge { transition: none !important; transform: none !important; }
          .chart-panel-enter { animation: none !important; }
        }
      `}</style>
      <div className="rounded-4 p-4 mb-4 text-white position-relative overflow-hidden"
        style={{
          // The hero carries white text, so a light level (Yellow, Blue) is
          // darkened here; every other use of the level colour stays true.
          background: theme.fromLevel
            ? `linear-gradient(135deg, ${darken(theme.accent, 0.78)} 0%, ${darken(theme.accent, 0.42)} 100%)`
            : 'linear-gradient(135deg, #0d6efd 0%, #4b2d8e 40%, #6f42c1 70%, #e83e8c 100%)',
          zIndex: 1,
          boxShadow: theme.shadow,
          transition: 'background .5s ease, box-shadow .32s ease',
        }}>
        {theme.fromLevel && (
          <span className="badge rounded-pill position-absolute"
            style={{ top: '14px', right: '16px', background: 'rgba(255,255,255,0.92)', color: darken(theme.accent, 0.5), fontWeight: 700 }}>
            In the department · Level {theme.level} {theme.levelLabel}
          </span>
        )}
        <div className="position-absolute end-0 top-0 opacity-10" style={{ fontSize: '8rem', transform: 'rotate(10deg) translate(30px,-10px)' }}><i className="bi bi-clipboard2-pulse"></i></div>
        <div className="position-relative">
          <div className="d-flex align-items-start gap-4 flex-wrap">
            <div className="flex-shrink-0">
              {/* Initials only. The avatars table is keyed by users.id, so asking
                  it for a patient returned whichever staff member happened to
                  share that id — patient 8 was showing the registrar's photo. */}
              <div className="rounded-circle d-flex align-items-center justify-content-center fw-bold shadow" style={{ width: '88px', height: '88px', fontSize: '2rem', background: 'rgba(255,255,255,0.2)', border: '3px solid rgba(255,255,255,0.4)' }}>{initials}</div>
            </div>
            <div className="flex-grow-1">
              <div className="d-flex justify-content-between align-items-start flex-wrap gap-2">
                <div>
                  <h3 className="mb-1 fw-bold">{formatPatientNameLastFirst(patient)}</h3>
                  <div className="d-flex flex-wrap gap-2 align-items-center">
                    <span className="badge bg-white bg-opacity-25 rounded-pill"><i className="bi bi-cake2 me-1"></i>{formatDateOnly((patient as any).DOB || patient.dob)} {age != null && `(${age}y)`}</span>
                    <span className="badge bg-white bg-opacity-25 rounded-pill"><i className="bi bi-gender-ambiguous me-1"></i>{patient.sex || '—'}</span>
                    <span className="badge bg-white bg-opacity-25 rounded-pill"><i className="bi bi-upc me-1"></i>PID: {patient.pid ?? patient.uuid?.substring(0, 8)}</span>
                    {patient.public_id && <span className="badge bg-white bg-opacity-25 rounded-pill"><i className="bi bi-person-badge me-1"></i>Chart #: {patient.public_id}</span>}
                    {((patient as any).providerName || patient.provider_name) && <span className="badge bg-white bg-opacity-25 rounded-pill"><i className="bi bi-person-check me-1"></i>{(patient as any).providerName || patient.provider_name}</span>}
                  </div>
                </div>
                <div className="d-flex gap-2 flex-wrap">
                  <button className="btn btn-light btn-sm rounded-pill" onClick={() => navigate(`/patients/${id}/screening`)}><i className="bi bi-clipboard2-pulse me-1"></i>Screening</button>
                  <button className="btn btn-light btn-sm rounded-pill" onClick={() => navigate(`/patients/${id}/encounters`)}><i className="bi bi-file-medical me-1"></i>Visits</button>
                  {(user?.role === 'physician' || user?.role === 'admin' || user?.role === 'nurse') && (
                    <button className={`btn btn-sm rounded-pill ${patient.chart_shared ? 'btn-warning' : 'btn-outline-warning'}`}
                      onClick={() => shareChart.mutate(!patient.chart_shared)}>
                      <i className="bi bi-share me-1"></i>{patient.chart_shared ? 'Unshare Chart' : 'Share with Nursing'}
                    </button>
                  )}
                  <button className="btn btn-warning btn-sm rounded-pill fw-semibold" onClick={() => navigate(user?.role === 'nurse' ? '/nurse-dashboard' : '/provider-dashboard')}><i className="bi bi-check-lg me-1"></i>Done</button>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-3 p-2 rounded-3 d-inline-block" style={{ background: 'rgba(255,255,255,0.92)' }}>
            <Barcode seed={patient.public_id || `PID-${patient.pid ?? id}`} width={150} />
            <div className="text-dark text-center" style={{ fontSize: '0.65rem', letterSpacing: 1 }}>
              {patient.public_id || `PID-${patient.pid ?? id}`}
            </div>
          </div>
        </div>
      </div>

      {/* Registration completeness — a yellow flag until the registrar has the
          full demographics and the patient is assigned to a provider. */}
      {patient.chart_complete === false && (
        <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '16px', borderLeft: '4px solid #ffc107', background: 'rgba(255, 193, 7, 0.12)' }}>
          <div className="card-body py-2 px-3">
            <div className="d-flex flex-wrap align-items-center gap-2">
              <i className="bi bi-exclamation-triangle-fill text-warning fs-5"></i>
              <strong className="small">Chart incomplete</strong>
              {(() => {
                // Distinguish "not approved yet" from "approved but a registration
                // detail is still blank" — reporting the latter as "No provider
                // assigned" would be wrong once a provider is on the chart.
                const missingProvider = (patient.missing_fields || []).includes('Assigned provider');
                if (patient.status === 'pending') {
                  return <span className="badge bg-warning text-dark rounded-pill" style={{ fontSize: '0.7rem' }}>Awaiting registrar approval</span>;
                }
                if (missingProvider) {
                  return <span className="badge bg-warning text-dark rounded-pill" style={{ fontSize: '0.7rem' }}>No provider assigned</span>;
                }
                return <span className="badge bg-warning text-dark rounded-pill" style={{ fontSize: '0.7rem' }}>Registration details outstanding</span>;
              })()}
              {(patient.missing_fields?.length ?? 0) > 0 && (
                <span className="small text-dark">
                  Still needed: <strong>{patient.missing_fields!.join(', ')}</strong>
                </span>
              )}
              <button className="btn btn-warning btn-sm rounded-pill ms-auto"
                onClick={() => setActiveTab('demographics')}>
                <i className="bi bi-pencil-square me-1"></i>Complete Chart
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clinical safety alerts — error prevention */}
      {safetyAlerts.length > 0 && (
        <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '16px', borderLeft: '4px solid #dc3545' }}>
          <div className="card-body py-2 px-3">
            <div className="d-flex align-items-center gap-2 mb-1">
              <i className="bi bi-shield-exclamation text-danger"></i>
              <strong className="small">Clinical Safety Alerts</strong>
              <span className="badge bg-danger rounded-pill">{safetyAlerts.length}</span>
            </div>
            <div className="d-flex flex-wrap gap-2">
              {safetyAlerts.map((a: any, i: number) => (
                <span key={i} className={`badge ${a.severity === 'danger' ? 'bg-danger bg-opacity-10 text-danger' : 'bg-warning bg-opacity-10 text-dark'} border`}
                  style={{ fontSize: '0.72rem', fontWeight: 500 }}>
                  <i className={`bi ${a.icon} me-1`}></i>{a.text}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      <QuickAssign patientId={id!} currentProviderId={patient.provider != null ? String(patient.provider) : undefined} currentProviderName={patient.provider_name || patient.providerName} />

      {/* Emergency banner: shown only while the patient is actually in the
          department. Silence for past attendances — those live in the tab. */}
      {banner && (
        <div className="alert mb-3 d-flex flex-wrap align-items-center gap-2"
          style={{ borderLeft: `8px solid ${banner.color}`, background: `${banner.color}18` }} role="status">
          <i className="bi bi-heart-pulse-fill" style={{ color: banner.color, fontSize: '1.3rem' }}></i>
          <div className="flex-grow-1">
            <div className="fw-bold">{banner.headline}</div>
            <div className="small text-muted">{banner.detail}</div>
            <div className="small fw-semibold mt-1">{banner.action}</div>
          </div>
          <button className="btn btn-sm btn-outline-secondary rounded-pill" onClick={() => setActiveTab('triage')}>
            <i className="bi bi-clock-history me-1"></i>Triage history
          </button>
          <button className="btn btn-sm btn-outline-danger rounded-pill" onClick={() => navigate('/emergency')}>
            <i className="bi bi-box-arrow-up-right me-1"></i>Open the board
          </button>
        </div>
      )}

      <div className="row g-3">
        <div className="col-lg-3">
          <style>{`
            .chart-menu-item { transition: background .15s ease, transform .15s ease; }
            .chart-menu-item:hover { background: rgba(13,110,253,0.07) !important; transform: translateX(2px); }
            .chart-menu-item.active:hover { transform: none; }
            .chart-menu-search .form-control:focus { box-shadow: none; border-color: #dee2e6; }
          `}</style>
          <div className="card border-0 shadow-sm" style={{ borderRadius: '20px', overflow: 'hidden' }}>
            <div className="card-header bg-white py-3" style={{ borderRadius: '20px 20px 0 0', borderBottom: `2px solid ${theme.ring}` }}>
              <div className="d-flex align-items-center justify-content-between gap-2">
                <h6 className="mb-0 fw-bold">
                  <i className="bi bi-journal-medical me-2" style={{ color: theme.accent }}></i>Medical Chart
                </h6>
                {readiness && (
                  <span className="badge rounded-pill"
                    title={`Chart readiness ${readiness.score}%${readiness.missing.length ? ` — still needed: ${readiness.missing.join(', ')}` : ''}`}
                    style={{
                      fontWeight: 700,
                      backgroundColor: readiness.score >= 90 ? '#19875422' : readiness.score >= 60 ? '#fd7e1422' : '#dc354522',
                      color: readiness.score >= 90 ? '#198754' : readiness.score >= 60 ? '#b35c00' : '#dc3545',
                    }}>
                    {readiness.score}% ready
                  </span>
                )}
              </div>
              {readiness && (
                <div className="mt-2">
                  <div className="progress" style={{ height: '5px' }}>
                    <div className="progress-bar" role="progressbar"
                      style={{
                        width: `${readiness.score}%`,
                        backgroundColor: readiness.score >= 90 ? '#198754' : readiness.score >= 60 ? '#fd7e14' : '#dc3545',
                      }}
                      aria-valuenow={readiness.score} aria-valuemin={0} aria-valuemax={100} />
                  </div>
                  <div className="text-muted mt-1" style={{ fontSize: '0.68rem', lineHeight: 1.3 }}>
                    {readiness.nextAction}
                  </div>
                </div>
              )}
            </div>

            {/* Jump-to: eleven sections is enough that a filter beats scrolling. */}
            <div className="px-3 pt-3 chart-menu-search">
              <div className="input-group input-group-sm">
                <span className="input-group-text bg-white border-end-0">
                  <i className="bi bi-search text-muted" style={{ fontSize: '0.75rem' }}></i>
                </span>
                <input className="form-control border-start-0 ps-0" placeholder="Jump to a section…"
                  aria-label="Filter chart sections"
                  value={menuQuery} onChange={(e) => setMenuQuery(e.target.value)} />
                {menuQuery && (
                  <button className="btn btn-outline-secondary border-start-0" type="button"
                    aria-label="Clear filter" onClick={() => setMenuQuery('')}>
                    <i className="bi bi-x-lg" style={{ fontSize: '0.7rem' }}></i>
                  </button>
                )}
              </div>
            </div>
            <div className="list-group list-group-flush py-2" style={{ boxShadow: `inset 0 0 0 2px ${theme.ring}` }}>
              {visibleGroups.length === 0 && (
                <div className="px-3 py-3 text-muted small">
                  <i className="bi bi-search me-1"></i>No section matches “{menuQuery.trim()}”.
                </div>
              )}
              {visibleGroups.map((group) => (
                <div key={group.id}>
                  <div className="px-3 pt-2 pb-1 text-uppercase text-muted d-flex align-items-center gap-1"
                    style={{ fontSize: '0.6rem', letterSpacing: 1, fontWeight: 700 }}>
                    <i className={`bi ${group.icon}`}></i>{group.label}
                    <span className="ms-auto" style={{ fontWeight: 600 }}>{group.items.length}</span>
                  </div>
                  {group.items.map((tab) => {
                    const count = menuCounts[tab.id];
                    const isActive = activeTab === tab.id;
                    return (
                      <button key={tab.id} type="button"
                        className={`list-group-item list-group-item-action border-0 d-flex align-items-center gap-2 py-2 px-3 chart-menu-item ${isActive ? 'active' : ''}`}
                        style={{
                          borderLeft: `4px solid ${isActive ? tab.color : 'transparent'}`,
                          background: isActive ? `${tab.color}2e` : 'transparent',
                        }}
                        aria-current={isActive ? 'true' : undefined}
                        onClick={() => setActiveTab(tab.id)}>
                        <div className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                          style={{ width: '32px', height: '32px', backgroundColor: isActive ? tab.color : `${tab.color}18` }}>
                          <i className={`bi ${tab.icon}`} style={{ color: isActive ? '#fff' : tab.color, fontSize: '0.85rem' }}></i>
                        </div>
                        <span className="small text-truncate"
                          style={{ color: isActive ? tab.color : '#212529', fontWeight: isActive ? 700 : 600 }}>
                          {tab.label}
                        </span>
                        {count && count.n > 0 ? (
                          <span className="badge rounded-pill ms-auto" title={`${count.n} ${count.title}`}
                            style={{ backgroundColor: `${count.tone}22`, color: count.tone, fontWeight: 700, fontSize: '0.65rem' }}>
                            {count.n}
                          </span>
                        ) : isActive ? (
                          <i className="bi bi-chevron-right ms-auto" style={{ color: tab.color }}></i>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="col-lg-9">
          <div className="card border-0 shadow-sm" style={{ borderRadius: '20px', minHeight: '500px', overflow: 'hidden' }}>
            <div style={{ height: '6px', background: `linear-gradient(90deg, ${theme.accent}, ${theme.ring})`, transition: 'background .4s ease' }} />
            <div className="card-body p-4 chart-panel-enter" key={activeTab} style={{ boxShadow: `inset 0 0 0 1px ${theme.ring}`, transition: 'box-shadow .32s ease' }}>
              {activeTab === 'summary' && <SummaryTab patient={patient} patientId={String(patient.pid)} patientName={formatPatientName(patient)} allergies={allergies || []} allergiesEnriched={enrichedAllergies || []} medications={medications || []} conditions={conditions || []} vitals={vitals || []} notes={notes || []} labOrders={labOrders || []} labResults={labResults || []} onViewTrend={() => setActiveTab('vitals')} />}
              {activeTab === 'observations' && <ObservationsTab patientId={String(patient.pid)} patientName={formatPatientName(patient)} readOnly={!canRecordObservations(user?.role)} role={user?.role} />}
              {activeTab === 'notes' && <NotesTab patientId={String(patient.pid)} patientName={formatPatientName(patient)} patientAge={age} conditions={conditions || []} medications={medications || []} allergies={allergies || []} />}
              {activeTab === 'demographics' && <DemographicsTab patient={patient} />}
              {activeTab === 'vitals' && <VitalsTab vitals={vitals || []} patientId={String(patient.pid)} readOnly={!canRecordVitals(user?.role)} role={user?.role} />}
              {activeTab === 'maternity' && maternity.applicable && <MaternityTab pid={String(patient.pid)} />}
              {activeTab === 'triage' && <EmergencyTab pid={String(patient.pid)} />}
              {activeTab === 'maternity' && !maternity.applicable && (
                <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
                  <div className="card-body text-center py-5">
                    <i className="bi bi-clipboard-x fs-1 d-block mb-3 text-muted opacity-50"></i>
                    <h6 className="fw-bold mb-2">Maternity does not apply to this patient</h6>
                    <p className="text-muted small mb-3">{maternity.reason}</p>
                    <button className="btn btn-sm btn-outline-primary rounded-pill" onClick={() => setActiveTab('summary')}>
                      <i className="bi bi-arrow-left me-1"></i>Back to overview
                    </button>
                  </div>
                </div>
              )}
              {activeTab === 'allergies' && <AllergiesTab patientId={String(patient.pid)} allergies={allergies || []} enriched={enrichedAllergies || []} readOnly={!canManageChartRecords(user?.role)} />}
              {activeTab === 'medications' && <MedicationsTab patientId={String(patient.pid)} medications={medications || []} allergies={allergies || []} conditions={conditions || []} readOnly={!canManageChartRecords(user?.role)} />}
              {activeTab === 'conditions' && <ConditionsTab patientId={String(patient.pid)} conditions={conditions || []} readOnly={!canManageChartRecords(user?.role)} />}
              {activeTab === 'immunizations' && <ImmunizationsTab patientId={String(patient.pid)} immunizations={immunizations || []} readOnly={!canManageChartRecords(user?.role)} />}
              {activeTab === 'insurance' && <InsuranceTab insurance={insurance || []} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
