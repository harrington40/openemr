import { useState, useMemo, useEffect, useRef, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import nestClient from '../../api/nest-client';
import { useAuth } from '../../hooks/useAuth';
import ChargeCatalogPanel from './ChargeCatalogPanel';
import BarcodeSvg from '../../components/common/BarcodeSvg';
import { formatDateHuman } from '../../utils/date';
import BillingIntegrityPanel from './BillingIntegrityPanel';

interface BillingPatient {
  pid: number;
  fname: string;
  lname: string;
  dob: string;
  sex: string;
  encounterId: number | null;
  encounterDate: string | null;
  dischargeStatus: string;
  totalCharges: number;
  totalPayments: number;
  balance: number;
  insuranceBalance: number;
  patientBalance: number;
  billingStatus: string;
  statusLabel: string;
  statusColor: string;
  hasActiveEncounter: boolean;
  daysSinceLastEncounter: number | null;
  claimCount: number;
  pendingClaimCount: number;
}

interface ClearanceItem {
  category: string;
  description: string;
  amount: number;
  paid: number;
  status: string;
  icon: string;
}

interface FinancialClearance {
  pid: number;
  patientName: string;
  totalCharges: number;
  totalPayments: number;
  balance: number;
  insuranceCovered: number;
  patientObligation: number;
  patientPaid: number;
  remainingPatientBalance: number;
  /** Cents absorbed by the backend's small-balance (rounding) rule. */
  smallBalanceWrittenOff?: number;
  /** Overpayment on the account — refundable. */
  credit?: number;
  claimsSubmitted: number;
  claimsPaid: number;
  claimsPending: number;
  canDischarge: boolean;
  blockers: string[];
  items: ClearanceItem[];
}

const EXCHANGE_RATE = 193;
const formatUSD = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatLRD = (n: number) => `L$${Math.round(n * EXCHANGE_RATE).toLocaleString('en-US')}`;

/**
 * Mirrors `billing_settings.small_balance_writeoff_usd` on the backend. Cash is
 * collected in whole LRD notes, so anything inside this many dollars left over is
 * absorbed as a rounding adjustment instead of sitting on the account forever.
 */
const SMALL_BALANCE_WRITE_OFF_USD = 1;

const STATUS_FILTERS = [
  { key: 'all', label: 'All', icon: 'bi-people' },
  { key: 'active_billing', label: 'Active', icon: 'bi-cash', color: '#0d6efd' },
  { key: 'pending_claims', label: 'Claims Pending', icon: 'bi-hourglass-split', color: '#fd7e14' },
  { key: 'cleared', label: 'Cleared', icon: 'bi-check-circle', color: '#20c997' },
  { key: 'overdue', label: 'Overdue', icon: 'bi-exclamation-triangle', color: '#dc3545' },
  { key: 'discharged_balance', label: 'Owes', icon: 'bi-x-circle', color: '#dc3545' },
  { key: 'no_encounter', label: 'No Visit', icon: 'bi-dash-circle', color: '#6c757d' },
  { key: 'discharged', label: 'Discharged', icon: 'bi-box-arrow-right', color: '#198754' },
];

interface ReceiptData {
  receiptNumber: string;
  /** 'refund' shows a REFUND banner instead of PAID IN FULL. */
  kind?: 'payment' | 'refund';
  refund?: { reference?: string; reason?: string };
  hospital: string;
  location: string;
  currency: string;
  paidInFull: boolean;
  date: string;
  dateFormatted: string;
  timeFormatted: string;
  patient: { pid: number; name: string; dob: string; phone: string; address: string };
  payment: { amountLRD: number; amountFormatted: string; amountUSD: number; method: string; receivedBy: string };
  items: { code: string; description: string; quantity: number; unitPriceLRD: number; totalLRD: number }[];
  summary: { subtotalLRD: string; insuranceCoveredLRD: string; patientObligationLRD: string; amountPaidLRD: string; balanceLRD: string };
  footer: string;
}

export default function BillingDashboardPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [reconcileMsg, setReconcileMsg] = useState('');
  /** Dry-run result — shown for confirmation before anything is written. */
  const [reconcilePreview, setReconcilePreview] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [selectedPid, setSelectedPid] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [payMethod, setPayMethod] = useState('Cash');
  const [payOverride, setPayOverride] = useState(false);
  /** What the cashier is about to collect. Pre-filled with the exact balance. */
  const [payAmount, setPayAmount] = useState('');
  /** Result of a refund / payment action, shown in the Collect Payment panel. */
  const [payNotice, setPayNotice] = useState('');
  const payInFlight = useRef(false);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);

  const { data: stats } = useQuery({
    queryKey: ['billing-stats'],
    queryFn: async () => { const r = await nestClient.get('/billing/stats'); return r.data; },
    refetchInterval: 30000,
  });

  const { data: patients = [], isLoading } = useQuery({
    queryKey: ['billing-patients', search],
    queryFn: async () => {
      const r = await nestClient.get('/billing/patients', { params: { search: search || undefined } });
      return r.data as BillingPatient[];
    },
  });

  const { data: clearance, isLoading: clearanceLoading } = useQuery({
    queryKey: ['billing-clearance', selectedPid],
    queryFn: async () => {
      const r = await nestClient.get(`/billing/patients/${selectedPid}/clearance`);
      return r.data as FinancialClearance;
    },
    enabled: selectedPid !== null,
  });

  // Lab billing codes
  const { data: labBillingCodes = [] } = useQuery({
    queryKey: ['lab-billing-codes'],
    queryFn: async () => { const r = await nestClient.get('/lab/billing-codes'); return r.data; },
  });

  const dischargeMutation = useMutation({
    mutationFn: async (pid: number) => {
      const r = await nestClient.post(`/billing/patients/${pid}/discharge`, { dischargedBy: 'Billing Specialist' });
      return r.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['billing-patients'] });
      queryClient.invalidateQueries({ queryKey: ['billing-clearance'] });
      queryClient.invalidateQueries({ queryKey: ['billing-stats'] });
      queryClient.invalidateQueries({ queryKey: ['billing-transactions'] });
    },
  });

  // Recent transactions — the SAME source the Medical Billing page reads, so
  // both dashboards always show an identical, up-to-date ledger.
  const { data: transactions = [] } = useQuery({
    queryKey: ['billing-transactions', selectedPid],
    queryFn: async () => {
      const r = await nestClient.get(`/patients/${selectedPid}/transactions`);
      return r.data;
    },
    enabled: selectedPid !== null,
  });

  // Payment capture — the SINGLE place payments are recorded in the app.
  const payMutation = useMutation({
    mutationFn: async ({ pid, amountUSD, paymentMethod, override }: { pid: number; amountUSD: number; paymentMethod: string; override?: boolean }) => {
      const r = await nestClient.post(`/billing/patients/${pid}/pay`, { amountUSD, paymentMethod, override });
      return r.data;
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['billing-patients'] });
      queryClient.invalidateQueries({ queryKey: ['billing-clearance'] });
      queryClient.invalidateQueries({ queryKey: ['billing-stats'] });
      queryClient.invalidateQueries({ queryKey: ['billing-transactions'] });
      if (data?.receipt) setReceipt(data.receipt);
      if (data?.duplicate) alert('A payment was just recorded for this patient — duplicate entry prevented.');
      setPayAmount('');
      setPayOverride(false);
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.message || e?.message || 'Payment failed';
      alert(Array.isArray(msg) ? msg.join('\n') : msg);
    },
  });

  const { data: autoCalc } = useQuery({
    queryKey: ['billing-auto-calc', selectedPid],
    queryFn: async () => {
      const r = await nestClient.get(`/billing/auto-calculate/${selectedPid}`);
      return r.data;
    },
    enabled: selectedPid !== null,
    refetchInterval: 60000,
  });

  // Pending billing holds (lab orders + prescriptions awaiting clearance).
  const { data: holds = [] } = useQuery({
    queryKey: ['billing-holds'],
    queryFn: async () => {
      const r = await nestClient.get('/billing/holds', { params: { status: 'hold' } });
      return r.data as any[];
    },
    refetchInterval: 20000,
  });

  // Per-encounter billing breakdown for the selected patient.
  const { data: breakdown } = useQuery({
    queryKey: ['billing-encounters', selectedPid],
    queryFn: async () => {
      const r = await nestClient.get(`/patients/${selectedPid}/encounter-breakdown`);
      return r.data as any;
    },
    enabled: selectedPid !== null,
  });

  // Coverage editor state (Insured split vs No insurance) — for calculation purposes.
  const [coverageType, setCoverageType] = useState('self_pay');
  const [coveragePercent, setCoveragePercent] = useState('40');
  /** Highlight the CPT/HCPCS code on every encounter-breakdown charge line. */
  const [showCptCodes, setShowCptCodes] = useState(false);

  useEffect(() => {
    if (clearance) {
      setCoverageType((clearance as any).insuranceType || 'self_pay');
      setCoveragePercent(String((clearance as any).patientPercent ?? 40));
      // Pre-fill with the exact outstanding amount *including cents*, so paying
      // the suggested figure clears the ledger instead of leaving a few cents
      // behind (which showed up as e.g. "L$27 still owing" after a payment).
      const due = Number((clearance as any).remainingPatientBalance) || 0;
      setPayAmount(due > 0 ? due.toFixed(2) : '');
    }
  }, [clearance]);

  const coverageMutation = useMutation({
    mutationFn: async ({ pid, insuranceType, patientPercent }: { pid: number; insuranceType: string; patientPercent: number }) => {
      const r = await nestClient.put(`/patients/pid/${pid}/insurance-coverage`, { insuranceType, patientPercent });
      return r.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['billing-clearance'] });
      queryClient.invalidateQueries({ queryKey: ['billing-patients'] });
      queryClient.invalidateQueries({ queryKey: ['billing-encounters'] });
    },
  });

  // Clear every pending hold for a patient at once.
  const clearPatientHoldsMutation = useMutation({
    mutationFn: async (pid: number) => {
      const r = await nestClient.post(`/billing/patients/${pid}/holds/clear`);
      return r.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['billing-holds'] });
      queryClient.invalidateQueries({ queryKey: ['billing-patients'] });
      queryClient.invalidateQueries({ queryKey: ['billing-clearance'] });
      queryClient.invalidateQueries({ queryKey: ['billing-encounters'] });
      queryClient.invalidateQueries({ queryKey: ['billing-transactions'] });
    },
  });

  const refundMutation = useMutation({
    mutationFn: async ({ pid, amountUSD }: { pid: number; amountUSD: number }) =>
      (await nestClient.post(`/billing/patients/${pid}/refund-credit`, {
        amountUSD,
        reason: 'Overpayment refund',
        receivedBy: user?.username || 'billing',
      })).data,
    onSuccess: (d: any) => {
      setReconcileMsg('');
      setPayNotice(
        d?.refunded
          ? `Refunded ${formatLRD(Number(d.amount) || 0)} (${formatUSD(Number(d.amount) || 0)}) to the patient.`
          : 'There was no credit left to refund.',
      );
      if (d?.receipt) setReceipt(d.receipt);
      queryClient.invalidateQueries({ queryKey: ['billing-clearance'] });
      queryClient.invalidateQueries({ queryKey: ['billing-patients'] });
      queryClient.invalidateQueries({ queryKey: ['billing-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['billing-encounters'] });
    },
    onError: (e: any) => setPayNotice(e?.response?.data?.message || 'Refund failed.'),
  });

  // Backfill charges for lab orders that were never billed (pre-fix orders).
  // Two steps on purpose: the operator sees exactly what would be charged first.
  const reconcilePreviewMutation = useMutation({
    mutationFn: async () => (await nestClient.post('/billing/reconcile-lab-charges?dryRun=1', {})).data,
    onSuccess: (d: any) => { setReconcileMsg(''); setReconcilePreview(d); },
    onError: (e: any) => setReconcileMsg(e?.response?.data?.message || 'Could not build the preview.'),
  });

  const reconcileMutation = useMutation({
    mutationFn: async () => (await nestClient.post('/billing/reconcile-lab-charges', {})).data,
    onSuccess: (d: any) => {
      setReconcilePreview(null);
      setReconcileMsg(
        `Linked ${d?.linked ?? 0} existing charge(s) · posted ${d?.billed ?? 0} charge(s) · $${Number(d?.total || 0).toFixed(2)}`,
      );
      queryClient.invalidateQueries({ queryKey: ['billing-encounters'] });
      queryClient.invalidateQueries({ queryKey: ['billing-patients'] });
      queryClient.invalidateQueries({ queryKey: ['billing-holds'] });
      queryClient.invalidateQueries({ queryKey: ['billing-transactions'] });
    },
    onError: (e: any) => setReconcileMsg(e?.response?.data?.message || 'Reconciliation failed.'),
  });

  // One row per patient (a patient may have several held lab/pharmacy items).
  const groupedHolds = useMemo(() => {
    const m: Record<string, any> = {};
    for (const h of holds as any[]) {
      const k = String(h.pid);
      const g = (m[k] ||= { pid: h.pid, patient_name: h.patient_name, count: 0, lab: 0, pharmacy: 0, total: 0 });
      g.count += 1;
      g.total += Number(h.fee) || 0;
      if (h.hold_type === 'lab') g.lab += 1; else g.pharmacy += 1;
    }
    return Object.values(m) as any[];
  }, [holds]);

  /**
   * Smart Account Summary — a small scoring algorithm that turns the raw
   * charges/holds/payments into a plain-language read of the account:
   * an account-health score, where the money went, what is blocking care, and
   * the single next action that matters most.
   */
  const insight = useMemo(() => {
    const charges = Number(clearance?.totalCharges ?? breakdown?.totals?.charges ?? 0);
    const paid = Number(clearance?.patientPaid ?? breakdown?.totals?.paid ?? 0);
    const balance = Number(clearance?.remainingPatientBalance ?? breakdown?.totals?.balance ?? 0);
    const collectedPct = charges > 0 ? Math.round((paid / charges) * 100) : (balance > 0 ? 0 : 100);

    // Where the charges come from (uses the category groups on the statement).
    const catTotals: Record<string, number> = {};
    for (const e of (breakdown?.encounters || []) as any[]) {
      for (const g of e.groups || []) {
        catTotals[g.category] = (catTotals[g.category] || 0) + (Number(g.subtotal) || 0);
      }
    }
    const topCategories = Object.entries(catTotals)
      .map(([category, amount]) => ({
        category,
        amount,
        pct: charges > 0 ? Math.round((amount / charges) * 100) : 0,
      }))
      .filter((c) => c.amount > 0)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);

    const pendingList = ((holds as any[]) || []).filter((h: any) => h.status === 'hold');
    const holdsTotal = pendingList.reduce((s: number, h: any) => s + (Number(h.fee) || 0), 0);

    // Health score: collected ratio, penalised for items still holding care.
    let score = collectedPct;
    if (pendingList.length) score -= Math.min(25, pendingList.length * 8);
    if (balance <= 0 && charges > 0) score = Math.max(score, 92);
    score = Math.max(0, Math.min(100, score));
    const health =
      score >= 90 ? { label: 'Excellent', cls: 'bg-success' }
      : score >= 70 ? { label: 'Good', cls: 'bg-primary' }
      : score >= 40 ? { label: 'Needs attention', cls: 'bg-warning text-dark' }
      : { label: 'At risk', cls: 'bg-danger' };

    // One prioritized next action (holds block care, so they come first).
    let action = { icon: 'bi-check-circle', tone: 'success', text: 'Account settled — no action needed.' };
    if (pendingList.length) {
      action = {
        icon: 'bi-lock-fill',
        tone: 'danger',
        text: `Clear ${pendingList.length} billing hold(s) (${formatUSD(holdsTotal)}) — lab/pharmacy work is blocked until billing releases it.`,
      };
    } else if (balance > 0) {
      action = {
        icon: 'bi-cash-coin',
        tone: 'warning',
        text: `Collect ${formatUSD(balance)} from the patient (${collectedPct}% of charges collected).`,
      };
    } else if (clearance?.canDischarge) {
      action = { icon: 'bi-box-arrow-right', tone: 'success', text: 'Fully paid — eligible for discharge.' };
    }

    const paymentTx = ((transactions as any[]) || []).filter((t: any) => t.paymentId);
    const lastPayment = paymentTx.length ? paymentTx[0] : null;

    return {
      charges, paid, balance, collectedPct, topCategories,
      pendingHolds: pendingList.length, holdsTotal,
      score, health, action, lastPayment,
    };
  }, [clearance, breakdown, holds, transactions]);

  /** Exact amount still owed, cents included (this is what the ledger needs). */
  const dueAmount = Number(clearance?.remainingPatientBalance) || 0;
  const parsedPayAmount = Number(payAmount);
  const amountToPay = payAmount.trim() !== '' && Number.isFinite(parsedPayAmount)
    ? Math.round(parsedPayAmount * 100) / 100
    : 0;
  /** Cents the cashier is short — absorbed as a rounding adjustment when small. */
  const roundingWriteOff = Math.max(0, Math.round((dueAmount - amountToPay) * 100) / 100);
  const willRoundOff = roundingWriteOff > 0 && roundingWriteOff <= SMALL_BALANCE_WRITE_OFF_USD;
  const overpaying = amountToPay > dueAmount + 0.01;

  const handlePay = () => {
    if (!selectedPid || !clearance || amountToPay <= 0 || payInFlight.current) return;
    if (overpaying && !payOverride) return;
    payInFlight.current = true;
    payMutation.mutate({
      pid: selectedPid,
      amountUSD: amountToPay,
      paymentMethod: payMethod,
      override: payOverride,
    }, { onSettled: () => { payInFlight.current = false; } });
  };

  const filteredPatients = useMemo(() => {
    if (statusFilter === 'all') return patients;
    return patients.filter((p: BillingPatient) => p.billingStatus === statusFilter);
  }, [patients, statusFilter]);

  // Compute counts for each status
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: patients.length };
    for (const p of patients) {
      counts[p.billingStatus] = (counts[p.billingStatus] || 0) + 1;
    }
    return counts;
  }, [patients]);

  const totalOutstanding = patients.reduce((s: number, p: BillingPatient) => s + p.balance, 0);
  const overdueCount = patients.filter((p: BillingPatient) => p.billingStatus === 'overdue').length;

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
      <div className="rounded-4 p-4 mb-4 text-white position-relative overflow-hidden" style={{
        background: 'linear-gradient(135deg, #0d6efd 0%, #084298 30%, #198754 70%, #0dcaf0 100%)',
      }}>
        <div className="position-absolute end-0 top-0 opacity-10" style={{ fontSize: '8rem', transform: 'rotate(15deg) translate(20px,-20px)' }}>
          <i className="bi bi-cash-stack"></i>
        </div>
        <div className="position-relative">
          <div className="d-flex justify-content-between align-items-start flex-wrap gap-3">
            <div>
              <h2 className="mb-1 fw-bold">
                <i className="bi bi-cash-stack me-2"></i>Billing & Discharge
              </h2>
              <p className="mb-0 text-white text-opacity-75 small">
                All patients synced · Smart status tracking · Financial clearance
              </p>
            </div>
          </div>
          <div className="row g-2 mt-3">
            {[
              { v: patients.length, l: 'Total Patients', c: '#ffc107', i: 'bi-people-fill' },
              { v: formatUSD(totalOutstanding), l: 'Outstanding', c: '#dc3545', i: 'bi-exclamation-triangle' },
              { v: overdueCount, l: 'Overdue', c: '#fd7e14', i: 'bi-clock-history' },
              { v: stats?.pendingClaims || 0, l: 'Pending Claims', c: '#0dcaf0', i: 'bi-hourglass-split' },
            ].map(s => (
              <div className="col-auto" key={s.l}>
                <div className="d-flex align-items-center gap-2 bg-white bg-opacity-15 rounded-pill px-3 py-1">
                  <i className={`bi ${s.i} small`} style={{ color: s.c }}></i>
                  <span className="fw-bold small">{s.v}</span>
                  <span className="small text-white text-opacity-75">{s.l}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Search + Filter */}
      <div className="d-flex gap-2 mb-3 flex-wrap">
        <div className="input-group flex-grow-1" style={{ maxWidth: '400px' }}>
          <span className="input-group-text bg-white border-end-0 rounded-pill-start">
            <i className="bi bi-search text-muted"></i>
          </span>
          <input className="form-control border-start-0 rounded-pill-end" placeholder="Search patients by name or ID..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="d-flex flex-wrap gap-1">
          {STATUS_FILTERS.map(f => (
            <button key={f.key}
              className={`btn btn-sm rounded-pill ${statusFilter === f.key ? 'btn-primary' : 'btn-outline-secondary'}`}
              onClick={() => setStatusFilter(f.key)}>
              <i className={`bi ${f.icon} me-1`}></i>{f.label}
              {statusCounts[f.key] > 0 && (
                <span className="badge ms-1 rounded-pill" style={{
                  backgroundColor: statusFilter === f.key ? 'rgba(255,255,255,0.3)' : '#6c757d20',
                  fontSize: '0.65rem',
                }}>{statusCounts[f.key]}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Billing integrity engine — detects and safely fixes account-level defects */}
      <BillingIntegrityPanel pid={selectedPid ?? undefined} />

      {/* Pending Billing Holds (lab orders + prescriptions) — one row per patient */}
      {groupedHolds.length > 0 && (
        <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '16px' }}>
          <div className="card-header bg-white d-flex justify-content-between align-items-center py-3" style={{ borderRadius: '16px 16px 0 0' }}>
            <h6 className="mb-0 fw-bold">
              <i className="bi bi-lock-fill me-2" style={{ color: '#dc3545' }}></i>
              Pending Billing Holds
            </h6>
            <span className="badge bg-danger rounded-pill">
              {groupedHolds.length} patient{groupedHolds.length !== 1 ? 's' : ''} · {holds.length} item{holds.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="card-body p-0" style={{ maxHeight: '280px', overflowY: 'auto' }}>
            <table className="table table-sm table-hover mb-0 small align-middle">
              <thead className="table-light sticky-top">
                <tr>
                  <th className="ps-3">Patient</th>
                  <th>Held Items</th>
                  <th className="text-end">Amount</th>
                  <th className="text-end pe-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {groupedHolds.map((g: any) => (
                  <tr key={g.pid}>
                    <td className="ps-3 fw-semibold">
                      <span
                        className="text-primary"
                        style={{ cursor: 'pointer' }}
                        onClick={() => setSelectedPid(g.pid)}>
                        {g.patient_name || `Patient #${g.pid}`}
                      </span>
                    </td>
                    <td>
                      {g.lab > 0 && (
                        <span className="badge rounded-pill bg-primary me-1">
                          <i className="bi bi-flask me-1"></i>{g.lab} lab
                        </span>
                      )}
                      {g.pharmacy > 0 && (
                        <span className="badge rounded-pill bg-success me-1">
                          <i className="bi bi-capsule me-1"></i>{g.pharmacy} pharmacy
                        </span>
                      )}
                    </td>
                    <td className="text-end">{formatUSD(g.total)}</td>
                    <td className="text-end pe-3">
                      <button className="btn btn-sm btn-success rounded-pill"
                        disabled={clearPatientHoldsMutation.isPending}
                        onClick={() => clearPatientHoldsMutation.mutate(g.pid)}>
                        <i className="bi bi-check2-circle me-1"></i>Clear all
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="row g-4">
        {/* Patient List */}
        <div className="col-lg-5">
          <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
            <div className="card-header bg-white d-flex justify-content-between align-items-center py-3"
              style={{ borderRadius: '16px 16px 0 0' }}>
              <h6 className="mb-0 fw-bold">
                <i className="bi bi-people me-2" style={{ color: '#0d6efd' }}></i>
                Patient Billing Sync
              </h6>
              <span className="badge bg-primary rounded-pill">{filteredPatients.length} patients</span>
            </div>
            <div className="card-body p-0" style={{ maxHeight: '600px', overflowY: 'auto' }}>
              {isLoading ? (
                <div className="text-center py-5 text-muted">
                  <span className="spinner-border spinner-border-sm me-2"></span>Syncing patients...
                </div>
              ) : filteredPatients.length === 0 ? (
                <div className="text-center py-5 text-muted">
                  <i className="bi bi-inbox fs-1 d-block mb-2 opacity-25"></i>
                  No patients matching filter
                </div>
              ) : (
                filteredPatients.map((p: BillingPatient) => (
                  <div key={p.pid}
                    className={`border-bottom p-3 cursor-pointer transition-all ${selectedPid === p.pid ? 'bg-primary bg-opacity-10 border-primary border-2' : ''}`}
                    style={{ cursor: 'pointer', borderLeft: selectedPid === p.pid ? '4px solid #0d6efd' : '4px solid transparent' }}
                    onClick={() => setSelectedPid(p.pid)}>
                    <div className="d-flex justify-content-between align-items-start mb-2">
                      <div>
                        <div className="fw-bold small">{p.fname} {p.lname}</div>
                        <div className="small text-muted" style={{ fontSize: '0.7rem' }}>
                          PID: {p.pid} · {formatDateHuman(p.dob)} · {p.sex}
                        </div>
                        {p.encounterDate && (
                          <div className="small text-muted" style={{ fontSize: '0.7rem' }}>
                            Last visit: {formatDateHuman(p.encounterDate)}
                            {p.daysSinceLastEncounter !== null && ` (${p.daysSinceLastEncounter}d ago)`}
                          </div>
                        )}
                        {!p.encounterDate && (
                          <div className="small text-muted fst-italic" style={{ fontSize: '0.7rem' }}>No visit recorded</div>
                        )}
                      </div>
                      <div className="text-end">
                        <span className="badge rounded-pill" style={{
                          backgroundColor: p.statusColor,
                          fontSize: '0.65rem',
                          color: '#fff',
                        }}>
                          {p.billingStatus === 'pending_claims' && <i className="bi bi-hourglass-split me-1"></i>}
                          {p.billingStatus === 'overdue' && <i className="bi bi-exclamation-triangle me-1"></i>}
                          {p.statusLabel}
                        </span>
                        {p.balance > 0 && (
                          <div className="fw-bold small mt-1" style={{ color: p.billingStatus === 'overdue' ? '#dc3545' : '#0d6efd' }}>
                            {formatLRD(p.balance)}
                          </div>
                        )}
                        {p.balance === 0 && p.encounterId && (
                          <div className="text-success small mt-1 fw-bold">
                            <i className="bi bi-check-circle me-1"></i>L$0
                          </div>
                        )}
                        {p.pendingClaimCount > 0 && (
                          <div className="small text-warning fw-semibold" style={{ fontSize: '0.65rem' }}>
                            {p.pendingClaimCount} claim{p.pendingClaimCount > 1 ? 's' : ''}
                          </div>
                        )}
                      </div>
                    </div>
                    {/* Balance progress bar */}
                    {p.totalCharges > 0 && (
                      <div className="progress" style={{ height: '3px' }}>
                        <div className="progress-bar" style={{
                          width: `${Math.min(100, (p.totalPayments / p.totalCharges) * 100)}%`,
                          backgroundColor: p.billingStatus === 'overdue' ? '#dc3545' : p.statusColor,
                        }}></div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Financial Clearance Panel */}
        <div className="col-lg-7">
          {selectedPid === null ? (
            <div className="card border-0 shadow-sm d-flex align-items-center justify-content-center"
              style={{ borderRadius: '16px', minHeight: '400px' }}>
              <div className="text-center text-muted p-5">
                <i className="bi bi-arrow-left-circle fs-1 d-block mb-3 opacity-25"></i>
                <p className="mb-1 fw-semibold">Select a patient to view financial clearance</p>
                <small>All patients are synced automatically — click to review their billing status</small>
              </div>
            </div>
          ) : clearanceLoading ? (
            <div className="card border-0 shadow-sm d-flex align-items-center justify-content-center"
              style={{ borderRadius: '16px', minHeight: '400px' }}>
              <span className="spinner-border text-primary"></span>
            </div>
          ) : clearance ? (
            <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
              <div className="card-header bg-white py-3" style={{ borderRadius: '16px 16px 0 0' }}>
                <div className="d-flex justify-content-between align-items-center">
                  <h6 className="mb-0 fw-bold">
                    <i className="bi bi-clipboard-check me-2" style={{ color: '#198754' }}></i>
                    Financial Clearance — {clearance.patientName}
                  </h6>
                  {clearance.canDischarge ? (
                    <span className="badge bg-success rounded-pill">
                      <i className="bi bi-check-circle me-1"></i>Ready
                    </span>
                  ) : (
                    <span className="badge bg-danger rounded-pill">
                      <i className="bi bi-x-circle me-1"></i>Blocked
                    </span>
                  )}
                </div>
              </div>
              <div className="card-body">
                <div className="row g-2 mb-3">
                  {[
                    { v: formatUSD(clearance.totalCharges), l: 'Total Charges', c: '#0d6efd', i: 'bi-file-earmark-medical' },
                    { v: formatUSD(clearance.totalPayments), l: 'Total Payments', c: '#198754', i: 'bi-cash' },
                    { v: formatUSD(clearance.balance), l: 'Balance', c: clearance.balance > 0 ? '#dc3545' : '#198754', i: 'bi-calculator' },
                    { v: `${clearance.claimsSubmitted} (${clearance.claimsPending} pending)`, l: 'Claims', c: '#fd7e14', i: 'bi-building' },
                  ].map(c => (
                    <div className="col-6" key={c.l}>
                      <div className="p-2 rounded-3" style={{ backgroundColor: `${c.c}10` }}>
                        <div className="small text-muted">{c.l}</div>
                        <div className="fw-bold" style={{ color: c.c, fontSize: '0.95rem' }}>{c.v}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="d-flex flex-wrap align-items-center gap-2 mb-3 px-2 py-2 rounded-3 border"
                  style={{ backgroundColor: 'rgba(255,255,255,0.5)' }}>
                  <span className="small fw-semibold text-muted"><i className="bi bi-shield-check me-1"></i>Coverage:</span>
                  <select className="form-select form-select-sm rounded-pill" style={{ width: '170px' }}
                    value={coverageType} onChange={(e) => setCoverageType(e.target.value)}>
                    <option value="self_pay">No insurance (self-pay)</option>
                    <option value="insured">Insured</option>
                  </select>
                  {coverageType === 'insured' && (
                    <div className="input-group input-group-sm" style={{ width: '140px' }}>
                      <input type="number" min={0} max={100} className="form-control text-end"
                        value={coveragePercent} onChange={(e) => setCoveragePercent(e.target.value)}
                        title="Patient responsibility %" />
                      <span className="input-group-text px-1" style={{ fontSize: '0.7rem' }}>% patient</span>
                    </div>
                  )}
                  <button className="btn btn-sm btn-outline-primary rounded-pill"
                    disabled={coverageMutation.isPending || selectedPid === null}
                    onClick={() => selectedPid !== null && coverageMutation.mutate({
                      pid: selectedPid, insuranceType: coverageType, patientPercent: Number(coveragePercent),
                    })}>
                    <i className="bi bi-save me-1"></i>Update coverage
                  </button>
                  <span className="small text-muted ms-auto">
                    {coverageType === 'insured'
                      ? `Patient ${Number(coveragePercent) || 0}% · Insurance ${100 - (Number(coveragePercent) || 0)}%`
                      : 'Patient responsible for 100%'}
                  </span>
                </div>

                <h6 className="fw-bold small text-uppercase text-muted mb-2">
                  <i className="bi bi-list-check me-1"></i>Clearance Checklist
                </h6>
                <div className="list-group list-group-flush mb-3">
                  {clearance.items.map((item, i) => (
                    <div key={i} className="list-group-item px-2 py-2 border-0 d-flex align-items-center gap-3">
                      <div className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                        style={{
                          width: '36px', height: '36px',
                          backgroundColor: item.status === 'paid' ? '#19875420' :
                            item.status === 'insurance_pending' ? '#fd7e1420' : '#dc354520',
                        }}>
                        <i className={`bi ${item.icon}`} style={{
                          color: item.status === 'paid' ? '#198754' :
                            item.status === 'insurance_pending' ? '#fd7e14' : '#dc3545',
                          fontSize: '0.9rem',
                        }}></i>
                      </div>
                      <div className="flex-grow-1">
                        <div className="small fw-semibold">{item.description}</div>
                        <div className="small text-muted">
                          {formatUSD(item.amount)} · Paid: {formatUSD(item.paid)}
                        </div>
                      </div>
                      <span className={`badge rounded-pill ${
                        item.status === 'paid' ? 'bg-success' :
                        item.status === 'insurance_pending' ? 'bg-warning text-dark' : 'bg-danger'
                      }`} style={{ fontSize: '0.65rem' }}>
                        {item.status === 'paid' ? '✓' : item.status === 'insurance_pending' ? '⏳' : '✗'}
                      </span>
                    </div>
                  ))}
                </div>

                {breakdown?.encounters?.length ? (
                  <div className="mb-3">
                    <div className="d-flex justify-content-between align-items-center mb-2">
                      <h6 className="fw-bold small text-uppercase text-muted mb-0">
                        <i className="bi bi-diagram-3 me-1"></i>Charges by Description
                      </h6>
                      <div className="d-flex align-items-center">
                        {['admin', 'billing'].includes(user?.role || '') && (
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-warning rounded-pill me-2"
                            style={{ fontSize: '0.66rem' }}
                            onClick={() => {
                              setReconcileMsg('');
                              setReconcilePreview(null);
                              reconcilePreviewMutation.mutate();
                            }}
                            disabled={reconcilePreviewMutation.isPending || reconcileMutation.isPending}
                            title="Review (then confirm) charges for lab orders that were never billed"
                          >
                            <i className="bi bi-arrow-repeat me-1"></i>
                            {reconcilePreviewMutation.isPending ? 'Reviewing…' : 'Review missing lab charges'}
                          </button>
                        )}
                        <button
                          type="button"
                          className={`btn btn-sm rounded-pill ${showCptCodes ? 'btn-primary' : 'btn-outline-secondary'}`}
                          style={{ fontSize: '0.66rem' }}
                          onClick={() => setShowCptCodes((v) => !v)}
                          title={showCptCodes
                            ? 'Hide the CPT / HCPCS codes'
                            : 'Highlight the CPT / HCPCS code on every charge line'}
                        >
                          <i className="bi bi-upc-scan me-1"></i>CPT{showCptCodes ? ' ✓' : ''}
                        </button>
                      </div>
                    </div>
                    {reconcilePreview && (
                      <div className="alert alert-warning py-2 px-3 small rounded-3 mb-2">
                        <div className="d-flex justify-content-between align-items-start gap-3">
                          <div>
                            <div className="fw-semibold">
                              <i className="bi bi-search me-1"></i>Preview — nothing saved yet.
                            </div>
                            <div>
                              {reconcilePreview.scanned ?? 0} unbilled order(s) · would post{' '}
                              <strong>{reconcilePreview.billed ?? 0}</strong> charge(s) totalling{' '}
                              <strong>{formatUSD(Number(reconcilePreview.total || 0))}</strong>
                            </div>
                            {(reconcilePreview.wouldLink ?? 0) > 0 && (
                              <div className="text-muted">
                                {reconcilePreview.wouldLink} existing charge(s) will be linked to their
                                orders first and skipped (prevents double-billing).
                              </div>
                            )}
                            {reconcilePreview.orders?.length > 0 && (
                              <div className="mt-1 text-muted" style={{ maxHeight: 130, overflowY: 'auto' }}>
                                {reconcilePreview.orders.map((o: any) => (
                                  <div key={`${o.orderId}-${o.test}`}>
                                    {o.patient} · {o.test} → {o.code} {formatUSD(Number(o.fee) || 0)}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="text-nowrap">
                            <button
                              type="button"
                              className="btn btn-sm btn-warning rounded-pill me-1"
                              onClick={() => reconcileMutation.mutate()}
                              disabled={reconcileMutation.isPending || (reconcilePreview.billed ?? 0) === 0}
                            >
                              {reconcileMutation.isPending ? 'Applying…' : 'Confirm & post'}
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-secondary rounded-pill"
                              onClick={() => setReconcilePreview(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                    {reconcileMsg && (
                      <div className="alert alert-info py-1 px-2 small rounded-3 mb-2">
                        <i className="bi bi-info-circle me-1"></i>{reconcileMsg}
                      </div>
                    )}
                    <div className="table-responsive" style={{ maxHeight: '320px', overflowY: 'auto' }}>
                      <table className="table table-sm small align-middle mb-0">
                        <thead className="table-light sticky-top">
                          <tr>
                            <th>Visit / Description</th>
                            <th className="text-end">Charges</th>
                            <th className="text-end">Paid</th>
                            <th className="text-end">Balance</th>
                            <th className="text-center">Holds</th>
                          </tr>
                        </thead>
                        <tbody>
                          {breakdown.encounters.map((e: any) => (
                            <Fragment key={String(e.encounterId)}>
                              <tr>
                                <td>
                                  <div className="fw-semibold">{e.label || e.reason || 'Visit'}</div>
                                  <div className="text-muted" style={{ fontSize: '0.7rem' }}>
                                    {e.date ? formatDateHuman(e.date) : ''}
                                    {e.type && (
                                      <span className="badge bg-light text-dark border ms-1" style={{ fontSize: '0.6rem' }}>
                                        {e.type}
                                      </span>
                                    )}
                                  </div>
                                  {e.description && (
                                    <div className="text-muted" style={{ fontSize: '0.68rem' }}>{e.description}</div>
                                  )}
                                  {e.labTests?.length > 0 && (
                                    <div className="text-muted" style={{ fontSize: '0.68rem' }}>
                                      <i className="bi bi-flask me-1"></i>
                                      Lab: {e.labTests.join(', ')}
                                      {e.labLink === 'date' && (
                                        <span className="fst-italic ms-1">(matched by order date)</span>
                                      )}
                                    </div>
                                  )}
                                </td>
                                <td className="text-end">{formatUSD(e.charges)}</td>
                                <td className="text-end text-success">{formatUSD(e.paid)}</td>
                                <td className={`text-end fw-semibold ${e.balance > 0 ? 'text-danger' : 'text-success'}`}>
                                  {formatUSD(e.balance)}
                                </td>
                                <td className="text-center">
                                  {e.pendingHolds > 0
                                    ? <span className="badge bg-danger rounded-pill">{e.pendingHolds} held</span>
                                    : <span className="badge bg-success bg-opacity-25 text-success rounded-pill">cleared</span>}
                                </td>
                              </tr>
                              {(e.groups && e.groups.length
                                ? e.groups
                                : [{ category: '', lines: e.lines || [], subtotal: 0 }]
                              ).map((g: any, gi: number) => (
                                <Fragment key={`${e.encounterId}-g${gi}`}>
                                  {g.category && (
                                    <tr className="table-light" style={{ fontSize: '0.66rem' }}>
                                      <td className="ps-3 fw-semibold text-uppercase text-muted" colSpan={2}>
                                        <i className="bi bi-tag me-1"></i>{g.category}
                                      </td>
                                      <td colSpan={3} className="text-end text-muted">{formatUSD(g.subtotal)}</td>
                                    </tr>
                                  )}
                                  {(g.lines || []).map((l: any, li: number) => (
                                    <tr key={`${e.encounterId}-${gi}-${li}`} className="text-muted" style={{ fontSize: '0.72rem' }}>
                                      <td className="ps-4">
                                        <i className="bi bi-dot"></i>
                                        <span className={Number(l.amount) < 0 ? 'text-success fw-semibold' : 'text-dark'}>
                                          {l.description || l.code}
                                        </span>
                                        {showCptCodes ? (
                                          <span
                                            className="badge bg-primary bg-opacity-10 text-primary border border-primary ms-2 align-middle"
                                            style={{ fontSize: '0.62rem' }}
                                          >
                                            {l.code}
                                          </span>
                                        ) : (
                                          <span className="ms-1" style={{ fontSize: '0.65rem' }}>· {l.code}</span>
                                        )}
                                        {l.labOrder && (
                                          <span className="ms-1" style={{ fontSize: '0.65rem' }}>
                                            <i className="bi bi-flask me-1"></i>
                                            ordered as “{l.labOrder.testName}” · {l.labOrder.status}
                                          </span>
                                        )}
                                      </td>
                                      <td className={`text-end ${Number(l.amount) < 0 ? 'text-success' : ''}`}>
                                        {formatUSD(l.amount)}
                                      </td>
                                      <td colSpan={3} className="text-end">qty {l.qty}</td>
                                    </tr>
                                  ))}
                                </Fragment>
                              ))}
                            </Fragment>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="fw-bold table-light">
                            <td>Total</td>
                            <td className="text-end">{formatUSD(breakdown.totals?.charges || 0)}</td>
                            <td className="text-end text-success">{formatUSD(breakdown.totals?.paid || 0)}</td>
                            <td className="text-end text-danger">{formatUSD(breakdown.totals?.balance || 0)}</td>
                            <td></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                ) : null}

                {clearance.blockers.length > 0 && (
                  <div className="alert alert-warning py-2 mb-3" style={{ borderRadius: '10px', fontSize: '0.82rem' }}>
                    <i className="bi bi-exclamation-triangle me-2"></i>
                    {clearance.blockers.map((b, i) => (
                      <div key={i}>• {b}</div>
                    ))}
                  </div>
                )}

                {/* Auto-Calculated Summary in LRD */}
                {autoCalc && (
                  <div className="p-3 rounded-3 mb-3" style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0' }}>
                    <div className="d-flex align-items-center gap-2 mb-2">
                      <i className="bi bi-cpu text-success"></i>
                      <span className="fw-bold small text-success">Auto-Calculated from Charges</span>
                    </div>
                    <div className="row small">
                      <div className="col-6">
                        <span className="text-muted">Grand Total:</span>
                        <span className="float-end fw-bold">{autoCalc.grandTotalLRD}</span>
                      </div>
                      <div className="col-6">
                        <span className="text-muted">Visits:</span>
                        <span className="float-end fw-semibold">{autoCalc.encounterCount}</span>
                      </div>
                    </div>
                    {autoCalc.encounters?.map((enc: any) => (
                      <div key={enc.encounterId} className="mt-1 small text-muted border-top pt-1">
                        <span>{enc.date?.split(' ')[0]} — {enc.reason || enc.description || 'Visit'}:</span>
                        <span className="float-end fw-semibold text-dark">{enc.totalLRD}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Insurance + Patient split in LRD */}
                <div className="p-3 rounded-3 mb-3" style={{ backgroundColor: '#f8f9fa' }}>
                  <div className="row small">
                    <div className="col-6">
                      <span className="text-muted">Insurance (60%):</span>
                      <span className="float-end fw-semibold">{formatLRD(clearance.insuranceCovered)}</span>
                    </div>
                    <div className="col-6">
                      <span className="text-muted">Patient (40%):</span>
                      <span className="float-end fw-semibold">{formatLRD(clearance.patientObligation)}</span>
                    </div>
                    <div className="col-6 mt-1">
                      <span className="text-muted">Patient Paid:</span>
                      <span className="float-end fw-semibold text-success">{formatLRD(clearance.patientPaid)}</span>
                    </div>
                    <div className="col-6 mt-1">
                      <span className="text-muted">Remaining:</span>
                      <span className={`float-end fw-bold ${clearance.remainingPatientBalance > 0 ? 'text-danger' : 'text-success'}`}>
                        {formatLRD(clearance.remainingPatientBalance)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Payments are recorded on the Medical Billing page — this panel is the ledger only. */}
                <div className="border-top pt-3">
                  {clearance.canDischarge && (
                    <button className="btn btn-success rounded-pill px-4 mb-3"
                      onClick={() => dischargeMutation.mutate(selectedPid!)}
                      disabled={dischargeMutation.isPending}>
                      {dischargeMutation.isPending ? (
                        <><span className="spinner-border spinner-border-sm me-1"></span>Processing...</>
                      ) : (
                        <><i className="bi bi-box-arrow-right me-1"></i>Process Discharge</>
                      )}
                    </button>
                  )}
                  <div className="row g-3 mb-3">
                    <div className="col-lg-5 d-flex">
                      <div className="w-100 p-3 rounded-3 d-flex flex-column" style={{ background: '#fef2f2', border: '1px solid #fecaca' }}>
                        <h6 className="fw-bold small text-uppercase mb-2" style={{ color: '#C8102E' }}>
                          <i className="bi bi-cash-coin me-1"></i>Collect Payment
                        </h6>
                        <div className="small text-muted">Amount due</div>
                        <div className="fw-bold mb-2" style={{ color: '#C8102E' }}>
                          {formatLRD(clearance.remainingPatientBalance)}
                          <span className="text-muted ms-1" style={{ fontSize: '0.7rem' }}>
                            ({formatUSD(clearance.remainingPatientBalance)} USD)
                          </span>
                        </div>
                        <label className="form-label small mb-0" htmlFor="payAmountInput">
                          Amount to collect (USD)
                        </label>
                        <input
                          id="payAmountInput"
                          type="number"
                          step="0.01"
                          min="0"
                          className="form-control form-control-sm"
                          value={payAmount}
                          onChange={(e) => setPayAmount(e.target.value)}
                        />
                        <div className="small text-muted">
                          = {formatLRD(amountToPay)}
                          {amountToPay !== clearance.remainingPatientBalance && (
                            <button
                              type="button"
                              className="btn btn-link btn-sm p-0 ms-2"
                              onClick={() => setPayAmount(clearance.remainingPatientBalance.toFixed(2))}
                            >
                              use exact
                            </button>
                          )}
                        </div>
                        {willRoundOff && (
                          <div className="small text-success">
                            <i className="bi bi-info-circle me-1"></i>
                            {formatUSD(roundingWriteOff)} left over will be written off as a rounding adjustment.
                          </div>
                        )}
                        {((clearance as any).smallBalanceWrittenOff ?? 0) > 0 && (
                          <div className="small text-success">
                            <i className="bi bi-check-circle me-1"></i>
                            {formatLRD((clearance as any).smallBalanceWrittenOff)} already absorbed by a rounding adjustment.
                          </div>
                        )}
                        {overpaying && (
                          <div className="small text-danger">
                            <i className="bi bi-exclamation-triangle me-1"></i>
                            More than the outstanding balance — tick the override to accept.
                          </div>
                        )}
                        <label className="form-label small mb-0">Method</label>
                        <select className="form-select form-select-sm" value={payMethod}
                          onChange={e => setPayMethod(e.target.value)}>
                          <option>Cash</option>
                          <option>Mobile Money</option>
                          <option>Bank Transfer</option>
                          <option>Credit Card</option>
                          <option>Insurance</option>
                        </select>
                        {((clearance.totalCharges ?? 0) <= 0) && (
                          <div className="form-check mt-2">
                            <input className="form-check-input" type="checkbox" id="payOverride"
                              checked={payOverride} onChange={e => setPayOverride(e.target.checked)} />
                            <label className="form-check-label small text-danger fw-semibold" htmlFor="payOverride">
                              Override: no services
                            </label>
                          </div>
                        )}
                        <button className="btn rounded-pill text-white mt-2"
                          style={{ backgroundColor: '#C8102E' }}
                          onClick={handlePay}
                          disabled={payMutation.isPending || amountToPay <= 0
                            || (overpaying && !payOverride)
                            || ((clearance.totalCharges ?? 0) <= 0 && !payOverride)}>
                          {payMutation.isPending
                            ? 'Processing...'
                            : <><i className="bi bi-check-lg me-1"></i>Record {formatLRD(amountToPay)}</>}
                        </button>
                        {((clearance as any).credit ?? 0) > 0 && (
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-success rounded-pill mt-2"
                            onClick={() => refundMutation.mutate({
                              pid: selectedPid!,
                              amountUSD: Number((clearance as any).credit) || 0,
                            })}
                            disabled={refundMutation.isPending}
                            title="Pay back the overpayment and clear the credit"
                          >
                            <i className="bi bi-cash-stack me-1"></i>
                            {refundMutation.isPending
                              ? 'Refunding…'
                              : `Refund credit ${formatLRD((clearance as any).credit)}`}
                          </button>
                        )}
                        {payNotice && (
                          <div className="small text-success mt-1">
                            <i className="bi bi-check-circle me-1"></i>{payNotice}
                          </div>
                        )}
                        <div className="small text-muted mt-auto pt-2">
                          <i className="bi bi-receipt me-1"></i>
                          {insight.lastPayment
                            ? `Last payment ${insight.lastPayment.amountFormatted || ''} on ${String(insight.lastPayment.date || '').split(' ')[0]}`
                            : 'No payments recorded'}
                        </div>
                      </div>
                    </div>
                    <div className="col-lg-7 d-flex">
                      <div className="w-100 p-3 rounded-3" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                    <div className="d-flex justify-content-between align-items-center mb-2">
                      <h6 className="fw-bold small text-uppercase text-muted mb-0">
                        <i className="bi bi-graph-up-arrow me-1"></i>Smart Account Summary
                      </h6>
                      <span className={`badge ${insight.health.cls} rounded-pill`}>
                        {insight.health.label} · {insight.score}/100
                      </span>
                    </div>

                    <div className="progress mb-3" style={{ height: '6px' }}>
                      <div className={`progress-bar ${insight.health.cls}`} style={{ width: `${insight.collectedPct}%` }}></div>
                    </div>

                    <div className="row g-2 mb-3">
                      <div className="col-4">
                        <div className="small text-muted">Charges</div>
                        <div className="fw-bold">{formatUSD(insight.charges)}</div>
                      </div>
                      <div className="col-4">
                        <div className="small text-muted">Collected</div>
                        <div className="fw-bold text-success">
                          {formatUSD(insight.paid)}
                          <span className="text-muted ms-1" style={{ fontSize: '0.7rem' }}>({insight.collectedPct}%)</span>
                        </div>
                      </div>
                      <div className="col-4">
                        <div className="small text-muted">Outstanding</div>
                        <div className={`fw-bold ${insight.balance > 0 ? 'text-danger' : 'text-success'}`}>
                          {formatUSD(insight.balance)}
                        </div>
                      </div>
                    </div>

                    <div className={`alert alert-${insight.action.tone} py-2 px-3 small rounded-3 mb-3`}>
                      <i className={`bi ${insight.action.icon} me-1`}></i>{insight.action.text}
                    </div>

                    {insight.topCategories.length > 0 && (
                      <>
                        <div className="small text-muted mb-1">Where the charges are:</div>
                        {insight.topCategories.map((c: any) => (
                          <div key={c.category} className="d-flex align-items-center gap-2 mb-1">
                            <span className="small" style={{ minWidth: 96 }}>{c.category}</span>
                            <div className="progress flex-grow-1" style={{ height: '6px' }}>
                              <div className="progress-bar" style={{ width: `${c.pct}%`, backgroundColor: '#0d6efd' }}></div>
                            </div>
                            <span className="small text-muted text-nowrap" style={{ minWidth: 96, textAlign: 'right' }}>
                              {formatUSD(c.amount)} · {c.pct}%
                            </span>
                          </div>
                        ))}
                      </>
                    )}

                    <div className="d-flex justify-content-between small text-muted mt-2 flex-wrap gap-2">
                      <span>
                        <i className="bi bi-lock me-1"></i>
                        {insight.pendingHolds} pending hold(s) · {formatUSD(insight.holdsTotal)}
                      </span>
                      <span>
                        <i className="bi bi-receipt me-1"></i>
                        {insight.lastPayment
                          ? `Last payment ${insight.lastPayment.amountFormatted || ''} on ${String(insight.lastPayment.date || '').split(' ')[0]}`
                          : 'No payments recorded'}
                      </span>
                    </div>
                      </div>
                    </div>
                  </div>

                  <div className="d-flex justify-content-between align-items-center mb-2">
                    <h6 className="fw-bold small text-uppercase text-muted mb-0">
                      <i className="bi bi-clock-history me-1"></i>Recent Transactions
                    </h6>
                    <span className="badge bg-secondary rounded-pill" style={{ fontSize: '0.65rem' }}>
                      {(transactions as any[]).length} entries
                    </span>
                  </div>
                  <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                    <table className="table table-sm small mb-0">
                      <thead className="table-light sticky-top">
                        <tr>
                          <th>Date</th><th>Description</th><th className="text-end">Amount</th><th>Method</th><th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {(transactions as any[]).map((t: any) => (
                          <tr key={t.id}>
                            <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>{t.date?.split(' ')[0]}</td>
                            <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {t.title}
                            </td>
                            <td className="text-end">
                              {t.amountFormatted
                                ? <span className="fw-bold" style={{ color: '#C8102E' }}>{t.amountFormatted}</span>
                                : <span className="text-muted">—</span>}
                            </td>
                            <td>
                              {t.paymentMethod
                                ? <span className="badge bg-light text-dark border">{t.paymentMethod}</span>
                                : <span className="text-muted">—</span>}
                            </td>
                            <td>
                              {t.paymentId && (
                                <button className="btn btn-outline-secondary btn-sm py-0 px-2 rounded-pill"
                                  style={{ fontSize: '0.65rem' }}
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
                        {(transactions as any[]).length === 0 && (
                          <tr><td colSpan={5} className="text-center text-muted py-3">
                            <i className="bi bi-inbox me-1"></i>No transactions yet
                          </td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  {dischargeMutation.data?.success && (
                    <div className="alert alert-success mt-2 py-2 small" style={{ borderRadius: '10px' }}>
                      ✓ {dischargeMutation.data.message}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Lab Billing Codes */}
      {labBillingCodes.length > 0 && (
        <div className="mt-4">
          <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
            <div className="card-header bg-white d-flex justify-content-between py-3" style={{ borderRadius: '16px 16px 0 0' }}>
              <h6 className="mb-0 fw-bold">
                <i className="bi bi-flask me-2" style={{ color: '#6f42c1' }}></i>Lab Billing Codes (CPT)
              </h6>
              <span className="badge rounded-pill" style={{ backgroundColor: '#6f42c1' }}>{labBillingCodes.length} panels</span>
            </div>
            <div className="card-body p-0">
              <div className="table-responsive">
                <table className="table table-hover mb-0 small">
                  <thead className="table-light">
                    <tr>
                      <th>Lab Panel</th>
                      <th>CPT Code</th>
                      <th>Description</th>
                      <th className="text-end">Standard Fee</th>
                    </tr>
                  </thead>
                  <tbody>
                    {labBillingCodes.map((lc: any) => (
                      <tr key={lc.cptCode}>
                        <td className="fw-semibold">{lc.labType}</td>
                        <td><code className="small">{lc.cptCode}</code></td>
                        <td className="text-muted">{lc.description}</td>
                        <td className="text-end fw-semibold">${lc.standardFee.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Charge catalog, pricing, and accounts receivable */}
      <ChargeCatalogPanel />

      {/* ─── Receipt Modal ─────────────────────────────────────── */}
      {receipt && (
        <div className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
          style={{ zIndex: 9999, backgroundColor: 'rgba(0,0,0,0.6)' }}
          onClick={() => setReceipt(null)}>
          <div className="bg-white shadow-lg" style={{
            width: '100%', maxWidth: '500px', maxHeight: '90vh', overflowY: 'auto',
            borderRadius: '12px', fontFamily: 'monospace',
          }} onClick={e => e.stopPropagation()}>
            {/* Receipt Header */}
            <div className="text-center p-3 border-bottom" style={{ backgroundColor: '#C8102E', color: '#fff', borderRadius: '12px 12px 0 0' }}>
              <h5 className="mb-0 fw-bold">{receipt.hospital}</h5>
              <small className="text-white-50">{receipt.location}</small>
              <div className="mt-1" style={{ fontSize: '0.75rem' }}>
                {receipt.dateFormatted} · {receipt.timeFormatted}
              </div>
              <div className="badge bg-white text-dark mt-1" style={{ fontSize: '0.7rem' }}>
                Receipt #: {receipt.receiptNumber}
              </div>
              {receipt.kind === 'refund' ? (
                <div className="mt-2">
                  <span className="badge bg-dark" style={{ fontSize: '0.85rem', letterSpacing: '1px' }}>
                    <i className="bi bi-cash-stack me-1"></i>REFUND
                  </span>
                </div>
              ) : receipt.paidInFull && (
                <div className="mt-2">
                  <span className="badge bg-success" style={{ fontSize: '0.85rem', letterSpacing: '1px' }}>
                    <i className="bi bi-check-circle-fill me-1"></i>PAID IN FULL
                  </span>
                </div>
              )}
            </div>

            {/* Patient Info */}
            <div className="p-3 border-bottom" style={{ fontSize: '0.82rem' }}>
              <div className="row">
                <div className="col-6"><small className="text-muted">Patient:</small><br/><strong>{receipt.patient.name}</strong></div>
                <div className="col-3"><small className="text-muted">PID:</small><br/><strong>{receipt.patient.pid}</strong></div>
                <div className="col-3"><small className="text-muted">DOB:</small><br/><strong>{formatDateHuman(receipt.patient.dob)}</strong></div>
              </div>
            </div>

            {/* Services / Items */}
            <div className="p-3 border-bottom" style={{ fontSize: '0.78rem' }}>
              <small className="text-muted text-uppercase fw-bold">
                {receipt.kind === 'refund' ? 'Money Returned To Patient' : 'Services Rendered'}
              </small>
              <table className="table table-sm small mt-1 mb-0">
                <thead><tr className="text-muted"><th>Code</th><th>Description</th><th className="text-end">Qty</th><th className="text-end">Total</th></tr></thead>
                <tbody>
                  {receipt.items.map((item, i) => (
                    <tr key={i}>
                      <td><code>{item.code}</code></td>
                      <td>{item.description}</td>
                      <td className="text-end">{item.quantity}</td>
                      <td className="text-end fw-semibold">L${item.totalLRD.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Summary */}
            <div className="p-3 border-bottom" style={{ fontSize: '0.82rem', backgroundColor: '#f9fafb' }}>
              <div className="d-flex justify-content-between mb-1">
                <span>Subtotal:</span><span className="fw-semibold">{receipt.summary.subtotalLRD}</span>
              </div>
              {receipt.kind !== 'refund' && (
                <>
                  <div className="d-flex justify-content-between mb-1">
                    <span>Insurance (60%):</span><span className="text-muted">{receipt.summary.insuranceCoveredLRD}</span>
                  </div>
                  <div className="d-flex justify-content-between mb-2">
                    <span>Patient Obligation:</span><span className="fw-semibold">{receipt.summary.patientObligationLRD}</span>
                  </div>
                </>
              )}
              {receipt.kind === 'refund' && receipt.refund?.reason && (
                <div className="d-flex justify-content-between mb-2 text-muted">
                  <span>Reason:</span><span>{receipt.refund.reason}</span>
                </div>
              )}
              <hr className="my-1" />
              <div className="d-flex justify-content-between fw-bold" style={{ color: '#C8102E', fontSize: '0.9rem' }}>
                <span>{receipt.kind === 'refund' ? 'Amount Refunded:' : 'Amount Paid:'}</span>
                <span>{receipt.summary.amountPaidLRD}</span>
              </div>
              <div className="d-flex justify-content-between small">
                <span>Method:</span><span>{receipt.payment.method}</span>
              </div>
              <div className="d-flex justify-content-between small">
                <span>{receipt.kind === 'refund' ? 'Refunded By:' : 'Received By:'}</span><span>{receipt.payment.receivedBy}</span>
              </div>
              {receipt.kind === 'refund' && receipt.refund?.reference && (
                <div className="d-flex justify-content-between small text-muted">
                  <span>Ledger ref:</span><span>{receipt.refund.reference}</span>
                </div>
              )}
              {receipt.summary.balanceLRD !== 'L$0' && (
                <div className="d-flex justify-content-between small text-danger mt-1">
                  <span>Remaining Balance:</span><span className="fw-bold">{receipt.summary.balanceLRD}</span>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-3 text-center text-muted" style={{ fontSize: '0.7rem' }}>
              <div className="d-flex justify-content-center mb-2">
                <BarcodeSvg value={receipt.receiptNumber} height={36} fontSize={9} />
              </div>
              <p className="mb-2">{receipt.footer}</p>
              <p className="mb-1 fw-bold" style={{ color: '#C8102E' }}>🇱🇷 {receipt.hospital}</p>
              <p className="mb-0">{receipt.location} · All amounts in {receipt.currency}</p>
            </div>

            {/* Actions */}
            <div className="p-2 border-top d-flex gap-2 justify-content-center">
              <button className="btn btn-sm rounded-pill px-4 text-white" style={{ backgroundColor: '#C8102E' }}
                onClick={() => window.print()}>
                <i className="bi bi-printer me-1"></i>Print Receipt
              </button>
              <button className="btn btn-outline-secondary btn-sm rounded-pill"
                onClick={() => setReceipt(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
