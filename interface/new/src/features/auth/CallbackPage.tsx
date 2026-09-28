import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function CallbackPage() {
  const navigate = useNavigate();

  useEffect(() => {
    // OAuth2 callback is no longer used — redirect to login
    navigate('/login', { replace: true });
  }, [navigate]);

  return (
    <div className="min-vh-100 d-flex align-items-center justify-content-center bg-light">
      <div className="text-center">
        <div className="spinner-border text-primary mb-3" role="status" style={{ width: '3rem', height: '3rem' }}>
          <span className="visually-hidden">Redirecting...</span>
        </div>
        <p className="text-muted">Redirecting to login...</p>
      </div>
    </div>
  );
}
