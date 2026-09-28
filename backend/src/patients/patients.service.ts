 import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withChartStatus } from './chart-completeness.util';
import { chartReadiness } from './chart-readiness.util';
import { maternityEligibility } from './maternity-eligibility.util';
import { EmergencyService } from '../emergency/emergency.service';
import { resolveVisitCategoryId } from '../common/calendar-categories.util';

export interface PatientRow {
  id: number;
  pid: number;
  fname: string;
  lname: string;
  mname: string;
  DOB: string | null;
  sex: string | null;
  email: string | null;
  phone_contact: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  status: string | null;
  public_id: string | null;
  providerID: number | null;
  ref_providerID: number | null;
  providerName: string | null;
  regdate: string | null;
  created_by: number | null;
}

export interface CreatePatientDto {
  fname: string;
  lname: string;
  mname?: string;
  suffix?: string;
  DOB?: string;
  sex?: string;
  email?: string;
  phone_contact?: string;
  street?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  providerID?: number;
  ref_providerID?: number;
  status?: string;
}

@Injectable()
export class PatientsService {
  private readonly logger = new Logger(PatientsService.name);

  constructor(
    @InjectDataSource()
    private dataSource: DataSource,
    private readonly emergency: EmergencyService,
  ) {}

  async findAll(opts?: {
    search?: string;
    limit?: number;
    offset?: number;
    sex?: string;
    ageMin?: number;
    ageMax?: number;
  }): Promise<PatientRow[]> {
    const { search, sex, ageMin, ageMax } = opts || {};
    const limit = opts?.limit ?? 50;
    const offset = opts?.offset ?? 0;

    let query = `SELECT pd.id, pd.pid, pd.fname, pd.lname, pd.mname, pd.suffix, pd.DOB, pd.sex,
        pd.chart_shared,
        pd.email, pd.phone_contact, pd.street, pd.city, pd.state, pd.postal_code,
        pd.status, pd.public_id, pd.providerID, pd.ref_providerID, pd.regdate, pd.created_by,
        TIMESTAMPDIFF(YEAR, pd.DOB, CURDATE()) as age,
        CONCAT(u.fname, ' ', u.lname) as providerName
      FROM patient_data pd
      LEFT JOIN users u ON pd.providerID = u.id`;
    const params: any[] = [];
    const conditions: string[] = [];

    if (search) {
      conditions.push('(pd.lname LIKE ? OR pd.fname LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    if (sex) {
      conditions.push('pd.sex = ?');
      params.push(sex);
    }
    if (ageMin !== undefined && ageMin !== null) {
      conditions.push('TIMESTAMPDIFF(YEAR, pd.DOB, CURDATE()) >= ?');
      params.push(ageMin);
    }
    if (ageMax !== undefined && ageMax !== null) {
      conditions.push('TIMESTAMPDIFF(YEAR, pd.DOB, CURDATE()) <= ?');
      params.push(ageMax);
    }

    if (conditions.length) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY pd.lname ASC, pd.fname ASC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return this.dataSource.query(query, params);
  }

  async findOne(id: number): Promise<PatientRow> {
    if (isNaN(id) || id <= 0) throw new Error('Invalid patient ID');
    // Resolve by primary key first, then fall back to the OpenEMR `pid`
    // (several screens navigate with `pc_pid` / `pid` instead of `id`).
    const rows = await this.dataSource.query(
      `SELECT pd.id, pd.pid, pd.fname, pd.lname, pd.mname, pd.suffix, pd.DOB, pd.sex,
        pd.chart_shared, pd.insurance_type, pd.patient_responsibility_percent,
        pd.email, pd.phone_contact, pd.street, pd.city, pd.state, pd.postal_code,
        pd.status, pd.public_id, pd.providerID, pd.ref_providerID,
        pd.regdate, pd.created_by,
        -- Aliases so the SPA can use one naming convention: the Patient type and
        -- every chart tab read dob/phone/provider/zip, but the columns are
        -- DOB/phone_contact/providerID/postal_code. Without these the chart
        -- showed blank date-of-birth, phone and provider fields.
        pd.DOB AS dob,
        pd.phone_contact AS phone,
        pd.providerID AS provider,
        pd.postal_code AS zip,
        CONCAT(u.fname, ' ', u.lname) as providerName
      FROM patient_data pd
      LEFT JOIN users u ON pd.providerID = u.id
      WHERE pd.id = ? OR pd.pid = ?
      ORDER BY (pd.id = ?) DESC
      LIMIT 1`,
      [id, id, id],
    );
    if (!rows || rows.length === 0) {
      throw new NotFoundException(`Patient #${id} not found`);
    }

    const patient = rows[0];
    // `patient_data.id` and `pid` are different columns that can both hold the
    // requested number, so a caller linking with a pid silently gets the
    // neighbouring patient. We keep resolving (for compatibility) but log it so
    // any remaining pid-based caller is visible instead of quietly wrong.
    if (Number(patient.id) !== id) {
      this.logger.warn(
        `Patient lookup: id=${id} matched patient_data.pid only ` +
          `(canonical id=${patient.id}). Callers should link with patientId.`,
      );
    }
    // Drives the yellow "chart incomplete" highlighting on the patient chart.
    const withStatus = withChartStatus(patient);
    // …and the readiness score/meter in the chart's menu. The score needs real
    // documentation counts, not just what the page happened to fetch, so they are
    // read here in one cheap query.
    const signals = await this.chartSignals(Number(patient.pid ?? patient.id));
    return {
      ...withStatus,
      chart_readiness: chartReadiness(withStatus, signals),
      // Whether this patient has a maternity record at all — a male or a child
      // must not be shown the Maternity tab. Computed here so every client uses
      // the same rule instead of comparing sex and age for itself.
      maternity_eligibility: maternityEligibility(patient),
      // Emergency state, so the chart can banner an active attendance and offer
      // the triage history without a second round trip. Failure here must never
      // stop a chart loading, hence the catch.
      emergency: await this.emergencyFor(Number(patient.pid ?? patient.id)),
    };
  }

  private async emergencyFor(pid: number) {
    try {
      return await this.emergency.getForPatient(pid);
    } catch {
      return { active: null, current: null, history: [], total: 0 };
    }
  }

  /**
   * Clinical signals for the chart readiness score: counts over the tables the
   * chart tabs already read (vitals, notes, problem list, allergies) plus the
   * structured observations table.
   */
  private async chartSignals(pid: number): Promise<{
    vitals: number; notes: number; observations: number; allergies: number; diagnoses: number;
  }> {
    const [row] = await this.dataSource.query(
      `SELECT
         (SELECT COUNT(*) FROM form_vitals WHERE pid = ?) AS vitals,
         (SELECT COUNT(*) FROM pnotes WHERE pid = ?) AS notes,
         (SELECT COUNT(*) FROM lists WHERE pid = ? AND type = 'allergy') AS allergies,
         (SELECT COUNT(*) FROM lists WHERE pid = ? AND type = 'medical_problem') AS diagnoses`,
      [pid, pid, pid, pid],
    );
    let observations = 0;
    try {
      const [obs] = await this.dataSource.query(
        `SELECT COUNT(*) AS n FROM patient_observations WHERE pid = ?`,
        [pid],
      );
      observations = Number(obs?.n) || 0;
    } catch { /* observations table not created yet — treat as none */ }
    return {
      vitals: Number(row?.vitals) || 0,
      notes: Number(row?.notes) || 0,
      observations,
      allergies: Number(row?.allergies) || 0,
      diagnoses: Number(row?.diagnoses) || 0,
    };
  }

  /**
   * Smart duplicate detection for returning patients.
   * Matches on: first+last name, first/last name + DOB, or phone digits.
   * Used to prevent accidental re-registration of an existing patient.
   */
  async findDuplicates(fname?: string, lname?: string, DOB?: string, phone?: string): Promise<any[]> {
    const conditions: string[] = [];
    const params: any[] = [];

    if (fname && lname) {
      conditions.push('(pd.fname LIKE ? AND pd.lname LIKE ?)');
      params.push(`%${fname.trim()}%`, `%${lname.trim()}%`);
    }
    if (DOB) {
      const namePart = fname || lname;
      if (namePart) {
        conditions.push('(pd.DOB = ? AND (pd.fname LIKE ? OR pd.lname LIKE ?))');
        params.push(DOB, `%${namePart.trim()}%`, `%${namePart.trim()}%`);
      }
    }
    const phoneDigits = (phone || '').replace(/\D/g, '');
    if (phoneDigits.length >= 6) {
      conditions.push("REPLACE(REPLACE(REPLACE(REPLACE(pd.phone_contact, ' ', ''), '+', ''), '-', ''), '(', '') LIKE ?");
      params.push(`%${phoneDigits}%`);
    }

    if (!conditions.length) return [];

    return this.dataSource.query(
      `SELECT pd.id, pd.pid, pd.fname, pd.lname, pd.mname,
              DATE_FORMAT(pd.DOB, '%Y-%m-%d') as DOB, pd.sex,
              pd.email, pd.phone_contact, pd.street, pd.city, pd.status,
              pd.public_id, pd.providerID
       FROM patient_data pd
       WHERE ${conditions.join(' OR ')}
       ORDER BY pd.lname ASC, pd.fname ASC LIMIT 10`,
      params,
    );
  }

  async create(dto: CreatePatientDto, createdBy?: string): Promise<{ id: number; pid: number; publicId: string }> {
    // Smart Patient ID: RX-YYMM-NNNNN (e.g., RX-2608-00001)
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const prefix = `RX-${yy}${mm}`;
    const [countRow] = await this.dataSource.query(
      `SELECT COUNT(*) as cnt FROM patient_data WHERE public_id LIKE ?`,
      [`${prefix}-%`],
    );
    const seq = String((countRow.cnt || 0) + 1).padStart(5, '0');
    const publicId = `${prefix}-${seq}`;

    // patient_data has unique index on pid. Query max pid and add 1.
    const [maxRow] = await this.dataSource.query(`SELECT COALESCE(MAX(pid), 0) + 1 as nextPid FROM patient_data`);
    const nextPid = maxRow.nextPid;
    const result = await this.dataSource.query(
      `INSERT INTO patient_data (fname, lname, mname, suffix, DOB, sex, email, phone_contact,
        street, city, state, postal_code, pid, public_id, providerID, ref_providerID,
        status, regdate, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
      [
        dto.fname, dto.lname, dto.mname || '', dto.suffix || null, dto.DOB || null, dto.sex || '',
        dto.email || '', dto.phone_contact || '', dto.street || '',
        dto.city || '', dto.state || '', dto.postal_code || '',
        nextPid, publicId,
        dto.providerID || null,
        dto.ref_providerID || null,
        dto.status || 'active',
        createdBy || null,
      ],
    );
    return { id: result.insertId, pid: nextPid, publicId };
  }

  async setChartShared(id: number, shared: boolean): Promise<{ message: string; chart_shared: boolean }> {
    await this.dataSource.query(
      `UPDATE patient_data SET chart_shared = ? WHERE id = ?`,
      [shared ? 1 : 0, id],
    );
    return { message: 'chart share updated', chart_shared: shared };
  }

  async findByPublicId(publicId: string): Promise<any[]> {
    return this.dataSource.query(
      `SELECT pid, public_id, fname, lname, DOB FROM patient_data WHERE public_id = ? LIMIT 1`,
      [publicId],
    );
  }

  /**
   * History of every provider who has seen or been scheduled for this patient —
   * derived from encounters and appointments, newest first.
   */
  async getAttendingHistory(pid: number): Promise<any[]> {
    return this.dataSource.query(
      `SELECT u.id,
              CONCAT(COALESCE(u.fname,''), ' ', COALESCE(u.lname,'')) AS name,
              u.title AS role,
              MAX(x.last_seen) AS last_seen,
              SUM(x.visits) AS visits
       FROM (
         SELECT provider_id AS uid, MAX(date) AS last_seen, COUNT(*) AS visits
         FROM form_encounter WHERE pid = ? AND provider_id IS NOT NULL AND provider_id > 0
         GROUP BY provider_id
         UNION ALL
         SELECT pc_aid AS uid, MAX(pc_eventDate) AS last_seen, COUNT(*) AS visits
         FROM openemr_postcalendar_events WHERE pc_pid = ? AND pc_aid IS NOT NULL AND pc_aid > 0
         GROUP BY pc_aid
       ) x
       JOIN users u ON u.id = x.uid
       GROUP BY u.id, u.fname, u.lname, u.title
       ORDER BY last_seen DESC`,
      [pid, pid],
    );
  }

  async getPendingPatients(): Promise<any[]> {
    const rows = await this.dataSource.query(
      `SELECT pd.id, pd.pid, pd.fname, pd.lname, pd.DOB, pd.sex,
              pd.phone_contact, pd.street, pd.city, pd.providerID,
              pd.regdate, pd.created_by, pd.status,
              (SELECT COUNT(*) FROM form_vitals WHERE pid = pd.pid) as vitals_count,
              (SELECT MAX(date) FROM form_vitals WHERE pid = pd.pid) as last_vital_date,
              TIMESTAMPDIFF(MINUTE, pd.regdate, NOW()) as minutes_waiting
       FROM patient_data pd
       WHERE pd.status = 'pending'
       ORDER BY pd.regdate ASC`,
    );
    // The registrar list highlights the charts that are still incomplete.
    return rows.map((row: any) => withChartStatus(row));
  }

  async approvePatient(
    id: number,
    providerId?: number | string,
    opts?: { insuranceType?: string; patientPercent?: number },
  ): Promise<{ message: string; providerId?: number; providerName?: string; appointment?: any; encounterId?: number | null; insuranceType?: string; patientPercent?: number }> {
    // Auto-assign to the requested provider, or to the least-busy active physician
    // available for patient intake.
    const provider = await this.pickProvider(providerId);
    const finalProviderId = provider?.id ?? null;

    // Registrar sets coverage at approval: 'insured' (split) or 'self_pay' (full bill).
    const insuranceType = opts?.insuranceType === 'insured' ? 'insured' : 'self_pay';
    const patientPercent = insuranceType === 'insured'
      ? Math.min(100, Math.max(0, Math.round(Number(opts?.patientPercent ?? 40))))
      : 100;

    const sets = [`status = 'active'`, `approved_at = NOW()`,
      `insurance_type = ?`, `patient_responsibility_percent = ?`];
    const params: any[] = [insuranceType, patientPercent];
    if (finalProviderId) { sets.push('providerID = ?'); params.push(finalProviderId); }
    params.push(id);
    await this.dataSource.query(
      `UPDATE patient_data SET ${sets.join(', ')} WHERE id = ?`,
      params,
    );

    const [patient] = await this.dataSource.query(
      `SELECT pid FROM patient_data WHERE id = ?`,
      [id],
    );

    // Create an admission encounter so the patient appears in billing from inception.
    let encounterId: number | null = null;
    if (patient?.pid) {
      const [maxEnc] = await this.dataSource.query(
        `SELECT COALESCE(MAX(encounter), 0) + 1 AS nextEnc FROM form_encounter`,
      );
      const nextEncounter = Number(maxEnc?.nextEnc) || 1;
      // Resolved rather than hardcoded: the previous literal 5 was deleted from
      // the categories table, leaving every encounter with no category.
      const visitCategoryId = await resolveVisitCategoryId(this.dataSource, 5);
      const enc = await this.dataSource.query(
        `INSERT INTO form_encounter (pid, date, reason, encounter, pc_catid, provider_id, encounter_type_code, encounter_type_description)
         VALUES (?, NOW(), 'Intake / Triage', ?, ?, ?, 'AMB', 'Intake / Triage')`,
        [patient.pid, nextEncounter, visitCategoryId, finalProviderId || 0],
      );
      encounterId = enc.insertId;

      // Registration charge
      await this.dataSource.query(
        `INSERT INTO billing (date, encounter, code_type, code, pid, provider_id, user, groupname, authorized, activity, fee, units, billed)
         VALUES (NOW(), ?, 'HCPCS', 'REG', ?, 1, 1, 'Default', 1, 1, 25, 1, 1)`,
        [encounterId, patient.pid],
      );
    }

    let appointment: any = null;
    if (finalProviderId && patient?.pid) {
      appointment = await this.scheduleIntake(patient.pid, finalProviderId);
    }

    return {
      message: 'approved',
      providerId: finalProviderId ?? undefined,
      providerName: provider ? `${provider.fname} ${provider.lname}`.trim() : undefined,
      appointment,
      encounterId,
      insuranceType,
      patientPercent,
    };
  }

  /** Update a patient's insurance coverage (registrar / billing / admin). */
  async updateInsuranceCoverage(pid: number, dto: { insuranceType?: string; patientPercent?: number }) {
    const insuranceType = dto?.insuranceType === 'insured' ? 'insured' : 'self_pay';
    const patientPercent = insuranceType === 'insured'
      ? Math.min(100, Math.max(0, Math.round(Number(dto?.patientPercent ?? 40))))
      : 100;
    await this.dataSource.query(
      `UPDATE patient_data SET insurance_type = ?, patient_responsibility_percent = ? WHERE pid = ?`,
      [insuranceType, patientPercent, pid],
    );
    return { pid, insuranceType, patientPercent };
  }

  /** Pick the requested provider, or auto-select the least-busy active physician. */
  private async pickProvider(providerId?: number | string): Promise<{ id: number; fname: string; lname: string } | null> {
    if (providerId) {
      const rows = await this.dataSource.query(
        `SELECT id, fname, lname FROM users WHERE id = ? AND active = 1 LIMIT 1`,
        [providerId],
      );
      return rows[0] || null;
    }
    const rows = await this.dataSource.query(
      `SELECT u.id, u.fname, u.lname,
              (SELECT COUNT(*) FROM openemr_postcalendar_events e
               WHERE e.pc_aid = u.id AND e.pc_eventDate = CURDATE()
                 AND e.pc_apptstatus NOT IN ('Canceled','No Show')) AS booked_today
       FROM users u
       WHERE u.active = 1 AND u.main_menu_role = 'standard'
       ORDER BY booked_today ASC, u.id ASC
       LIMIT 1`,
    );
    return rows[0] || null;
  }

  /** Schedule a 30-minute "Patient Intake" slot on the provider's calendar. */
  private async scheduleIntake(pid: number, providerId: number): Promise<{ id: number; startTime: string } | null> {
    const [cat] = await this.dataSource.query(
      `SELECT pc_catid FROM openemr_postcalendar_categories WHERE pc_active = 1 ORDER BY pc_catid ASC LIMIT 1`,
    );
    const catId = cat?.pc_catid || 1;

    const toMin = (t?: string | null): number => {
      const [h = 0, m = 0] = String(t || '').substring(0, 5).split(':').map(Number);
      return h * 60 + (m || 0);
    };
    const toHHMM = (mins: number): string =>
      `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

    // 1. Provider "In Office" availability windows for today (fall back to 08:00–17:00).
    const officeRows = await this.dataSource.query(
      `SELECT e.pc_startTime, e.pc_endTime
       FROM openemr_postcalendar_events e
       JOIN openemr_postcalendar_categories c ON e.pc_catid = c.pc_catid
       WHERE e.pc_eventDate = CURDATE() AND e.pc_aid = ? AND c.pc_cattype = 2 AND c.pc_active = 1
       ORDER BY e.pc_startTime`,
      [providerId],
    );
    const officeRanges: { start: number; end: number }[] = officeRows.length
      ? officeRows.map((r: any) => ({ start: toMin(r.pc_startTime), end: toMin(r.pc_endTime) }))
      : [{ start: toMin('08:00'), end: toMin('17:00') }];

    // 2. Busy intervals with true overlap detection (not just matching start times).
    const busyRows = await this.dataSource.query(
      `SELECT pc_startTime, pc_endTime, pc_duration
       FROM openemr_postcalendar_events
       WHERE pc_aid = ? AND pc_eventDate = CURDATE() AND pc_apptstatus NOT IN ('Canceled','No Show')
       ORDER BY pc_startTime`,
      [providerId],
    );
    const busy: { start: number; end: number }[] = busyRows.map((e: any) => {
      const start = toMin(e.pc_startTime);
      const end = e.pc_endTime ? toMin(e.pc_endTime) : start + (Number(e.pc_duration) || 30);
      return { start, end };
    });

    const overlaps = (start: number): boolean => {
      const end = start + 30;
      return busy.some(b => start < b.end && end > b.start);
    };

    // 3. First free 30-minute slot within the provider's office hours.
    let slotMin: number | null = null;
    for (const range of officeRanges) {
      for (let t = range.start; t + 30 <= range.end; t += 30) {
        if (!overlaps(t)) { slotMin = t; break; }
      }
      if (slotMin !== null) break;
    }

    // 4. Overflow: if every in-office slot is taken, place the intake right after
    //    the provider's last appointment so the patient still lands on today's calendar.
    if (slotMin === null && busy.length) {
      slotMin = Math.max(...busy.map(b => b.end));
    }
    const startTime = slotMin !== null ? toHHMM(slotMin) : '09:00';

    const result = await this.dataSource.query(
      `INSERT INTO openemr_postcalendar_events
        (pc_catid, pc_aid, pc_pid, pc_title, pc_hometext, pc_eventDate,
         pc_startTime, pc_duration, pc_apptstatus, pc_facility, pc_billing_location,
         pc_time, pc_eventstatus, pc_multiple)
       VALUES (?, ?, ?, 'Patient Intake', ?, CURDATE(), ?, 30, '-', 0, 0, NOW(), 0, 1)`,
      [catId, providerId, pid, 'Auto-scheduled intake after registrar approval', startTime],
    );
    return { id: result.insertId, startTime };
  }

  async getRecentlyApproved(): Promise<any[]> {
    return this.dataSource.query(
      `SELECT pd.id, pd.pid, pd.fname, pd.lname, pd.DOB, pd.sex,
              pd.regdate, pd.status, pd.public_id,
              pd.approved_at,
              TIMESTAMPDIFF(MINUTE, COALESCE(pd.approved_at, pd.regdate), NOW()) as minutes_ago
       FROM patient_data pd
       WHERE pd.status = 'active'
       ORDER BY COALESCE(pd.approved_at, pd.regdate) DESC
       LIMIT 15`,
    );
  }

  async update(id: number, dto: Partial<CreatePatientDto>, isAdmin = false): Promise<void> {
    // The SPA sends the `Patient` type's names (dob/phone/provider/zip), but the
    // columns are DOB/phone_contact/providerID/postal_code. Without this mapping
    // those edits were silently discarded — the save reported success and
    // nothing changed.
    const COLUMN_ALIASES: Record<string, string> = {
      dob: 'DOB',
      phone: 'phone_contact',
      provider: 'providerID',
      zip: 'postal_code',
    };

    // Accept both spellings; the real column name wins if both are sent.
    const resolved = new Map<string, any>();
    for (const [key, value] of Object.entries(dto)) {
      if (value === undefined) continue;
      const column = COLUMN_ALIASES[key] || key;
      if (key === column || !resolved.has(column)) resolved.set(column, value);
    }

    // Check 30-day edit window for identity fields. Address, phone and provider
    // are deliberately excluded: they are the details needed to *complete* a
    // chart, so they must stay editable on the whole existing register.
    const identityFields = ['fname', 'lname', 'mname', 'DOB', 'sex'];
    const isEditingIdentity = identityFields.some(f => resolved.has(f));
    if (isEditingIdentity && !isAdmin) {
      const [patient] = await this.dataSource.query(
        `SELECT regdate FROM patient_data WHERE id = ?`, [id],
      );
      if (patient?.regdate) {
        const daysSinceReg = Math.floor((Date.now() - new Date(patient.regdate).getTime()) / (1000 * 60 * 60 * 24));
        if (daysSinceReg > 30) {
          // A readable reason, not a bare Error → 500 that the UI could only
          // report as "Save failed" with no explanation.
          throw new ForbiddenException(
            `Name, date of birth and sex cannot be changed ${daysSinceReg} days after registration. ` +
              `An administrator can still make this change.`,
          );
        }
      }
    }

    const allowed = new Set<string>([
      'fname', 'lname', 'mname', 'DOB', 'sex', 'email',
      'phone_contact', 'street', 'city', 'state', 'postal_code',
      'providerID', 'ref_providerID',
    ]);

    const sets: string[] = [];
    const vals: any[] = [];
    for (const [column, value] of resolved) {
      if (!allowed.has(column)) continue;
      sets.push(`${column} = ?`);
      vals.push(value);
    }
    if (!sets.length) return;
    vals.push(id);
    await this.dataSource.query(
      `UPDATE patient_data SET ${sets.join(', ')} WHERE id = ?`,
      vals,
    );
  }
}
