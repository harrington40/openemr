import { useState, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { patientChartPath } from '../../utils/patientChart';
import nestClient from '../../api/nest-client';
import { useMessagingSocket, MessagingEvent } from '../../hooks/useMessagingSocket';
import { useAuth } from '../../hooks/useAuth';
import { formatPatientName } from '../../utils/patientName';
import { formatDateTime } from '../../utils/date';
import { NotificationFeedCard, NotificationFeedModal, FeedItem } from '../../components/notifications/NotificationFeed';

interface Toast { id: number; type: 'success'|'warning'|'info'|'danger'; title: string; body: string; priority: string; }

const PRIORITY_ORDER: Record<string, number> = { STAT: 4, URGENT: 3, HIGH: 2, NORMAL: 1, LOW: 0 };
const PRIORITY_BADGE: Record<string, string> = { STAT: 'bg-danger', URGENT: 'bg-warning text-dark', HIGH: 'bg-info text-dark', NORMAL: 'bg-light text-dark', LOW: 'bg-secondary' };
const KIND_ICON: Record<string, string> = { CLINIC: 'bi-hospital', PATIENT: 'bi-person', DIRECT: 'bi-envelope-arrow-up', EVENT: 'bi-broadcast', EVENTS: 'bi-broadcast' };

/** Parse a persisted title like "[STAT] [CLINIC] Subject" into its parts. */
function parseTitle(title?: string): { priority: string; kind: string; subject: string } {
  const t = title || '';
  const pri = ['STAT', 'URGENT', 'HIGH', 'NORMAL', 'LOW'].find(p => t.startsWith(`[${p}] `));
  let priority = 'NORMAL';
  let rest = t;
  if (pri) { priority = pri; rest = t.slice(pri.length + 3); }
  const km = rest.match(/^\[(CLINIC|PATIENT|DIRECT|EVENT|EVENTS)\]\s*/);
  const kind = km ? km[1] : 'CLINIC';
  const subject = km ? rest.slice(km[0].length) : rest;
  return { priority, kind, subject };
}

export default function MessagesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canWrite = user?.role === 'physician' || user?.role === 'admin';
  const [form, setForm] = useState({ title: '', body: '', pid: '', recipientId: '', messageType: 'clinic', priority: 'NORMAL' });
  const [showCompose, setShowCompose] = useState(false);
  const [search, setSearch] = useState('');
  const [openFeed, setOpenFeed] = useState<FeedItem | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [, setNewCount] = useState(0);
  const tid = useRef(0);

  const addToast = useCallback((t: Omit<Toast,'id'>) => {
    const id = ++tid.current;
    setToasts(p => [...p.slice(-4), {...t,id}]);
    setTimeout(() => setToasts(p => p.filter(x=>x.id!==id)), 5000);
  }, []);

  const { data: allUsers = [] } = useQuery({
    queryKey: ['all-users'],
    queryFn: async () => { const r = await nestClient.get('/admin/users'); return r.data; },
  });

  const { data: allPatients = [] } = useQuery({
    queryKey: ['all-patients'],
    queryFn: async () => { const r = await nestClient.get('/patients'); return r.data; },
    enabled: form.messageType === 'patient',
  });

  const selectedPatient = allPatients.find((p: any) => String(p.pid) === String(form.pid));
  const patientProviderId = selectedPatient?.providerID;

  const { data: messages = [] } = useQuery({
    queryKey: ['messages'],
    queryFn: async () => { const r = await nestClient.get('/messages'); return r.data; },
  });

  useMessagingSocket({
    topics: ['openrx.messages.clinic', 'openrx.messages.patient'],
    onNewMessage: (event: MessagingEvent) => {
      qc.invalidateQueries({ queryKey: ['messages'] });
      setNewCount(c => c + 1);
      addToast({ type: 'info', title: 'New Message', body: event.payload.title || 'You have a new message', priority: event.priority || 'NORMAL' });
    },
    onNotification: (event: MessagingEvent) => {
      addToast({ type: 'warning', title: 'Notification', body: event.payload.title || 'System notification', priority: event.priority || 'NORMAL' });
    },
  });

  const enriched = useMemo(() => {
    return messages
      .map((m: any) => ({ ...m, ...parseTitle(m.title) }))
      .sort((a: any, b: any) => {
        const pr = (PRIORITY_ORDER[b.priority] || 0) - (PRIORITY_ORDER[a.priority] || 0);
        if (pr !== 0) return pr;
        const unread = (b.message_status === 'New' ? 1 : 0) - (a.message_status === 'New' ? 1 : 0);
        if (unread !== 0) return unread;
        return new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime();
      });
  }, [messages]);

  /**
   * The same messages folded into the shared notification shape, so a card can
   * be opened into a modal that shows every specific that belongs to a message.
   */
  const feedItems: FeedItem[] = useMemo(
    () =>
      enriched.slice(0, 12).map((m: any): FeedItem => {
        const isNew = m.message_status === 'New';
        const tone = m.priority === 'STAT' ? '#dc3545' : m.priority === 'URGENT' ? '#fd7e14' : '#0d6efd';
        return {
          id: m.id,
          title: m.subject || '(no subject)',
          subtitle: m.patientName && String(m.patientName).trim()
            ? `${String(m.patientName).trim()} · PID ${m.pid}`
            : m.groupname === 'events' ? 'Clinic broadcast' : 'Clinic message',
          summary: String(m.body || '').replace(/\s+/g, ' ').slice(0, 90),
          at: m.date,
          by: m.user,
          icon: KIND_ICON[m.kind] || 'bi-envelope',
          tone,
          status: m.message_status,
          unread: isNew,
          link: patientChartPath(m.patientId) || undefined,
          linkLabel: 'Open chart',
          metrics: [
            { label: 'Priority', value: m.priority, color: tone },
            { label: 'Channel', value: m.kind, color: '#6f42c1' },
            { label: 'Status', value: m.message_status || 'Read', color: isNew ? '#dc3545' : '#198754' },
          ],
          fields: [
            ['Subject', m.subject],
            ['Patient', m.patientName && String(m.patientName).trim() ? `${String(m.patientName).trim()} (PID ${m.pid})` : 'No patient attached'],
            ['Posted by', m.user],
            ['Posted', formatDateTime(m.date)],
            ['Assigned to', m.assigned_to],
            ['Status', m.message_status || 'Read'],
          ],
          lists: [{ title: 'Message body', lines: String(m.body || '').split(/\r?\n/).filter(Boolean) }],
        };
      }),
    [enriched],
  );

  const sendMsg = useMutation({
    mutationFn: (d: any) => nestClient.post('/messages', {
      title: d.title, body: d.body, pid: d.pid || undefined,
      recipientId: d.recipientId || undefined, priority: d.priority || 'NORMAL', type: d.messageType || 'clinic',
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messages'] });
      setForm({ title: '', body: '', pid: '', recipientId: '', messageType: 'clinic', priority: 'NORMAL' });
      setShowCompose(false);
      addToast({ type: 'success', title: 'Sent', body: 'Message routed via event bus', priority: 'NORMAL' });
    },
  });

  const markRead = useMutation({
    mutationFn: (id: number) => nestClient.patch(`/messages/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['messages'] }),
  });

  const markAllRead = useMutation({
    mutationFn: () => nestClient.post('/messages/read-all'),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['messages'] }); setNewCount(0); },
  });

  const deleteMsg = useMutation({
    mutationFn: (id: number) => nestClient.delete(`/messages/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['messages'] }),
  });

  const fmtBytes = (n?: number) => {
    const v = Number(n) || 0;
    if (v < 1024) return `${v} B`;
    if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
    return `${(v / 1024 / 1024).toFixed(2)} MB`;
  };

  // ── Smart mailbox (triage + Backblaze cold storage) ─────────
  const [folder, setFolder] = useState<'inbox' | 'archived' | 'all'>('inbox');
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [category, setCategory] = useState('');
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [showArchivePanel, setShowArchivePanel] = useState(false);
  const [archiveDays, setArchiveDays] = useState(30);
  const [archivePreview, setArchivePreview] = useState<any>(null);

  const { data: mbox } = useQuery({
    queryKey: ['mailbox', folder, urgentOnly, category, search],
    queryFn: async () => {
      const r = await nestClient.get('/mailbox', {
        params: {
          folder,
          limit: 25,
          ...(urgentOnly ? { priority: 'critical,high' } : {}),
          ...(category ? { category } : {}),
          ...(search.trim() ? { q: search.trim() } : {}),
        },
      });
      return r.data;
    },
  });

  const { data: archives = [] } = useQuery({
    queryKey: ['mailbox-archives'],
    queryFn: async () => { const r = await nestClient.get('/mailbox/archives'); return r.data; },
  });

  const { data: policy } = useQuery({
    queryKey: ['mailbox-policy'],
    queryFn: async () => { const r = await nestClient.get('/mailbox/policy'); return r.data; },
  });

  const [policyDraft, setPolicyDraft] = useState<{ enabled?: boolean; retentionDays?: number; hour?: number }>({});

  const savePolicy = useMutation({
    mutationFn: (dto: any) => nestClient.put('/mailbox/policy', dto),
    onSuccess: () => {
      addToast({ type: 'success', title: 'Archive policy saved', body: 'The nightly sweep will use this from tonight.', priority: 'NORMAL' });
      setPolicyDraft({});
      qc.invalidateQueries({ queryKey: ['mailbox-policy'] });
    },
    onError: () => addToast({ type: 'danger', title: 'Could not save the policy', body: 'Nothing changed.', priority: 'NORMAL' }),
  });

  const runSweepNow = useMutation({
    mutationFn: () => nestClient.post('/mailbox/policy/run-now'),
    onSuccess: (r) => {
      const d = r.data || {};
      addToast({
        type: d.archived ? 'success' : 'info',
        title: d.archived ? `${d.archived} messages archived` : 'Sweep ran — nothing to move',
        body: d.message || '',
        priority: 'NORMAL',
      });
      qc.invalidateQueries({ queryKey: ['mailbox-policy'] });
      refreshMail();
    },
    onError: () => addToast({ type: 'danger', title: 'Sweep failed', body: 'Your inbox is unchanged.', priority: 'NORMAL' }),
  });

  const refreshMail = () => {
    qc.invalidateQueries({ queryKey: ['mailbox'] });
    qc.invalidateQueries({ queryKey: ['mailbox-archives'] });
    qc.invalidateQueries({ queryKey: ['messages'] });
  };

  const previewArchive = useMutation({
    mutationFn: (days: number) => nestClient.post('/mailbox/archive/preview', { olderThanDays: days }),
    onSuccess: (r) => setArchivePreview(r.data),
  });

  const runArchive = useMutation({
    mutationFn: (days: number) => nestClient.post('/mailbox/archive', { olderThanDays: days }),
    onSuccess: (r) => {
      const d = r.data || {};
      if (d.archived) {
        addToast({
          type: 'success',
          title: `${d.archived} messages archived`,
          body: `Stored ${fmtBytes(d.bytes)} on Backblaze as ${d.file}`,
          priority: 'NORMAL',
        });
      } else {
        addToast({ type: 'info', title: 'Nothing to archive', body: d.message || 'No read mail is old enough yet.', priority: 'NORMAL' });
      }
      setArchivePreview(null);
      refreshMail();
    },
    onError: () => addToast({ type: 'danger', title: 'Archive failed', body: 'Nothing was moved — your inbox is unchanged.', priority: 'NORMAL' }),
  });

  const restoreArchive = useMutation({
    mutationFn: (id: number) => nestClient.post(`/mailbox/archives/${id}/restore`),
    onSuccess: (r) => {
      addToast({ type: 'success', title: `${r.data?.restored ?? 0} messages restored`, body: 'They are back in the inbox.', priority: 'NORMAL' });
      refreshMail();
    },
    onError: () => addToast({ type: 'danger', title: 'Restore failed', body: 'Could not read the archive back from Backblaze.', priority: 'NORMAL' }),
  });

  const downloadArchive = useMutation({
    mutationFn: (id: number) => nestClient.get(`/mailbox/archives/${id}/download`),
    onSuccess: (r) => {
      if (r.data?.url) window.open(r.data.url, '_blank', 'noopener');
    },
  });

  const deleteArchive = useMutation({
    mutationFn: (id: number) => nestClient.delete(`/mailbox/archives/${id}`),
    onSuccess: () => { addToast({ type: 'info', title: 'Archive deleted', body: 'The Backblaze copy was removed.', priority: 'NORMAL' }); refreshMail(); },
  });

  const threadRead = useMutation({
    mutationFn: (ids: number[]) => nestClient.post('/mailbox/thread/read', { ids }),
    onSuccess: () => refreshMail(),
  });

  const stats = mbox?.stats;
  const threads: any[] = mbox?.threads || [];
  const canManage = user?.role === 'admin';


  const fmtTime = (d: string) => {
    const dt = new Date(d);
    return isNaN(dt.getTime()) ? '—' : dt.toLocaleString();
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
        .glass-page .list-group-item {
          background: transparent !important;
        }
      `}</style>
      {/* Toasts */}
      <div className="position-fixed bottom-0 end-0 p-3" style={{ zIndex: 9999 }}>
        {toasts.map(t => (
          <div key={t.id} className={`toast show align-items-center text-bg-${t.type} border-0 mb-2`}>
            <div className="d-flex">
              <div className="toast-body small"><strong>{t.title}</strong>{t.priority !== 'NORMAL' && <span className={`badge ms-1 ${PRIORITY_BADGE[t.priority]}`}>{t.priority}</span>}<br />{t.body}</div>
              <button className="btn-close btn-close-white me-2 m-auto" onClick={() => setToasts(p => p.filter(x => x.id !== t.id))}></button>
            </div>
          </div>
        ))}
      </div>

      {/* Header */}
      <div className="rounded-4 p-4 mb-4 text-white" style={{ background: 'linear-gradient(135deg, #0dcaf0 0%, #0d6efd 50%, #6610f2 100%)' }}>
        <div className="d-flex justify-content-between align-items-start flex-wrap gap-3">
          <div>
            <h2 className="mb-1 fw-bold"><i className="bi bi-chat-dots me-2"></i>Messages</h2>
            <p className="mb-0 text-white text-opacity-75 small"><i className="bi bi-broadcast me-1"></i>Smart inbox · priority-sorted · real-time</p>
          </div>
          <div className="d-flex gap-2 align-items-center">
            {(stats?.unread ?? 0) > 0 && <span className="badge bg-danger rounded-pill fs-6">{stats.unread} unread</span>}
            {(stats?.unread ?? 0) > 0 && (
              <button className="btn btn-outline-light btn-sm rounded-pill" onClick={() => markAllRead.mutate()}>
                <i className="bi bi-envelope-check me-1"></i>Mark all read
              </button>
            )}
            {canWrite && (
              <button className="btn btn-light rounded-pill" onClick={() => setShowCompose(!showCompose)}>
                <i className={`bi ${showCompose ? 'bi-x-lg' : 'bi-pencil-square'} me-1`}></i>
                {showCompose ? 'Cancel' : 'Compose'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Notification surface — same card + modal viewers used elsewhere */}
      <NotificationFeedCard
        title="Message Notifications"
        icon="bi-bell-fill"
        tone="#0d6efd"
        items={feedItems}
        emptyText="No new messages"
        onOpen={(item) => { setOpenFeed(item); if (item.unread) markRead.mutate(Number(item.id)); }}
        onSeeAll={() => setFolder('all')}
      />

      {/* Compose */}
      {canWrite && showCompose && (
        <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '16px' }}>
          <div className="card-header bg-white py-3" style={{ borderRadius: '16px 16px 0 0' }}>
            <h6 className="mb-0 fw-bold"><i className="bi bi-pencil-square me-2 text-primary"></i>New Message</h6>
          </div>
          <div className="card-body">
            <div className="row g-2">
              <div className="col-md-2"><label className="form-label small">Type</label>
                <select className="form-select form-select-sm rounded-pill" value={form.messageType} onChange={e => setForm({ ...form, messageType: e.target.value, pid: '', recipientId: '' })}>
                  <option value="clinic">🏥 Clinic</option><option value="patient">👤 Patient</option><option value="direct">📨 Direct</option>
                </select>
              </div>
              <div className="col-md-3"><label className="form-label small">Recipient</label>
                {form.messageType === 'patient' ? (
                  <select className="form-select form-select-sm rounded-pill" value={form.pid} onChange={e => setForm({ ...form, pid: e.target.value })}>
                    <option value="">— Select Patient —</option>
                    {allPatients.map((p: any) => <option key={p.pid} value={p.pid}>{formatPatientName(p)} (PID {p.pid}){p.providerName ? ` — PCP: ${p.providerName}` : ''}</option>)}
                  </select>
                ) : (
                  <select className="form-select form-select-sm rounded-pill" value={form.recipientId} onChange={e => setForm({ ...form, recipientId: e.target.value })}>
                    <option value="">— Select Provider —</option>
                    <option value="all">📢 All Providers (Broadcast)</option>
                    {patientProviderId && (
                      <optgroup label="💡 Suggested — Patient's Provider">
                        {allUsers.filter((u: any) => String(u.id) === String(patientProviderId)).map((u: any) => (
                          <option key={u.id} value={u.id}>⭐ {u.title ? `${u.title} ` : ''}{u.fname} {u.lname} ({u.username})</option>
                        ))}
                      </optgroup>
                    )}
                    <optgroup label="All Providers">
                      {allUsers.filter((u: any) => u.active).map((u: any) => (
                        <option key={u.id} value={u.id}>{u.title ? `${u.title} ` : ''}{u.fname} {u.lname} ({u.username})</option>
                      ))}
                    </optgroup>
                  </select>
                )}
              </div>
              <div className="col-md-3"><label className="form-label small">Subject</label><input className="form-control form-control-sm rounded-pill" placeholder="Subject" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
              <div className="col-md-2"><label className="form-label small">Body</label><input className="form-control form-control-sm rounded-pill" placeholder="Message..." value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} /></div>
              <div className="col-md-1"><label className="form-label small">Priority</label>
                <select className="form-select form-select-sm rounded-pill" value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
                  <option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="URGENT">Urgent</option><option value="STAT">STAT</option>
                </select>
              </div>
              <div className="col-md-1 d-flex align-items-end">
                <button className="btn btn-sm rounded-pill w-100 text-white" style={{ background: 'linear-gradient(135deg,#0dcaf0,#0d6efd)' }}
                  onClick={() => sendMsg.mutate({ ...form, pid: form.pid ? Number(form.pid) : undefined, recipientId: form.recipientId ? Number(form.recipientId) : undefined, messageType: form.messageType })}
                  disabled={sendMsg.isPending || !form.title}>
                  {sendMsg.isPending ? <span className="spinner-border spinner-border-sm"></span> : <i className="bi bi-send"></i>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Smart inbox: depth meter, triage counts and the cold-storage control */}
      <div className="row g-3 mb-3">
        <div className="col-lg-4 col-md-6">
          <div className="card border-0 shadow-sm h-100" style={{ borderRadius: '16px' }}>
            <div className="card-body py-3">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <small className="text-muted text-uppercase fw-semibold" style={{ fontSize: '0.7rem', letterSpacing: '0.04em' }}>Inbox depth</small>
                <span className="badge rounded-pill" style={{
                  background: (stats?.depthScore ?? 100) >= 70 ? '#198754' : (stats?.depthScore ?? 100) >= 40 ? '#fd7e14' : '#dc3545',
                }}>{stats?.depthScore ?? 100} / 100</span>
              </div>
              <div className="progress mb-2" style={{ height: '8px', borderRadius: '8px' }}>
                <div className="progress-bar" role="progressbar"
                  style={{
                    width: `${stats?.depthScore ?? 100}%`,
                    background: (stats?.depthScore ?? 100) >= 70 ? 'linear-gradient(135deg,#0dcaf0,#198754)' : 'linear-gradient(135deg,#fd7e14,#dc3545)',
                  }}></div>
              </div>
              <small className="text-muted">
                {stats ? `${stats.hotThreads} open conversation${stats.hotThreads === 1 ? '' : 's'} · ${stats.unread} unread` : 'Loading…'}
                {stats?.oldestUnreadDays > 2 ? ` · oldest unread ${stats.oldestUnreadDays} days old` : ''}
              </small>
            </div>
          </div>
        </div>

        <div className="col-lg-4 col-md-6">
          <div className="card border-0 shadow-sm h-100" style={{ borderRadius: '16px' }}>
            <div className="card-body py-3 d-flex align-items-center justify-content-between">
              <div>
                <div className="fs-5 fw-bold" style={{ color: '#dc3545' }}>{stats?.urgentThreads ?? 0}</div>
                <small className="text-muted">Need attention</small>
              </div>
              <div className="text-center">
                <div className="fs-5 fw-bold" style={{ color: '#0d6efd' }}>{stats?.unreadThreads ?? 0}</div>
                <small className="text-muted">Unread</small>
              </div>
              <div className="text-end">
                <div className="fs-5 fw-bold" style={{ color: '#6c757d' }}>{stats?.byCategory ? Object.values(stats.byCategory).filter((v: any) => v > 0).length : 0}</div>
                <small className="text-muted">Categories</small>
              </div>
            </div>
          </div>
        </div>

        <div className="col-lg-4 col-md-12">
          <div className="card border-0 shadow-sm h-100" style={{ borderRadius: '16px' }}>
            <div className="card-body py-3 d-flex align-items-center justify-content-between">
              <div>
                <div className="d-flex align-items-center gap-2">
                  <i className="bi bi-cloud-arrow-up text-success"></i>
                  <span className="fw-semibold" style={{ fontSize: '0.9rem' }}>{stats?.archived?.messages ?? 0} in cold storage</span>
                </div>
                <small className="text-muted">
                  {stats?.archived?.bytes ? `${fmtBytes(stats.archived.bytes)} on Backblaze` : 'Backblaze B2'}
                  {stats?.archived?.archives ? ` · ${stats.archived.archives} archive${stats.archived.archives === 1 ? '' : 's'}` : ''}
                  {policy?.enabled ? ` · auto: ${policy.retentionDays}d` : policy ? ' · auto off' : ''}
                </small>
              </div>
              <button className={`btn btn-sm rounded-pill ${showArchivePanel ? 'btn-success' : 'btn-outline-success'}`}
                onClick={() => { setShowArchivePanel(v => !v); if (!showArchivePanel) previewArchive.mutate(archiveDays); }}>
                <i className="bi bi-archive me-1"></i>Archive old mail
              </button>
            </div>
          </div>
        </div>
      </div>

      {showArchivePanel && (
        <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '16px' }}>
          <div className="card-header bg-white py-3 d-flex justify-content-between align-items-center" style={{ borderRadius: '16px 16px 0 0' }}>
            <h6 className="mb-0 fw-bold"><i className="bi bi-cloud-arrow-up me-2 text-success"></i>Move read mail to Backblaze</h6>
            <button className="btn btn-sm btn-light rounded-pill" onClick={() => setShowArchivePanel(false)}><i className="bi bi-x-lg"></i></button>
          </div>
          <div className="card-body">
            {policy && (
              <div className="border rounded-3 p-3 mb-3" style={{ background: policy.enabled ? 'rgba(25,135,84,0.05)' : 'rgba(108,117,125,0.06)' }}>
                <div className="d-flex flex-wrap align-items-center justify-content-between gap-2">
                  <div className="d-flex align-items-center gap-2">
                    <i className={`bi ${policy.enabled ? 'bi-arrow-repeat text-success' : 'bi-pause-circle text-secondary'} fs-5`}></i>
                    <div>
                      <div className="fw-semibold" style={{ fontSize: '0.9rem' }}>
                        Automatic sweep {policy.enabled ? 'on' : 'off'}
                        {policy.enabled && <> · read mail older than <strong>{policy.retentionDays} days</strong>, nightly at {String(policy.hour).padStart(2, '0')}:00</>}
                      </div>
                      <small className="text-muted">
                        {policy.lastRunAt
                          ? <>Last sweep {formatDateTime(policy.lastRunAt)} — {policy.lastRunOutcome || 'no detail recorded'}</>
                          : 'No sweep has run yet.'}
                        {policy.enabled && policy.dueNow && <span className="text-warning ms-1">· due now ({policy.dueReason})</span>}
                        {policy.enabled && !policy.dueNow && <span className="ms-1">· {policy.dueReason}</span>}
                      </small>
                    </div>
                  </div>
                  <div className="d-flex align-items-center gap-2">
                    {policy.autoTotals?.messages > 0 && (
                      <span className="badge bg-light text-secondary">
                        swept so far: {policy.autoTotals.messages} messages / {fmtBytes(policy.autoTotals.bytes)}
                      </span>
                    )}
                    {canManage && (
                      <>
                        <button className={`btn btn-sm rounded-pill ${policy.enabled ? 'btn-outline-secondary' : 'btn-outline-success'}`}
                          onClick={() => savePolicy.mutate({ enabled: !policy.enabled })} disabled={savePolicy.isPending}>
                          <i className={`bi ${policy.enabled ? 'bi-pause' : 'bi-play'} me-1`}></i>{policy.enabled ? 'Pause' : 'Resume'}
                        </button>
                        <button className="btn btn-sm btn-outline-primary rounded-pill" onClick={() => runSweepNow.mutate()} disabled={runSweepNow.isPending}>
                          {runSweepNow.isPending ? <span className="spinner-border spinner-border-sm me-1"></span> : <i className="bi bi-lightning-charge me-1"></i>}Sweep now
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {canManage && (
                  <div className="d-flex flex-wrap align-items-end gap-2 mt-3">
                    <div>
                      <label className="form-label small mb-1">Keep read mail for</label>
                      <div className="input-group input-group-sm" style={{ width: '160px' }}>
                        <input type="number" min={14} max={3650} className="form-control"
                          value={policyDraft.retentionDays ?? policy.retentionDays}
                          onChange={e => setPolicyDraft(d => ({ ...d, retentionDays: Number(e.target.value) }))} />
                        <span className="input-group-text">days</span>
                      </div>
                    </div>
                    <div>
                      <label className="form-label small mb-1">Sweep hour</label>
                      <input type="number" min={0} max={23} className="form-control form-control-sm" style={{ width: '90px' }}
                        value={policyDraft.hour ?? policy.hour}
                        onChange={e => setPolicyDraft(d => ({ ...d, hour: Number(e.target.value) }))} />
                    </div>
                    <button className="btn btn-sm btn-primary rounded-pill"
                      onClick={() => savePolicy.mutate(policyDraft)}
                      disabled={savePolicy.isPending || !Object.keys(policyDraft).length}>
                      <i className="bi bi-check2 me-1"></i>Save policy
                    </button>
                    <small className="text-muted">Minimum 14 days. Unread mail is never swept, however old.</small>
                  </div>
                )}
              </div>
            )}
            {!canWrite ? (
              <p className="text-muted small mb-0">Only a physician or administrator can move mail to cold storage.</p>
            ) : (
              <>
                <div className="d-flex flex-wrap align-items-end gap-3 mb-3">
                  <div>
                    <label className="form-label small mb-1">Archive read mail older than</label>
                    <div className="input-group input-group-sm" style={{ width: '170px' }}>
                      <input type="number" min={1} max={3650} className="form-control" value={archiveDays}
                        onChange={e => setArchiveDays(Math.max(1, Number(e.target.value) || 1))} />
                      <span className="input-group-text">days</span>
                    </div>
                  </div>
                  <button className="btn btn-sm btn-outline-secondary rounded-pill" onClick={() => previewArchive.mutate(archiveDays)} disabled={previewArchive.isPending}>
                    {previewArchive.isPending ? <span className="spinner-border spinner-border-sm me-1"></span> : <i className="bi bi-eye me-1"></i>}Preview
                  </button>
                  <button className="btn btn-sm btn-success rounded-pill" onClick={() => runArchive.mutate(archiveDays)}
                    disabled={runArchive.isPending || !archivePreview?.count}>
                    {runArchive.isPending ? <span className="spinner-border spinner-border-sm me-1"></span> : <i className="bi bi-cloud-upload me-1"></i>}
                    Archive {archivePreview?.count ? `${archivePreview.count} message${archivePreview.count === 1 ? '' : 's'}` : 'now'}
                  </button>
                </div>
                {archivePreview && (
                  <div className="alert alert-light border rounded-3 small mb-3">
                    <strong>{archivePreview.count}</strong> message{archivePreview.count === 1 ? '' : 's'} would move
                    ({fmtBytes(archivePreview.bytes)}{archivePreview.oldestDays ? `, oldest ${archivePreview.oldestDays} days` : ''}).
                    {archivePreview.unreadSkipped > 0 && (
                      <> <span className="text-muted">{archivePreview.unreadSkipped} unread message{archivePreview.unreadSkipped === 1 ? '' : 's'} stay in the inbox.</span></>
                    )}
                    {archivePreview.count === 0 && <span className="text-muted"> Nothing qualifies yet.</span>}
                    {archivePreview.sample?.length > 0 && (
                      <ul className="mb-0 mt-2 ps-3">
                        {archivePreview.sample.map((s: any) => (
                          <li key={s.id} className="text-truncate">{s.title || '(no subject)'} — {s.user || 'unknown'}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                <div className="table-responsive">
                  <table className="table table-sm align-middle mb-0">
                    <thead>
                      <tr className="text-muted small">
                        <th>Archived</th><th>Messages</th><th>Size</th><th>Stored as</th><th>State</th><th className="text-end">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(archives as any[]).map((a: any) => (
                        <tr key={a.id}>
                          <td className="small">{formatDateTime(a.created_at)}</td>
                          <td className="small">{a.message_count}</td>
                          <td className="small">{fmtBytes(a.byte_size)}</td>
                          <td className="small text-truncate" style={{ maxWidth: '240px' }} title={a.b2_file_name}>{String(a.b2_file_name || '').split('/').pop()}</td>
                          <td>
                            {a.restored_at
                              ? <span className="badge bg-secondary">Restored {new Date(a.restored_at).toLocaleDateString()}</span>
                              : <span className="badge bg-success">In Backblaze</span>}
                          </td>
                          <td className="text-end">
                            <div className="btn-group btn-group-sm">
                              <button className="btn btn-outline-primary" title="Get a time-limited download link"
                                onClick={() => downloadArchive.mutate(a.id)} disabled={downloadArchive.isPending}>
                                <i className="bi bi-download"></i>
                              </button>
                              <button className="btn btn-outline-secondary" title="Bring these messages back to the inbox"
                                onClick={() => restoreArchive.mutate(a.id)} disabled={restoreArchive.isPending}>
                                <i className="bi bi-arrow-counterclockwise"></i>
                              </button>
                              {canManage && !a.restored_at && (
                                <button className="btn btn-outline-danger" title="Delete the Backblaze copy"
                                  onClick={() => { if (confirm('Delete this archive from Backblaze? This cannot be undone.')) deleteArchive.mutate(a.id); }}
                                  disabled={deleteArchive.isPending}>
                                  <i className="bi bi-trash"></i>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                      {!archives.length && (
                        <tr><td colSpan={6} className="text-center text-muted small py-3">No archives yet — mail moves here once it is read and old enough.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}


      {/* Toolbar: folders, triage filters + search */}
      <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
        <div className="btn-group" role="group">
          {([['inbox', 'Inbox', 'bi-inbox'], ['archived', 'Archived', 'bi-archive'], ['all', 'Everything', 'bi-collection']] as const).map(([f, label, icon]) => (
            <button key={f} className={`btn btn-sm rounded-pill ${folder === f ? 'btn-primary' : 'btn-outline-secondary'}`}
              onClick={() => setFolder(f as any)}>
              <i className={`bi ${icon} me-1`}></i>{label}
            </button>
          ))}
        </div>
        <button className={`btn btn-sm rounded-pill ${urgentOnly ? 'btn-danger' : 'btn-outline-danger'}`} onClick={() => setUrgentOnly(v => !v)}>
          <i className="bi bi-exclamation-diamond me-1"></i>Needs attention
        </button>
        <select className="form-select form-select-sm rounded-pill" style={{ width: '160px' }} value={category} onChange={e => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {['lab', 'pharmacy', 'billing', 'clinical', 'scheduling', 'system', 'admin'].map(c => (
            <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
          ))}
        </select>
        <div className="ms-auto" style={{ minWidth: '240px' }}>
          <div className="input-group input-group-sm">
            <span className="input-group-text bg-white border-end-0 rounded-pill-start"><i className="bi bi-search text-muted"></i></span>
            <input className="form-control border-start-0 rounded-pill-end" placeholder="Search messages..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
      </div>
      {/* Inbox: one row per conversation, most urgent first */}
      <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
        <div className="card-header bg-white d-flex justify-content-between py-3" style={{ borderRadius: '16px 16px 0 0' }}>
          <h6 className="mb-0 fw-bold">
            <i className="bi bi-inbox me-2 text-primary"></i>
            {folder === 'archived' ? 'Archived' : folder === 'all' ? 'Everything' : 'Inbox'}
          </h6>
          <div className="d-flex align-items-center gap-2">
            <small className="text-muted">ranked by triage score</small>
            <span className="badge bg-primary rounded-pill">{threads.length}</span>
          </div>
        </div>
        <div className="card-body p-0">
          {threads.map((t: any) => {
            const isOpen = openThread === t.key;
            const tone = t.priority === 'critical' ? '#dc3545' : t.priority === 'high' ? '#fd7e14' : t.unreadCount ? '#0d6efd' : '#6c757d';
            return (
              <div key={t.key} className={`border-bottom ${t.unreadCount ? 'bg-primary bg-opacity-05' : ''}`}>
                <div className="d-flex align-items-center gap-3 px-3 py-2" style={{ cursor: 'pointer', borderLeft: `4px solid ${t.unreadCount ? tone : 'transparent'}` }}
                  onClick={() => setOpenThread(isOpen ? null : t.key)}>
                  <div className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                    style={{ width: '44px', height: '44px', backgroundColor: `${tone}15` }}>
                    <i className={`bi ${t.messageCount > 1 ? 'bi-chat-square-text' : 'bi-envelope'} fs-5`} style={{ color: tone }}></i>
                  </div>
                  <div className="flex-grow-1 min-width-0">
                    <div className="d-flex justify-content-between align-items-center gap-2">
                      <div className="d-flex align-items-center gap-2 min-width-0">
                        {(t.priority === 'critical' || t.priority === 'high') && (
                          <span className="badge rounded-pill" style={{ backgroundColor: tone, fontSize: '0.65rem' }}>
                            {t.priority === 'critical' ? 'NEEDS ATTENTION' : 'HIGH'}
                          </span>
                        )}
                        {t.messageCount > 1 && <span className="badge rounded-pill bg-light text-dark" style={{ fontSize: '0.65rem' }}>×{t.messageCount}</span>}
                        <strong className={t.unreadCount ? 'text-primary text-truncate' : 'text-truncate'} style={{ fontSize: '0.9rem' }}>{t.subject || 'No Subject'}</strong>
                      </div>
                      <div className="d-flex gap-1 align-items-center flex-shrink-0">
                        <span className="badge rounded-pill bg-light text-secondary" style={{ fontSize: '0.62rem' }}>{t.category}</span>
                        {t.unreadCount > 0 && <span className="badge rounded-pill bg-primary" style={{ fontSize: '0.65rem' }}>{t.unreadCount} new</span>}
                        <span className="badge rounded-pill bg-secondary" style={{ fontSize: '0.62rem' }} title="triage score">{t.score}</span>
                      </div>
                    </div>
                    <p className="text-muted small mb-0 text-truncate">{t.preview}</p>
                    <small className="text-muted">{fmtTime(t.latestAt)} · {t.latestUser || 'unknown'}{t.pid ? ` · PID ${t.pid}` : ''}</small>
                  </div>
                </div>
                {isOpen && (
                  <div className="px-3 pb-3 pt-1 bg-white">
                    {t.messages[0]?.triage?.why?.length > 0 && (
                      <div className="mb-2 small text-muted">
                        <i className="bi bi-lightbulb me-1"></i>Ranked here because: {t.messages[0].triage.why.join(', ')}
                      </div>
                    )}
                    {t.messages.map((m: any) => (
                      <div key={m.id} className="d-flex gap-2 mb-2">
                        <i className={`bi ${m.message_status === 'New' ? 'bi-envelope-fill text-primary' : 'bi-envelope-open text-muted'} mt-1`}></i>
                        <div className="flex-grow-1 min-width-0">
                          <div className="small text-muted">
                            {fmtTime(m.date)} - {m.user || 'unknown'}
                            {m.message_status === 'New' && <span className="badge bg-primary ms-2" style={{ fontSize: '0.6rem' }}>new</span>}
                          </div>
                          <div className="p-2 bg-light rounded-3" style={{ whiteSpace: 'pre-wrap', fontSize: '0.875rem' }}>{m.body || '(no body)'}</div>
                        </div>
                      </div>
                    ))}
                    <div className="d-flex gap-2 mt-2 flex-wrap">
                      {(() => {
                        const last = t.messages[0];
                        const href = patientChartPath(last?.patientId, last?.patientPid, last?.pid);
                        if (!href) return null;
                        return (
                          <button className="btn btn-sm btn-outline-primary rounded-pill" onClick={() => navigate(href)}>
                            <i className="bi bi-person me-1"></i>Open Patient Chart
                          </button>
                        );
                      })()}
                      {t.unreadCount > 0 && (
                        <button className="btn btn-sm btn-outline-success rounded-pill"
                          onClick={() => threadRead.mutate(t.messages.filter((m: any) => m.message_status === 'New').map((m: any) => m.id))}
                          disabled={threadRead.isPending}>
                          <i className="bi bi-envelope-check me-1"></i>Mark thread read
                        </button>
                      )}
                      <button className="btn btn-sm btn-outline-danger rounded-pill"
                        onClick={() => { t.messages.forEach((m: any) => deleteMsg.mutate(m.id)); refreshMail(); }}>
                        <i className="bi bi-trash me-1"></i>Delete thread
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {threads.length === 0 && (
            <div className="text-center text-muted py-5">
              <i className="bi bi-inbox fs-1 d-block mb-2 opacity-50"></i>
              <p>{search ? 'No messages match your search.' : folder === 'archived' ? 'Nothing archived yet.' : 'Inbox is clear.'}</p>
              {canWrite && (
                <button className="btn btn-primary btn-sm rounded-pill" onClick={() => setShowCompose(true)}>
                  <i className="bi bi-pencil-square me-1"></i>Compose Message
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      

      <NotificationFeedModal
        item={openFeed}
        onClose={() => setOpenFeed(null)}
        onAck={(item) => { markRead.mutate(Number(item.id)); setOpenFeed(null); }}
        ackPending={markRead.isPending}
        onNavigate={(link) => navigate(link)}
      />
    </div>
  );
}
