import { Injectable, Logger, BadRequestException, ForbiddenException, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { normalizeKey, WINDOW_SQL } from '../common/dedup.util';
import { BillingService } from '../billing/billing.service';

// Lab status workflow with estimated turnaround times
const STATUS_FLOW: Record<string, { next: string; eta: string; label: string; color: string }> = {
  pending:    { next: 'collected', eta: 'Awaiting collection', label: 'Pending', color: '#fd7e14' },
  collected:  { next: 'processing', eta: 'Sample collected — 15-30 min to processing', label: 'Collected', color: '#0dcaf0' },
  processing: { next: 'completed', eta: 'Processing — 30-120 min to results', label: 'Processing', color: '#6f42c1' },
  completed:  { next: 'validated', eta: 'Results ready for review', label: 'Completed', color: '#198754' },
  validated:  { next: '', eta: 'Results validated', label: 'Validated', color: '#0d6efd' },
  rejected:   { next: '', eta: 'Order rejected/cancelled', label: 'Rejected', color: '#dc3545' },
  cancelled:  { next: '', eta: 'Order cancelled', label: 'Cancelled', color: '#6c757d' },
  referred:   { next: '', eta: 'Sent to external lab', label: 'Referred Out', color: '#ffc107' },
  duplicate:  { next: 'pending', eta: 'Duplicate — awaiting override or auto-delete', label: 'Duplicate', color: '#dc3545' },
};

// CPT billing codes for common lab panels
const LAB_BILLING_CODES: Record<string, { code: string; description: string; fee: number }> = {
  'Complete Blood Count (CBC)': { code: '85025', description: 'CBC with auto diff', fee: 25 },
  'Basic Metabolic Panel (BMP)': { code: '80048', description: 'Basic metabolic panel', fee: 30 },
  'Comprehensive Metabolic Panel (CMP)': { code: '80053', description: 'Comprehensive metabolic panel', fee: 45 },
  'Lipid Panel': { code: '80061', description: 'Lipid panel', fee: 35 },
  'Liver Function Test': { code: '80076', description: 'Hepatic function panel', fee: 40 },
  'Thyroid Panel': { code: '84443', description: 'TSH assay', fee: 50 },
  'Urinalysis': { code: '81001', description: 'Urinalysis auto w/scope', fee: 15 },
  'Coagulation Profile': { code: '85610', description: 'Prothrombin time', fee: 20 },
  'Malaria / Parasites': { code: '87207', description: 'Malaria smear', fee: 18 },
  'STI Panel': { code: '87801', description: 'Infectious agent detection', fee: 75 },
};

export interface LabOrderWithStatus {
  id: number;
  patientId: number;
  patientName: string;
  patientPid: number;
  /** Canonical `patient_data.id` — use this to link to the patient chart. */
  chartId: number | null;
  encounterId: number;
  dateOrdered: string;
  orderStatus: string;
  orderPriority: string;
  instructions: string;
  clinicalHx: string;
  providerId: number;
  specimenId: string | null;
  statusLabel: string;
  statusColor: string;
  nextStatus: string;
  estimatedTime: string;
  billingCode: string | null;
  billingDesc: string | null;
  billingFee: number | null;
  hasResults: boolean;
  steps: WorkflowStep[];
}

export interface WorkflowStep {
  status: string;
  label: string;
  color: string;
  completed: boolean;
  active: boolean;
  eta: string;
}

@Injectable()
export class LabsService implements OnModuleInit {
  private readonly logger = new Logger(LabsService.name);

  constructor(
    @InjectDataSource() private dataSource: DataSource,
    private readonly billing: BillingService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    // One-time authorization codes an administrator issues (from the admin
    // dashboard) to a specific lab user or provider so that user may delete a
    // validated lab result from the patient chart.
    try {
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS lab_delete_authorizations (
          id INT AUTO_INCREMENT PRIMARY KEY,
          code VARCHAR(8) NOT NULL,
          issued_by INT NULL,
          issued_by_name VARCHAR(120) NULL,
          target_user_id INT NOT NULL,
          target_username VARCHAR(120) NULL,
          target_role VARCHAR(40) NULL,
          note VARCHAR(255) NULL,
          expires_at DATETIME NOT NULL,
          used_at DATETIME NULL,
          used_on_result_id INT NULL,
          revoked_at DATETIME NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_lda_code (code),
          INDEX idx_lda_target (target_user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
    } catch (err) {
      this.logger.warn(`Could not ensure lab_delete_authorizations table: ${err}`);
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────

  /** `pnotes.title` is VARCHAR(255). Never let a generated title overflow it. */
  private static readonly TITLE_MAX = 255;

  private clip(text: unknown, max: number = LabsService.TITLE_MAX): string {
    const s = String(text ?? '');
    return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
  }

  /**
   * Resolve who should receive a lab notification for a patient:
   *  1. the provider who ordered the lab, or
   *  2. the provider currently assigned to the patient (`patient_data.providerID`).
   */
  private async resolveTargetProvider(
    pid: number,
    orderProviderId: number | string | null | undefined,
  ): Promise<{ providerId: number | null; source: 'ordering' | 'assigned' | 'none' }> {
    if (orderProviderId) {
      return { providerId: Number(orderProviderId), source: 'ordering' };
    }
    const [row] = await this.dataSource.query(
      `SELECT providerID FROM patient_data WHERE pid = ? LIMIT 1`,
      [pid],
    );
    const assigned = row?.providerID ? Number(row.providerID) : null;
    return assigned ? { providerId: assigned, source: 'assigned' } : { providerId: null, source: 'none' };
  }

  // ─── Patient Orders ─────────────────────────────────────────────

  /** Attach the per-order billing-hold state to a list of orders. */
  private async attachHolds(orders: any[]): Promise<any[]> {
    const ids = orders.map((o) => Number(o.id)).filter((n) => !!n);
    const map = await this.billing.getHoldMap('lab', ids);
    for (const o of orders) {
      const h = map[Number(o.id)];
      o.billingHold = h ? h.status : 'none';
      o.billingCleared = !h || h.status === 'cleared' || h.status === 'cancelled';
      o.billingHoldFee = h ? Number(h.fee) || 0 : 0;
      o.billingHoldCode = h ? h.code || null : null;
      o.billingHeld = !!(h && h.status === 'hold');
    }
    return orders;
  }

  async getPatientOrders(pid: number): Promise<LabOrderWithStatus[]> {
    const rows = await this.dataSource.query(
      `SELECT po.procedure_order_id as id, po.patient_id as patientId,
        CONCAT(pd.fname,' ',pd.lname) as patientName,
        pd.pid as patientPid, pd.id as chartId, po.encounter_id as encounterId,
        po.date_ordered as dateOrdered, po.order_status as orderStatus,
        po.order_priority as orderPriority,
        po.patient_instructions as instructions, po.clinical_hx as clinicalHx,
        po.provider_id as providerId, po.specimen_id as specimenId,
        (SELECT COUNT(*) FROM procedure_result res
          JOIN procedure_report pr ON pr.procedure_report_id = res.procedure_report_id
          WHERE pr.procedure_order_id = po.procedure_order_id) as resultCount
      FROM procedure_order po
      JOIN patient_data pd ON po.patient_id = pd.pid
      WHERE po.patient_id = ?
      ORDER BY po.date_ordered DESC LIMIT 50`,
      [pid],
    );

    return this.attachHolds(rows.map((r: any) => this.enrichOrder(r)));
  }

  async createOrder(pid: number, dto: any) {
    // Lazy cleanup: auto-delete quarantined duplicates older than 1 hour.
    await this.cleanupExpiredDuplicates();

    // Handle batch orders from screening (orders array)
    if (dto.orders && Array.isArray(dto.orders)) {
      const results: any[] = [];
      const duplicates: any[] = [];
      for (const order of dto.orders) {
        const testName = String(order.notes || order.testName || '').trim();
        const normalized = testName.toLowerCase().replace(/\s+/g, ' ');

        // Smart dedup: quarantine if the same test was ordered for this patient within the last hour.
        if (normalized) {
          const existing = await this.dataSource.query(
            `SELECT procedure_order_id FROM procedure_order
             WHERE patient_id = ? AND LOWER(TRIM(patient_instructions)) = ?
               AND date_ordered >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
               AND order_status NOT IN ('rejected', 'cancelled', 'duplicate')
             LIMIT 1`,
            [pid, normalized],
          );
          if (existing.length) {
            const q = await this.dataSource.query(
              `INSERT INTO procedure_order (patient_id, provider_id, encounter_id, date_ordered,
                order_status, order_priority, patient_instructions, clinical_hx, activity)
               VALUES (?, ?, ?, NOW(), 'duplicate', ?, ?, ?, 1)`,
              [pid, dto.provider_id || 1, dto.encounter_id || 0,
                order.priority || 'routine',
                order.notes || order.testName || '',
                dto.clinical_hx || ''],
            );
            duplicates.push({
              quarantinedOrderId: q.insertId,
              testName: order.testName || testName,
              existingOrderId: existing[0].procedure_order_id,
              reason: 'duplicate_1h_window',
            });
            continue;
          }
        }

        const result = await this.dataSource.query(
          `INSERT INTO procedure_order (patient_id, provider_id, encounter_id, date_ordered,
            order_status, order_priority, patient_instructions, clinical_hx, activity)
           VALUES (?, ?, ?, NOW(), ?, ?, ?, ?, 1)`,
          [pid, dto.provider_id || 1, dto.encounter_id || 0,
            dto.order_status || 'pending',
            order.priority || 'routine',
            order.notes || order.testName || '',
            dto.clinical_hx || ''],
        );
        const orderId = result.insertId;
        results.push({ id: orderId, testName: order.testName });
        const bill = await this.billing.billLabOrder(pid, testName, dto.provider_id || 1, orderId).catch(() => null);
        // Place a billing hold — the technician cannot collect until it is cleared.
        await this.billing.createHold({
          holdType: 'lab', orderId, pid,
          encounterId: dto.encounter_id || 0,
          code: bill?.code || null,
          description: order.notes || order.testName || testName,
          fee: bill?.fee || 0,
        }).catch(() => null);
      }
      if (duplicates.length) {
        await this.notifyDuplicateOrders(pid, duplicates);
      }
      this.logger.log(`Batch lab orders: pid=${pid}, created=${results.length}, duplicates=${duplicates.length}`);
      return { orders: results, duplicates, count: results.length, duplicateCount: duplicates.length };
    }

    // Single order — quarantine duplicates against orders placed within the last hour.
    const testName = String(dto.patient_instructions || '').trim();
    const normalized = testName.toLowerCase().replace(/\s+/g, ' ');
    if (normalized) {
      const existing = await this.dataSource.query(
        `SELECT procedure_order_id FROM procedure_order
         WHERE patient_id = ? AND LOWER(TRIM(patient_instructions)) = ?
           AND date_ordered >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
           AND order_status NOT IN ('rejected', 'cancelled', 'duplicate')
         LIMIT 1`,
        [pid, normalized],
      );
      if (existing.length) {
        this.logger.warn(`Duplicate lab order quarantined: pid=${pid}, test=${testName}`);
        const q = await this.dataSource.query(
          `INSERT INTO procedure_order (patient_id, provider_id, encounter_id, date_ordered,
            order_status, order_priority, patient_instructions, clinical_hx, activity)
           VALUES (?, ?, ?, NOW(), 'duplicate', ?, ?, ?, 1)`,
          [pid, dto.provider_id || 1, dto.encounter_id || 0, dto.order_priority || 'routine',
            dto.patient_instructions || '', dto.clinical_hx || ''],
        );
        await this.notifyDuplicateOrder(pid, testName);
        return { duplicate: true, quarantinedOrderId: q.insertId, existingOrderId: existing[0].procedure_order_id, testName };
      }
    }

    const result = await this.dataSource.query(
      `INSERT INTO procedure_order (patient_id, provider_id, encounter_id, date_ordered,
        order_status, order_priority, patient_instructions, clinical_hx, activity)
       VALUES (?, ?, ?, NOW(), ?, ?, ?, ?, 1)`,
      [pid, dto.provider_id || 1, dto.encounter_id || 0, dto.order_status || 'pending',
        dto.order_priority || 'routine', dto.patient_instructions || '', dto.clinical_hx || ''],
    );

    const orderId = result.insertId;
    this.logger.log(`Lab order created: pid=${pid}, id=${orderId}`);

    // Bill EVERY test in the order (a panel can contain many), not just the panel
    // name, so no ordered lab is missing from the statement. Each test resolves
    // to its own code, so multiple labs on one visit no longer collapse.
    const billedTests: string[] = Array.isArray(dto.tests) && dto.tests.length
      ? dto.tests.map((t: any) => String(t).trim()).filter(Boolean)
      : [testName || dto.patient_instructions || 'Lab test'];
    let holdCode: string | null = null;
    let holdFee = 0;
    for (const t of billedTests) {
      const b = await this.billing.billLabOrder(pid, t, dto.provider_id || 1, orderId).catch(() => null);
      if (b) {
        holdCode = b.code;
        holdFee += Number(b.fee) || 0;
      }
    }

    // Place a billing hold — the technician cannot collect until it is cleared.
    await this.billing.createHold({
      holdType: 'lab', orderId, pid,
      encounterId: dto.encounter_id || 0,
      code: holdCode,
      description: testName || dto.patient_instructions || '',
      fee: holdFee,
    }).catch(() => null);
    return { id: orderId };
  }

  /** Notify that a duplicate lab order was blocked. */
  private async notifyDuplicateOrder(pid: number, testName: string): Promise<void> {
    try {
      const [patient] = await this.dataSource.query(
        `SELECT CONCAT(fname,' ',lname) as name FROM patient_data WHERE pid = ?`, [pid],
      );
      const patientName = patient?.name || `PID ${pid}`;
      // A duplicate can cover dozens of tests — keep the title within VARCHAR(255).
      const listed = String(testName || 'Lab test')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const short =
        listed.length > 3
          ? `${listed.slice(0, 3).join(', ')} +${listed.length - 3} more`
          : listed.join(', ');
      await this.dataSource.query(
        `INSERT INTO pnotes (date, title, body, pid, user, groupname, message_status)
         VALUES (NOW(), ?, ?, ?, 'lab-system', 'Default', 'New')`,
        [
          this.clip(`⚠️ Duplicate Lab Order Blocked: ${short}`),
          this.clip(
            `A duplicate lab order for "${short}" was attempted for ${patientName} within the last hour and was not created.`,
            4000,
          ),
          pid,
        ],
      );
    } catch (err) {
      this.logger.error('Failed to notify duplicate order', err);
    }
  }

  private async notifyDuplicateOrders(pid: number, duplicates: any[]): Promise<void> {
    await this.notifyDuplicateOrder(pid, duplicates.map((d) => d.testName).join(', '));
  }

  private async notifyDuplicateResult(orderId: number, resultCode: string): Promise<void> {
    try {
      const [ord] = await this.dataSource.query(
        `SELECT patient_id FROM procedure_order WHERE procedure_order_id = ?`, [orderId],
      );
      await this.dataSource.query(
        `INSERT INTO pnotes (date, title, body, pid, user, groupname, message_status)
         VALUES (NOW(), ?, ?, ?, 'lab-system', 'Default', 'New')`,
        [
          this.clip(`⚠️ Duplicate Lab Result Blocked: ${resultCode}`),
          this.clip(`A duplicate result for test code "${resultCode}" on order #${orderId} was attempted and was not recorded.`, 4000),
          ord[0]?.patient_id || 0,
        ],
      );
    } catch (err) {
      this.logger.error('Failed to notify duplicate result', err);
    }
  }

  /** Auto-delete quarantined duplicate orders older than 1 hour. */
  private async cleanupExpiredDuplicates(): Promise<void> {
    try {
      await this.dataSource.query(
        `DELETE FROM procedure_order WHERE order_status = 'duplicate' AND date_ordered < DATE_SUB(NOW(), INTERVAL 1 HOUR)`,
      );
    } catch (err) {
      this.logger.error('Failed to cleanup expired duplicates', err);
    }
  }

  // ─── Results ────────────────────────────────────────────────────

  async getResults(orderId: number) {
    const report = await this.dataSource.query(
      `SELECT procedure_report_id as id, LOWER(HEX(uuid)) as uuid,
        procedure_order_id, date_collected, date_report, report_status, review_status, report_notes
      FROM procedure_report WHERE procedure_order_id = ? ORDER BY date_report DESC LIMIT 10`,
      [orderId],
    );
    if (!report.length) return { report: null, results: [] };

    const results = await this.dataSource.query(
      `SELECT procedure_result_id as id, procedure_report_id, result_code, result_text,
        result, units, \`range\`, abnormal, comments, result_status, date
      FROM procedure_result WHERE procedure_report_id = ? ORDER BY result_code`,
      [report[0].id],
    );

    return { report: report[0], results };
  }

  async createResult(orderId: number, dto: any) {
    let report = await this.dataSource.query(
      `SELECT procedure_report_id FROM procedure_report WHERE procedure_order_id = ? LIMIT 1`, [orderId],
    );
    let reportId: number;
    if (!report.length) {
      const r = await this.dataSource.query(
        `INSERT INTO procedure_report (procedure_order_id, date_report, report_status, review_status)
         VALUES (?, NOW(), 'final', 'reviewed')`, [orderId],
      );
      reportId = r.insertId;
    } else {
      reportId = report[0].procedure_report_id;
    }

    // System-wide result dedup: one posted result per test per patient within the window.
    if (dto.result_code) {
      const key = normalizeKey(String(dto.result_code));
      const [ord] = await this.dataSource.query(
        `SELECT patient_id FROM procedure_order WHERE procedure_order_id = ?`, [orderId],
      );
      const patientId = ord[0]?.patient_id;
      if (key && patientId) {
        const existingResult = await this.dataSource.query(
          `SELECT res.procedure_result_id
           FROM procedure_result res
           JOIN procedure_report pr ON pr.procedure_report_id = res.procedure_report_id
           JOIN procedure_order po ON po.procedure_order_id = pr.procedure_order_id
           WHERE po.patient_id = ? AND LOWER(res.result_code) = ? AND res.date >= ${WINDOW_SQL}
           LIMIT 1`,
          [patientId, key],
        );
        if (existingResult.length) {
          this.logger.warn(`Duplicate result skipped for patient ${patientId}: ${dto.result_code}`);
          await this.notifyDuplicateResult(orderId, String(dto.result_code).trim());
          return { duplicate: true, existingId: existingResult[0].procedure_result_id, reportId };
        }
      }
    }

    const result = await this.dataSource.query(
      `INSERT INTO procedure_result (procedure_report_id, result_code, result_text, result, units, \`range\`, abnormal, comments, date, result_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'final')`,
      [reportId, dto.result_code || '', dto.result_text || '', dto.result || '',
       dto.units || '', dto.range || '', dto.abnormal || 'N', dto.comments || ''],
    );

    // Auto-advance order status to completed (from any status except rejected/cancelled)
    await this.dataSource.query(
      `UPDATE procedure_order SET order_status = 'completed'
       WHERE procedure_order_id = ?
       AND order_status NOT IN ('rejected', 'cancelled', 'validated')`,
      [orderId],
    );

    // Send notification to ordering provider
    await this.notifyProvider(orderId);

    return { id: result.insertId, reportId };
  }

  /**
   * Reject edits/deletes of a result that has already been validated and filed
   * in the patient chart. Those are removed only through the admin-authorized
   * path (`authorizedDeleteResult`).
   */
  private assertResultEditable(row: any): void {
    if (row?.order_status === 'validated' || row?.review_status === 'reviewed') {
      throw new ForbiddenException(
        'This result has been validated and filed in the patient chart. ' +
          'Only an administrator with authorization can remove it.',
      );
    }
  }

  /**
   * Update a single existing result. Only the supplied fields are changed so
   * the caller can PATCH just the value or the units without resending all.
   */
  async updateResult(resultId: number, dto: any) {
    const [existing] = await this.dataSource.query(
      `SELECT res.procedure_result_id, pr.review_status, po.order_status
         FROM procedure_result res
         JOIN procedure_report pr ON pr.procedure_report_id = res.procedure_report_id
         JOIN procedure_order po ON po.procedure_order_id = pr.procedure_order_id
        WHERE res.procedure_result_id = ?`,
      [resultId],
    );
    if (!existing) {
      throw new NotFoundException(`Lab result ${resultId} not found`);
    }
    this.assertResultEditable(existing);

    await this.dataSource.query(
      `UPDATE procedure_result
          SET result_code = COALESCE(?, result_code),
              result_text = COALESCE(?, result_text),
              result      = COALESCE(?, result),
              units       = COALESCE(?, units),
              \`range\`     = COALESCE(?, \`range\`),
              abnormal    = COALESCE(?, abnormal),
              comments    = COALESCE(?, comments)
        WHERE procedure_result_id = ?`,
      [
        dto.result_code ?? null,
        dto.result_text ?? null,
        dto.result ?? null,
        dto.units ?? null,
        dto.range ?? null,
        dto.abnormal ?? null,
        dto.comments ?? null,
        resultId,
      ],
    );

    this.logger.log(`Lab result ${resultId} updated`);
    return { id: resultId, updated: true };
  }

  /** Delete a single existing result (not yet validated). */
  async deleteResult(resultId: number) {
    const [existing] = await this.dataSource.query(
      `SELECT res.procedure_result_id, res.procedure_report_id,
              pr.review_status, po.order_status
         FROM procedure_result res
         JOIN procedure_report pr ON pr.procedure_report_id = res.procedure_report_id
         JOIN procedure_order po ON po.procedure_order_id = pr.procedure_order_id
        WHERE res.procedure_result_id = ?`,
      [resultId],
    );
    if (!existing) {
      throw new NotFoundException(`Lab result ${resultId} not found`);
    }
    this.assertResultEditable(existing);

    await this.dataSource.query(
      `DELETE FROM procedure_result WHERE procedure_result_id = ?`,
      [resultId],
    );

    this.logger.log(`Lab result ${resultId} deleted`);
    return { id: resultId, deleted: true, reportId: existing.procedure_report_id };
  }

  /** Map a `users.main_menu_role` value to the application role. */
  private mapMainMenuRole(mainMenuRole: string): string {
    switch (mainMenuRole) {
      case 'standard': return 'physician';
      case 'admin': return 'admin';
      case 'lab_tech': return 'lab_tech';
      case 'front_office': return 'front_desk';
      case 'registered_nurse':
      case 'nurse': return 'nurse';
      case 'midwife': return 'midwife';
      default: return mainMenuRole || 'physician';
    }
  }

  /** Generate a 4-digit code that is not currently active. */
  private async generateActiveCode(): Promise<string> {
    for (let i = 0; i < 10; i++) {
      const code = String(Math.floor(1000 + Math.random() * 9000));
      const [dup] = await this.dataSource.query(
        `SELECT id FROM lab_delete_authorizations
          WHERE code = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()
          LIMIT 1`,
        [code],
      );
      if (!dup) return code;
    }
    // Practically unreachable, but never return a colliding live code.
    return String(Date.now() % 10000).padStart(4, '0');
  }

  /**
   * Admin action: issue a one-time 4-digit deletion code to a lab user or a
   * provider. The admin relays the code (shown in the admin dashboard); the
   * target user then enters it to delete a validated result from the chart.
   */
  async issueDeleteAuthorization(dto: any, admin?: { sub?: number; displayName?: string }) {
    const targetUserId = Number(dto?.targetUserId);
    if (!targetUserId) {
      throw new BadRequestException('Select a user to receive the authorization code.');
    }

    const [target] = await this.dataSource.query(
      `SELECT id, username, fname, lname, main_menu_role FROM users WHERE id = ?`,
      [targetUserId],
    );
    if (!target) {
      throw new NotFoundException(`User ${targetUserId} not found`);
    }

    const targetRole = this.mapMainMenuRole(target.main_menu_role);
    if (!['lab_tech', 'physician'].includes(targetRole)) {
      throw new BadRequestException(
        'Deletion codes can only be issued to laboratory staff or providers.',
      );
    }

    // Clamp to a whole number of minutes. It is interpolated into the INTERVAL
    // clause (never taken verbatim from the request), so it cannot inject.
    const minutes = Math.min(Math.max(Math.floor(Number(dto?.validMinutes) || 60), 5), 1440);
    const code = await this.generateActiveCode();

    const ins = await this.dataSource.query(
      `INSERT INTO lab_delete_authorizations
         (code, issued_by, issued_by_name, target_user_id, target_username, target_role, note, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ${minutes} MINUTE))`,
      [
        code,
        admin?.sub ?? null,
        admin?.displayName ?? null,
        targetUserId,
        target.username ?? null,
        targetRole,
        dto?.note ?? null,
      ],
    );

    const [row] = await this.dataSource.query(
      `SELECT id, code, target_user_id, target_username, target_role, note,
              expires_at, used_at, revoked_at, created_at
         FROM lab_delete_authorizations WHERE id = ?`,
      [ins.insertId],
    );

    this.logger.warn(
      `Lab deletion code ${code} issued to user ${targetUserId} (${targetRole}) by admin ${admin?.sub ?? 'unknown'}`,
    );
    return row;
  }

  /** Admin action: list issued deletion codes, newest first. */
  async listDeleteAuthorizations() {
    return this.dataSource.query(
      `SELECT a.id, a.code, a.issued_by, a.issued_by_name,
              a.target_user_id, a.target_username, a.target_role, a.note,
              a.expires_at, a.used_at, a.used_on_result_id, a.revoked_at, a.created_at,
              CONCAT_WS(' ', u.fname, u.lname) AS target_name,
              u.email AS target_email,
              u.phonecell AS target_phone,
              (a.used_at IS NULL AND a.revoked_at IS NULL AND a.expires_at > NOW()) AS is_active
         FROM lab_delete_authorizations a
         LEFT JOIN users u ON u.id = a.target_user_id
        ORDER BY a.created_at DESC
        LIMIT 100`,
    );
  }

  /** Admin action: revoke an unused deletion code. */
  async revokeDeleteAuthorization(id: number) {
    const [row] = await this.dataSource.query(
      `SELECT id FROM lab_delete_authorizations WHERE id = ?`, [id],
    );
    if (!row) {
      throw new NotFoundException(`Authorization ${id} not found`);
    }
    await this.dataSource.query(
      `UPDATE lab_delete_authorizations SET revoked_at = NOW()
        WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL`,
      [id],
    );
    return { id, revoked: true };
  }

  /**
   * Delete a lab result that is already filed in the patient chart (validated
   * order / reviewed report).
   *
   * Authorization is either a one-time code an admin issued to *this* user
   * (lab user or provider), or the static master code (OPENEMR__LAB_DELETE_CODE)
   * which only administrators may use.
   *
   * If the deleted result was the last one on a validated order, the order is
   * reverted to `completed` so the chart no longer shows a validated lab with
   * no data behind it.
   */
  async authorizedDeleteResult(resultId: number, code: string, userId?: number, role?: string) {
    const supplied = String(code ?? '').trim();
    if (!/^\d{4}$/.test(supplied)) {
      throw new BadRequestException('Enter the 4-digit administrator authorization code.');
    }

    // 1) A live, unused code issued by an admin to a specific user.
    const [auth] = await this.dataSource.query(
      `SELECT id, target_user_id, target_role
         FROM lab_delete_authorizations
        WHERE code = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()
        ORDER BY id DESC LIMIT 1`,
      [supplied],
    );

    let authorizedVia: string;
    if (auth) {
      const isTarget = Number(auth.target_user_id) === Number(userId);
      if (!isTarget && role !== 'admin') {
        throw new ForbiddenException('This authorization code was issued to another user.');
      }
      authorizedVia = isTarget ? 'issued-code' : 'admin-override';
    } else {
      // 2) Static master code — administrators only.
      const master = String(
        this.config.get<string>('OPENEMR__LAB_DELETE_CODE') || '1234',
      ).trim();
      if (supplied !== master) {
        throw new ForbiddenException('Invalid or expired authorization code.');
      }
      if (role !== 'admin') {
        throw new ForbiddenException(
          'Only an administrator can use the master code. Ask an administrator to issue you a deletion code.',
        );
      }
      authorizedVia = 'master-code';
    }

    const [row] = await this.dataSource.query(
      `SELECT res.procedure_result_id AS id,
              res.result_code, res.result, res.units,
              pr.procedure_report_id AS reportId,
              pr.review_status,
              po.procedure_order_id AS orderId,
              po.patient_id AS patientId,
              po.order_status
         FROM procedure_result res
         JOIN procedure_report pr ON pr.procedure_report_id = res.procedure_report_id
         JOIN procedure_order po ON po.procedure_order_id = pr.procedure_order_id
        WHERE res.procedure_result_id = ?`,
      [resultId],
    );
    if (!row) {
      throw new NotFoundException(`Lab result ${resultId} not found`);
    }

    await this.dataSource.query(
      `DELETE FROM procedure_result WHERE procedure_result_id = ?`,
      [resultId],
    );

    // Consume the one-time issued code so it cannot be reused.
    if (auth) {
      try {
        await this.dataSource.query(
          `UPDATE lab_delete_authorizations
              SET used_at = NOW(), used_on_result_id = ?
            WHERE id = ? AND used_at IS NULL`,
          [resultId, auth.id],
        );
      } catch {
        // non-fatal — the deletion already happened
      }
    }

    // If that was the last result, don't leave a validated order with no data.
    let reverted = false;
    try {
      const [{ remaining }] = await this.dataSource.query(
        `SELECT COUNT(*) AS remaining
           FROM procedure_result res
           JOIN procedure_report pr ON pr.procedure_report_id = res.procedure_report_id
          WHERE pr.procedure_order_id = ?`,
        [row.orderId],
      );
      if (Number(remaining) === 0 && row.order_status === 'validated') {
        await this.dataSource.query(
          `UPDATE procedure_order SET order_status = 'completed' WHERE procedure_order_id = ?`,
          [row.orderId],
        );
        reverted = true;

        // The lab is gone — reverse its charge so the statement shows a refund.
        const hold = await this.billing.getHold('lab', row.orderId).catch(() => null);
        await this.billing
          .refundLabOrder(
            row.patientId,
            hold?.description || row.result_text || 'Lab',
            Number(hold?.fee) || 0,
            'Validated lab removed',
            row.orderId,
          )
          .catch(() => null);
      }
    } catch {
      // non-fatal — the result has already been removed
    }

    // Best-effort audit trail (table is owned by the lab reports module and may
    // not exist on older installs — never block the deletion on audit failure).
    try {
      await this.dataSource.query(
        `INSERT INTO lab_result_audit
           (user_id, patient_id, lab_order_id, report_id, action, previous_value, new_value)
         VALUES (?, ?, ?, ?, 'DELETE', ?, ?)`,
        [
          userId ?? null,
          row.patientId ?? null,
          row.orderId ?? null,
          row.reportId ?? null,
          JSON.stringify({ result_code: row.result_code, result: row.result, units: row.units }),
          JSON.stringify({
            deleted: true,
            order_status: row.order_status,
            review_status: row.review_status,
            order_reverted: reverted,
            authorized_by: userId ?? null,
            authorization: authorizedVia,
          }),
        ],
      );
    } catch {
      // ignore — the result has already been removed
    }

    this.logger.warn(
      `Lab result ${resultId} (order ${row.orderId}, status ${row.order_status}) ` +
        `deleted via ${authorizedVia} by user ${userId ?? 'unknown'} (${role ?? 'unknown'})` +
        (reverted ? '; order reverted to completed' : ''),
    );
    return {
      id: resultId,
      deleted: true,
      orderId: row.orderId,
      patientId: row.patientId,
      reverted,
      authorizedVia,
    };
  }

  /**
   * Enter multiple results at once (test name → value) for an order.
   * Used by the lab management dashboard's result form.
   */
  async createOrderResults(orderId: number, results: Record<string, string>) {
    const entries = Object.entries(results || {}).filter(
      ([, value]) => value !== undefined && value !== null && String(value).trim() !== '',
    );
    if (!entries.length) {
      return { created: 0, orderId };
    }

    let report = await this.dataSource.query(
      `SELECT procedure_report_id FROM procedure_report WHERE procedure_order_id = ? LIMIT 1`,
      [orderId],
    );
    let reportId: number;
    if (!report.length) {
      const r = await this.dataSource.query(
        `INSERT INTO procedure_report (procedure_order_id, date_report, report_status, review_status)
         VALUES (?, NOW(), 'final', 'reviewed')`,
        [orderId],
      );
      reportId = r.insertId;
    } else {
      reportId = report[0].procedure_report_id;
    }

    const ids: number[] = [];
    for (const [code, value] of entries) {
      const res = await this.dataSource.query(
        `INSERT INTO procedure_result (procedure_report_id, result_code, result_text, result, units, \`range\`, abnormal, comments, date, result_status)
         VALUES (?, ?, '', ?, '', '', 'N', '', NOW(), 'final')`,
        [reportId, String(code).trim(), String(value).trim()],
      );
      ids.push(res.insertId);
    }

    // Auto-advance order status to completed.
    await this.dataSource.query(
      `UPDATE procedure_order SET order_status = 'completed'
       WHERE procedure_order_id = ?
       AND order_status NOT IN ('rejected', 'cancelled', 'validated')`,
      [orderId],
    );

    await this.notifyProvider(orderId);

    return { id: ids[0], reportId, count: ids.length, orderId };
  }

  /**
   * Quick standalone result entry from the lab technician dashboard.
   * Records the flagged result as a system note so it is visible to providers.
   */
  async createQuickResult(dto: any) {
    const flag = dto.flag || 'normal';
    const icon = flag === 'critical' ? '🚨' : flag === 'abnormal' ? '⚠️' : '✅';
    const title = `${icon} Lab Result: ${dto.test_name || 'Test'}`;
    const body = [
      `Patient: ${dto.patient_name || 'Unknown'}`,
      `Test: ${dto.test_name || '—'}`,
      `Value: ${dto.result_value ?? ''} ${dto.unit || ''}`.trim(),
      `Flag: ${flag}`,
      `Specimen: ${dto.specimen_id || '—'}`,
    ].join('\n');

    await this.dataSource.query(
      `INSERT INTO pnotes (date, title, body, pid, user, groupname, message_status)
       VALUES (NOW(), ?, ?, 0, 'lab-system', 'Default', 'New')`,
      [this.clip(title), this.clip(body, 4000)],
    );

    return { success: true, testName: dto.test_name, flag };
  }

  /** Refer an order to an outside laboratory. */
  async referOrder(orderId: number, dto: { outside_lab?: string; notes?: string }) {
    const [order] = await this.dataSource.query(
      `SELECT patient_id, patient_instructions FROM procedure_order WHERE procedure_order_id = ?`,
      [orderId],
    );
    if (!order) {
      throw new Error('Order not found');
    }

    await this.dataSource.query(
      `UPDATE procedure_order SET order_status = 'referred' WHERE procedure_order_id = ?`,
      [orderId],
    );

    const lab = dto.outside_lab || 'Outside Laboratory';
    await this.dataSource.query(
      `INSERT INTO pnotes (date, title, body, pid, user, groupname, message_status)
       VALUES (NOW(), ?, ?, ?, 'lab-system', 'Default', 'New')`,
      [
        this.clip(`🔬 Lab Referred Out: ${order.patient_instructions || 'Lab Test'}`),
        this.clip(`Referred to ${lab}.${dto.notes ? ` Notes: ${dto.notes}` : ''}`, 4000),
        order.patient_id,
      ],
    );

    return { orderId, status: 'referred', outsideLab: lab };
  }

  /** Recent results across all orders — powers critical/abnormal/TAT dashboard KPIs. */
  async getRecentResults(limit = 20) {
    return this.dataSource.query(
      `SELECT res.procedure_result_id as id, res.procedure_report_id,
         res.result_code, res.result_text, res.result, res.units, res.abnormal,
         res.date as result_date,
         pr.date_report, pr.date_collected,
         po.patient_id, CONCAT(pd.fname,' ',pd.lname) as patient_name, pd.pid as patient_pid,
         po.patient_instructions as test_name, po.order_priority, po.date_ordered as date
       FROM procedure_result res
       JOIN procedure_report pr ON pr.procedure_report_id = res.procedure_report_id
       JOIN procedure_order po ON po.procedure_order_id = pr.procedure_order_id
       JOIN patient_data pd ON po.patient_id = pd.pid
       ORDER BY res.date DESC
       LIMIT ?`,
      [limit],
    );
  }

  /**
   * Notify the responsible provider that results are ready.
   * Goes to the ordering provider, falling back to the patient's assigned
   * provider (`patient_data.providerID`) when no ordering provider is set.
   */
  private async notifyProvider(orderId: number): Promise<void> {
    try {
      const order = await this.dataSource.query(
        `SELECT po.provider_id, po.patient_id, po.patient_instructions,
                CONCAT(pd.fname,' ',pd.lname) as patientName
         FROM procedure_order po
         JOIN patient_data pd ON po.patient_id = pd.pid
         WHERE po.procedure_order_id = ?`,
        [orderId],
      );
      if (!order.length) return;

      const { patient_id, patientName, patient_instructions, provider_id } = order[0];
      const { providerId } = await this.resolveTargetProvider(patient_id, provider_id);
      if (!providerId) {
        this.logger.warn(`No provider to notify for order ${orderId} (patient ${patient_id})`);
        return;
      }

      const testName = patient_instructions || 'Lab Test';
      const title = this.clip(`🔬 Lab Results Ready: ${patientName} — ${testName}`);
      const body = this.clip(
        `Results for "${testName}" are now available for ${patientName}.\nOrder #${orderId} has been completed. Please review the results in the Lab Management page.`,
        4000,
      );

      // NOTE: `pid` must be the real patient pid — writing 0 here produced
      // notifications that no longer resolved to a patient, so the dashboard
      // "View" action navigated to /patients/0 and the chart failed to load.
      const patientPid = Number(patient_id) > 0 ? Number(patient_id) : 0;
      await this.dataSource.query(
        `INSERT INTO pnotes (date, title, body, pid, user, groupname, assigned_to, message_status)
         VALUES (NOW(), ?, ?, ?, 'lab-system', 'Default', ?, 'New')`,
        [title, body, patientPid, String(providerId)],
      );

      this.logger.log(`Notification sent to provider ${providerId} for order ${orderId}`);
    } catch (err) {
      this.logger.error(`Failed to notify provider for order ${orderId}:`, err);
    }
  }

  // ─── All Orders with Workflow Status ────────────────────────────

  async getAllOrders(): Promise<LabOrderWithStatus[]> {
    const rows = await this.dataSource.query(
      `SELECT po.procedure_order_id as id, po.patient_id as patientId,
        CONCAT(pd.fname,' ',pd.lname) as patientName,
        pd.pid as patientPid, pd.id as chartId, po.encounter_id as encounterId,
        po.date_ordered as dateOrdered, po.order_status as orderStatus,
        po.order_priority as orderPriority,
        po.patient_instructions as instructions, po.clinical_hx as clinicalHx,
        po.provider_id as providerId, po.specimen_id as specimenId,
        (SELECT COUNT(*) FROM procedure_result res
          JOIN procedure_report pr ON pr.procedure_report_id = res.procedure_report_id
          WHERE pr.procedure_order_id = po.procedure_order_id) as resultCount
      FROM procedure_order po
      JOIN patient_data pd ON po.patient_id = pd.pid
      ORDER BY po.date_ordered DESC LIMIT 100`,
    );

    const pids: number[] = Array.from(new Set((rows as any[]).map((r: any) => Number(r.patientPid) || 0))) as number[];
    const balances = await this.billing.getPatientBalances(pids);

    const orders = rows.map((r: any) => {
      const bal = balances[r.patientPid] || { charges: 0, paid: 0, balance: 0 };
      return {
        ...this.enrichOrder(r),
        patient_charges_usd: bal.charges,
        patient_paid_usd: bal.paid,
        patient_balance_usd: bal.balance,
        paid: bal.charges > 0 && bal.balance <= 0,
      };
    });
    return this.attachHolds(orders);
  }

  // ─── Group validation (per patient, one shot) ───────────────────

  /** Order statuses that are still "in play" and therefore part of a group to validate. */
  private static readonly OPEN_STATUSES = ['pending', 'collected', 'processing', 'completed'];

  /**
   * Build the preview of a patient's lab group: every order that is still open,
   * with its results, plus the provider the notification would be sent to.
   * Orders with no results are reported separately so the UI can explain why
   * they cannot be validated yet.
   */
  async getValidationPreview(pid: number) {
    const [patient] = await this.dataSource.query(
      `SELECT pid, fname, lname, DOB, sex, providerID,
              CONCAT(COALESCE(fname,''),' ',COALESCE(lname,'')) AS patientName
       FROM patient_data WHERE pid = ? LIMIT 1`,
      [pid],
    );
    if (!patient) {
      throw new NotFoundException(`Patient ${pid} not found`);
    }

    const orders = await this.dataSource.query(
      `SELECT po.procedure_order_id AS id, po.order_status AS orderStatus,
              po.order_priority AS orderPriority, po.provider_id AS providerId,
              po.patient_instructions AS instructions, po.date_ordered AS dateOrdered,
              po.specimen_id AS specimenId,
              (SELECT COUNT(*) FROM procedure_result res
                 JOIN procedure_report pr ON pr.procedure_report_id = res.procedure_report_id
                 WHERE pr.procedure_order_id = po.procedure_order_id) AS resultCount
       FROM procedure_order po
       WHERE po.patient_id = ?
         AND po.order_status IN (${LabsService.OPEN_STATUSES.map(() => '?').join(', ')})
       ORDER BY po.date_ordered ASC, po.procedure_order_id ASC`,
      [pid, ...LabsService.OPEN_STATUSES],
    );

    const ready: any[] = [];
    const withoutResults: any[] = [];

    for (const o of orders) {
      const resultCount = Number(o.resultCount) || 0;
      if (resultCount === 0) {
        withoutResults.push({ ...o, resultCount });
        continue;
      }
      const { results } = await this.getResults(o.id);
      const rows = (results || []) as any[];
      ready.push({
        ...o,
        resultCount,
        results: rows,
        criticalCount: rows.filter(
          (r) => r.abnormal === 'Y' || /critical/i.test(String(r.result_status || '')),
        ).length,
      });
    }

    const primaryProvider =
      ready.find((o) => o.providerId)?.providerId ??
      orders.find((o: any) => o.providerId)?.providerId ??
      null;
    const target = await this.resolveTargetProvider(pid, primaryProvider);

    return {
      patient: {
        pid: patient.pid,
        patientName: String(patient.patientName || '').trim() || `PID ${pid}`,
        DOB: patient.DOB ?? null,
        sex: patient.sex ?? null,
        assignedProviderId: patient.providerID ? Number(patient.providerID) : null,
      },
      orders: ready,
      withoutResults,
      totalOrders: orders.length,
      readyOrders: ready.length,
      resultCount: ready.reduce((n, o) => n + o.resultCount, 0),
      criticalCount: ready.reduce((n, o) => n + o.criticalCount, 0),
      provider: target.providerId,
      providerSource: target.source,
    };
  }

  /**
   * Validate every ready order in a patient's lab group in a single action,
   * mark the reports final/reviewed so they appear in the patient chart, and
   * send ONE "results ready" notification to the responsible provider.
   */
  async validatePatientGroup(
    pid: number,
    userId?: number,
    dto?: { providerId?: number | string | null },
  ) {
    const preview = await this.getValidationPreview(pid);

    if (preview.readyOrders === 0) {
      return {
        validated: 0,
        orderIds: [],
        provider: preview.provider,
        providerSource: preview.providerSource,
        reason:
          preview.totalOrders > 0
            ? "The patient's open orders have no results recorded yet."
            : 'No open lab orders for this patient.',
      };
    }

    const orderIds = preview.orders.map((o: any) => Number(o.id));

    await this.dataSource.query(
      `UPDATE procedure_order SET order_status = 'validated' WHERE procedure_order_id IN (?)`,
      [orderIds],
    );

    // Make the results chart-visible: a final, reviewed report.
    await this.dataSource.query(
      `UPDATE procedure_report
          SET report_status = 'final', review_status = 'reviewed'
        WHERE procedure_order_id IN (?)`,
      [orderIds],
    );

    const override = dto?.providerId ? Number(dto.providerId) : null;
    const providerId = override || preview.provider;

    let notified = false;
    if (providerId) {
      notified = await this.notifyLabGroupReady(pid, preview, providerId);
    }

    await this.dataSource
      .query(
        `INSERT INTO lab_result_audit (user_id, patient_id, lab_order_id, report_id, action, previous_value, new_value)
         VALUES (?, ?, NULL, NULL, 'GROUP_VALIDATE', ?, ?)`,
        [
          userId ?? null,
          pid,
          LabsService.OPEN_STATUSES.join(','),
          JSON.stringify({ orderIds, providerId, resultCount: preview.resultCount }),
        ],
      )
      .catch(() => null);

    this.logger.log(
      `Patient ${pid}: validated ${orderIds.length} order(s) as a group by user ${userId ?? 'system'}`,
    );

    return {
      validated: orderIds.length,
      orderIds,
      resultCount: preview.resultCount,
      criticalCount: preview.criticalCount,
      provider: providerId,
      providerSource: override ? 'manual' : preview.providerSource,
      notified,
      validatedBy: userId ?? null,
      validatedAt: new Date().toISOString(),
    };
  }

  /**
   * One notification for a whole validated group. Uses a bounded title so the
   * VARCHAR(255) `pnotes.title` column can never overflow.
   */
  private async notifyLabGroupReady(pid: number, preview: any, providerId: number): Promise<boolean> {
    try {
      const patientName = preview.patient?.patientName || `PID ${pid}`;
      const count = preview.readyOrders;
      const title = this.clip(
        `🔬 Lab Results Ready: ${patientName} — ${count} order${count === 1 ? '' : 's'}, ${preview.resultCount} result${preview.resultCount === 1 ? '' : 's'}`,
      );

      const lines: string[] = [
        `${preview.resultCount} result(s) across ${count} order(s) are ready for review for ${patientName}.`,
        '',
        ...(preview.orders || []).map(
          (o: any) =>
            `• ${o.instructions || `Order #${o.id}`} (order #${o.id}) — ${o.resultCount} result(s)` +
            (o.criticalCount ? ` · ⚠️ ${o.criticalCount} critical/abnormal` : ''),
        ),
      ];

      if (preview.criticalCount > 0) {
        lines.push('', `⚠️ ${preview.criticalCount} critical/abnormal result(s) require prompt review.`);
      }
      lines.push(
        '',
        `Routed to: ${preview.providerSource === 'assigned' ? "the patient's assigned provider" : 'the ordering provider'}.`,
        'View in: Patient chart (Lab Results), or Lab Management → Results.',
      );

      await this.dataSource.query(
        `INSERT INTO pnotes (date, title, body, pid, user, groupname, assigned_to, message_status)
         VALUES (NOW(), ?, ?, ?, 'lab-system', 'Default', ?, 'New')`,
        [title, this.clip(lines.join('\n'), 4000), pid, String(providerId)],
      );

      this.logger.log(`Group lab notification sent to provider ${providerId} for patient ${pid}`);
      return true;
    } catch (err) {
      this.logger.error(`Failed to notify provider ${providerId} of group results for patient ${pid}`, err);
      return false;
    }
  }

  // ─── Provider Lab Notifications (dashboard) ─────────────────────

  /**
   * Lab alerts for a provider: the "results ready" notes (with unread state)
   * plus the validated orders behind them. Matches patients where the provider
   * ordered the lab or is the patient's currently-assigned provider.
   */
  async getProviderLabNotifications(providerId: number) {
    const notifications = await this.dataSource.query(
      `SELECT p.id, p.date, p.title, p.body, p.pid, p.message_status AS messageStatus,
              pd.id  AS patientId,
              pd.pid AS patientPid,
              CONCAT(COALESCE(pd.fname,''),' ',COALESCE(pd.lname,'')) AS patientName
       FROM pnotes p
       LEFT JOIN patient_data pd ON pd.pid = p.pid
       WHERE p.assigned_to = ? AND p.title LIKE '🔬%'
       ORDER BY p.date DESC
       LIMIT 25`,
      [String(providerId)],
    );

    const readyOrders = await this.dataSource.query(
      `SELECT po.procedure_order_id AS id, po.patient_id AS patientPid,
              pd.id AS patientId,
              CONCAT(COALESCE(pd.fname,''),' ',COALESCE(pd.lname,'')) AS patientName,
              po.patient_instructions AS instructions, po.order_status AS orderStatus,
              po.date_ordered AS dateOrdered, po.provider_id AS providerId,
              (SELECT COUNT(*) FROM procedure_result res
                 JOIN procedure_report pr ON pr.procedure_report_id = res.procedure_report_id
                 WHERE pr.procedure_order_id = po.procedure_order_id) AS resultCount
       FROM procedure_order po
       JOIN patient_data pd ON po.patient_id = pd.pid
       WHERE po.order_status = 'validated'
         AND (po.provider_id = ? OR pd.providerID = ?)
       ORDER BY po.date_ordered DESC
       LIMIT 50`,
      [providerId, providerId],
    );

    const unreadCount = (notifications as any[]).filter(
      (n) => String(n.messageStatus || '').toLowerCase() !== 'done',
    ).length;

    return { unreadCount, notifications, readyOrders };
  }

  /** Mark a lab notification as read/acknowledged. */
  async ackProviderLabNotification(notificationId: number) {
    await this.dataSource.query(
      `UPDATE pnotes SET message_status = 'Done' WHERE id = ?`,
      [notificationId],
    );
    return { id: notificationId, status: 'Done' };
  }

  // ─── Patient Chart: Lab Results ─────────────────────────────────

  /**
   * Patient-scoped lab results for the chart. Individual test rows (not the
   * whole ordered panel), newest first, with value, units, range, abnormal
   * flag and status so the chart can render a proper result table.
   */
  async getPatientLabResults(pid: number, limit = 100) {
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
    return this.dataSource.query(
      `SELECT res.procedure_result_id AS id,
              res.result_code,
              res.result_text,
              COALESCE(NULLIF(res.result_text, ''), res.result_code) AS test_name,
              res.result,
              res.units,
              res.\`range\` AS ref_range,
              res.abnormal,
              res.comments,
              res.result_status,
              res.date AS result_date,
              po.procedure_order_id AS orderId,
              po.order_status,
              po.patient_instructions AS order_instructions,
              po.date_ordered,
              pr.review_status
       FROM procedure_result res
       JOIN procedure_report pr ON pr.procedure_report_id = res.procedure_report_id
       JOIN procedure_order po ON po.procedure_order_id = pr.procedure_order_id
       WHERE po.patient_id = ?
       ORDER BY res.date DESC, res.procedure_result_id DESC
       LIMIT ?`,
      [pid, safeLimit],
    );
  }

  // ─── Provider's Lab Orders (for provider dashboard) ─────────────

  async getProviderLabOrders(providerId: number): Promise<LabOrderWithStatus[]> {
    return this.attachHolds(await this.getProviderLabOrdersRaw(providerId));
  }

  private async getProviderLabOrdersRaw(providerId: number): Promise<LabOrderWithStatus[]> {
    const rows = await this.dataSource.query(
      `SELECT po.procedure_order_id as id, po.patient_id as patientId,
        CONCAT(pd.fname,' ',pd.lname) as patientName,
        pd.pid as patientPid, pd.id as chartId, po.encounter_id as encounterId,
        po.date_ordered as dateOrdered, po.order_status as orderStatus,
        po.order_priority as orderPriority,
        po.patient_instructions as instructions, po.clinical_hx as clinicalHx,
        po.provider_id as providerId, po.specimen_id as specimenId,
        (SELECT COUNT(*) FROM procedure_result res
          JOIN procedure_report pr ON pr.procedure_report_id = res.procedure_report_id
          WHERE pr.procedure_order_id = po.procedure_order_id) as resultCount
      FROM procedure_order po
      JOIN patient_data pd ON po.patient_id = pd.pid
      WHERE po.provider_id = ?
      ORDER BY po.date_ordered DESC LIMIT 50`,
      [providerId],
    );

    return rows.map((r: any) => this.enrichOrder(r));
  }

  // ─── Status Workflow ────────────────────────────────────────────

  async updateOrderStatus(orderId: number, newStatus: string) {
    if (!STATUS_FLOW[newStatus]) {
      throw new Error(`Invalid status: ${newStatus}`);
    }

    // Billing hold gate: the technician cannot begin processing a held order.
    if (newStatus === 'collected' || newStatus === 'processing') {
      const cleared = await this.billing.isCleared('lab', orderId);
      if (!cleared) {
        throw new BadRequestException(
          'Billing hold: this lab order cannot proceed until the bill is cleared by the billing desk.',
        );
      }
    }

    // Auto-generate specimen ID when specimen is collected
    if (newStatus === 'collected') {
      const now = new Date();
      const specimenId = `SPEC-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(orderId).padStart(4,'0')}`;
      await this.dataSource.query(
        `UPDATE procedure_order SET order_status = ?, specimen_id = ? WHERE procedure_order_id = ?`,
        [newStatus, specimenId, orderId],
      );
      this.logger.log(`Order ${orderId}: status → collected, specimen ID: ${specimenId}`);
    } else {
      await this.dataSource.query(
        `UPDATE procedure_order SET order_status = ? WHERE procedure_order_id = ?`,
        [newStatus, orderId],
      );
    }

    // If cancelled/rejected, refund the charge, deactivate billing and release
    // the hold. The refund is a negative line so the statement shows the credit.
    if (newStatus === 'rejected' || newStatus === 'cancelled') {
      const hold = await this.billing.getHold('lab', orderId).catch(() => null);
      const [ord] = await this.dataSource.query(
        `SELECT patient_id, patient_instructions FROM procedure_order WHERE procedure_order_id = ?`,
        [orderId],
      );
      if (ord) {
        await this.billing
          .refundLabOrder(
            ord.patient_id,
            hold?.description || ord.patient_instructions || 'Lab',
            Number(hold?.fee) || 0,
            `Lab order ${newStatus}`,
            orderId,
          )
          .catch(() => null);
      }
      await this.pauseBillingForOrder(orderId);
      await this.billing.cancelHold('lab', orderId).catch(() => null);
    }

    // If collecting, also update the report
    if (newStatus === 'collected') {
      await this.dataSource.query(
        `INSERT INTO procedure_report (procedure_order_id, date_collected, report_status, review_status)
         VALUES (?, NOW(), 'prelim', 'pending')
         ON DUPLICATE KEY UPDATE date_collected = NOW()`,
        [orderId],
      );
    }

    this.logger.log(`Lab order ${orderId} status: ${newStatus}`);
    return { orderId, status: newStatus, ...STATUS_FLOW[newStatus] };
  }

  /**
   * Validation algorithm: an order can only be marked "validated" when it has
   * at least one posted result. Critical results are flagged for review.
   */
  async validateOrder(orderId: number, userId?: number) {
    const [order] = await this.dataSource.query(
      `SELECT procedure_order_id, order_status, patient_id FROM procedure_order WHERE procedure_order_id = ?`,
      [orderId],
    );
    if (!order) {
      return { validated: false, reason: 'Order not found' };
    }

    const { results } = await this.getResults(orderId);
    const resultCount = results?.length || 0;
    const criticalCount = (results || []).filter(
      (r: any) => r.abnormal === 'Y' || /critical|positive/i.test(String(r.result_status || '')),
    ).length;

    if (resultCount === 0) {
      return {
        validated: false,
        orderId,
        resultCount,
        criticalCount,
        reason: 'No results recorded — enter results before validating.',
      };
    }

    await this.dataSource.query(
      `UPDATE procedure_order SET order_status = 'validated' WHERE procedure_order_id = ?`,
      [orderId],
    );

    this.logger.log(`Order ${orderId} validated by user ${userId || 'system'}`);

    return {
      validated: true,
      orderId,
      resultCount,
      criticalCount,
      validatedBy: userId || null,
      validatedAt: new Date().toISOString(),
      rules: {
        requiresResults: true,
        flagsCritical: criticalCount > 0,
      },
    };
  }

  private async pauseBillingForOrder(orderId: number): Promise<void> {
    try {
      const orders = await this.dataSource.query(
        `SELECT po.patient_id, po.encounter_id, po.patient_instructions,
                CONCAT(pd.fname,' ',pd.lname) as patientName, pd.pid
         FROM procedure_order po JOIN patient_data pd ON po.patient_id = pd.pid
         WHERE po.procedure_order_id = ?`, [orderId],
      );
      if (!orders.length) return;
      const o = orders[0];
      if (o.encounter_id) {
        await this.dataSource.query(
          `UPDATE billing SET activity = 0 WHERE encounter = ? AND pid = ? AND code_type = 'CPT4'`,
          [o.encounter_id, o.pid],
        );
      }
      const title = this.clip(`🚫 Lab Cancelled: ${o.patientName} — ${o.patient_instructions || 'Lab Test'}`);
      const body = `Lab order #${orderId} for ${o.patientName} (PID ${o.pid}) has been cancelled. Charges deactivated.`;
      await this.dataSource.query(
        `INSERT INTO pnotes (date, title, body, pid, user, groupname, assigned_to, message_status)
         VALUES (NOW(), ?, ?, ?, 'lab-system', 'Default', 'billing', 'New')`,
        [title, body, o.pid],
      );
      this.logger.log(`Billing paused + notified for cancelled order ${orderId}`);
    } catch (err) {
      this.logger.error(`Failed to pause billing for order ${orderId}:`, err);
    }
  }

  // ─── Billing: Lab types with billing codes ──────────────────────

  async getLabBillingInfo() {
    return Object.entries(LAB_BILLING_CODES).map(([name, info]) => ({
      labType: name,
      cptCode: info.code,
      description: info.description,
      standardFee: info.fee,
    }));
  }

  // ─── Helpers ────────────────────────────────────────────────────

  private enrichOrder(r: any): LabOrderWithStatus {
    const status = r.orderStatus || 'pending';
    const flow = STATUS_FLOW[status] || STATUS_FLOW.pending;
    const hasResults = Number(r.resultCount) > 0;

    // Build workflow steps
    const steps: WorkflowStep[] = Object.entries(STATUS_FLOW)
      .filter(([k]) => k !== 'rejected' && k !== 'referred')
      .map(([k, v]) => ({
        status: k,
        label: v.label,
        color: v.color,
        completed: this.isStatusCompleted(k, status),
        active: k === status,
        eta: v.eta,
      }));

    // Find billing code from instructions
    let billingCode: string | null = null;
    let billingDesc: string | null = null;
    let billingFee: number | null = null;

    const instructions = (r.instructions || '').toLowerCase();
    for (const [name, info] of Object.entries(LAB_BILLING_CODES)) {
      if (instructions.includes(name.toLowerCase())) {
        billingCode = info.code;
        billingDesc = info.description;
        billingFee = info.fee;
        break;
      }
    }

    return {
      id: r.id,
      patientId: r.patientId,
      patientName: r.patientName,
      patientPid: r.patientPid,
      chartId: r.chartId ?? null,
      encounterId: r.encounterId,
      dateOrdered: r.dateOrdered,
      orderStatus: status,
      orderPriority: r.orderPriority || 'routine',
      instructions: r.instructions || '',
      clinicalHx: r.clinicalHx || '',
      providerId: r.providerId,
      specimenId: r.specimenId || null,
      statusLabel: flow.label,
      statusColor: flow.color,
      nextStatus: flow.next,
      estimatedTime: flow.eta,
      billingCode,
      billingDesc,
      billingFee,
      hasResults,
      steps,
    };
  }

  private isStatusCompleted(stepStatus: string, currentStatus: string): boolean {
    const order = ['pending', 'collected', 'processing', 'completed', 'validated'];
    const stepIdx = order.indexOf(stepStatus);
    const currentIdx = order.indexOf(currentStatus);
    if (currentIdx === -1) return false;
    return stepIdx < currentIdx;
  }
}
