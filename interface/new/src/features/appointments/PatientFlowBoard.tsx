import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getAppointments } from '../../api/endpoints/appointments';
import type { Appointment } from '../../types/appointment';
import nestClient from '../../api/nest-client';
import { formatPatientNameLastFirst } from '../../utils/patientName';
import { formatDateOnly, formatDateTime, toDateInput } from '../../utils/date';
import { chartPatientId, patientChartPath } from '../../utils/patientChart';
import { NotificationFeedCard, NotificationFeedModal, FeedItem } from '../../components/notifications/NotificationFeed';

type StatusColumn = 'Scheduled' | 'Checked In' | 'Checked Out' | 'Canceled' | 'No Show';

const STATUS_COLUMNS: StatusColumn[] = ['Scheduled', 'Checked In', 'Checked Out', 'Canceled', 'No Show'];

const NEXT_STATUS: Record<string, string[]> = {
  'Scheduled': ['Checked In', 'No Show', 'Canceled'],
  'Checked In': ['Checked Out', 'No Show'],
  'Checked Out': [],
  'Canceled': ['Scheduled'],
  'No Show': ['Scheduled'],
  '': ['Scheduled', 'Checked In'],
};

const STATUS_STYLE: Record<string, { bg: string; icon: string; color: string }> = {
  'Scheduled': { bg: '#0d6efd', icon: 'bi-calendar-check', color: '#0d6efd' },
  'Checked In': { bg: '#0dcaf0', icon: 'bi-check-circle', color: '#0dcaf0' },
  'Checked Out': { bg: '#198754', icon: 'bi-box-arrow-right', color: '#198754' },
  'Canceled': { bg: '#dc3545', icon: 'bi-x-circle', color: '#dc3545' },
  'No Show': { bg: '#6c757d', icon: 'bi-person-x', color: '#6c757d' },
};

const CATEGORY_COLORS: Record<number, string> = {
  5: '#0d6efd', 4: '#198754', 3: '#ffc107', 2: '#dc3545', 1: '#6f42c1',
};

