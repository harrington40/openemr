import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function PatientPaymentPage() {
  const navigate = useNavigate();
  const raw = localStorage.getItem('portal_patient');
  const patient = raw ? JSON.parse(raw) : null;
  const [amount, setAmount] = useState('25');
  const [paid, setPaid] = useState(false);
  if (!patient) { navigate('/portal/login'); return null; }

  return (
    <div className="min-vh-100 bg-light">
      <nav className="navbar navbar-dark bg-primary px-4"><span className="navbar-brand"><i className="bi bi-credit-card me-2"></i>Online Payment</span>
        <button className="btn btn-outline-light btn-sm" onClick={() => navigate('/portal/dashboard')}>Back</button></nav>
      <div className="container py-4">
        <div className="row justify-content-center"><div className="col-md-5">
          {paid ? (
            <div className="card shadow-sm text-center"><div className="card-body py-5"><i className="bi bi-check-circle text-success" style={{fontSize:'4rem'}}></i><h4 className="mt-3">Payment Successful!</h4><p className="text-muted">Thank you for your payment of ${amount}.</p>
              <button className="btn btn-primary" onClick={() => navigate('/portal/dashboard')}>Return to Dashboard</button></div></div>
          ) : (
            <div className="card shadow-sm"><div className="card-header"><h5 className="mb-0">Make a Payment</h5></div><div className="card-body">
              <div className="mb-3"><label className="form-label">Amount ($)</label><input type="number" className="form-control" value={amount} onChange={e => setAmount(e.target.value)} min={1} /></div>
              <div className="mb-3"><label className="form-label">Card Number</label><input className="form-control" placeholder="•••• •••• •••• ••••" /></div>
              <div className="row g-2 mb-3"><div className="col-md-6"><label className="form-label">Expiry</label><input className="form-control" placeholder="MM/YY" /></div><div className="col-md-6"><label className="form-label">CVV</label><input className="form-control" placeholder="123" /></div></div>
              <button className="btn btn-success w-100" onClick={() => setPaid(true)}><i className="bi bi-lock me-1"></i>Pay ${amount}</button>
              <small className="text-muted d-block text-center mt-2"><i className="bi bi-shield-check me-1"></i>Secured by SSL encryption</small>
            </div></div>
          )}</div></div>
      </div>
    </div>
  );
}
