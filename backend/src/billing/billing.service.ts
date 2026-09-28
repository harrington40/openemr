import { Injectable, Logger, OnModuleInit, BadRequestException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { assignOneToOne } from './billing-integrity.util';
import { resolveVisitCategoryId } from '../common/calendar-categories.util';

export interface BillingPatient {
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
  insuranceType?: string;
  patientPercent?: number;
  insuranceBalance: number;
  patientBalance: number;
  lastPayment: string | null;
  billingStatus: BillingStatus;
  statusLabel: string;
  statusColor: string;
  hasActiveEncounter: boolean;
  daysSinceLastEncounter: number | null;
  claimCount: number;
  pendingClaimCount: number;
}

export type BillingStatus =
  | 'cleared'           // All paid, ready for discharge
  | 'active_billing'    // Has charges, payments in progress
  | 'pending_claims'    // Insurance claims submitted, awaiting
  | 'overdue'           // Balance > 30 days unpaid
  | 'no_encounter'      // Patient exists but no encounter
  | 'discharged'        // Discharged, all cleared
  | 'discharged_balance'; // Discharged but still owes

export interface FinancialClearance {
  pid: number;
  patientName: string;
  insuranceType?: string;
  patientPercent?: number;
  totalCharges: number;
  totalPayments: number;
  balance: number;
  /** Overpayment sitting on the account (refundable). */
  credit?: number;
  insuranceCovered: number;
  patientObligation: number;
  patientPaid: number;
  remainingPatientBalance: number;
  /** Cents absorbed by the small-balance rule so `remainingPatientBalance` is 0. */
  smallBalanceWrittenOff?: number;
  claimsSubmitted: number;
  claimsPaid: number;
  claimsPending: number;
  canDischarge: boolean;
  blockers: string[];
  items: ClearanceItem[];
}

export interface ClearanceItem {
  category: string;
  description: string;
  amount: number;
  paid: number;
  status: 'paid' | 'pending' | 'unpaid' | 'insurance_pending';
  icon: string;
}

/**
 * `billing.code_text` is NULL on this schema, so a charge rendered straight from
 * the row shows nothing but a bare CPT/HCPCS code — which is why the encounter
 * breakdown read like "#56 · 85025 · HCPCS". This catalog supplies a real name
 * and a category for every code the fork writes, so a line can say
 * "Complete blood count (CBC) with differential — Laboratory test".
 *
 * Codes not listed here fall back to `code_text`, then to a prettified code.
 */
const CHARGE_CATALOG: Record<string, { name: string; category: string }> = {
  // Internal facility codes written by this fork (see billTriageIntake).
  REG: { name: 'Patient registration', category: 'Administrative' },
  TRIAGE: { name: 'Triage / intake assessment', category: 'Nursing' },
  VITALS: { name: 'Vital signs recording', category: 'Nursing' },
  ROOM: { name: 'Examination room use', category: 'Facility' },
  // Laboratory tests.
  '80048': { name: 'Basic metabolic panel', category: 'Laboratory' },
  '80053': { name: 'Comprehensive metabolic panel', category: 'Laboratory' },
  '81001': { name: 'Urinalysis, automated with microscopy', category: 'Laboratory' },
  '81025': { name: 'Urine pregnancy test', category: 'Laboratory' },
  '82947': { name: 'Glucose, quantitative (fasting blood sugar)', category: 'Laboratory' },
  '83036': { name: 'Hemoglobin A1c', category: 'Laboratory' },
  '84443': { name: 'Thyroid stimulating hormone (TSH)', category: 'Laboratory' },
  '85025': { name: 'Complete blood count (CBC) with differential', category: 'Laboratory' },
  '87086': { name: 'Urine culture, quantitative colony count', category: 'Laboratory' },
  // Imaging studies.
  '72100': { name: 'X-ray, spine, lumbosacral', category: 'Imaging' },
  '76770': { name: 'Ultrasound, retroperitoneal (renal), complete', category: 'Imaging' },
  // Consultation / evaluation.
  '99213': { name: 'Office visit, established patient, 15 minutes', category: 'Consultation' },
};

/** Medication / consumable names for the RX- codes the pharmacy writes. */
const RX_CATALOG: Record<string, string> = {
  'RX-TMP-SMX-800-160MG': 'Trimethoprim / Sulfamethoxazole 800/160 mg',
  'RX-IV-CANNULA-22G': 'IV cannula, 22 gauge',
  'RX-IV-CANNULA-18G': 'IV cannula, 18 gauge',
  'RX-IBUPROFEN-600MG': 'Ibuprofen 600 mg',
  'RX-LISINOPRIL-10MG': 'Lisinopril 10 mg',
};

/** `RX-IV-CANNULA-22G` -> "IV cannula 22G" when there is no explicit name. */
function prettifyRxCode(code: string): string {
  const parts = code.replace(/^RX-/, '').split('-').filter(Boolean);
  if (!parts.length) return code;
  return parts
    .map((p, i) => (i === 0 ? p : p.length <= 3 ? p : p.charAt(0) + p.slice(1).toLowerCase()))
    .join(' ');
}

/**
 * Human name + category for a billing line. The category is what lets the
 * breakdown say "Laboratory test" instead of making the reader decode a code.
 */
function describeCharge(
  code: string | null,
  codeType: string | null,
  codeText: string | null,
): { name: string; category: string; isLab: boolean } {
  const c = String(code || '').trim();
  const known = CHARGE_CATALOG[c.toUpperCase()];
  if (known) return { ...known, isLab: known.category === 'Laboratory' || known.category === 'Imaging' };

  if (/^RX-/i.test(c)) {
    return {
      name: RX_CATALOG[c.toUpperCase()] || prettifyRxCode(c),
      category: /CANNULA|SYRINGE|GLOVE|GAUZE/i.test(c) ? 'Consumable' : 'Medication',
      isLab: false,
    };
  }

  // Lab charges this fork writes for tests with no catalogue CPT code.
  if (/^LAB-/i.test(c)) {
    const name = c
      .replace(/^LAB-/i, '')
      .split(/[-_]+/)
      .filter(Boolean)
      .map((p, i) => (i === 0 || p.length > 3 ? p.charAt(0) + p.slice(1).toLowerCase() : p))
      .join(' ');
    return { name, category: 'Laboratory', isLab: true };
  }
  // Reversals posted when a lab is removed — a refund, not a charge.
  if (/^REFUND/i.test(c)) {
    const name = c
      .replace(/^REFUND-?/i, '')
      .split(/[-_]+/)
      .filter(Boolean)
      .map((p, i) => (i === 0 || p.length > 3 ? p.charAt(0) + p.slice(1).toLowerCase() : p))
      .join(' ');
    return { name: `Refund — ${name || 'charge'}`, category: 'Refund', isLab: false };
  }

  const text = String(codeText || '').trim();
  if (text) {
    const lab = /lab|blood|urine|culture|panel|count|glucose|hba1c|thyroid/i.test(text);
    return { name: text, category: lab ? 'Laboratory' : (codeType || 'Charge'), isLab: lab };
  }

  // Dashed all-caps mnemonics (e.g. MALARIA-SMEAR-M-S) read better spaced out.
  if (/^[A-Z0-9]+(?:[-_][A-Z0-9]+)+$/.test(c)) {
    const name = c
      .split(/[-_]+/)
      .filter(Boolean)
      .map((p, i) => (i === 0 || p.length > 3 ? p.charAt(0) + p.slice(1).toLowerCase() : p))
      .join(' ');
    const lab = /malaria|smear|hiv|tb|typhoid|hepatitis|widal|stool|sputum|rapid/i.test(c);
    return { name, category: lab ? 'Laboratory' : (codeType || 'Charge'), isLab: lab };
  }

  return {
    name: `${codeType ? `${codeType} ` : ''}code ${c || 'unknown'}`,
    category: 'Uncategorized',
    isLab: false,
  };
}

/**
 * A short, human title for an encounter. `form_encounter.reason` is meaningful
 * for real visits ("Routine Visit") but the fork also auto-creates placeholder
 * rows ("Auto-created encounter for billing"), which tell a reader nothing — so
 * those fall back to the dominant category of the charges on the visit.
 */
function describeEncounter(reason: string | null, categories: string[]): string {
  const r = String(reason || '').trim();
  const placeholder = !r || /auto-?created|for billing|^n\/?a$/i.test(r);
  if (!placeholder) return r;

  const has = (c: string) => categories.includes(c);
  if (has('Laboratory') && !has('Consultation') && !has('Imaging')) return 'Laboratory visit';
  if (has('Imaging') && !has('Consultation')) return 'Imaging visit';
  if (has('Consultation')) return 'Consultation visit';
  if (has('Nursing') || has('Administrative')) return 'Intake / triage visit';
  if (has('Medication') || has('Consumable')) return 'Pharmacy / medication only';
  if (has('Facility')) return 'Facility charge';
  return 'Visit (no description recorded)';
}

/**
 * The single most meaningful category on a visit, used for the type badge.
 * Visits usually mix a clinical charge with facility/consumable items, and the
 * first line is not necessarily the interesting one.
 */
const CATEGORY_PRIORITY = [
  'Laboratory',
  'Imaging',
  'Consultation',
  'Nursing',
  'Administrative',
  'Medication',
  'Consumable',
  'Facility',
];

function dominantCategory(categories: string[]): string {
  for (const c of CATEGORY_PRIORITY) if (categories.includes(c)) return c;
  return categories[0] || 'Uncategorized';
}

/**
 * Group charge lines by category so a statement reads as "Laboratory", then
 * "Medication", etc., instead of one undifferentiated list. Refunds are kept
 * last and carry their negative amount in the subtotal.
 */
const GROUP_ORDER = [
  'Laboratory', 'Imaging', 'Consultation', 'Nursing',
  'Medication', 'Consumable', 'Facility', 'Administrative', 'Refund',
];

function groupLinesByCategory(lines: any[]): { category: string; subtotal: number; lines: any[] }[] {
  const map: Record<string, any[]> = {};
  for (const l of lines || []) {
    const key = String(l?.category || 'Uncategorized');
    (map[key] ||= []).push(l);
  }
  return Object.entries(map)
    .sort((a, b) => {
      const ai = GROUP_ORDER.indexOf(a[0]);
      const bi = GROUP_ORDER.indexOf(b[0]);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    })
    .map(([category, ls]) => ({
      category,
      subtotal: ls.reduce((s, l) => s + (Number(l?.amount) || 0), 0),
      lines: ls,
    }));
}


@Injectable()
export class BillingService implements OnModuleInit {
  private readonly logger = new Logger(BillingService.name);

  // ─── Liberia Configuration ──────────────────────────────────────
  private readonly EXCHANGE_RATE_USD_TO_LRD = 193;
  private readonly HOSPITAL_NAME = 'Ma Juan Memorial Hospital Clinic';
  private readonly HOSPITAL_LOCATION = 'Monrovia, Liberia';
  private readonly CURRENCY = 'LRD';
  private readonly ROOM_AND_BOARD_PER_NIGHT_USD = 150;

  /**
   * Cash is collected in whole LRD notes, so a bill of $309.14 is handed over as
   * L$59,637 (=$309.00) and a few cents are left behind. Those cents used to sit
   * on the account forever and surface as a nonsense balance (e.g. L$27 for 14
   * cents). Any balance at or below this amount (USD) is treated as settled and
   * written off as an explicit rounding adjustment. Set
   * `billing_settings.small_balance_writeoff_usd` to 0 to disable.
   */
  private readonly SMALL_BALANCE_WRITE_OFF_USD = 1;

  private usdToLrd(usd: number): number {
    return Math.round(usd * this.EXCHANGE_RATE_USD_TO_LRD);
  }

  /** Money helper — keeps cents. `Math.round()` on dollars is what lost them. */
  private round2(usd: number): number {
    return Math.round((Number(usd) || 0) * 100) / 100;
  }

  /** Effective small-balance write-off threshold in USD; 0 disables the rule. */
  private async getSmallBalanceWriteOff(): Promise<number> {
    try {
      const [row] = await this.dataSource.query(
        `SELECT setting_value FROM billing_settings WHERE setting_key = 'small_balance_writeoff_usd'`,
      );
      if (row?.setting_value !== undefined && row?.setting_value !== null && row.setting_value !== '') {
        const value = Number(row.setting_value);
        if (Number.isFinite(value) && value >= 0) return value;
      }
    } catch { /* settings table missing → use the compiled default */ }
    return this.SMALL_BALANCE_WRITE_OFF_USD;
  }

  private formatLrd(amount: number): string {
    return `L$${amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  }

  constructor(@InjectDataSource() private dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    await this.ensurePriceCatalogSchema();
    await this.ensureBillingSettingsSchema();
    await this.ensureBillingHoldSchema();
    await this.ensureEncounterBillingSchema();
    await this.loadHospitalTimezone();
    await this.backfillHolds();
  }

  /** Some deployments lack the encounter column on ar_activity; make it tolerant. */
  private async ensureEncounterBillingSchema(): Promise<void> {
    try {
      await this.dataSource.query(
        `ALTER TABLE ar_activity ADD COLUMN encounter INT(11) NOT NULL DEFAULT 0`,
      );
      this.logger.log('Added encounter column to ar_activity');
    } catch { /* column already exists */ }

    // Link a billing line to the lab order / prescription it came from so a
    // charge is 1:1 with its order (and reconciliation can find missing ones).
    try {
      await this.dataSource.query(`ALTER TABLE billing ADD COLUMN order_id INT NULL`);
      this.logger.log('Added order_id column to billing');
    } catch { /* column already exists */ }

    // Which charge line a REFUND reverses. Matching on refund *codes* proved far
    // too fragile for money (codes get truncated and hand-shortened: "RFD-MALARIA-M-S"
    // never prefix-matched "MALARIA-SMEAR-M-S", so an already-refunded line looked
    // like a fresh duplicate and would have been refunded a second time).
    try {
      await this.dataSource.query(`ALTER TABLE billing ADD COLUMN reverses_id INT NULL`);
      this.logger.log('Added reverses_id column to billing');
    } catch { /* column already exists */ }
    try {
      await this.dataSource.query(`ALTER TABLE billing ADD INDEX idx_billing_reverses (reverses_id)`);
    } catch { /* index already exists */ }
    try {
      await this.dataSource.query(`ALTER TABLE billing ADD INDEX idx_billing_order (order_id)`);
    } catch { /* index already exists */ }

    // Link each transaction to its exact payment (ar_activity has no id, so we
    // store "<encounter>-<sequence_no>" to guarantee a 1:1 join).
    try {
      await this.dataSource.query(
        `ALTER TABLE transactions ADD COLUMN payment_ref VARCHAR(40) NULL`,
      );
    } catch { /* column already exists */ }
    // Backfill legacy payment transactions where the match is unambiguous.
    try {
      await this.dataSource.query(
        `UPDATE transactions t
         JOIN ar_activity a ON a.pid = t.pid AND a.code = 'PAYMENT'
           AND ABS(TIMESTAMPDIFF(SECOND, a.post_time, t.date)) <= 2
         SET t.payment_ref = CONCAT(a.encounter, '-', a.sequence_no)
         WHERE t.payment_ref IS NULL AND t.title LIKE 'Payment:%'
           AND (SELECT COUNT(*) FROM ar_activity a2
                WHERE a2.pid = t.pid AND a2.code = 'PAYMENT'
                  AND ABS(TIMESTAMPDIFF(SECOND, a2.post_time, t.date)) <= 2) = 1`,
      );
    } catch { /* ignore */ }

    // Patient insurance coverage: 'self_pay' (patient owes the full bill) or
    // 'insured' (split; patient_responsibility_percent is the patient share).
    try {
      await this.dataSource.query(
        `ALTER TABLE patient_data ADD COLUMN insurance_type VARCHAR(20) NOT NULL DEFAULT 'self_pay'`,
      );
    } catch { /* column already exists */ }
    try {
      await this.dataSource.query(
        `ALTER TABLE patient_data ADD COLUMN patient_responsibility_percent INT NOT NULL DEFAULT 100`,
      );
    } catch { /* column already exists */ }
    // Existing patients default to self-pay (100% patient responsibility).
    try {
      await this.dataSource.query(
        `UPDATE patient_data SET patient_responsibility_percent = 100
         WHERE insurance_type <> 'insured' AND (patient_responsibility_percent = 0)`,
      );
    } catch { /* ignore */ }

    // Every encounter must carry a usable encounter number (fall back to its id).
    try {
      await this.dataSource.query(
        `UPDATE form_encounter SET encounter = id WHERE encounter IS NULL OR encounter = 0`,
      );
    } catch { /* ignore */ }

    // For any patient that has charges but no encounter at all, create one so
    // their charges can be linked (removes the "Unassigned" bucket entirely).
    try {
      const orphanPids: any[] = await this.dataSource.query(
        `SELECT DISTINCT b.pid FROM billing b
         WHERE b.activity = 1 AND (b.encounter IS NULL OR b.encounter = 0)
           AND NOT EXISTS (SELECT 1 FROM form_encounter fe WHERE fe.pid = b.pid)`,
      );
      for (const o of orphanPids) {
        await this.latestEncounter(Number(o.pid));
      }
      if (orphanPids.length) {
        this.logger.log(`Created encounters for ${orphanPids.length} patient(s) with orphaned charges`);
      }
    } catch (e) {
      this.logger.warn(`Orphan encounter creation skipped: ${(e as Error).message}`);
    }

    // Bind orphaned charges/payments to the patient's latest encounter so they
    // no longer appear under the "Unassigned (no encounter)" bucket.
    try {
      const res1: any = await this.dataSource.query(
        `UPDATE billing b
         JOIN (SELECT pid, MAX(COALESCE(encounter, id)) AS enc FROM form_encounter GROUP BY pid) m
           ON m.pid = b.pid
         SET b.encounter = m.enc
         WHERE b.activity = 1 AND (b.encounter IS NULL OR b.encounter = 0)`,
      );
      const res2: any = await this.dataSource.query(
        `UPDATE ar_activity a
         JOIN (SELECT pid, MAX(COALESCE(encounter, id)) AS enc FROM form_encounter GROUP BY pid) m
           ON m.pid = a.pid
         SET a.encounter = m.enc
         WHERE a.encounter IS NULL OR a.encounter = 0`,
      );
      const n = (res1?.affectedRows || 0) + (res2?.affectedRows || 0);
      if (n > 0) this.logger.log(`Linked ${n} orphaned billing row(s) to their encounter`);
    } catch (e) {
      this.logger.warn(`Encounter backfill skipped: ${(e as Error).message}`);
    }
  }

  // ─── Billing Holds (lab orders + prescriptions) ──────────────────
  /**
   * A billing hold is placed on a lab order or prescription at creation time.
   * The lab technician / pharmacist cannot proceed (collect specimen / dispense)
   * until the hold is CLEARED by billing (front desk / billing / admin).
   */
  private async ensureBillingHoldSchema(): Promise<void> {
    await this.dataSource.query(
      `CREATE TABLE IF NOT EXISTS billing_holds (
        id INT AUTO_INCREMENT PRIMARY KEY,
        hold_type VARCHAR(20) NOT NULL,
        order_id INT NOT NULL,
        pid INT NOT NULL,
        encounter_id INT NULL,
        code VARCHAR(40) NULL,
        description VARCHAR(160) NULL,
        fee DECIMAL(10,2) NOT NULL DEFAULT 0,
        status VARCHAR(20) NOT NULL DEFAULT 'hold',
        cleared_by VARCHAR(120) NULL,
        cleared_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_hold_order (hold_type, order_id),
        INDEX idx_hold_pid (pid),
        INDEX idx_hold_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    );
    this.logger.log('Billing holds schema ready');
  }

  /** Best-effort fee/code estimate for an un-billed lab test (no billing insert). */
  private async estimateLabFee(testName: string): Promise<{ code: string; fee: number }> {
    const mapped = this.LAB_CPT_MAP[testName];
    if (mapped) return { code: mapped.code, fee: mapped.fee };
    const [cat] = await this.dataSource.query(
      `SELECT code, fee FROM price_catalog
       WHERE category = 'lab' AND LOWER(description) LIKE ? AND active = 1 LIMIT 1`,
      [`%${String(testName || '').toLowerCase()}%`],
    );
    return { code: cat?.code || '80048', fee: cat ? Number(cat.fee) || 20 : 20 };
  }

  /** Best-effort fee/code estimate for a prescription (no billing insert). */
  private async estimateRxFee(drug: string): Promise<{ code: string; fee: number }> {
    const code = this.billingCode('RX-', drug);
    const [cat] = await this.dataSource.query(
      `SELECT fee FROM price_catalog
       WHERE category = 'pharmacy' AND (code = ? OR LOWER(description) LIKE ?) AND active = 1 LIMIT 1`,
      [code, `%${String(drug || '').toLowerCase()}%`],
    );
    return { code, fee: cat ? Number(cat.fee) || 10 : 10 };
  }

  /**
   * Ensure every open lab order / active prescription has a billing hold, so
   * orders created before the hold feature also gate on billing clearance.
   * Orders whose account is already settled are left unheld.
   */
  private async backfillHolds(): Promise<void> {
    try {
      const openLabs: any[] = await this.dataSource.query(
        `SELECT po.procedure_order_id AS id, po.patient_id AS pid, po.encounter_id AS enc,
                po.patient_instructions AS testName
         FROM procedure_order po
         WHERE po.activity = 1
           AND po.order_status NOT IN ('completed','validated','rejected','cancelled','duplicate')
           AND NOT EXISTS (SELECT 1 FROM billing_holds h
                           WHERE h.hold_type = 'lab' AND h.order_id = po.procedure_order_id)
         LIMIT 1000`,
      );
      const openRx: any[] = await this.dataSource.query(
        `SELECT p.id, p.patient_id AS pid, p.drug
         FROM prescriptions p
         WHERE p.active = 1
           AND NOT EXISTS (SELECT 1 FROM billing_holds h
                           WHERE h.hold_type = 'pharmacy' AND h.order_id = p.id)
         LIMIT 1000`,
      );

      const pids = Array.from(new Set([
        ...openLabs.map((o) => Number(o.pid)),
        ...openRx.map((r) => Number(r.pid)),
      ])).filter(Boolean);
      const balances = pids.length ? await this.getPatientBalances(pids) : {};
      const settled = (pid: number) => {
        const b = balances[pid] || { charges: 0, paid: 0, balance: 0 };
        return b.charges > 0 && b.balance <= 0; // fully paid → no hold
      };

      let labCount = 0;
      for (const o of openLabs) {
        if (settled(Number(o.pid))) continue;
        const { code, fee } = await this.estimateLabFee(o.testName);
        await this.createHold({
          holdType: 'lab', orderId: Number(o.id), pid: Number(o.pid),
          encounterId: o.enc != null ? Number(o.enc) : null,
          code, description: o.testName || '', fee,
        });
        labCount++;
      }

      let rxCount = 0;
      for (const r of openRx) {
        if (settled(Number(r.pid))) continue;
        const { code, fee } = await this.estimateRxFee(r.drug);
        await this.createHold({
          holdType: 'pharmacy', orderId: Number(r.id), pid: Number(r.pid),
          code, description: r.drug || '', fee,
        });
        rxCount++;
      }

      if (labCount || rxCount) {
        this.logger.log(`Backfilled billing holds: ${labCount} lab, ${rxCount} pharmacy`);
      }
    } catch (e) {
      this.logger.warn(`Hold backfill skipped: ${(e as Error).message}`);
    }
  }

  /** Place (or refresh) a billing hold for a lab order or prescription. */
  async createHold(dto: {
    holdType: 'lab' | 'pharmacy';
    orderId: number;
    pid: number;
    encounterId?: number | null;
    code?: string | null;
    description?: string | null;
    fee?: number;
  }): Promise<any> {
    await this.dataSource.query(
      `INSERT INTO billing_holds (hold_type, order_id, pid, encounter_id, code, description, fee, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'hold')
       ON DUPLICATE KEY UPDATE code = VALUES(code), description = VALUES(description),
         fee = VALUES(fee), encounter_id = VALUES(encounter_id)`,
      [dto.holdType, dto.orderId, dto.pid, dto.encounterId ?? null,
       dto.code || null, dto.description || null, Number(dto.fee) || 0],
    );
    return this.getHold(dto.holdType, dto.orderId);
  }

  async getHold(holdType: string, orderId: number): Promise<any | null> {
    const [row] = await this.dataSource.query(
      `SELECT * FROM billing_holds WHERE hold_type = ? AND order_id = ? LIMIT 1`,
      [holdType, orderId],
    );
    return row || null;
  }

  async getHoldById(id: number): Promise<any | null> {
    const [row] = await this.dataSource.query(`SELECT * FROM billing_holds WHERE id = ? LIMIT 1`, [id]);
    return row || null;
  }

  /** True when the order has no hold or the hold has been cleared. */
  async isCleared(holdType: string, orderId: number): Promise<boolean> {
    const hold = await this.getHold(holdType, orderId);
    if (!hold) return true;
    return hold.status === 'cleared';
  }

  /** Batch hold map for list endpoints (keyed by order id). */
  async getHoldMap(holdType: string, orderIds: number[]): Promise<Record<number, any>> {
    const map: Record<number, any> = {};
    if (!orderIds.length) return map;
    const ph = orderIds.map(() => '?').join(',');
    const rows = await this.dataSource.query(
      `SELECT * FROM billing_holds WHERE hold_type = ? AND order_id IN (${ph})`,
      [holdType, ...orderIds],
    );
    for (const r of rows) map[Number(r.order_id)] = r;
    return map;
  }

  async clearHold(id: number, clearedBy?: string): Promise<any> {
    await this.dataSource.query(
      `UPDATE billing_holds SET status = 'cleared', cleared_by = ?, cleared_at = NOW() WHERE id = ?`,
      [clearedBy || 'billing', id],
    );
    return this.getHoldById(id);
  }

  async clearHoldForOrder(holdType: string, orderId: number, clearedBy?: string): Promise<any> {
    await this.dataSource.query(
      `UPDATE billing_holds SET status = 'cleared', cleared_by = ?, cleared_at = NOW()
       WHERE hold_type = ? AND order_id = ?`,
      [clearedBy || 'billing', holdType, orderId],
    );
    return this.getHold(holdType, orderId);
  }

  async cancelHold(holdType: string, orderId: number): Promise<void> {
    await this.dataSource.query(
      `UPDATE billing_holds SET status = 'cancelled' WHERE hold_type = ? AND order_id = ?`,
      [holdType, orderId],
    );
  }

  /** Clear every pending hold for a patient in one action. */
  async clearHoldsForPatient(pid: number, clearedBy?: string): Promise<any> {
    const res: any = await this.dataSource.query(
      `UPDATE billing_holds SET status = 'cleared', cleared_by = ?, cleared_at = NOW()
       WHERE pid = ? AND status = 'hold'`,
      [clearedBy || 'billing', pid],
    );
    return { pid, cleared: res?.affectedRows || 0 };
  }

  /** Pending / filtered holds for the billing dashboard. */
  async listHolds(status?: string): Promise<any[]> {
    return this.dataSource.query(
      `SELECT bh.*, CONCAT(COALESCE(pd.fname,''), ' ', COALESCE(pd.lname,'')) AS patient_name
       FROM billing_holds bh
       LEFT JOIN patient_data pd ON pd.pid = bh.pid
       ${status ? 'WHERE bh.status = ?' : ''}
       ORDER BY bh.created_at DESC LIMIT 200`,
      status ? [status] : [],
    );
  }

  /** Encounter-based billing breakdown for a single patient. */
  async getPatientEncounterBreakdown(pid: number): Promise<any> {
    const encounters = await this.dataSource.query(
      `SELECT COALESCE(fe.encounter, fe.id) AS encounterId, fe.date, fe.date_end AS dateEnd,
              fe.reason, fe.discharge_disposition AS disposition
       FROM form_encounter fe WHERE fe.pid = ? ORDER BY fe.date DESC LIMIT 100`,
      [pid],
    );

    const lines = await this.dataSource.query(
      `SELECT encounter, code_type AS codeType, code, COALESCE(MAX(code_text),'') AS description,
              SUM(fee) AS fee, COUNT(*) AS qty, MAX(order_id) AS orderId
       FROM billing WHERE pid = ? AND activity = 1
       GROUP BY encounter, code_type, code
       ORDER BY encounter DESC`,
      [pid],
    );

    const payments = await this.dataSource.query(
      `SELECT encounter, COALESCE(SUM(pay_amount),0) AS paid, COALESCE(SUM(adj_amount),0) AS adj
       FROM ar_activity WHERE pid = ? AND deleted IS NULL GROUP BY encounter`,
      [pid],
    );
    const paidMap: Record<string, number> = {};
    const adjMap: Record<string, number> = {};
    for (const p of payments) {
      paidMap[String(p.encounter)] = Number(p.paid) || 0;
      adjMap[String(p.encounter)] = Number(p.adj) || 0;
    }

    const holds = await this.dataSource.query(
      `SELECT * FROM billing_holds WHERE pid = ? ORDER BY created_at DESC`,
      [pid],
    );
    const holdsByEnc: Record<string, any[]> = {};
    for (const h of holds) (holdsByEnc[String(h.encounter_id ?? '0')] ||= []).push(h);

    const byEnc: Record<string, any[]> = {};
    for (const l of lines) {
      (byEnc[String(l.encounter)] ||= []).push({
        codeType: l.codeType, code: l.code,
        description: l.description || '',
        amount: Number(l.fee) || 0, qty: Number(l.qty) || 0,
        orderId: l.orderId ?? null,
      });
    }

    // Lab orders are the other half of a lab charge: the billing row only carries
    // the CPT code, so pull the ordered tests in and match them back to the
    // charge. `procedure_order.encounter_id` is 0 on this data, so the link is
    // made by matching the ordered test name to the code's catalogue name, and
    // the encounter link is inferred from the order date when it is not stored.
    const labOrders = await this.dataSource.query(
      `SELECT po.procedure_order_id   AS orderId,
              po.encounter_id         AS encounterId,
              po.order_status         AS status,
              po.order_priority       AS priority,
              po.date_ordered         AS dateOrdered,
              po.date_collected       AS dateCollected,
              COALESCE(NULLIF(TRIM(po.patient_instructions), ''), 'Lab test') AS testName
         FROM procedure_order po
        WHERE po.patient_id = ? AND po.activity = 1
        ORDER BY po.date_ordered DESC`,
      [pid],
    );

    /** Significant lowercase words, for fuzzy charge <-> lab-order matching. */
    const keywords = (s: string): string[] =>
      String(s || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2 && !['test', 'panel', 'with', 'and', 'the'].includes(w));

    const describeLines = (rows: any[], refDate?: any): any[] =>
      rows.map((l: any) => {
        const info = describeCharge(l.code, l.codeType, l.description);
        const words = keywords(info.name);

        // Lab order that shares a significant word with the charge name. When the
        // visit date is known, prefer the order raised closest to that date so the
        // charge is tied to the right episode rather than to a later repeat.
        const ref = refDate ? new Date(refDate).getTime() : null;
        // Precise link when the charge recorded its order_id; otherwise fall back
        // to the best keyword match closest to the visit date.
        const byId = l.orderId != null
          ? (labOrders as any[]).find((o) => Number(o.orderId) === Number(l.orderId))
          : null;
        const match = byId || (labOrders as any[])
          .filter((o) => {
            const t = String(o.testName || '').toLowerCase();
            return words.some((w) => t.includes(w));
          })
          .sort((a, b) => {
            const at = new Date(a.dateOrdered || 0).getTime();
            const bt = new Date(b.dateOrdered || 0).getTime();
            if (ref == null) return at - bt;
            return Math.abs(at - ref) - Math.abs(bt - ref);
          })
          .shift();

        // A dashed mnemonic code with no catalogue entry ("MALARIA-SMEAR-M-S")
        // describes itself poorly, so when it matched a lab order we use the
        // ordered test name instead and treat it as laboratory work.
        const isMnemonic = /^[A-Z0-9]+(?:[-_][A-Z0-9]+)+$/.test(String(l.code || ''));
        const uncatalogued = !CHARGE_CATALOG[String(l.code || '').toUpperCase()];
        const useLabName = !!byId || (!!match && isMnemonic && uncatalogued);

        return {
          code: l.code,
          codeType: l.codeType,
          description: useLabName && match ? match.testName : info.name,
          category: useLabName ? 'Laboratory' : info.category,
          isLab: info.isLab || useLabName,
          amount: Number(l.amount) || 0,
          qty: Number(l.qty) || 0,
          labOrder: match
            ? { orderId: match.orderId, testName: match.testName, status: match.status }
            : null,
        };
      });

    let grandCharges = 0;
    let grandPaid = 0;
    const result = encounters.map((e: any) => {
      const k = String(e.encounterId);
      const lines = describeLines(byEnc[k] || [], e.date);
      const charges = lines.reduce((s, l) => s + l.amount, 0);
      const paid = paidMap[k] || 0;
      const adjustments = adjMap[k] || 0;
      grandCharges += charges;
      grandPaid += paid;
      const encHolds = holdsByEnc[k] || [];

      const categories = Array.from(new Set(lines.map((l: any) => l.category)));
      // Tests actually billed on this visit — the authoritative list for the row.
      const billedLabTests = Array.from(
        new Set(lines.filter((l: any) => l.isLab).map((l: any) => l.description)),
      );

      // Lab orders we can tie to this visit: the stored encounter link when set,
      // otherwise (only for visits that really have lab charges) orders raised
      // the same day. `procedure_order.encounter_id` is 0 on this data, so the
      // date link is a heuristic and the UI labels it as such.
      const sameDay = (a: any, b: any) =>
        !!a && !!b && new Date(a).toDateString() === new Date(b).toDateString();
      let encLabs = (labOrders as any[]).filter(
        (o) => Number(o.encounterId) === Number(e.encounterId) && Number(o.encounterId) > 0,
      );
      let labLink: 'encounter' | 'date' | null = encLabs.length ? 'encounter' : null;
      if (!encLabs.length && billedLabTests.length) {
        encLabs = (labOrders as any[]).filter((o) => sameDay(o.dateOrdered, e.date));
        if (encLabs.length) labLink = 'date';
      }

      return {
        encounterId: e.encounterId,
        date: e.date,
        dateEnd: e.dateEnd,
        reason: e.reason,
        disposition: e.disposition,
        // Human title + dominant charge type, so the row never shows a bare "#56".
        label: describeEncounter(e.reason, categories),
        categories,
        type: lines.length ? dominantCategory(categories) : 'No charges',
        charges,
        paid,
        adjustments,
        balance: Math.max(0, charges - paid - adjustments),
        lines,
        groups: groupLinesByCategory(lines),
        labOrders: encLabs.map((o: any) => ({
          orderId: o.orderId,
          testName: o.testName,
          status: o.status,
          priority: o.priority,
          dateOrdered: o.dateOrdered,
          dateCollected: o.dateCollected,
        })),
        labTests: billedLabTests.length ? billedLabTests : encLabs.map((o: any) => o.testName),
        labLink,
        holds: encHolds,
        pendingHolds: encHolds.filter((h: any) => h.status === 'hold').length,
      };
    });

    // Charges with no encounter row of their own (encounter = 0 or missing) —
    // registration, intake and pharmacy items are posted this way.
    const encIds = new Set(result.map((r: any) => String(r.encounterId)));
    const orphanLines = (lines as any[]).filter((l: any) => !encIds.has(String(l.encounter)));
    const orphanCharges = orphanLines.reduce((s: number, l: any) => s + (Number(l.fee) || 0), 0);
    if (orphanCharges > 0) {
      const orphanPaid = paidMap['0'] || paidMap['null'] || 0;
      const described = describeLines(orphanLines);
      const orphanCategories = Array.from(new Set(described.map((l: any) => l.category)));
      grandCharges += orphanCharges;
      grandPaid += orphanPaid;
      result.push({
        encounterId: 0,
        date: null,
        dateEnd: null,
        reason: 'Not linked to a visit',
        // A real explanation instead of the old bare "Unassigned": these are
        // charges posted directly against the patient (registration, intake,
        // medication) rather than against a visit.
        label: 'Not linked to a visit',
        description:
          'Charges recorded directly against the patient instead of a visit — typically registration, triage/intake or pharmacy items posted on their own.',
        categories: orphanCategories,
        type: dominantCategory(orphanCategories),
        charges: orphanCharges,
        paid: orphanPaid,
        adjustments: adjMap['0'] || 0,
        balance: Math.max(0, orphanCharges - orphanPaid - (adjMap['0'] || 0)),
        lines: described,
        groups: groupLinesByCategory(described),
        labOrders: [],
        labTests: [],
        labLink: null,
        holds: holdsByEnc['0'] || [],
        pendingHolds: (holdsByEnc['0'] || []).filter((h: any) => h.status === 'hold').length,
      });
    }

    const pendingHolds = holds.filter((h: any) => h.status === 'hold');
    return {
      pid,
      encounters: result,
      totals: {
        charges: grandCharges,
        paid: grandPaid,
        balance: Math.max(0, grandCharges - grandPaid),
      },
      labOrders: (labOrders as any[]).map((o: any) => ({
        orderId: o.orderId,
        testName: o.testName,
        status: o.status,
        dateOrdered: o.dateOrdered,
      })),
      pendingHolds: pendingHolds.length,
      holdsPending: pendingHolds,
    };
  }

  private async ensureBillingSettingsSchema(): Promise<void> {
    await this.dataSource.query(
      `CREATE TABLE IF NOT EXISTS billing_settings (
         setting_key VARCHAR(50) PRIMARY KEY,
         setting_value VARCHAR(255) NOT NULL
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8`,
    );
    await this.dataSource.query(
      `INSERT IGNORE INTO billing_settings (setting_key, setting_value) VALUES
         ('currency', 'LRD'), ('exchange_rate_usd_lrd', '193'),
         ('small_balance_writeoff_usd', '1'),
         ('integrity_scan_enabled', '1'), ('integrity_scan_hour', '2'),
         ('integrity_auto_fix', '0'),
         ('hospital_timezone_offset', '+00:00')`,
    );
  }

  async getBillingSettings(): Promise<any> {
    const rows = await this.dataSource.query(`SELECT setting_key, setting_value FROM billing_settings`);
    const map: Record<string, string> = {};
    for (const r of rows) map[r.setting_key] = r.setting_value;
    return {
      currency: map.currency || 'LRD',
      exchangeRate: Number(map.exchange_rate_usd_lrd) || 193,
      smallBalanceWriteOff:
        map.small_balance_writeoff_usd !== undefined && map.small_balance_writeoff_usd !== ''
          ? Number(map.small_balance_writeoff_usd)
          : this.SMALL_BALANCE_WRITE_OFF_USD,
      // Calendar dates in reports are derived in this zone, not the server's.
      hospitalTimezone: map.hospital_timezone_offset || this.hospitalTz,
    };
  }

  /** Load the reporting timezone once at boot (used by date-based reporting). */
  private async loadHospitalTimezone(): Promise<void> {
    try {
      const [row] = await this.dataSource.query(
        `SELECT setting_value FROM billing_settings WHERE setting_key = 'hospital_timezone_offset'`,
      );
      const value = String(row?.setting_value || '').trim();
      if (/^[+-]\d{2}:\d{2}$/.test(value) || /^[A-Za-z]+\/[A-Za-z_]+$/.test(value)) {
        this.hospitalTz = value;
      }
    } catch { /* keep the default */ }
  }

  async setBillingSettings(dto: any): Promise<any> {
    if (dto.currency) {
      await this.dataSource.query(
        `INSERT INTO billing_settings (setting_key, setting_value) VALUES ('currency', ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [dto.currency],
      );
    }
    if (dto.exchangeRate !== undefined) {
      await this.dataSource.query(
        `INSERT INTO billing_settings (setting_key, setting_value) VALUES ('exchange_rate_usd_lrd', ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [String(dto.exchangeRate)],
      );
    }
    if (dto.smallBalanceWriteOff !== undefined) {
      await this.dataSource.query(
        `INSERT INTO billing_settings (setting_key, setting_value) VALUES ('small_balance_writeoff_usd', ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [String(dto.smallBalanceWriteOff)],
      );
    }
    if (dto.hospitalTimezone !== undefined) {
      await this.dataSource.query(
        `INSERT INTO billing_settings (setting_key, setting_value) VALUES ('hospital_timezone_offset', ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [String(dto.hospitalTimezone)],
      );
      this.hospitalTz = String(dto.hospitalTimezone);
    }
    return this.getBillingSettings();
  }

  // ─── Price Catalog (admin + billing editable charge list) ─────────

  private async ensurePriceCatalogSchema(): Promise<void> {
    await this.dataSource.query(
      `CREATE TABLE IF NOT EXISTS price_catalog (
         id INT AUTO_INCREMENT PRIMARY KEY,
         code VARCHAR(50) NOT NULL,
         code_type VARCHAR(20) NOT NULL DEFAULT 'CPT4',
         description VARCHAR(255) NOT NULL,
         category VARCHAR(50) NOT NULL DEFAULT 'general',
         cost DECIMAL(10,2) NOT NULL DEFAULT 0,
         fee DECIMAL(10,2) NOT NULL DEFAULT 0,
         unit VARCHAR(20) DEFAULT NULL,
         active TINYINT(1) NOT NULL DEFAULT 1,
         updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
         UNIQUE KEY uq_price_catalog_code (code_type, code)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8`,
    );

    const [row] = await this.dataSource.query(`SELECT COUNT(*) AS cnt FROM price_catalog`);
    if (Number(row?.cnt) > 0) return;

    const seed: [string, string, string, string, number, number, string | null][] = [
      ['99213', 'CPT4', 'Office Visit — Established Patient', 'office', 36, 90, null],
      ['99214', 'CPT4', 'Office Visit — Established Patient, Moderate', 'office', 46, 115, null],
      ['99215', 'CPT4', 'Office Visit — Established Patient, High', 'office', 60, 150, null],
      ['80053', 'CPT4', 'Comprehensive Metabolic Panel', 'lab', 12, 30, null],
      ['85025', 'CPT4', 'Complete Blood Count (CBC)', 'lab', 10, 25, null],
      ['81001', 'CPT4', 'Urinalysis', 'lab', 5, 12, null],
      ['36415', 'CPT4', 'Venipuncture', 'lab', 4, 10, null],
      ['71045', 'CPT4', 'Chest X-Ray', 'imaging', 40, 120, null],
      ['76700', 'CPT4', 'Abdominal Ultrasound', 'imaging', 60, 180, null],
      ['74150', 'CPT4', 'CT Abdomen', 'imaging', 120, 360, null],
      ['ROOM', 'HCPCS', 'Room & Board (per night)', 'room', 50, 150, 'night'],
      ['99221', 'CPT4', 'Initial Hospital Care', 'office', 60, 150, null],
      ['93000', 'CPT4', 'Electrocardiogram (ECG)', 'procedure', 25, 75, null],
    ];

    for (const [code, codeType, description, category, cost, fee, unit] of seed) {
      await this.dataSource.query(
        `INSERT IGNORE INTO price_catalog (code, code_type, description, category, cost, fee, unit)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [code, codeType, description, category, cost, fee, unit],
      );
    }
  }

  async getPriceCatalog(): Promise<any[]> {
    return this.dataSource.query(
      `SELECT id, code, code_type, description, category, cost, fee, unit, active, updated_at
       FROM price_catalog ORDER BY category ASC, code ASC`,
    );
  }

  async createPriceCatalogItem(dto: any): Promise<any> {
    const fee = Number(dto.fee ?? this.suggestFee(dto.category, dto.cost));
    const result = await this.dataSource.query(
      `INSERT INTO price_catalog (code, code_type, description, category, cost, fee, unit, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE description = VALUES(description), category = VALUES(category),
         cost = VALUES(cost), fee = VALUES(fee), unit = VALUES(unit), active = 1`,
      [dto.code, dto.code_type || 'CPT4', dto.description || dto.code, dto.category || 'general', Number(dto.cost) || 0, fee, dto.unit || null],
    );
    return { id: result.insertId, code: dto.code, fee };
  }

  async updatePriceCatalogItem(id: number, dto: any): Promise<any> {
    const sets: string[] = [];
    const vals: any[] = [];
    const fields: [string, string][] = [
      ['code', 'code'], ['code_type', 'code_type'], ['description', 'description'],
      ['category', 'category'], ['cost', 'cost'], ['fee', 'fee'], ['unit', 'unit'],
      ['active', 'active'],
    ];
    for (const [key, col] of fields) {
      if (dto[key] !== undefined) { sets.push(`${col} = ?`); vals.push(dto[key]); }
    }
    if (!sets.length) return { message: 'nothing to update' };
    vals.push(id);
    await this.dataSource.query(`UPDATE price_catalog SET ${sets.join(', ')} WHERE id = ?`, vals);
    return { message: 'updated', id };
  }

  async deletePriceCatalogItem(id: number): Promise<any> {
    await this.dataSource.query(`UPDATE price_catalog SET active = 0 WHERE id = ?`, [id]);
    return { message: 'deactivated', id };
  }

  /** Smart pricing: cost × category markup, rounded to 2 decimals. */
  private suggestFee(category?: string, cost?: number): number {
    const markup: Record<string, number> = {
      office: 2.5, lab: 2.0, imaging: 3.0, pharmacy: 1.8, room: 1.5,
      procedure: 3.0, general: 2.0,
    };
    const c = Number(cost) || 0;
    const m = markup[category || 'general'] ?? 2.0;
    return Math.round(c * m * 100) / 100;
  }

  async suggestPrice(dto: any): Promise<any> {
    const category = String(dto.category || 'general');
    const cost = Number(dto.cost) || 0;
    const markupMap: Record<string, number> = { office: 2.5, lab: 2.0, imaging: 3.0, pharmacy: 1.8, room: 1.5, procedure: 3.0, general: 2.0 };
    const markup = markupMap[category] ?? 2.0;
    const suggestedFee = Math.round(cost * markup * 100) / 100;
    return { category, cost, markup, suggestedFee };
  }

  // ─── Accounts Receivable (aging) ─────────────────────────────────

  async getAccountsReceivable(): Promise<any> {
    const [summary] = await this.dataSource.query(
      `SELECT COALESCE(SUM(fee), 0) AS totalCharges,
              COALESCE((SELECT SUM(pay_amount) FROM ar_activity), 0) AS totalPayments
       FROM billing WHERE activity = 1`,
    );
    const [aging] = await this.dataSource.query(
      `SELECT
         COALESCE(SUM(CASE WHEN DATEDIFF(${this.hospitalDate('NOW()')}, ${this.hospitalDate('b.date')}) <= 30 THEN b.fee ELSE 0 END), 0) AS current,
         COALESCE(SUM(CASE WHEN DATEDIFF(${this.hospitalDate('NOW()')}, ${this.hospitalDate('b.date')}) BETWEEN 31 AND 60 THEN b.fee ELSE 0 END), 0) AS days_30_60,
         COALESCE(SUM(CASE WHEN DATEDIFF(${this.hospitalDate('NOW()')}, ${this.hospitalDate('b.date')}) BETWEEN 61 AND 90 THEN b.fee ELSE 0 END), 0) AS days_60_90,
         COALESCE(SUM(CASE WHEN DATEDIFF(${this.hospitalDate('NOW()')}, ${this.hospitalDate('b.date')}) > 90 THEN b.fee ELSE 0 END), 0) AS days_90_plus
       FROM billing b WHERE b.activity = 1`,
    );
    const totalCharges = Number(summary?.totalCharges) || 0;
    const totalPayments = Number(summary?.totalPayments) || 0;
    return {
      totalCharges,
      totalPayments,
      balance: Math.max(0, totalCharges - totalPayments),
      aging: {
        current: Number(aging?.current) || 0,
        days_30_60: Number(aging?.days_30_60) || 0,
        days_60_90: Number(aging?.days_60_90) || 0,
        days_90_plus: Number(aging?.days_90_plus) || 0,
      },
    };
  }

  // ─── System-wide Financial Report ────────────────────────────────

  /**
   * Financial report. Optionally scoped to a date range so the Reports page
   * filter actually applies (previously it always reported all time). Reports
   * charges, collections, adjustments, collection rate, an AR snapshot per
   * patient and the outstanding billing holds the billing desk still has to
   * clear.
   */
  // ─── Calendar dates vs the server's clock ───────────────────────
  //
  // The database stores datetimes in the SERVER's zone (Europe/Berlin, which has
  // DST) while the hospital operates in Monrovia (UTC+00:00). Instants are fine —
  // the API converts them for display — but CALENDAR dates are not: a payment
  // taken at 23:30 in Monrovia is stored as 01:30 the next day, so a day-range
  // report used to file it under the wrong date.
  //
  // CONVERT_TZ(..., 'SYSTEM', ...) applies the offset that was actually in force
  // at the given instant (verified: summer 12:00 → 10:00Z, winter 12:00 → 11:00Z),
  // so this stays correct across the server's DST changes. Override with
  // billing_settings.hospital_timezone_offset.
  private hospitalTz = '+00:00';

  /** DATE() in the hospital's calendar, for grouping and date arithmetic. */
  private hospitalDate(expr: string): string {
    return `DATE(CONVERT_TZ(${expr}, 'SYSTEM', '${this.hospitalTz}'))`;
  }

  /**
   * A caller-supplied YYYY-MM-DD range bound (hospital calendar) expressed in the
   * server's zone, so it can still be compared with an index range scan.
   */
  private hospitalBound(date: string, endOfDay = false): string {
    return `CONVERT_TZ('${date} ${endOfDay ? '23:59:59' : '00:00:00'}', '${this.hospitalTz}', 'SYSTEM')`;
  }

  async getFinancialReport(startDate?: string, endDate?: string): Promise<any> {
    const chargeParams: any[] = [];
    let chargeWhere = 'WHERE b.activity = 1';
    if (startDate) {
      chargeWhere += ` AND b.date >= ${this.hospitalBound(startDate)}`;
    }
    if (endDate) {
      chargeWhere += ` AND b.date <= ${this.hospitalBound(endDate, true)}`;
    }

    const payParams: any[] = [];
    let payWhere = 'WHERE aa.deleted IS NULL';
    if (startDate) {
      payWhere += ` AND aa.post_time >= ${this.hospitalBound(startDate)}`;
    }
    if (endDate) {
      payWhere += ` AND aa.post_time <= ${this.hospitalBound(endDate, true)}`;
    }

    const [summary] = await this.dataSource.query(
      `SELECT COALESCE(SUM(b.fee), 0) AS totalCharges,
              COUNT(DISTINCT b.pid) AS billedPatients,
              COUNT(*) AS chargeCount,
              COALESCE(AVG(b.fee), 0) AS avgCharge
       FROM billing b ${chargeWhere}`,
      chargeParams,
    );

    const [payments] = await this.dataSource.query(
      `SELECT COALESCE(SUM(aa.pay_amount), 0) AS totalPayments,
              COUNT(*) AS paymentCount,
              COALESCE(AVG(NULLIF(aa.pay_amount, 0)), 0) AS avgPayment,
              COALESCE(SUM(aa.adj_amount), 0) AS totalAdjustments
       FROM ar_activity aa ${payWhere}`,
      payParams,
    );

    const [encounters] = await this.dataSource.query(
      `SELECT COUNT(*) AS encounterCount FROM form_encounter`,
    );

    const byCategory = await this.dataSource.query(
      `SELECT COALESCE(pc.category, 'uncategorized') AS category,
              COUNT(*) AS count,
              COALESCE(SUM(b.fee), 0) AS amount
       FROM billing b
       LEFT JOIN price_catalog pc ON pc.code = b.code AND pc.code_type = b.code_type
       ${chargeWhere}
       GROUP BY category
       ORDER BY amount DESC`,
      chargeParams,
    );

    // AR snapshot: biggest outstanding balances per patient. Wrapped in a
    // derived table because MySQL rejects an aggregate alias inside a HAVING /
    // ORDER BY *expression* ("Reference 'charges' not supported").
    const outstanding = await this.dataSource.query(
      `SELECT pid, patientId, patientName, charges, paid, (charges - paid) AS balance
         FROM (
           SELECT b.pid AS pid,
                  pd.id AS patientId,
                  CONCAT(COALESCE(pd.fname, ''), ' ', COALESCE(pd.lname, '')) AS patientName,
                  COALESCE(SUM(b.fee), 0) AS charges,
                  COALESCE((SELECT SUM(aa.pay_amount) FROM ar_activity aa
                             WHERE aa.pid = b.pid AND aa.deleted IS NULL), 0) AS paid
             FROM billing b
             LEFT JOIN patient_data pd ON pd.pid = b.pid
             ${chargeWhere}
            GROUP BY b.pid, pd.id, patientName
         ) t
        WHERE t.charges > t.paid
        ORDER BY (t.charges - t.paid) DESC
        LIMIT 10`,
      chargeParams,
    );

    const [holds] = await this.dataSource.query(
      `SELECT COUNT(*) AS pendingHolds, COALESCE(SUM(fee), 0) AS heldAmount
         FROM billing_holds WHERE cleared_at IS NULL`,
    );

    const num = (v: any) => Number(v) || 0;
    const totalCharges = num(summary?.totalCharges);
    const totalPayments = num(payments?.totalPayments);
    const totalAdjustments = num(payments?.totalAdjustments);
    const balance = Math.max(0, totalCharges - totalPayments);

    return {
      range: { startDate: startDate || null, endDate: endDate || null },
      totalCharges,
      totalPayments,
      totalAdjustments,
      balance,
      collectionRate: totalCharges > 0 ? Math.round((totalPayments / totalCharges) * 1000) / 10 : 0,
      avgCharge: Math.round(num(summary?.avgCharge) * 100) / 100,
      avgPayment: Math.round(num(payments?.avgPayment) * 100) / 100,
      billedPatients: num(summary?.billedPatients),
      chargeCount: num(summary?.chargeCount),
      paymentCount: num(payments?.paymentCount),
      encounterCount: num(encounters?.encounterCount),
      pendingHolds: num(holds?.pendingHolds),
      heldAmount: num(holds?.heldAmount),
      byCategory: (byCategory as any[]).map((r) => ({
        category: r.category || 'uncategorized',
        count: num(r.count),
        amount: num(r.amount),
        share: totalCharges > 0 ? Math.round((num(r.amount) / totalCharges) * 1000) / 10 : 0,
      })),
      outstanding: (outstanding as any[]).map((r) => ({
        patientId: r.patientId ? Number(r.patientId) : null,
        pid: num(r.pid),
        patientName: (r.patientName || '').trim() || `PID ${r.pid}`,
        charges: num(r.charges),
        paid: num(r.paid),
        balance: Math.max(0, num(r.charges) - num(r.paid)),
      })),
    };
  }

  // ─── Triage Intake Billing ──────────────────────────────────────

  async billTriageIntake(pid: number): Promise<any> {
    const items = [
      { code: 'TRIAGE', code_type: 'HCPCS', fee: 50 },
      { code: 'VITALS', code_type: 'HCPCS', fee: 15 },
    ];
    let created = 0;
    let total = 0;
    for (const item of items) {
      const [existing] = await this.dataSource.query(
        `SELECT id FROM billing WHERE pid = ? AND code = ? AND code_type = ? AND activity = 1 LIMIT 1`,
        [pid, item.code, item.code_type],
      );
      if (!existing) {
        await this.dataSource.query(
          `INSERT INTO billing (date, encounter, code_type, code, pid, provider_id, user, groupname, authorized, activity, fee, units, billed)
           VALUES (NOW(), 0, ?, ?, ?, 1, 1, 'Default', 1, 1, ?, 1, 1)`,
          [item.code_type, item.code, pid, item.fee],
        );
        created += 1;
        total += item.fee;
      }
    }
    return {
      success: true,
      itemsCreated: created,
      totalFeeUSD: total,
      totalFeeLRD: this.formatLrd(this.usdToLrd(total)),
    };
  }

  // ─── Existing Methods ───────────────────────────────────────────

  async getTransactions(pid: number) {
    // ar_activity has no `id` column (PK = pid/encounter/sequence_no), so match
    // the transaction to its payment by patient + close posting time.
    const transactions = await this.dataSource.query(
      `SELECT t.id, t.date, t.title, t.pid, t.user,
              a.sequence_no AS payment_seq, a.encounter AS payment_encounter,
              a.pay_amount, a.account_code AS payment_method
       FROM transactions t
       LEFT JOIN ar_activity a
         ON a.pid = t.pid AND a.code = 'PAYMENT'
         AND t.payment_ref = CONCAT(a.encounter, '-', a.sequence_no)
       WHERE t.pid = ?
       ORDER BY t.date DESC, t.id DESC LIMIT 100`,
      [pid],
    );

    return (transactions as any[]).map((t: any) => ({
      id: t.id,
      date: t.date,
      title: t.title,
      pid: t.pid,
      user: t.user,
      paymentId: t.payment_seq != null ? `${t.payment_encounter}-${t.payment_seq}` : null,
      amountUSD: t.pay_amount != null ? Number(t.pay_amount) : null,
      amountLRD: t.pay_amount != null ? this.usdToLrd(Number(t.pay_amount)) : null,
      amountFormatted: t.pay_amount != null ? this.formatLrd(this.usdToLrd(Number(t.pay_amount))) : null,
      paymentMethod: t.payment_method || null,
    }));
  }

  async createTransaction(pid: number, dto: any) {
    const result = await this.dataSource.query(
      `INSERT INTO transactions (pid, date, title, user, groupname, authorized)
       VALUES (?, NOW(), ?, ?, ?, 1)`,
      [pid, dto.title || 'Charge', dto.user || 'admin', dto.groupname || 'Default'],
    );
    return { id: result.insertId };
  }

  async getClaims(pid?: number) {
    let query = `SELECT patient_id, encounter_id, payer_id, status, bill_time, process_time, process_file
      FROM claims`;
    const params: any[] = [];
    if (pid) { query += ' WHERE patient_id = ?'; params.push(pid); }
    query += ' ORDER BY bill_time DESC LIMIT 50';
    return this.dataSource.query(query, params);
  }

  async getPatientBillingSummary(pid: number) {
    const transactions = await this.getTransactions(pid);
    const claims = await this.getClaims(pid);
    return { transactions, claims, transactionCount: transactions.length, claimCount: claims.length };
  }

  // ─── Smart Billing Status Algorithm ─────────────────────────────

  private computeBillingStatus(p: any, effectiveBalance?: number): {
    billingStatus: BillingStatus;
    statusLabel: string;
    statusColor: string;
  } {
    // Callers pass the balance that already had the small-balance rule applied,
    // so a few cents of rounding never turns a settled patient into "owes".
    const balance = effectiveBalance !== undefined
      ? effectiveBalance
      : Math.max(0, (Number(p.totalCharges) || 0) - (Number(p.totalPayments) || 0));
    const hasEncounter = !!p.encounterId;
    const isDischarged = p.dischargeStatus === 'discharged';
    const pendingClaims = Number(p.pendingClaimCount) || 0;
    const totalClaims = Number(p.claimCount) || 0;
    const daysSince = p.daysSinceLastEncounter;

    // No encounter at all
    if (!hasEncounter) {
      return { billingStatus: 'no_encounter', statusLabel: 'No Encounter', statusColor: '#6c757d' };
    }

    // Discharged and zero balance
    if (isDischarged && balance === 0) {
      return { billingStatus: 'discharged', statusLabel: 'Discharged · Cleared', statusColor: '#198754' };
    }

    // Discharged but still owes
    if (isDischarged && balance > 0) {
      return { billingStatus: 'discharged_balance', statusLabel: 'Discharged · Owes', statusColor: '#dc3545' };
    }

    // Zero balance, all paid
    if (balance === 0 && totalClaims > 0) {
      return { billingStatus: 'cleared', statusLabel: 'Cleared · Ready', statusColor: '#20c997' };
    }

    // Pending insurance claims
    if (pendingClaims > 0 && balance > 0) {
      return { billingStatus: 'pending_claims', statusLabel: `${pendingClaims} Claims Pending`, statusColor: '#fd7e14' };
    }

    // Overdue (>30 days since encounter with balance)
    if (daysSince !== null && daysSince > 30 && balance > 0) {
      return { billingStatus: 'overdue', statusLabel: `Overdue · ${daysSince}d`, statusColor: '#dc3545' };
    }

    // Active billing
    if (balance > 0) {
      return { billingStatus: 'active_billing', statusLabel: 'Active Billing', statusColor: '#0d6efd' };
    }

    // Fallback
    return { billingStatus: 'active_billing', statusLabel: 'Active', statusColor: '#0d6efd' };
  }

  // ─── Billing Dashboard: ALL Patients with Smart Status ──────────

  async getBillingPatients(search?: string): Promise<BillingPatient[]> {
    const params: any[] = [];
    let whereClause = '';
    if (search) {
      whereClause = ` AND (pd.fname LIKE ? OR pd.lname LIKE ? OR pd.pid LIKE ?)`;
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    const query = `
      SELECT
        pd.pid, pd.fname, pd.lname, pd.DOB as dob, pd.sex,
        pd.insurance_type as insuranceType,
        pd.patient_responsibility_percent as patientPercent,
        fe.encounter as encounterId, fe.date as encounterDate,
        COALESCE(fe.discharge_disposition, 'admitted') as dischargeStatus,
        COALESCE(b.totalCharges, 0) as totalCharges,
        COALESCE(ar.totalPayments, 0) as totalPayments,
        COALESCE(cl.claimCount, 0) as claimCount,
        COALESCE(cl.pendingClaimCount, 0) as pendingClaimCount,
        DATEDIFF(${this.hospitalDate('NOW()')}, ${this.hospitalDate('fe.date')}) as daysSinceLastEncounter
      FROM patient_data pd
      LEFT JOIN (
        SELECT pid, MAX(encounter) as encounter, MAX(date) as date, MAX(discharge_disposition) as discharge_disposition
        FROM form_encounter
        GROUP BY pid
      ) fe ON fe.pid = pd.pid
      LEFT JOIN (
        SELECT pid, SUM(fee) as totalCharges
        FROM billing WHERE activity = 1
        GROUP BY pid
      ) b ON b.pid = pd.pid
      LEFT JOIN (
        SELECT pid, SUM(pay_amount) as totalPayments
        FROM ar_activity
        GROUP BY pid
      ) ar ON ar.pid = pd.pid
      LEFT JOIN (
        SELECT patient_id,
               COUNT(*) as claimCount,
               SUM(CASE WHEN status NOT IN ('1','paid') THEN 1 ELSE 0 END) as pendingClaimCount
        FROM claims
        GROUP BY patient_id
      ) cl ON cl.patient_id = pd.pid
      WHERE 1=1 ${whereClause}
      ORDER BY
        CASE WHEN fe.date IS NULL THEN 1 ELSE 0 END,
        fe.date DESC
      LIMIT 100
    `;

    const rows = await this.dataSource.query(query, params);
    // Same small-balance rule as the clearance view: a few cents of rounding must
    // not keep a settled patient flagged as "active billing / overdue".
    const smallThreshold = await this.getSmallBalanceWriteOff();

    return rows.map((r: any) => {
      const totalCharges = Number(r.totalCharges) || 0;
      const totalPayments = Number(r.totalPayments) || 0;
      const rawBalance = Math.max(0, this.round2(totalCharges - totalPayments));
      const balance = rawBalance <= smallThreshold ? 0 : rawBalance;
      const status = this.computeBillingStatus(r, balance);

      const insuranceType = r.insuranceType === 'insured' ? 'insured' : 'self_pay';
      let patientPercent = Number(r.patientPercent);
      if (!Number.isFinite(patientPercent)) patientPercent = insuranceType === 'insured' ? 40 : 100;
      if (insuranceType !== 'insured') patientPercent = 100;
      patientPercent = Math.min(100, Math.max(0, Math.round(patientPercent)));
      const patientObligation = this.round2((totalCharges * patientPercent) / 100);
      const insuranceBalance = Math.max(0, this.round2(totalCharges - patientObligation));
      const rawPatientBalance = Math.max(0, this.round2(patientObligation - totalPayments));
      const patientBalance = rawPatientBalance <= smallThreshold ? 0 : rawPatientBalance;

      return {
        pid: r.pid,
        fname: r.fname,
        lname: r.lname,
        dob: r.dob,
        sex: r.sex,
        encounterId: r.encounterId || null,
        encounterDate: r.encounterDate || null,
        dischargeStatus: r.dischargeStatus || 'none',
        totalCharges,
        totalPayments,
        balance,
        insuranceType,
        patientPercent,
        insuranceBalance,
        patientBalance,
        lastPayment: null,
        billingStatus: status.billingStatus,
        statusLabel: status.statusLabel,
        statusColor: status.statusColor,
        hasActiveEncounter: !!r.encounterId && r.dischargeStatus !== 'discharged',
        daysSinceLastEncounter: r.daysSinceLastEncounter,
        claimCount: Number(r.claimCount) || 0,
        pendingClaimCount: Number(r.pendingClaimCount) || 0,
      };
    });
  }

  // ─── Financial Clearance Algorithm ───────────────────────────────

  async getFinancialClearance(pid: number): Promise<FinancialClearance> {
    const patients = await this.dataSource.query(
      `SELECT pid, fname, lname FROM patient_data WHERE pid = ?`, [pid],
    );
    if (!patients.length) throw new Error('Patient not found');
    const patient = patients[0];

    const charges = await this.dataSource.query(
      `SELECT COALESCE(SUM(fee), 0) as total
       FROM billing
       WHERE pid = ? AND activity = 1`,
      [pid],
    );
    const totalCharges = Number(charges[0]?.total) || 0;

    const payments = await this.dataSource.query(
      `SELECT COALESCE(SUM(pay_amount), 0) as total
       FROM ar_activity WHERE pid = ?`,
      [pid],
    );
    const totalPayments = Number(payments[0]?.total) || 0;

    const claims = await this.dataSource.query(
      `SELECT patient_id, status, COUNT(*) as cnt
       FROM claims WHERE patient_id = ?
       GROUP BY status`,
      [pid],
    );

    let claimsSubmitted = 0;
    let claimsPaid = 0;
    let claimsPending = 0;
    for (const c of claims) {
      const cnt = Number(c.cnt);
      claimsSubmitted += cnt;
      if (c.status === '1' || c.status === 'paid') claimsPaid += cnt;
      else if (c.status === '0' || c.status === 'pending') claimsPending += cnt;
    }

    const balance = Math.max(0, totalCharges - totalPayments);
    // Money owed BACK to the patient (overpayment) — surfaced so it can be refunded.
    const credit = this.round2(Math.max(0, totalPayments - totalCharges));
    // Coverage is set by the registrar at approval: self-pay (patient owes all)
    // or insured (patient pays patient_responsibility_percent, insurance the rest).
    const { insuranceType, patientPercent } = await this.getPatientInsurance(pid);
    // Keep the cents. This used to be Math.round(), which turned a $309.14 bill
    // into a $309.00 "amount due" — the patient paid the round figure and the
    // 14 cents stayed on the account forever (displayed as L$27).
    const patientObligation = this.round2((totalCharges * patientPercent) / 100);
    const insuranceCovered = Math.max(0, totalCharges - patientObligation);
    const patientPaid = Math.min(totalPayments, patientObligation);
    const rawPatientBalance = Math.max(0, this.round2(patientObligation - patientPaid));
    // Cash comes in whole notes: absorb a few cents rather than chase them.
    const threshold = await this.getSmallBalanceWriteOff();
    const smallBalanceWrittenOff =
      rawPatientBalance > 0 && rawPatientBalance <= threshold ? rawPatientBalance : 0;
    const remainingPatientBalance = this.round2(rawPatientBalance - smallBalanceWrittenOff);
    if (smallBalanceWrittenOff > 0) {
      this.logger.log(
        `Small balance on patient ${pid}: $${rawPatientBalance.toFixed(2)} treated as settled (rounding).`,
      );
    }

    const items: ClearanceItem[] = [];

    items.push({
      category: 'charges',
      description: 'Total Encounter Charges (CPT/HCPCS)',
      amount: totalCharges,
      paid: totalPayments,
      status: totalCharges === 0 ? 'paid' : balance === 0 ? 'paid' : 'unpaid',
      icon: 'bi-file-earmark-medical',
    });

    if (claimsSubmitted > 0) {
      items.push({
        category: 'insurance',
        description: `Insurance Claims (${claimsSubmitted} submitted)`,
        amount: insuranceCovered,
        paid: claimsPaid > 0 ? insuranceCovered : 0,
        status: claimsPending === 0 ? 'paid' : 'insurance_pending',
        icon: 'bi-building',
      });
    }

    // Copay / deductible only applies to insured patients; self-pay patients owe
    // the full bill (already shown by the charges line above).
    if (insuranceType === 'insured') {
      items.push({
        category: 'patient',
        description: 'Patient Copay / Deductible',
        amount: patientObligation,
        paid: patientPaid,
        status: remainingPatientBalance <= 0 ? 'paid' : 'unpaid',
        icon: 'bi-person',
      });
    }

    const drugCharges = await this.dataSource.query(
      `SELECT COALESCE(SUM(fee), 0) as total FROM drug_sales WHERE pid = ?`, [pid],
    );
    const drugTotal = Number(drugCharges[0]?.total) || 0;
    if (drugTotal > 0) {
      items.push({
        category: 'pharmacy',
        description: 'Pharmacy / Drug Charges',
        amount: drugTotal,
        paid: 0,
        status: 'unpaid',
        icon: 'bi-capsule',
      });
    }

    const blockers: string[] = [];
    let canDischarge = true;

    if (balance > 0 && claimsPending > 0) {
      blockers.push(`${claimsPending} insurance claim(s) still pending`);
    }
    if (remainingPatientBalance > 0) {
      blockers.push(`Patient balance of $${remainingPatientBalance.toFixed(2)} remains unpaid`);
    } else if (smallBalanceWrittenOff > 0) {
      blockers.push('Note: rounding adjustment applied to the patient balance');
    }
    if (totalCharges === 0) {
      blockers.push('No charges found for this encounter');
    }

    if (remainingPatientBalance > 0) canDischarge = false;
    if (remainingPatientBalance <= 0 && claimsPending > 0) {
      canDischarge = true;
      blockers.push('Note: Insurance claims still pending — patient portion cleared');
    }

    return {
      pid,
      patientName: `${patient.fname} ${patient.lname}`,
      insuranceType,
      patientPercent,
      totalCharges,
      totalPayments,
      balance,
      credit,
      insuranceCovered,
      patientObligation,
      patientPaid,
      remainingPatientBalance,
      smallBalanceWrittenOff,
      claimsSubmitted,
      claimsPaid,
      claimsPending,
      canDischarge,
      blockers,
      items,
    };
  }

  // ─── Process Discharge ───────────────────────────────────────────

  async processDischarge(pid: number, dischargedBy: string) {
    const clearance = await this.getFinancialClearance(pid);

    if (!clearance.canDischarge) {
      return {
        success: false,
        message: `Cannot discharge: ${clearance.blockers.join('; ')}`,
        clearance,
      };
    }

    const encounters = await this.dataSource.query(
      `SELECT encounter, date FROM form_encounter WHERE pid = ? ORDER BY date DESC LIMIT 1`,
      [pid],
    );

    if (encounters.length === 0) {
      return { success: false, message: 'No active encounter found' };
    }

    const encounterId = encounters[0].encounter;
    const encounterDate = encounters[0].date;

    // Classify length of stay: same-day discharge vs overnight stay.
    const [losRow] = await this.dataSource.query(
      `SELECT DATEDIFF(NOW(), ?) AS nights, TIMESTAMPDIFF(HOUR, ?, NOW()) AS hours`,
      [encounterDate, encounterDate],
    );
    const nightsStayed = Math.max(0, Number(losRow?.nights) || 0);
    const sameDayDischarge = nightsStayed === 0;

    let lengthOfStay: any;
    if (sameDayDischarge) {
      lengthOfStay = { sameDayDischarge: true, nightsStayed: 0, chargeUSD: 0, chargeLRD: this.formatLrd(0) };
    } else {
      const feeUSD = nightsStayed * this.ROOM_AND_BOARD_PER_NIGHT_USD;
      await this.dataSource.query(
        `INSERT INTO billing (date, encounter, code_type, code, pid, provider_id, user, groupname, authorized, activity, fee, units, billed)
         VALUES (NOW(), ?, 'HCPCS', 'ROOM', ?, 1, 1, 'Default', 1, 1, ?, ?, 1)`,
        [encounterId, pid, feeUSD, nightsStayed],
      );
      lengthOfStay = { sameDayDischarge: false, nightsStayed, chargeUSD: feeUSD, chargeLRD: this.formatLrd(this.usdToLrd(feeUSD)) };
    }

    await this.dataSource.query(
      `UPDATE form_encounter
       SET discharge_disposition = 'discharged',
           date_end = NOW()
       WHERE encounter = ?`,
      [encounterId],
    );

    // Re-fetch balance so the room & board charge is reflected in the final figures.
    const [bal] = await this.dataSource.query(
      `SELECT COALESCE((SELECT SUM(fee) FROM billing WHERE pid = ? AND activity = 1), 0) AS charges,
              COALESCE((SELECT SUM(pay_amount) FROM ar_activity WHERE pid = ?), 0) AS payments`,
      [pid, pid],
    );
    const updatedBalance = Math.max(0, Number(bal?.charges) - Number(bal?.payments));

    const visitLabel = sameDayDischarge ? 'Same-day visit' : `${nightsStayed} night(s) stay`;
    await this.dataSource.query(
      `INSERT INTO transactions (pid, date, title, user, groupname, authorized)
       VALUES (?, NOW(), ?, ?, 'Default', 1)`,
      [pid, `Discharge processed — ${visitLabel} — Balance: $${updatedBalance.toFixed(2)}`, dischargedBy],
    );

    this.logger.log(`Patient ${pid} discharged by ${dischargedBy} (${visitLabel}). Balance: $${updatedBalance.toFixed(2)}`);

    return {
      success: true,
      message: `Patient discharged successfully (${visitLabel}). Final balance: $${updatedBalance.toFixed(2)}`,
      dischargeDate: new Date().toISOString(),
      finalBalance: updatedBalance,
      encounterId,
      lengthOfStay,
      clearance,
    };
  }

  async getDischargeDocument(pid: number) {
    const clearance = await this.getFinancialClearance(pid);

    const patient = await this.dataSource.query(
      `SELECT pid, fname, lname, DOB, sex, street, city, state, postal_code, phone_contact
       FROM patient_data WHERE pid = ?`,
      [pid],
    );

    const encounter = await this.dataSource.query(
      `SELECT encounter, date, date_end AS discharge_date, discharge_disposition, reason
       FROM form_encounter WHERE pid = ? ORDER BY date DESC LIMIT 1`,
      [pid],
    );

    // Get active medications
    const medications = await this.dataSource.query(
      `SELECT drug, dosage, route, frequency, start_date, end_date, active
       FROM prescriptions WHERE patient_id = ? AND active = 1
       ORDER BY start_date DESC LIMIT 20`,
      [pid],
    );

    // Get allergies
    const allergies = await this.dataSource.query(
      `SELECT title, comments, severity
       FROM lists WHERE pid = ? AND type = 'allergy' AND enddate IS NULL
       ORDER BY date DESC LIMIT 10`,
      [pid],
    );

    // Get diagnoses/conditions
    const diagnoses = await this.dataSource.query(
      `SELECT title, comments, diagnosis
       FROM lists WHERE pid = ? AND type = 'medical_problem' AND enddate IS NULL
       ORDER BY date DESC LIMIT 10`,
      [pid],
    );

    // Get vital signs from most recent encounter
    const vitals = await this.dataSource.query(
      `SELECT date, temp_f, pulse, respiration, bp_systolic, bp_diastolic, oxygen_saturation,
              weight, height, bmi, pain_severity
       FROM form_vitals WHERE pid = ?
       ORDER BY date DESC LIMIT 5`,
      [pid],
    );

    // Get lab results
    const labResults = await this.dataSource.query(
      `SELECT pr.date_report, pr.report_status,
              GROUP_CONCAT(CONCAT(pr2.result_code, ': ', pr2.result_text, ' ', pr2.units) SEPARATOR '; ') as results
       FROM procedure_report pr
       JOIN procedure_order po ON po.procedure_order_id = pr.procedure_order_id
       LEFT JOIN procedure_result pr2 ON pr2.procedure_report_id = pr.procedure_report_id
       WHERE po.patient_id = ?
       GROUP BY pr.procedure_report_id, pr.date_report, pr.report_status
       ORDER BY pr.date_report DESC LIMIT 10`,
      [pid],
    );

    // Get recent encounters
    const recentEncounters = await this.dataSource.query(
      `SELECT date, reason, discharge_disposition, encounter
       FROM form_encounter WHERE pid = ? ORDER BY date DESC LIMIT 5`,
      [pid],
    );

    // Generate clinical summary from collected data
    const clinicalSummary = this.generateClinicalSummary(
      patient[0], encounter[0], diagnoses, medications, allergies, vitals[0],
    );

    // Generate discharge instructions
    const dischargeInstructions = this.generateDischargeInstructions(
      diagnoses, medications, clearance,
    );

    return {
      documentType: 'DISCHARGE_SUMMARY',
      generatedAt: new Date().toISOString(),
      patient: patient[0] || null,
      encounter: encounter[0] || null,
      clinicalSummary,
      dischargeInstructions,
      medications: medications.map((m: any) => ({
        drug: m.drug, dosage: m.dosage, route: m.route, frequency: m.frequency,
        startDate: m.start_date, active: m.active,
      })),
      allergies: allergies.map((a: any) => ({
        name: a.title, severity: a.severity, comments: a.comments,
      })),
      diagnoses: diagnoses.map((d: any) => ({
        name: d.title, code: d.diagnosis, comments: d.comments,
      })),
      vitals: vitals[0] || null,
      labResults: labResults.map((l: any) => ({
        date: l.date_report, status: l.report_status, results: l.results,
      })),
      recentEncounters: recentEncounters.map((e: any) => ({
        date: e.date, reason: e.reason, disposition: e.discharge_disposition,
      })),
      financialSummary: {
        totalCharges: clearance.totalCharges,
        totalPayments: clearance.totalPayments,
        balance: clearance.balance,
        insuranceCovered: clearance.insuranceCovered,
        patientObligation: clearance.patientObligation,
        patientPaid: clearance.patientPaid,
        remainingBalance: clearance.remainingPatientBalance,
      },
      clearanceItems: clearance.items,
      dischargeStatus: clearance.canDischarge ? 'CLEARED' : 'PENDING',
      blockers: clearance.blockers,
    };
  }

  private generateClinicalSummary(
    patient: any, encounter: any, diagnoses: any[],
    medications: any[], allergies: any[], vitals: any,
  ): string {
    const name = patient ? `${patient.fname} ${patient.lname}` : 'Patient';
    const diagList = diagnoses.map((d: any) => d.title).filter(Boolean).join(', ');
    const medList = medications.map((m: any) => m.drug).filter(Boolean).slice(0, 5).join(', ');
    const allergyList = allergies.map((a: any) => a.title).filter(Boolean).join(', ');

    let summary = `${name} was admitted on ${encounter?.date || 'N/A'}`;
    if (encounter?.reason) summary += ` with presenting complaint: ${encounter.reason}.`;
    if (diagList) summary += ` Diagnoses: ${diagList}.`;
    if (medList) summary += ` Active medications: ${medList}.`;
    if (allergyList) summary += ` Known allergies: ${allergyList}.`;
    if (vitals) {
      const vParts = [];
      if (vitals.temp_f) vParts.push(`Temp ${vitals.temp_f}°F`);
      if (vitals.bp_systolic) vParts.push(`BP ${vitals.bp_systolic}/${vitals.bp_diastolic}`);
      if (vitals.pulse) vParts.push(`HR ${vitals.pulse}`);
      if (vitals.oxygen_saturation) vParts.push(`O2 ${vitals.oxygen_saturation}%`);
      if (vParts.length) summary += ` Last vitals: ${vParts.join(', ')}.`;
    }
    summary += ` Patient discharged in stable condition.`;

    return summary;
  }

  private generateDischargeInstructions(
    diagnoses: any[], medications: any[], clearance: any,
  ): string {
    const instructions: string[] = [];

    instructions.push('FOLLOW-UP APPOINTMENT: Schedule follow-up with primary care provider within 7-14 days.');

    if (medications.length > 0) {
      instructions.push('MEDICATIONS: Continue prescribed medications as directed.');
      for (const m of medications.slice(0, 5)) {
        if (m.drug) instructions.push(`  • ${m.drug} ${m.dosage || ''} ${m.frequency || ''}`);
      }
    }

    if (diagnoses.length > 0) {
      instructions.push('DIAGNOSES TO MONITOR:');
      for (const d of diagnoses.slice(0, 5)) {
        if (d.title) instructions.push(`  • ${d.title}`);
      }
    }

    instructions.push('RETURN TO EMERGENCY DEPARTMENT IF: You experience worsening symptoms, fever > 101°F, severe pain, difficulty breathing, or any new concerning symptoms.');
    instructions.push('DIET AND ACTIVITY: Resume normal diet as tolerated. Gradually return to normal activities.');

    if (clearance.balance > 0) {
      instructions.push(`FINANCIAL: Outstanding balance of $${clearance.balance.toFixed(2)}. Please contact billing department.`);
    }

    return instructions.join('\n');
  }

  async getBillingStats() {
    const [totalOutstanding, patientsWithBalance, pendingClaims, recentDischarges, totalPatients] = await Promise.all([
      this.dataSource.query(
        `SELECT COALESCE(SUM(b.fee), 0) - COALESCE((
          SELECT SUM(ar.pay_amount) FROM ar_activity ar
        ), 0) as total
        FROM billing b WHERE b.activity = 1`,
      ),
      this.dataSource.query(
        `SELECT COUNT(DISTINCT b.pid) as cnt FROM billing b
         WHERE b.activity = 1 AND b.fee > 0`,
      ),
      this.dataSource.query(
        `SELECT COUNT(*) as cnt FROM claims WHERE status NOT IN ('1','paid')`,
      ),
      this.dataSource.query(
        `SELECT COUNT(*) as cnt FROM form_encounter
         WHERE discharge_disposition = 'discharged'
         AND date_end >= DATE_SUB(NOW(), INTERVAL 7 DAY)`,
      ),
      this.dataSource.query(`SELECT COUNT(*) as cnt FROM patient_data`),
    ]);

    return {
      totalOutstanding: Number(totalOutstanding[0]?.total) || 0,
      patientsWithBalance: Number(patientsWithBalance[0]?.cnt) || 0,
      pendingClaims: Number(pendingClaims[0]?.cnt) || 0,
      recentDischarges: Number(recentDischarges[0]?.cnt) || 0,
      totalPatients: Number(totalPatients[0]?.cnt) || 0,
    };
  }

  // ─── Auto-Calculation: Encounter → Billing ──────────────────────

  /**
   * Automatically calculates billing charges from a patient encounter.
   * Pulls CPT4 codes from billing table linked to the encounter,
   * sums fees, and returns a summary in both USD and LRD.
   */
  async autoCalculateEncounter(pid: number, encounterId: number): Promise<{
    encounterId: number;
    pid: number;
    charges: { code: string; description: string; feeUSD: number; feeLRD: number }[];
    totalUSD: number;
    totalLRD: string;
    insuranceLRD: string;
    patientObligationLRD: string;
  }> {
    // Aggregate by code so a service billed on multiple rows (or codes table
    // duplicates) shows once, with summed fee and a quantity.
    const billingRows = await this.dataSource.query(
      `SELECT b.code, SUM(b.fee) AS fee, COUNT(*) AS qty, MAX(c.code_text) AS code_text
       FROM billing b
       LEFT JOIN (
         SELECT code, code_type, MAX(code_text) AS code_text
         FROM codes GROUP BY code, code_type
       ) c ON c.code = b.code AND c.code_type = b.code_type
       WHERE b.pid = ? AND b.encounter = ? AND b.activity = 1
       GROUP BY b.code
       ORDER BY MIN(b.id)`,
      [pid, encounterId],
    );

    const charges = (billingRows as any[]).map((r: any) => ({
      code: r.code || '—',
      description: r.code_text || 'Medical Service',
      quantity: Number(r.qty) || 1,
      feeUSD: Number(r.fee) || 0,
      feeLRD: this.usdToLrd(Number(r.fee) || 0),
    }));

    const totalUSD = charges.reduce((sum, c) => sum + c.feeUSD, 0);
    const totalLRD = this.usdToLrd(totalUSD);
    // Coverage from the registrar's Insured / No-Insurance selection.
    const { patientPercent } = await this.getPatientInsurance(pid);
    const patientObligationLRD = Math.round((totalLRD * patientPercent) / 100);
    const insuranceLRD = totalLRD - patientObligationLRD;

    return {
      encounterId,
      pid,
      charges,
      totalUSD,
      totalLRD: this.formatLrd(totalLRD),
      insuranceLRD: this.formatLrd(insuranceLRD),
      patientObligationLRD: this.formatLrd(patientObligationLRD),
    };
  }

  /**
   * Auto-calculates all active encounters for a patient and returns
   * the cumulative billing summary.
   */
  async autoCalculatePatient(pid: number): Promise<any> {
    const encounters = await this.dataSource.query(
      `SELECT encounter, date, reason FROM form_encounter
       WHERE pid = ? AND discharge_disposition != 'discharged'
       ORDER BY date DESC`,
      [pid],
    );

    const results = [];
    let grandTotalUSD = 0;

    for (const enc of encounters as any[]) {
      const calc = await this.autoCalculateEncounter(pid, enc.encounter);
      results.push({
        date: enc.date,
        reason: enc.reason || 'Visit',
        ...calc,
      });
      grandTotalUSD += calc.totalUSD;
    }

    const grandTotalLRD = this.usdToLrd(grandTotalUSD);

    return {
      pid,
      encounters: results,
      grandTotalUSD,
      grandTotalLRD: this.formatLrd(grandTotalLRD),
      encounterCount: results.length,
      hospital: this.HOSPITAL_NAME,
      location: this.HOSPITAL_LOCATION,
      generatedAt: new Date().toISOString(),
    };
  }

  // ─── Payment Recording + Receipt Generation ─────────────────────

  /**
   * Records a patient payment and generates a full receipt.
   * The receipt includes hospital branding, date/time, services, and amounts in LRD.
   */
  async recordPayment(
    pid: number,
    amountUSD: number,
    paymentMethod: string,
    receivedBy: string,
    override = false,
  ): Promise<{
    success: boolean;
    paymentId: number | string;
    receipt: ReceiptData;
    duplicate?: boolean;
  }> {
    const amountLRD = this.usdToLrd(amountUSD);

    // Totals used for the service, overpay and duplicate checks.
    const [chgRow] = await this.dataSource.query(
      `SELECT COALESCE(SUM(fee), 0) AS total FROM billing WHERE pid = ? AND activity = 1`,
      [pid],
    );
    const [payRow] = await this.dataSource.query(
      `SELECT COALESCE(SUM(pay_amount), 0) AS total FROM ar_activity WHERE pid = ? AND code = 'PAYMENT'`,
      [pid],
    );
    const [encRow] = await this.dataSource.query(
      `SELECT COUNT(*) AS cnt FROM form_encounter WHERE pid = ?`,
      [pid],
    );
    const chargeTotal = Number(chgRow?.total) || 0;
    const paidTotal = Number(payRow?.total) || 0;
    const encounterCount = Number(encRow?.cnt) || 0;
    const outstanding = Math.max(0, chargeTotal - paidTotal);

    // Block payment when no services were rendered (no encounter / no charges)
    // unless explicitly overridden.
    if (!override && (encounterCount === 0 || chargeTotal <= 0)) {
      throw new BadRequestException(
        'No services rendered — this patient has no encounter/charges to pay. Enable the override to record a payment anyway.',
      );
    }

    // Never accept more than the remaining outstanding balance.
    if (!override && amountUSD > outstanding + 0.01) {
      throw new BadRequestException(
        `Payment exceeds the outstanding balance (${this.formatLrd(this.usdToLrd(outstanding))}).`,
      );
    }

    // Suppress duplicate submissions: any payment recorded for this patient
    // within the last 60 seconds returns the prior receipt instead of creating
    // a duplicate. (The auto-calculated amount changes by a cent each time, so
    // matching on amount is unreliable — we gate on the patient + time window.)
    const [dup] = await this.dataSource.query(
      `SELECT encounter, sequence_no, pay_amount, account_code,
              TIMESTAMPDIFF(SECOND, post_time, NOW()) AS age
       FROM ar_activity
       WHERE pid = ? AND code = 'PAYMENT'
         AND ABS(TIMESTAMPDIFF(SECOND, post_time, NOW())) <= 60
       ORDER BY post_time DESC LIMIT 1`,
      [pid],
    );
    if (dup) {
      const dupReceipt = await this.generateReceipt(
        pid, Number(dup.pay_amount), this.usdToLrd(Number(dup.pay_amount)),
        dup.account_code || paymentMethod, receivedBy,
      );
      this.logger.log(`Duplicate payment suppressed for patient ${pid} (${dup.age}s ago).`);
      return { success: true, paymentId: `${dup.encounter}-${dup.sequence_no}`, receipt: dupReceipt, duplicate: true };
    }

    // Record payment in ar_activity (column set matches the deployed schema).
    const encounterId = await this.latestEncounter(pid);
    const [seqRow] = await this.dataSource.query(
      `SELECT COALESCE(MAX(sequence_no), 0) + 1 AS seq FROM ar_activity WHERE pid = ? AND encounter = ?`,
      [pid, encounterId],
    );
    const sequenceNo = Number(seqRow?.seq) || 1;
    const result = await this.dataSource.query(
      `INSERT INTO ar_activity
         (pid, encounter, sequence_no, code_type, code, modifier, payer_type,
          post_time, post_user, session_id, memo, pay_amount, adj_amount, modified_time,
          follow_up, follow_up_note, account_code, reason_code)
       VALUES (?, ?, ?, 'CPT4', 'PAYMENT', '', 0,
          NOW(), 0, 0, '', ?, 0, NOW(),
          '', '', 'CASH', '')`,
      [pid, encounterId, sequenceNo, amountUSD],
    );

    // Record transaction, linked to the exact payment row.
    await this.dataSource.query(
      `INSERT INTO transactions (pid, date, title, user, groupname, authorized, payment_ref)
       VALUES (?, NOW(), ?, ?, 'Default', 1, ?)`,
      [pid, `Payment: ${this.formatLrd(amountLRD)} ($${amountUSD.toFixed(2)}) via ${paymentMethod}`,
       receivedBy, `${encounterId}-${sequenceNo}`],
    );

    // Rounding write-off. Cash is handed over in whole LRD notes, so a payment
    // often leaves a few cents that would otherwise sit on the account forever
    // (this is exactly how "L$27 owed" appeared for a 14-cent remainder).
    // Absorb it as an explicit, auditable adjustment line.
    try {
      const smallThreshold = await this.getSmallBalanceWriteOff();
      if (smallThreshold > 0) {
        const [afterRow] = await this.dataSource.query(
          `SELECT
             COALESCE((SELECT SUM(fee) FROM billing WHERE pid = ? AND activity = 1), 0) AS charges,
             COALESCE((SELECT SUM(pay_amount) FROM ar_activity WHERE pid = ?), 0) AS payments`,
          [pid, pid],
        );
        const residue = this.round2(Number(afterRow?.charges) - Number(afterRow?.payments));
        if (residue > 0 && residue <= smallThreshold) {
          await this.postRoundingAdjustment(
            pid, residue, `Rounding write-off after ${paymentMethod} payment`,
          );
        }
      }
    } catch { /* non-fatal: the payment itself is already recorded */ }

    // Generate receipt
    const receipt = await this.generateReceipt(pid, amountUSD, amountLRD, paymentMethod, receivedBy);

    // Auto-release billing holds once the patient's outstanding balance is settled,
    // so the lab / pharmacy are immediately unblocked.
    try {
      const [bal] = await this.dataSource.query(
        `SELECT
           COALESCE((SELECT SUM(fee) FROM billing WHERE pid = ? AND activity = 1), 0) AS charges,
           COALESCE((SELECT SUM(pay_amount) FROM ar_activity WHERE pid = ?), 0) AS payments`,
        [pid, pid],
      );
      const remaining = Math.max(0, Number(bal?.charges) - Number(bal?.payments));
      if (remaining <= 0) {
        await this.dataSource.query(
          `UPDATE billing_holds SET status = 'cleared', cleared_by = ?, cleared_at = NOW()
           WHERE pid = ? AND status = 'hold'`,
          [`auto:${receivedBy}`, pid],
        );
        this.logger.log(`Billing holds auto-cleared for patient ${pid} (balance settled).`);
      }
    } catch { /* non-fatal */ }

    this.logger.log(
      `Payment recorded for patient ${pid}: ${this.formatLrd(amountLRD)} via ${paymentMethod}. Receipt generated.`,
    );

    return {
      success: true,
      paymentId: result.insertId,
      receipt,
    };
  }

  /**
   * Refund receipt — same layout as a payment receipt but marked REFUND.
   *
   * Kept separate from `generateReceipt` because a refund has no services to
   * itemise and no insurance split; it documents money going back to the patient.
   */
  async generateRefundReceipt(
    pid: number,
    amountUSD: number,
    amountLRD: number,
    paymentMethod: string,
    receivedBy: string,
    reason = 'Overpayment refund',
    reference?: string,
  ): Promise<ReceiptData> {
    const patients = await this.dataSource.query(
      `SELECT pid, fname, lname, DOB, phone_contact, street, city
       FROM patient_data WHERE pid = ?`,
      [pid],
    );
    const patient = patients[0] || null;
    const now = new Date();
    const receiptNumber =
      `RFD-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}` +
      `-${String(pid).padStart(4, '0')}-${String(Math.floor(Math.random() * 9000) + 1000)}`;

    return {
      receiptNumber,
      kind: 'refund',
      refund: { reference, reason },
      hospital: this.HOSPITAL_NAME,
      location: this.HOSPITAL_LOCATION,
      currency: this.CURRENCY,
      paidInFull: true,
      date: now.toISOString(),
      dateFormatted: now.toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      }),
      timeFormatted: now.toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
      }),
      patient: patient ? {
        pid: patient.pid,
        name: `${patient.fname || ''} ${patient.lname || ''}`.trim(),
        dob: patient.DOB,
        phone: patient.phone_contact || '',
        address: [patient.street, patient.city].filter(Boolean).join(', ') || this.HOSPITAL_LOCATION,
      } : { pid, name: `Patient #${pid}`, dob: '', phone: '', address: this.HOSPITAL_LOCATION },
      payment: {
        amountLRD,
        amountFormatted: this.formatLrd(amountLRD),
        amountUSD,
        method: paymentMethod,
        receivedBy,
      },
      items: [{
        code: 'REFUND',
        description: reason,
        quantity: 1,
        unitPriceLRD: amountLRD,
        totalLRD: amountLRD,
      }],
      summary: {
        subtotalLRD: this.formatLrd(amountLRD),
        insuranceCoveredLRD: this.formatLrd(0),
        patientObligationLRD: this.formatLrd(amountLRD),
        amountPaidLRD: this.formatLrd(amountLRD),
        balanceLRD: this.formatLrd(0),
      },
      footer: 'Refund of an overpayment on this account. Keep this receipt as proof of the money paid back.',
    };
  }

  /**
   * Hand back an overpayment.
   *
   * Posts a NEGATIVE payment row, so every aggregate that already sums
   * `ar_activity.pay_amount` nets out correctly, plus a matching ledger entry
   * (that is what the UI lists). Never refunds more than the credit on account.
   */
  async refundPatientCredit(
    pid: number,
    amountUSD?: number,
    reason = 'Credit refund',
    receivedBy = 'admin',
  ): Promise<{ refunded: boolean; amount?: number; amountLRD?: number; creditBefore: number; receipt?: ReceiptData }> {
    const [row] = await this.dataSource.query(
      `SELECT
         COALESCE((SELECT SUM(fee) FROM billing WHERE pid = ? AND activity = 1), 0) AS charges,
         COALESCE((SELECT SUM(pay_amount) FROM ar_activity WHERE pid = ?), 0) AS paid`,
      [pid, pid],
    );
    const credit = this.round2(Number(row?.paid) - Number(row?.charges));
    if (credit <= 0) return { refunded: false, creditBefore: 0 };

    const amount = this.round2(
      amountUSD && amountUSD > 0 ? Math.min(Number(amountUSD), credit) : credit,
    );
    if (amount <= 0) return { refunded: false, creditBefore: credit };

    const encounterId = await this.latestEncounter(pid);
    const [seqRow] = await this.dataSource.query(
      `SELECT COALESCE(MAX(sequence_no), 0) + 1 AS seq FROM ar_activity WHERE pid = ? AND encounter = ?`,
      [pid, encounterId],
    );
    const sequenceNo = Number(seqRow?.seq) || 1;

    await this.dataSource.query(
      `INSERT INTO ar_activity
         (pid, encounter, sequence_no, code_type, code, modifier, payer_type,
          post_time, post_user, session_id, memo, pay_amount, adj_amount, modified_time,
          follow_up, follow_up_note, account_code, reason_code)
       VALUES (?, ?, ?, 'CPT4', 'PAYMENT', '', 0,
          NOW(), 0, 0, ?, ?, 0, NOW(),
          '', '', 'REFUND', '')`,
      [pid, encounterId, sequenceNo, reason, -amount],
    );

    await this.dataSource.query(
      `INSERT INTO transactions (pid, date, title, user, groupname, authorized, payment_ref)
       VALUES (?, NOW(), ?, ?, 'Default', 1, ?)`,
      [
        pid,
        `Refund: ${this.formatLrd(this.usdToLrd(amount))} ($${amount.toFixed(2)}) — ${reason}`,
        receivedBy,
        `${encounterId}-${sequenceNo}`,
      ],
    );

    this.logger.warn(`Credit refunded for patient ${pid}: -$${amount.toFixed(2)} (${reason})`);
    const receipt = await this.generateRefundReceipt(
      pid, amount, this.usdToLrd(amount), 'Cash', receivedBy, reason,
      `${encounterId}-${sequenceNo}`,
    );
    return {
      refunded: true, amount, amountLRD: this.usdToLrd(amount),
      creditBefore: credit, receipt,
    };
  }

  /**
   * Generates a full payment receipt with Ma Juan Memorial Hospital Clinic branding.
   */
  async generateReceipt(
    pid: number,
    amountUSD: number,
    amountLRD: number,
    paymentMethod: string,
    receivedBy: string,
  ): Promise<ReceiptData> {
    const patients = await this.dataSource.query(
      `SELECT pid, fname, lname, DOB, phone_contact, street, city
       FROM patient_data WHERE pid = ?`,
      [pid],
    );
    const patient = patients[0] || null;

    // Get the auto-calculated charges for context
    const calc = await this.autoCalculatePatient(pid);

    // Get recent billing items for this patient
    const billingItems = await this.dataSource.query(
      `SELECT b.code, b.fee, b.units, c.code_text, b.code_type
       FROM billing b
       LEFT JOIN codes c ON c.code = b.code AND c.code_type = b.code_type
       WHERE b.pid = ? AND b.activity = 1
       ORDER BY b.id DESC LIMIT 20`,
      [pid],
    );

    const now = new Date();
    const receiptNumber = `RCT-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(pid).padStart(4, '0')}-${String(Math.floor(Math.random() * 9000) + 1000)}`;

    const items: ReceiptItem[] = (billingItems as any[]).map((b: any) => ({
      code: b.code || '—',
      description: b.code_text || `${b.code_type || 'CPT4'} Service`,
      quantity: b.units || 1,
      unitPriceLRD: this.usdToLrd(Number(b.fee) || 0),
      totalLRD: this.usdToLrd((Number(b.fee) || 0) * (b.units || 1)),
    }));

    const subtotalLRD = items.reduce((sum, i) => sum + i.totalLRD, 0);
    // Insurance split only applies when a claim was actually submitted;
    // otherwise the patient owes the full amount (self-pay).
    const { patientPercent } = await this.getPatientInsurance(pid);
    const patientObligationLRD = Math.round((subtotalLRD * patientPercent) / 100);
    const insuranceLRD = subtotalLRD - patientObligationLRD;
    const patientBalanceLRD = Math.max(0, patientObligationLRD - amountLRD);

    const receipt: ReceiptData = {
      receiptNumber,
      hospital: this.HOSPITAL_NAME,
      location: this.HOSPITAL_LOCATION,
      currency: this.CURRENCY,
      paidInFull: patientBalanceLRD <= 0,
      date: now.toISOString(),
      dateFormatted: now.toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      }),
      timeFormatted: now.toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
      }),
      patient: patient ? {
        pid: patient.pid,
        name: `${patient.fname || ''} ${patient.lname || ''}`.trim(),
        dob: patient.DOB,
        phone: patient.phone_contact || '',
        address: [patient.street, patient.city].filter(Boolean).join(', ') || this.HOSPITAL_LOCATION,
      } : { pid, name: `Patient #${pid}`, dob: '', phone: '', address: this.HOSPITAL_LOCATION },
      payment: {
        amountLRD,
        amountFormatted: this.formatLrd(amountLRD),
        amountUSD,
        method: paymentMethod,
        receivedBy,
      },
      items,
      summary: {
        subtotalLRD: this.formatLrd(subtotalLRD),
        insuranceCoveredLRD: this.formatLrd(insuranceLRD),
        patientObligationLRD: this.formatLrd(patientObligationLRD),
        amountPaidLRD: this.formatLrd(amountLRD),
        balanceLRD: this.formatLrd(patientBalanceLRD),
      },
      footer: `Thank you for choosing ${this.HOSPITAL_NAME}. This receipt serves as proof of payment. For inquiries, please contact our billing department.`,
    };

    return receipt;
  }

  /**
   * Retrieve a previously generated receipt by payment ID.
   */
  async getReceipt(paymentId: number | string): Promise<ReceiptData | null> {
    // ar_activity has no `id`; the reference is "<encounter>-<sequence_no>".
    const raw = String(paymentId);
    let payments: any[] = [];
    if (raw.includes('-')) {
      const [enc, seq] = raw.split('-');
      payments = await this.dataSource.query(
        `SELECT pid, pay_amount, post_time, account_code FROM ar_activity
         WHERE encounter = ? AND sequence_no = ? AND code = 'PAYMENT' LIMIT 1`,
        [Number(enc), Number(seq)],
      );
    }
    if (!payments.length) return null;

    const p = payments[0];
    const amountUSD = Number(p.pay_amount) || 0;
    const amountLRD = this.usdToLrd(amountUSD);

    return this.generateReceipt(
      p.pid,
      amountUSD,
      amountLRD,
      p.account_code || 'Cash',
      'Billing Department',
    );
  }

  // ─── Auto-Bill: Generate Billing Codes from Screening ───────────

  private readonly TEMPLATE_CPT_MAP: Record<string, { code: string; fee: number }> = {
    'UTI': { code: '99213', fee: 90 },
    'Hypertension': { code: '99213', fee: 90 },
    'Diabetes Type 2': { code: '99214', fee: 130 },
    'URI / Common Cold': { code: '99212', fee: 55 },
    'Back Pain': { code: '99213', fee: 90 },
    'Annual Physical': { code: '99204', fee: 165 },
  };

  private readonly LAB_CPT_MAP: Record<string, { code: string; fee: number }> = {
    'Urinalysis': { code: '81001', fee: 15 },
    'Urine Culture': { code: '87086', fee: 25 },
    'Complete Blood Count (CBC)': { code: '85025', fee: 20 },
    'Comprehensive Metabolic Panel': { code: '80053', fee: 25 },
    'Lipid Panel': { code: '80061', fee: 30 },
    'HbA1c': { code: '83036', fee: 25 },
    'Fasting Blood Glucose': { code: '82947', fee: 10 },
    'TSH': { code: '84443', fee: 35 },
    'Pregnancy Test': { code: '81025', fee: 15 },
    'PT/INR': { code: '85610', fee: 20 },
    'COVID-19 PCR': { code: '87635', fee: 50 },
    'Urine Microalbumin': { code: '82043', fee: 20 },
  };

  private readonly IMAGING_CPT_MAP: Record<string, { code: string; fee: number }> = {
    'Chest X-Ray': { code: '71045', fee: 60 },
    'Renal Ultrasound': { code: '76770', fee: 120 },
    'Lumbar Spine X-Ray': { code: '72100', fee: 70 },
    'Abdominal Ultrasound': { code: '76705', fee: 110 },
    'CT Abdomen': { code: '74176', fee: 350 },
    'MRI Lumbar': { code: '72148', fee: 500 },
  };

  /**
   * Auto-generate billing codes for an encounter based on screening data.
   * Called from the Start Screening page after encounter creation.
   */
  async autoBillEncounter(
    pid: number,
    encounterId: number,
    screeningData: {
      template?: string;
      labTests?: string[];
      imaging?: string[];
      providerId?: number;
    },
  ): Promise<{ success: boolean; itemsCreated: number; totalFeeUSD: number; totalFeeLRD: string }> {
    const items: { code: string; code_type: string; fee: number; description: string }[] = [];

    // 1. Office visit CPT from template
    const template = screeningData.template || '';
    const cptEntry = this.TEMPLATE_CPT_MAP[template];
    if (cptEntry) {
      items.push({
        code: cptEntry.code,
        code_type: 'CPT4',
        fee: cptEntry.fee,
        description: `Office Visit — ${template}`,
      });
    } else {
      // Default: standard office visit
      items.push({
        code: '99213',
        code_type: 'CPT4',
        fee: 90,
        description: 'Office Visit — Established Patient',
      });
    }

    // 2. Lab CPT codes (dedupe the incoming test list)
    for (const lab of [...new Set(screeningData.labTests || [])]) {
      const labEntry = this.LAB_CPT_MAP[lab];
      if (labEntry) {
        items.push({
          code: labEntry.code,
          code_type: 'CPT4',
          fee: labEntry.fee,
          description: lab,
        });
      }
    }

    // 3. Imaging CPT codes
    for (const img of screeningData.imaging || []) {
      if (img === 'None') continue;
      const imgEntry = this.IMAGING_CPT_MAP[img];
      if (imgEntry) {
        items.push({
          code: imgEntry.code,
          code_type: 'CPT4',
          fee: imgEntry.fee,
          description: img,
        });
      }
    }

    // System-wide dedup: never bill the same code twice for one encounter.
    const seen = new Set<string>();
    const uniqueItems = items.filter((item) => {
      const key = `${item.code_type}:${item.code}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Insert all billing items
    let totalFee = 0;
    const providerId = screeningData.providerId || 1;

    for (const item of uniqueItems) {
      await this.dataSource.query(
        `INSERT INTO billing (date, encounter, code_type, code, pid, provider_id, user, groupname, authorized, activity, fee, units, billed)
         VALUES (NOW(), ?, ?, ?, ?, ?, 1, 'Default', 1, 1, ?, 1, 1)`,
        [encounterId, item.code_type, item.code, pid, providerId, item.fee],
      );
      totalFee += item.fee;
    }

    this.logger.log(
      `Auto-billed encounter ${encounterId} for patient ${pid}: ${uniqueItems.length} items, $${totalFee} USD (${this.formatLrd(this.usdToLrd(totalFee))})`,
    );

    return {
      success: true,
      itemsCreated: uniqueItems.length,
      totalFeeUSD: totalFee,
      totalFeeLRD: this.formatLrd(this.usdToLrd(totalFee)),
    };
  }

  // ─── Automatic billing on clinical events ─────────────────────────────

  private slug(s: string): string {
    return String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .toUpperCase();
  }

  /**
   * Build a charge mnemonic that actually fits `billing.code` (VARCHAR(20)).
   * Without the truncation a long name makes the INSERT fail outright with
   * "Data too long for column 'code'" — e.g. `REFUND-MALARIA-SMEAR-M-S` is 23
   * characters, so refunding a malaria smear threw instead of posting the credit.
   */
  private billingCode(prefix: string, name: string): string {
    const slug = this.slug(name);
    return (slug ? `${prefix}${slug}` : prefix.replace(/-$/, '')).slice(0, 20);
  }

  /**
   * Resolve (or create) the encounter a new charge should be attached to, so
   * charges are never left orphaned (encounter = 0).
   */
  /** Read the registrar-set insurance coverage for a patient. */
  private async getPatientInsurance(pid: number): Promise<{ insuranceType: string; patientPercent: number }> {
    const rows = await this.dataSource.query(
      `SELECT insurance_type, patient_responsibility_percent FROM patient_data WHERE pid = ? LIMIT 1`,
      [pid],
    );
    const r = rows[0] || {};
    const insuranceType = r.insurance_type === 'insured' ? 'insured' : 'self_pay';
    let patientPercent = Number(r.patient_responsibility_percent);
    if (!Number.isFinite(patientPercent)) patientPercent = insuranceType === 'insured' ? 40 : 100;
    if (insuranceType !== 'insured') patientPercent = 100;
    patientPercent = Math.min(100, Math.max(0, Math.round(patientPercent)));
    return { insuranceType, patientPercent };
  }

  private async latestEncounter(pid: number): Promise<number> {
    const rows = await this.dataSource.query(
      `SELECT COALESCE(encounter, id) AS enc FROM form_encounter WHERE pid = ? ORDER BY id DESC LIMIT 1`,
      [pid],
    );
    if (rows.length && rows[0].enc) return Number(rows[0].enc);

    // No encounter exists yet — create one so the charge can be linked.
    try {
      const [mx] = await this.dataSource.query(
        `SELECT COALESCE(MAX(encounter), 0) + 1 AS next FROM form_encounter`,
      );
      const next = Number(mx?.next) || 1;
      // Same fix as the intake encounter: the literal 5 may no longer exist.
      const visitCategoryId = await resolveVisitCategoryId(this.dataSource, 5);
      await this.dataSource.query(
        `INSERT INTO form_encounter (pid, encounter, date, reason, facility, pc_catid, provider_id, sensitivity)
         VALUES (?, ?, NOW(), 'Auto-created encounter for billing', 'Default', ?, 1, 'normal')`,
        [pid, next, visitCategoryId],
      );
      this.logger.log(`Auto-created encounter ${next} for patient ${pid} (billing link)`);
      return next;
    } catch (e) {
      this.logger.warn(`Could not create encounter for patient ${pid}: ${(e as Error).message}`);
      return 0;
    }
  }

  private async insertBillingLine(
    pid: number,
    encounterId: number,
    code: string,
    codeType: string,
    fee: number,
    providerId = 1,
    units = 1,
    orderId?: number | null,
  ): Promise<void> {
    if (!fee || fee <= 0) return;
    // Duplicate guard. When the charge is tied to an order, exactly one line per
    // (order, code) is allowed — so different orders on the same visit never
    // collapse, and the same order never double-bills. Without an order link we
    // fall back to the short same-code window.
    const dup = orderId
      ? await this.dataSource.query(
          `SELECT id FROM billing
           WHERE pid = ? AND code = ? AND activity = 1 AND order_id = ? LIMIT 1`,
          [pid, code, orderId],
        )
      : await this.dataSource.query(
          `SELECT id FROM billing
           WHERE pid = ? AND encounter = ? AND code = ? AND code_type = ?
             AND activity = 1 AND fee = ? AND date >= DATE_SUB(NOW(), INTERVAL 2 MINUTE)
           LIMIT 1`,
          [pid, encounterId, codeType, code, fee],
        );
    if (dup.length) {
      this.logger.warn(`Duplicate billing line skipped: pid=${pid} enc=${encounterId} code=${code} order=${orderId ?? '-'}`);
      return;
    }
    await this.dataSource.query(
      `INSERT INTO billing (date, encounter, code_type, code, pid, provider_id, user, groupname, authorized, activity, fee, units, billed, order_id)
       VALUES (NOW(), ?, ?, ?, ?, ?, 1, 'Default', 1, 1, ?, ?, 1, ?)`,
      [encounterId, codeType, code, pid, providerId, fee, units, orderId ?? null],
    );
  }

  /** Provider prescribed a medication → create a system-wide billing charge. */
  async billPrescription(
    pid: number,
    drug: string,
    providerId?: number,
  ): Promise<{ code: string; fee: number }> {
    const code = this.billingCode('RX-', drug);
    const encounterId = await this.latestEncounter(pid);

    const [cat] = await this.dataSource.query(
      `SELECT fee FROM price_catalog
       WHERE category = 'pharmacy' AND (code = ? OR LOWER(description) LIKE ?) AND active = 1
       LIMIT 1`,
      [code, `%${String(drug || '').toLowerCase()}%`],
    );
    const fee = cat ? Number(cat.fee) || 10 : 10;

    await this.createPriceCatalogItem({
      code,
      code_type: 'HCPCS',
      description: drug || 'Medication',
      category: 'pharmacy',
      cost: 0,
      fee,
      unit: 'each',
    });
    await this.insertBillingLine(pid, encounterId, code, 'HCPCS', fee, providerId || 1);
    this.logger.log(`Billed medication "${drug}" for patient ${pid}: ${code} $${fee}`);
    return { code, fee };
  }

  /**
   * Significant lowercase words for fuzzy test-name ↔ catalogue matching.
   * Generic words are dropped: without this, "Widal panel" ties with
   * "Comprehensive Metabolic Panel" on the shared word "panel" and the cheaper
   * Widal entry loses to a $30 panel (that mis-match is on a real bill).
   */
  private static readonly GENERIC_MATCH_WORDS = new Set([
    'panel', 'test', 'tests', 'complete', 'total', 'count', 'level', 'levels',
    'profile', 'screen', 'screening', 'and', 'the', 'with', 'each', 'unit',
    'specimen', 'result', 'results', 'sample',
  ]);

  private significantWords(s: string): string[] {
    const words = String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !BillingService.GENERIC_MATCH_WORDS.has(w));
    // De-duplicate: a repeated word ("Creatinine – Creatinine Kinase") must not
    // count twice and skew the score.
    return [...new Set(words)];
  }

  /**
   * Resolve the CPT/fee for a lab test name. Crucially, an unmatched test gets a
   * DISTINCT `LAB-<MNEMONIC>` code instead of a shared default — otherwise the
   * duplicate-charge guard in `insertBillingLine` (same code + fee within two
   * minutes) would drop every lab after the first on the same visit.
   */
  private async resolveLabChargeCode(testName: string): Promise<{ code: string; fee: number }> {
    const raw = String(testName || '').trim();
    if (!raw) return { code: 'LAB-TEST', fee: 20 };

    // 1) Curated CPT map (exact).
    const mapped = this.LAB_CPT_MAP[raw];
    if (mapped) return mapped;

    // 2) Price catalogue — word-overlap match, so "CBC Complete blood count"
    //    still finds "Complete Blood Count (CBC)".
    const words = this.significantWords(raw);
    const catalog = await this.dataSource.query(
      `SELECT code, fee, description FROM price_catalog WHERE category = 'lab' AND active = 1`,
    );
    let best: any = null;
    let bestScore = 0;
    let bestRatio = 0;
    for (const c of catalog as any[]) {
      const catalogWords = this.significantWords(c.description);
      const score = catalogWords.filter((w) => words.includes(w)).length;
      if (!score) continue;
      // Break ties on how specific the catalogue entry is, not on row order.
      const ratio = score / Math.max(1, catalogWords.length);
      if (score > bestScore || (score === bestScore && ratio > bestRatio)) {
        bestScore = score; bestRatio = ratio; best = c;
      }
    }
    if (best && bestScore > 0) return { code: best.code, fee: Number(best.fee) || 20 };

    // 3) Distinct per-test mnemonic — unique so multiple unmatched labs on one
    //    visit are each billed, and readable once prettified by describeCharge.
    return { code: this.billingCode('LAB-', raw) || 'LAB-TEST', fee: 20 };
  }

  /** Public view of the small-balance write-off threshold (USD, 0 = disabled). */
  async smallBalanceWriteOffThreshold(): Promise<number> {
    return this.getSmallBalanceWriteOff();
  }

  /**
   * Public, read-only view of lab price resolution, used by the billing integrity
   * engine to report what an unbilled order *would* be charged.
   */
  async resolveLabChargeCodeForAudit(testName: string): Promise<{ code: string; fee: number }> {
    return this.resolveLabChargeCode(String(testName || ''));
  }

  /** Provider ordered a lab test → create a system-wide billing charge. */
  async billLabOrder(
    pid: number,
    testName: string,
    providerId?: number,
    orderId?: number | null,
  ): Promise<{ code: string; fee: number }> {
    const encounterId = await this.latestEncounter(pid);
    const resolved = await this.resolveLabChargeCode(String(testName || ''));
    await this.insertBillingLine(pid, encounterId, resolved.code, 'CPT4', resolved.fee, providerId || 1, 1, orderId);
    this.logger.log(`Billed lab "${testName}" for patient ${pid}: ${resolved.code} $${resolved.fee} (order ${orderId ?? '-'})`);
    return resolved;
  }

  /**
   * Absorb a few cents of rounding. Posts a NEGATIVE billing line (code_type
   * ADJUSTMENT) so the statement shows the credit explicitly, the encounter
   * balance lands on zero, and the write-off stays visible and auditable rather
   * than being silently hidden behind a display rule.
   */
  async postRoundingAdjustment(
    pid: number,
    amountUSD: number,
    reason = 'Rounding adjustment',
    encounterId?: number,
  ): Promise<{ adjusted: boolean; amount?: number }> {
    const amount = this.round2(Math.abs(Number(amountUSD) || 0));
    if (amount <= 0) return { adjusted: false };
    const encounter = encounterId ?? await this.latestEncounter(pid);
    await this.dataSource.query(
      `INSERT INTO billing (date, encounter, code_type, code, pid, provider_id, user, groupname, authorized, activity, fee, units, billed)
       VALUES (NOW(), ?, 'ADJUSTMENT', 'ROUNDING-ADJ', ?, 1, 1, 'Default', 1, 1, ?, 1, 1)`,
      [encounter, pid, -amount],
    );
    this.logger.log(`Rounding write-off for patient ${pid}: -$${amount.toFixed(2)} (${reason})`);
    return { adjusted: true, amount };
  }

  /**
   * Clear a sub-threshold residue on a patient's account (manual button or a
   * one-off repair). Refuses to touch anything above the configured threshold,
   * so a real debt can never be written off by accident.
   */
  async writeOffSmallBalance(
    pid: number,
    reason = 'Small balance write-off',
  ): Promise<{ adjusted: boolean; residue: number; threshold: number; amount?: number }> {
    const threshold = await this.getSmallBalanceWriteOff();
    const [row] = await this.dataSource.query(
      `SELECT
         COALESCE((SELECT SUM(fee) FROM billing WHERE pid = ? AND activity = 1), 0) AS charges,
         COALESCE((SELECT SUM(pay_amount) FROM ar_activity WHERE pid = ?), 0) AS payments`,
      [pid, pid],
    );
    const residue = this.round2(Number(row?.charges) - Number(row?.payments));
    if (residue <= 0 || threshold <= 0 || residue > threshold) {
      return { adjusted: false, residue, threshold };
    }
    const result = await this.postRoundingAdjustment(pid, residue, reason);
    return { ...result, residue, threshold };
  }

  /**
   * Reverse a lab order's charge when the lab is removed/cancelled/rejected.
   * Posts a NEGATIVE billing line (code_type REFUND) so the statement shows the
   * credit explicitly, and the encounter balance is reduced.
   */
  async refundLabOrder(
    pid: number,
    testName: string,
    fee: number,
    reason = 'Lab removed',
    orderId?: number | null,
  ): Promise<{ refunded: boolean; amount?: number; code?: string }> {
    const amount = Math.abs(Number(fee) || 0);
    if (!amount) return { refunded: false };
    const code = this.billingCode('REFUND-', testName) || 'REFUND';
    const encounterId = await this.latestEncounter(pid);
    await this.dataSource.query(
      `INSERT INTO billing (date, encounter, code_type, code, pid, provider_id, user, groupname, authorized, activity, fee, units, billed, order_id)
       VALUES (NOW(), ?, 'REFUND', ?, ?, 1, 1, 'Default', 1, 1, ?, 1, 1, ?)`,
      [encounterId, code, pid, -amount, orderId ?? null],
    );
    this.logger.warn(`Refund posted for lab "${testName}" patient ${pid}: -$${amount} (${reason})`);
    return { refunded: true, amount, code };
  }

  /**
   * Read-only 1:1 plan pairing legacy lab charges (order_id NULL) with the lab
   * orders they came from: same patient, ordered within two minutes, preferring an
   * exact code match, then an order that already carries its own charge.
   */
  async planLabChargeOrderLinks(): Promise<
    { legacyId: number; legacyCode: string; orderId: number; test: string; exact: boolean }[]
  > {
    const rows = await this.dataSource.query(
      `SELECT b.id AS legacyId, b.code AS legacyCode,
              po.procedure_order_id AS orderId, po.patient_instructions AS test,
              (t.code = b.code) AS exact
         FROM billing b
         JOIN procedure_order po
                ON po.patient_id = b.pid
               AND ABS(TIMESTAMPDIFF(SECOND, po.date_ordered, b.date)) <= 120
               AND po.order_status NOT IN ('cancelled', 'rejected', 'duplicate')
         LEFT JOIN billing t
                ON t.pid = b.pid AND t.order_id = po.procedure_order_id AND t.activity = 1
        WHERE b.activity = 1 AND b.order_id IS NULL
          -- Visits/triage/registration and pharmacy lines are not lab charges:
          -- linking one to a lab order would make the order look billed.
          AND b.code NOT IN ('TRIAGE', 'VITALS', 'REG', '99213', '99214', '99215')
          AND b.code NOT LIKE 'RX-%'
        ORDER BY b.id, (t.code = b.code) DESC, (t.id IS NOT NULL) DESC, po.procedure_order_id`,
    );

    // One order per legacy line AND one legacy line per order (pure helper, unit
    // tested): without the second guard a single line could pair with several
    // orders and be reported — and refunded — more than once.
    return assignOneToOne(
      (rows as any[]).map((r) => ({
        legacyId: Number(r.legacyId), legacyCode: r.legacyCode,
        orderId: Number(r.orderId), test: r.test, exact: !!Number(r.exact),
      })),
    );
  }

  /**
   * Restore `billing.order_id` on historical lab charges.
   *
   * Charges raised before that column existed carry NULL there, so the per-order
   * de-dup in `reconcileLabCharges` cannot see them and the same order gets billed
   * a second time — exactly how ~$640 of duplicate lab charges reached live
   * accounts. Idempotent.
   */
  async backfillLabChargeOrderIds(): Promise<{ linked: number; scanned: number }> {
    const plan = await this.planLabChargeOrderLinks();
    let linked = 0;
    for (const p of plan) {
      const res = await this.dataSource.query(
        `UPDATE billing SET order_id = ? WHERE id = ? AND order_id IS NULL`,
        [p.orderId, p.legacyId],
      );
      if (res?.affectedRows) linked++;
    }
    if (linked) this.logger.log(`Linked ${linked} legacy lab charge(s) to their orders.`);
    return { linked, scanned: plan.length };
  }

  /**
   * Post charges for lab orders that have no billing line yet — e.g. orders
   * raised before the per-test billing fix.
   *
   * Runs the order-id backfill first: without it the historical charges
   * (order_id NULL) are invisible and their orders get billed a second time. With
   * `dryRun` nothing is written and the returned plan lets the UI confirm first.
   */
  async reconcileLabCharges(
    limit = 500,
    dryRun = false,
  ): Promise<{
    dryRun?: boolean;
    linked?: number;
    wouldLink?: number;
    scanned: number;
    billed: number;
    total: number;
    orders?: { orderId: number; pid: number; patient: string; test: string; code: string; fee: number }[];
  }> {
    const take = Math.min(Math.max(Math.floor(Number(limit) || 500), 1), 5000);

    // Orders the backfill would claim, so a preview matches the real run exactly.
    const wouldLink = dryRun ? await this.planLabChargeOrderLinks() : [];
    const linkedOrderIds = new Set(wouldLink.map((p) => p.orderId));
    const linked = dryRun ? 0 : (await this.backfillLabChargeOrderIds()).linked;

    const orders = await this.dataSource.query(
      `SELECT po.procedure_order_id AS orderId, po.patient_id AS pid,
              po.provider_id AS providerId, po.patient_instructions AS instructions,
              CONCAT(COALESCE(pd.fname, ''), ' ', COALESCE(pd.lname, '')) AS patient
         FROM procedure_order po
         LEFT JOIN patient_data pd ON pd.pid = po.patient_id
        WHERE po.activity = 1
          AND po.order_status NOT IN ('cancelled','rejected','duplicate')
          AND NOT EXISTS (
            SELECT 1 FROM billing b WHERE b.order_id = po.procedure_order_id AND b.activity = 1
          )
        ORDER BY po.date_ordered DESC
        LIMIT ${take}`,
    );
    const todo = (orders as any[]).filter((o) => !linkedOrderIds.has(o.orderId));

    if (dryRun) {
      const plan: { orderId: number; pid: number; patient: string; test: string; code: string; fee: number }[] = [];
      for (const o of todo) {
        for (const t of this.splitOrderTests(o.instructions)) {
          const resolved = await this.resolveLabChargeCode(t).catch(() => null);
          plan.push({
            orderId: o.orderId, pid: o.pid, patient: o.patient || `#${o.pid}`,
            test: t, code: resolved?.code || 'LAB-TEST', fee: resolved?.fee || 0,
          });
        }
      }
      return {
        dryRun: true,
        wouldLink: linkedOrderIds.size,
        scanned: (orders as any[]).length,
        billed: plan.length,
        total: this.round2(plan.reduce((s, p) => s + p.fee, 0)),
        orders: plan.slice(0, 100),
      };
    }

    let billed = 0;
    let total = 0;
    for (const o of todo) {
      let sum = 0;
      for (const t of this.splitOrderTests(o.instructions)) {
        const b = await this.billLabOrder(o.pid, t, o.providerId || 1, o.orderId).catch(() => null);
        if (b) { sum += Number(b.fee) || 0; billed++; }
      }
      if (sum > 0) {
        total += sum;
        await this.createHold({
          holdType: 'lab', orderId: o.orderId, pid: o.pid,
          encounterId: null, code: null, description: o.instructions || '', fee: sum,
        }).catch(() => null);
      }
    }
    this.logger.log(
      `Lab charge reconciliation: linked=${linked}, scanned=${(orders as any[]).length}, billed=${billed}, total=$${total}`,
    );
    return { linked, scanned: (orders as any[]).length, billed, total: this.round2(total) };
  }

  /** One lab order can carry a comma-separated list of tests. */
  private splitOrderTests(instructions: any): string[] {
    const tests = String(instructions || '')
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean);
    return tests.length ? tests : [String(instructions || 'Lab test')];
  }

  /** Per-patient financial snapshot: charges, payments and outstanding balance. */
  async getPatientBalances(
    pids: number[],
  ): Promise<Record<number, { charges: number; paid: number; balance: number; credit: number; smallBalanceWrittenOff: number }>> {
    const map: Record<number, { charges: number; paid: number; balance: number; credit: number; smallBalanceWrittenOff: number }> = {};
    if (!pids.length) return map;
    const placeholders = pids.map(() => '?').join(',');
    const threshold = await this.getSmallBalanceWriteOff();

    const charges = await this.dataSource.query(
      `SELECT pid, SUM(fee) AS charges FROM billing WHERE activity = 1 AND pid IN (${placeholders}) GROUP BY pid`,
      pids,
    );
    const payments = await this.dataSource.query(
      `SELECT pid, SUM(pay_amount) AS paid FROM ar_activity WHERE pid IN (${placeholders}) GROUP BY pid`,
      pids,
    );

    const paidMap: Record<number, number> = {};
    for (const p of payments) paidMap[p.pid] = Number(p.paid) || 0;

    const build = (pid: number, chargesAmt: number) => {
      const paidAmt = this.round2(paidMap[pid] || 0);
      const raw = this.round2(chargesAmt - paidAmt);
      // A credit (overpayment) is real money owed back to the patient, so it is
      // surfaced instead of being clamped away by Math.max(0, ...).
      const credit = raw < 0 ? Math.abs(raw) : 0;
      const small = raw > 0 && raw <= threshold ? raw : 0;
      return {
        charges: this.round2(chargesAmt),
        paid: paidAmt,
        balance: this.round2(Math.max(0, raw - small)),
        credit,
        smallBalanceWrittenOff: small,
      };
    };

    for (const c of charges) {
      map[c.pid] = build(c.pid, Number(c.charges) || 0);
    }
    for (const pid of pids) {
      if (!map[pid]) map[pid] = build(pid, 0);
    }
    return map;
  }
}

// ─── Receipt Interfaces ───────────────────────────────────────────

export interface ReceiptItem {
  code: string;
  description: string;
  quantity: number;
  unitPriceLRD: number;
  totalLRD: number;
}

export interface ReceiptData {
  receiptNumber: string;
  /** 'refund' renders the same layout with a REFUND banner instead of PAID IN FULL. */
  kind?: 'payment' | 'refund';
  refund?: { reference?: string; reason?: string };
  hospital: string;
  location: string;
  currency: string;
  paidInFull: boolean;
  date: string;
  dateFormatted: string;
  timeFormatted: string;
  patient: {
    pid: number;
    name: string;
    dob: string;
    phone: string;
    address: string;
  };
  payment: {
    amountLRD: number;
    amountFormatted: string;
    amountUSD: number;
    method: string;
    receivedBy: string;
  };
  items: ReceiptItem[];
  summary: {
    subtotalLRD: string;
    insuranceCoveredLRD: string;
    patientObligationLRD: string;
    amountPaidLRD: string;
    balanceLRD: string;
  };
  footer: string;
}
