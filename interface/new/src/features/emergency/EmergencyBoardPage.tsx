import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import nestClient from '../../api/nest-client';
import { useAuth } from '../../hooks/useAuth';
import { formatDateTime } from '../../utils/date';
import { patientChartPath } from '../../utils/patientChart';
import { levelMeta, orderVisits, waitClock } from '../../utils/triage';
import RegisterPatientModal from '../patients/components/RegisterPatientModal';
import { LevelBadge, TriageLegend } from './components/LevelBadge';
import { EMPTY_OBSERVATIONS, ObservationFields, ObservationValues, observationCompleteness, observationPayload } from './components/ObservationFields';
import {
  describeEmergencyError,
  escalateOverdueNow,
  getEmergencyBoard,
  getEmergencyEscalations,
  getEmergencyStats,
  previewTriage,
  reassessVisit,
  startTriage,
  updateVisitStatus,
} from '../../api/endpoints/emergency';

/**
 * The emergency department board.
 *
 * Read this as a worklist, not a report: it is ordered so the sickest and the
 * most overdue are at the top, every patient carries their triage colour from
 * across the room, and the reason behind each level is one click away. The
 * waiting clocks run locally between refetches so a stale page cannot make a
 * patient look like they just arrived.
 */

/** How often the board re-reads the department. */
const REFRESH_MS = 20000;

const CLOSE_ACTIONS: { status: string; label: string; icon: string; disposition: string; tone: string }[] = [
  { status: 'admitted', label: 'Admit', icon: 'bi-hospital', disposition: 'Admitted to ward', tone: 'outline-primary' },
  { status: 'discharged', label: 'Discharge', icon: 'bi-box-arrow-right', disposition: 'Discharged home', tone: 'outline-success' },
  { status: 'transferred', label: 'Transfer', icon: 'bi-arrow-left-right', disposition: 'Transferred to another facility', tone: 'outline-secondary' },
  { status: 'lwbs', label: 'Left before seen', icon: 'bi-person-walking', disposition: 'Left without being seen', tone: 'outline-danger' },
];

