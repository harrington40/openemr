import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import nestClient from '../../api/nest-client';

interface ChatMsg {
  id: number;
  pid: number;
  body: string;
  direction: 'patient' | 'provider';
  sender: string;
  date: string;
  message_status: string;
}

export default function PatientMessagePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const raw = localStorage.getItem('portal_patient');
  const patient = raw ? JSON.parse(raw) : null;
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const dob = patient?.dob || '';
  const pid = patient?.pid;

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ['patient-chat', pid],
    queryFn: async () => {
      const r = await nestClient.get(`/patient-chat/${pid}`, { params: { dob } });
      return r.data || [];
    },
    enabled: !!pid,
    refetchInterval: 10000,
  });

  const sendMsg = useMutation({
    mutationFn: (text: string) =>
      nestClient.post('/patient-chat', { pid: Number(pid), dob, body: text }),
    onSuccess: () => {
      setBody('');
      setError('');
      qc.invalidateQueries({ queryKey: ['patient-chat', pid] });
    },
    onError: (err: any) => {
      setError(
        err?.response?.data?.message || 'Could not send message. Please try again.',
      );
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  if (!patient) {
    navigate('/portal/login');
    return null;
  }

  const fmtTime = (d: string) => {
    if (!d) return '';
    const dt = new Date(d);
    return isNaN(dt.getTime())
      ? d
      : dt.toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
  };

  const handleSend = () => {
    if (!body.trim()) return;
    sendMsg.mutate(body);
  };

  return (
    <div className="min-vh-100 bg-light">
      <nav className="navbar navbar-dark bg-primary shadow-sm px-4">
        <div className="container-fluid">
          <a className="navbar-brand" href="#"><i className="bi bi-heart-pulse me-2"></i>Patient Portal</a>
          <div className="d-flex align-items-center gap-3">
            <span className="text-white small">Welcome, {patient.name}</span>
            <button className="btn btn-outline-light btn-sm" onClick={() => navigate('/portal/dashboard')}>
              <i className="bi bi-speedometer2 me-1"></i>Dashboard
            </button>
          </div>
        </div>
      </nav>

      <div className="container py-4" style={{ maxWidth: '760px' }}>
        <div className="card shadow-sm border-0" style={{ borderRadius: '16px' }}>
          <div className="card-header bg-white py-3 d-flex align-items-center gap-2" style={{ borderRadius: '16px 16px 0 0' }}>
            <div className="rounded-circle bg-primary bg-opacity-10 d-flex align-items-center justify-content-center" style={{ width: '38px', height: '38px' }}>
              <i className="bi bi-chat-dots text-primary"></i>
            </div>
            <div>
              <h5 className="mb-0 fw-bold">Message Your Provider</h5>
              <small className="text-muted">Your care team will reply here</small>
            </div>
          </div>

          {/* Conversation */}
          <div className="card-body" style={{ height: '420px', overflowY: 'auto', backgroundColor: '#f8f9fa' }}>
            {isLoading ? (
              <div className="text-center text-muted py-5">
                <div className="spinner-border text-primary mb-2"></div>
                <p>Loading conversation...</p>
              </div>
            ) : !messages.length ? (
              <div className="text-center text-muted py-5">
                <i className="bi bi-chat-left-text fs-1 d-block mb-2 opacity-25"></i>
                <p>No messages yet. Start a conversation with your provider.</p>
              </div>
            ) : null}
            {messages.map((m: ChatMsg) => {
              const isPatient = m.direction === 'patient';
              return (
                <div key={m.id} className={`d-flex mb-2 ${isPatient ? 'justify-content-end' : 'justify-content-start'}`}>
                  {!isPatient && (
                    <div className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0 text-white bg-success me-2"
                      style={{ width: '26px', height: '26px', fontSize: '0.8rem' }}>
                      <i className="bi bi-person-badge"></i>
                    </div>
                  )}
                  <div className="d-flex flex-column" style={{ maxWidth: '75%' }}>
                    <div
                      className={`p-2 px-3 ${isPatient ? 'bg-primary text-white' : 'bg-white border'}`}
                      style={{
                        borderRadius: '14px',
                        borderBottomRightRadius: isPatient ? '4px' : '14px',
                        borderBottomLeftRadius: isPatient ? '14px' : '4px',
                      }}
                    >
                      <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
                    </div>
                    <small className={`text-muted ${isPatient ? 'text-end' : ''}`} style={{ fontSize: '0.7rem' }}>
                      {isPatient ? 'You' : 'Care Team'} · {fmtTime(m.date)}
                    </small>
                  </div>
                  {isPatient && (
                    <div className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0 text-white bg-primary ms-2"
                      style={{ width: '26px', height: '26px', fontSize: '0.65rem', fontWeight: 700 }}>
                      {(patient?.name || 'You').trim().split(/\s+/).map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          {/* Compose */}
          <div className="card-footer bg-white py-3" style={{ borderRadius: '0 0 16px 16px' }}>
            {error && <div className="alert alert-danger py-2 small">{error}</div>}
            <div className="d-flex gap-2">
              <textarea
                className="form-control"
                rows={2}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Type your message here..."
              />
              <button
                className="btn btn-primary align-self-end d-flex align-items-center"
                onClick={handleSend}
                disabled={sendMsg.isPending || !body.trim()}
              >
                {sendMsg.isPending ? (
                  <span className="spinner-border spinner-border-sm"></span>
                ) : (
                  <i className="bi bi-send"></i>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
