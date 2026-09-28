import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export type AcuityLevel = 'routine' | 'urgent' | 'stat';

export interface RoutingDecision {
  acuityLevel: AcuityLevel;
  acuityScore: number;
  matchedKeywords: string[];
  assignedNurseId: number | null;
  assignedNurseName: string | null;
  chargeNurseId: number | null;
  chargeNurseName: string | null;
  reason: string;
}

/**
 * Smart clinical-note routing algorithm.
 *
 * 1) Acuity classification — keyword + vital-sign scoring determines how
 *    urgently a note must reach the nursing team (routine / urgent / stat).
 * 2) Nurse assignment — routes the note to the patient's assigned nurse, or
 *    when none exists, to the least-loaded active nurse (workload balancing).
 * 3) Charge-nurse designation — a supervising (most senior) nurse is also
 *    granted access so a nurse-in-charge always sees the note.
 */
@Injectable()
export class SmartRoutingService {
  private readonly logger = new Logger(SmartRoutingService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  private static readonly STAT_KEYWORDS = [
    'chest pain', 'shortness of breath', 'unresponsive', 'seizure',
    'hemorrhage', 'severe bleeding', 'anaphylaxis', 'cardiac arrest',
    'respiratory distress', 'stroke', 'stat', 'emergency',
  ];

  private static readonly URGENT_KEYWORDS = [
    'fever', 'dehydration', 'vomiting', 'diarrhea', 'abdominal pain',
    'dizziness', 'syncope', 'hypertension', 'high blood pressure',
    'infection', 'wheezing', 'urgent', 'severe pain', 'altered mental status',
  ];

  /** Classify note text (and optional vitals) into an acuity level. */
  classifyAcuity(
    note: string,
    vitals?: any,
  ): { level: AcuityLevel; score: number; matched: string[] } {
    const text = (note || '').toLowerCase();
    let score = 0;
    const matched: string[] = [];

    for (const kw of SmartRoutingService.STAT_KEYWORDS) {
      if (text.includes(kw)) {
        score += 30;
        matched.push(kw);
      }
    }
    for (const kw of SmartRoutingService.URGENT_KEYWORDS) {
      if (text.includes(kw)) {
        score += 15;
        matched.push(kw);
      }
    }

    if (vitals) {
      const sys = Number(vitals.bp_systolic || vitals.bps || 0);
      const o2 = Number(vitals.o2_sat || vitals.oxygen_saturation || 0);
      const temp = Number(vitals.temp || vitals.temperature || 0);
      const pulse = Number(vitals.pulse || 0);

      if (sys >= 180 || (o2 > 0 && o2 < 92)) score += 40;
      else if (sys >= 140 || (o2 > 0 && o2 < 95)) score += 20;
      if (temp > 39) score += 25;
      if (pulse > 120) score += 20;
    }

    const level: AcuityLevel =
      score >= 60 ? 'stat' : score >= 30 ? 'urgent' : 'routine';

    return { level, score, matched };
  }

  /** Return all active nurses ordered by seniority (earliest registered first). */
  private async getActiveNurses(): Promise<any[]> {
    return this.dataSource.query(
      `SELECT id, username, fname, lname, date_created
       FROM users
       WHERE active = 1 AND main_menu_role IN ('nurse', 'registered_nurse')
       ORDER BY date_created ASC, id ASC`,
    );
  }

  /**
   * Run the full routing algorithm for a patient note.
   * Returns the chosen nurses and acuity so callers can persist + notify.
   */
  async routePatient(
    pid: number,
    note: string,
    vitals?: any,
  ): Promise<RoutingDecision> {
    const { level, score, matched } = this.classifyAcuity(note, vitals);

    const nurses = await this.getActiveNurses();
    if (!nurses.length) {
      return {
        acuityLevel: level,
        acuityScore: score,
        matchedKeywords: matched,
        assignedNurseId: null,
        assignedNurseName: null,
        chargeNurseId: null,
        chargeNurseName: null,
        reason: 'No active registered nurses available for assignment',
      };
    }

    // Prefer the patient's existing assignment.
    const existing = await this.dataSource.query(
      `SELECT assigned_nurse_id, charge_nurse_id
       FROM patient_care_assignment WHERE pid = ?`,
      [pid],
    );

    let assignedNurseId: number | null =
      existing[0]?.assigned_nurse_id ?? null;
    let chargeNurseId: number | null = existing[0]?.charge_nurse_id ?? null;

    // If the existing assignment is stale/invalid, re-balance to the least-loaded nurse.
    if (!assignedNurseId || !nurses.some((n) => n.id === assignedNurseId)) {
      const loads = await this.dataSource.query(
        `SELECT assigned_nurse_id, COUNT(*) AS cnt
         FROM patient_care_assignment
         WHERE assigned_nurse_id IS NOT NULL
         GROUP BY assigned_nurse_id`,
      );
      const loadMap = new Map<number, number>(
        (loads as any[]).map((l) => [Number(l.assigned_nurse_id), Number(l.cnt)]),
      );
      assignedNurseId = nurses.reduce((best, n) => {
        const bestLoad = loadMap.get(Number(best.id)) || 0;
        const nLoad = loadMap.get(Number(n.id)) || 0;
        return nLoad < bestLoad ? n : best;
      }, nurses[0]).id;
    }

    // Charge nurse = most senior active nurse (excluding the assigned one when possible).
    if (!chargeNurseId || !nurses.some((n) => n.id === chargeNurseId)) {
      const others = nurses.filter((n) => n.id !== assignedNurseId);
      const pool = others.length ? others : nurses;
      chargeNurseId = pool[0].id;
    }

    const assigned = nurses.find((n) => n.id === assignedNurseId);
    const charge = nurses.find((n) => n.id === chargeNurseId);

    return {
      acuityLevel: level,
      acuityScore: score,
      matchedKeywords: matched,
      assignedNurseId,
      assignedNurseName: assigned ? `${assigned.fname} ${assigned.lname}` : null,
      chargeNurseId,
      chargeNurseName: charge ? `${charge.fname} ${charge.lname}` : null,
      reason: `Acuity score ${score} (${level})${
        matched.length ? ` — matched: ${matched.join(', ')}` : ''
      }`,
    };
  }

  /** Persist (upsert) the routing decision for a patient. */
  async persistAssignment(
    pid: number,
    decision: RoutingDecision,
    updatedBy?: number | null,
  ): Promise<void> {
    try {
      await this.dataSource.query(
        `INSERT INTO patient_care_assignment
           (pid, assigned_nurse_id, charge_nurse_id, acuity_level, acuity_score, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, NOW(), ?)
         ON DUPLICATE KEY UPDATE
           assigned_nurse_id = VALUES(assigned_nurse_id),
           charge_nurse_id   = VALUES(charge_nurse_id),
           acuity_level      = VALUES(acuity_level),
           acuity_score      = VALUES(acuity_score),
           updated_at        = NOW(),
           updated_by        = VALUES(updated_by)`,
        [
          pid,
          decision.assignedNurseId,
          decision.chargeNurseId,
          decision.acuityLevel,
          decision.acuityScore,
          updatedBy || null,
        ],
      );
    } catch (err) {
      this.logger.warn(`Failed to persist assignment for patient #${pid}: ${err}`);
    }
  }

  /** Create the assignment table if it does not yet exist. */
  async ensureSchema(): Promise<void> {
    try {
      await this.dataSource.query(
        `CREATE TABLE IF NOT EXISTS patient_care_assignment (
           pid INT NOT NULL PRIMARY KEY,
           room VARCHAR(64) DEFAULT NULL,
           assigned_nurse_id INT DEFAULT NULL,
           charge_nurse_id INT DEFAULT NULL,
           acuity_level VARCHAR(16) DEFAULT 'routine',
           acuity_score INT DEFAULT 0,
           updated_at DATETIME DEFAULT NULL,
           updated_by INT DEFAULT NULL
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      );
      this.logger.log('Ensured patient_care_assignment table exists');
    } catch (err) {
      this.logger.warn(`Could not ensure patient_care_assignment table: ${err}`);
    }
  }
}
