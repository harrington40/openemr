import { useState, useMemo, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';

interface ForumPost {
  id: number;
  body: string;
  author: string;
  authorColor: string;
  createdAt: string;
  votes: number;
}

interface ForumThread {
  id: number;
  category: string;
  title: string;
  body: string;
  author: string;
  authorColor: string;
  createdAt: string;
  votes: number;
  views: number;
  pinned?: boolean;
  answered?: boolean;
  replies: ForumPost[];
}

const CATEGORIES = [
  { id: 'all', label: 'All Topics', icon: 'bi-grid' },
  { id: 'general', label: 'General', icon: 'bi-chat-square-dots' },
  { id: 'clinical', label: 'Clinical Q&A', icon: 'bi-heart-pulse' },
  { id: 'billing', label: 'Billing & Insurance', icon: 'bi-cash-coin' },
  { id: 'technical', label: 'Technical Support', icon: 'bi-tools' },
  { id: 'features', label: 'Feature Requests', icon: 'bi-lightbulb' },
];

const AVATAR_COLORS = ['#0d6efd', '#198754', '#dc3545', '#fd7e14', '#6f42c1', '#20c997', '#0dcaf0', '#e83e8c'];

const now = () => new Date().toISOString();
const timeAgo = (iso: string) => {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
};

const SEED_THREADS: ForumThread[] = [
  {
    id: 1, category: 'general', pinned: true, answered: true,
    title: 'Welcome to the OpenRx Community 🎉',
    body: 'This is a local, self-contained community space for prospective clients, users, and the OpenRx team. Introduce yourself, ask questions, and share ideas. Everything is stored privately on this device — no external services.',
    author: 'OpenRx Team', authorColor: '#0d6efd',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 6).toISOString(),
    votes: 42, views: 1204,
    replies: [
      { id: 101, body: 'Excited to be here! Looking forward to learning more about the platform.', author: 'Dr. Sarah Chen', authorColor: '#198754', createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString(), votes: 8 },
      { id: 102, body: 'Welcome! Feel free to ask anything — our community is very responsive.', author: 'Mary Gbatu', authorColor: '#6f42c1', createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 4).toISOString(), votes: 5 },
    ],
  },
  {
    id: 2, category: 'clinical', answered: true,
    title: 'Best practices for managing hypertension follow-ups?',
    body: 'What workflows do clinics use to track BP readings and recall patients whose hypertension is poorly controlled?',
    author: 'Prospective Client', authorColor: '#dc3545',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
    votes: 17, views: 640,
    replies: [
      { id: 201, body: 'OpenRx includes a Recall Board and automated alerts for abnormal vitals. You can also set decision-support rules.', author: 'James Kollie', authorColor: '#20c997', createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(), votes: 6 },
    ],
  },
  {
    id: 3, category: 'billing',
    title: 'Does OpenRx support insurance claims and LRD billing?',
    body: 'We are evaluating the system for a clinic in Liberia and need multi-currency billing plus claim tracking.',
    author: 'New Clinic Admin', authorColor: '#fd7e14',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
    votes: 12, views: 388,
    replies: [],
  },
  {
    id: 4, category: 'technical',
    title: 'Can the system run on-premise with no internet?',
    body: 'We have limited connectivity. Is a fully local deployment supported?',
    author: 'IT Manager', authorColor: '#0dcaf0',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
    votes: 9, views: 210,
    replies: [],
  },
  {
    id: 5, category: 'features',
    title: 'Feature idea: SMS appointment reminders',
    body: 'Would love to see built-in SMS reminders for appointments to reduce no-shows.',
    author: 'Clinic Manager', authorColor: '#e83e8c',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
    votes: 23, views: 155,
    replies: [],
  },
];

const STORAGE_KEY = 'openrx-community-forum';

function loadThreads(): ForumThread[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return SEED_THREADS;
}

