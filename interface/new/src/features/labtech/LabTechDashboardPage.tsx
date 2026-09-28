import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';
import nestClient from '../../api/nest-client';
import RecentApprovalsPanel from '../../components/shared/RecentApprovalsPanel';
import { groupOrdersByPatient } from '../../utils/groupOrdersByPatient';
import { formatDateHuman } from '../../utils/date';
import Barcode from '../../components/shared/Barcode';

/** Standard lab reference ranges (simplified) */
const REFERENCE_RANGES: Record<string, { low: number; high: number; unit: string; criticalLow: number; criticalHigh: number }> = {
  'Hemoglobin': { low: 12, high: 16, unit: 'g/dL', criticalLow: 7, criticalHigh: 20 },
  'WBC': { low: 4.0, high: 11.0, unit: 'x10⁹/L', criticalLow: 1.5, criticalHigh: 30 },
  'Platelets': { low: 150, high: 450, unit: 'x10⁹/L', criticalLow: 50, criticalHigh: 1000 },
  'Glucose': { low: 70, high: 110, unit: 'mg/dL', criticalLow: 40, criticalHigh: 400 },
  'Creatinine': { low: 0.6, high: 1.3, unit: 'mg/dL', criticalLow: 0.1, criticalHigh: 8 },
  'Sodium': { low: 135, high: 145, unit: 'mmol/L', criticalLow: 120, criticalHigh: 160 },
  'Potassium': { low: 3.5, high: 5.1, unit: 'mmol/L', criticalLow: 2.5, criticalHigh: 6.5 },
  'ALT': { low: 7, high: 56, unit: 'U/L', criticalLow: 1, criticalHigh: 500 },
  'AST': { low: 10, high: 40, unit: 'U/L', criticalLow: 1, criticalHigh: 500 },
  'Bilirubin': { low: 0.1, high: 1.2, unit: 'mg/dL', criticalLow: 0, criticalHigh: 15 },
  'TSH': { low: 0.4, high: 4.0, unit: 'mIU/L', criticalLow: 0.01, criticalHigh: 50 },
  'HbA1c': { low: 4.0, high: 5.7, unit: '%', criticalLow: 3, criticalHigh: 14 },
  'HIV Rapid': { low: 0, high: 0, unit: 'Neg/Pos', criticalLow: 0, criticalHigh: 1 },
  'Malaria RDT': { low: 0, high: 0, unit: 'Neg/Pos', criticalLow: 0, criticalHigh: 1 },
  'Urinalysis pH': { low: 4.5, high: 8.0, unit: 'pH', criticalLow: 3, criticalHigh: 9 },
  'Urine Protein': { low: 0, high: 0, unit: 'Neg/Pos', criticalLow: 0, criticalHigh: 2 },
};

/** Flag a result as normal, abnormal, or critical based on reference ranges */
function flagResult(testName: string, value: number): { flag: 'normal' | 'abnormal' | 'critical'; color: string; label: string } {
  const range = REFERENCE_RANGES[testName];
  if (!range) return { flag: 'normal', color: '#198754', label: 'Normal' };

  if (range.high === 0 && range.low === 0) {
    // Binary test (Neg/Pos)
    if (value >= range.criticalHigh) return { flag: 'critical', color: '#dc3545', label: 'Positive — CRITICAL' };
    return { flag: 'normal', color: '#198754', label: 'Negative' };
  }

  if (value >= range.criticalHigh || value <= range.criticalLow) {
    return { flag: 'critical', color: '#dc3545', label: 'CRITICAL' };
  }
  if (value > range.high || value < range.low) {
    return { flag: 'abnormal', color: '#fd7e14', label: 'Abnormal' };
  }
  return { flag: 'normal', color: '#198754', label: 'Normal' };
}

/** Compute turnaround time statistics */
function computeTATStats(results: any[]): { avgMinutes: number; within24h: number; total: number; pct: number } {
  const total = results.length;
  if (total === 0) return { avgMinutes: 0, within24h: 0, total: 0, pct: 100 };
  let sumMinutes = 0;
  let within24h = 0;
  results.forEach((r: any) => {
    const ordered = r.date ? new Date(r.date).getTime() : Date.now();
    const resulted = r.result_date ? new Date(r.result_date).getTime() : Date.now();
    const diffMin = (resulted - ordered) / 60000;
    sumMinutes += diffMin;
    if (diffMin <= 1440) within24h++; // 24 hours
  });
  return {
    avgMinutes: Math.round(sumMinutes / total),
    within24h,
    total,
    pct: Math.round((within24h / total) * 100),
  };
}

