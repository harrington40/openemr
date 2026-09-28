import { useState } from 'react';
import { useNavigate, NavLink } from 'react-router-dom';
import nestClient from '../../api/nest-client';
import { useAuth } from '../../hooks/useAuth';

/** Map an authenticated role to its default landing page. */
const homeForRole = (role?: string, mainMenuRole?: string): string => {
  if (mainMenuRole === 'registered_nurse') return '/rn-dashboard';
  switch (role) {
    case 'nurse': return '/nurse-dashboard';
    case 'front_desk': return '/registrar-dashboard';
    case 'physician': return '/provider-dashboard';
    case 'midwife': return '/midwife-dashboard';
    case 'lab_tech': return '/lab-tech-dashboard';
    case 'inventory_manager': return '/inventory';
    case 'pharmacist': return '/pharmacy';
    default: return '/dashboard';
  }
};

const FEATURES = [
  {
    icon: 'bi-capsule',
    title: 'E-Prescribing & Pharmacy',
    text: 'Prescribe, verify, and dispense with live drug info, interactions, and billing status.',
    tint: 'rgba(0,201,167,0.22)',
  },
  {
    icon: 'bi-eyedropper',
    title: 'Labs & Diagnostics',
    text: 'Order tests, capture results, and route them back to the care team instantly.',
    tint: 'rgba(13,110,253,0.22)',
  },
  {
    icon: 'bi-cash-stack',
    title: 'Billing & Clearance',
    text: 'Auto-bill encounters and generate smart receipts for a smooth discharge.',
    tint: 'rgba(255,193,7,0.22)',
  },
  {
    icon: 'bi-box-seam',
    title: 'Inventory & Barcodes',
    text: 'Track stock, traceability, and approvals with real Code-128 barcode labels.',
    tint: 'rgba(0,201,167,0.22)',
  },
  {
    icon: 'bi-people',
    title: 'Patient Portal',
    text: 'Secure patient access to records, messages, appointments, and payments.',
    tint: 'rgba(13,110,253,0.22)',
  },
  {
    icon: 'bi-clipboard2-pulse',
    title: 'Clinical Notes & Vitals',
    text: 'Document encounters with smart acuity scoring, NEWS2, and trending vitals.',
    tint: 'rgba(255,193,7,0.22)',
  },
];

const TRUST = [
  { icon: 'bi-shield-lock', label: 'Role-Based Access' },
  { icon: 'bi-graph-up-arrow', label: 'Real-Time Analytics' },
  { icon: 'bi-lightning-charge', label: 'Smart Automation' },
];

const PRICING = [
  { tier: 'Basic', price: '$49', period: '/mo', users: 'Up to 5 users', highlight: false },
  { tier: 'Professional', price: '$149', period: '/mo', users: 'Up to 25 users', highlight: true },
  { tier: 'Enterprise', price: '$499', period: '/mo', users: 'Up to 100 users', highlight: false },
];

const CONTACT_EMAIL = 'dev@transtechologies.com';