export default function CommunityForumPage() {
  const { user } = useAuth();
  const [threads, setThreads] = useState<ForumThread[]>(loadThreads);
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [activeThread, setActiveThread] = useState<ForumThread | null>(null);
  const [showCompose, setShowCompose] = useState(false);
  const [form, setForm] = useState({ category: 'general', title: '', body: '' });
  const [replyBody, setReplyBody] = useState('');

  const authorName = user?.displayName || user?.username || 'Guest';
  const authorColor = AVATAR_COLORS[(authorName.length + authorName.charCodeAt(0)) % AVATAR_COLORS.length];

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(threads));
  }, [threads]);

  const filtered = useMemo(() => {
    let list = threads;
    if (category !== 'all') list = list.filter(t => t.category === category);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter(t => `${t.title} ${t.body} ${t.author}`.toLowerCase().includes(q));
    return [...list].sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [threads, category, search]);

  const totalReplies = threads.reduce((s, t) => s + t.replies.length, 0);

  const createThread = () => {
    if (!form.title.trim() || !form.body.trim()) return;
    const thread: ForumThread = {
      id: Date.now(),
      category: form.category,
      title: form.title.trim(),
      body: form.body.trim(),
      author: authorName,
      authorColor,
      createdAt: now(),
      votes: 0,
      views: 0,
      replies: [],
    };
    setThreads(prev => [thread, ...prev]);
    setForm({ category: 'general', title: '', body: '' });
    setShowCompose(false);
    setActiveThread(thread);
  };

  const addReply = () => {
    if (!replyBody.trim() || !activeThread) return;
    const reply: ForumPost = {
      id: Date.now(),
      body: replyBody.trim(),
      author: authorName,
      authorColor,
      createdAt: now(),
      votes: 0,
    };
    setThreads(prev => prev.map(t => t.id === activeThread.id ? { ...t, replies: [...t.replies, reply] } : t));
    setReplyBody('');
  };

  const voteThread = (id: number, delta: number) => {
    setThreads(prev => prev.map(t => t.id === id ? { ...t, votes: t.votes + delta } : t));
  };

  const initials = (name: string) => name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  const openThread = (t: ForumThread) => {
    setThreads(prev => prev.map(x => x.id === t.id ? { ...x, views: x.views + 1 } : x));
    setActiveThread(t);
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
          box-shadow: 0 22px 45px rgba(10,37,64,0.20), 0 6px 14px rgba(10,37,64,0.10), inset 0 2px 0 rgba(13,110,253,0.45), inset 0 -2px 0 rgba(0,201,167,0.45) !important;
          transition: transform .25s ease, box-shadow .25s ease, background .25s ease;
        }
        .glass-page .card:hover {
          transform: translateY(-5px);
          background: rgba(255,255,255,0.70) !important;
          box-shadow: 0 30px 60px rgba(10,37,64,0.28), 0 10px 20px rgba(10,37,64,0.14), inset 0 2px 0 rgba(13,110,253,0.60), inset 0 -2px 0 rgba(0,201,167,0.60) !important;
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
      {/* Hero */}
      <div className="rounded-4 p-4 mb-4 text-white position-relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #6f42c1 0%, #0d6efd 50%, #0dcaf0 100%)' }}>
        <div className="position-absolute end-0 top-0 opacity-10" style={{ fontSize: '7rem', transform: 'rotate(12deg) translate(20px,-10px)' }}><i className="bi bi-people-fill"></i></div>
        <div className="position-relative d-flex justify-content-between align-items-start flex-wrap gap-3">
          <div>
            <h2 className="mb-1 fw-bold"><i className="bi bi-people-fill me-2"></i>Community Forum</h2>
            <p className="mb-0 text-white text-opacity-75 small">A private, self-contained space for clients and the OpenRx team to connect.</p>
          </div>
          <button className="btn btn-light rounded-pill fw-semibold" onClick={() => setShowCompose(!showCompose)}>
            <i className={`bi ${showCompose ? 'bi-x-lg' : 'bi-plus-circle'} me-1`}></i>
            {showCompose ? 'Cancel' : 'New Topic'}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="row g-3 mb-3">
        {[
          { v: threads.length, l: 'Topics', c: '#6f42c1', i: 'bi-chat-square-dots' },
          { v: totalReplies, l: 'Replies', c: '#0d6efd', i: 'bi-reply-all' },
          { v: threads.reduce((s, t) => s + t.votes, 0), l: 'Votes', c: '#fd7e14', i: 'bi-hand-thumbs-up' },
          { v: threads.filter(t => t.answered).length, l: 'Answered', c: '#198754', i: 'bi-check-circle' },
        ].map((s, i) => (
          <div className="col-md-3 col-sm-6" key={i}>
            <div className="card border-0 shadow-sm h-100" style={{ borderRadius: '16px' }}>
              <div className="card-body d-flex align-items-center gap-3 py-3">
                <div className="rounded-circle d-flex align-items-center justify-content-center" style={{ width: '46px', height: '46px', backgroundColor: s.c + '18' }}>
                  <i className={`bi ${s.i} fs-5`} style={{ color: s.c }}></i>
                </div>
                <div><div className="fw-bold fs-5" style={{ color: s.c }}>{s.v}</div><small className="text-muted">{s.l}</small></div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Compose */}
      {showCompose && (
        <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '16px' }}>
          <div className="card-header bg-white py-3" style={{ borderRadius: '16px 16px 0 0' }}>
            <h6 className="mb-0 fw-bold"><i className="bi bi-pencil-square me-2 text-primary"></i>Start a New Topic</h6>
          </div>
          <div className="card-body">
            <div className="row g-2 mb-2">
              <div className="col-md-4">
                <label className="form-label small">Category</label>
                <select className="form-select form-select-sm" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                  {CATEGORIES.filter(c => c.id !== 'all').map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
              <div className="col-md-8">
                <label className="form-label small">Title</label>
                <input className="form-control form-control-sm" placeholder="What would you like to discuss?" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
              </div>
            </div>
            <textarea className="form-control" rows={4} placeholder="Describe your topic in detail…" value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} />
            <button className="btn btn-primary rounded-pill px-4 mt-2" onClick={createThread} disabled={!form.title.trim() || !form.body.trim()}>
              <i className="bi bi-send me-1"></i>Post Topic
            </button>
          </div>
        </div>
      )}

      <div className="row g-3">
        {/* Forum list */}
        <div className="col-lg-8">
          {/* Filters */}
          <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
            <div className="btn-group flex-wrap" role="group">
              {CATEGORIES.map(c => (
                <button key={c.id} className={`btn btn-sm rounded-pill ${category === c.id ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setCategory(c.id)}>
                  <i className={`bi ${c.icon} me-1`}></i>{c.label}
                </button>
              ))}
            </div>
            <div className="ms-auto" style={{ minWidth: '220px' }}>
              <div className="input-group input-group-sm">
                <span className="input-group-text bg-white border-end-0 rounded-pill-start"><i className="bi bi-search text-muted"></i></span>
                <input className="form-control border-start-0 rounded-pill-end" placeholder="Search topics…" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
            </div>
          </div>

          {/* Thread list */}
          <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
            <div className="card-header bg-white py-3" style={{ borderRadius: '16px 16px 0 0' }}>
              <h6 className="mb-0 fw-bold"><i className="bi bi-chat-square-dots me-2 text-primary"></i>Discussions</h6>
            </div>
            <div className="card-body p-0">
              {filtered.map(t => {
                const cat = CATEGORIES.find(c => c.id === t.category);
                return (
                  <div key={t.id} className="border-bottom px-3 py-3" style={{ cursor: 'pointer' }} onClick={() => openThread(t)}>
                    <div className="d-flex gap-3">
                      <div className="rounded-circle d-flex align-items-center justify-content-center text-white flex-shrink-0 fw-bold" style={{ width: '44px', height: '44px', backgroundColor: t.authorColor, fontSize: '0.85rem' }}>
                        {initials(t.author)}
                      </div>
                      <div className="flex-grow-1 min-width-0">
                        <div className="d-flex align-items-center gap-2 flex-wrap">
                          {t.pinned && <span className="badge bg-warning text-dark rounded-pill"><i className="bi bi-pin-angle me-1"></i>Pinned</span>}
                          {t.answered && <span className="badge bg-success rounded-pill"><i className="bi bi-check-lg me-1"></i>Answered</span>}
                          <span className="badge bg-light text-dark border rounded-pill"><i className={`bi ${cat?.icon} me-1`}></i>{cat?.label}</span>
                        </div>
                        <div className="fw-semibold mt-1">{t.title}</div>
                        <div className="text-muted small mt-1" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{t.body}</div>
                        <div className="d-flex align-items-center gap-3 mt-1 text-muted" style={{ fontSize: '0.72rem' }}>
                          <span><i className="bi bi-person me-1"></i>{t.author}</span>
                          <span><i className="bi bi-clock me-1"></i>{timeAgo(t.createdAt)}</span>
                          <span><i className="bi bi-hand-thumbs-up me-1"></i>{t.votes}</span>
                          <span><i className="bi bi-chat-left-text me-1"></i>{t.replies.length}</span>
                          <span><i className="bi bi-eye me-1"></i>{t.views}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {filtered.length === 0 && (
                <div className="text-center text-muted py-5">
                  <i className="bi bi-chat-square-dots fs-1 d-block mb-2 opacity-25"></i>
                  <p>No topics found. Start the conversation!</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="col-lg-4">
          <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '16px' }}>
            <div className="card-header text-white py-3" style={{ background: 'linear-gradient(135deg,#6f42c1,#0d6efd)', borderRadius: '16px 16px 0 0' }}>
              <h6 className="mb-0 fw-bold"><i className="bi bi-info-circle me-2"></i>About this Community</h6>
            </div>
            <div className="card-body small">
              <p className="text-muted mb-2">This forum is <strong>local and self-contained</strong> — all posts and replies are stored privately on this device (localStorage). No external servers, accounts, or data sharing.</p>
              <ul className="list-unstyled mb-0 text-muted">
                <li className="mb-1"><i className="bi bi-shield-lock me-2 text-success"></i>Private & offline</li>
                <li className="mb-1"><i className="bi bi-people me-2 text-primary"></i>For clients & the OpenRx team</li>
                <li><i className="bi bi-lightbulb me-2 text-warning"></i>Share questions, tips & feature ideas</li>
              </ul>
            </div>
          </div>

          {/* Active thread */}
          {activeThread && (
            <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
              <div className="card-header bg-white py-3 d-flex justify-content-between align-items-center" style={{ borderRadius: '16px 16px 0 0' }}>
                <h6 className="mb-0 fw-bold text-truncate">{activeThread.title}</h6>
                <button className="btn-close" onClick={() => setActiveThread(null)}></button>
              </div>
              <div className="card-body p-3" style={{ maxHeight: '460px', overflowY: 'auto' }}>
                <div className="d-flex gap-2 mb-3">
                  <div className="rounded-circle d-flex align-items-center justify-content-center text-white flex-shrink-0 fw-bold" style={{ width: '38px', height: '38px', backgroundColor: activeThread.authorColor, fontSize: '0.75rem' }}>{initials(activeThread.author)}</div>
                  <div>
                    <div className="small fw-semibold">{activeThread.author}</div>
                    <div className="text-muted" style={{ fontSize: '0.7rem' }}>{timeAgo(activeThread.createdAt)}</div>
                  </div>
                </div>
                <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{activeThread.body}</p>
                <div className="d-flex gap-2 mb-3">
                  <button className="btn btn-sm btn-outline-primary rounded-pill" onClick={() => voteThread(activeThread.id, 1)}><i className="bi bi-hand-thumbs-up me-1"></i>{activeThread.votes}</button>
                  <span className="text-muted small align-self-center">{activeThread.replies.length} repl{activeThread.replies.length === 1 ? 'y' : 'ies'}</span>
                </div>
                <hr />
                {activeThread.replies.map(r => (
                  <div key={r.id} className="d-flex gap-2 mb-3">
                    <div className="rounded-circle d-flex align-items-center justify-content-center text-white flex-shrink-0 fw-bold" style={{ width: '32px', height: '32px', backgroundColor: r.authorColor, fontSize: '0.7rem' }}>{initials(r.author)}</div>
                    <div className="flex-grow-1">
                      <div className="d-flex justify-content-between">
                        <span className="small fw-semibold">{r.author}</span>
                        <span className="text-muted" style={{ fontSize: '0.68rem' }}>{timeAgo(r.createdAt)}</span>
                      </div>
                      <div className="small text-muted" style={{ whiteSpace: 'pre-wrap' }}>{r.body}</div>
                    </div>
                  </div>
                ))}
                <div className="d-flex gap-2 mt-2">
                  <input className="form-control form-control-sm rounded-pill" placeholder="Write a reply…" value={replyBody} onChange={e => setReplyBody(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addReply(); } }} />
                  <button className="btn btn-sm btn-primary rounded-pill" onClick={addReply} disabled={!replyBody.trim()}><i className="bi bi-send"></i></button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
