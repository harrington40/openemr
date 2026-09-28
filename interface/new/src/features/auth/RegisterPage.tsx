

import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import nestClient from '../../api/nest-client';
import PhoneInput from '../../components/shared/PhoneInput';

export default function RegisterPage() {
  const [form, setForm] = useState({
    username: '', password: '', confirmPassword: '',
    fname: '', lname: '', title: '', specialty: '',
    physician_type: '', npi: '', email: '', phone: '',
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const update = (field: string, value: string) => setForm(prev => ({ ...prev, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (form.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setSubmitting(true);
    try {
      await nestClient.post('/auth/register', {
        username: form.username,
        password: form.password,
        fname: form.fname,
        lname: form.lname,
        title: form.title,
        specialty: form.specialty,
        physician_type: form.physician_type,
        npi: form.npi,
        email: form.email,
        phone: form.phone,
      });
      setSuccess(true);
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Registration failed. Please try again.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="min-vh-100 d-flex align-items-center justify-content-center position-relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #0a2540 0%, #0d6efd 45%, #00c9a7 100%)' }}>
        <div className="card shadow-lg border-0 position-relative" style={{ maxWidth: '480px', width: '100%', borderRadius: '24px', background: 'rgba(255,255,255,0.88)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)', border: '1px solid rgba(255,255,255,0.6)' }}>
          <div className="card-body text-center p-5">
            <div className="mb-4">
              <div className="rounded-circle bg-success d-inline-flex align-items-center justify-content-center"
                style={{ width: '72px', height: '72px' }}>
                <i className="bi bi-check-lg text-white fs-1"></i>
              </div>
            </div>
            <h4 className="mb-2">Registration Submitted!</h4>
            <p className="text-muted mb-3">
              Your application has been received. An administrator will review it within <strong>30 days</strong>.
              You'll be able to log in once approved.
            </p>
            <div className="alert alert-info small py-2">
              <i className="bi bi-info-circle me-1"></i>
              Your username: <strong>{form.username}</strong>
            </div>
            <NavLink to="/login" className="btn btn-primary mt-3">
              <i className="bi bi-box-arrow-in-right me-1"></i>Go to Login
            </NavLink>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-vh-100 d-flex align-items-center justify-content-center py-4 position-relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #0a2540 0%, #0d6efd 45%, #00c9a7 100%)' }}>
      <div className="position-absolute rounded-circle" style={{ width: '360px', height: '360px', top: '-100px', left: '-80px', background: 'radial-gradient(circle, rgba(0,201,167,0.45), transparent 70%)', filter: 'blur(18px)' }}></div>
      <div className="position-absolute rounded-circle" style={{ width: '420px', height: '420px', bottom: '-120px', right: '-100px', background: 'radial-gradient(circle, rgba(13,110,253,0.45), transparent 70%)', filter: 'blur(18px)' }}></div>
      <div className="card shadow-lg border-0 position-relative" style={{ maxWidth: '620px', width: '100%', borderRadius: '24px', background: 'rgba(255,255,255,0.88)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)', border: '1px solid rgba(255,255,255,0.6)' }}>
        <div className="card-header bg-primary text-white text-center py-3">
          <h4 className="mb-1">
            <i className="bi bi-person-plus me-2"></i>Staff Registration
          </h4>
          <p className="mb-0 small opacity-75">Create your OpenRx account — pending admin approval</p>
        </div>
        <div className="card-body p-4">
          {error && (
            <div className="alert alert-danger small py-2">
              <i className="bi bi-exclamation-triangle me-1"></i>{error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            {/* Account Info */}
            <h6 className="text-muted text-uppercase small border-bottom pb-1 mb-2">Account Credentials</h6>
            <div className="row g-2 mb-3">
              <div className="col-md-6">
                <label className="form-label small">Username <span className="text-danger">*</span></label>
                <input className="form-control form-control-sm" value={form.username}
                  onChange={e => update('username', e.target.value)} required />
              </div>
              <div className="col-md-6">
                <label className="form-label small">Email</label>
                <input className="form-control form-control-sm" type="email" value={form.email}
                  onChange={e => update('email', e.target.value)} />
              </div>
              <div className="col-md-6">
                <label className="form-label small">Password <span className="text-danger">*</span></label>
                <input className="form-control form-control-sm" type="password" value={form.password}
                  onChange={e => update('password', e.target.value)} required minLength={6} />
              </div>
              <div className="col-md-6">
                <label className="form-label small">Confirm Password <span className="text-danger">*</span></label>
                <input className="form-control form-control-sm" type="password" value={form.confirmPassword}
                  onChange={e => update('confirmPassword', e.target.value)} required />
              </div>
            </div>

            {/* Personal Info */}
            <h6 className="text-muted text-uppercase small border-bottom pb-1 mb-2">Personal Information</h6>
            <div className="row g-2 mb-3">
              <div className="col-md-3">
                <label className="form-label small">Title</label>
                <select className="form-select form-select-sm" value={form.title}
                  onChange={e => update('title', e.target.value)}>
                  <option value="">—</option>
                  <option>Dr.</option><option>MD</option><option>DO</option>
                  <option>NP</option><option>PA</option><option>RN</option>
                  <option>LPN</option><option>Mr.</option><option>Ms.</option>
                </select>
              </div>
              <div className="col-md-5">
                <label className="form-label small">First Name <span className="text-danger">*</span></label>
                <input className="form-control form-control-sm" value={form.fname}
                  onChange={e => update('fname', e.target.value)} required />
              </div>
              <div className="col-md-4">
                <label className="form-label small">Last Name <span className="text-danger">*</span></label>
                <input className="form-control form-control-sm" value={form.lname}
                  onChange={e => update('lname', e.target.value)} required />
              </div>
            </div>

            {/* Professional Info */}
            <h6 className="text-muted text-uppercase small border-bottom pb-1 mb-2">Professional Details (optional)</h6>
            <div className="row g-2 mb-3">
              <div className="col-md-6">
                <label className="form-label small">Specialty</label>
                <input className="form-control form-control-sm" value={form.specialty}
                  onChange={e => update('specialty', e.target.value)} placeholder="e.g. Family Medicine" />
              </div>
              <div className="col-md-6">
                <label className="form-label small">Physician Type</label>
                <select className="form-select form-select-sm" value={form.physician_type}
                  onChange={e => update('physician_type', e.target.value)}>
                  <option value="">— Select —</option>
                  <option value="attending_physician">Attending physician</option>
                  <option value="general_physician">General physician</option>
                  <option value="consultant_physician">Consultant physician</option>
                  <option value="physician">Physician</option>
                  <option value="resident_physician">Resident physician</option>
                  <option value="specialized_physician">Specialized physician</option>
                  <option value="community_health_physician">Community health physician</option>
                  <option value="occupational_physician">Occupational physician</option>
                  <option value="public_health_physician">Public health physician</option>
                </select>
              </div>
              <div className="col-md-4">
                <label className="form-label small">NPI Number</label>
                <input className="form-control form-control-sm" value={form.npi}
                  onChange={e => update('npi', e.target.value)} placeholder="1234567890" />
              </div>
              <div className="col-md-4">
                <label className="form-label small">Phone</label>
                <PhoneInput value={form.phone} onChange={v => update('phone', v)} />
              </div>
            </div>

            <button type="submit" className="btn btn-primary w-100 mt-2" disabled={submitting}>
              {submitting ? (
                <span className="spinner-border spinner-border-sm me-1"></span>
              ) : (
                <i className="bi bi-person-plus me-1"></i>
              )}
              Submit Registration
            </button>
          </form>

          <div className="text-center mt-3">
            <small className="text-muted">
              Already have an account? <NavLink to="/login">Log in</NavLink>
            </small>
          </div>
        </div>
      </div>
    </div>
  );
}
