import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';
import nestClient from '../../api/nest-client';
import { formatPatientName } from '../../utils/patientName';
import { formatDateHuman } from '../../utils/date';

type TabId = 'billing' | 'ar' | 'codes';

const EXCHANGE_RATE = 193;
const HOSPITAL = 'Ma Juan Memorial Hospital Clinic';
const LOCATION = 'Monrovia, Liberia';

const fm = (usd: number) => `L$${Math.round(usd * EXCHANGE_RATE).toLocaleString('en-US')}`;

interface ReceiptData {
  receiptNumber: string;
  hospital: string;
  location: string;
  currency: string;
  date: string;
  dateFormatted: string;
  timeFormatted: string;
  patient: { pid: number; name: string; dob: string; phone: string; address: string };
  payment: { amountLRD: number; amountFormatted: string; amountUSD: number; method: string; receivedBy: string };
  items: { code: string; description: string; quantity: number; unitPriceLRD: number; totalLRD: number }[];
  summary: { subtotalLRD: string; insuranceCoveredLRD: string; patientObligationLRD: string; amountPaidLRD: string; balanceLRD: string };
  footer: string;
}

export default function MedicalBillingPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabId>('billing');
  const [searchPid, setSearchPid] = useState('');
  const [selectedPid, setSelectedPid] = useState<number | null>(null);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);

  const isAdmin = user?.role === 'admin';

  // ── Patient search ──────────────────────────────────────────────
  const { data: patients = [] } = useQuery({
    queryKey: ['billing-patients', searchPid],
    queryFn: async () => {
      const r = await nestClient.get('/billing/patients', { params: { search: searchPid || undefined } });
      return r.data;
    },
  });

  // ── Auto-calculation for selected patient ──────────────────────
  const { data: autoCalc, isLoading: calcLoading } = useQuery({
    queryKey: ['billing-auto-calc', selectedPid],
    queryFn: async () => {
      const r = await nestClient.get(`/billing/auto-calculate/${selectedPid}`);
      return r.data;
    },
    enabled: selectedPid !== null,
    refetchInterval: 30000,
  });

  // ── Recent transactions ────────────────────────────────────────
  const { data: transactions = [] } = useQuery({
    queryKey: ['billing-transactions', selectedPid],
    queryFn: async () => {
      const r = await nestClient.get(`/patients/${selectedPid}/transactions`);
      return r.data;
    },
    enabled: selectedPid !== null,
  });

  // ── CPT/ICD-10 codes (admin only) ──────────────────────────────
  const { data: cptCodes = [] } = useQuery({
    queryKey: ['codes', '100'],
    queryFn: async () => { const r = await nestClient.get('/admin/codes?type=100'); return r.data; },
    enabled: activeTab === 'codes' && isAdmin,
  });
  const { data: icd10Codes = [] } = useQuery({
    queryKey: ['codes', '112'],
    queryFn: async () => { const r = await nestClient.get('/admin/codes?type=112'); return r.data; },
    enabled: activeTab === 'codes' && isAdmin,
  });

  // ── Code management (admin) ────────────────────────────────────
  const [newCode, setNewCode] = useState({ code: '', code_text: '', code_type: 'CPT4', fees: '' });
  const addCode = useMutation({
    mutationFn: (d: any) => nestClient.post('/admin/codes', d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['codes'] }); setNewCode({ code: '', code_text: '', code_type: 'CPT4', fees: '' }); },
  });
  const deleteCode = useMutation({
    mutationFn: ({ code, type }: { code: string; type: string }) => nestClient.delete(`/admin/codes/${code}?type=${type}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['codes'] }),
  });

  // ── Stats ──────────────────────────────────────────────────────
  const totalOutstanding = useMemo(() =>
    patients.reduce((s: any, p: any) => s + (p.balance || 0), 0),
  [patients]);
  const withBalance = patients.filter((p: any) => p.balance > 0).length;

  // ── Tabs ───────────────────────────────────────────────────────
  const tabs: { id: TabId; label: string; icon: string }[] = [
    { id: 'billing', label: 'Patient Billing', icon: 'bi-cash-coin' },
    { id: 'ar', label: 'A/R Ledger', icon: 'bi-journal-bookmark' },
    ...(isAdmin ? [{ id: 'codes' as TabId, label: 'CPT/ICD Codes', icon: 'bi-tag' }] : []),
  ];

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
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="rounded-4 p-4 mb-4 text-white position-relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #C8102E 0%, #BF0A30 30%, #002868 70%, #0d6efd 100%)' }}>
        <div className="position-absolute end-0 top-0 opacity-10" style={{ fontSize: '7rem', transform: 'rotate(12deg) translate(20px,-15px)' }}>
          🇱🇷
        </div>
        <div className="position-relative">
          <div className="d-flex justify-content-between align-items-start flex-wrap gap-2">
            <div>
              <h3 className="mb-1 fw-bold"><i className="bi bi-currency-dollar me-2"></i>{HOSPITAL}</h3>
              <p className="mb-0 text-white text-opacity-75 small">
                🇱🇷 {LOCATION} · Liberian Healthcare Billing · LRD {EXCHANGE_RATE}:1 USD
              </p>
            </div>
            <div className="d-flex gap-2">
              <span className="badge bg-white bg-opacity-25 rounded-pill">
                <i className="bi bi-people me-1"></i>{patients.length} Patients
              </span>
              <span className="badge bg-white bg-opacity-25 rounded-pill">
                <i className="bi bi-exclamation-triangle me-1"></i>{fm(totalOutstanding)} Outstanding
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Stats Bar ───────────────────────────────────────────── */}
      <div className="row g-2 mb-3">
        {[
          { v: patients.length, l: 'Total Patients', c: '#0d6efd', i: 'bi-people' },
          { v: withBalance, l: 'With Balance', c: '#fd7e14', i: 'bi-cash' },
          { v: fm(totalOutstanding), l: 'Outstanding (LRD)', c: '#dc3545', i: 'bi-exclamation-triangle' },
          { v: `${EXCHANGE_RATE}:1`, l: 'Exchange Rate', c: '#198754', i: 'bi-graph-up' },
        ].map((s, i) => (
          <div className="col-md-3 col-sm-6" key={i}>
            <div className="card border-0 shadow-sm h-100" style={{ borderRadius: '12px' }}>
              <div className="card-body d-flex align-items-center gap-3 py-2">
                <div className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                  style={{ width: '40px', height: '40px', backgroundColor: `${s.c}15` }}>
                  <i className={`bi ${s.i} fs-6`} style={{ color: s.c }}></i>
                </div>
                <div>
                  <div className="fw-bold" style={{ color: s.c, fontSize: '0.95rem' }}>{s.v}</div>
                  <small className="text-muted" style={{ fontSize: '0.7rem' }}>{s.l}</small>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────── */}
      <ul className="nav nav-pills mb-3 gap-1">
        {tabs.map(t => (
          <li className="nav-item" key={t.id}>
            <button className={`nav-link small ${activeTab === t.id ? 'active' : ''}`}
              onClick={() => setActiveTab(t.id)}>
              <i className={`bi ${t.icon} me-1`}></i>{t.label}
            </button>
          </li>
        ))}
      </ul>

      {/* ════════════════════════════════════════════════════════════
          PATIENT BILLING TAB
          ════════════════════════════════════════════════════════ */}
      {activeTab === 'billing' && (
        <div className="row g-3">
          {/* Patient Search */}
          <div className="col-lg-5">
            <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
              <div className="card-header bg-white py-3" style={{ borderRadius: '16px 16px 0 0' }}>
                <h6 className="mb-0 fw-bold"><i className="bi bi-search me-2" style={{ color: '#C8102E' }}></i>Find Patient</h6>
              </div>
              <div className="card-body">
                <div className="input-group mb-2">
                  <span className="input-group-text bg-white"><i className="bi bi-search"></i></span>
                  <input className="form-control" placeholder="Search by name or PID..."
                    value={searchPid} onChange={e => setSearchPid(e.target.value)} />
                </div>
                <div style={{ maxHeight: '350px', overflowY: 'auto' }}>
                  {patients.map((p: any) => (
                    <div key={p.pid}
                      className={`border rounded-3 p-2 mb-1 cursor-pointer ${selectedPid === p.pid ? 'border-danger bg-danger bg-opacity-10' : ''}`}
                      style={{ cursor: 'pointer', borderLeft: selectedPid === p.pid ? '4px solid #C8102E' : '4px solid transparent' }}
                      onClick={() => setSelectedPid(p.pid)}>
                      <div className="d-flex justify-content-between align-items-center">
                        <div>
                          <strong className="small">{formatPatientName(p)}</strong>
                          <span className="text-muted small ms-2">PID: {p.pid}</span>
                        </div>
                        <span className={`badge rounded-pill ${p.balance > 0 ? 'bg-danger' : 'bg-success'}`}
                          style={{ fontSize: '0.7rem' }}>
                          {p.balance > 0 ? fm(p.balance) : 'Cleared'}
                        </span>
                      </div>
                      {p.encounterDate && (
                        <small className="text-muted">Last visit: {formatDateHuman(p.encounterDate)}</small>
                      )}
                    </div>
                  ))}
                  {patients.length === 0 && (
                    <div className="text-center text-muted py-3 small">No patients found. Start typing to search.</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Billing + Payment */}
          <div className="col-lg-7">
            {!selectedPid ? (
              <div className="card border-0 shadow-sm d-flex align-items-center justify-content-center"
                style={{ borderRadius: '16px', minHeight: '300px' }}>
                <div className="text-center text-muted p-5">
                  <i className="bi bi-arrow-left-circle fs-1 d-block mb-3 opacity-25"></i>
                  <p className="fw-semibold">Select a patient to view billing details</p>
                  <small>Charges are auto-calculated from their visits</small>
                </div>
              </div>
            ) : calcLoading ? (
              <div className="text-center py-5"><span className="spinner-border text-danger"></span></div>
            ) : (
              <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
                <div className="card-header bg-white py-3 d-flex justify-content-between align-items-center"
                  style={{ borderRadius: '16px 16px 0 0' }}>
                  <h6 className="mb-0 fw-bold">
                    <i className="bi bi-calculator me-2" style={{ color: '#002868' }}></i>
                    Auto-Calculated Charges — {autoCalc?.grandTotalLRD || 'L$0'}
                  </h6>
                  <span className="badge rounded-pill" style={{ backgroundColor: '#002868', color: '#fff' }}>
                    {autoCalc?.encounterCount || 0} Visit{autoCalc?.encounterCount !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="card-body">
                  {/* Charges grouped by visit description */}
                  {autoCalc?.encounters?.map((enc: any) => (
                    <div key={enc.encounterId} className="mb-3 p-3 rounded-3" style={{ backgroundColor: '#f8f9fa' }}>
                      <div className="d-flex justify-content-between mb-2">
                        <div>
                          <span className="fw-bold small">{enc.date?.split(' ')[0]}</span>
                          <span className="text-muted small ms-2">— {enc.reason || enc.description || 'Visit'}</span>
                        </div>
                        <span className="fw-bold" style={{ color: '#C8102E' }}>{enc.totalLRD}</span>
                      </div>
                      {enc.charges?.map((c: any, i: number) => (
                        <div key={i} className="d-flex justify-content-between small text-muted border-top pt-1 mt-1">
                          <span>
                            <code className="me-1">{c.code}</code> {c.description}
                            {c.quantity > 1 && <span className="badge bg-light text-dark border ms-1">×{c.quantity}</span>}
                          </span>
                          <span>{fm(c.feeUSD)}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                  {(!autoCalc?.encounters || autoCalc.encounters.length === 0) && (
                    <div className="text-center py-3 text-muted small">
                      <i className="bi bi-info-circle me-1"></i>
                      No active encounters. Charges appear automatically when the patient visits.
                    </div>
                  )}

                </div>
              </div>
            )}

            {/* Recent Transactions */}
            {selectedPid && (
              <div className="card border-0 shadow-sm mt-3" style={{ borderRadius: '16px' }}>
                <div className="card-header bg-white d-flex justify-content-between py-3" style={{ borderRadius: '16px 16px 0 0' }}>
                  <h6 className="mb-0 fw-bold small">
                    <i className="bi bi-clock-history me-2" style={{ color: '#002868' }}></i>
                    Recent Transactions — Patient #{selectedPid}
                  </h6>
                  <span className="badge bg-secondary rounded-pill" style={{fontSize:'0.65rem'}}>
                    {transactions.length} entries
                  </span>
                </div>
                <div className="card-body p-0">
                  <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                    <table className="table table-sm small mb-0">
                      <thead className="table-light sticky-top">
                        <tr>
                          <th>Date</th><th>Description</th><th className="text-end">Amount</th><th>Method</th><th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {transactions.map((t: any) => (
                          <tr key={t.id}>
                            <td className="text-muted" style={{whiteSpace:'nowrap'}}>
                              {t.date?.split(' ')[0]}
                            </td>
                            <td style={{maxWidth:'200px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                              {t.title}
                            </td>
                            <td className="text-end">
                              {t.amountFormatted ? (
                                <span className="fw-bold" style={{ color: '#C8102E' }}>{t.amountFormatted}</span>
                              ) : (
                                <span className="text-muted">—</span>
                              )}
                            </td>
                            <td>
                              {t.paymentMethod ? (
                                <span className="badge bg-light text-dark border">{t.paymentMethod}</span>
                              ) : (
                                <span className="text-muted">—</span>
                              )}
                            </td>
                            <td>
                              {t.paymentId && (
                                <button className="btn btn-outline-secondary btn-sm py-0 px-2 rounded-pill"
                                  style={{fontSize:'0.65rem'}}
                                  onClick={async () => {
                                    try {
                                      const r = await nestClient.get(`/billing/receipt/${t.paymentId}`);
                                      if (r.data) setReceipt(r.data);
                                    } catch { /* receipt not found */ }
                                  }}>
                                  <i className="bi bi-receipt me-1"></i>Receipt
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                        {transactions.length === 0 && (
                          <tr><td colSpan={5} className="text-center text-muted py-3">
                            <i className="bi bi-inbox me-1"></i>No transactions yet
                          </td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
          A/R LEDGER TAB
          ════════════════════════════════════════════════════════ */}
      {activeTab === 'ar' && (
        <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
          <div className="card-header bg-white d-flex justify-content-between py-3"
            style={{ borderRadius: '16px 16px 0 0' }}>
            <h6 className="mb-0 fw-bold">
              <i className="bi bi-journal-bookmark me-2" style={{ color: '#002868' }}></i>
              Accounts Receivable Ledger — {HOSPITAL}
            </h6>
            <span className="badge rounded-pill" style={{ backgroundColor: '#C8102E' }}>
              {withBalance} with balance
            </span>
          </div>
          <div className="card-body p-0">
            <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
              <table className="table table-hover small mb-0">
                <thead className="table-light sticky-top">
                  <tr>
                    <th>PID</th><th>Patient</th><th>Last Visit</th><th className="text-end">Charges</th>
                    <th className="text-end">Paid</th><th className="text-end">Balance</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {patients.filter((p: any) => p.balance > 0).map((p: any) => (
                    <tr key={p.pid} style={{ cursor: 'pointer' }}
                      onClick={() => { setSelectedPid(p.pid); setActiveTab('billing'); }}>
                      <td>#{p.pid}</td>
                      <td><strong>{formatPatientName(p)}</strong></td>
                      <td className="text-muted">{formatDateHuman(p.encounterDate)}</td>
                      <td className="text-end">{fm(p.totalCharges)}</td>
                      <td className="text-end text-success">{fm(p.totalPayments)}</td>
                      <td className="text-end fw-bold text-danger">{fm(p.balance)}</td>
                      <td>
                        <span className="badge rounded-pill" style={{
                          backgroundColor: p.billingStatus === 'overdue' ? '#dc3545' : '#fd7e14',
                          fontSize: '0.65rem', color: '#fff',
                        }}>
                          {p.statusLabel}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {withBalance === 0 && (
                    <tr><td colSpan={7} className="text-center text-muted py-4">
                      <i className="bi bi-check-circle me-1 text-success"></i>All accounts cleared — no outstanding balances
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
          CODES TAB (Admin Only)
          ════════════════════════════════════════════════════════ */}
      {activeTab === 'codes' && isAdmin && (
        <div className="row g-3">
          {/* Add Code */}
          <div className="col-lg-4">
            <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
              <div className="card-header bg-white py-3">
                <h6 className="mb-0 fw-bold small"><i className="bi bi-plus-circle me-2" style={{color:'#C8102E'}}></i>Add Code</h6>
              </div>
              <div className="card-body">
                <div className="row g-2">
                  <div className="col-5"><input className="form-control form-control-sm" placeholder="Code" value={newCode.code} onChange={e=>setNewCode({...newCode,code:e.target.value})} /></div>
                  <div className="col-4"><input className="form-control form-control-sm" placeholder="Description" value={newCode.code_text} onChange={e=>setNewCode({...newCode,code_text:e.target.value})} /></div>
                  <div className="col-3"><input className="form-control form-control-sm" placeholder="Fee $" type="number" value={newCode.fees} onChange={e=>setNewCode({...newCode,fees:e.target.value})} /></div>
                </div>
                <div className="d-flex gap-1 mt-2">
                  <select className="form-select form-select-sm" style={{width:'auto'}} value={newCode.code_type} onChange={e=>setNewCode({...newCode,code_type:e.target.value})}>
                    <option value="CPT4">CPT4</option><option value="ICD10">ICD10</option>
                  </select>
                  <button className="btn btn-sm rounded-pill text-white" style={{backgroundColor:'#C8102E'}}
                    onClick={()=>addCode.mutate(newCode)} disabled={!newCode.code||addCode.isPending}>
                    {addCode.isPending?<span className="spinner-border spinner-border-sm"></span>:<><i className="bi bi-plus-lg me-1"></i>Add</>}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* CPT4 Codes */}
          <div className="col-lg-4">
            <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
              <div className="card-header bg-white py-3 d-flex justify-content-between">
                <h6 className="mb-0 fw-bold small">CPT4 Codes</h6>
                <span className="badge bg-primary rounded-pill">{cptCodes.length}</span>
              </div>
              <div className="card-body p-0" style={{maxHeight:'400px',overflow:'auto'}}>
                <table className="table table-sm small mb-0">
                  <tbody>
                    {cptCodes.map((c:any) => (
                      <tr key={c.code}>
                        <td><code>{c.code}</code></td>
                        <td className="text-muted">{c.code_text}</td>
                        <td className="text-end">${c.fees||0}</td>
                        <td><button className="btn btn-outline-danger btn-sm py-0 px-1" onClick={()=>deleteCode.mutate({code:c.code,type:'CPT4'})} title="Delete"><i className="bi bi-trash"></i></button></td>
                      </tr>
                    ))}
                    {!cptCodes.length && <tr><td colSpan={4} className="text-muted text-center">Add CPT codes above</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* ICD-10 Codes */}
          <div className="col-lg-4">
            <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
              <div className="card-header bg-white py-3 d-flex justify-content-between">
                <h6 className="mb-0 fw-bold small">ICD-10 Codes</h6>
                <span className="badge bg-info rounded-pill">{icd10Codes.length}</span>
              </div>
              <div className="card-body p-0" style={{maxHeight:'400px',overflow:'auto'}}>
                <table className="table table-sm small mb-0">
                  <tbody>
                    {icd10Codes.map((c:any) => (
                      <tr key={c.code}>
                        <td><code>{c.code}</code></td>
                        <td className="text-muted">{c.code_text}</td>
                        <td><button className="btn btn-outline-danger btn-sm py-0 px-1" onClick={()=>deleteCode.mutate({code:c.code,type:'ICD10'})} title="Delete"><i className="bi bi-trash"></i></button></td>
                      </tr>
                    ))}
                    {!icd10Codes.length && <tr><td colSpan={3} className="text-muted text-center">Add ICD-10 codes above</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
          RECEIPT MODAL
          ════════════════════════════════════════════════════════ */}
      {receipt && (
        <div className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
          style={{ zIndex: 9999, backgroundColor: 'rgba(0,0,0,0.6)' }}
          onClick={() => setReceipt(null)}>
          <div className="bg-white shadow-lg" style={{
            width: '100%', maxWidth: '500px', maxHeight: '90vh', overflowY: 'auto',
            borderRadius: '12px', fontFamily: 'monospace',
          }} onClick={e => e.stopPropagation()}>
            <div className="text-center p-3 border-bottom" style={{ backgroundColor: '#C8102E', color: '#fff', borderRadius: '12px 12px 0 0' }}>
              <h5 className="mb-0 fw-bold">{receipt.hospital}</h5>
              <small className="text-white-50">{receipt.location}</small>
              <div className="mt-1" style={{ fontSize: '0.75rem' }}>{receipt.dateFormatted} · {receipt.timeFormatted}</div>
              <div className="badge bg-white text-dark mt-1" style={{ fontSize: '0.7rem' }}>Receipt #: {receipt.receiptNumber}</div>
            </div>
            <div className="p-3 border-bottom" style={{ fontSize: '0.82rem' }}>
              <div className="row">
                <div className="col-6"><small className="text-muted">Patient:</small><br/><strong>{receipt.patient.name}</strong></div>
                <div className="col-3"><small className="text-muted">PID:</small><br/><strong>{receipt.patient.pid}</strong></div>
                <div className="col-3"><small className="text-muted">DOB:</small><br/><strong>{formatDateHuman(receipt.patient.dob)}</strong></div>
              </div>
            </div>
            <div className="p-3 border-bottom" style={{ fontSize: '0.78rem' }}>
              <small className="text-muted text-uppercase fw-bold">Services</small>
              <table className="table table-sm small mt-1 mb-0">
                <thead><tr className="text-muted"><th>Code</th><th>Description</th><th className="text-end">Total</th></tr></thead>
                <tbody>
                  {receipt.items.map((item, i) => (
                    <tr key={i}>
                      <td><code>{item.code}</code></td>
                      <td>{item.description}</td>
                      <td className="text-end fw-semibold">L${item.totalLRD.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-3 border-bottom" style={{ fontSize: '0.82rem', backgroundColor: '#f9fafb' }}>
              <div className="d-flex justify-content-between mb-1"><span>Subtotal:</span><span className="fw-semibold">{receipt.summary.subtotalLRD}</span></div>
              <div className="d-flex justify-content-between mb-1"><span>Insurance (60%):</span><span className="text-muted">{receipt.summary.insuranceCoveredLRD}</span></div>
              <div className="d-flex justify-content-between mb-2"><span>Patient Obligation:</span><span className="fw-semibold">{receipt.summary.patientObligationLRD}</span></div>
              <hr className="my-1" />
              <div className="d-flex justify-content-between fw-bold" style={{ color: '#C8102E', fontSize: '0.9rem' }}>
                <span>Amount Paid:</span><span>{receipt.summary.amountPaidLRD}</span>
              </div>
              <div className="d-flex justify-content-between small"><span>Method:</span><span>{receipt.payment.method}</span></div>
              <div className="d-flex justify-content-between small"><span>Received By:</span><span>{receipt.payment.receivedBy}</span></div>
              {receipt.summary.balanceLRD !== 'L$0' && (
                <div className="d-flex justify-content-between small text-danger mt-1"><span>Remaining:</span><span className="fw-bold">{receipt.summary.balanceLRD}</span></div>
              )}
            </div>
            <div className="p-3 text-center text-muted" style={{ fontSize: '0.7rem' }}>
              <p className="mb-1 fw-bold" style={{ color: '#C8102E' }}>🇱🇷 {receipt.hospital}</p>
              <p className="mb-0">{receipt.footer}</p>
            </div>
            <div className="p-2 border-top d-flex gap-2 justify-content-center">
              <button className="btn btn-sm rounded-pill px-4 text-white" style={{ backgroundColor: '#C8102E' }}
                onClick={() => window.print()}>
                <i className="bi bi-printer me-1"></i>Print
              </button>
              <button className="btn btn-outline-secondary btn-sm rounded-pill" onClick={() => setReceipt(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
