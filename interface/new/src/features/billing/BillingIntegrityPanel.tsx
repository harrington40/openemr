import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import nestClient from '../../api/nest-client';

/**
 * Billing integrity engine UI.
 *
 * Surfaces every account-level billing defect the engine can prove — duplicate
 * lab charges, charges for rejected orders, superseded legacy placeholders,
 * rounding residues, credits nobody refunded, unbilled orders, price drift and
 * orphan charges — with the money at stake and a one-click, previewed correction
 * for the subset that is mechanically safe.
 */

interface Finding {
  rule: string;
  severity: 'error' | 'warn' | 'info';
  pid: number;
  patient: string;
  amountUSD: number;
  summary: string;
  evidence: { id?: number | string; detail: string; amountUSD?: number }[];
  autoFixable: boolean;
  fixDescription: string;
}

interface Report {
  generatedAt: string;
  scope: string;
  scannedPatients: number;
  findings: Finding[];
  summary: {
    total: number;
    bySeverity: Record<string, number>;
    moneyToRefundUSD: number;
    moneyToChargeUSD: number;
    autoFixable: number;
  };
}

const usd = (n: number) =>
  `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const lrd = (n: number) => `L$${Math.round(Number(n || 0) * 193).toLocaleString('en-US')}`;

/**
 * Timestamps from the API are ISO-8601 UTC with milliseconds and a trailing Z
 * (e.g. 2026-09-21T18:52:24.000Z). Show the raw value so it is unambiguous, plus
 * the operator's own local time for readability.
 */
const localTime = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString();
};

const RULE_LABEL: Record<string, string> = {
  DUPLICATE_ORDER_BILLING: 'Duplicate order billing',
  LEGACY_PLACEHOLDER_SUPERSEDED: 'Superseded legacy charge',
  REJECTED_ORDER_BILLED: 'Rejected order charged',
  UNBILLED_ORDER: 'Order never billed',
  ROUNDING_RESIDUE: 'Rounding residue',
  CREDIT_OWED: 'Credit owed to patient',
  OFF_CATALOGUE_PRICE: 'Off-catalogue price',
  ORPHAN_CHARGE: 'Orphan charge',
};

const SEV_STYLE: Record<string, string> = { error: 'danger', warn: 'warning', info: 'secondary' };

/**
 * The scan result: summary chips, optional fix preview, and the findings table.
 * Split out so each screen stays small and the JSX stays readable.
 */
function ReportBody({
  report, preview, sorted, showAll, setShowAll, setPreview, onApply, applying,
}: {
  report: Report;
  preview: any;
  sorted: Finding[];
  showAll: boolean;
  setShowAll: (v: boolean) => void;
  setPreview: (v: any) => void;
  onApply: () => void;
  applying: boolean;
}) {
  return (
    <>
      <div className="d-flex flex-wrap gap-2 mb-2 small">
        <span className="badge bg-light text-dark border">{report.summary.total} finding(s)</span>
        <span className="badge bg-danger">{report.summary.bySeverity.error || 0} errors</span>
        <span className="badge bg-warning text-dark">{report.summary.bySeverity.warn || 0} warnings</span>
        <span className="badge bg-secondary">{report.summary.bySeverity.info || 0} info</span>
        <span className="badge bg-success">
          refund to patients {usd(report.summary.moneyToRefundUSD)} · {lrd(report.summary.moneyToRefundUSD)}
        </span>
        {report.summary.moneyToChargeUSD > 0 && (
          <span className="badge bg-info text-dark">to charge {usd(report.summary.moneyToChargeUSD)}</span>
        )}
        <span className="badge bg-light text-dark border">{report.summary.autoFixable} auto-fixable</span>
      </div>

      {preview && (
        <div className="alert alert-warning py-2 px-3 small rounded-3 mb-2">
          <div className="d-flex justify-content-between align-items-start gap-3">
            <div>
              <div className="fw-semibold"><i className="bi bi-search me-1"></i>Preview — nothing saved yet.</div>
              <div>
                Would correct <strong>{preview.applied}</strong> issue(s), removing{' '}
                <strong>{usd(preview.refundedUSD)}</strong> ({lrd(preview.refundedUSD)}) from patient balances.
                {preview.skipped > 0 && <> {preview.skipped} finding(s) need human judgement and are left alone.</>}
              </div>
            </div>
            <div className="text-nowrap">
              <button className="btn btn-sm btn-warning rounded-pill me-1" onClick={onApply} disabled={applying}>
                {applying ? 'Applying…' : 'Confirm & fix'}
              </button>
              <button className="btn btn-sm btn-outline-secondary rounded-pill" onClick={() => setPreview(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="table-responsive" style={{ maxHeight: 300, overflowY: 'auto' }}>
        <table className="table table-sm small align-middle mb-0">
          <thead className="table-light">
            <tr>
              <th>Patient</th>
              <th>Issue</th>
              <th className="text-end">Money</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr><td colSpan={4} className="text-center text-success py-3">
                <i className="bi bi-check-circle me-1"></i>No account issues detected.
              </td></tr>
            )}
            {sorted.map((f, i) => (
              <tr key={`${f.rule}-${f.pid}-${i}`}>
                <td className="text-nowrap">
                  {f.patient}
                  <div className="text-muted" style={{ fontSize: '0.68rem' }}>#{f.pid}</div>
                </td>
                <td>
                  <span className={`badge bg-${SEV_STYLE[f.severity]} me-1`} style={{ fontSize: '0.62rem' }}>
                    {RULE_LABEL[f.rule] || f.rule}
                  </span>
                  {f.summary}
                </td>
                <td className="text-end text-nowrap fw-semibold">
                  {usd(f.amountUSD)}
                  <div className="text-muted fw-normal" style={{ fontSize: '0.68rem' }}>{lrd(f.amountUSD)}</div>
                </td>
                <td className="text-muted" style={{ fontSize: '0.7rem' }}>
                  {f.autoFixable
                    ? <span className="text-success"><i className="bi bi-wrench-adjustable me-1"></i>{f.fixDescription}</span>
                    : <span><i className="bi bi-person-exclamation me-1"></i>{f.fixDescription}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="d-flex justify-content-between align-items-center mt-2">
        <div className="form-check small">
          <input className="form-check-input" type="checkbox" id="integrityAll" checked={showAll}
            onChange={(e) => setShowAll(e.target.checked)} />
          <label className="form-check-label" htmlFor="integrityAll">Show reference-only findings</label>
        </div>
        <div className="text-muted" style={{ fontSize: '0.68rem' }}>
          scanned {report.scannedPatients} patient(s) · {new Date(report.generatedAt).toLocaleString()}
        </div>
      </div>
    </>
  );
}


export default function BillingIntegrityPanel({ pid }: { pid?: number }) {
  const queryClient = useQueryClient();
  const [report, setReport] = useState<Report | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [notice, setNotice] = useState('');
  const [showAll, setShowAll] = useState(false);

  // Schedule: enabled, hour of day, auto-fix, plus the run history.
  const { data: settings } = useQuery({
    queryKey: ['billing-integrity-settings'],
    queryFn: async () => (await nestClient.get('/billing/integrity/settings')).data,
  });
  const { data: runs } = useQuery({
    queryKey: ['billing-integrity-runs'],
    queryFn: async () => (await nestClient.get('/billing/integrity/runs')).data,
  });
  const saveSettingsMutation = useMutation({
    mutationFn: async (patch: { enabled?: boolean; hour?: number; autoFix?: boolean }) =>
      (await nestClient.put('/billing/integrity/settings', patch)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['billing-integrity-settings'] }),
    onError: (e: any) => setNotice(e?.response?.data?.message || 'Could not save the schedule.'),
  });
  const runNowMutation = useMutation({
    mutationFn: async () => (await nestClient.post('/billing/integrity/run-now', {})).data,
    onSuccess: (d: any) => {
      setReport(d?.report || null);
      setNotice(
        `Scan recorded — ${d?.run?.findings ?? 0} finding(s) in ${d?.run?.durationMs ?? 0}ms${d?.run?.autoFixed ? `, auto-fixed ${d.run.autoFixed}` : ''}.`,
      );
      queryClient.invalidateQueries({ queryKey: ['billing-integrity-runs'] });
    },
    onError: (e: any) => setNotice(e?.response?.data?.message || 'Run failed.'),
  });

  const scanMutation = useMutation({
    mutationFn: async () =>
      (await nestClient.get('/billing/integrity/scan', { params: pid ? { pid } : {} })).data as Report,
    onSuccess: (d) => { setPreview(null); setNotice(''); setReport(d); },
    onError: (e: any) => setNotice(e?.response?.data?.message || 'Scan failed.'),
  });

  const fixMutation = useMutation({
    mutationFn: async (dryRun: boolean) =>
      (await nestClient.post('/billing/integrity/fix', {
        pid, dryRun,
        rules: [
          'DUPLICATE_ORDER_BILLING', 'LEGACY_PLACEHOLDER_SUPERSEDED',
          'REJECTED_ORDER_BILLED', 'ROUNDING_RESIDUE',
        ],
      })).data,
    onSuccess: (d: any, dryRun) => {
      if (dryRun) { setPreview(d); setNotice(''); return; }
      setPreview(null);
      setNotice(
        `Corrected ${d?.applied ?? 0} account issue(s) · ${usd(d?.refundedUSD || 0)} removed from patient balances.`,
      );
      scanMutation.mutate();
    },
    onError: (e: any) => setNotice(e?.response?.data?.message || 'Fix failed.'),
  });

  const findings = report?.findings || [];
  const visible = showAll ? findings : findings.filter((f) => f.autoFixable || f.amountUSD > 0);
  const sorted = [...visible].sort((a, b) => b.amountUSD - a.amountUSD || a.rule.localeCompare(b.rule));

  return (
    <div className="card mb-3">
      <div className="card-header d-flex justify-content-between align-items-center">
        <span className="fw-bold small text-uppercase text-muted">
          <i className="bi bi-shield-check me-1"></i>Billing Integrity
          {pid ? ` — patient ${pid}` : ' — whole portfolio'}
        </span>
        <div className="d-flex gap-2">
          {report && report.summary.autoFixable > 0 && (
            <button type="button" className="btn btn-sm btn-outline-danger rounded-pill"
              onClick={() => fixMutation.mutate(true)} disabled={fixMutation.isPending}>
              <i className="bi bi-wrench-adjustable me-1"></i>
              Preview fixes ({report.summary.autoFixable})
            </button>
          )}
          <button type="button" className="btn btn-sm btn-primary rounded-pill"
            onClick={() => scanMutation.mutate()} disabled={scanMutation.isPending}>
            {scanMutation.isPending
              ? <><span className="spinner-border spinner-border-sm me-1"></span>Scanning…</>
              : <><i className="bi bi-search me-1"></i>Scan</>}
          </button>
        </div>
      </div>
      <div className="card-body">
        {!report && !scanMutation.isPending && (
          <div className="text-muted small">
            Scans for duplicate order charges, charges on rejected orders, superseded legacy charges,
            rounding residues, unrefunded credits, unbilled orders, price drift and orphan charges.
            Nothing is changed until you confirm.
          </div>
        )}
        {notice && (
          <div className="alert alert-info py-1 px-2 small rounded-3 mb-2">
            <i className="bi bi-info-circle me-1"></i>{notice}
          </div>
        )}
        {report && (
          <ReportBody
            report={report} preview={preview} sorted={sorted} showAll={showAll}
            setShowAll={setShowAll} setPreview={setPreview}
            onApply={() => fixMutation.mutate(false)} applying={fixMutation.isPending}
          />
        )}
      </div>

      <div className="card-footer bg-white small d-flex flex-wrap gap-3 align-items-center">
        <div className="form-check form-switch mb-0">
          <input className="form-check-input" type="checkbox" id="integrityEnabled"
            checked={!!settings?.enabled}
            onChange={(e) => saveSettingsMutation.mutate({ enabled: e.target.checked })} />
          <label className="form-check-label" htmlFor="integrityEnabled">Daily scan</label>
        </div>
        <select className="form-select form-select-sm w-auto" value={settings?.hour ?? 2}
          onChange={(e) => saveSettingsMutation.mutate({ hour: Number(e.target.value) })}>
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
          ))}
        </select>
        <div className="form-check form-switch mb-0">
          <input className="form-check-input" type="checkbox" id="integrityAutoFix"
            checked={!!settings?.autoFix}
            onChange={(e) => saveSettingsMutation.mutate({ autoFix: e.target.checked })} />
          <label className="form-check-label" htmlFor="integrityAutoFix">
            Auto-fix safe findings
          </label>
        </div>
        <button type="button" className="btn btn-sm btn-outline-primary rounded-pill ms-auto"
          onClick={() => runNowMutation.mutate()} disabled={runNowMutation.isPending}>
          <i className="bi bi-play-circle me-1"></i>
          {runNowMutation.isPending ? 'Running…' : 'Run now'}
        </button>
        <div className="text-muted w-100" style={{ fontSize: '0.7rem' }}>
          {settings?.lastRun
            ? <>Last {settings.lastRun.trigger_type} scan{' '}
                <code>{String(settings.lastRun.run_at)}</code>
                {` (${localTime(settings.lastRun.run_at)} local)`} ·{' '}
                {settings.lastRun.findings_count} finding(s) · auto-fixed {settings.lastRun.auto_fixed} ·{' '}
                {usd(Number(settings.lastRun.refunded_usd) || 0)}</>
            : 'No scan recorded yet.'}
          {Array.isArray(runs) && runs.length > 1 && <> · {runs.length} run(s) in history</>}
          {settings && !settings.autoFix && (
            <> · safe findings are only <strong>reported</strong>; turn on auto-fix for unattended correction</>
          )}
        </div>
      </div>
    </div>
  );
}
