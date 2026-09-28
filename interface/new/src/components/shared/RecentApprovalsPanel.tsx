import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import nestClient from '../../api/nest-client';
import { formatPatientName } from '../../utils/patientName';
import { formatDateOnly } from '../../utils/date';
import { chartPatientId } from '../../utils/patientChart';

interface RecentPatient {
  id: number;
  pid: number;
  fname: string;
  lname: string;
  DOB: string | null;
  sex: string | null;
  regdate: string;
  status: string;
  public_id: string;
  minutes_ago: number;
}

function formatTimeAgo(minutes: number): string {
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const h = Math.floor(minutes / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function RecentApprovalsPanel() {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);

  const { data: patients = [], isLoading } = useQuery({
    queryKey: ['recently-approved'],
    queryFn: async () => {
      const r = await nestClient.get('/patients/recently-approved');
      return r.data as RecentPatient[];
    },
    refetchInterval: 15000,
  });

  const visiblePatients = expanded ? patients : patients.slice(0, 3);
  const hiddenCount = patients.length - 3;

  return (
    <div className="card border-0 shadow-sm rounded-4">
      <div className="card-header bg-white py-3 rounded-top-4 d-flex justify-content-between align-items-center">
        <h6 className="mb-0 fw-bold">
          <i className="bi bi-broadcast me-2" style={{ color: '#0d6efd' }}></i>
          Newly Approved Patients
        </h6>
        <div className="d-flex gap-2 align-items-center">
          <span className="badge bg-primary rounded-pill">{patients.length}</span>
          {hiddenCount > 0 && (
            <button
              className="btn btn-sm btn-outline-secondary rounded-pill"
              onClick={() => setExpanded(!expanded)}
              style={{ fontSize: '0.7rem' }}
            >
              {expanded ? (
                <><i className="bi bi-chevron-up me-1"></i>Collapse</>
              ) : (
                <><i className="bi bi-chevron-down me-1"></i>Show {hiddenCount} more</>
              )}
            </button>
          )}
        </div>
      </div>
      <div className="card-body p-0">
        {isLoading ? (
          <div className="text-center py-3">
            <span className="spinner-border spinner-border-sm text-primary"></span>
          </div>
        ) : patients.length === 0 ? (
          <div className="text-center py-4 text-muted small">
            <i className="bi bi-inbox fs-3 d-block mb-2"></i>
            No recently approved patients
          </div>
        ) : (
          <div className="list-group list-group-flush" style={{ maxHeight: expanded ? '400px' : '200px', overflowY: 'auto' }}>
            {visiblePatients.map((p) => (
              <button
                key={p.id}
                className="list-group-item list-group-item-action d-flex justify-content-between align-items-center border-0"
                onClick={() => { const cid = chartPatientId(p.id, p.pid); if (cid) navigate(`/patients/${cid}`); }}
                style={{ cursor: 'pointer' }}
              >
                <div className="d-flex align-items-center gap-2">
                  <div className="rounded-circle bg-primary bg-opacity-10 d-flex align-items-center justify-content-center"
                    style={{ width: '32px', height: '32px' }}>
                    <span className="fw-bold text-primary small">{p.fname[0]}{p.lname[0]}</span>
                  </div>
                  <div>
                    <div className="fw-semibold small">{formatPatientName(p)}</div>
                    <div className="text-muted" style={{ fontSize: '0.7rem' }}>
                      {formatDateOnly(p.DOB)} · {p.sex || '—'} · <span className="text-primary">{p.public_id}</span>
                    </div>
                  </div>
                </div>
                <div className="d-flex align-items-center gap-2">
                  <span className="badge bg-success rounded-pill" style={{ fontSize: '0.65rem' }}>
                    <i className="bi bi-check-circle me-1"></i>Approved
                  </span>
                  <small className="text-muted">{formatTimeAgo(p.minutes_ago)}</small>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
