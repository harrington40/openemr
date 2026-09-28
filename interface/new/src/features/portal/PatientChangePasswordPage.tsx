import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import nestClient from '../../api/nest-client';

/**
 * Requirements shown to the patient while they type.
 *
 * Presentational only — the server re-checks every rule and remains the
 * authority. Kept deliberately small so there is less to drift out of step
 * with the backend policy than a full re-implementation would.
 */
const RULES: { label: string; test: (v: string) => boolean }[] = [
  { label: 'At least 12 characters', test: v => v.length >= 12 },
  { label: 'An uppercase letter', test: v => /[A-Z]/.test(v) },
  { label: 'A lowercase letter', test: v => /[a-z]/.test(v) },
  { label: 'A number', test: v => /[0-9]/.test(v) },
  { label: 'A symbol', test: v => /[^A-Za-z0-9]/.test(v) },
];

export default function PatientChangePasswordPage() {
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const [done, setDone] = useState(false);

  const patient = (() => {
    try {
      return JSON.parse(localStorage.getItem('portal_patient') || 'null');
    } catch {
      return null;
    }
  })();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProblems([]);
    if (next !== confirm) {
      setProblems(['The two new passwords do not match.']);
      return;
    }
    try {
      await nestClient.post(
        '/portal/change-password',
        { currentPassword: current, newPassword: next },
        { headers: { Authorization: `Bearer ${patient?.token}` } },
      );
      // Clear the flag locally so the dashboard does not bounce the patient back.
      localStorage.setItem('portal_patient', JSON.stringify({ ...patient, mustChangePassword: false }));
      setDone(true);
    } catch (err: any) {
      const data = err?.response?.data;
      // The API returns the full list of failed rules; show all of them rather
      // than making the patient fix one at a time.
      setProblems(Array.isArray(data?.problems) ? data.problems : [data?.message || 'Could not change the password.']);
    }
  };

  if (!patient?.token) {
    return (
      <div className="min-vh-100 d-flex align-items-center justify-content-center bg-light">
        <div className="text-center">
          <p className="text-muted">Your session has ended. Please sign in again.</p>
          <Link to="/portal/login" className="btn btn-success">Back to sign in</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-vh-100 d-flex align-items-center justify-content-center" style={{ background: 'linear-gradient(135deg, #0a2540 0%, #0d6efd 45%, #00c9a7 100%)' }}>
      <div className="card shadow" style={{ width: '440px', borderRadius: '24px', background: 'rgba(255,255,255,0.94)' }}>
        <div className="card-body p-4">
          <div className="text-center mb-4">
            <i className="bi bi-shield-lock text-success" style={{ fontSize: '2.5rem' }}></i>
            <h4 className="mt-2 mb-1">Choose your password</h4>
            <p className="text-muted small mb-0">
              The password you were given is for one sign-in only. Please pick your own.
            </p>
          </div>

          {done ? (
            <div className="text-center">
              <div className="alert alert-success py-2 small">Your password has been updated.</div>
              <button className="btn btn-success w-100" onClick={() => navigate('/portal/dashboard', { replace: true })}>
                Continue to my records
              </button>
            </div>
          ) : (
            <>
              {problems.length > 0 && (
                <div className="alert alert-danger py-2 small">
                  <ul className="mb-0 ps-3">
                    {problems.map(p => <li key={p}>{p}</li>)}
                  </ul>
                </div>
              )}
              <form onSubmit={handleSubmit}>
                <div className="mb-3">
                  <label className="form-label">Current password</label>
                  <input type="password" className="form-control" value={current}
                    onChange={e => setCurrent(e.target.value)} required autoComplete="current-password" />
                </div>
                <div className="mb-3">
                  <label className="form-label">New password</label>
                  <input type="password" className="form-control" value={next}
                    onChange={e => setNext(e.target.value)} required autoComplete="new-password" />
                </div>
                <ul className="list-unstyled small mb-3">
                  {RULES.map(rule => {
                    const met = rule.test(next);
                    return (
                      <li key={rule.label} className={met ? 'text-success' : 'text-muted'}>
                        <i className={`bi ${met ? 'bi-check-circle-fill' : 'bi-circle'} me-1`}></i>
                        {rule.label}
                      </li>
                    );
                  })}
                </ul>
                <div className="mb-3">
                  <label className="form-label">Confirm new password</label>
                  <input type="password" className="form-control" value={confirm}
                    onChange={e => setConfirm(e.target.value)} required autoComplete="new-password" />
                </div>
                <button type="submit" className="btn btn-success w-100">Update password</button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
