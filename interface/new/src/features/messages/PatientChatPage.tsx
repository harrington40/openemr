import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import nestClient from '../../api/nest-client';
import { useAuth } from '../../hooks/useAuth';
import { formatPatientNameLastFirst } from '../../utils/patientName';

interface ChatMsg {
  id: number;
  pid: number;
  body: string;
  direction: 'patient' | 'provider';
  sender: string;
  date: string;
  message_status: string;
}

interface ChatPatient {
  pid: number;
  fname: string;
  lname: string;
  unread: number | string;
  last_date: string | null;
  last_message: string | null;
}

const initials = (name: string) => {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return parts
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
};

export default function PatientChatPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { pid: pidParam } = useParams();
  const selectedPid = pidParam ? Number(pidParam) : null;

  const [body, setBody] = useState('');
  const [search, setSearch] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);


  const { data: accessData } = useQuery<{ access: string; canShare: boolean }>({
    queryKey: ['chat-access', selectedPid],
    queryFn: async () => {
      const r = await nestClient.get(`/chat/access/${selectedPid}`);
      return r.data;
    },
    enabled: !!selectedPid,
  });
  const access = accessData?.access || (user?.role === 'physician' || user?.role === 'admin' ? 'write' : 'none');
  const canWrite = access === 'write';
  const canShare = !!accessData?.canShare || user?.role === 'physician' || user?.role === 'admin';

  // All patients for the sidebar (unread counts + last message preview)
  const { data: patients = [] } = useQuery<ChatPatient[]>({
    queryKey: ['chat-patients'],
    queryFn: async () => {
      const r = await nestClient.get('/chat/patients');
      return r.data || [];
    },
    refetchInterval: 15000,
  });

  const selectedPatient = patients.find(
    (p) => String(p.pid) === String(selectedPid),
  );

  // Thread for the selected patient
  const { data: messages = [], isLoading } = useQuery<ChatMsg[]>({
    queryKey: ['chat-thread', selectedPid],
    queryFn: async () => {
      const r = await nestClient.get(`/chat/thread/${selectedPid}`);
      return r.data || [];
    },
    enabled: !!selectedPid,
    refetchInterval: 5000,
  });

  const markRead = useMutation({
    mutationFn: () => nestClient.post(`/chat/thread/${selectedPid}/read`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat-patients'] });
      qc.invalidateQueries({ queryKey: ['provider-chat-unread'] });
    },
  });

  const sendMsg = useMutation({
    mutationFn: (text: string) =>
      nestClient.post(`/chat/thread/${selectedPid}`, { body: text }),
    onSuccess: () => {
      setBody('');
      qc.invalidateQueries({ queryKey: ['chat-thread', selectedPid] });
      qc.invalidateQueries({ queryKey: ['chat-patients'] });
    },
  });

  // ── Sharing (admin / physician only) ──────────────────────────────
  const [showShare, setShowShare] = useState(false);
  const [shareUserId, setShareUserId] = useState('');
  const [shareAccess, setShareAccess] = useState('read');

  const { data: shares = [] } = useQuery<any[]>({
    queryKey: ['chat-shares', selectedPid],
    queryFn: async () => { const r = await nestClient.get(`/chat/shares/${selectedPid}`); return r.data || []; },
    enabled: !!selectedPid && canShare,
  });
  const { data: shareUsers = [] } = useQuery<any[]>({
    queryKey: ['chat-users'],
    queryFn: async () => { const r = await nestClient.get('/chat/users'); return r.data || []; },
    enabled: canShare,
  });
  const addShare = useMutation({
    mutationFn: () => nestClient.post('/chat/shares', { pid: selectedPid, userId: Number(shareUserId), access: shareAccess }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['chat-shares', selectedPid] }); setShareUserId(''); },
  });
  const revokeShare = useMutation({
    mutationFn: (userId: number) => nestClient.delete(`/chat/shares/${selectedPid}/${userId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['chat-shares', selectedPid] }),
  });

  useEffect(() => {
    if (selectedPid) markRead.mutate();
  }, [selectedPid]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const filteredPatients = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return patients;
    return patients.filter(
      (p) =>
        `${p.fname} ${p.lname}`.toLowerCase().includes(q) ||
        String(p.pid).includes(q),
    );
  }, [patients, search]);

  const patientName = selectedPatient
    ? `${selectedPatient.fname} ${selectedPatient.lname}`.trim()
    : '';

  const fmtTime = (d: string | null) => {
    if (!d) return '';
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return d;
    const today = new Date();
    const sameDay = dt.toDateString() === today.toDateString();
    return dt.toLocaleString(undefined, {
      month: sameDay ? undefined : 'short',
      day: sameDay ? undefined : 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleSend = () => {
    if (!body.trim()) return;
    sendMsg.mutate(body);
  };

  const avatar = (name: string, color: string, size = '42px', fontSize = '0.85rem') => (
    <div
      className="rounded-circle d-flex align-items-center justify-content-center text-white flex-shrink-0"
      style={{ width: size, height: size, fontSize, fontWeight: 700, background: color }}
    >
      {initials(name)}
    </div>
  );

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
        .glass-page .list-group-item {
          background: transparent !important;
        }
      `}</style>
      {/* Page header */}
      <div className="rounded-4 p-4 mb-4 text-white" style={{ background: 'linear-gradient(135deg, #0dcaf0 0%, #0d6efd 55%, #6610f2 100%)' }}>
        <div className="d-flex justify-content-between align-items-center">
          <div>
            <h2 className="mb-1 fw-bold"><i className="bi bi-chat-heart me-2"></i>Patient Chat</h2>
            <p className="mb-0 text-white text-opacity-75 small">Message your patients in real time</p>
          </div>
          <span className="badge bg-white bg-opacity-25 rounded-pill fs-6">
            <i className="bi bi-people me-1"></i>{patients.length} patients
          </span>
        </div>
      </div>

      <div className="card border-0 shadow" style={{ borderRadius: '20px', overflow: 'hidden' }}>
        <div className="row g-0" style={{ height: 'calc(100vh - 220px)', minHeight: '520px' }}>
          {/* Sidebar — patient list */}
          <div className="col-md-4 col-lg-3 border-end" style={{ background: '#f8f9fa', display: 'flex', flexDirection: 'column' }}>
            <div className="p-3 border-bottom bg-white">
              <div className="input-group input-group-sm">
                <span className="input-group-text bg-transparent border-end-0"><i className="bi bi-search"></i></span>
                <input
                  className="form-control border-start-0"
                  placeholder="Search patients..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>

            <div className="list-group list-group-flush flex-grow-1" style={{ overflowY: 'auto' }}>
              {filteredPatients.map((p) => {
                const isActive = String(p.pid) === String(selectedPid);
                const unread = Number(p.unread) || 0;
                return (
                  <button
                    key={p.pid}
                    className={`list-group-item list-group-item-action border-0 d-flex align-items-center gap-3 px-3 py-3 ${isActive ? 'active' : ''}`}
                    style={{ background: isActive ? '#0d6efd' : 'transparent', transition: 'all 0.15s' }}
                    onClick={() => navigate(`/messages/patient-chat/${p.pid}`)}
                  >
                    {avatar(`${p.fname} ${p.lname}`, isActive ? 'rgba(255,255,255,0.35)' : '#20c997')}
                    <div className="flex-grow-1 min-w-0 text-start">
                      <div className={`d-flex justify-content-between align-items-center`}>
                        <span className={`fw-semibold small ${isActive ? 'text-white' : ''}`}>
                          {formatPatientNameLastFirst(p)}
                        </span>
                        <small className={isActive ? 'text-white-50' : 'text-muted'}>{fmtTime(p.last_date)}</small>
                      </div>
                      <div className="d-flex justify-content-between align-items-center">
                        <small className={`text-truncate ${isActive ? 'text-white-50' : 'text-muted'}`} style={{ maxWidth: '130px' }}>
                          {p.last_message || 'Start a conversation'}
                        </small>
                        {unread > 0 && (
                          <span className="badge bg-danger rounded-pill" style={{ fontSize: '0.6rem' }}>{unread}</span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
              {!filteredPatients.length && (
                <div className="text-center text-muted py-5 small">
                  <i className="bi bi-person-x fs-2 d-block mb-2 opacity-25"></i>
                  No patients found
                </div>
              )}
            </div>
          </div>

          {/* Conversation pane */}
          <div className="col-md-8 col-lg-9 d-flex flex-column" style={{ background: '#fff' }}>
            {!selectedPid || !selectedPatient ? (
              <div className="flex-grow-1 d-flex align-items-center justify-content-center" style={{ background: 'radial-gradient(circle at 50% 30%, #eef4ff 0%, #ffffff 70%)' }}>
                <div className="text-center text-muted p-5">
                  <div className="rounded-circle bg-primary bg-opacity-10 d-inline-flex align-items-center justify-content-center mb-3" style={{ width: '90px', height: '90px' }}>
                    <i className="bi bi-chat-dots fs-1 text-primary"></i>
                  </div>
                  <h5 className="fw-bold text-dark">Your patient conversations</h5>
                  <p className="small">Select a patient from the list to view or send messages.</p>
                </div>
              </div>
            ) : access === 'none' ? (
              <div className="flex-grow-1 d-flex align-items-center justify-content-center" style={{ background: 'radial-gradient(circle at 50% 30%, #eef4ff 0%, #ffffff 70%)' }}>
                <div className="text-center text-muted p-5">
                  <i className="bi bi-lock fs-1 text-secondary d-block mb-3"></i>
                  <h5 className="fw-bold text-dark">Patient chat is locked</h5>
                  <p className="small mb-0">Only doctors/physicians can access patient chat. Ask an administrator or physician to share this conversation with you.</p>
                </div>
              </div>
            ) : (
              <>
                {/* Chat header */}
                <div className="d-flex align-items-center gap-3 px-4 py-3 border-bottom bg-white">
                  {avatar(patientName, '#20c997')}
                  <div className="flex-grow-1">
                    <div className="fw-bold">{patientName}</div>
                    <small className="text-success"><i className="bi bi-circle-fill me-1" style={{ fontSize: '0.5rem' }}></i>Patient</small>
                  </div>
                  {canShare && (
                    <button className="btn btn-outline-primary btn-sm rounded-pill" onClick={() => setShowShare(true)}>
                      <i className="bi bi-share me-1"></i>Share
                    </button>
                  )}
                  <button className="btn btn-outline-secondary btn-sm rounded-pill" onClick={() => navigate('/messages/patient-chat')}>
                    <i className="bi bi-x-lg"></i>
                  </button>
                </div>

                {/* Messages */}
                <div className="flex-grow-1 p-3" style={{ overflowY: 'auto', background: '#f8f9fa' }}>
                  {isLoading ? (
                    <div className="text-center text-muted py-5">
                      <div className="spinner-border text-primary mb-2"></div>
                      <p>Loading conversation...</p>
                    </div>
                  ) : !messages.length ? (
                    <div className="text-center text-muted py-5">
                      <i className="bi bi-chat-left-text fs-1 d-block mb-2 opacity-25"></i>
                      <p>No messages yet. Say hello below.</p>
                    </div>
                  ) : (
                    messages.map((m) => {
                      const isProvider = m.direction === 'provider';
                      return (
                        <div key={m.id} className={`d-flex mb-2 ${isProvider ? 'justify-content-end' : 'justify-content-start'}`}>
                          {!isProvider && avatar(patientName, '#20c997', '26px', '0.65rem')}
                          <div className={`d-flex flex-column ${isProvider ? 'align-items-end ms-2' : 'ms-2'}`} style={{ maxWidth: '75%' }}>
                            <div
                              className={`p-2 px-3 ${isProvider ? 'bg-primary text-white' : 'bg-white border shadow-sm'}`}
                              style={{
                                borderRadius: '14px',
                                borderBottomRightRadius: isProvider ? '4px' : '14px',
                                borderBottomLeftRadius: isProvider ? '14px' : '4px',
                              }}
                            >
                              <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
                            </div>
                            <small className="text-muted" style={{ fontSize: '0.7rem' }}>
                              {isProvider ? 'You' : patientName} · {fmtTime(m.date)}
                            </small>
                          </div>
                          {isProvider && avatar(user?.displayName || user?.username || 'DR', '#0d6efd', '26px', '0.65rem')}
                        </div>
                      );
                    })
                  )}
                  <div ref={bottomRef} />
                </div>

                {/* Composer */}
                <div className="p-3 border-top bg-white">
                  {canWrite ? (
                    <div className="d-flex gap-2 align-items-end">
                      <textarea
                        className="form-control rounded-4"
                        rows={2}
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSend();
                          }
                        }}
                        placeholder={`Message ${patientName}...`}
                      />
                      <button
                        className="btn btn-primary rounded-pill px-3 d-flex align-items-center"
                        onClick={handleSend}
                        disabled={sendMsg.isPending || !body.trim()}
                        style={{ height: '44px' }}
                      >
                        {sendMsg.isPending ? (
                          <span className="spinner-border spinner-border-sm"></span>
                        ) : (
                          <i className="bi bi-send"></i>
                        )}
                      </button>
                    </div>
                  ) : (
                    <div className="text-center text-muted small py-1">
                      <i className="bi bi-lock me-1"></i>Read-only — only providers (physicians) can send messages.
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {showShare && (
        <div className="modal fade show d-block" tabIndex={-1} style={{ zIndex: 1080, background: 'rgba(0,0,0,0.45)' }} onClick={(e) => { if (e.target === e.currentTarget) setShowShare(false); }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content" style={{ borderRadius: '16px' }}>
              <div className="modal-header py-2">
                <h6 className="modal-title"><i className="bi bi-share me-2 text-primary"></i>Share Patient Chat — {patientName}</h6>
                <button className="btn-close" onClick={() => setShowShare(false)}></button>
              </div>
              <div className="modal-body">
                <div className="row g-2 align-items-end mb-3">
                  <div className="col-6">
                    <label className="form-label small mb-0">User</label>
                    <select className="form-select form-select-sm" value={shareUserId} onChange={(e) => setShareUserId(e.target.value)}>
                      <option value="">Select user…</option>
                      {shareUsers.map((u: any) => (
                        <option key={u.id} value={u.id}>{`${u.fname || ''} ${u.lname || ''}`.trim() || u.username} ({u.main_menu_role || 'user'})</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-3">
                    <label className="form-label small mb-0">Access</label>
                    <select className="form-select form-select-sm" value={shareAccess} onChange={(e) => setShareAccess(e.target.value)}>
                      <option value="read">Read</option>
                      <option value="write">Read & Write</option>
                    </select>
                  </div>
                  <div className="col-3">
                    <button className="btn btn-primary btn-sm w-100 rounded-pill" disabled={!shareUserId || addShare.isPending} onClick={() => addShare.mutate()}>Grant</button>
                  </div>
                </div>
                <div className="small text-muted mb-1">People with access</div>
                {shares.length === 0 ? (
                  <div className="text-muted small">Not shared with anyone yet. Doctors and administrators always have access.</div>
                ) : (
                  <div className="list-group list-group-flush">
                    {shares.map((s: any) => (
                      <div key={s.id} className="list-group-item d-flex justify-content-between align-items-center px-0">
                        <span className="small">{`${s.fname || ''} ${s.lname || ''}`.trim() || s.username} — <span className="badge bg-light text-dark border text-capitalize">{s.access}</span></span>
                        <button className="btn btn-outline-danger btn-sm py-0 px-2" onClick={() => revokeShare.mutate(s.user_id)}><i className="bi bi-trash"></i></button>
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
  );
}