function LiveClock({ timezone, label }: { timezone: string; label: string }) {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="text-center px-3">
      <div className="text-white text-opacity-75" style={{ fontSize: '0.7rem' }}>{label}</div>
      <div className="fw-bold" style={{ fontSize: '1.1rem', fontVariantNumeric: 'tabular-nums' }}>
        {time.toLocaleTimeString('en-US', { timeZone: timezone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
      </div>
    </div>
  );
}


const statusColors: Record<string, string> = { pending: '#fd7e14', collected: '#0dcaf0', processing: '#6f42c1', completed: '#198754', validated: '#0d6efd', rejected: '#dc3545' };
export default function LabTechDashboardPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: labOrders = [] } = useQuery({
    // Shares the 'all-lab-orders' cache key with the Laboratory Management page
    // so any status change anywhere invalidates this dashboard in real time.
    queryKey: ['all-lab-orders'],
    queryFn: async () => {
      const r = await nestClient.get('/lab/orders');
      return r.data;
    },
    refetchInterval: 15000,
  });

  const { data: labResults = [] } = useQuery({
    queryKey: ['lab-results'],
    queryFn: async () => {
      const r = await nestClient.get('/labs/results', { params: { limit: 20 } });
      return r.data;
    },
    refetchInterval: 30000,
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      nestClient.patch(`/lab/orders/${id}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-lab-orders'] });
      queryClient.invalidateQueries({ queryKey: ['provider-lab-orders'] });
    },
  });

  const cancelOrder = useMutation({
    mutationFn: (id: number) => nestClient.patch(`/lab/orders/${id}/status`, { status: 'rejected' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['all-lab-orders'] }),
  });

  const pendingCount = labOrders.filter((o: any) => ['pending', 'collected', 'processing'].includes(o.orderStatus)).length;

  // Enrich raw results with flags using the reference-range algorithm so the
  // critical / abnormal / TAT cards always reflect real-time values.
  const enrichedResults = useMemo(() => (labResults || []).map((r: any) => {
    const raw = String(r.result ?? '');
    const val = parseFloat(raw);
    const positiveText = /positive|reactive|detected/i.test(raw) && !/not detected|non-reactive|negative|no growth/i.test(raw);
    const flag = positiveText
      ? { flag: 'critical' as const, label: 'Positive — CRITICAL', color: '#dc3545' }
      : flagResult(r.test_name || r.result_text || r.result_code || '', isNaN(val) ? 0 : val);
    return { ...r, flag: flag.flag, flagLabel: flag.label, flagColor: flag.color };
  }), [labResults]);

  const criticalCount = enrichedResults.filter((r: any) => r.flag === 'critical').length;
  const abnormalCount = enrichedResults.filter((r: any) => r.flag === 'abnormal').length;
  const tatStats = computeTATStats(enrichedResults);

  // Smart grouping: collapse all pending orders under a single patient name.
  const pendingOrders = useMemo(
    () => labOrders.filter((o: any) => !['completed', 'validated', 'rejected', 'cancelled'].includes(o.orderStatus)),
    [labOrders],
  );
  const groupedPendingOrders = useMemo(() => groupOrdersByPatient(pendingOrders), [pendingOrders]);

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
          box-shadow: 0 22px 45px rgba(10,37,64,0.20), 0 6px 14px rgba(10,37,64,0.10) !important;
          transition: transform .25s ease, box-shadow .25s ease, background .25s ease;
        }
        .glass-page .card:hover {
          transform: translateY(-5px);
          background: rgba(255,255,255,0.70) !important;
          box-shadow: 0 30px 60px rgba(10,37,64,0.28), 0 10px 20px rgba(10,37,64,0.14) !important;
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
      {/* Header */}
      <div className="rounded-4 p-4 mb-4 text-white" style={{
        background: 'linear-gradient(135deg, #0d6efd 0%, #6610f2 50%, #6f42c1 100%)',
      }}>
        <div className="d-flex justify-content-between align-items-start flex-wrap gap-3">
          <div>
            <h2 className="mb-1 fw-bold">
              <i className="bi bi-flask me-2"></i>
              Lab Technician Dashboard
            </h2>
            <p className="mb-0 text-white text-opacity-75 small">
              Welcome, {user?.displayName || 'Lab Tech'} — Order Processing & Results Management
            </p>
          </div>
          <div className="d-flex align-items-center gap-2">
            <LiveClock timezone="Africa/Monrovia" label="Monrovia" />
            <div className="vr opacity-50"></div>
            <LiveClock timezone="America/New_York" label="Florida (US)" />
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="row g-3 mb-4">
        <div className="col-md-3">
          <div className="card border-0 shadow-sm rounded-4 h-100">
            <div className="card-body d-flex align-items-center gap-3">
              <div className="rounded-circle d-flex align-items-center justify-content-center"
                style={{ width: '48px', height: '48px', backgroundColor: '#0d6efd20' }}>
                <i className="bi bi-hourglass-split fs-5" style={{ color: '#0d6efd' }}></i>
              </div>
              <div>
                <div className="text-muted small">Pending Orders</div>
                <div className="fw-bold fs-5">{pendingCount}</div>
              </div>
            </div>
          </div>
        </div>
        <div className="col-md-3">
          <div className="card border-0 shadow-sm rounded-4 h-100">
            <div className="card-body d-flex align-items-center gap-3">
              <div className="rounded-circle d-flex align-items-center justify-content-center"
                style={{ width: '48px', height: '48px', backgroundColor: '#dc354520' }}>
                <i className="bi bi-exclamation-triangle fs-5" style={{ color: '#dc3545' }}></i>
              </div>
              <div>
                <div className="text-muted small">Critical Results</div>
                <div className="fw-bold fs-5">{criticalCount}</div>
              </div>
            </div>
          </div>
        </div>
        <div className="col-md-3">
          <div className="card border-0 shadow-sm rounded-4 h-100">
            <div className="card-body d-flex align-items-center gap-3">
              <div className="rounded-circle d-flex align-items-center justify-content-center"
                style={{ width: '48px', height: '48px', backgroundColor: '#fd7e1420' }}>
                <i className="bi bi-graph-up fs-5" style={{ color: '#fd7e14' }}></i>
              </div>
              <div>
                <div className="text-muted small">Abnormal</div>
                <div className="fw-bold fs-5">{abnormalCount}</div>
              </div>
            </div>
          </div>
        </div>
        <div className="col-md-3">
          <div className="card border-0 shadow-sm rounded-4 h-100">
            <div className="card-body d-flex align-items-center gap-3">
              <div className="rounded-circle d-flex align-items-center justify-content-center"
                style={{ width: '48px', height: '48px', backgroundColor: '#19875420' }}>
                <i className="bi bi-clock-history fs-5" style={{ color: '#198754' }}></i>
              </div>
              <div>
                <div className="text-muted small">Avg TAT</div>
                <div className="fw-bold fs-5">{tatStats.avgMinutes}m</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="row g-3">
        {/* Left — Lab Analytics */}
        <div className="col-lg-5">
          <div className="card border-0 shadow-sm rounded-4 mb-3">
            <div className="card-header bg-white py-3 rounded-top-4">
              <h6 className="mb-0 fw-bold">
                <i className="bi bi-graph-up me-2" style={{ color: '#6f42c1' }}></i>
                Lab Analytics
              </h6>
            </div>
            <div className="card-body">
              <div className="row g-2 mb-3">
                {[
                  { v: labOrders?.length || 0, l: 'Total Orders', c: '#0d6efd', i: 'bi-clipboard-check' },
                  { v: labOrders?.filter((o:any) => o.orderStatus === 'pending').length || 0, l: 'Pending', c: '#fd7e14', i: 'bi-hourglass-split' },
                  { v: labOrders?.filter((o:any) => o.orderStatus === 'completed').length || 0, l: 'Completed', c: '#198754', i: 'bi-check-circle' },
                  { v: labOrders?.filter((o:any) => o.hasResults).length || 0, l: 'With Results', c: '#0d6efd', i: 'bi-file-earmark-text' },
                ].map(s => (
                  <div className="col-6" key={s.l}>
                    <div className="p-2 rounded-3 text-center" style={{ backgroundColor: `${s.c}10` }}>
                      <div className="fw-bold fs-5" style={{ color: s.c }}>{s.v}</div>
                      <small className="text-muted">{s.l}</small>
                    </div>
                  </div>
                ))}
              </div>
              <small className="fw-bold text-muted text-uppercase">Status Distribution</small>
              {['pending','collected','processing','completed'].map(s => {
                const count = labOrders?.filter((o:any) => o.orderStatus === s).length || 0;
                const total = labOrders?.length || 1;
                const pct = Math.round((count / total) * 100);
                const colors: Record<string,string> = { pending:'#fd7e14', collected:'#0dcaf0', processing:'#6f42c1', completed:'#198754' };
                return (
                  <div key={s} className="d-flex align-items-center gap-2 mb-1 small">
                    <span style={{ width: '75px', fontSize: '0.7rem' }}>{s.charAt(0).toUpperCase()+s.slice(1)}</span>
                    <div className="flex-grow-1 progress" style={{ height: '5px' }}>
                      <div className="progress-bar" style={{ width: `${pct}%`, backgroundColor: colors[s] || '#6c757d' }}></div>
                    </div>
                    <span className="fw-bold" style={{ width: '25px', fontSize: '0.7rem', textAlign:'right' }}>{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right — Pending Orders & Recent Results */}
        <div className="col-lg-7">
          {/* Pending Orders */}
          <div className="card border-0 shadow-sm rounded-4 mb-3">
            <div className="card-header bg-white py-3 rounded-top-4 d-flex justify-content-between align-items-center">
              <h6 className="mb-0 fw-bold">
                <i className="bi bi-list-check me-2" style={{ color: '#fd7e14' }}></i>
                Pending Lab Orders
              </h6>
              <span className="badge bg-warning text-dark rounded-pill">
                {groupedPendingOrders.length} patient{groupedPendingOrders.length !== 1 ? 's' : ''} · {pendingOrders.length} tests
              </span>
            </div>
            <div className="card-body p-0">
              {groupedPendingOrders.length === 0 ? (
                <div className="text-center py-4 text-muted small">
                  <i className="bi bi-check-circle fs-3 d-block mb-2 text-success"></i>
                  All orders processed — no pending items
                </div>
              ) : (
                <div style={{ maxHeight: '420px', overflowY: 'auto' }}>
                  {groupedPendingOrders.map((g: any) => (
                    <div key={g.key} className="border-bottom">
                      {/* Patient name — shown once with all labs beneath */}
                      <div className="d-flex align-items-center gap-2 px-3 py-2" style={{ background: g.hasStat ? '#dc35450f' : '#f8f9fa' }}>
                        <div className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                          style={{ width: '32px', height: '32px', backgroundColor: g.hasStat ? '#dc354520' : '#0d6efd20' }}>
                          <span className="fw-bold small" style={{ color: g.hasStat ? '#dc3545' : '#0d6efd' }}>
                            {g.patientName?.split(' ').map((w: string) => w[0]).join('').slice(0, 2)}
                          </span>
                        </div>
                        <div className="flex-grow-1 min-w-0">
                          <div className="fw-semibold small text-truncate">{g.patientName}</div>
                          <small className="text-muted" style={{ fontSize: '0.65rem' }}>
                            PID {g.patientPid ?? g.patientId} · {g.count} test{g.count !== 1 ? 's' : ''}
                          </small>
                        </div>
                        {g.hasStat && (
                          <span className="badge bg-danger rounded-pill" style={{ fontSize: '0.6rem' }}>
                            <i className="bi bi-exclamation-triangle me-1"></i>STAT
                          </span>
                        )}
                        <span className="badge bg-warning text-dark rounded-pill" style={{ fontSize: '0.6rem' }}>{g.pendingCount} pending</span>
                      </div>
                      {/* All labs for this patient */}
                      {g.orders.map((o: any) => (
                        <div key={o.id} className="d-flex align-items-center gap-2 px-3 py-1 ms-3 small"
                          style={{ borderLeft: o.orderPriority === 'stat' ? '3px solid #dc3545' : '3px solid transparent', borderTop: '1px dashed #eee' }}>
                          <div className="flex-grow-1 min-w-0">
                            <span className="fw-semibold small">{o.instructions || 'Lab Test'}</span>
                            <span className="text-muted ms-2" style={{ fontSize: '0.65rem' }}>{formatDateHuman(o.dateOrdered)}</span>
                            <div className="mt-1"><Barcode seed={o.specimenId || `LAB-${o.id}`} width={90} height={26} /></div>
                          </div>
                          <span className={`badge rounded-pill ${o.orderPriority === 'stat' ? 'bg-danger' : 'bg-light text-dark'}`} style={{ fontSize: '0.6rem' }}>
                            {o.orderPriority || 'routine'}
                          </span>
                          {o.billingHeld && (
                            <span className="badge bg-danger rounded-pill" style={{ fontSize: '0.6rem' }} title="Billing hold — clear the bill before collecting">
                              <i className="bi bi-lock-fill me-1"></i>Hold
                            </span>
                          )}
                          <span className="badge rounded-pill" style={{
                            backgroundColor: (statusColors as any)[o.orderStatus] || '#fd7e14',
                            color: '#fff', fontSize: '0.6rem',
                          }}>
                            {o.orderStatus || 'pending'}
                          </span>
                          <button className="btn btn-outline-danger btn-sm py-0 px-1 rounded-pill"
                            style={{ fontSize: '0.55rem' }}
                            onClick={() => updateStatus.mutate({ id: o.id, status: 'rejected' })}
                            disabled={cancelOrder.isPending}
                            title="Reject">
                            <i className="bi bi-x-circle"></i>
                          </button>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Recent Results — grouped by patient (1-to-many association) */}
          {(() => {
            const completedOrders = labOrders.filter((o:any) => o.hasResults || o.orderStatus === 'completed');
            const completedCount = completedOrders.length;
            const groupedCompleted = groupOrdersByPatient(completedOrders);
            return (
            <div className="card border-0 shadow-sm rounded-4">
              <div className="card-header bg-white py-3 rounded-top-4 d-flex justify-content-between align-items-center">
                <h6 className="mb-0 fw-bold">
                  <i className="bi bi-clipboard-data me-2" style={{ color: '#198754' }}></i>
                  Recent Results
                </h6>
                <span className="badge rounded-pill" style={{ backgroundColor: '#198754', fontSize: '0.7rem' }}>
                  {groupedCompleted.length} patient{groupedCompleted.length !== 1 ? 's' : ''} · {completedCount} result{completedCount !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="card-body p-0">
                {groupedCompleted.length === 0 ? (
                  <div className="text-center py-4 text-muted small">
                    <i className="bi bi-clipboard-x fs-3 d-block mb-2"></i>
                    No results recorded yet
                  </div>
                ) : (
                  <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                    {groupedCompleted.map((g: any) => (
                      <div key={g.key} className="border-bottom">
                        {/* Patient header — one name, many results beneath */}
                        <div className="d-flex align-items-center gap-2 px-3 py-2" style={{ background: '#f8f9fa', borderLeft: '3px solid #198754' }}>
                          <div className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                            style={{ width: '32px', height: '32px', backgroundColor: '#19875420' }}>
                            <span className="fw-bold small" style={{ color: '#198754' }}>
                              {g.patientName?.split(' ').map((w: string) => w[0]).join('').slice(0, 2)}
                            </span>
                          </div>
                          <div className="flex-grow-1 min-w-0">
                            <div className="fw-semibold small text-truncate">{g.patientName}</div>
                            <small className="text-muted" style={{ fontSize: '0.65rem' }}>
                              PID {g.patientPid ?? g.patientId} · {g.count} result{g.count !== 1 ? 's' : ''}
                            </small>
                          </div>
                          <span className="badge bg-success rounded-pill" style={{ fontSize: '0.6rem' }}>✓ {g.completedCount} done</span>
                        </div>
                        {/* Results for this patient */}
                        {g.orders.map((o: any, i: number) => (
                          <div key={o.id || i} className="d-flex align-items-center gap-2 px-3 py-1 ms-3 small" style={{ borderTop: '1px dashed #eee' }}>
                            <div className="flex-grow-1 min-w-0">
                              <span className="fw-semibold small">{o.instructions || 'Lab Test'}</span>
                              <span className="text-muted ms-2" style={{ fontSize: '0.65rem' }}>{formatDateHuman(o.dateOrdered)}</span>
                            </div>
                            <span className={`badge rounded-pill ${o.hasResults ? 'bg-success' : 'bg-warning text-dark'}`}
                              style={{ fontSize: '0.6rem', whiteSpace: 'nowrap' }}>
                              {o.hasResults ? '✓ Done' : o.orderStatus}
                            </span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            );
          })()}
        </div>
      </div>

      {/* Shared: Recently Approved Patients — propagates from registrar */}
      <div className="mt-4">
        <RecentApprovalsPanel />
      </div>
    </div>
  );
}
