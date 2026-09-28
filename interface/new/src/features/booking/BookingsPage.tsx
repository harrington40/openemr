import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import nestClient from '../../api/nest-client';
import { patientChartPath } from '../../utils/patientChart';

const BOOKING_PATH = '/book-appointment';
const BOOKING_URL =
  typeof window !== 'undefined'
    ? `${window.location.origin}${BOOKING_PATH}`
    : `https://openrx.transtechologies.com${BOOKING_PATH}`;

export default function BookingsPage() {
  const queryClient = useQueryClient();
  const [toast, setToast] = useState('');

  const { data: bookings = [], isLoading } = useQuery({
    queryKey: ['bookings-requests'],
    queryFn: async () => {
      const r = await nestClient.get('/bookings/requests');
      return r.data;
    },
    refetchInterval: 15000,
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => nestClient.patch(`/bookings/requests/${id}/approve`, {}),
    onSuccess: (d: any) => {
      queryClient.invalidateQueries({ queryKey: ['bookings-requests'] });
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
      queryClient.invalidateQueries({ queryKey: ['registrar', 'appointments'] });
      setToast(`Approved · patient ${d.data?.publicId || ''} scheduled`);
    },
  });

  const declineMutation = useMutation({
    mutationFn: (id: number) => nestClient.patch(`/bookings/requests/${id}/decline`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookings-requests'] });
      setToast('Booking declined');
    },
  });

  const pending = (bookings || []).filter((b: any) => b.status === 'pending');
  const approved = (bookings || []).filter((b: any) => b.status === 'approved');
  const declined = (bookings || []).filter((b: any) => b.status === 'declined');

  const copyLink = () => {
    navigator.clipboard?.writeText(BOOKING_URL).then(() => setToast('Booking link copied'));
  };

  const statusBadge = (s: string) =>
    s === 'pending' ? 'bg-warning text-dark' : s === 'approved' ? 'bg-success' : 'bg-danger';

  const renderRow = (b: any) => (
    <tr key={b.id}>
      <td><strong>#{b.id}</strong></td>
      <td>{b.fname} {b.lname}</td>
      <td>{b.phone_contact}</td>
      <td>{String(b.preferred_date || '').slice(0, 10)} {b.preferred_time || ''}</td>
      <td>{b.reason || '—'}</td>
      <td><span className="badge rounded-pill text-capitalize">{b.source || 'social'}</span></td>
      <td><span className={`badge rounded-pill ${statusBadge(b.status)}`}>{b.status}</span></td>
      <td className="text-nowrap">
        {b.status === 'pending' ? (
          <>
            <button className="btn btn-success btn-sm rounded-pill me-1" onClick={() => approveMutation.mutate(b.id)} disabled={approveMutation.isPending}>
              <i className="bi bi-check-lg"></i> Approve
            </button>
            <button className="btn btn-outline-danger btn-sm rounded-pill" onClick={() => declineMutation.mutate(b.id)} disabled={declineMutation.isPending}>
              <i className="bi bi-x-lg"></i> Decline
            </button>
          </>
        ) : b.pid ? (
          <a className="btn btn-outline-primary btn-sm rounded-pill" href={patientChartPath(b.patient_id, b.pid) || '#'}>
            <i className="bi bi-folder2-open me-1"></i>Chart
          </a>
        ) : (
          <span className="text-muted small">—</span>
        )}
      </td>
    </tr>
  );

  return (
    <div className="glass-page position-relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #dbeafe 0%, #f5faff 45%, #d1fae5 100%)', borderRadius: '20px', minHeight: '100vh', padding: '16px' }}>
      {toast && (
        <div className="alert alert-success py-2 small d-flex justify-content-between align-items-center">
          <span><i className="bi bi-check-circle me-1"></i>{toast}</span>
          <button className="btn-close btn-sm" onClick={() => setToast('')}></button>
        </div>
      )}

      <div className="rounded-4 p-4 mb-4 text-white" style={{ background: 'linear-gradient(135deg, #0d6efd 0%, #198754 60%, #00c9a7 100%)' }}>
        <div className="d-flex justify-content-between align-items-start flex-wrap gap-3">
          <div>
            <h3 className="mb-1 fw-bold"><i className="bi bi-qr-code me-2"></i>Bookings & Social Links</h3>
            <p className="mb-0 text-white text-opacity-75 small">
              {pending.length} pending · {approved.length} approved · {declined.length} declined
            </p>
          </div>
          <button className="btn btn-light btn-sm rounded-pill" onClick={() => window.open(BOOKING_PATH, '_blank')}>
            <i className="bi bi-box-arrow-up-right me-1"></i>Open Booking Page
          </button>
        </div>
      </div>

      {/* Share + QR */}
      <div className="card border-0 shadow-sm mb-4" style={{ borderRadius: '16px' }}>
        <div className="card-body">
          <div className="row g-3 align-items-center">
            <div className="col-md-4 text-center">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(BOOKING_URL)}`}
                alt="Booking QR code"
                className="img-fluid border rounded-3"
                style={{ maxWidth: '180px' }}
              />
              <div className="small text-muted mt-1">Scan to book</div>
            </div>
            <div className="col-md-8">
              <h6 className="fw-bold"><i className="bi bi-share me-2"></i>Share the booking link</h6>
              <div className="input-group mb-3">
                <input className="form-control form-control-sm" readOnly value={BOOKING_URL} />
                <button className="btn btn-outline-primary btn-sm" onClick={copyLink}><i className="bi bi-clipboard"></i></button>
              </div>
              <div className="d-flex flex-wrap gap-2">
                <a className="btn btn-success btn-sm rounded-pill" target="_blank" rel="noreferrer"
                  href={`https://wa.me/?text=${encodeURIComponent(`Book your appointment with us: ${BOOKING_URL}`)}`}>
                  <i className="bi bi-whatsapp me-1"></i>WhatsApp
                </a>
                <a className="btn btn-primary btn-sm rounded-pill" target="_blank" rel="noreferrer"
                  href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(BOOKING_URL)}`}>
                  <i className="bi bi-facebook me-1"></i>Facebook
                </a>
                <a className="btn btn-dark btn-sm rounded-pill" target="_blank" rel="noreferrer"
                  href={`https://twitter.com/intent/tweet?url=${encodeURIComponent(BOOKING_URL)}&text=${encodeURIComponent('Book your appointment')}`}>
                  <i className="bi bi-twitter-x me-1"></i>X / Twitter
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-5"><div className="spinner-border text-primary"></div></div>
      ) : (
        <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
          <div className="card-body p-0">
            <div className="table-responsive" style={{ maxHeight: '520px', overflowY: 'auto' }}>
              <table className="table table-hover small mb-0">
                <thead className="table-light sticky-top">
                  <tr>
                    <th>Ref</th><th>Patient</th><th>Phone</th><th>Preferred</th><th>Reason</th><th>Source</th><th>Status</th><th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.length === 0 ? (
                    <tr><td colSpan={8} className="text-center text-muted py-4">No booking requests yet.</td></tr>
                  ) : (
                    [...pending, ...approved, ...declined].map(renderRow)
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
