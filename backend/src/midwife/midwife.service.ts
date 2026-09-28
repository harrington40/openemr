import {
  Injectable,
  Logger,
  OnModuleInit,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  computeRisk,
  eddFromLmp,
  gestationFromLmp,
  apgarTotal,
  interpretApgar,
  type ApgarSet,
} from './midwife-scoring.util';
import { maternityEligibility, sexKind } from '../patients/maternity-eligibility.util';

export type AssessmentKind = 'risk' | 'edd' | 'apgar';

export interface SaveAssessmentDto {
  kind: AssessmentKind;
  /** Risk inputs — the score is recomputed here, not trusted from the client. */
  risk?: {
    age: number; parity: number; gestationWeeks: number;
    bpSystolic: number; bpDiastolic: number; hemoglobin: number;
    hasDiabetes: boolean; hasPreeclampsia: boolean;
  };
  lmp?: string;
  /**
   * Cycle length for the EDD correction, in days. Optional; omitted means the
   * 28-day assumption of Naegele's rule.
   */
  cycleLengthDays?: number;
  /** APGAR is documented twice: at one minute and at five minutes. */
  apgar?: { oneMinute?: ApgarSet; fiveMinute?: ApgarSet };
}

const KINDS: AssessmentKind[] = ['risk', 'edd', 'apgar'];

@Injectable()
export class MidwifeService implements OnModuleInit {
  private readonly logger = new Logger(MidwifeService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    await this.ensureSchema();
  }

  private async ensureSchema(): Promise<void> {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS midwife_assessments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        pid INT NOT NULL COMMENT 'OpenEMR patient_data.pid',
        patient_id INT NULL COMMENT 'patient_data.id, for chart links',
        kind VARCHAR(16) NOT NULL COMMENT 'risk | edd | apgar',
        summary VARCHAR(255) NOT NULL,
        score INT NULL,
        level VARCHAR(24) NULL,
        apgar_1_total INT NULL,
        apgar_5_total INT NULL,
        detail JSON NULL,
        author_id INT NULL,
        author_name VARCHAR(120) NULL,
        recorded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_mw_pid (pid, recorded_at),
        INDEX idx_mw_kind (kind)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    this.logger.log('midwife_assessments schema ready');
  }

  /** Resolves the patient the assessment is filed against. */
  private async resolvePatient(pid: number) {
    const rows = await this.dataSource.query(
      `SELECT id, pid, fname, lname, DOB, sex FROM patient_data WHERE pid = ? LIMIT 1`,
      [pid],
    );
    if (!rows || rows.length === 0) {
      throw new NotFoundException(`Patient #${pid} not found`);
    }
    return rows[0] as { id: number; pid: number; fname: string; lname: string; DOB: string | null; sex: string | null };
  }

  /**
   * Whether this patient has a maternity record at all. Read by the chart before
   * it offers the Maternity tab, and by the dashboard before it offers a patient.
   */
  async getEligibility(pid: number) {
    const patient = await this.resolvePatient(pid);
    return {
      pid: patient.pid,
      patient: `${patient.fname} ${patient.lname}`.trim(),
      ...maternityEligibility(patient),
    };
  }

