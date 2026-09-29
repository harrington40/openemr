import {
    Injectable,
    Logger,
    OnModuleInit,
    OnModuleDestroy,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BillingService } from './billing.service';
import {
    selectDuplicateLines,
    legacyLineMatchesOrderCharge,
} from './billing-integrity.util';

/** Result of an INSERT / UPDATE / DELETE. */
interface AffectedRowsResult {
    affectedRows: number;
    insertId: number;
}

/** `billing_settings` key/value row. */
interface BillingSettingRow {
    setting_key: string;
    setting_value: string;
}

/** `billing_integrity_runs` row. */
interface IntegrityRunRow {
    id: number;
    run_at: string;
    trigger_type: string;
    triggered_by: string;
    scanned_patients: number;
    findings_count: number;
    auto_fixed: number;
    refunded_usd: number | string;
    duration_ms: number | string;
}

/** A run row with its timestamp normalised to ISO-8601. */
export interface IntegrityRunView extends Omit<IntegrityRunRow, 'run_at'> {
    run_at: string | null;
}

/** Latest run summary embedded in the settings payload. */
interface IntegrityLastRun {
    run_at: string | null;
    trigger_type: string;
    findings_count: number;
    auto_fixed: number;
    refunded_usd: number | string;
}

/** Resolved integrity settings. */
export interface IntegritySettings {
    enabled: boolean;
    hour: number;
    autoFix: boolean;
    lastRun: IntegrityLastRun | null;
}

/** Result object of `applyFixes()`. */
export interface IntegrityFixResult {
    dryRun: boolean;
    applied: number;
    skipped: number;
    refundedUSD: number;
    actor: string;
    results: {
        rule: string;
        pid: number;
        patient: string;
        amountUSD: number;
        action: string;
    }[];
}

/** Summary of a recorded integrity run. */
export interface IntegrityRunSummary {
    id: number;
    trigger: string;
    durationMs: number;
    at: string;
    findings: number;
    autoFixed: number;
    refundedUSD: number;
}

/** `patient_data` pid/name row. */
interface IntegrityPatientNameRow {
    pid: number;
    name: string;
}

/** A `billing` line used by the duplicate-line rule. */
interface IntegrityBillingLineRow {
    id: number;
    code: string;
    fee: number;
    pid?: number;
    order_id?: number | null;
}

/** A duplicated (order, code) group. */
interface DuplicateGroupRow {
    order_id: number;
    pid: number;
    code: string;
    n: number | string;
    total: number | string;
}

/** A `billing` row joined to its order. */
interface BillingOrderLineRow {
    id: number;
    pid: number;
    code: string;
    fee: number | string;
    order_id: number | null;
    order_status: string;
    patient_instructions: string | null;
}

/** An unbilled procedure order. */
interface UnbilledOrderRow {
    orderId: number;
    pid: number;
    test: string | null;
    order_status: string;
    day: string | null;
}

/** Per-patient balance row. */
interface PatientBalanceRow {
    pid: number;
    bal: number | string;
}

/** Off-catalogue price row. */
interface OffCataloguePriceRow {
    pid: number;
    code: string;
    fee: number | string;
    catalog_fee: number | string;
    n: number | string;
}

/** Orphan charge row. */
interface OrphanChargeRow {
    pid: number | null;
    n: number | string;
    total: number | string;
}

/** A `billing` line that can be refunded. */
interface RefundableLineRow {
    id: number;
    pid: number;
    encounter: number | null;
    code: string;
    fee: number | string;
}

/**
 * What an integrity rule reports. `amountUSD` is the money at stake: for a rule
 * that removes a bad charge it is what the patient gets back; for a rule that
 * adds a missing charge it is what they owe.
 */
export interface IntegrityFinding {
    /** Stable rule id, e.g. DUPLICATE_ORDER_BILLING. */
    rule: string;
    severity: 'error' | 'warn' | 'info';
    pid: number;
    patient: string;
    amountUSD: number;
    summary: string;
    /** Human-readable rows that prove the finding. */
    evidence: { id?: number | string; detail: string; amountUSD?: number }[];
    /** True when the engine can correct this without human judgement. */
    autoFixable: boolean;
    /** What the fix does, in plain words. */
    fixDescription: string;
    /** Machine payload consumed by `applyFixes`. */
    fix?: {
        kind: 'refund_lines' | 'write_off_residue' | 'bill_order';
        lineIds?: number[];
        orderIds?: number[];
        pid?: number;
        amountUSD?: number;
    };
}

export interface IntegrityReport {
    generatedAt: string;
    scope: string;
    scannedPatients: number;
    findings: IntegrityFinding[];
    summary: {
        total: number;
        bySeverity: Record<string, number>;
        moneyToRefundUSD: number;
        moneyToChargeUSD: number;
        autoFixable: number;
    };
}

