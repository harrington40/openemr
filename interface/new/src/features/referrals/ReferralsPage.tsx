import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import nestClient from '../../api/nest-client';
import { useDebounce } from '../../hooks/useDebounce';
import { formatPatientName } from '../../utils/patientName';
import { chartPatientId } from '../../utils/patientChart';
import { useInvalidateNotifications } from '../../hooks/useNotifications';

interface PatientHit {
  id: number;
  pid: number;
  fname: string;
  lname: string;
  DOB: string | null;
  sex: string | null;
  public_id?: string | null;
}

interface Suggestion {
  specialty: string;
  score: number;
  matchedKeywords: string[];
  providers: ProviderHit[];
}

interface ProviderHit {
  id: number;
  fname: string;
  lname: string;
  title?: string;
  specialty?: string;
}

const fmtDate = (d: string | null | undefined) => {
  if (!d) return '';
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

const urgencyBadge: Record<string, string> = {
  routine: 'bg-info',
  urgent: 'bg-danger',
  stat: 'bg-warning text-dark',
};

const urgencyColor: Record<string, string> = {
  routine: '#0dcaf0',
  urgent: '#dc3545',
  stat: '#ffc107',
};

export default function ReferralsPage() {
  const qc = useQueryClient();
  const [patientSearch, setPatientSearch] = useState('');
  const debouncedSearch = useDebounce(patientSearch, 300);
  const [selectedPatient, setSelectedPatient] = useState<PatientHit | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [specialistId, setSpecialistId] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [urgency, setUrgency] = useState('routine');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // Auto-load patients as the user types — click to pick.
  const { data: searchResults = [] } = useQuery<PatientHit[]>({
    queryKey: ['referral-patient-search', debouncedSearch],
    queryFn: async () => {
      if (!debouncedSearch.trim()) return [];
      const r = await nestClient.get('/patients', { params: { search: debouncedSearch, limit: 8 } });
      return r.data || [];
    },
    enabled: debouncedSearch.trim().length >= 1,
  });

  // Smart suggestion engine for the selected patient.
  const { data: suggest, isLoading: suggestLoading } = useQuery<any>({
    queryKey: ['referral-smart-suggest', selectedPatient?.pid],
    queryFn: async () => {
      const r = await nestClient.get(`/referrals/smart-suggest/${selectedPatient!.pid}`);
      return r.data;
    },
    enabled: !!selectedPatient?.pid,
  });

  // All providers for the manual picker fallback.
  const { data: allProviders = [] } = useQuery<ProviderHit[]>({
    queryKey: ['referral-providers'],
    queryFn: async () => {
      const r = await nestClient.get('/providers');
      return r.data || [];
    },
  });

  // Referral history (newest first).
  const { data: referrals = [] } = useQuery<any[]>({
    queryKey: ['referrals'],
    queryFn: async () => {
      const r = await nestClient.get('/referrals');
      return r.data || [];
    },
  });

  // Referrals sent to THIS provider by another provider and still pending —
  // this is what the inbound notification and the sidebar badge are built on.
  const { data: referralNotify } = useQuery<any>({
    queryKey: ['referral-notifications'],
    queryFn: async () => {
      const r = await nestClient.get('/referrals/notifications');
      return r.data || { pendingCount: 0, urgentCount: 0, referrals: [] };
    },
    refetchInterval: 20000,
  });
  const pendingReferrals: any[] = referralNotify?.referrals || [];
  const pendingCount: number = referralNotify?.pendingCount ?? pendingReferrals.length;
  const urgentCount: number = referralNotify?.urgentCount || 0;

  const [openReferral, setOpenReferral] = useState<any>(null);
  const [showAllPending, setShowAllPending] = useState(false);
  const invalidateNotifications = useInvalidateNotifications();
  const navigate = useNavigate();

  const ackReferral = useMutation({
    mutationFn: (d: { id: number; status?: string }) =>
      nestClient.post(`/referrals/${d.id}/ack`, { status: d.status || 'reviewed' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['referrals'] });
      qc.invalidateQueries({ queryKey: ['referral-notifications'] });
      invalidateNotifications();
      setOpenReferral(null);
    },
  });

  const openReferralChart = (r: any) => {
    const cid = chartPatientId(r.patientId, r.pid);
    if (cid) navigate(`/patients/${cid}`);
  };

  // Auto-populate reason + clinical notes (sorted by date) once the engine responds.
  useEffect(() => {
    if (!suggest) return;
    setReason(suggest.suggestedReason || '');
    const sections: string[] = [];
    if (suggest.conditions?.length) {
      sections.push(
        'ACTIVE CONDITIONS\n' +
          suggest.conditions
            .map((c: any) => `• ${c.diagnosis}${c.note ? ` — ${c.note}` : ''}${c.date ? ` (${fmtDate(c.date)})` : ''}`)
            .join('\n'),
      );
    }
    if (suggest.clinicalNotes?.length) {
      sections.push(
        'RECENT CLINICAL NOTES\n' +
          suggest.clinicalNotes
            .slice(0, 8)
            .map((n: any) => `• [${fmtDate(n.date)}] ${n.title || 'Note'}${n.body ? ` — ${n.body}` : ''}`)
            .join('\n'),
      );
    }
    setNotes(sections.join('\n\n') || '');
  }, [suggest]);

  const sendReferral = useMutation({
    mutationFn: (d: any) => nestClient.post('/referrals', d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['referrals'] });
      setSuccess(true);
      setSelectedPatient(null);
      setPatientSearch('');
      setSpecialistId('');
      setReason('');
      setNotes('');
      setUrgency('routine');
      setTimeout(() => setSuccess(false), 4000);
    },
    onError: (err: any) => {
      setError(err?.response?.data?.message || 'Could not send referral. Please try again.');
    },
  });

  const selectedSpecialistName = useMemo(() => {
    if (!specialistId) return '';
    const fromSuggest = (suggest?.suggestions || [])
      .flatMap((s: Suggestion) => s.providers)
      .find((p: ProviderHit) => String(p.id) === String(specialistId));
    if (fromSuggest) return `${fromSuggest.fname} ${fromSuggest.lname}`.trim();
    const fromAll = allProviders.find((p) => String(p.id) === String(specialistId));
    return fromAll ? `${fromAll.fname} ${fromAll.lname}`.trim() : '';
  }, [specialistId, suggest, allProviders]);

  const handleSend = () => {
    if (!selectedPatient) return;
    if (!reason.trim()) {
      setError('Please enter a reason for the referral.');
      return;
    }
    setError('');
    sendReferral.mutate({
      pid: selectedPatient.pid,
      specialistId: specialistId ? Number(specialistId) : undefined,
      reason,
      body: notes,
      urgency,
    });
  };

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
      <div className="rounded-4 p-4 mb-4 text-white" style={{ background: 'linear-gradient(135deg, #20c997 0%, #0d6efd 55%, #6610f2 100%)' }}>
        <h2 className="mb-1 fw-bold"><i className="bi bi-send me-2"></i>Smart Referrals</h2>
        <p className="mb-0 text-white text-opacity-75 small">
          <i className="bi bi-stars me-1"></i>AI-assisted specialist matching · patient notes auto-loaded
        </p>
      </div>

      {/* Inbound referrals from other providers — the notification surface */}
      {pendingReferrals.length > 0 && (
        <div className="card border-0 shadow-sm mb-4"
          style={{ borderRadius: '20px', borderLeft: '4px solid #dc3545', position: 'relative', zIndex: 1 }}>
          <div className="card-header bg-white d-flex justify-content-between align-items-center py-3" style={{ borderRadius: '20px 20px 0 0' }}>
            <h6 className="mb-0 fw-bold">
              <i className="bi bi-bell-fill me-2 text-danger"></i>Referrals for You
              <span className="badge bg-danger rounded-pill ms-2">{pendingCount}</span>
            </h6>
            {urgentCount > 0 && (
              <span className="badge bg-warning text-dark rounded-pill">{urgentCount} urgent</span>
            )}
          </div>
          <div className="card-body p-0">
            {(showAllPending ? pendingReferrals : pendingReferrals.slice(0, 3)).map((r: any) => (
              <div key={r.id} className="d-flex align-items-center gap-2 px-3 py-2 border-bottom"
                style={{ cursor: 'pointer' }} onClick={() => setOpenReferral(r)}>
                <div className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                  style={{ width: '32px', height: '32px', backgroundColor: `${urgencyColor[r.urgency] || '#0d6efd'}20` }}>
                  <i className={`bi ${r.urgency === 'stat' ? 'bi-exclamation-octagon-fill' : 'bi-send'} small`}
                    style={{ color: urgencyColor[r.urgency] || '#0d6efd' }}></i>
                </div>
                <div className="flex-grow-1 min-w-0">
                  <div className="fw-semibold small text-truncate">{r.patientName}</div>
                  <small className="text-muted d-block text-truncate" style={{ fontSize: '0.65rem' }}>{r.reason}</small>
                </div>
                <span className={`badge rounded-pill ${urgencyBadge[r.urgency] || 'bg-info'}`} style={{ fontSize: '0.6rem' }}>{r.urgency}</span>
                {r.referringProvider && (
                  <small className="text-muted d-none d-lg-block" style={{ fontSize: '0.6rem' }}>from {r.referringProvider}</small>
                )}
                <i className="bi bi-chevron-right text-muted small"></i>
              </div>
            ))}
          </div>
          {pendingReferrals.length > 3 && (
            <div className="card-footer bg-white py-2 text-center">
              <button className="btn btn-link btn-sm text-decoration-none" onClick={() => setShowAllPending((v) => !v)}>
                {showAllPending ? 'Show less' : `Show all ${pendingReferrals.length}`}
              </button>
            </div>
          )}
        </div>
      )}

      {success && (
        <div className="alert alert-success d-flex align-items-center gap-2">
          <i className="bi bi-check-circle-fill"></i> Referral sent successfully.
        </div>
      )}

      <div className="row g-3">
        {/* Left — create referral */}
        <div className="col-lg-7">
          <div className="card border-0 shadow-sm" style={{ borderRadius: '20px' }}>
            <div className="card-header bg-white py-3" style={{ borderRadius: '20px 20px 0 0' }}>
              <h6 className="mb-0 fw-bold"><i className="bi bi-send me-2 text-primary"></i>New Referral</h6>
            </div>
            <div className="card-body">
              {/* Patient picker */}
              <label className="form-label small fw-semibold">Patient</label>
              {selectedPatient ? (
                <div className="d-flex align-items-center gap-3 p-3 rounded-3 mb-3" style={{ background: '#f0fdfa', border: '1px solid #c6f6e5' }}>
                  <div className="rounded-circle bg-success bg-opacity-10 d-flex align-items-center justify-content-center flex-shrink-0"
                    style={{ width: '46px', height: '46px' }}>
                    <span className="fw-bold text-success">{selectedPatient.fname?.[0]}{selectedPatient.lname?.[0]}</span>
                  </div>
                  <div className="flex-grow-1">
                    <div className="fw-semibold">{formatPatientName(selectedPatient)}</div>
                    <small className="text-muted">PID #{selectedPatient.pid} · {fmtDate(selectedPatient.DOB)} · {selectedPatient.sex || '—'}</small>
                  </div>
                  <button className="btn btn-sm btn-outline-secondary rounded-pill" onClick={() => { setSelectedPatient(null); setPatientSearch(''); }}>
                    Change
                  </button>
                </div>
              ) : (
                <div className="position-relative mb-3">
                  <div className="input-group">
                    <span className="input-group-text bg-white"><i className="bi bi-search"></i></span>
                    <input
                      className="form-control"
                      placeholder="Search patient by name or ID…"
                      value={patientSearch}
                      onChange={(e) => { setPatientSearch(e.target.value); setShowDropdown(true); }}
                      onFocus={() => setShowDropdown(true)}
                    />
                  </div>
                  {showDropdown && debouncedSearch.trim().length >= 1 && (
                    <div className="list-group position-absolute w-100 shadow" style={{ zIndex: 20, borderRadius: '12px', overflow: 'hidden' }}>
                      {searchResults.map((p) => (
                        <button
                          key={p.pid}
                          type="button"
                          className="list-group-item list-group-item-action d-flex justify-content-between align-items-center"
                          onClick={() => { setSelectedPatient(p); setPatientSearch(''); setShowDropdown(false); }}
                        >
                          <span><strong>{formatPatientName(p)}</strong> <span className="text-muted">(PID {p.pid})</span></span>
                          <small className="text-muted">{fmtDate(p.DOB)}</small>
                        </button>
                      ))}
                      {!searchResults.length && <div className="list-group-item text-muted small">No patients found</div>}
                    </div>
                  )}
                </div>
              )}

              {/* Smart suggestions */}
              {selectedPatient && suggestLoading && (
                <div className="text-center py-4"><span className="spinner-border spinner-border-sm text-primary"></span> <span className="text-muted small ms-1">Analyzing patient…</span></div>
              )}

              {selectedPatient && suggest && (
                <div className="mb-3">
                  <label className="form-label small fw-semibold">
                    <i className="bi bi-stars text-warning me-1"></i>Smart specialist suggestions
                  </label>
                  {suggest.suggestions?.length ? (
                    <div className="d-flex flex-column gap-2">
                      {suggest.suggestions.map((s: Suggestion) => (
                        <div key={s.specialty} className="rounded-3 p-2" style={{ background: '#f8f9fa' }}>
                          <div className="d-flex justify-content-between align-items-center mb-1">
                            <span className="fw-semibold small">{s.specialty}</span>
                            <span className="text-muted small">
                              {s.matchedKeywords.slice(0, 3).join(', ')}
                            </span>
                          </div>
                          <div className="d-flex flex-wrap gap-1">
                            {s.providers.map((pr) => (
                              <button
                                key={pr.id}
                                type="button"
                                className={`btn btn-sm rounded-pill ${String(specialistId) === String(pr.id) ? 'btn-primary' : 'btn-outline-primary'}`}
                                onClick={() => setSpecialistId(String(pr.id))}
                              >
                                {pr.title ? `${pr.title} ` : ''}{pr.fname} {pr.lname}
                              </button>
                            ))}
                            {!s.providers.length && <small className="text-muted">No matching provider in the system</small>}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-muted small">No clear specialist match — choose a provider below.</div>
                  )}
                </div>
              )}

              {/* Reason */}
              <div className="mb-3">
                <label className="form-label small fw-semibold">Reason for referral</label>
                <input className="form-control" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Cardiology evaluation for chest pain" />
              </div>

              {/* Urgency + manual provider */}
              <div className="row g-2 mb-3">
                <div className="col-md-4">
                  <label className="form-label small fw-semibold">Urgency</label>
                  <select className="form-select" value={urgency} onChange={(e) => setUrgency(e.target.value)}>
                    <option value="routine">Routine</option>
                    <option value="urgent">Urgent</option>
                    <option value="stat">STAT</option>
                  </select>
                </div>
                <div className="col-md-8">
                  <label className="form-label small fw-semibold">Specialist / Provider</label>
                  <select className="form-select" value={specialistId} onChange={(e) => setSpecialistId(e.target.value)}>
                    <option value="">— {selectedSpecialistName ? selectedSpecialistName : 'Select provider'} —</option>
                    {allProviders.map((pr) => (
                      <option key={pr.id} value={pr.id}>{pr.title ? `${pr.title} ` : ''}{pr.fname} {pr.lname}{pr.specialty ? ` (${pr.specialty})` : ''}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Clinical notes (auto-populated, sorted by date) */}
              <div className="mb-3">
                <label className="form-label small fw-semibold">
                  <i className="bi bi-journal-medical me-1 text-info"></i>Clinical notes (auto-loaded, sorted by date)
                </label>
                <textarea className="form-control" rows={8} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Clinical summary will be populated when a patient is selected…" />
              </div>

              {error && <div className="alert alert-danger py-2 small">{error}</div>}

              <button className="btn btn-primary rounded-pill px-4" onClick={handleSend} disabled={sendReferral.isPending || !selectedPatient}>
                {sendReferral.isPending ? <span className="spinner-border spinner-border-sm me-1"></span> : <i className="bi bi-send me-1"></i>}
                Send Referral
              </button>
            </div>
          </div>
        </div>

        {/* Right — history */}
        <div className="col-lg-5">
          <div className="card border-0 shadow-sm" style={{ borderRadius: '20px' }}>
            <div className="card-header bg-white d-flex justify-content-between py-3" style={{ borderRadius: '20px 20px 0 0' }}>
              <h6 className="mb-0 fw-bold"><i className="bi bi-clock-history me-2 text-success"></i>Referral History</h6>
              <span className="badge bg-primary rounded-pill">{referrals.length}</span>
            </div>
            <div className="card-body p-0" style={{ maxHeight: '680px', overflowY: 'auto' }}>
              {referrals.map((r: any) => (
                <div key={r.id} className="px-3 py-3 border-bottom">
                  <div className="d-flex justify-content-between align-items-start">
                    <div className="fw-semibold small">{r.patientName}</div>
                    <span className={`badge rounded-pill ${urgencyBadge[r.urgency] || 'bg-info'}`} style={{ fontSize: '0.65rem' }}>{r.urgency}</span>
                  </div>
                  <div className="small text-primary">{r.reason}</div>
                  <div className="d-flex justify-content-between align-items-center text-muted" style={{ fontSize: '0.7rem' }}>
                    <span><i className="bi bi-person-badge me-1"></i>{r.specialistName || 'General referral'}</span>
                    <span><i className="bi bi-calendar3 me-1"></i>{fmtDate(r.date)}</span>
                  </div>
                  <div className="mt-1">
                    <span className={`badge ${r.status === 'pending' ? 'bg-secondary' : r.status === 'accepted' ? 'bg-success' : 'bg-info'}`} style={{ fontSize: '0.65rem' }}>{r.status}</span>
                    {r.body && (
                      <details className="small text-muted mt-1">
                        <summary className="text-muted">View notes</summary>
                        <pre className="bg-light p-2 rounded-2 mt-1" style={{ whiteSpace: 'pre-wrap', fontSize: '0.75rem' }}>{r.body}</pre>
                      </details>
                    )}
                  </div>
                </div>
              ))}
              {!referrals.length && (
                <div className="text-center text-muted py-5">
                  <i className="bi bi-send fs-1 d-block mb-2 opacity-25"></i>
                  <p className="small">No referrals sent yet.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Referral detail modal — every specific of the inbound referral */}
      {openReferral && (
        <div className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
          style={{ background: 'rgba(10,37,64,0.45)', zIndex: 1080, padding: '16px' }}
          onClick={() => setOpenReferral(null)}>
          <div className="card border-0 shadow-lg"
            style={{ maxWidth: '660px', width: '100%', maxHeight: '88vh', overflow: 'auto', borderRadius: '20px' }}
            onClick={(e) => e.stopPropagation()}>
            <div className="card-header text-white d-flex justify-content-between align-items-center py-3"
              style={{ background: 'linear-gradient(135deg, #20c997, #0d6efd)', borderRadius: '20px 20px 0 0' }}>
              <div>
                <h6 className="mb-0 fw-bold">
                  <i className="bi bi-send-check me-2"></i>Referral — {openReferral.patientName}
                </h6>
                <small className="text-white text-opacity-75">{fmtDate(openReferral.date)}</small>
              </div>
              <button className="btn btn-sm btn-outline-light rounded-circle" style={{ width: '32px', height: '32px' }}
                onClick={() => setOpenReferral(null)}><i className="bi bi-x-lg"></i></button>
            </div>
            <div className="card-body">
              <div className="d-flex flex-wrap gap-2 mb-3">
                <span className={`badge rounded-pill ${urgencyBadge[openReferral.urgency] || 'bg-info'}`}>
                  {String(openReferral.urgency || '').toUpperCase()}
                </span>
                <span className="badge bg-light text-dark border rounded-pill">status: {openReferral.status}</span>
                {openReferral.specialty && <span className="badge bg-primary rounded-pill">{openReferral.specialty}</span>}
              </div>

              <dl className="row small mb-3">
                <dt className="col-sm-4 text-muted">Patient</dt>
                <dd className="col-sm-8 fw-semibold">{openReferral.patientName}</dd>
                <dt className="col-sm-4 text-muted">Patient ID</dt>
                <dd className="col-sm-8">
                  PID {openReferral.pid}
                  {openReferral.patientDOB ? ` · DOB ${String(openReferral.patientDOB).slice(0, 10)}` : ''}
                  {openReferral.patientSex ? ` · ${openReferral.patientSex}` : ''}
                </dd>
                <dt className="col-sm-4 text-muted">Reason</dt>
                <dd className="col-sm-8 fw-semibold">{openReferral.reason || '—'}</dd>
                <dt className="col-sm-4 text-muted">Referred by</dt>
                <dd className="col-sm-8">{openReferral.referringProvider || '—'}</dd>
                <dt className="col-sm-4 text-muted">Assigned specialist</dt>
                <dd className="col-sm-8">{openReferral.specialistName || '—'}</dd>
              </dl>

              {openReferral.body && (
                <>
                  <h6 className="small fw-bold text-muted text-uppercase">Clinical notes</h6>
                  <div className="p-3 bg-light rounded-3 small" style={{ whiteSpace: 'pre-wrap', maxHeight: '260px', overflow: 'auto' }}>
                    {openReferral.body}
                  </div>
                </>
              )}
            </div>
            <div className="card-footer bg-white d-flex flex-wrap gap-2" style={{ borderRadius: '0 0 20px 20px' }}>
              {chartPatientId(openReferral.patientId, openReferral.pid) !== null && (
                <button className="btn btn-outline-primary btn-sm rounded-pill" onClick={() => openReferralChart(openReferral)}>
                  <i className="bi bi-folder2-open me-1"></i>Open chart
                </button>
              )}
              <button className="btn btn-success btn-sm rounded-pill ms-auto"
                disabled={ackReferral.isPending}
                onClick={() => ackReferral.mutate({ id: openReferral.id, status: 'accepted' })}>
                <i className="bi bi-check2-circle me-1"></i>Accept
              </button>
              <button className="btn btn-outline-secondary btn-sm rounded-pill"
                disabled={ackReferral.isPending}
                onClick={() => ackReferral.mutate({ id: openReferral.id, status: 'reviewed' })}>
                Mark reviewed
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