  async saveAssessment(
    pid: number,
    dto: SaveAssessmentDto,
    author?: { id?: number; name?: string },
  ) {
    if (!dto?.kind || !KINDS.includes(dto.kind)) {
      throw new BadRequestException(`kind must be one of: ${KINDS.join(', ')}`);
    }
    const patient = await this.resolvePatient(pid);

    // A maternity assessment filed against a recorded male is always a charting
    // error — the wrong patient selected, or a chart opened by the wrong link.
    // Anything less clear-cut (sex unrecorded, or a female below the usual
    // childbearing age) is allowed through: the UI hides those surfaces, but a
    // clinician who deliberately reaches the API should not be blocked.
    if (sexKind(patient.sex) === 'male') {
      throw new BadRequestException(
        `Maternity assessments cannot be filed for ${patient.fname} ${patient.lname} — this chart is recorded as male (PID ${patient.pid}).`,
      );
    }

    let summary = '';
    let score: number | null = null;
    let level: string | null = null;
    let apgar1: number | null = null;
    let apgar5: number | null = null;
    let detail: Record<string, any> = {};

    if (dto.kind === 'risk') {
      const r = dto.risk;
      if (!r) throw new BadRequestException('risk inputs are required');
      for (const key of ['age', 'parity', 'gestationWeeks', 'bpSystolic', 'bpDiastolic', 'hemoglobin']) {
        const value = Number((r as any)[key]);
        if (!Number.isFinite(value) || value < 0) {
          throw new BadRequestException(`${key} must be a number of 0 or more`);
        }
      }
      // Recomputed here so the stored score is not simply what the browser sent.
      const result = computeRisk({
        age: Number(r.age), parity: Number(r.parity), gestationWeeks: Number(r.gestationWeeks),
        bpSystolic: Number(r.bpSystolic), bpDiastolic: Number(r.bpDiastolic),
        hemoglobin: Number(r.hemoglobin),
        hasDiabetes: !!r.hasDiabetes, hasPreeclampsia: !!r.hasPreeclampsia,
      });
      score = result.score;
      level = result.level;
      summary = `Risk ${result.label} (score ${result.score})`;
      detail = { inputs: r };
    } else if (dto.kind === 'edd') {
      if (!dto.lmp) throw new BadRequestException('lmp is required');
      // Naegele's rule assumes a 28-day cycle; a longer cycle dates later. The
      // cycle length is validated here as well as clamped in the utility, so an
      // impossible value is rejected rather than silently ignored.
      if (dto.cycleLengthDays != null) {
        const cycle = Number(dto.cycleLengthDays);
        if (!Number.isFinite(cycle) || cycle < 20 || cycle > 45) {
          throw new BadRequestException('cycleLengthDays must be between 20 and 45');
        }
      }
      const edd = eddFromLmp(dto.lmp, dto.cycleLengthDays);
      if (!edd) throw new BadRequestException('lmp is not a usable date');
      const gest = gestationFromLmp(dto.lmp);
      const cycleNote = dto.cycleLengthDays != null ? `, ${dto.cycleLengthDays}-day cycle` : '';
      summary = `EDD ${edd} (${gest.weeks}w ${gest.days}d at recording${cycleNote})`;
      detail = { lmp: dto.lmp, edd, gestationWeeks: gest.weeks, gestationDays: gest.days,
        cycleLengthDays: dto.cycleLengthDays ?? null };
    } else {
      const set1 = dto.apgar?.oneMinute;
      const set5 = dto.apgar?.fiveMinute;
      if (!set1 && !set5) {
        throw new BadRequestException('at least one APGAR set (1 minute or 5 minutes) is required');
      }
      for (const [label, set] of [['1 minute', set1], ['5 minutes', set5]] as const) {
        if (!set) continue;
        for (const [key, value] of Object.entries(set)) {
          const n = Number(value);
          if (!Number.isInteger(n) || n < 0 || n > 2) {
            throw new BadRequestException(`${label} APGAR ${key} must be 0, 1 or 2`);
          }
        }
      }
      apgar1 = set1 ? apgarTotal(set1) : null;
      apgar5 = set5 ? apgarTotal(set5) : null;
      // The 5-minute score carries the interpretation; fall back to the 1-minute
      // score when only that was recorded.
      const primary = apgar5 ?? apgar1 ?? 0;
      score = primary;
      level = interpretApgar(primary);
      summary = [
        apgar1 !== null ? `APGAR 1min ${apgar1}` : null,
        apgar5 !== null ? `APGAR 5min ${apgar5}` : null,
        `— ${level}`,
      ].filter(Boolean).join(' · ');
      detail = { oneMinute: set1 ?? null, fiveMinute: set5 ?? null };
    }

    // Guard against duplicate records — a double-clicked Save, or an impatient
    // re-click, otherwise files the same assessment repeatedly. Matches the
    // existing billing guard, widened a little because this is a clinical entry.
    // Compared on the scalar columns rather than the JSON payload, so a re-sent
    // request with the same inputs in a different key order still matches.
    const duplicate = await this.dataSource.query(
      `SELECT id, pid, kind, summary, score, level, apgar_1_total, apgar_5_total, recorded_at
         FROM midwife_assessments
        WHERE pid = ? AND kind = ? AND summary = ?
          AND score <=> ? AND level <=> ?
          AND apgar_1_total <=> ? AND apgar_5_total <=> ?
          AND recorded_at >= DATE_SUB(NOW(), INTERVAL 5 MINUTE)
        ORDER BY id ASC LIMIT 1`,
      [patient.pid, dto.kind, summary, score, level, apgar1, apgar5],
    );
    if (duplicate.length) {
      this.logger.warn(
        `Duplicate ${dto.kind} assessment skipped for pid=${patient.pid}: "${summary}" ` +
          `already recorded as #${duplicate[0].id}`,
      );
      return { ...duplicate[0], duplicate: true };
    }

    const result = await this.dataSource.query(
      `INSERT INTO midwife_assessments
        (pid, patient_id, kind, summary, score, level, apgar_1_total, apgar_5_total,
         detail, author_id, author_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        patient.pid, patient.id, dto.kind, summary, score, level, apgar1, apgar5,
        JSON.stringify(detail), author?.id ?? null, author?.name ?? null,
      ],
    );

    return {
      id: result.insertId,
      pid: patient.pid,
      kind: dto.kind,
      summary,
      score,
      level,
      apgar_1_total: apgar1,
      apgar_5_total: apgar5,
    };
  }


  async listAssessments(pid: number) {
    return this.dataSource.query(
      `SELECT id, pid, patient_id, kind, summary, score, level,
              apgar_1_total, apgar_5_total, detail, author_name, recorded_at
       FROM midwife_assessments
       WHERE pid = ?
       ORDER BY recorded_at DESC, id DESC
       LIMIT 200`,
      [pid],
    );
  }

  async deleteAssessment(id: number) {
    const rows = await this.dataSource.query(
      `SELECT id FROM midwife_assessments WHERE id = ?`, [id],
    );
    if (!rows || rows.length === 0) {
      throw new NotFoundException(`Assessment #${id} not found`);
    }
    await this.dataSource.query(`DELETE FROM midwife_assessments WHERE id = ?`, [id]);
    return { message: 'Assessment deleted', id };
  }
}

