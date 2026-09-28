import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getVendorPortal, acknowledgePurchaseOrderVendor, type PurchaseOrder } from '../../api/endpoints/inventory';

const STATUS_STYLES: Record<string, string> = {
  DRAFT: 'bg-secondary',
  SUBMITTED: 'bg-info text-dark',
  APPROVED: 'bg-primary',
  RECEIVED: 'bg-success',
  PARTIALLY_RECEIVED: 'bg-warning text-dark',
  CANCELLED: 'bg-danger',
};

const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
const money = (v: number | null | undefined) =>
  v == null ? '—' : `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function VendorPortalPage() {
  const { token = '' } = useParams<{ token: string }>();
  const queryClient = useQueryClient();
  const [msg, setMsg] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['vendor-portal', token],
    queryFn: () => getVendorPortal(token),
    enabled: !!token,
  });

  const ackMut = useMutation({
    mutationFn: (orderId: number) => acknowledgePurchaseOrderVendor(token, orderId),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['vendor-portal', token] }); setMsg('Purchase order acknowledged'); },
    onError: () => setMsg('Could not acknowledge the order'),
  });

  return (
    <div className="min-vh-100" style={{ background: 'linear-gradient(135deg, #0d6efd 0%, #198754 100%)' }}>
      <div className="container py-5" style={{ maxWidth: '820px' }}>
        <div className="card border-0 shadow-lg" style={{ borderRadius: '20px' }}>
          <div className="card-body p-4 p-md-5">
            <div className="text-center mb-4">
              <div className="rounded-circle d-inline-flex align-items-center justify-content-center mb-3" style={{ width: '64px', height: '64px', backgroundColor: '#0d6efd15' }}>
                <i className="bi bi-truck fs-2 text-primary"></i>
              </div>
              <h4 className="fw-bold mb-1">Vendor Portal</h4>
              {isLoading && <div className="text-muted small">Loading…</div>}
              {isError && <div className="text-danger small">Vendor not found or the link is invalid.</div>}
              {data && <p className="text-muted mb-0">{data.vendor.name} — {data.vendor.contact_name || 'No contact'}</p>}
            </div>

            {msg && <div className="alert alert-success py-2 small">{msg}</div>}

            {data && (
              <>
                {data.orders.length === 0 ? (
                  <div className="text-center text-muted py-5">
                    <i className="bi bi-inbox fs-1 d-block mb-2 opacity-50"></i>No purchase orders yet
                  </div>
                ) : (
                  data.orders.map((po: PurchaseOrder) => (
                    <div key={po.id} className="border rounded-4 p-3 mb-3">
                      <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
                        <div>
                          <div className="fw-bold">{po.po_number}</div>
                          <small className="text-muted">Ordered {fmtDate(po.order_date)} · Expected {fmtDate(po.expected_date)}</small>
                        </div>
                        <span className={`badge rounded-pill ${STATUS_STYLES[po.status] || 'bg-secondary'}`}>{po.status.replace(/_/g, ' ')}</span>
                      </div>
                      <table className="table table-sm small mb-2">
                        <thead className="table-light"><tr><th>Item</th><th className="text-end">Qty</th><th className="text-end">Unit Cost</th><th className="text-end">Line Total</th></tr></thead>
                        <tbody>
                          {po.items.map((it) => (
                            <tr key={it.id}>
                              <td>{it.item_name} {it.item_code ? <code style={{ fontSize: '0.68rem' }}>{it.item_code}</code> : null}</td>
                              <td className="text-end">{it.quantity} {it.unit || ''}</td>
                              <td className="text-end">{money(it.unit_cost)}</td>
                              <td className="text-end">{money((it.unit_cost || 0) * it.quantity)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="d-flex justify-content-between align-items-center">
                        <span className="fw-semibold small">Total: {money(po.total_cost)}</span>
                        {po.status === 'DRAFT' && (
                          <button className="btn btn-primary btn-sm rounded-pill" disabled={ackMut.isPending} onClick={() => ackMut.mutate(po.id)}>
                            {ackMut.isPending ? <span className="spinner-border spinner-border-sm" /> : 'Acknowledge Order'}
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
