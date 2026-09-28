import { useState, useMemo, useCallback, useRef } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import nestClient from '../../api/nest-client';
import RecentApprovalsPanel from '../../components/shared/RecentApprovalsPanel';
import { groupOrdersByPatient } from '../../utils/groupOrdersByPatient';
import { useMessagingSocket, MessagingEvent } from '../../hooks/useMessagingSocket';
import { canViewFinancials, maskFinancial } from '../../utils/permissions';
import { formatPatientNameLastFirst } from '../../utils/patientName';
import { formatDateOnly } from '../../utils/date';
import { chartPatientId } from '../../utils/patientChart';
import { LevelBadge, TriageLegend } from '../emergency/components/LevelBadge';
import { emergencyAccent, waitClock } from '../../utils/triage';

export default function ProviderDashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [expandedPatient, setExpandedPatient] = useState<number | null>(null);
  const [patientSearch, setPatientSearch] = useState('');
  // Lab notification card: which patient row is expanded, and whether to show all.
  const [labNotifyExpanded, setLabNotifyExpanded] = useState<string | null>(null);
  const [labNotifyShowAll, setLabNotifyShowAll] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['provider-dashboard'],
    queryFn: async () => {
      const r = await nestClient.get('/provider/dashboard');
      return r.data;
    },
  });

  // Patient chat notifications (unread count + recent messages)
  const { data: chatUnread } = useQuery({
    queryKey: ['provider-chat-unread'],
    queryFn: async () => {
      const r = await nestClient.get('/chat/unread');
      return r.data || { count: 0, messages: [] };
    },
    refetchInterval: 20000,
  });
  const unreadCount = chatUnread?.count || 0;
  const unreadChatMessages = chatUnread?.messages || [];

  // Ready lab results for this provider — surfaced as a notification on the Order Labs quick action.
  const { data: providerLabOrders = [] } = useQuery({
    queryKey: ['provider-lab-orders'],
    queryFn: async () => { const r = await nestClient.get('/provider/lab-orders'); return r.data; },
    refetchInterval: 20000,
  });
  // "completed" = results entered, "validated" = released by the lab. Both need review.
  const readyLabs = (providerLabOrders || []).filter((o: any) =>
    ['completed', 'validated'].includes(o.orderStatus),
  ).length;

  // Lab notifications: validated results ready to view, routed to this provider
  // because they ordered the lab or are the patient's currently-assigned provider.
  const { data: labNotify } = useQuery({
    queryKey: ['provider-lab-notifications'],
    queryFn: async () => { const r = await nestClient.get('/provider/lab-notifications'); return r.data; },
    refetchInterval: 20000,
  });
  const labNotifications: any[] = labNotify?.notifications || [];
  const labReadyOrders: any[] = labNotify?.readyOrders || [];
  const labUnread: number = labNotify?.unreadCount || 0;

  const ackLabNotification = useMutation({
    mutationFn: (id: number) => nestClient.post(`/provider/lab-notifications/${id}/ack`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['provider-lab-notifications'] }),
  });

  // Smart display: collapse the raw notification list into one compact row per
  // patient so the card stays short instead of listing every result notice.
  const labNotifyGroups = useMemo(() => {
    // Older notices were written with pid = 0, so they have no patient row to
    // join against. Fall back to the name embedded in the title and group by
    // that, so they collapse into one row per patient instead of one row each.
    const nameFromTitle = (t: unknown): string => {
      const m = String(t || '').match(/Lab Results Ready:\s*(.+?)\s+—/);
      return m ? m[1].trim() : '';
    };

    const map = new Map<string, any>();
    for (const n of labNotifications) {
      const chartId = Number(n.patientId ?? n.patientPid ?? n.pid) || 0;
      const name = n.patientName || nameFromTitle(n.title) || 'Unlinked notice';
      const key = chartId > 0 ? `id:${chartId}` : `name:${name.toLowerCase()}`;
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          chartId,
          name,
          items: [] as any[],
          unread: 0,
          latest: n.date,
          critical: false,
        };
        map.set(key, g);
      }
      g.items.push(n);
      if (String(n.messageStatus || '').toLowerCase() !== 'done') g.unread += 1;
      if (/critical|⚠️/i.test(String(n.title || ''))) g.critical = true;
      if (n.date && (!g.latest || String(n.date) > String(g.latest))) g.latest = n.date;
    }
    return Array.from(map.values()).sort((a: any, b: any) =>
      String(b.latest || '').localeCompare(String(a.latest || '')),
    );
  }, [labNotifications]);

  /** Keep an expanded group readable — cap the visible notices. */
  const LAB_NOTICE_LIMIT = 6;

  const visibleLabGroups = labNotifyShowAll ? labNotifyGroups : labNotifyGroups.slice(0, 3);

  // Pharmacy notification — prescriptions billed but not yet paid/cleared.
  const { data: pharmacyRx = [] } = useQuery({
    queryKey: ['provider-pharmacy-notify'],
    queryFn: async () => { const r = await nestClient.get('/prescriptions'); return r.data; },
    refetchInterval: 20000,
  });
  const pharmacyNotify = (pharmacyRx || []).filter((p: any) => p.billed && !p.paid).length;

  const [chatToasts, setChatToasts] = useState<any[]>([]);
  const toastId = useRef(0);
  const addChatToast = useCallback((title: string, bodyText: string) => {
    const id = ++toastId.current;
    setChatToasts((p) => [...p.slice(-2), { id, title, body: bodyText }]);
    setTimeout(() => setChatToasts((p) => p.filter((x) => x.id !== id)), 6000);
  }, []);

  // Real-time patient message notifications on the dashboard
  useMessagingSocket({
    onNewMessage: (event: MessagingEvent) => {
      if (event.topic === 'openrx.messages.patient-chat') {
        queryClient.invalidateQueries({ queryKey: ['provider-chat-unread'] });
        queryClient.invalidateQueries({ queryKey: ['chat-patients'] });
        addChatToast(
          'New patient message',
          event.payload?.body || event.payload?.title || 'A patient sent you a message',
        );
      }
    },
  });

  // Lab orders — single shared queue synced across Lab Management, Lab Orders, and provider views
  const { data: labOrders = [] } = useQuery({
    queryKey: ['all-lab-orders'],
    queryFn: async () => {
      const r = await nestClient.get('/lab/orders');
      return r.data;
    },
    refetchInterval: 15000,
  });

  // Smart grouping: one patient name per set of lab orders.
  const groupedLabOrders = useMemo(() => groupOrdersByPatient(labOrders), [labOrders]);


  if (isLoading) {
    return (
      <div className="d-flex justify-content-center align-items-center" style={{ minHeight: '60vh' }}>
        <div className="text-center">
          <div className="spinner-grow text-primary mb-3" style={{ width: '3rem', height: '3rem' }} role="status" />
          <p className="text-muted">Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  const { provider, stats, todayAppointments, assignedPatients, emergencyPatients, emergency, recentEncounters, date, syncedAt } = data || {};
  const pendingCount = stats?.pending || 0;
  const completedCount = stats?.completed || 0;
  const totalCount = stats?.todayAppointments || 0;
  const totalAssigned = stats?.totalPatients || 0;
  // Patients of this clinician who are in the department right now, in the board's
  // order (sickest, then longest waiting) and the board's colours.
  const inDepartment: any[] = emergencyPatients || [];

  const EXCHANGE = 193;
  const fmtLrd = (usd: number) => `L$${Math.round(usd * EXCHANGE).toLocaleString('en-US')}`;

  const togglePatient = (id: number) => {
    setExpandedPatient(expandedPatient === id ? null : id);
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
      {/* Patient message toasts */}
      <div className="position-fixed bottom-0 end-0 p-3" style={{ zIndex: 9999 }}>
        {chatToasts.map((t: any) => (
          <div key={t.id} className="toast show align-items-center text-bg-info border-0 mb-2">
            <div className="d-flex">
              <div className="toast-body small"><strong>{t.title}</strong><br />{t.body}</div>
              <button className="btn-close btn-close-white me-2 m-auto" onClick={() => setChatToasts((p) => p.filter((x) => x.id !== t.id))}></button>
            </div>
          </div>
        ))}
      </div>

      {/* Header */}
      <div className="rounded-4 p-4 mb-4 text-white position-relative overflow-hidden" style={{
        background: 'linear-gradient(135deg, #0d6efd 0%, #6610f2 50%, #6f42c1 100%)',
      }}>
        <div className="position-absolute end-0 top-0 opacity-10" style={{ fontSize: '7rem', transform: 'rotate(10deg) translate(20px,-10px)' }}>
          <i className="bi bi-heart-pulse"></i>
        </div>
        <div className="position-relative">
          <div className="d-flex justify-content-between align-items-start">
            <div>
              <h2 className="mb-1 fw-bold">
                {provider?.title ? `${provider.title} ` : ''}{provider?.fname} {provider?.lname}
              </h2>
              <div className="d-flex gap-3 text-white text-opacity-75 small">
                {provider?.specialty && <span><i className="bi bi-briefcase me-1"></i>{provider.specialty}</span>}
                {provider?.npi && <span><i className="bi bi-upc me-1"></i>NPI: {provider.npi}</span>}
                <span><i className="bi bi-calendar3 me-1"></i>{date}</span>
                {syncedAt && (
                  <span title={`Last synced: ${new Date(syncedAt).toLocaleTimeString()}`}>
                    <i className="bi bi-arrow-repeat me-1"></i>Synced
                  </span>
                )}
              </div>
            </div>
            <div className="d-flex gap-2">
              <button className="btn btn-light btn-sm rounded-pill" onClick={() => navigate('/appointments')}>
                <i className="bi bi-calendar-plus me-1"></i>Schedule
              </button>
              <button className="btn btn-outline-light btn-sm rounded-pill" onClick={() => navigate('/providers')}>
                <i className="bi bi-people me-1"></i>All Providers
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="row g-3 mb-4">
        {[
          { value: totalCount, label: "Today's Appointments", icon: 'bi-calendar-check', color: '#0d6efd' },
          { value: pendingCount, label: 'Waiting / In Progress', icon: 'bi-hourglass-split', color: '#fd7e14' },
          { value: completedCount, label: 'Completed', icon: 'bi-check2-circle', color: '#198754' },
          { value: totalAssigned, label: 'All Patients', icon: 'bi-people', color: '#6f42c1' },
        ].map((card, i) => (
          <div className="col-md-3 col-sm-6" key={i}>
            <div className="card border-0 shadow-sm h-100" style={{ borderRadius: '16px' }}>
              <div className="card-body d-flex align-items-center gap-3 py-3">
                <div className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                  style={{ width: '52px', height: '52px', backgroundColor: `${card.color}15` }}>
                  <i className={`bi ${card.icon} fs-4`} style={{ color: card.color }}></i>
                </div>
                <div>
                  <div className="fs-3 fw-bold" style={{ color: card.color, lineHeight: 1 }}>{card.value}</div>
                  <small className="text-muted">{card.label}</small>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* New Patient Messages — doctor notification panel */}
      {unreadChatMessages.length > 0 && (
        <div className="card border-0 shadow-sm mb-4" style={{ borderRadius: '20px', borderLeft: '4px solid #0dcaf0' }}>
          <div className="card-header bg-white d-flex justify-content-between align-items-center py-3" style={{ borderRadius: '20px 20px 0 0' }}>
            <h6 className="mb-0 fw-bold"><i className="bi bi-chat-dots me-2 text-info"></i>New Patient Messages</h6>
            <span className="badge bg-danger rounded-pill">{unreadCount}</span>
          </div>
          <div className="card-body p-0">
            {unreadChatMessages.slice(0, 5).map((m: any) => (
              <div key={m.id} className="d-flex align-items-center gap-2 px-3 py-2 border-bottom"
                style={{ cursor: 'pointer' }} onClick={() => navigate(`/messages/patient-chat/${m.pid}`)}>
                <i className="bi bi-envelope-exclamation text-info"></i>
                <div className="flex-grow-1 min-w-0">
                  <div className="small fw-semibold">{m.fname} {m.lname}</div>
                  <small className="text-muted text-truncate d-block">{m.body}</small>
                </div>
                <small className="text-muted">{m.date}</small>
                <i className="bi bi-chevron-right text-muted"></i>
              </div>
            ))}
          </div>
          <div className="card-footer bg-white py-2 text-center">
            <button className="btn btn-link btn-sm text-decoration-none" onClick={() => navigate('/messages/patient-chat')}>
              <i className="bi bi-chat-dots me-1"></i>Open Patient Chat
            </button>
          </div>
        </div>
      )}

      {/* Emergency patients assigned to this clinician. Above the schedule on
          purpose: someone waiting in the department outranks a booked slot. */}
      {inDepartment.length > 0 && (
        <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '20px', borderLeft: `8px solid ${emergencyAccent(inDepartment[0])}` }}>
          <div className="card-header bg-white d-flex flex-wrap justify-content-between align-items-center gap-2 py-3" style={{ borderRadius: '20px 20px 0 0' }}>
            <h6 className="mb-0 fw-bold">
              <i className="bi bi-clipboard2-pulse me-2 text-danger"></i>In the emergency department
              <span className="badge ms-2" style={{ backgroundColor: emergencyAccent(inDepartment[0]) }}>
                {inDepartment.length}
              </span>
              {emergency?.breached > 0 && (
                <span className="badge bg-danger ms-1" title="Past their target time for being seen">
                  {emergency.breached} past target
                </span>
              )}
            </h6>
            <div className="d-flex align-items-center gap-2">
              <TriageLegend compact />
              <button className="btn btn-sm btn-outline-danger rounded-pill" onClick={() => navigate('/emergency')}>
                <i className="bi bi-box-arrow-up-right me-1"></i>Board
              </button>
            </div>
          </div>
          <div className="card-body p-0">
            {inDepartment.map((visit: any) => {
              const clock = waitClock(visit);
              const accent = emergencyAccent(visit);
              const chartId = chartPatientId(visit.patientId, visit.pid);
              return (
                <div key={visit.id} className="d-flex flex-wrap align-items-center gap-3 px-3 py-3 border-bottom"
                  style={{ borderLeft: `6px solid ${accent}`, cursor: chartId ? 'pointer' : 'default' }}
                  onClick={() => { if (chartId) navigate(`/patients/${chartId}`); }}>
                  <LevelBadge level={visit.level} />
                  <div className="flex-grow-1">
                    <div className="fw-semibold">
                      {visit.patientName || 'Unnamed patient'}
                      {visit.patientPublicId && <span className="text-muted small ms-2">{visit.patientPublicId}</span>}
                    </div>
                    <div className="small text-muted">
                      {visit.chiefComplaint || 'no presenting complaint recorded'}
                      {visit.room ? ` · ${visit.room}` : ''}
                    </div>
                  </div>
                  <div className="text-end">
                    <div className="fw-semibold" style={{ color: clock.breached ? '#dc3545' : accent }}>
                      {clock.text}
                    </div>
                    <div className="small text-muted">
                      {visit.targetMinutes === 0 ? 'immediate' : `${visit.targetMinutes} min target`}
                      {clock.breached ? ` · ${Math.round(visit.overByMinutes || 0)}m over` : ''}
                    </div>
                    <div className="small text-muted">{String(visit.status || '').replace('_', ' ')}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="row g-3">
        {/* Today's Schedule */}
        <div className="col-lg-5">
          <div className="card border-0 shadow-sm" style={{ borderRadius: '20px' }}>
            <div className="card-header bg-white d-flex justify-content-between align-items-center py-3" style={{ borderRadius: '20px 20px 0 0' }}>
              <h6 className="mb-0 fw-bold"><i className="bi bi-calendar-check me-2 text-primary"></i>Today's Schedule</h6>
              <span className="badge bg-primary rounded-pill">{todayAppointments?.length || 0} appts</span>
            </div>
            <div className="card-body p-0" style={{ maxHeight: '500px', overflow: 'auto' }}>
              {todayAppointments?.length > 0 ? (
                todayAppointments.map((apt: any) => (
                  <div key={apt.pc_eid} className={`d-flex align-items-center gap-3 px-3 py-3 border-bottom ${apt.pc_apptstatus === 'Checkout' ? 'bg-light opacity-50' : ''}`}
                    style={{ cursor: 'pointer' }} onClick={() => { const cid = chartPatientId(apt.patient_id, apt.pc_pid); if (cid) navigate(`/patients/${cid}`); }}>
                    <div className="text-center flex-shrink-0" style={{ width: '55px' }}>
                      <div className="fw-bold small">{apt.pc_startTime?.substring(0, 5)}</div>
                      {apt.pc_endTime && <small className="text-muted">{apt.pc_endTime.substring(0, 5)}</small>}
                    </div>
                    <div className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                      style={{ width: '36px', height: '36px', backgroundColor: apt.pc_catcolor ? `${apt.pc_catcolor}20` : '#0d6efd20' }}>
                      <span className="fw-bold small" style={{ color: apt.pc_catcolor || '#0d6efd' }}>
                        {apt.patientFname?.[0]}{apt.patientLname?.[0]}
                      </span>
                    </div>
                    <div className="flex-grow-1 min-w-0">
                      <div className="fw-semibold small">{apt.patientLname}, {apt.patientFname}</div>
                      <small className="text-muted">{apt.pc_catname || apt.pc_title}</small>
                    </div>
                    <span className={`badge rounded-pill ${apt.pc_apptstatus === 'Checkout' ? 'bg-success' : apt.pc_apptstatus === 'Check In' ? 'bg-info' : 'bg-warning text-dark'}`}>
                      {apt.pc_apptstatus === 'Checkout' ? 'Done' : apt.pc_apptstatus === 'Check In' ? 'In' : 'Scheduled'}
                    </span>
                  </div>
                ))
              ) : (
                <div className="text-center text-muted py-5">
                  <i className="bi bi-calendar-x fs-1 d-block mb-2 opacity-25"></i>
                  <p className="small">No appointments today</p>
                </div>
              )}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="card border-0 shadow-sm mt-3" style={{ borderRadius: '20px' }}>
            <div className="card-header bg-white py-3" style={{ borderRadius: '20px 20px 0 0' }}>
              <h6 className="mb-0 fw-bold"><i className="bi bi-lightning-charge me-2 text-warning"></i>Quick Actions</h6>
            </div>
            <div className="card-body">
              <div className="row g-2">
                {[
                  { label: 'Order Labs', icon: 'bi-flask', color: '#fd7e14', path: '/labs', badge: readyLabs },
                  { label: 'Drug Info', icon: 'bi-capsule', color: '#6f42c1', path: '/drug-info' },
                  { label: 'Patient Flow', icon: 'bi-kanban', color: '#198754', path: '/appointments/flow' },
                  { label: 'Messages', icon: 'bi-chat-dots', color: '#0dcaf0', path: '/messages', badge: unreadCount },
                  { label: 'Pharmacy', icon: 'bi-capsule-pill', color: '#dc3545', path: '/pharmacy', badge: pharmacyNotify },
                  { label: 'Referrals', icon: 'bi-send', color: '#0d6efd', path: '/referrals' },
                ].map((action, i) => (
                  <div className="col-6" key={i}>
                    <button className="btn btn-light w-100 text-start d-flex align-items-center gap-2 py-2 position-relative"
                      style={{ borderRadius: '12px' }} onClick={() => navigate(action.path)}>
                      <i className={`bi ${action.icon}`} style={{ color: action.color }}></i>
                      <small className="fw-semibold">{action.label}</small>
                      {'badge' in action && (action as any).badge > 0 && (
                        <span className="position-absolute top-0 end-0 translate-middle badge rounded-pill bg-danger"
                          style={{ fontSize: '0.6rem' }}>
                          {(action as any).badge}
                        </span>
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* All Patients — Expandable Cards with Treatment Actions */}
        <div className="col-lg-7">
          <div className="card border-0 shadow-sm" style={{ borderRadius: '20px' }}>
            <div className="card-header bg-white d-flex justify-content-between align-items-center py-3" style={{ borderRadius: '20px 20px 0 0' }}>
              <h6 className="mb-0 fw-bold">
                <i className="bi bi-people me-2 text-success"></i>All Patients
                <small className="text-muted ms-2 fw-normal">Click to examine & treat</small>
              </h6>
              <div className="d-flex align-items-center gap-2">
                <div className="input-group input-group-sm" style={{ maxWidth: '220px' }}>
                  <span className="input-group-text bg-white"><i className="bi bi-search"></i></span>
                  <input className="form-control form-control-sm" placeholder="Search patients…" value={patientSearch} onChange={e => setPatientSearch(e.target.value)} />
                </div>
                <span className="badge bg-success rounded-pill">{assignedPatients?.length || 0}</span>
              </div>
            </div>
            <div className="card-body p-2" style={{ maxHeight: '560px', overflow: 'auto' }}>
              {(assignedPatients || []).filter((p: any) => `${p.fname} ${p.lname}`.toLowerCase().includes(patientSearch.trim().toLowerCase())).map((p: any) => {
                const isExpanded = expandedPatient === p.id;
                const daysAgo = p.days_since_registration || 0;
                return (
                  <div key={p.id} className="card border-0 shadow-sm mb-2" style={{
                    borderRadius: '14px',
                    transition: 'all 0.2s',
                    borderLeft: isExpanded ? '4px solid #198754' : '4px solid transparent',
                  }}>
                    {/* Patient Header — click to expand */}
                    <div className="card-body p-3" style={{ cursor: 'pointer' }}
                      onClick={() => togglePatient(p.id)}>
                      <div className="d-flex align-items-center gap-3">
                        <div className="rounded-circle bg-success bg-opacity-10 d-flex align-items-center justify-content-center flex-shrink-0"
                          style={{ width: '44px', height: '44px' }}>
                          <span className="fw-bold text-success">{p.fname?.[0]}{p.lname?.[0]}</span>
                        </div>
                        <div className="flex-grow-1 min-w-0">
                          <div className="d-flex justify-content-between align-items-start">
                            <div>
                              <div className="fw-semibold small">{formatPatientNameLastFirst(p)}</div>
                              <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                                {formatDateOnly(p.DOB)} · {p.sex || '—'} · PID #{p.pid}
                                {p.status && p.status !== 'active' && <span className="text-warning ms-1">· {p.status}</span>}
                              </div>
                            </div>
                            <div className="d-flex align-items-center gap-2">
                              {daysAgo > 0 && <small className="text-muted">{daysAgo}d ago</small>}
                              <i className={`bi bi-chevron-${isExpanded ? 'up' : 'down'} text-muted`}></i>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Synced Info — always visible on card */}
                    <div className="px-3 pt-1 pb-2" style={{ fontSize: '0.7rem' }}>
                      <div className="d-flex flex-wrap gap-2 text-muted">
                        {/* Billing */}
                        <span className={!canViewFinancials(user) ? 'text-muted' : p.balance > 0 ? 'text-danger fw-semibold' : 'text-success'}>
                          <i className="bi bi-cash me-1"></i>
                          {!canViewFinancials(user) ? `Billing ${maskFinancial(p.balance)}` : p.balance > 0 ? `${fmtLrd(p.balance)} due` : 'Cleared'}
                        </span>
                        {/* Last Visit */}
                        {p.lastEncounterDate && (
                          <span>
                            <i className="bi bi-clock-history me-1"></i>
                            Seen {p.daysSinceLastEncounter === 0 ? 'today' : `${p.daysSinceLastEncounter}d ago`}
                          </span>
                        )}
                        {/* Next Appointment */}
                        {p.nextApptDate && (
                          <span>
                            <i className="bi bi-calendar3 me-1"></i>
                            {p.nextApptDate === date ? 'Today' : p.nextApptDate} {p.nextApptTime?.substring(0, 5)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Expanded Treatment Panel */}
                    {isExpanded && (
                      <div className="px-3 pb-3 border-top" style={{ background: '#f8f9fa', borderRadius: '0 0 14px 14px' }}>
                        {/* Quick Info Bar */}
                        <div className="d-flex gap-2 mt-2 mb-2 flex-wrap">
                          <span className="badge bg-light text-dark border"><i className="bi bi-telephone me-1"></i>{p.phone_contact || 'No phone'}</span>
                          <span className="badge bg-light text-dark border"><i className="bi bi-envelope me-1"></i>{p.email || 'No email'}</span>
                          <span className="badge bg-light text-dark border"><i className="bi bi-clock me-1"></i>Registered {p.regdate ? new Date(p.regdate).toLocaleDateString() : '—'}</span>
                          {p.lastEncounterDate && (
                            <span className="badge bg-light text-dark border">
                              <i className="bi bi-file-text me-1"></i>Last: {p.lastEncounterReason || 'Visit'} ({p.lastEncounterDate?.split(' ')[0]})
                            </span>
                          )}
                        </div>

                        {/* Billing + Schedule Sync Row */}
                        <div className="row g-2 mb-2">
                          <div className="col-6">
                            <div className={`p-2 rounded-3 small ${!canViewFinancials(user) ? 'bg-light' : p.balance > 0 ? 'bg-danger bg-opacity-10' : 'bg-success bg-opacity-10'}`}>
                              <div className="text-muted" style={{fontSize:'0.65rem'}}>Billing</div>
                              {canViewFinancials(user) ? (
                                <>
                                  <div className="fw-bold" style={{color: p.balance > 0 ? '#dc3545' : '#198754'}}>
                                    {p.balance > 0 ? fmtLrd(p.balance) : 'Cleared'}
                                  </div>
                                  <div className="text-muted" style={{fontSize:'0.6rem'}}>
                                    Charges: {fmtLrd(p.totalCharges || 0)} · Paid: {fmtLrd(p.totalPayments || 0)}
                                  </div>
                                </>
                              ) : (
                                <div className="fw-bold text-muted">{maskFinancial(p.balance)}</div>
                              )}
                            </div>
                          </div>
                          <div className="col-6">
                            <div className="p-2 rounded-3 small bg-info bg-opacity-10">
                              <div className="text-muted" style={{fontSize:'0.65rem'}}>Next Appointment</div>
                              <div className="fw-bold text-info">
                                {p.nextApptDate ? `${p.nextApptDate} ${p.nextApptTime?.substring(0, 5)}` : 'None scheduled'}
                              </div>
                              <div className="text-muted" style={{fontSize:'0.6rem'}}>
                                {p.nextApptCategory || '—'} · {p.nextApptStatus || '—'}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Treatment Actions */}
                        <div className="row g-2">
                          {[
                            { label: 'Start Screening', icon: 'bi-clipboard2-pulse', color: '#0d6efd', desc: 'Vitals, Prescribe, Labs & Notes',
                              action: () => navigate(`/patients/${p.id}/screening`) },
                            { label: 'Order Labs', icon: 'bi-flask', color: '#fd7e14', desc: 'Blood work, cultures, panels',
                              action: () => navigate(`/labs`) },
                            { label: 'Prescribe', icon: 'bi-prescription2', color: '#6f42c1', desc: 'Write & send e-prescriptions',
                              action: () => navigate(`/pharmacy`) },
                            { label: 'Record Vitals', icon: 'bi-heart-pulse', color: '#dc3545', desc: 'BP, pulse, temp, O₂, weight',
                              action: () => { const cid = chartPatientId(p.id, p.pid); if (cid) navigate(`/patients/${cid}`); } },
                            { label: 'Imaging', icon: 'bi-image', color: '#20c997', desc: 'Order X-ray, DICOM, ultrasound',
                              action: () => navigate(`/dicom`) },
                            { label: 'Refer to Specialist', icon: 'bi-send', color: '#0dcaf0', desc: 'Create referral to specialist',
                              action: () => navigate(`/referrals`) },
                          ].map((btn, i) => (
                            <div className="col-md-6" key={i}>
                              <button className="btn btn-light w-100 text-start d-flex align-items-center gap-3 py-2 px-3 border"
                                style={{ borderRadius: '12px', transition: 'all 0.15s' }}
                                onClick={(e) => { e.stopPropagation(); btn.action(); }}
                                onMouseEnter={e => { e.currentTarget.style.background = btn.color; e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = btn.color; }}
                                onMouseLeave={e => { e.currentTarget.style.background = ''; e.currentTarget.style.color = ''; e.currentTarget.style.borderColor = ''; }}>
                                <div className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                                  style={{ width: '36px', height: '36px', backgroundColor: `${btn.color}20` }}>
                                  <i className={`bi ${btn.icon}`} style={{ color: btn.color }}></i>
                                </div>
                                <div className="min-w-0">
                                  <div className="fw-semibold small">{btn.label}</div>
                                  <small className="text-muted" style={{ fontSize: '0.7rem' }}>{btn.desc}</small>
                                </div>
                              </button>
                            </div>
                          ))}
                        </div>

                        {/* Open Full Chart */}
                        <div className="text-center mt-2">
                          <button className="btn btn-outline-success btn-sm rounded-pill"
                            onClick={(e) => { e.stopPropagation(); const cid = chartPatientId(p.id, p.pid); if (cid) navigate(`/patients/${cid}`); }}>
                            <i className="bi bi-folder2-open me-1"></i>Open Full Patient Chart
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {(!assignedPatients || assignedPatients.length === 0) && (
                <div className="text-center text-muted py-5">
                  <i className="bi bi-people fs-1 d-block mb-2 opacity-25"></i>
                  <p className="small">No patients assigned yet</p>
                </div>
              )}
            </div>
          </div>

          {/* Recent Visits */}
          {recentEncounters?.length > 0 && (
            <div className="card border-0 shadow-sm mt-3" style={{ borderRadius: '20px' }}>
              <div className="card-header bg-white py-3" style={{ borderRadius: '20px 20px 0 0' }}>
                <h6 className="mb-0 fw-bold"><i className="bi bi-clock-history me-2 text-info"></i>Recent Visits</h6>
              </div>
              <div className="card-body p-0">
                {recentEncounters.map((enc: any, i: number) => (
                  <div key={i} className="d-flex align-items-center gap-2 px-3 py-2 border-bottom"
                    style={{ cursor: 'pointer' }} onClick={() => navigate(`/patients/${enc.pid}/encounters/${enc.id}`)}>
                    <i className="bi bi-file-text text-info"></i>
                    <div className="flex-grow-1 min-w-0">
                      <div className="small text-truncate"><strong>{enc.lname}, {enc.fname}</strong></div>
                      <small className="text-muted">{enc.date} — {enc.reason || 'Visit'}</small>
                    </div>
                    <i className="bi bi-chevron-right text-muted small"></i>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Lab Results Ready to View — notification pushed from the lab */}
      {(labUnread > 0 || labReadyOrders.length > 0) && (
        <div className="mt-4">
          <div className="card border-0 shadow-sm" style={{ borderRadius: '20px' }}>
            <div className="card-header bg-white d-flex justify-content-between align-items-center py-3" style={{ borderRadius: '20px 20px 0 0' }}>
              <h6 className="mb-0 fw-bold">
                <i className="bi bi-bell-fill me-2 text-danger"></i>Lab Results Ready to View
                {labUnread > 0 && <span className="badge bg-danger rounded-pill ms-2">{labUnread} new</span>}
              </h6>
              <span className="badge bg-primary rounded-pill">
                {labNotifyGroups.length} patient{labNotifyGroups.length !== 1 ? 's' : ''} · {labReadyOrders.length} validated
              </span>
            </div>
            <div className="card-body p-0">
              {labNotifyGroups.length === 0 && (
                <div className="text-center text-muted small py-3">No lab notifications yet</div>
              )}
              {visibleLabGroups.map((g: any) => {
                const open = labNotifyExpanded === g.key;
                return (
                  <div key={g.key} className="border-bottom">
                    <div className="d-flex align-items-center gap-2 px-3 py-2"
                      style={{ background: g.unread > 0 ? '#0d6efd0a' : 'transparent', cursor: 'pointer' }}
                      onClick={() => setLabNotifyExpanded(open ? null : g.key)}>
                      <div className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                        style={{ width: '30px', height: '30px', backgroundColor: g.unread > 0 ? '#dc354520' : '#6c757d20' }}>
                        <i className={`bi ${g.critical ? 'bi-exclamation-triangle-fill' : 'bi-droplet'} ${g.unread > 0 ? 'text-danger' : 'text-secondary'}`}></i>
                      </div>
                      <div className="flex-grow-1 min-w-0">
                        <div className="fw-semibold small text-truncate">{g.name}</div>
                        <small className="text-muted" style={{ fontSize: '0.65rem' }}>
                          {g.items.length} result notice{g.items.length !== 1 ? 's' : ''}
                          {g.unread > 0 ? ` · ${g.unread} unread` : ' · all read'}
                        </small>
                      </div>
                      {g.chartId > 0 ? (
                        <button className="btn btn-primary btn-sm rounded-pill py-0 px-2 flex-shrink-0" style={{ fontSize: '0.65rem' }}
                          onClick={(e) => { e.stopPropagation(); navigate(`/patients/${g.chartId}`); }}>
                          <i className="bi bi-eye me-1"></i>View
                        </button>
                      ) : (
                        <span className="badge bg-light text-muted border flex-shrink-0" style={{ fontSize: '0.6rem' }}
                          title="This notice was recorded before the patient reference was stored, so it has no chart link.">
                          no chart link
                        </span>
                      )}
                      <i className={`bi bi-chevron-${open ? 'up' : 'down'} text-muted small flex-shrink-0`}></i>
                    </div>
                    {open && (
                      <div className="px-3 pb-2">
                        {g.items.slice(0, LAB_NOTICE_LIMIT).map((n: any) => {
                          const isNew = String(n.messageStatus || '').toLowerCase() !== 'done';
                          return (
                            <div key={n.id} className="d-flex align-items-center gap-2 py-1 ms-4">
                              <i className={`bi bi-dot flex-shrink-0 ${isNew ? 'text-danger' : 'text-muted'}`}></i>
                              <div className="flex-grow-1 min-w-0">
                                <div className={`text-truncate ${isNew ? 'fw-semibold' : 'text-muted'}`} style={{ fontSize: '0.72rem' }}
                                  title={String(n.title || '')}>
                                  {String(n.title || '').replace(/^\S*\s*/, '')}
                                </div>
                                <small className="text-muted" style={{ fontSize: '0.6rem' }}>
                                  {n.date ? new Date(n.date).toLocaleString() : ''}
                                </small>
                              </div>
                              {isNew && (
                                <button className="btn btn-outline-secondary btn-sm rounded-pill py-0 px-2 flex-shrink-0" style={{ fontSize: '0.6rem' }}
                                  disabled={ackLabNotification.isPending}
                                  onClick={() => ackLabNotification.mutate(n.id)}>
                                  Mark read
                                </button>
                              )}
                            </div>
                          );
                        })}
                        {g.items.length > LAB_NOTICE_LIMIT && (
                          <div className="text-muted ms-4" style={{ fontSize: '0.6rem' }}>
                            +{g.items.length - LAB_NOTICE_LIMIT} more notice{g.items.length - LAB_NOTICE_LIMIT !== 1 ? 's' : ''}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {labNotifyGroups.length > 3 && (
              <div className="card-footer bg-white py-2 text-center">
                <button className="btn btn-link btn-sm text-decoration-none" onClick={() => setLabNotifyShowAll((v) => !v)}>
                  {labNotifyShowAll ? 'Show less' : `Show all ${labNotifyGroups.length} patients`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Lab Orders Status — grouped by patient */}
      {groupedLabOrders.length > 0 && (
        <div className="mt-4">
          <div className="card border-0 shadow-sm" style={{ borderRadius: '20px' }}>
            <div className="card-header bg-white d-flex justify-content-between py-3" style={{ borderRadius: '20px 20px 0 0' }}>
              <h6 className="mb-0 fw-bold"><i className="bi bi-flask me-2 text-success"></i>Lab Orders Status</h6>
              <span className="badge bg-success rounded-pill">{groupedLabOrders.length} patient{groupedLabOrders.length !== 1 ? 's' : ''} · {labOrders.length} orders</span>
            </div>
            <div className="card-body p-0">
              {groupedLabOrders.slice(0, 6).map((g: any) => (
                <div key={g.key} className="border-bottom">
                  <div className="d-flex align-items-center gap-2 px-3 py-2" style={{ background: g.hasStat ? '#dc35450f' : '#f8f9fa' }}>
                    <div className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                      style={{ width: '28px', height: '28px', backgroundColor: g.hasStat ? '#dc354520' : '#19875420' }}>
                      <span className="fw-bold" style={{ color: g.hasStat ? '#dc3545' : '#198754', fontSize: '0.65rem' }}>
                        {g.patientName?.split(' ').map((w: string) => w[0]).join('').slice(0, 2)}
                      </span>
                    </div>
                    <div className="flex-grow-1 min-w-0">
                      <div className="fw-semibold text-truncate small">{g.patientName}</div>
                      <small className="text-muted" style={{ fontSize: '0.65rem' }}>{g.count} test{g.count !== 1 ? 's' : ''}{g.hasStat ? ' · STAT priority' : ''}</small>
                    </div>
                    {g.hasStat && <span className="badge bg-danger rounded-pill" style={{ fontSize: '0.6rem' }}>STAT</span>}
                  </div>
                  {g.orders.map((o: any, i: number) => (
                    <div key={o.id || i} className="d-flex align-items-center gap-2 px-3 py-1 ms-3 small" style={{ borderTop: '1px dashed #eee' }}>
                      <div className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                        style={{ width: '24px', height: '24px', backgroundColor: `${o.statusColor}20` }}>
                        <span style={{ color: o.statusColor, fontSize: '0.6rem', fontWeight: 700 }}>{o.orderStatus?.[0]?.toUpperCase()}</span>
                      </div>
                      <div className="flex-grow-1 min-w-0">
                        <span className="small">{o.instructions || 'Lab order'}</span>
                        <span className="text-muted ms-2" style={{ fontSize: '0.6rem' }}>{o.estimatedTime}</span>
                      </div>
                      <span className="badge rounded-pill" style={{ backgroundColor: o.statusColor, color: '#fff', fontSize: '0.6rem' }}>{o.statusLabel}</span>
                      {o.hasResults && <i className="bi bi-check-circle text-success small" title="Results available"></i>}
                    </div>
                  ))}
                </div>
              ))}
            </div>
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