export default function PatientFlowBoard() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [selectedDate, setSelectedDate] = useState(() => toDateInput(new Date()));
  /** The flow entry whose detail modal is open. */
  const [openFeed, setOpenFeed] = useState<FeedItem | null>(null);

  const { data: appointments = [], isLoading } = useQuery({
    queryKey: ['appointments', 'flow', selectedDate],
    queryFn: () => getAppointments({ date: selectedDate }),
  });

  const { data: walkIns = [] } = useQuery({
    queryKey: ['appointments', 'walk-ins', selectedDate],
    queryFn: async () => { const r = await nestClient.get(`/appointments/walk-ins?date=${selectedDate}`); return r.data; },
  });

  const statusMutation = useMutation({
    mutationFn: ({ eid, status }: { eid: number; status: string }) =>
      nestClient.patch(`/appointments/${eid}/status`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['appointments', 'flow', selectedDate] }),
  });

  const columns = useMemo(() => {
    const groups: Record<string, Appointment[]> = {};
    for (const status of STATUS_COLUMNS) groups[status] = [];
    groups[''] = [];
    for (const apt of appointments) {
      const status = apt.pc_apptstatus || '';
      if (groups[status]) groups[status].push(apt);
      else groups[''].push(apt);
    }
    return groups;
  }, [appointments]);

  const totalPatients = appointments.length;
  const checkedIn = (columns['Checked In'] || []).length;
  const completed = (columns['Checked Out'] || []).length;
  const scheduled = (columns['Scheduled'] || []).length;

  const formatWait = (mins: number | null | undefined) => {
    if (mins == null) return null;
    if (mins >= 60) return `${Math.floor(mins / 60)}h ${mins % 60}m`;
    return `${mins}m`;
  };

  /**
   * Today's flow folded into the shared notification shape: every patient on the
   * board becomes a card that opens into a modal with the full visit detail.
   */
  const flowFeed: FeedItem[] = useMemo(() => {
    const fromAppointments = appointments.map((a: Appointment): FeedItem => {
      const status = a.pc_apptstatus || 'Scheduled';
      const style = STATUS_STYLE[status] || STATUS_STYLE['Scheduled'];
      const name = formatPatientNameLastFirst(a) || a.pc_title || `Appointment #${a.pc_eid}`;
      const waited = a.wait_minutes ?? null;
      const provider = a.provider_name
        || `${a.pce_aid_fname || ''} ${a.pce_aid_lname || ''}`.trim()
        || a.patient_provider_name
        || '';
      return {
        id: a.pc_eid,
        title: name,
        subtitle: [status, a.pc_startTime ? String(a.pc_startTime).slice(0, 5) : null].filter(Boolean).join(' · '),
        summary: [a.pc_catname || a.pc_title, provider].filter(Boolean).join(' · '),
        at: a.checked_in_at || a.pc_eventDate,
        icon: style.icon,
        tone: style.color,
        status,
        unread: status === 'Checked In',
        link: patientChartPath(a.patient_id, a.pid, a.pc_pid) || undefined,
        linkLabel: 'Open chart',
        alerts: waited != null && waited > 30
          ? [{ level: 'warning' as const, title: 'Long wait', lines: [`Waiting ${formatWait(waited)} — over the 30 minute target.`] }]
          : status === 'No Show'
            ? [{ level: 'danger' as const, title: 'No show', lines: ['Patient did not arrive for this slot.'] }]
            : undefined,
        metrics: [
          { label: 'Status', value: status, color: style.color },
          { label: 'Wait', value: formatWait(waited) || '—', color: waited != null && waited > 30 ? '#dc3545' : '#198754' },
          { label: 'Duration', value: a.pc_duration ? `${a.pc_duration} min` : '—', color: '#6f42c1' },
        ],
        fields: [
          ['Patient', name],
          ['Visit date', formatDateOnly(a.eventDateStr || a.pc_eventDate)],
          ['Start time', a.pc_startTime ? String(a.pc_startTime).slice(0, 5) : ''],
          ['Visit type', a.pc_catname],
          ['Provider', provider],
          ['Checked in', a.checked_in_at ? formatDateTime(a.checked_in_at) : ''],
          ['Status', status],
          ['Reason', a.pc_hometext],
        ],
        lists: [{ title: 'Visit notes', lines: String(a.pc_hometext || '').split(/\r?\n/).filter(Boolean) }],
      };
    });

    const fromWalkIns = walkIns.map((w: any): FeedItem => {
      const name = formatPatientNameLastFirst(w) || `Patient #${w.pid}`;
      const waited = w.wait_minutes ?? null;
      return {
        id: `walk-${w.tracker_id ?? w.pid}`,
        title: name,
        subtitle: ['Walk-in', w.checked_in_at ? formatDateTime(w.checked_in_at) : null].filter(Boolean).join(' · '),
        summary: [w.provider_name, w.sex ? `Sex ${w.sex}` : null].filter(Boolean).join(' · '),
        at: w.checked_in_at || selectedDate,
        icon: 'bi-person-plus',
        tone: '#ffc107',
        status: 'Walk-in',
        unread: true,
        link: patientChartPath(w.patient_id, w.id, w.pid) || undefined,
        linkLabel: 'Open chart',
        alerts: waited != null && waited > 30
          ? [{ level: 'warning' as const, title: 'Long wait', lines: [`Waiting ${formatWait(waited)} — over the 30 minute target.`] }]
          : undefined,
        metrics: [
          { label: 'Status', value: 'Walk-in', color: '#ffc107' },
          { label: 'Wait', value: formatWait(waited) || '—', color: waited != null && waited > 30 ? '#dc3545' : '#198754' },
        ],
        fields: [
          ['Patient', name],
          ['Date of birth', formatDateOnly(w.DOB)],
          ['Sex', w.sex],
          ['Provider', w.provider_name],
          ['Checked in', w.checked_in_at ? formatDateTime(w.checked_in_at) : ''],
          ['Visit date', selectedDate],
        ],
      };
    });

    return [...fromWalkIns, ...fromAppointments];
  }, [appointments, walkIns, selectedDate]);

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
      <div className="rounded-4 p-4 mb-4 text-white position-relative overflow-hidden" style={{
        background: 'linear-gradient(135deg, #198754 0%, #0dcaf0 40%, #0d6efd 70%, #6610f2 100%)',
      }}>
        <div className="position-absolute end-0 top-0 opacity-10" style={{ fontSize: '7rem', transform: 'rotate(10deg) translate(30px,-10px)' }}>
          <i className="bi bi-kanban"></i>
        </div>
        <div className="position-relative">
          <div className="d-flex justify-content-between align-items-start flex-wrap gap-3">
            <div>
              <h2 className="mb-1 fw-bold"><i className="bi bi-kanban me-2"></i>Patient Flow Board</h2>
              <p className="mb-0 text-white text-opacity-75 small">{totalPatients} patients today</p>
            </div>
            <div className="d-flex align-items-center gap-2">
              <div className="d-flex gap-2">
                {[
                  { v: scheduled, l: 'Scheduled', c: '#0d6efd' },
                  { v: checkedIn, l: 'In Progress', c: '#0dcaf0' },
                  { v: completed, l: 'Completed', c: '#198754' },
                  { v: walkIns.length, l: 'Walk-ins', c: '#ffc107' },
                ].map(s => (
                  <div key={s.l} className="text-center bg-white bg-opacity-15 rounded-3 px-3 py-2" style={{ minWidth: '70px' }}>
                    <div className="fw-bold fs-5 lh-1">{s.v}</div>
                    <small className="text-white text-opacity-75" style={{ fontSize: '0.65rem' }}>{s.l}</small>
                  </div>
                ))}
              </div>
              <div className="vr opacity-25 mx-1"></div>
              <label className="form-label mb-0 small text-white text-opacity-75">Date:</label>
              <input type="date" className="form-control form-control-sm rounded-pill" style={{ width: 'auto' }}
                value={selectedDate} onChange={e => setSelectedDate(e.target.value)} />
            </div>
          </div>
        </div>
      </div>

      {/* Flow notifications — same card + modal viewers used across the app */}
      <NotificationFeedCard
        title="Patient Flow Notifications"
        icon="bi-diagram-3-fill"
        tone="#0dcaf0"
        items={flowFeed}
        emptyText="No patients on the board for this date"
        onOpen={(item) => setOpenFeed(item)}
        max={5}
      />

      {/* Walk-In Patients Section */}
      {walkIns.length > 0 && (
        <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '20px', overflow: 'hidden' }}>
          <div style={{ height: '4px', background: 'linear-gradient(90deg, #ffc107, #fd7e14)' }}></div>
          <div className="card-header bg-white d-flex justify-content-between align-items-center py-3">
            <h6 className="mb-0 fw-bold">
              <i className="bi bi-person-plus me-2 text-warning"></i>Walk-In Patients
              <small className="text-muted ms-2 fw-normal">Quick Assigned</small>
            </h6>
            <span className="badge bg-warning text-dark rounded-pill">{walkIns.length}</span>
          </div>
          <div className="card-body py-2">
            <div className="row g-2">
              {walkIns.map((w: any) => (
                <div className="col-xl-3 col-md-4 col-sm-6" key={w.tracker_id}>
                  <div className="card border-0 shadow-sm h-100" style={{ borderRadius: '14px', cursor: 'pointer', borderLeft: '4px solid #ffc107' }}
                    onClick={() => { const cid = chartPatientId(w.patient_id, w.id, w.pid); if (cid) navigate(`/patients/${cid}`); }}>
                    <div className="card-body p-3">
                      <div className="d-flex align-items-center gap-2 mb-2">
                        <div className="rounded-circle bg-warning bg-opacity-10 d-flex align-items-center justify-content-center"
                          style={{ width: '36px', height: '36px' }}>
                          <span className="fw-bold text-warning small">{w.fname?.[0]}{w.lname?.[0]}</span>
                        </div>
                        <div className="min-w-0">
                          <div className="fw-bold small text-truncate">{formatPatientNameLastFirst(w)}</div>
                          <small className="text-muted">DOB: {formatDateOnly(w.DOB)} · {w.sex}</small>
                        </div>
                      </div>
                      {w.provider_name && (
                        <div className="d-flex align-items-center gap-1 mb-1 small">
                          <span className="rounded-circle d-inline-block"
                            style={{ width: '8px', height: '8px', backgroundColor: w.provider_color || '#0d6efd' }}></span>
                          <span className="text-muted">{w.provider_title && `${w.provider_title} `}{w.provider_name}</span>
                        </div>
                      )}
                      <div className="d-flex justify-content-between align-items-center">
                        <small className="text-muted">
                          <i className="bi bi-clock me-1"></i>
                          {w.checked_in_at ? new Date(w.checked_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                        </small>
                        {w.wait_minutes != null && (
                          <small className={`fw-bold ${w.wait_minutes > 30 ? 'text-danger' : w.wait_minutes > 15 ? 'text-warning' : 'text-success'}`}>
                            <i className="bi bi-hourglass-split me-1"></i>{formatWait(w.wait_minutes)}
                          </small>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Kanban Board */}
      {isLoading ? (
        <div className="text-center py-5">
          <div className="spinner-border text-primary" style={{ width: '3rem', height: '3rem' }}></div>
          <p className="text-muted mt-2">Loading flow board...</p>
        </div>
      ) : (
        <div className="row g-3 flex-nowrap overflow-auto pb-3" style={{ minHeight: '60vh' }}>
          {STATUS_COLUMNS.map((status) => {
            const style = STATUS_STYLE[status] || { bg: '#6c757d', icon: 'bi-question-circle', color: '#6c757d' };
            const items = columns[status] || [];
            return (
              <div className="col" key={status} style={{ minWidth: '260px', maxWidth: '320px' }}>
                <div className="card border-0 shadow-sm h-100" style={{ borderRadius: '20px', overflow: 'hidden' }}>
                  {/* Column Header */}
                  <div className="text-white px-3 py-3 d-flex justify-content-between align-items-center"
                    style={{ background: `linear-gradient(135deg, ${style.color}, ${style.color}cc)` }}>
                    <h6 className="mb-0 fw-bold d-flex align-items-center gap-2">
                      <i className={`bi ${style.icon}`}></i>
                      {status}
                    </h6>
                    <span className="badge bg-white bg-opacity-25 rounded-pill">{items.length}</span>
                  </div>

                  {/* Cards */}
                  <div className="card-body p-2 overflow-auto" style={{ maxHeight: 'calc(100vh - 280px)', background: '#f8f9fa' }}>
                    {items.length === 0 ? (
                      <div className="text-center py-4 text-muted opacity-50">
                        <i className="bi bi-inbox fs-3 d-block mb-1"></i>
                        <small>No patients</small>
                      </div>
                    ) : (
                      items.map((apt) => {
                        const catColor = CATEGORY_COLORS[apt.pc_catid || 5] || '#6c757d';
                        const nextStatuses = NEXT_STATUS[apt.pc_apptstatus || ''] || [];
                        const waitDisplay = formatWait(apt.wait_minutes);
                        const isWaitingLong = apt.pc_apptstatus === 'Checked In' && apt.wait_minutes != null && apt.wait_minutes > 15;
                        const isVeryLong = apt.wait_minutes != null && apt.wait_minutes > 30;
                        return (
                          <div key={apt.pc_eid} className="card mb-2 border-0 shadow-sm"
                            style={{ borderRadius: '14px', borderLeft: `4px solid ${catColor}`, cursor: 'pointer' }}
                            onClick={() => { const cid = chartPatientId(apt.patient_id, apt.pc_pid); if (cid) navigate(`/patients/${cid}`); }}>
                            <div className="card-body p-3">
                              {/* Patient Name */}
                              <div className="d-flex align-items-center gap-2 mb-2">
                                <div className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                                  style={{
                                    width: '34px', height: '34px', fontSize: '0.8rem',
                                    background: `linear-gradient(135deg, ${catColor}, ${catColor}cc)`, color: '#fff',
                                  }}>
                                  {apt.fname?.[0]}{apt.lname?.[0]}
                                </div>
                                <div className="min-w-0">
                                  <div className="fw-semibold small text-truncate">{apt.fname ? formatPatientNameLastFirst(apt) : `#${apt.pc_pid}`}</div>
                                  <div className="text-muted" style={{ fontSize: '0.7rem' }}>{apt.pc_title || 'Visit'}</div>
                                  {apt.patient_public_id && <div className="text-primary" style={{ fontSize: '0.68rem' }}>Chart #: {apt.patient_public_id}</div>}
                                </div>
                              </div>

                              {/* Provider */}
                              {apt.provider_name && (
                                <div className="d-flex align-items-center gap-1 mb-1" style={{ fontSize: '0.72rem' }}>
                                  <span className="rounded-circle d-inline-block"
                                    style={{ width: '7px', height: '7px', backgroundColor: apt.provider_color || '#0d6efd' }}></span>
                                  <span className="text-muted">{apt.provider_title && `${apt.provider_title} `}{apt.provider_name}</span>
                                </div>
                              )}

                              {/* Time & Wait */}
                              <div className="d-flex justify-content-between align-items-center mt-1">
                                <small className="text-muted" style={{ fontSize: '0.7rem' }}>
                                  <i className="bi bi-clock me-1"></i>{apt.pc_startTime?.substring(0, 5) || '—'}
                                </small>
                                {waitDisplay && (
                                  <span className={`badge rounded-pill ${isVeryLong ? 'bg-danger' : isWaitingLong ? 'bg-warning text-dark' : 'bg-success'}`}
                                    style={{ fontSize: '0.68rem' }}>
                                    {waitDisplay}
                                  </span>
                                )}
                              </div>

                              {/* Status Transition Buttons */}
                              {nextStatuses.length > 0 && (
                                <div className="d-flex gap-1 mt-2 flex-wrap" onClick={e => e.stopPropagation()}>
                                  {nextStatuses.map(ns => {
                                    const nsStyle = STATUS_STYLE[ns] || { color: '#6c757d' };
                                    return (
                                      <button key={ns} className="btn btn-sm rounded-pill"
                                        style={{
                                          fontSize: '0.68rem', padding: '3px 10px',
                                          border: `1px solid ${nsStyle.color}`, color: nsStyle.color,
                                          background: 'transparent',
                                        }}
                                        onMouseEnter={e => { e.currentTarget.style.background = nsStyle.color; e.currentTarget.style.color = '#fff'; }}
                                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = nsStyle.color; }}
                                        onClick={() => statusMutation.mutate({ eid: apt.pc_eid, status: ns })}
                                        disabled={statusMutation.isPending}>
                                        {ns}
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Flow detail modal — every specific of the visit */}
      <NotificationFeedModal
        item={openFeed}
        onClose={() => setOpenFeed(null)}
        onNavigate={(link) => navigate(link)}
      />
    </div>
  );
}