/**
 * Billing integrity engine.
 *
 * The 2026-09 lab incidents (duplicate charges from the legacy batch plus the
 * per-order reconcile, charges for rejected orders, generic placeholder codes,
 * cent residues that blocked discharge, credits nobody refunded) were all caught
 * by hand. This service turns each of those investigations into a rule, so the
 * same class of problem is detected automatically — with the evidence, the money
 * at stake, and a safe, auditable correction.
 *
 * Design rules:
 *  - Detection is read-only; nothing here changes data.
 *  - A finding is only auto-fixable when the proof is mechanical (a 1:1 pairing,
 *    a rejected order, a residual inside the rounding threshold).
 *  - Every fix writes an explicit REFUND line tagged in `billing.code_text`, so a
 *    correction can always be traced back (and reversed) by hand.
 */
@Injectable()
export class BillingIntegrityService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(BillingIntegrityService.name);

    /** Visit / registration codes that are never lab charges. */
    private static readonly NON_LAB_CODES =
        "'TRIAGE','VITALS','REG','99213','99214','99215'";

    constructor(
        @InjectDataSource() private dataSource: DataSource,
        private readonly billing: BillingService,
    ) {}

    // ─── Scheduled scanning ────────────────────────────────────────

    private timer?: NodeJS.Timeout;
    private bootTimer?: NodeJS.Timeout;

    async onModuleInit(): Promise<void> {
        await this.ensureRunsSchema();
        // Dependency-free scheduler: a cheap check every 15 minutes that runs the
        // scan once a day after the configured hour. @nestjs/schedule is not
        // installed and the deploy only ships dist/, so a new runtime dependency
        // would have to be installed on the server — not worth it for one daily job.
        this.timer = setInterval(
            () => {
                void this.maybeRunScheduled();
            },
            15 * 60 * 1000,
        );
        this.bootTimer = setTimeout(() => {
            void this.maybeRunScheduled();
        }, 90 * 1000);
        this.logger.log(
            'Billing integrity scheduler armed (daily inventory of account defects).',
        );
    }

    onModuleDestroy(): void {
        if (this.timer) clearInterval(this.timer);
        if (this.bootTimer) clearTimeout(this.bootTimer);
    }

    private async ensureRunsSchema(): Promise<void> {
        await this.dataSource.query(
            `CREATE TABLE IF NOT EXISTS billing_integrity_runs (
         id INT AUTO_INCREMENT PRIMARY KEY,
         run_at DATETIME NOT NULL,
         trigger_type VARCHAR(16) NOT NULL,
         scanned_patients INT NOT NULL DEFAULT 0,
         findings_count INT NOT NULL DEFAULT 0,
         auto_fixed INT NOT NULL DEFAULT 0,
         refunded_usd DECIMAL(12,2) NOT NULL DEFAULT 0,
         summary_json LONGTEXT NULL,
         duration_ms INT NOT NULL DEFAULT 0,
         triggered_by VARCHAR(64) NOT NULL DEFAULT 'system',
         KEY idx_bir_run_at (run_at)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        );
        // Added after the first release of the table.
        try {
            await this.dataSource.query(
                `ALTER TABLE billing_integrity_runs ADD COLUMN triggered_by VARCHAR(64) NOT NULL DEFAULT 'system'`,
            );
        } catch {
            /* column already exists */
        }
    }

    /** Integrity settings, stored alongside the other billing settings. */
    async getSettings(): Promise<IntegritySettings> {
        const rows = await this.dataSource.query<BillingSettingRow[]>(
            `SELECT setting_key, setting_value FROM billing_settings
        WHERE setting_key IN ('integrity_scan_enabled','integrity_scan_hour','integrity_auto_fix')`,
        );
        const map: Record<string, string> = {};
        for (const r of rows) map[r.setting_key] = r.setting_value;
        const [last] = await this.dataSource.query<IntegrityLastRun[]>(
            `SELECT run_at, trigger_type, findings_count, auto_fixed, refunded_usd
         FROM billing_integrity_runs ORDER BY run_at DESC LIMIT 1`,
        );
        const hour = Number(map.integrity_scan_hour ?? 2);
        return {
            enabled: (map.integrity_scan_enabled ?? '1') === '1',
            hour: Number.isFinite(hour) ? Math.min(23, Math.max(0, hour)) : 2,
            autoFix: (map.integrity_auto_fix ?? '0') === '1',
            // ISO-8601 UTC with milliseconds + Z, so callers never have to guess a format.
            lastRun: last ? { ...last, run_at: this.isoZ(last.run_at) } : null,
        };
    }

    async setSettings(dto: {
        enabled?: boolean;
        hour?: number;
        autoFix?: boolean;
    }): Promise<IntegritySettings> {
        const put = async (key: string, value: string): Promise<void> => {
            await this.dataSource.query(
                `INSERT INTO billing_settings (setting_key, setting_value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
                [key, value],
            );
        };
        if (dto.enabled !== undefined)
            await put('integrity_scan_enabled', dto.enabled ? '1' : '0');
        if (dto.hour !== undefined)
            await put('integrity_scan_hour', String(dto.hour));
        if (dto.autoFix !== undefined)
            await put('integrity_auto_fix', dto.autoFix ? '1' : '0');
        return this.getSettings();
    }

    /**
     * Run the daily scan if today's window has opened and it has not run yet. Safe
     * to call as often as you like — the recorded run time is the guard, so a
     * restart mid-day cannot double-run.
     */
    async maybeRunScheduled(): Promise<{ ran: boolean; reason?: string }> {
        try {
            const s = await this.getSettings();
            if (!s.enabled) return { ran: false, reason: 'disabled' };

            const now = new Date();
            const due = new Date(now);
            due.setHours(s.hour, 0, 0, 0);
            if (now < due)
                return { ran: false, reason: `window opens at ${s.hour}:00` };

            const [already] = await this.dataSource.query<{ run_at: string }[]>(
                `SELECT run_at FROM billing_integrity_runs WHERE run_at >= ? LIMIT 1`,
                [due],
            );
            if (already) return { ran: false, reason: 'already ran today' };

            await this.runScanAndRecord('scheduled');
            return { ran: true };
        } catch (e) {
            this.logger.error(
                `Scheduled integrity scan failed: ${e instanceof Error ? e.message : 'unknown error'}`,
            );
            return { ran: false, reason: 'error' };
        }
    }

    /** Scan, optionally correct the safe findings, and record the run. */
    async runScanAndRecord(
        trigger: 'manual' | 'scheduled',
        actor = 'system',
    ): Promise<{
        run: IntegrityRunSummary;
        report: IntegrityReport;
        fixes: IntegrityFixResult | null;
    }> {
        const started = Date.now();
        const report = await this.scan();
        let fixes: IntegrityFixResult | null = null;
        if (trigger === 'scheduled') {
            const s = await this.getSettings();
            if (s.autoFix && report.summary.autoFixable > 0)
                fixes = await this.applyFixes({ actor });
        }
        const duration = Date.now() - started;
        const result = await this.dataSource.query<AffectedRowsResult>(
            `INSERT INTO billing_integrity_runs
         (run_at, trigger_type, scanned_patients, findings_count, auto_fixed, refunded_usd, summary_json, duration_ms, triggered_by)
       VALUES (NOW(), ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                trigger,
                report.scannedPatients,
                report.summary.total,
                fixes?.applied ?? 0,
                fixes?.refundedUSD ?? 0,
                JSON.stringify({
                    summary: report.summary,
                    byRule: this.countByRule(report.findings),
                }),
                duration,
                actor,
            ],
        );
        this.logger.log(
            `Integrity ${trigger} scan by=${actor}: ${report.summary.total} finding(s), ${report.summary.autoFixable} fixable, auto-fixed=${fixes?.applied ?? 0} (${duration}ms)`,
        );
        return {
            run: {
                id: result?.insertId,
                trigger,
                durationMs: duration,
                // ISO-8601 UTC with milliseconds + Z.
                at: new Date().toISOString(),
                findings: report.summary.total,
                autoFixed: fixes?.applied ?? 0,
                refundedUSD: fixes?.refundedUSD ?? 0,
            },
            report,
            fixes,
        };
    }

    private countByRule(findings: IntegrityFinding[]): Record<string, number> {
        const out: Record<string, number> = {};
        for (const f of findings) out[f.rule] = (out[f.rule] || 0) + 1;
        return out;
    }

    /** ISO-8601 in UTC with milliseconds and the trailing Z (e.g. 2026-09-21T18:52:24.000Z). */
    private isoZ(value: unknown): string | null {
        if (value === null || value === undefined || value === '') return null;
        const d =
            value instanceof Date
                ? value
                : typeof value === 'string' || typeof value === 'number'
                  ? new Date(value)
                  : null;
        if (!d || Number.isNaN(d.getTime())) {
            return typeof value === 'string' || typeof value === 'number'
                ? String(value)
                : null;
        }
        return d.toISOString();
    }

    /** Recent scan history, newest first. Timestamps are ISO-8601 UTC with .000Z. */
    async getRuns(limit = 20): Promise<IntegrityRunView[]> {
        const take = Math.min(Math.max(Number(limit) || 20, 1), 100);
        const rows = await this.dataSource.query<IntegrityRunRow[]>(
            `SELECT id, run_at, trigger_type, triggered_by, scanned_patients, findings_count,
              auto_fixed, refunded_usd, duration_ms
         FROM billing_integrity_runs ORDER BY run_at DESC LIMIT ${take}`,
        );
        return rows.map((r) => ({
            ...r,
            run_at: this.isoZ(r.run_at),
        }));
    }

    // ─── Scan ──────────────────────────────────────────────────────

    async scan(pid?: number): Promise<IntegrityReport> {
        const scope = pid ? `patient ${pid}` : 'all patients';
        const where = pid ? 'AND b.pid = ?' : '';
        const wherePo = pid ? 'AND po.patient_id = ?' : '';
        const p = pid ? [pid, pid, pid, pid, pid] : [];

        const findings: IntegrityFinding[] = [
            ...(await this.ruleDuplicateOrderBilling(pid)),
            ...(await this.ruleLegacyPlaceholderSuperseded(pid)),
            ...(await this.ruleRejectedOrderBilled(pid)),
            ...(await this.ruleUnbilledOrder(pid)),
            ...(await this.ruleRoundingResidue(pid)),
            ...(await this.ruleCreditOwed(pid)),
            ...(await this.ruleOffCataloguePrice(pid)),
            ...(await this.ruleOrphanCharge(pid)),
        ];
        void where;
        void wherePo;
        void p;

        const scannedRows = await this.dataSource.query<
            { n: number | string }[]
        >(
            `SELECT COUNT(DISTINCT pid) AS n FROM billing WHERE activity = 1 ${pid ? 'AND pid = ?' : ''}`,
            pid ? [pid] : [],
        );

        const bySeverity: Record<string, number> = {
            error: 0,
            warn: 0,
            info: 0,
        };
        let moneyToRefundUSD = 0;
        let moneyToChargeUSD = 0;
        let autoFixable = 0;
        for (const f of findings) {
            bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
            if (f.fix?.kind === 'bill_order') moneyToChargeUSD += f.amountUSD;
            else if (f.amountUSD > 0) moneyToRefundUSD += f.amountUSD;
            if (f.autoFixable) autoFixable++;
        }

        return {
            generatedAt: new Date().toISOString(),
            scope,
            scannedPatients: Number(scannedRows?.[0]?.n) || 0,
            findings,
            summary: {
                total: findings.length,
                bySeverity,
                moneyToRefundUSD: this.round2(moneyToRefundUSD),
                moneyToChargeUSD: this.round2(moneyToChargeUSD),
                autoFixable,
            },
        };
    }

    private round2(n: number): number {
        return Math.round((Number(n) || 0) * 100) / 100;
    }

    /** Patient names for a set of pids, so findings read like a worklist. */
    private async names(pids: number[]): Promise<Record<number, string>> {
        const unique = [...new Set(pids)].filter((n) => Number.isFinite(n));
        if (!unique.length) return {};
        const rows = await this.dataSource.query<IntegrityPatientNameRow[]>(
            `SELECT pid, CONCAT(fname, ' ', lname) AS name FROM patient_data WHERE pid IN (${unique.map(() => '?').join(',')})`,
            unique,
        );
        const map: Record<number, string> = {};
        for (const r of rows) map[r.pid] = r.name || `#${r.pid}`;
        return map;
    }
    // ─── Rules ─────────────────────────────────────────────────────

    /**
     * The same CODE billed more than once for the same order.
     *
     * That — not "more than one line per order" — is the only reliable duplicate
     * signature. One order legitimately carries several DIFFERENT charges (a
     * multi-test order, or a legacy batch that lumped a whole visit onto one
     * order), and treating those as duplicates would refund real money.
     */
    private async ruleDuplicateOrderBilling(
        pid?: number,
    ): Promise<IntegrityFinding[]> {
        const rows = await this.dataSource.query<DuplicateGroupRow[]>(
            `SELECT b.order_id, b.pid, b.code, COUNT(*) AS n, ROUND(SUM(b.fee),2) AS total
         FROM billing b
        WHERE b.activity = 1 AND b.order_id IS NOT NULL AND b.code_type <> 'REFUND'
          ${pid ? 'AND b.pid = ?' : ''}
        GROUP BY b.order_id, b.pid, b.code HAVING n > 1`,
            pid ? [pid] : [],
        );
        const out: IntegrityFinding[] = [];
        for (const r of rows) {
            const lines = await this.dataSource.query<
                IntegrityBillingLineRow[]
            >(
                `SELECT id, code, fee FROM billing
          WHERE pid = ? AND order_id = ? AND code = ? AND activity = 1 AND code_type <> 'REFUND'
          ORDER BY id`,
                [r.pid, r.order_id, r.code],
            );
            const lineIds = lines.map((l) => Number(l.id));

            // Which of these lines is already reversed (exact link)?
            const reversedRows = await this.dataSource.query<
                { reverses_id: number | null }[]
            >(
                `SELECT DISTINCT reverses_id FROM billing
          WHERE code_type = 'REFUND' AND activity = 1
            AND reverses_id IN (${lineIds.join(', ')})`,
            );
            const reversed = new Set<number>(
                reversedRows.map((x) => Number(x.reverses_id)),
            );

            // Refunds for this code that are not already counted above — codes are
            // truncated and sometimes suffixed, so match on the prefix.
            const [refundSum] = await this.dataSource.query<
                { usd: number | string }[]
            >(
                `SELECT COALESCE(SUM(fee), 0) AS usd FROM billing
          WHERE pid = ? AND code_type = 'REFUND' AND activity = 1
            AND code LIKE CONCAT('RFD-', LEFT(?, 16), '%')
            AND (reverses_id IS NULL OR reverses_id NOT IN (${lineIds.join(', ')}))`,
                [r.pid, r.code],
            );
            // The decision lives in a pure, unit-tested helper: exactly one line per
            // (order, code) is legitimate, already-reversed lines are ignored, and any
            // unlinked refund offset is consumed against the rest.
            const duplicates = selectDuplicateLines(
                lines,
                reversed,
                Number(refundSum?.usd) || 0,
            );
            if (!duplicates.length) continue;
            const names = await this.names([r.pid]);
            const amount = this.round2(
                duplicates.reduce((s, d) => s + Number(d.fee), 0),
            );
            out.push({
                rule: 'DUPLICATE_ORDER_BILLING',
                severity: 'error',
                pid: r.pid,
                patient: names[r.pid] || `#${r.pid}`,
                amountUSD: amount,
                summary: `Lab order ${r.order_id} billed ${lines.length}× for ${r.code} — ${duplicates.length} duplicate line(s) worth $${amount.toFixed(2)}`,
                evidence: lines.map((l) => ({
                    id: l.id,
                    detail: `${l.code} ${l.fee}`,
                    amountUSD: Number(l.fee),
                })),
                autoFixable: true,
                fixDescription: 'Post a REFUND line for each duplicate charge',
                fix: {
                    kind: 'refund_lines',
                    lineIds: duplicates.map((d) => d.id),
                    pid: r.pid,
                },
            });
        }
        return out;
    }

    /**
     * Legacy placeholder charges (order_id NULL) whose order is now billed under
     * its own code — generic `80048` batches and repeated HbA1c/TSH lines.
     */
    private async ruleLegacyPlaceholderSuperseded(
        pid?: number,
    ): Promise<IntegrityFinding[]> {
        const plan = await this.billing.planLabChargeOrderLinks();
        const scoped = pid ? plan.filter(() => true) : plan;
        const rows: (BillingOrderLineRow & {
            orderId: number;
            test: string;
        })[] = [];
        for (const link of scoped) {
            const [row] = await this.dataSource.query<BillingOrderLineRow[]>(
                `SELECT b.id, b.pid, b.code, b.fee, b.order_id, po.order_status, po.patient_instructions
           FROM billing b JOIN procedure_order po ON po.procedure_order_id = ?
          WHERE b.id = ? AND b.activity = 1 AND b.code_type <> 'REFUND'`,
                [link.orderId, link.legacyId],
            );
            if (!row) continue;
            // A legacy line only duplicates an order's own charge when it is the SAME
            // test, or a generic placeholder standing in for it. The pairing is by
            // timestamp, so without this an unrelated imaging charge sitting in the
            // same two-minute window would be reported as a duplicate lab charge.
            if (
                !legacyLineMatchesOrderCharge(
                    String(row.code || ''),
                    !!link.exact,
                )
            )
                continue;
            if (pid && Number(row.pid) !== pid) continue;
            // Already reversed? An exact reversal link is authoritative; the code and
            // code_text checks are fallbacks for refunds posted before that column
            // existed. Both err towards "already handled" — never towards refunding twice.
            const [refund] = await this.dataSource.query<
                { n: number | string }[]
            >(
                `SELECT COUNT(*) AS n FROM billing
          WHERE pid = ? AND code_type = 'REFUND' AND activity = 1
            AND (reverses_id = ?
                 OR code LIKE CONCAT('RFD-', LEFT(?, 16), '%')
                 OR code_text LIKE CONCAT('%#', ?, ' (%'))`,
                [row.pid, row.id, row.code, row.id],
            );
            if (Number(refund?.n)) continue;
            rows.push({ ...row, orderId: link.orderId, test: link.test });
        }
        const names = await this.names(rows.map((r) => Number(r.pid)));
        return rows.map((r) => ({
            rule: 'LEGACY_PLACEHOLDER_SUPERSEDED',
            severity: 'warn' as const,
            pid: Number(r.pid),
            patient: names[Number(r.pid)] || `#${r.pid}`,
            amountUSD: this.round2(Number(r.fee)),
            summary: `Legacy line ${r.id} (${r.code} $${Number(r.fee).toFixed(2)}) duplicates order ${r.orderId} "${r.test}", which is billed under its own code`,
            evidence: [
                {
                    id: r.id,
                    detail: `${r.code} ${r.fee} · order ${r.orderId} (${r.order_status})`,
                    amountUSD: Number(r.fee),
                },
            ],
            autoFixable: true,
            fixDescription:
                'Post a REFUND line for the superseded legacy charge',
            fix: {
                kind: 'refund_lines',
                lineIds: [Number(r.id)],
                pid: Number(r.pid),
            },
        }));
    }

    /** Charges for lab orders that were rejected/cancelled after being billed. */
    private async ruleRejectedOrderBilled(
        pid?: number,
    ): Promise<IntegrityFinding[]> {
        const rows = await this.dataSource.query<BillingOrderLineRow[]>(
            `SELECT b.id, b.pid, b.code, b.fee, b.order_id, po.order_status, po.patient_instructions
         FROM billing b
         JOIN procedure_order po ON po.procedure_order_id = b.order_id
        WHERE b.activity = 1 AND b.code_type <> 'REFUND'
          AND po.order_status IN ('rejected','cancelled','duplicate')
          ${pid ? 'AND b.pid = ?' : ''}
        ORDER BY b.pid, b.id`,
            pid ? [pid] : [],
        );
        const names = await this.names(rows.map((r) => Number(r.pid)));
        return rows.map((r) => ({
            rule: 'REJECTED_ORDER_BILLED',
            severity: 'error' as const,
            pid: Number(r.pid),
            patient: names[Number(r.pid)] || `#${r.pid}`,
            amountUSD: this.round2(Number(r.fee)),
            summary: `Order ${r.order_id} is ${r.order_status} but line ${r.id} (${r.code}) is still charged`,
            evidence: [
                {
                    id: r.id,
                    detail: `${r.code} ${r.fee} · ${r.patient_instructions}`,
                    amountUSD: Number(r.fee),
                },
            ],
            autoFixable: true,
            fixDescription:
                'Post a REFUND line for the charge on a rejected order',
            fix: {
                kind: 'refund_lines',
                lineIds: [Number(r.id)],
                pid: Number(r.pid),
            },
        }));
    }

    /** A validated/completed lab order that has never been charged. */
    private async ruleUnbilledOrder(pid?: number): Promise<IntegrityFinding[]> {
        const rows = await this.dataSource.query<UnbilledOrderRow[]>(
            `SELECT po.procedure_order_id AS orderId, po.patient_id AS pid,
              po.patient_instructions AS test, po.order_status, DATE(po.date_ordered) AS day
         FROM procedure_order po
        WHERE po.activity = 1
          AND po.order_status NOT IN ('cancelled','rejected','duplicate')
          AND NOT EXISTS (SELECT 1 FROM billing b WHERE b.order_id = po.procedure_order_id AND b.activity = 1)
          ${pid ? 'AND po.patient_id = ?' : ''}
        ORDER BY po.patient_id, po.procedure_order_id DESC LIMIT 200`,
            pid ? [pid] : [],
        );
        const names = await this.names(rows.map((r) => Number(r.pid)));
        const out: IntegrityFinding[] = [];
        for (const r of rows) {
            const resolved = await this.billing.resolveLabChargeCodeForAudit(
                String(r.test || ''),
            );
            out.push({
                rule: 'UNBILLED_ORDER',
                severity: 'info',
                pid: Number(r.pid),
                patient: names[Number(r.pid)] || `#${r.pid}`,
                amountUSD: this.round2(Number(resolved.fee) || 0),
                summary: `Order ${r.orderId} "${r.test}" (${r.order_status}, ${r.day}) was never charged — would bill ${resolved.code} $${Number(resolved.fee).toFixed(2)}`,
                evidence: [
                    {
                        id: r.orderId,
                        detail: `${r.test} → ${resolved.code}`,
                        amountUSD: Number(resolved.fee),
                    },
                ],
                autoFixable: false,
                fixDescription:
                    'Bill the order (use the lab reconcile preview)',
                fix: {
                    kind: 'bill_order',
                    orderIds: [Number(r.orderId)],
                    pid: Number(r.pid),
                },
            });
        }
        return out;
    }

    /**
     * A residual balance small enough to be cash-rounding rather than debt — the
     * rule that would have stopped a patient being blocked from discharge over
     * seven cents.
     */
    private async ruleRoundingResidue(
        pid?: number,
    ): Promise<IntegrityFinding[]> {
        const threshold = await this.billing.smallBalanceWriteOffThreshold();
        if (threshold <= 0) return [];
        const rows = await this.dataSource.query<PatientBalanceRow[]>(
            `SELECT z.pid, ROUND(z.bal, 2) AS bal FROM (
         SELECT b.pid,
                SUM(b.fee) - COALESCE((SELECT SUM(a.pay_amount) FROM ar_activity a WHERE a.pid = b.pid), 0) AS bal
           FROM billing b WHERE b.activity = 1 ${pid ? 'AND b.pid = ?' : ''} GROUP BY b.pid) z
        WHERE z.bal > 0 AND z.bal <= ?
        ORDER BY z.bal`,
            pid ? [pid, threshold] : [threshold],
        );
        const names = await this.names(rows.map((r) => Number(r.pid)));
        return rows.map((r) => ({
            rule: 'ROUNDING_RESIDUE',
            severity: 'warn' as const,
            pid: Number(r.pid),
            patient: names[Number(r.pid)] || `#${r.pid}`,
            amountUSD: this.round2(Number(r.bal)),
            summary: `Balance of $${Number(r.bal).toFixed(2)} (L$${Math.round(Number(r.bal) * 193)}) is cash-rounding residue, inside the $${threshold.toFixed(2)} write-off threshold`,
            evidence: [
                {
                    detail: `residual balance $${Number(r.bal).toFixed(2)}`,
                    amountUSD: Number(r.bal),
                },
            ],
            autoFixable: true,
            fixDescription: 'Post a rounding adjustment so the account settles',
            fix: {
                kind: 'write_off_residue',
                pid: Number(r.pid),
                amountUSD: Number(r.bal),
            },
        }));
    }

    /** Money the hospital is holding for the patient (overpayment). */
    private async ruleCreditOwed(pid?: number): Promise<IntegrityFinding[]> {
        const rows = await this.dataSource.query<PatientBalanceRow[]>(
            `SELECT z.pid, ROUND(z.bal, 2) AS bal FROM (
         SELECT b.pid,
                SUM(b.fee) - COALESCE((SELECT SUM(a.pay_amount) FROM ar_activity a WHERE a.pid = b.pid), 0) AS bal
           FROM billing b WHERE b.activity = 1 ${pid ? 'AND b.pid = ?' : ''} GROUP BY b.pid) z
        WHERE z.bal < 0 ORDER BY z.bal`,
            pid ? [pid] : [],
        );
        const names = await this.names(rows.map((r) => Number(r.pid)));
        return rows.map((r) => ({
            rule: 'CREDIT_OWED',
            severity: 'warn' as const,
            pid: Number(r.pid),
            patient: names[Number(r.pid)] || `#${r.pid}`,
            amountUSD: this.round2(Math.abs(Number(r.bal))),
            summary: `Account is $${Math.abs(Number(r.bal)).toFixed(2)} in credit (L$${Math.round(Math.abs(Number(r.bal)) * 193)}) — owed back to the patient`,
            evidence: [
                {
                    detail: `credit $${Math.abs(Number(r.bal)).toFixed(2)}`,
                    amountUSD: Math.abs(Number(r.bal)),
                },
            ],
            autoFixable: false,
            fixDescription:
                'Refund the credit from the patient card (pays cash out — needs human approval)',
        }));
    }

    /** A charge whose fee no longer matches the price catalogue for that code. */
    private async ruleOffCataloguePrice(
        pid?: number,
    ): Promise<IntegrityFinding[]> {
        const rows = await this.dataSource.query<OffCataloguePriceRow[]>(
            `SELECT b.pid, b.code, b.fee, pc.fee AS catalog_fee, COUNT(*) AS n
         FROM billing b
         JOIN price_catalog pc ON pc.code = b.code AND pc.active = 1
        WHERE b.activity = 1 AND b.code_type <> 'REFUND' AND pc.fee <> b.fee
          ${pid ? 'AND b.pid = ?' : ''}
        GROUP BY b.pid, b.code, b.fee, pc.fee ORDER BY b.pid LIMIT 100`,
            pid ? [pid] : [],
        );
        const names = await this.names(rows.map((r) => Number(r.pid)));
        return rows.map((r) => ({
            rule: 'OFF_CATALOGUE_PRICE',
            severity: 'info' as const,
            pid: Number(r.pid),
            patient: names[Number(r.pid)] || `#${r.pid}`,
            amountUSD: this.round2(
                Number(r.n) * Math.abs(Number(r.fee) - Number(r.catalog_fee)),
            ),
            summary: `${r.n}× ${r.code} billed at $${Number(r.fee).toFixed(2)} while the catalogue price is $${Number(r.catalog_fee).toFixed(2)}`,
            evidence: [
                {
                    detail: `${r.code}: charged ${r.fee}, catalogue ${r.catalog_fee}`,
                    amountUSD: Number(r.fee),
                },
            ],
            autoFixable: false,
            fixDescription:
                'Review — historical charges keep the price at the time of service',
        }));
    }

    /** Charges that cannot be traced to a visit or a patient record. */
    private async ruleOrphanCharge(pid?: number): Promise<IntegrityFinding[]> {
        const rows = await this.dataSource.query<OrphanChargeRow[]>(
            `SELECT b.pid, COUNT(*) AS n, ROUND(SUM(b.fee),2) AS total
         FROM billing b LEFT JOIN patient_data pd ON pd.pid = b.pid
        WHERE b.activity = 1 AND (pd.pid IS NULL OR COALESCE(b.encounter, 0) = 0)
          ${pid ? 'AND b.pid = ?' : ''}
        GROUP BY b.pid ORDER BY b.pid`,
            pid ? [pid] : [],
        );
        return rows.map((r) => ({
            rule: 'ORPHAN_CHARGE',
            severity: 'info' as const,
            pid: Number(r.pid),
            patient: r.pid === null ? '(no patient record)' : `#${r.pid}`,
            amountUSD: this.round2(Number(r.total)),
            summary: `${r.n} charge line(s) with no encounter or no patient record ($${Number(r.total).toFixed(2)})`,
            evidence: [
                {
                    detail: `${r.n} lines, no encounter/patient`,
                    amountUSD: Number(r.total),
                },
            ],
            autoFixable: false,
            fixDescription: 'Investigate in the billing manager',
        }));
    }

    // ─── Fix ───────────────────────────────────────────────────────

    /**
     * Apply corrections for the current findings.
     *
     * Findings are re-derived from live data, so a stale client can never apply a
     * fix that no longer applies — and running twice is a no-op because detection
     * skips lines that already carry a matching refund. Only `autoFixable` findings
     * are touched; anything needing human judgement (cash refunds, re-pricing,
     * billing an order) is reported back instead.
     */
    async applyFixes(
        opts: {
            pid?: number;
            rules?: string[];
            dryRun?: boolean;
            /** Operator recorded on every refund line — money changes must be attributed. */
            actor?: string;
        } = {},
    ): Promise<{
        dryRun: boolean;
        applied: number;
        skipped: number;
        refundedUSD: number;
        actor: string;
        results: {
            rule: string;
            pid: number;
            patient: string;
            amountUSD: number;
            action: string;
        }[];
    }> {
        const actor = opts.actor || 'unknown';
        const report = await this.scan(opts.pid);
        const wanted = report.findings.filter(
            (f) =>
                f.autoFixable &&
                (!opts.rules?.length || opts.rules.includes(f.rule)),
        );
        const results: {
            rule: string;
            pid: number;
            patient: string;
            amountUSD: number;
            action: string;
        }[] = [];
        let refundedUSD = 0;

        for (const f of wanted) {
            const action = await this.applyOne(f, !!opts.dryRun, actor);
            if (!action.applied) continue;
            refundedUSD += f.amountUSD;
            results.push({
                rule: f.rule,
                pid: f.pid,
                patient: f.patient,
                amountUSD: f.amountUSD,
                action: action.detail,
            });
        }

        const skipped = report.findings.length - results.length;
        this.logger.log(
            `Integrity fixes ${opts.dryRun ? '(dry-run) ' : ''}by=${actor} applied=${results.length} skipped=${skipped} refunded=$${this.round2(refundedUSD)}`,
        );
        return {
            dryRun: !!opts.dryRun,
            applied: results.length,
            skipped,
            refundedUSD: this.round2(refundedUSD),
            actor,
            results,
        };
    }

    private async applyOne(
        f: IntegrityFinding,
        dryRun: boolean,
        actor = 'unknown',
    ): Promise<{ applied: boolean; detail: string }> {
        if (f.fix?.kind === 'refund_lines') {
            const ids = f.fix.lineIds || [];
            if (!ids.length) return { applied: false, detail: 'no lines' };
            if (dryRun)
                return {
                    applied: true,
                    detail: `would refund line(s) #${ids.join(', #')}`,
                };
            let posted = 0;
            for (const id of ids) {
                const [line] = await this.dataSource.query<RefundableLineRow[]>(
                    `SELECT id, pid, encounter, code, fee FROM billing
            WHERE id = ? AND activity = 1 AND code_type <> 'REFUND'`,
                    [id],
                );
                if (!line) continue;
                await this.dataSource.query(
                    `INSERT INTO billing
             (date, encounter, code_type, code, pid, provider_id, user, groupname,
              authorized, activity, fee, units, billed, reverses_id, code_text)
           VALUES (NOW(), ?, 'REFUND', CONCAT('RFD-', LEFT(?, 16)), ?, 1, 1, 'Default',
                   1, 1, -?, 1, 1, ?, ?)`,
                    [
                        line.encounter ?? 0,
                        line.code,
                        line.pid,
                        line.fee,
                        line.id,
                        `Integrity rule ${f.rule} by ${actor}: refund of line #${line.id} (${line.code} ${line.fee})`,
                    ],
                );
                posted++;
            }
            return {
                applied: posted > 0,
                detail: `refunded ${posted} line(s)`,
            };
        }

        if (f.fix?.kind === 'write_off_residue') {
            if (dryRun)
                return {
                    applied: true,
                    detail: `would write off $${(f.fix.amountUSD || 0).toFixed(2)}`,
                };
            const res = await this.billing.writeOffSmallBalance(
                f.fix.pid || f.pid,
                `Integrity rule ${f.rule}: rounding residue`,
            );
            return {
                applied: !!res.adjusted,
                detail: res.adjusted
                    ? `wrote off $${this.round2(Number(res.amount ?? res.residue)).toFixed(2)}`
                    : 'nothing to write off',
            };
        }

        return { applied: false, detail: 'no automatic fix available' };
    }
}