export default function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await nestClient.post('/auth/login', { username, password });
      // NestJS returns { token, user } on success (2xx), throws on failure
      const { token, user } = res.data;
      if (user && token) {
        // Update the auth context (also persists to localStorage) so the
        // sidebar and role-based UI update immediately without a refresh.
        login({ ...user, token });
        navigate(homeForRole(user.role, user.main_menu_role), { replace: true });
      } else {
        setError('Invalid response from server');
      }
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Login failed';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.12)',
    border: '1px solid rgba(255,255,255,0.3)',
    color: '#fff',
    borderRadius: '14px',
    padding: '12px 16px',
    backdropFilter: 'blur(8px)',
  };

  return (
    <div
      className="min-vh-100 d-flex align-items-center justify-content-center position-relative overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, #0a2540 0%, #0d6efd 45%, #00c9a7 100%)',
      }}
    >
      <style>{`
        .pricing-card {
          cursor: pointer;
          transition: transform .2s ease, box-shadow .2s ease, background .2s ease, border-color .2s ease;
        }
        .pricing-card:hover, .pricing-card:focus-visible {
          transform: translateY(-4px);
          background: rgba(255,255,255,0.20) !important;
          border-color: rgba(255,255,255,0.6) !important;
          box-shadow: 0 16px 34px rgba(0,0,0,0.35);
          outline: none;
        }
      `}</style>
      {/* Decorative blurred orbs */}
      <div className="position-absolute rounded-circle" style={{ width: '420px', height: '420px', top: '-140px', left: '-100px', background: 'radial-gradient(circle, rgba(0,201,167,0.55), transparent 70%)', filter: 'blur(10px)' }}></div>
      <div className="position-absolute rounded-circle" style={{ width: '520px', height: '520px', bottom: '-180px', right: '-120px', background: 'radial-gradient(circle, rgba(13,110,253,0.55), transparent 70%)', filter: 'blur(10px)' }}></div>
      <div className="position-absolute rounded-circle" style={{ width: '260px', height: '260px', top: '18%', right: '18%', background: 'radial-gradient(circle, rgba(255,255,255,0.18), transparent 70%)', filter: 'blur(6px)' }}></div>

      <div className="container position-relative py-4 py-lg-5">
        <div className="row g-4 g-lg-5 align-items-center justify-content-center">
          {/* Marketing panel */}
          <div className="col-12 col-lg-7 d-none d-lg-block">
            <div
              style={{
                borderRadius: '28px',
                padding: '44px 40px',
                background: 'rgba(255,255,255,0.08)',
                backdropFilter: 'blur(22px)',
                WebkitBackdropFilter: 'blur(22px)',
                border: '1px solid rgba(255,255,255,0.22)',
                boxShadow: '0 24px 60px rgba(0,0,0,0.30)',
                color: '#fff',
              }}
            >
              <div className="d-flex align-items-center gap-3 mb-3">
                <div
                  className="rounded-circle d-inline-flex align-items-center justify-content-center flex-shrink-0"
                  style={{ width: '64px', height: '64px', background: 'rgba(255,255,255,0.16)', border: '1px solid rgba(255,255,255,0.3)', backdropFilter: 'blur(8px)' }}
                >
                  <i className="bi bi-heart-pulse-fill" style={{ fontSize: '1.9rem', color: '#ffffff' }}></i>
                </div>
                <div>
                  <h1 className="fw-bold mb-0" style={{ letterSpacing: '-0.5px', fontSize: '2rem' }}>OpenRx Health</h1>
                  <p className="mb-0" style={{ color: 'rgba(255,255,255,0.75)', fontSize: '0.95rem' }}>
                    Electronic Prescription & Health Records
                  </p>
                </div>
              </div>

              <h2 className="fw-semibold mb-2" style={{ fontSize: '1.45rem', letterSpacing: '-0.3px' }}>
                One connected platform for the entire care journey.
              </h2>
              <p className="mb-4" style={{ color: 'rgba(255,255,255,0.72)', fontSize: '0.95rem', maxWidth: '620px' }}>
                From the front desk to the pharmacy, OpenRx unifies registration, clinical notes, prescriptions,
                labs, billing, inventory, and patient engagement — so every department works as one.
              </p>

              <div className="row g-3 mb-4">
                {FEATURES.map((f) => (
                  <div className="col-6" key={f.title}>
                    <div
                      className="d-flex align-items-start gap-2 h-100"
                      style={{
                        borderRadius: '18px',
                        padding: '14px 14px',
                        background: f.tint,
                        border: '1px solid rgba(255,255,255,0.16)',
                        backdropFilter: 'blur(10px)',
                      }}
                    >
                      <div
                        className="rounded-3 d-inline-flex align-items-center justify-content-center flex-shrink-0"
                        style={{ width: '38px', height: '38px', background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.3)' }}
                      >
                        <i className={`bi ${f.icon}`} style={{ fontSize: '1.15rem', color: '#fff' }}></i>
                      </div>
                      <div>
                        <div className="fw-semibold" style={{ fontSize: '0.88rem', lineHeight: 1.2 }}>{f.title}</div>
                        <div className="mt-1" style={{ color: 'rgba(255,255,255,0.78)', fontSize: '0.78rem', lineHeight: 1.35 }}>{f.text}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="d-flex flex-wrap gap-2">
                {TRUST.map((t) => (
                  <span
                    key={t.label}
                    className="badge d-inline-flex align-items-center gap-1 rounded-pill"
                    style={{
                      background: 'rgba(255,255,255,0.12)',
                      border: '1px solid rgba(255,255,255,0.28)',
                      color: '#fff',
                      fontWeight: 500,
                      fontSize: '0.78rem',
                      padding: '8px 14px',
                    }}
                  >
                    <i className={`bi ${t.icon}`}></i>{t.label}
                  </span>
                ))}
              </div>

              <div className="mt-4">
                <div className="d-flex align-items-center gap-2 mb-2">
                  <i className="bi bi-credit-card"></i>
                  <span className="fw-semibold" style={{ fontSize: '0.9rem' }}>Plans & Pricing</span>
                </div>
                <div className="row g-2">
                  {PRICING.map((p) => (
                    <div className="col-4" key={p.tier}>
                      <div
                        role="button"
                        tabIndex={0}
                        className="pricing-card h-100"
                        onClick={() => navigate('/license')}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate('/license'); }}
                        style={{
                          borderRadius: '14px',
                          padding: '14px 10px',
                          height: '100%',
                          background: p.highlight ? 'rgba(0,201,167,0.22)' : 'rgba(255,255,255,0.10)',
                          border: p.highlight ? '1px solid rgba(0,201,167,0.65)' : '1px solid rgba(255,255,255,0.2)',
                          backdropFilter: 'blur(10px)',
                          textAlign: 'center',
                        }}
                      >
                        <div className="fw-semibold text-uppercase" style={{ fontSize: '0.7rem', letterSpacing: '0.5px', opacity: 0.9 }}>{p.tier}</div>
                        <div className="mt-1" style={{ fontSize: '1.35rem', fontWeight: 700, letterSpacing: '-0.5px' }}>
                          {p.price}<span style={{ fontSize: '0.7rem', fontWeight: 400, opacity: 0.8 }}>{p.period}</span>
                        </div>
                        <div style={{ fontSize: '0.72rem', opacity: 0.85 }}>{p.users}</div>
                        <div className="mt-2" style={{ fontSize: '0.7rem', opacity: 0.85 }}>
                          <i className="bi bi-arrow-right-circle me-1"></i>Get Started
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-3 d-flex flex-wrap align-items-center gap-2" style={{ fontSize: '0.82rem' }}>
                <i className="bi bi-envelope"></i>
                <span style={{ opacity: 0.85 }}>Business & subscription inquiries:</span>
                <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: '#fff', fontWeight: 600, textDecoration: 'none' }}>
                  {CONTACT_EMAIL}
                </a>
              </div>
            </div>
          </div>

          {/* Glass card / login form */}
          <div className="col-12 col-sm-10 col-md-8 col-lg-5">
            <div
              className="mx-auto"
              style={{
                width: '100%',
                maxWidth: '420px',
                borderRadius: '28px',
                padding: '40px 36px',
                background: 'rgba(255,255,255,0.10)',
                backdropFilter: 'blur(22px)',
                WebkitBackdropFilter: 'blur(22px)',
                border: '1px solid rgba(255,255,255,0.28)',
                boxShadow: '0 24px 60px rgba(0,0,0,0.35)',
                color: '#fff',
              }}
            >
              <div className="text-center mb-4">
                <div
                  className="rounded-circle d-inline-flex align-items-center justify-content-center mb-3 d-lg-none"
                  style={{ width: '76px', height: '76px', background: 'rgba(255,255,255,0.16)', border: '1px solid rgba(255,255,255,0.3)', backdropFilter: 'blur(8px)' }}
                >
                  <i className="bi bi-heart-pulse-fill" style={{ fontSize: '2.2rem', color: '#ffffff' }}></i>
                </div>
                <h2 className="fw-bold mb-1 d-lg-none" style={{ letterSpacing: '-0.5px' }}>OpenRx Health</h2>
                <p className="mb-0 d-lg-none" style={{ color: 'rgba(255,255,255,0.75)', fontSize: '0.9rem' }}>
                  Electronic Prescription & Health Records
                </p>
                <p className="mb-0 d-none d-lg-block" style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.9rem' }}>
                  <i className="bi bi-box-arrow-in-right me-1"></i>Sign in to your workspace
                </p>
              </div>

              {error && (
                <div
                  className="alert py-2 mb-3"
                  style={{
                    background: 'rgba(220,53,69,0.25)',
                    border: '1px solid rgba(255,120,130,0.5)',
                    color: '#fff',
                    borderRadius: '12px',
                    fontSize: '0.85rem',
                  }}
                >
                  <i className="bi bi-exclamation-triangle me-1"></i>{error}
                </div>
              )}

              <form onSubmit={handleLogin}>
                <div className="mb-3">
                  <label className="form-label small mb-1" style={{ color: 'rgba(255,255,255,0.85)' }}>
                    <i className="bi bi-person me-1"></i>Username
                  </label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Enter your username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    style={inputStyle}
                  />
                </div>
                <div className="mb-4">
                  <label className="form-label small mb-1" style={{ color: 'rgba(255,255,255,0.85)' }}>
                    <i className="bi bi-lock me-1"></i>Password
                  </label>
                  <input
                    type="password"
                    className="form-control"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    style={inputStyle}
                  />
                </div>

                <button
                  type="submit"
                  className="btn btn-lg w-100 fw-semibold"
                  disabled={loading}
                  style={{
                    borderRadius: '14px',
                    padding: '12px',
                    color: '#fff',
                    background: 'linear-gradient(90deg, #00c9a7 0%, #0d6efd 100%)',
                    border: 'none',
                    boxShadow: '0 10px 24px rgba(0,201,167,0.35)',
                  }}
                >
                  {loading ? (
                    <span className="spinner-border spinner-border-sm me-2"></span>
                  ) : (
                    <i className="bi bi-box-arrow-in-right me-1"></i>
                  )}
                  Sign In
                </button>
              </form>

              <div className="text-center mt-4">
                <NavLink
                  to="/register"
                  className="btn w-100 fw-semibold"
                  style={{
                    borderRadius: '14px',
                    padding: '11px',
                    color: '#fff',
                    background: 'rgba(255,255,255,0.12)',
                    border: '1px solid rgba(255,255,255,0.4)',
                    backdropFilter: 'blur(8px)',
                    WebkitBackdropFilter: 'blur(8px)',
                  }}
                >
                  <i className="bi bi-person-plus me-1"></i>Staff Registration
                </NavLink>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
