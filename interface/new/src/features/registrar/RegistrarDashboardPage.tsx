import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import nestClient from '../../api/nest-client';
import { formatPatientNameLastFirst } from '../../utils/patientName';
import { chartPatientId } from '../../utils/patientChart';
import { toDateInput } from '../../utils/date';

/** Simple horizontal bar chart using inline SVG */
function BarChart({ data, height = 120 }: { data: { label: string; value: number; color: string }[]; height?: number }) {
  const maxVal = Math.max(...data.map(d => d.value), 1);
  const barH = 22;
  const gap = 8;
  const totalH = data.length * (barH + gap);
  const w = 300;
  return (
    <svg width={w} height={Math.max(height, totalH + 20)} className="d-block">
      {data.map((d, i) => {
        const bw = Math.max((d.value / maxVal) * (w - 100), 4);
        const y = i * (barH + gap) + 10;
        return (
          <g key={d.label}>
            <text x={0} y={y + 14} fontSize="11" fill="#6c757d" textAnchor="end" width="90">{d.label}</text>
            <rect x={95} y={y} width={bw} height={barH} rx="4" fill={d.color} opacity="0.85" />
            <text x={95 + bw + 4} y={y + 14} fontSize="11" fill="#495057" fontWeight="bold">{d.value}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** Simple donut ring using SVG */
function DonutRing({ segments, size = 100 }: { segments: { label: string; value: number; color: string }[]; size?: number }) {
  const total = segments.reduce((s, d) => s + d.value, 0) || 1;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 8;
  const strokeW = 14;
  const circumference = 2 * Math.PI * (r - strokeW / 2);
  let offset = 0;

  if (total === 0) {
    return (
      <svg width={size} height={size} className="d-block mx-auto">
        <circle cx={cx} cy={cy} r={r - strokeW / 2} fill="none" stroke="#e9ecef" strokeWidth={strokeW} />
        <text x={cx} y={cy + 4} textAnchor="middle" fontSize="13" fill="#6c757d">No data</text>
      </svg>
    );
  }

  return (
    <div className="d-flex align-items-center gap-3">
      <svg width={size} height={size}>
        {segments.map((s) => {
          const pct = s.value / total;
          const dashLen = pct * circumference;
          const dashOffset = offset;
          offset -= dashLen;
          return (
            <circle
              key={s.label}
              cx={cx} cy={cy} r={r - strokeW / 2}
              fill="none" stroke={s.color} strokeWidth={strokeW}
              strokeDasharray={`${dashLen} ${circumference - dashLen}`}
              strokeDashoffset={dashOffset}
              transform={`rotate(-90 ${cx} ${cy})`}
              style={{ transition: 'stroke-dasharray 0.5s' }}
            />
          );
        })}
        <text x={cx} y={cy - 2} textAnchor="middle" fontSize="18" fontWeight="bold" fill="#212529">{total}</text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize="10" fill="#6c757d">total</text>
      </svg>
      <div className="small">
        {segments.map(s => (
          <div key={s.label} className="d-flex align-items-center gap-1 mb-1">
            <span className="rounded-circle d-inline-block" style={{ width: '8px', height: '8px', backgroundColor: s.color }}></span>
            <span className="text-muted">{s.label}: <strong>{s.value}</strong></span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LiveClock({ timezone, label, offsetLabel }: { timezone: string; label: string; offsetLabel: string }) {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const fmt = (d: Date, tz: string) =>
    d.toLocaleTimeString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

  const dateStr = (d: Date, tz: string) =>
    d.toLocaleDateString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' });

  return (
    <div className="text-center px-3">
      <div className="text-white text-opacity-75" style={{ fontSize: '0.7rem' }}>{label}</div>
      <div className="fw-bold" style={{ fontSize: '1.1rem', fontVariantNumeric: 'tabular-nums' }}>
        {fmt(time, timezone)}
      </div>
      <div className="text-white text-opacity-50" style={{ fontSize: '0.65rem' }}>
        {dateStr(time, timezone)} · {offsetLabel}
      </div>
    </div>
  );
}

export default function RegistrarDashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const today = toDateInput(new Date());

  const { data: pendingPatients = [], isLoading: pendingLoading } = useQuery({
    queryKey: ['patients-pending'],
    queryFn: async () => { const r = await nestClient.get('/patients/pending'); return r.data; },
    refetchInterval: 15000,
  });

  const { data: appointments = [] } = useQuery({
    queryKey: ['registrar', 'appointments', today],
    queryFn: async () => { const r = await nestClient.get('/appointments', { params: { date: today } }); return r.data; },
  });

  const { data: providers = [] } = useQuery({
    queryKey: ['providers-list'],
    queryFn: async () => { const r = await nestClient.get('/admin/users'); return r.data; },
  });

  // Provider day-schedule management (add/remove "In Office" availability blocks).
  const [scheduleProviderId, setScheduleProviderId] = useState('');
  const [scheduleStart, setScheduleStart] = useState('08:00');
  const [scheduleEnd, setScheduleEnd] = useState('17:00');

  const { data: providerSchedule = [] } = useQuery({
    queryKey: ['provider-schedule', today],
    queryFn: async () => { const r = await nestClient.get('/appointments/provider-schedule', { params: { date: today } }); return r.data; },
  });

  const addScheduleMutation = useMutation({
    mutationFn: () => nestClient.post('/appointments/provider-schedule', { date: today, providerId: scheduleProviderId, startTime: scheduleStart, endTime: scheduleEnd }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['provider-schedule', today] });
      queryClient.invalidateQueries({ queryKey: ['registrar', 'appointments', today] });
      setScheduleProviderId('');
    },
  });

  const removeScheduleMutation = useMutation({
    mutationFn: (eid: number) => nestClient.delete(`/appointments/provider-schedule/${eid}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['provider-schedule', today] }),
  });

  const [assignProvider, setAssignProvider] = useState<Record<number, string>>({});
  const [lastApproval, setLastApproval] = useState('');
  // Insurance decision captured at approval (for billing).
  const [coverage, setCoverage] = useState<Record<number, { type: string; percent: string }>>({});

  const approveMutation = useMutation({
    mutationFn: ({ id, providerID, insuranceType, patientPercent }: { id: number; providerID?: string; insuranceType?: string; patientPercent?: number }) =>
      nestClient.patch(`/patients/${id}/approve`, { providerID, insuranceType, patientPercent }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['patients-pending'] });
      queryClient.invalidateQueries({ queryKey: ['patients'] });
      queryClient.invalidateQueries({ queryKey: ['registrar', 'appointments'] });
      setLastApproval(
        data?.appointment
          ? `Approved · intake scheduled with ${data.providerName || 'provider'} at ${data.appointment.startTime}`
          : `Approved${data?.providerName ? ` · assigned ${data.providerName}` : ''}`,
      );
    },
  });

  const formatWaitTime = (minutes: number | null) => {
    if (!minutes && minutes !== 0) return '—';
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}h ${m}m`;
  };

  const pendingCount = pendingPatients.length;
  const withVitals = pendingPatients.filter((p: any) => p.vitals_count > 0).length;
  const checkedIn = appointments.filter((a: any) => a.pc_apptstatus === 'Checked In').length;
  const completed = appointments.filter((a: any) => a.pc_apptstatus === 'Checkout').length;
  const activeProviders = providers.filter((p: any) => p.active).length;
  const longWait = pendingPatients.filter((p: any) => p.vitals_count > 0 && p.minutes_waiting > 30).length;

  // Chart data: appointment status distribution
  const apptStatusData = [
    { label: 'Checked In', value: checkedIn, color: '#0dcaf0' },
    { label: 'Completed', value: completed, color: '#198754' },
    { label: 'Scheduled', value: appointments.length - checkedIn - completed, color: '#6c757d' },
  ];

  // Chart data: pending vitals breakdown
  const vitalsData = [
    { label: 'Vitals Recorded', value: withVitals, color: '#198754' },
    { label: 'No Vitals Yet', value: pendingCount - withVitals, color: '#dc3545' },
  ];

  // Provider workload
  const providerWorkload = providers.filter((p: any) => p.active).map((p: any) => ({
    label: `${p.fname} ${p.lname?.[0]}.`,
    value: appointments.filter((a: any) => String(a.pc_aid) === String(p.id)).length,
    color: p.calendar_color || '#0d6efd',
  })).filter((d: any) => d.value > 0).sort((a: any, b: any) => b.value - a.value).slice(0, 5);

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
      {/* Header with clocks */}
      <div className="rounded-4 p-4 mb-4 text-white" style={{
        background: 'linear-gradient(135deg, #6f42c1 0%, #6610f2 50%, #0d6efd 100%)',
      }}>
        <div className="d-flex justify-content-between align-items-start flex-wrap gap-3">
          <div>
            <h2 className="mb-1 fw-bold">
              <i className="bi bi-clipboard-check me-2"></i>
              Registrar Dashboard
            </h2>
            <p className="mb-0 text-white text-opacity-75 small">
              Welcome, {user?.displayName || 'Registrar'} — Patient Approval Queue
            </p>
          </div>
          <div className="d-flex align-items-center gap-2">
            <LiveClock timezone="Africa/Monrovia" label="Monrovia" offsetLabel="GMT+0" />
            <div className="vr opacity-50"></div>
            <LiveClock timezone="America/New_York" label="Florida (US)" offsetLabel="GMT-4" />
          </div>
          <div className="d-flex gap-2">
            <button className="btn btn-light btn-sm rounded-pill" onClick={() => navigate('/patients')}>
              <i className="bi bi-search me-1"></i>All Patients
            </button>
            <button className="btn btn-warning btn-sm rounded-pill" onClick={() => navigate('/bookings')}>
              <i className="bi bi-qr-code me-1"></i>Bookings & QR
            </button>
            <button className="btn btn-outline-light btn-sm rounded-pill" onClick={() => navigate('/providers')}>
              <i className="bi bi-person-badge me-1"></i>Providers
            </button>
          </div>
        </div>
      </div>

      {/* Stats Row */}
      <div className="row g-3 mb-4">
        {[
          { v: pendingCount, l: 'Pending Approval', c: '#dc3545', i: 'bi-hourglass-split', sub: `${withVitals} with vitals` },
          { v: appointments.length, l: "Today's Appts", c: '#198754', i: 'bi-calendar-check', sub: `${checkedIn} checked in` },
          { v: activeProviders, l: 'Active Providers', c: '#0d6efd', i: 'bi-person-badge', sub: 'On staff' },
          { v: longWait, l: 'Long Wait', c: '#fd7e14', i: 'bi-exclamation-triangle', sub: '>30 min' },
        ].map((s, i) => (
          <div className="col-md-3 col-sm-6" key={i}>
            <div className="card border-0 shadow-sm h-100" style={{ borderRadius: '16px' }}>
              <div className="card-body text-center py-3">
                <div className="rounded-circle d-inline-flex align-items-center justify-content-center mb-2"
                  style={{ width: '48px', height: '48px', backgroundColor: `${s.c}15` }}>
                  <i className={`bi ${s.i} fs-5`} style={{ color: s.c }}></i>
                </div>
                <div className="fs-4 fw-bold" style={{ color: s.c }}>{s.v}</div>
                <small className="text-muted d-block">{s.l}</small>
                {s.sub && <small className="text-muted" style={{ fontSize: '0.7rem' }}>{s.sub}</small>}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Charts Row */}
      <div className="row g-3 mb-4">
        <div className="col-lg-4">
          <div className="card border-0 shadow-sm h-100" style={{ borderRadius: '16px' }}>
            <div className="card-header bg-white py-3" style={{ borderRadius: '16px 16px 0 0' }}>
              <h6 className="mb-0 fw-bold"><i className="bi bi-bar-chart me-2 text-primary"></i>Appointment Status</h6>
            </div>
            <div className="card-body d-flex justify-content-center py-2">
              <BarChart data={apptStatusData} height={110} />
            </div>
          </div>
        </div>
        <div className="col-lg-4">
          <div className="card border-0 shadow-sm h-100" style={{ borderRadius: '16px' }}>
            <div className="card-header bg-white py-3" style={{ borderRadius: '16px 16px 0 0' }}>
              <h6 className="mb-0 fw-bold"><i className="bi bi-heart-pulse me-2 text-success"></i>Vitals Status</h6>
            </div>
            <div className="card-body d-flex justify-content-center py-2">
              <DonutRing segments={vitalsData} size={110} />
            </div>
          </div>
        </div>
        <div className="col-lg-4">
          <div className="card border-0 shadow-sm h-100" style={{ borderRadius: '16px' }}>
            <div className="card-header bg-white py-3" style={{ borderRadius: '16px 16px 0 0' }}>
              <h6 className="mb-0 fw-bold"><i className="bi bi-people me-2 text-info"></i>Provider Workload</h6>
            </div>
            <div className="card-body d-flex justify-content-center py-2">
              {providerWorkload.length > 0 ? (
                <BarChart data={providerWorkload} height={110} />
              ) : (
                <div className="text-center text-muted py-3 small">No appointments assigned yet</div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="row g-3">
        {/* Today's Schedule */}
        <div className="col-lg-7">
          <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '16px' }}>
            <div className="card-header bg-white d-flex justify-content-between align-items-center py-3" style={{ borderRadius: '16px 16px 0 0' }}>
              <h6 className="mb-0 fw-bold">
                <i className="bi bi-calendar-event me-2 text-primary"></i>Today's Schedule
              </h6>
              <span className="badge bg-primary rounded-pill">{appointments.length} appts</span>
            </div>
            <div className="card-body p-0">
              {appointments.length > 0 ? (
                <div className="table-responsive">
                  <table className="table table-hover mb-0 small">
                    <thead className="table-light">
                      <tr>
                        <th>Time</th>
                        <th>Patient</th>
                        <th>Provider</th>
                        <th>Type</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {appointments.map((a: any) => {
                        const provider = providers.find((p: any) => String(p.id) === String(a.pc_aid));
                        return (
                          <tr key={a.pc_eid} style={{ cursor: 'pointer' }} onClick={() => { const cid = chartPatientId(a.patient_id, a.pc_pid); if (cid) navigate(`/patients/${cid}`); }}>
                            <td>{a.pc_startTime?.substring(0, 5) || '—'}</td>
                            <td>
                              <span className="fw-semibold">#{a.pc_pid}</span>
                              {a.patientFname && <span> — {a.patientFname} {a.patientLname?.[0]}.</span>}
                            </td>
                            <td>
                              {provider ? (
                                <span className="d-flex align-items-center gap-1">
                                  <span className="rounded-circle d-inline-block"
                                    style={{ width: '8px', height: '8px', backgroundColor: provider.calendar_color || '#0d6efd' }}></span>
                                  {provider.title ? `${provider.title} ` : ''}{provider.fname} {provider.lname}
                                </span>
                              ) : (
                                <span className="text-muted">—</span>
                              )}
                            </td>
                            <td>{a.pc_title || a.pc_catname || '—'}</td>
                            <td>
                              <span className={`badge rounded-pill ${a.pc_apptstatus === 'Checked In' ? 'bg-info' : a.pc_apptstatus === 'Checkout' ? 'bg-success' : 'bg-secondary'}`}>
                                {a.pc_apptstatus || 'Scheduled'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center text-muted py-4">
                  <i className="bi bi-calendar-x fs-3 d-block mb-2 opacity-50"></i>
                  No appointments today
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div className="col-lg-5">
          {/* Provider Assignment Summary */}
          <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '16px' }}>
            <div className="card-header bg-white d-flex justify-content-between align-items-center py-3" style={{ borderRadius: '16px 16px 0 0' }}>
              <h6 className="mb-0 fw-bold">
                <i className="bi bi-person-check me-2 text-success"></i>Provider Assignments Today
              </h6>
              <span className="badge bg-success rounded-pill">{checkedIn} checked in</span>
            </div>
            <div className="card-body p-0">
              {activeProviders > 0 ? (
                providers.filter((p: any) => p.active).slice(0, 6).map((p: any) => {
                  const providerAppts = appointments.filter((a: any) => String(a.pc_aid) === String(p.id));
                  const checkedInCount = providerAppts.filter((a: any) => a.pc_apptstatus === 'Checked In').length;
                  return (
                    <div key={p.id} className="d-flex align-items-center gap-2 px-3 py-2 border-bottom"
                      style={{ cursor: 'pointer' }} onClick={() => navigate(`/providers/${p.id}`)}>
                      <span className="rounded-circle d-inline-block"
                        style={{ width: '12px', height: '12px', backgroundColor: p.calendar_color || '#0d6efd' }}></span>
                      <span className="rounded-circle bg-primary bg-opacity-10 d-flex align-items-center justify-content-center"
                        style={{ width: '32px', height: '32px' }}>
                        <small className="fw-bold text-primary">{p.fname?.[0]}{p.lname?.[0]}</small>
                      </span>
                      <div className="flex-grow-1">
                        <small className="fw-semibold">{p.title ? `${p.title} ` : ''}{p.fname} {p.lname}</small>
                        <br />
                        <small className="text-muted">{p.specialty || 'General'} · {providerAppts.length} appt{providerAppts.length !== 1 ? 's' : ''}</small>
                      </div>
                      {checkedInCount > 0 && (
                        <span className="badge bg-info rounded-pill">{checkedInCount} in</span>
                      )}
                      <i className="bi bi-chevron-right text-muted small"></i>
                    </div>
                  );
                })
              ) : (
                <div className="text-center text-muted py-3">
                  <small>No active providers</small>
                </div>
              )}
            </div>
          </div>

          {/* Pending Patient Approvals */}
          <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
            <div className="card-header bg-white d-flex justify-content-between align-items-center py-3" style={{ borderRadius: '16px 16px 0 0' }}>
              <h6 className="mb-0 fw-bold">
                <i className="bi bi-list-check me-2 text-danger"></i>
                Pending Patient Approvals
              </h6>
              <span className="badge bg-danger rounded-pill">{pendingCount} pending</span>
            </div>
            <div className="card-body p-0">
              {lastApproval && (
                <div className="alert alert-success py-2 px-3 small mb-0 rounded-0 d-flex justify-content-between align-items-center">
                  <span><i className="bi bi-check-circle me-1"></i>{lastApproval}</span>
                  <button className="btn-close" style={{ fontSize: '0.6rem' }} onClick={() => setLastApproval('')}></button>
                </div>
              )}
              {pendingLoading ? (
                <div className="text-center py-4">
                  <div className="spinner-border spinner-border-sm text-primary"></div>
                </div>
              ) : pendingPatients.length === 0 ? (
                <div className="text-center py-4 text-muted">
                  <i className="bi bi-check-circle fs-1 d-block mb-2 text-success opacity-50"></i>
                  <p className="small">No pending patients awaiting approval.</p>
                </div>
              ) : (
                pendingPatients.slice(0, 6).map((p: any) => {
                  const hasVitals = p.vitals_count > 0;
                  const isLongWait = p.minutes_waiting > 30;
                  // Every patient here is still `pending`, so the chart is by
                  // definition unfinished until the registrar approves it.
                  const isIncomplete = p.chart_complete === false;
                  const missing: string[] = p.missing_fields || [];
                  return (
                    <div key={p.id}
                      className={`d-flex align-items-center gap-2 px-3 py-2 border-bottom ${isIncomplete ? 'bg-warning bg-opacity-10' : ''}`}
                      style={isIncomplete ? { borderLeft: '4px solid #ffc107' } : undefined}>
                      <div className="rounded-circle bg-danger bg-opacity-10 d-flex align-items-center justify-content-center flex-shrink-0"
                        style={{ width: '32px', height: '32px' }}>
                        <small className="fw-bold text-danger">{p.fname?.[0]}{p.lname?.[0]}</small>
                      </div>
                      <div className="flex-grow-1" style={{ cursor: 'pointer' }} onClick={() => { const cid = chartPatientId(p.id, p.pid); if (cid) navigate(`/patients/${cid}`); }}>
                        <small className="fw-semibold">{formatPatientNameLastFirst(p)}</small>
                        {isIncomplete && (
                          <span
                            className="badge bg-warning text-dark rounded-pill ms-1"
                            style={{ fontSize: '0.62rem' }}
                            title={missing.length ? `Still needed: ${missing.join(', ')}` : 'Chart not yet completed'}
                          >
                            <i className="bi bi-exclamation-triangle-fill me-1"></i>
                            Chart incomplete{missing.length ? ` · ${missing.length} missing` : ''}
                          </span>
                        )}
                        <br />
                        <small className="text-muted">
                          {p.created_by || '—'} · {hasVitals ? `${p.vitals_count} vitals` : 'No vitals'} ·{' '}
                          <span className={isLongWait ? 'text-danger fw-semibold' : ''}>
                            {formatWaitTime(p.minutes_waiting)}{isLongWait ? ' (long wait)' : ''}
                          </span>
                        </small>
                        {isIncomplete && missing.length > 0 && (
                          <>
                            <br />
                            <small className="text-muted" style={{ fontSize: '0.68rem' }}>
                              Still needed: {missing.join(', ')}
                            </small>
                          </>
                        )}
                      </div>
                      <select
                        className="form-select form-select-sm"
                        style={{ width: '150px', fontSize: '0.72rem' }}
                        value={assignProvider[p.id] || ''}
                        onChange={(e) => setAssignProvider((prev) => ({ ...prev, [p.id]: e.target.value }))}
                      >
                        <option value="">Assign provider…</option>
                        {providers.filter((pr: any) => pr.main_menu_role === 'standard').map((pr: any) => (
                          <option key={pr.id} value={pr.id}>Dr. {pr.fname} {pr.lname}</option>
                        ))}
                      </select>
                      {/* Billing: insurance decision at approval */}
                      <select
                        className="form-select form-select-sm"
                        style={{ width: '140px', fontSize: '0.72rem' }}
                        value={coverage[p.id]?.type || 'self_pay'}
                        onChange={(e) => setCoverage((prev) => ({ ...prev, [p.id]: { type: e.target.value, percent: prev[p.id]?.percent || '40' } }))}
                        title="Billing coverage"
                      >
                        <option value="self_pay">No insurance</option>
                        <option value="insured">Insured</option>
                      </select>
                      {(coverage[p.id]?.type === 'insured') && (
                        <div className="input-group input-group-sm" style={{ width: '110px' }}>
                          <input
                            type="number" min={0} max={100}
                            className="form-control form-control-sm text-end"
                            value={coverage[p.id]?.percent ?? '40'}
                            onChange={(e) => setCoverage((prev) => ({ ...prev, [p.id]: { type: 'insured', percent: e.target.value } }))}
                            title="Patient responsibility %"
                          />
                          <span className="input-group-text px-1" style={{ fontSize: '0.7rem' }}>% pt</span>
                        </div>
                      )}
                      <button
                        className="btn btn-success btn-sm rounded-pill"
                        onClick={() => approveMutation.mutate({
                          id: p.id,
                          providerID: assignProvider[p.id],
                          insuranceType: coverage[p.id]?.type || 'self_pay',
                          patientPercent: Number(coverage[p.id]?.percent ?? 40),
                        })}
                        disabled={approveMutation.isPending}
                        title="Approve & assign provider"
                      >
                        {approveMutation.isPending ? (
                          <span className="spinner-border spinner-border-sm"></span>
                        ) : (
                          <><i className="bi bi-check-lg"></i></>
                        )}
                      </button>
                    </div>
                  );
                })
              )}
              {pendingPatients.length > 6 && (
                <div className="text-center py-2">
                  <small className="text-muted">+{pendingPatients.length - 6} more pending</small>
                </div>
              )}
            </div>
          </div>

          {/* Provider Day Schedule */}
          <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '16px' }}>
            <div className="card-header bg-white d-flex justify-content-between align-items-center py-3" style={{ borderRadius: '16px 16px 0 0' }}>
              <h6 className="mb-0 fw-bold">
                <i className="bi bi-calendar2-plus me-2 text-primary"></i>Provider Day Schedule
              </h6>
              <span className="badge bg-primary rounded-pill">{providerSchedule.filter((p: any) => p.onSchedule).length} on schedule</span>
            </div>
            <div className="card-body">
              {providerSchedule.map((p: any) => (
                <div key={p.id} className="d-flex align-items-center gap-2 py-1 border-bottom">
                  <span className="rounded-circle d-inline-block" style={{ width: '10px', height: '10px', backgroundColor: p.calendar_color || '#0d6efd' }}></span>
                  <div className="flex-grow-1">
                    <small className="fw-semibold">{p.title ? `${p.title} ` : ''}{p.fname} {p.lname}</small>
                    <br />
                    <small className="text-muted">
                      {p.onSchedule
                        ? p.blocks.map((b: any) => `${b.pc_startTime?.substring(0, 5)}–${b.pc_endTime?.substring(0, 5)}`).join(', ')
                        : 'Not on schedule'}
                    </small>
                  </div>
                  {p.onSchedule && user?.role === 'admin' && (
                    <button className="btn btn-outline-danger btn-sm py-0 px-1" title="Remove from schedule"
                      onClick={() => p.blocks.forEach((b: any) => removeScheduleMutation.mutate(b.pc_eid))}>
                      <i className="bi bi-x-lg"></i>
                    </button>
                  )}
                </div>
              ))}
              <hr className="my-2" />
              <div className="small fw-semibold text-muted mb-1">Add provider to today's schedule</div>
              <div className="d-flex gap-2 flex-wrap">
                <select className="form-select form-select-sm" style={{ flex: '1 1 140px' }} value={scheduleProviderId} onChange={(e) => setScheduleProviderId(e.target.value)}>
                  <option value="">Provider…</option>
                  {providerSchedule.filter((p: any) => !p.onSchedule).map((p: any) => (
                    <option key={p.id} value={p.id}>{p.fname} {p.lname}</option>
                  ))}
                </select>
                <input type="time" className="form-control form-control-sm" style={{ width: '110px' }} value={scheduleStart} onChange={(e) => setScheduleStart(e.target.value)} />
                <input type="time" className="form-control form-control-sm" style={{ width: '110px' }} value={scheduleEnd} onChange={(e) => setScheduleEnd(e.target.value)} />
                <button className="btn btn-primary btn-sm rounded-pill" onClick={() => addScheduleMutation.mutate()} disabled={!scheduleProviderId || addScheduleMutation.isPending}>
                  {addScheduleMutation.isPending ? 'Adding…' : <><i className="bi bi-plus-lg me-1"></i>Add</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
