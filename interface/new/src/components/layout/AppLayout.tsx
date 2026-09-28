import { Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { NavLink } from 'react-router-dom';
import nestClient from '../../api/nest-client';
import Sidebar from './Sidebar';
import TopBar from './TopBar';

export default function AppLayout() {
  const { data: licenseStatus } = useQuery({
    queryKey: ['license-status'],
    queryFn: async () => { const r = await nestClient.get('/license/status'); return r.data; },
    refetchInterval: 3600000, // refresh every hour
  });

  const daysRemaining = licenseStatus?.daysRemaining ?? 999;
  const isExpiringSoon = daysRemaining <= 7 && daysRemaining > 0;
  const isExpired = daysRemaining <= 0 && !licenseStatus?.valid;

  return (
    <div className="d-flex vh-100">
      <Sidebar />
      <div className="d-flex flex-column flex-grow-1 overflow-hidden">
        <TopBar />

        {/* License Expiration Warning Banner */}
        {(isExpiringSoon || isExpired) && (
          <div style={{
            background: isExpired
              ? 'linear-gradient(90deg, #dc3545, #a71d2a)'
              : 'linear-gradient(90deg, #fd7e14, #e05d00)',
            color: 'white',
            padding: '10px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '10px',
            fontSize: '0.9rem',
            fontWeight: 500,
          }}>
            <div className="d-flex align-items-center gap-2">
              <i className={`bi ${isExpired ? 'bi-exclamation-triangle-fill' : 'bi-clock-fill'} fs-5`}></i>
              <span>
                {isExpired
                  ? 'Your license has expired. Please renew to restore full access.'
                  : `Your free trial period will be expiring in ${daysRemaining} day${daysRemaining > 1 ? 's' : ''}. Please activate a license to continue using OpenRx without interruption.`
                }
              </span>
            </div>
            <NavLink to="/license" className="btn btn-light btn-sm fw-semibold" style={{ whiteSpace: 'nowrap' }}>
              <i className="bi bi-key me-1"></i>
              {isExpired ? 'Renew License' : 'Activate License'}
            </NavLink>
          </div>
        )}

        <main className="flex-grow-1 overflow-auto p-3 bg-light">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