export default function EmergencyBoardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const role = user?.role || '';
  const canTriage = ['admin', 'physician', 'nurse', 'midwife', 'front_desk'].includes(role);
  const canDispose = ['admin', 'physician', 'nurse', 'midwife'].includes(role);
  const canEscalate = ['admin', 'physician'].includes(role);

  const [tab, setTab] = useState<'board' | 'metrics'>('board');
  const [openVisit, setOpenVisit] = useState<number | null>(null);
  const [reassessFor, setReassessFor] = useState<any | null>(null);
  const [, setTick] = useState(0);
  const [notice, setNotice] = useState<{ tone: string; text: string } | null>(null);

  // ── New arrival form ─────────────────────────────────────────
  const [findQuery, setFindQuery] = useState('');
  const [chosen, setChosen] = useState<any | null>(null);
  /**
   * A walk-in who is not on file yet. Registration happens here, in the standard
   * two-step form, so the patient is a normal record the moment they exist —
   * visible to the register and the nurse dashboard — rather than a parallel
   * "emergency only" kind of patient.
   */
  const [registerOpen, setRegisterOpen] = useState(false);
  const [complaint, setComplaint] = useState('');
  const [arrivalMode, setArrivalMode] = useState('walk-in');
  const [observations, setObservations] = useState<ObservationValues>({ ...EMPTY_OBSERVATIONS });
  const [resources, setResources] = useState('');
  const [gestation, setGestation] = useState('');
  const [flags, setFlags] = useState({ pregnant: false, immunocompromised: false, anticoagulated: false, sickleCell: false });
  const [saveToChart, setSaveToChart] = useState(true);
  const [suggestion, setSuggestion] = useState<any | null>(null);
  const [reassessObs, setReassessObs] = useState<ObservationValues>({ ...EMPTY_OBSERVATIONS });
  const [reassessNote, setReassessNote] = useState('');

  // Waiting clocks tick locally so the board does not freeze between refetches.
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 20000);
    return () => clearInterval(timer);
  }, []);

  const { data: board, isLoading } = useQuery({
    queryKey: ['emergency-board'],
    queryFn: getEmergencyBoard,
    refetchInterval: REFRESH_MS,
  });

  const { data: stats, isLoading: statsLoading, isError: statsFailed, error: statsError } = useQuery({
    queryKey: ['emergency-stats'],
    queryFn: () => getEmergencyStats(7),
    enabled: tab === 'metrics',
    // A rejected request will not succeed on a retry loop; the panel offers one.
    retry: false,
  });

  const { data: escalations = [], error: escalationsError } = useQuery({
    queryKey: ['emergency-escalations'],
    queryFn: () => getEmergencyEscalations(15),
    enabled: tab === 'metrics',
    retry: false,
  });

  const { data: searchResults = [] } = useQuery({
    queryKey: ['emergency-patient-search', findQuery],
    queryFn: async () => {
      const r = await nestClient.get('/patients', { params: { search: findQuery, limit: 8 } });
      return r.data;
    },
    enabled: findQuery.trim().length >= 2,
  });

  /**
   * Arriving from the patient register or the screening page with `?chart=` — the
   * value is the patient **chart id**, because `/patients/:id` resolves the
   * primary key first (`id` and `pid` are different columns on this schema), and
   * carrying a pid here would preselect the neighbouring patient.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const preselectedChartId = searchParams.get('chart');

  useEffect(() => {
    if (!preselectedChartId || chosen) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await nestClient.get(`/patients/${preselectedChartId}`);
        if (!cancelled && r.data) setChosen(r.data);
      } catch {
        if (!cancelled) say('warning', `Could not load patient ${preselectedChartId}.`);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectedChartId]);

  const clearPreselection = () => {
    if (searchParams.has('chart')) {
      const next = new URLSearchParams(searchParams);
      next.delete('chart');
      setSearchParams(next, { replace: true });
    }
  };

  /**
   * A patient registered from the emergency window: load the row the API just
   * created and point the triage form at it, so the nurse goes straight on to
   * observations and a level. The chart exists from this moment — the link in the
   * triage panel opens it before triage is even finished.
   */
  const handleRegistered = async (result: { id: number; pid: number; publicId: string }) => {
    setRegisterOpen(false);
    try {
      const r = await nestClient.get(`/patients/${result.id}`);
      setChosen(r.data);
      say('success', `${r.data.fname} ${r.data.lname} registered — chart ${result.publicId}. Record observations and triage.`);
    } catch {
      say('warning', `Registered as chart ${result.publicId}, but the record could not be re-read. Search for the name to triage.`);
    }
    // The register and the nurse dashboard both read patient lists.
    queryClient.invalidateQueries({ queryKey: ['patients'] });
    refresh();
  };

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['emergency-board'] });
    queryClient.invalidateQueries({ queryKey: ['emergency-stats'] });
    queryClient.invalidateQueries({ queryKey: ['emergency-escalations'] });
  };

  const say = (tone: string, text: string) => {
    setNotice({ tone, text });
    setTimeout(() => setNotice(null), 7000);
  };

  /** Everything the triage form has said about this patient. */
  const triageBody = () => ({
    chiefComplaint: complaint,
    mode: arrivalMode,
    vitals: observationPayload(observations),
    resources: resources === '' ? null : Number(resources),
    painScore: observations.painScore === '' ? null : Number(observations.painScore),
    pregnant: flags.pregnant,
    gestationalWeeks: gestation === '' ? null : Number(gestation),
    immunocompromised: flags.immunocompromised,
    anticoagulated: flags.anticoagulated,
    sickleCell: flags.sickleCell,
    saveVitals: saveToChart,
  });

  // ── Mutations ────────────────────────────────────────────────

  const preview = useMutation({
    mutationFn: () => previewTriage(chosen!.pid, triageBody()),
    onSuccess: (data) => setSuggestion(data),
    onError: () => say('danger', 'Could not score this presentation.'),
  });

  const recordArrival = useMutation({
    mutationFn: () => startTriage(chosen!.pid, triageBody()),
    onSuccess: (visit: any) => {
      say(
        visit.level <= 2 ? 'danger' : 'success',
        `${visit.patientName}: level ${visit.level} ${visit.label} — seen within ${visit.targetMinutes === 0 ? 'now' : `${visit.targetMinutes} min`}.` +
          (visit.assignment?.assignedNurseName ? ` Assigned to ${visit.assignment.assignedNurseName}.` : ''),
      );
      setChosen(null);
      setFindQuery('');
      clearPreselection();
      setComplaint('');
      setObservations({ ...EMPTY_OBSERVATIONS });
      setResources('');
      setGestation('');
      setFlags({ pregnant: false, immunocompromised: false, anticoagulated: false, sickleCell: false });
      setSuggestion(null);
      setOpenVisit(visit.id);
      refresh();
    },
    onError: (err: any) => say('danger', err?.response?.data?.message || 'Could not record the arrival.'),
  });

  const reassess = useMutation({
    mutationFn: () =>
      reassessVisit(reassessFor.id, {
        vitals: observationPayload(reassessObs),
        painScore: reassessObs.painScore === '' ? null : Number(reassessObs.painScore),
        note: reassessNote || undefined,
        overrideReason: reassessNote || undefined,
        saveVitals: saveToChart,
      }),
    onSuccess: (visit: any) => {
      const r = visit.reassessment || {};
      const moved = r.levelBefore !== r.levelAfter;
      say(
        moved && r.deEscalated ? 'warning' : moved ? 'danger' : 'success',
        moved
          ? `${visit.patientName}: level ${r.levelBefore} → ${r.levelAfter}${r.escalatedForDelay ? ' (raised by the waiting-time check)' : ''}.`
          : `${visit.patientName}: level unchanged at ${r.levelAfter}.`,
      );
      setReassessFor(null);
      setReassessObs({ ...EMPTY_OBSERVATIONS });
      setReassessNote('');
      refresh();
    },
    onError: (err: any) => say('warning', err?.response?.data?.message || 'Could not record the reassessment.'),
  });

  const moveVisit = useMutation({
    mutationFn: ({ id, status, disposition, room }: { id: number; status: string; disposition?: string; room?: string }) =>
      updateVisitStatus(id, { status, disposition, room }),
    onSuccess: (visit: any) => {
      say('success', `${visit.patientName} → ${visit.status}${visit.disposition ? ` (${visit.disposition})` : ''}`);
      refresh();
    },
    onError: () => say('danger', 'Could not move this patient along.'),
  });

  const escalateNow = useMutation({
    mutationFn: escalateOverdueNow,
    onSuccess: (res: any) => {
      const list = res?.escalated || [];
      say(
        list.length ? 'warning' : 'success',
        list.length
          ? `${list.length} patient${list.length === 1 ? '' : 's'} escalated for waiting too long.`
          : 'Everyone is inside their target.',
      );
      refresh();
    },
    onError: () => say('danger', 'Could not run the escalation check.'),
  });

  /**
   * Waiting time measured from the last fetch plus the time since — so the
   * clocks keep moving on a page that has not refetched yet.
   */
  const liveWait = (visit: any) => {
    const generatedAt = board?.generatedAt ? new Date(board.generatedAt).getTime() : Date.now();
    const elapsedSinceFetch = Math.max(0, Math.floor((Date.now() - generatedAt) / 60000));
    return visit.waitMinutes + elapsedSinceFetch;
  };

  const visits = useMemo(
    () => orderVisits((board?.visits || []).map((v: any) => ({ ...v, waitMinutes: liveWait(v) }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [board],
  );

  const counts = board?.counts || {};
  const completeness = observationCompleteness(observations);


  return (
    <div className="p-3" style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f8fafc 0%, #eef6ff 55%, #f2fbf7 100%)' }}>
      {/* Header */}
      <div className="d-flex flex-wrap justify-content-between align-items-start gap-3 mb-3">
        <div>
          <h4 className="fw-bold mb-1"><i className="bi bi-heart-pulse-fill me-2 text-danger"></i>Emergency Department</h4>
          <div className="d-flex flex-wrap align-items-center gap-3">
            <TriageLegend />
            <span className="text-muted small">{board?.generatedAt ? `updated ${formatDateTime(board.generatedAt)}` : 'loading…'}</span>
          </div>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <div className="btn-group">
            <button className={`btn btn-sm ${tab === 'board' ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setTab('board')}>
              <i className="bi bi-list-ul me-1"></i>Board
            </button>
            <button className={`btn btn-sm ${tab === 'metrics' ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setTab('metrics')}>
              <i className="bi bi-graph-up me-1"></i>Metrics
            </button>
          </div>
          <button className="btn btn-sm btn-outline-secondary" onClick={refresh}>
            <i className="bi bi-arrow-clockwise me-1"></i>Refresh
          </button>
          {canEscalate && (
            <button className="btn btn-sm btn-outline-warning" onClick={() => escalateNow.mutate()} disabled={escalateNow.isPending}
              title="Escalate anyone past their target now, instead of waiting for the scheduled check">
              <i className="bi bi-lightning-charge me-1"></i>Check breaches
            </button>
          )}
        </div>
      </div>

      {notice && (
        <div className={`alert alert-${notice.tone} py-2 d-flex align-items-center gap-2`} role="alert">
          <i className="bi bi-info-circle"></i>
          <span className="small">{notice.text}</span>
        </div>
      )}

      {/* Counts */}
      <div className="row g-2 mb-3">
        {[
          { v: counts.active ?? 0, l: 'In department', c: '#0d6efd', i: 'bi-people-fill' },
          { v: counts.waiting ?? 0, l: 'Waiting', c: '#6f42c1', i: 'bi-hourglass' },
          { v: counts.breached ?? 0, l: 'Past target', c: '#dc3545', i: 'bi-exclamation-octagon' },
          { v: counts.reassessOverdue ?? 0, l: 'Reassessment due', c: '#fd7e14', i: 'bi-arrow-repeat' },
          { v: counts.needsVitals ?? 0, l: 'Observations missing', c: '#198754', i: 'bi-thermometer-half' },
          { v: counts.awaitingFirstReview ?? 0, l: 'Not yet seen', c: '#6c757d', i: 'bi-person-dash' },
        ].map((card) => (
          <div className="col-6 col-md-4 col-lg-2" key={card.l}>
            <div className="card border-0 shadow-sm h-100">
              <div className="card-body py-2 px-3 d-flex align-items-center gap-2">
                <i className={`bi ${card.i}`} style={{ color: card.c, fontSize: '1.1rem' }}></i>
                <div>
                  <div className="fw-bold" style={{ color: card.c, lineHeight: 1.1 }}>{card.v}</div>
                  <small className="text-muted" style={{ fontSize: '0.7rem' }}>{card.l}</small>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>


      {tab === 'metrics' ? (
        <MetricsPanel
          stats={stats}
          escalations={escalations}
          isLoading={statsLoading}
          error={statsFailed ? statsError : null}
          escalationsError={escalationsError}
          onRetry={() => {
            queryClient.invalidateQueries({ queryKey: ['emergency-stats'] });
            queryClient.invalidateQueries({ queryKey: ['emergency-escalations'] });
          }}
          role={role}
        />
      ) : (
        <div className="row g-3">
          {/* Queue */}
          <div className="col-lg-8">
            <div className="card border-0 shadow-sm">
              <div className="card-header bg-white d-flex justify-content-between align-items-center py-3">
                <div className="d-flex align-items-center gap-2">
                  <span className="fw-semibold">Waiting room</span>
                  <span className="badge bg-primary rounded-pill">{visits.length}</span>
                </div>
                <small className="text-muted">sickest first, then longest past their target</small>
              </div>
              <div className="card-body p-0">
                {isLoading && (
                  <div className="text-center text-muted py-5">
                    <span className="spinner-border spinner-border-sm me-2"></span>Loading the department…
                  </div>
                )}
                {!isLoading && visits.length === 0 && (
                  <div className="text-center text-muted py-5">
                    <i className="bi bi-clipboard2-check fs-1 d-block mb-2 opacity-50"></i>
                    <p className="mb-0">The department is empty.</p>
                    <small>Record an arrival from the panel on the right.</small>
                  </div>
                )}
                {visits.map((visit: any) => {
                  const clock = waitClock(visit);
                  const meta = levelMeta(visit.level);
                  const expanded = openVisit === visit.id;
                  const chartHref = patientChartPath(visit.patientId, visit.pid, visit.pid);
                  return (
                    <div key={visit.id} className="border-bottom" style={{ borderLeft: `6px solid ${meta.color}` }}>
                      <div className="d-flex align-items-start gap-3 px-3 py-3" style={{ cursor: 'pointer' }}
                        onClick={() => setOpenVisit(expanded ? null : visit.id)}>
                        <LevelBadge level={visit.level} size="md" />
                        <div className="flex-grow-1 min-width-0">
                          <div className="d-flex flex-wrap align-items-center gap-2">
                            <strong>{visit.patientName || `PID ${visit.pid}`}</strong>
                            <small className="text-muted">
                              {visit.ageYears !== null && visit.ageYears !== undefined ? `${visit.ageYears}y` : 'age unknown'}
                              {visit.sex ? ` · ${visit.sex}` : ''}
                              {visit.room ? ` · ${visit.room}` : ''}
                            </small>
                            {visit.needsVitals && <span className="badge bg-success-subtle text-success">observations missing</span>}
                            {visit.escalatedLevel !== null && <span className="badge bg-danger-subtle text-danger">escalated for delay</span>}
                            {clock.reassessOverdue && <span className="badge bg-warning-subtle text-warning">reassess due</span>}
                          </div>
                          <div className="text-truncate small text-muted">{visit.chiefComplaint || 'no presenting complaint recorded'}</div>
                          <div className="d-flex flex-wrap align-items-center gap-2 mt-1">
                            <span className={`badge ${clock.breached ? 'bg-danger' : 'bg-light text-dark'}`}>
                              <i className="bi bi-clock me-1"></i>{clock.text}
                              {clock.breached
                                ? ` · ${clock.overByMinutes}m over the ${visit.targetMinutes}m target`
                                : ` of the ${visit.targetMinutes}m target`}
                            </span>
                            <span className="badge bg-light text-secondary">NEWS2 {visit.news2}</span>
                            <span className="badge bg-light text-secondary">priority {visit.priority}</span>
                            <span className="badge bg-light text-secondary">{visit.mode}</span>
                          </div>
                        </div>
                        <i className={`bi ${expanded ? 'bi-chevron-up' : 'bi-chevron-down'} text-muted`}></i>
                      </div>


                      {expanded && (
                        <div className="px-3 pb-3">
                          <div className="small text-muted mb-2">
                            <i className="bi bi-lightbulb me-1"></i>
                            {meta.meaning} · arrived {formatDateTime(visit.arrivedAt)}
                            {visit.doorToProviderMinutes !== null ? ` · seen after ${visit.doorToProviderMinutes}m` : ''}
                          </div>
                          {visit.reasons?.length > 0 && (
                            <ul className="small mb-2 ps-3">
                              {visit.reasons.map((reason: string, i: number) => <li key={i}>{reason}</li>)}
                            </ul>
                          )}
                          {visit.modifiers?.length > 0 && (
                            <div className="small mb-2"><span className="text-muted">Risk factors:</span> {visit.modifiers.join(', ')}</div>
                          )}
                          {visit.escalatedReason && (
                            <div className="alert alert-warning py-2 small mb-2">
                              <i className="bi bi-arrow-up-circle me-1"></i>{visit.escalatedReason}
                            </div>
                          )}
                          <div className="d-flex flex-wrap gap-2">
                            {canDispose && visit.status === 'waiting' && (
                              <button className="btn btn-sm btn-success" onClick={() => moveVisit.mutate({ id: visit.id, status: 'in_treatment' })}>
                                <i className="bi bi-play-fill me-1"></i>Start treatment
                              </button>
                            )}
                            {canDispose && (
                              <button className="btn btn-sm btn-outline-primary"
                                onClick={() => { setReassessFor(visit); setReassessObs({ ...EMPTY_OBSERVATIONS }); setReassessNote(''); }}>
                                <i className="bi bi-arrow-repeat me-1"></i>Reassess
                              </button>
                            )}
                            {canDispose && CLOSE_ACTIONS.map((action) => (
                              <button key={action.status} className={`btn btn-sm btn-${action.tone}`}
                                onClick={() => moveVisit.mutate({ id: visit.id, status: action.status, disposition: action.disposition })}>
                                <i className={`bi ${action.icon} me-1`}></i>{action.label}
                              </button>
                            ))}
                            {chartHref && (
                              <button className="btn btn-sm btn-outline-secondary" onClick={() => navigate(chartHref)}>
                                <i className="bi bi-person-vcard me-1"></i>Open chart
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>


          {/* Arrival + triage */}
          <div className="col-lg-4">
            <div className="card border-0 shadow-sm mb-3">
              <div className="card-header bg-white py-3">
                <span className="fw-semibold"><i className="bi bi-person-plus me-1"></i>Record an arrival</span>
              </div>
              <div className="card-body">
                {!canTriage ? (
                  <p className="text-muted small mb-0">Your role cannot triage patients.</p>
                ) : !chosen ? (
                  <>
                    <input className="form-control form-control-sm mb-2" placeholder="Search the patient by name, ID or phone…"
                      value={findQuery} onChange={(e) => setFindQuery(e.target.value)} />
                    {findQuery.trim().length >= 2 && (
                      <div className="border rounded-3" style={{ maxHeight: '220px', overflowY: 'auto' }}>
                        {searchResults.length === 0 && <div className="text-muted small p-2">No patient matches “{findQuery}”.</div>}
                        {searchResults.map((p: any) => (
                          <button key={p.id} type="button" className="btn btn-link text-decoration-none text-start w-100 border-bottom py-2 px-3"
                            onClick={() => setChosen(p)}>
                            <span className="fw-semibold small">{p.lname}, {p.fname}</span>
                            <span className="text-muted small ms-2">
                              {p.DOB ? `DOB ${String(p.DOB).slice(0, 10)}` : ''}{p.sex ? ` · ${p.sex}` : ''}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                    <small className="text-muted d-block mt-2">
                      Search the existing register — an attendance is filed against a real chart, never a placeholder, so it
                      can be found again.
                    </small>
                    <div className="d-flex align-items-center gap-2 mt-2 pt-2 border-top">
                      <span className="small text-muted">Not registered here yet?</span>
                      <button className="btn btn-sm btn-outline-success rounded-pill ms-auto" onClick={() => setRegisterOpen(true)}>
                        <i className="bi bi-person-plus me-1"></i>Register the patient
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="alert alert-primary py-2 d-flex align-items-center gap-2">
                      <i className="bi bi-person-check-fill"></i>
                      <span className="small">
                        Triaging <strong>{chosen.fname} {chosen.lname}</strong>
                        <span className="text-muted"> · pid {chosen.pid}</span>
                        {chosen.public_id && <span className="text-muted"> · chart {chosen.public_id}</span>}
                      </span>
                      {(() => {
                        const href = patientChartPath(chosen.id, chosen.pid);
                        if (!href) return null;
                        return (
                          <button className="btn btn-sm btn-outline-primary rounded-pill ms-auto"
                            title="Open the chart in a new view — it exists from the moment the patient is registered"
                            onClick={() => navigate(href)}>
                            <i className="bi bi-person-vcard me-1"></i>Chart
                          </button>
                        );
                      })()}
                      <button className="btn btn-sm btn-outline-secondary rounded-pill"
                        onClick={() => { setChosen(null); setSuggestion(null); clearPreselection(); }}>Change</button>
                    </div>

                    <div className="row g-2 mb-2">
                      <div className="col-7">
                        <label className="form-label small mb-1">Presenting complaint</label>
                        <input className="form-control form-control-sm" value={complaint} placeholder="e.g. chest pain since this morning"
                          onChange={(e) => setComplaint(e.target.value)} />
                      </div>
                      <div className="col-5">
                        <label className="form-label small mb-1">Arrived by</label>
                        <select className="form-select form-select-sm" value={arrivalMode} onChange={(e) => setArrivalMode(e.target.value)}>
                          {['walk-in', 'ambulance', 'referral', 'police', 'transfer'].map((m) => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </div>
                    </div>

                    <label className="form-label small mb-1">Observations</label>
                    <ObservationFields values={observations} onChange={setObservations} disabled={recordArrival.isPending} />


                    <div className="row g-2 mt-2">
                      <div className="col-6">
                        <label className="form-label small mb-1">Resources expected</label>
                        <select className="form-select form-select-sm" value={resources} onChange={(e) => setResources(e.target.value)}>
                          <option value="">Not assessed</option>
                          <option value="0">None</option>
                          <option value="1">One (X-ray, sutures…)</option>
                          <option value="2">Two</option>
                          <option value="3">Three or more</option>
                        </select>
                      </div>
                      <div className="col-6">
                        <label className="form-label small mb-1">Gestation (if pregnant)</label>
                        <input type="number" className="form-control form-control-sm" value={gestation} placeholder="weeks"
                          onChange={(e) => setGestation(e.target.value)} disabled={!flags.pregnant} />
                      </div>
                    </div>

                    <div className="d-flex flex-wrap gap-3 mt-2">
                      {([
                        ['pregnant', 'Pregnant'],
                        ['immunocompromised', 'Immunocompromised'],
                        ['anticoagulated', 'Anticoagulated'],
                        ['sickleCell', 'Sickle cell'],
                      ] as const).map(([key, label]) => (
                        <div className="form-check form-switch" key={key}>
                          <input className="form-check-input" type="checkbox" id={`ed-flag-${key}`}
                            checked={flags[key]} onChange={(e) => setFlags({ ...flags, [key]: e.target.checked })} />
                          <label className="form-check-label small" htmlFor={`ed-flag-${key}`}>{label}</label>
                        </div>
                      ))}
                    </div>

                    <div className="form-check form-switch mt-2">
                      <input className="form-check-input" type="checkbox" id="ed-save-vitals" checked={saveToChart}
                        onChange={(e) => setSaveToChart(e.target.checked)} />
                      <label className="form-check-label small" htmlFor="ed-save-vitals">
                        Save these observations to the chart's vitals
                      </label>
                    </div>

                    {suggestion && (
                      <div className="border rounded-3 p-2 mt-3" style={{ borderLeft: `6px solid ${suggestion.assessment.color}` }}>
                        <div className="d-flex align-items-center gap-2 mb-1">
                          <LevelBadge level={suggestion.assessment.level} />
                          <span className="small text-muted">
                            see within {suggestion.assessment.targetMinutes === 0 ? 'now' : `${suggestion.assessment.targetMinutes} min`}
                          </span>
                        </div>
                        <ul className="small mb-1 ps-3">
                          {suggestion.assessment.reasons.map((reason: string, i: number) => <li key={i}>{reason}</li>)}
                        </ul>
                        {suggestion.assessment.modifiers?.length > 0 && (
                          <div className="small text-muted">Factors: {suggestion.assessment.modifiers.join(', ')}</div>
                        )}
                        {suggestion.band?.abnormal?.length > 0 && (
                          <div className="small mt-1" style={{ color: '#dc3545' }}>
                            <i className="bi bi-activity me-1"></i>{suggestion.band.abnormal.join('; ')}
                          </div>
                        )}
                        {suggestion.band?.reassuringForAge?.length > 0 && (
                          <div className="small mt-1 text-muted">
                            <i className="bi bi-info-circle me-1"></i>{suggestion.band.reassuringForAge.join('; ')}
                          </div>
                        )}
                        <div className="small text-muted mt-1">
                          <i className="bi bi-shield-check me-1"></i>Advisory only — you assign the final level.
                        </div>
                      </div>
                    )}

                    <div className="d-flex gap-2 mt-3">
                      <button className="btn btn-sm btn-outline-primary" onClick={() => preview.mutate()}
                        disabled={preview.isPending || !complaint.trim()}>
                        {preview.isPending
                          ? <span className="spinner-border spinner-border-sm me-1"></span>
                          : <i className="bi bi-calculator me-1"></i>}
                        Preview level
                      </button>
                      <button className="btn btn-sm btn-danger" onClick={() => recordArrival.mutate()} disabled={recordArrival.isPending}>
                        {recordArrival.isPending
                          ? <span className="spinner-border spinner-border-sm me-1"></span>
                          : <i className="bi bi-check2-circle me-1"></i>}
                        Record &amp; triage
                      </button>
                    </div>
                    {!completeness.complete && (
                      <div className="small text-muted mt-2">
                        <i className="bi bi-info-circle me-1"></i>
                        Without the full observation set the level floors at Yellow — that is the rule, not a bug.
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>


            {/* Reassessment — inline rather than a modal: on a board it is a
                two-second job and a dialog gets in the way of the queue. */}
            {reassessFor && (
              <div className="card border-0 shadow-sm mb-3">
                <div className="card-header bg-white py-3 d-flex justify-content-between align-items-center">
                  <span className="fw-semibold"><i className="bi bi-arrow-repeat me-1"></i>Reassess {reassessFor.patientName}</span>
                  <button className="btn btn-sm btn-light" onClick={() => setReassessFor(null)}><i className="bi bi-x-lg"></i></button>
                </div>
                <div className="card-body">
                  <ObservationFields values={reassessObs} onChange={setReassessObs} disabled={reassess.isPending} />
                  <div className="mt-2">
                    <label className="form-label small mb-1">
                      Clinical reason <span className="text-muted">(required to lower the level)</span>
                    </label>
                    <input className="form-control form-control-sm" value={reassessNote} onChange={(e) => setReassessNote(e.target.value)}
                      placeholder="e.g. findings explained by viral illness, safe to de-escalate" />
                  </div>
                  <div className="d-flex gap-2 mt-3">
                    <button className="btn btn-sm btn-primary" onClick={() => reassess.mutate()} disabled={reassess.isPending}>
                      {reassess.isPending
                        ? <span className="spinner-border spinner-border-sm me-1"></span>
                        : <i className="bi bi-save me-1"></i>}
                      Save reassessment
                    </button>
                    <small className="text-muted align-self-center">Worse observations escalate automatically.</small>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/*
        The standard registration flow, used from the emergency window. The
        patient it creates is an ordinary active record — so it appears in the
        register and on the nurse dashboard immediately — with `status: 'active'`
        passed explicitly, because the nurse dashboard only lists active patients
        and an emergency arrival cannot wait in an approval queue.
      */}
      <RegisterPatientModal
        open={registerOpen}
        onClose={() => setRegisterOpen(false)}
        onRegistered={handleRegistered}
        status="active"
        title="Register an emergency patient"
        submitLabel="Register & triage"
        headerNote={
          <p className="text-muted small mb-0 mt-1">
            <i className="bi bi-info-circle me-1"></i>
            This creates a normal patient record and chart. Record observations and the triage level next.
          </p>
        }
      />
    </div>
  );
}

/**
 * Throughput and the escalation audit. Kept in this file because it is the same
 * screen's second tab, not a separate workflow.
 *
 * It distinguishes three things the old version did not: still loading, failed,
 * and genuinely empty. Treating every non-answer as "loading" is what produced an
 * endless spinner whenever the request was rejected.
 */
function MetricsPanel({
  stats,
  escalations,
  isLoading,
  error,
  escalationsError,
  onRetry,
  role,
}: {
  stats: any;
  escalations: any[];
  isLoading: boolean;
  error: any;
  escalationsError: any;
  onRetry: () => void;
  role?: string;
}) {
  if (error && !stats) {
    const state = describeEmergencyError(error);
    return (
      <div className="card border-0 shadow-sm">
        <div className="card-body text-center py-5">
          <i className="bi bi-bar-chart-line fs-1 d-block mb-3 text-muted opacity-50"></i>
          <h6 className="fw-bold mb-2">{state.title}</h6>
          <p className="text-muted small mb-3" style={{ maxWidth: '520px', margin: '0 auto' }}>{state.detail}</p>
          {state.canRetry ? (
            <button className="btn btn-sm btn-outline-primary rounded-pill" onClick={onRetry}>
              <i className="bi bi-arrow-clockwise me-1"></i>Try again
            </button>
          ) : (
            <button className="btn btn-sm btn-outline-secondary rounded-pill" onClick={() => window.location.reload()}>
              <i className="bi bi-arrow-clockwise me-1"></i>Reload the page
            </button>
          )}
          <div className="text-muted mt-3" style={{ fontSize: '0.72rem' }}>
            {role ? `Signed in as ${role}` : ''}{state.status ? ` · HTTP ${state.status}` : ''}
          </div>
        </div>
      </div>
    );
  }

  if (isLoading && !stats) {
    return (
      <div className="text-center text-muted py-5">
        <span className="spinner-border spinner-border-sm me-2"></span>Loading departmental metrics…
      </div>
    );
  }

  if (!stats) {
    // Loading finished, no error, still nothing: the request simply returned empty.
    return (
      <div className="card border-0 shadow-sm">
        <div className="card-body text-center py-5">
          <i className="bi bi-inbox fs-1 d-block mb-3 text-muted opacity-50"></i>
          <h6 className="fw-bold mb-2">No metrics to show</h6>
          <p className="text-muted small mb-3">The server returned no figures for this window.</p>
          <button className="btn btn-sm btn-outline-primary rounded-pill" onClick={onRetry}>
            <i className="bi bi-arrow-clockwise me-1"></i>Try again
          </button>
        </div>
      </div>
    );
  }

  const minutes = (value: number | null) => (value === null || value === undefined ? '—' : `${value} min`);

  return (
    <>
      <div className="row g-3 mb-3">
        {[
          { l: 'Attendances', v: stats.attendances, s: `last ${stats.windowDays} days`, c: '#0d6efd' },
          { l: 'Door to triage', v: minutes(stats.doorToTriageMinutes), s: 'average', c: '#6f42c1' },
          { l: 'Door to clinician', v: minutes(stats.doorToProviderMinutes), s: 'average', c: '#198754' },
          { l: 'Length of stay', v: minutes(stats.lengthOfStayMinutes), s: 'average', c: '#0dcaf0' },
          { l: 'Left without being seen', v: `${stats.lwbs} (${stats.lwbsRate}%)`, s: 'safety signal', c: '#dc3545' },
          { l: 'Escalated for delay', v: stats.escalated, s: 'waited past target', c: '#fd7e14' },
        ].map((card) => (
          <div className="col-6 col-lg-2" key={card.l}>
            <div className="card border-0 shadow-sm h-100">
              <div className="card-body py-3">
                <div className="fw-bold" style={{ color: card.c }}>{card.v}</div>
                <small className="text-muted d-block">{card.l}</small>
                <small className="text-muted" style={{ fontSize: '0.68rem' }}>{card.s}</small>
              </div>
            </div>
          </div>
        ))}
      </div>


      <div className="row g-3">
        <div className="col-lg-5">
          <div className="card border-0 shadow-sm h-100">
            <div className="card-header bg-white py-3"><span className="fw-semibold">Attendances by triage level</span></div>
            <div className="card-body p-0">
              <table className="table table-sm mb-0">
                <thead>
                  <tr className="text-muted small"><th>Level</th><th className="text-end">Patients</th><th className="text-end">Breached target</th></tr>
                </thead>
                <tbody>
                  {(stats.byLevel || []).map((row: any) => (
                    <tr key={row.level}>
                      <td><LevelBadge level={row.level} size="sm" /></td>
                      <td className="text-end">{row.count}</td>
                      <td className="text-end">
                        {row.breaches > 0
                          ? <span className="badge bg-danger">{row.breaches}</span>
                          : <span className="text-muted">0</span>}
                      </td>
                    </tr>
                  ))}
                  {(!stats.byLevel || stats.byLevel.length === 0) && (
                    <tr><td colSpan={3} className="text-center text-muted small py-3">No attendances in this window.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="col-lg-3">
          <div className="card border-0 shadow-sm h-100">
            <div className="card-header bg-white py-3"><span className="fw-semibold">Outcomes</span></div>
            <div className="card-body p-0">
              <table className="table table-sm mb-0">
                <tbody>
                  {(stats.byDisposition || []).map((row: any) => (
                    <tr key={row.outcome}>
                      <td className="small">{row.outcome}</td>
                      <td className="text-end small fw-semibold">{row.count}</td>
                    </tr>
                  ))}
                  {(!stats.byDisposition || stats.byDisposition.length === 0) && (
                    <tr><td className="text-center text-muted small py-3">Nothing yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="col-lg-4">
          <div className="card border-0 shadow-sm h-100">
            <div className="card-header bg-white py-3 d-flex justify-content-between align-items-center">
              <span className="fw-semibold">Escalations</span>
              <small className="text-muted">
                {stats.reassessment
                  ? `${stats.reassessment.escalated} raised · ${stats.reassessment.deEscalated} lowered on reassessment`
                  : ''}
              </small>
            </div>
            <div className="card-body p-0" style={{ maxHeight: '320px', overflowY: 'auto' }}>
              {escalationsError && (
                <div className="small text-muted p-3">
                  <i className="bi bi-exclamation-circle me-1"></i>
                  {describeEmergencyError(escalationsError).title}.
                </div>
              )}
              {!escalationsError && escalations.length === 0 && (
                <div className="text-muted small p-3">No escalations in this window.</div>
              )}
              {escalations.map((entry: any) => (
                <div key={entry.id} className="border-bottom px-3 py-2">
                  <div className="d-flex align-items-center gap-2">
                    <LevelBadge level={entry.from} size="sm" showLabel={false} />
                    <i className="bi bi-arrow-right text-muted"></i>
                    <LevelBadge level={entry.to} size="sm" showLabel={false} />
                    <span className="small fw-semibold text-truncate">{entry.patientName}</span>
                  </div>
                  <div className="small text-muted">{entry.note}</div>
                  <div className="small text-muted" style={{ fontSize: '0.68rem' }}>
                    {formatDateTime(entry.at)} · {entry.by}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

