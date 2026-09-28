import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import nestClient from '../../../api/nest-client';
import { useAuth } from '../../../hooks/useAuth';

interface ChatMsg {
  id: number;
  pid: number;
  body: string;
  direction: 'patient' | 'provider';
  sender: string;
  date: string;
  message_status: string;
}

interface Props {
  patientId: string;
  patientName: string;
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

/**
 * Doctor ↔ patient chat embedded in the patient chart.
 * Uses the same patient-chat backend endpoints as the standalone chat page.
 */
export default function MessagesTab({ patientId, patientName }: Props) {
  const { user } = useAuth();
  const canWrite = user?.role === 'physician' || user?.role === 'admin';
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const providerInitials = initials(user?.displayName || user?.username || 'DR');
  const patientInitials = initials(patientName);

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ['chat-thread', patientId],
    queryFn: async () => {
      const r = await nestClient.get(`/chat/thread/${patientId}`);
      return r.data || [];
    },
    refetchInterval: 5000,
  });

  const markRead = useMutation({
    mutationFn: () => nestClient.post(`/chat/thread/${patientId}/read`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat-patients'] });
      qc.invalidateQueries({ queryKey: ['provider-chat-unread'] });
    },
  });

  const sendMsg = useMutation({
    mutationFn: (text: string) =>
      nestClient.post(`/chat/thread/${patientId}`, { body: text }),
    onSuccess: () => {
      setBody('');
      setError('');
      qc.invalidateQueries({ queryKey: ['chat-thread', patientId] });
    },
    onError: (err: any) => {
      setError(
        err?.response?.data?.message || 'Could not send message. Please try again.',
      );
    },
  });

  useEffect(() => {
    markRead.mutate();
  }, [patientId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

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

  const avatar = (isProvider: boolean) => (
    <div
      className={`rounded-circle d-flex align-items-center justify-content-center flex-shrink-0 text-white ${isProvider ? 'bg-primary ms-2' : 'bg-info me-2'}`}
      style={{ width: '26px', height: '26px', fontSize: '0.65rem', fontWeight: 700 }}
      title={isProvider ? (user?.displayName || user?.username || 'You') : patientName}
    >
      {isProvider ? providerInitials : patientInitials}
    </div>
  );

  return (
    <div>
      <div className="d-flex align-items-center gap-2 mb-3">
        <div className="rounded-circle bg-info bg-opacity-10 d-flex align-items-center justify-content-center" style={{ width: '34px', height: '34px' }}>
          <i className="bi bi-chat-dots text-info"></i>
        </div>
        <div>
          <h6 className="mb-0 fw-bold">Messages with {patientName}</h6>
          <small className="text-muted">Conversation with the patient</small>
        </div>
      </div>

      <div className="rounded-3 border" style={{ overflow: 'hidden' }}>
        <div className="p-3" style={{ height: '360px', overflowY: 'auto', backgroundColor: '#f8f9fa' }}>
          {isLoading ? (
            <div className="text-center text-muted py-5">
              <div className="spinner-border text-primary mb-2"></div>
              <p>Loading conversation...</p>
            </div>
          ) : !messages.length ? (
            <div className="text-center text-muted py-5">
              <i className="bi bi-chat-left-text fs-1 d-block mb-2 opacity-25"></i>
              <p>No messages yet. Start the conversation below.</p>
            </div>
          ) : null}
          {messages.map((m: ChatMsg) => {
            const isProvider = m.direction === 'provider';
            return (
              <div key={m.id} className={`d-flex mb-2 ${isProvider ? 'justify-content-end' : 'justify-content-start'}`}>
                {!isProvider && avatar(false)}
                <div className="d-flex flex-column" style={{ maxWidth: '75%' }}>
                  <div
                    className={`p-2 px-3 ${isProvider ? 'bg-primary text-white' : 'bg-white border'}`}
                    style={{
                      borderRadius: '14px',
                      borderBottomRightRadius: isProvider ? '4px' : '14px',
                      borderBottomLeftRadius: isProvider ? '14px' : '4px',
                    }}
                  >
                    <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
                  </div>
                  <small className={`text-muted ${isProvider ? 'text-end' : ''}`} style={{ fontSize: '0.7rem' }}>
                    {isProvider ? 'You' : patientName} · {fmtTime(m.date)}
                  </small>
                </div>
                {isProvider && avatar(true)}
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        <div className="bg-white p-2 border-top">
          {error && <div className="alert alert-danger py-2 small">{error}</div>}
          {canWrite ? (
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
                placeholder={`Message ${patientName}...`}
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
          ) : (
            <div className="text-center text-muted small py-2">
              <i className="bi bi-lock me-1"></i>Read-only — only providers (physicians) can send messages.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
