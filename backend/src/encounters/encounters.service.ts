import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { normaliseVitals, vitalsInsertParams } from '../common/vitals.util';

export interface EncounterRow {
  id: number;
  uuid: string | null;
  date: string | null;
  reason: string | null;
  facility: string | null;
  facility_id: number;
  pid: number;
  onset_date: string | null;
  sensitivity: string | null;
  billing_note: string | null;
  pc_catid: number;
  last_level_billed: number;
  last_level_closed: number;
  last_stmt_date: string | null;
  stmt_count: number;
  provider_id: number;
  supervisor_id: number;
  invoice_refno: string;
  referral_source: string;
  billing_facility: number;
  external_id: string | null;
  pos_code: number | null;
  class_code: string;
}

export interface VitalRow {
  id: number;
  uuid: string | null;
  date: string | null;
  pid: number;
  bps: string | null;
  bpd: string | null;
  weight: number;
  height: number;
  temperature: number;
  pulse: number;
  respiration: number;
  BMI: number;
  BMI_status: string | null;
  oxygen_saturation: number;
  note: string | null;
}

export interface SoapRow {
  id: number;
  date: string | null;
  pid: number;
  subjective: string | null;
  objective: string | null;
  assessment: string | null;
  plan: string | null;
}

export interface CreateEncounterDto {
  date?: string;
  onset_date?: string;
  reason?: string;
  facility?: string;
  facility_id?: number;
  pc_catid?: number;
  billing_facility?: number;
  sensitivity?: string;
  referral_source?: string;
  pos_code?: number;
  external_id?: string;
  provider_id?: number;
  class_code?: string;
}

@Injectable()
export class EncountersService {
  constructor(@InjectDataSource() private dataSource: DataSource) {}

  async findByPatient(pid: number): Promise<EncounterRow[]> {
    return this.dataSource.query(
      `SELECT id, LOWER(HEX(uuid)) as uuid, date, reason, facility, facility_id,
        pid, onset_date, sensitivity, billing_note, pc_catid,
        last_level_billed, last_level_closed, last_stmt_date, stmt_count,
        provider_id, supervisor_id, invoice_refno, referral_source,
        billing_facility, external_id, pos_code, class_code
      FROM form_encounter WHERE pid = ? ORDER BY date DESC`,
      [pid],
    );
  }

  async findOne(pid: number, eid: number): Promise<EncounterRow> {
    const rows = await this.dataSource.query(
      `SELECT id, LOWER(HEX(uuid)) as uuid, date, reason, facility, facility_id,
        pid, onset_date, sensitivity, billing_note, pc_catid,
        last_level_billed, last_level_closed, last_stmt_date, stmt_count,
        provider_id, supervisor_id, invoice_refno, referral_source,
        billing_facility, external_id, pos_code, class_code
      FROM form_encounter WHERE pid = ? AND id = ?`,
      [pid, eid],
    );
    if (!rows.length) {
      throw new NotFoundException(`Encounter #${eid} not found for patient #${pid}`);
    }
    return rows[0];
  }

  async create(pid: number, dto: CreateEncounterDto): Promise<{ id: number }> {
    const result = await this.dataSource.query(
      `INSERT INTO form_encounter
        (pid, date, onset_date, reason, facility, facility_id, pc_catid,
         billing_facility, sensitivity, referral_source, pos_code,
         external_id, provider_id, class_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        pid,
        dto.date || new Date().toISOString().split('T')[0],
        dto.onset_date || null,
        dto.reason || '',
        dto.facility || '',
        dto.facility_id || 0,
        dto.pc_catid || 5,
        dto.billing_facility || 0,
        dto.sensitivity || 'normal',
        dto.referral_source || '',
        dto.pos_code || 0,
        dto.external_id || null,
        dto.provider_id || 0,
        dto.class_code || 'AMB',
      ],
    );
    return { id: result.insertId };
  }

  async update(pid: number, eid: number, dto: Partial<CreateEncounterDto>): Promise<void> {
    const sets: string[] = [];
    const vals: any[] = [];
    const fields: (keyof CreateEncounterDto)[] = [
      'date', 'onset_date', 'reason', 'facility', 'facility_id',
      'pc_catid', 'billing_facility', 'sensitivity', 'referral_source',
      'pos_code', 'external_id', 'provider_id', 'class_code',
    ];
    for (const f of fields) {
      if (dto[f] !== undefined) {
        sets.push(`${f} = ?`);
        vals.push(dto[f]);
      }
    }
    if (!sets.length) return;
    vals.push(pid, eid);
    await this.dataSource.query(
      `UPDATE form_encounter SET ${sets.join(', ')} WHERE pid = ? AND id = ?`,
      vals,
    );
  }

  // --- Vitals ---

  async getVitals(pid: number, eid: number): Promise<VitalRow[]> {
    return this.dataSource.query(
      `SELECT id, LOWER(HEX(uuid)) as uuid, date, pid, bps, bpd,
        weight, height, temperature, pulse, respiration,
        BMI, BMI_status, oxygen_saturation, note
      FROM form_vitals WHERE pid = ? AND id = ?`,
      [pid, eid],
    );
  }

  async createVital(pid: number, eid: number, dto: any): Promise<{ vid: number }> {
    const { row, invalid, hasReading } = normaliseVitals(dto);

    if (invalid.length) {
      throw new BadRequestException(`${invalid.join(', ')} must be greater than 0.`);
    }
    if (!hasReading) {
      throw new BadRequestException(
        'No vital signs supplied — refusing to record an empty vitals row.',
      );
    }

    const result = await this.dataSource.query(
      `INSERT INTO form_vitals
        (pid, date, bps, bpd, weight, height, temperature, pulse, respiration,
         BMI, BMI_status, oxygen_saturation, note, activity, authorized)
       VALUES (?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
      [pid, ...vitalsInsertParams(row)],
    );
    return { vid: result.insertId };
  }

  // --- SOAP Notes ---

  async getSoapNotes(pid: number, eid: number): Promise<SoapRow[]> {
    return this.dataSource.query(
      `SELECT id, date, pid, subjective, objective, assessment, plan
      FROM form_soap WHERE pid = ? AND id = ?`,
      [pid, eid],
    );
  }

  async createSoap(pid: number, eid: number, dto: any) {
    const result = await this.dataSource.query(
      `INSERT INTO form_soap (pid, date, subjective, objective, assessment, plan, activity, authorized)
       VALUES (?, NOW(), ?, ?, ?, ?, 1, 1)`,
      [pid, dto.subjective || '', dto.objective || '', dto.assessment || '', dto.plan || ''],
    );
    return { id: result.insertId };
  }

  async updateSoap(id: number, dto: any) {
    const sets: string[] = []; const vals: any[] = [];
    for (const f of ['subjective', 'objective', 'assessment', 'plan']) {
      if (dto[f] !== undefined) { sets.push(`${f} = ?`); vals.push(dto[f]); }
    }
    if (!sets.length) return;
    vals.push(id);
    await this.dataSource.query(`UPDATE form_soap SET ${sets.join(', ')} WHERE id = ?`, vals);
  }

  // --- Review of Systems ---

  async getRos(pid: number) {
    return this.dataSource.query(`SELECT * FROM form_ros WHERE pid = ? ORDER BY date DESC LIMIT 5`, [pid]);
  }

  async createRos(pid: number, dto: any) {
    const fields = ['weight_change','weakness','fatigue','fever','chills','night_sweats','insomnia',
      'chest_pain','palpitation','shortness_of_breath','cough','wheezing','nausea','vomiting',
      'diarrhea','constipation','abnormal_blood','diabetes','thyroid_problems','headache'];
    const cols: string[] = ['pid', 'date', 'activity'];
    const vals: any[] = [pid, new Date(), 1];
    for (const f of fields) {
      if (dto[f] !== undefined) { cols.push(f); vals.push(dto[f]); }
    }
    const result = await this.dataSource.query(
      `INSERT INTO form_ros (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, vals);
    return { id: result.insertId };
  }

  // --- Clinical Notes ---

  async getClinicalNotes(pid: number, eid: number) {
    return this.dataSource.query(
      `SELECT id, date, pid, encounter, code, codetext, description, clinical_notes_type, clinical_notes_category
      FROM form_clinical_notes WHERE pid = ? AND encounter = ? ORDER BY date DESC LIMIT 20`,
      [pid, String(eid)],
    );
  }

  async createClinicalNote(pid: number, eid: number, dto: any) {
    const result = await this.dataSource.query(
      `INSERT INTO form_clinical_notes (pid, encounter, date, code, codetext, description, clinical_notes_type, activity, authorized)
       VALUES (?, ?, NOW(), ?, ?, ?, ?, 1, 1)`,
      [pid, String(eid), dto.code || '', dto.codetext || '', dto.description || '', dto.clinical_notes_type || ''],
    );
    return { id: result.insertId };
  }

  // --- Care Plan ---

  async getCarePlan(pid: number) {
    return this.dataSource.query(
      `SELECT id, date, pid, code, codetext, description, care_plan_type, plan_status, date_end
      FROM form_care_plan WHERE pid = ? ORDER BY date DESC LIMIT 20`,
      [pid],
    );
  }

  async createCarePlan(pid: number, dto: any) {
    const id = Date.now();
    await this.dataSource.query(
      `INSERT INTO form_care_plan (id, pid, date, code, codetext, description, care_plan_type, plan_status, activity, authorized)
       VALUES (?, ?, NOW(), ?, ?, ?, ?, ?, 1, 1)`,
      [id, pid, dto.code || '', dto.codetext || '', dto.description || '', dto.care_plan_type || '', dto.plan_status || 'active'],
    );
    return { id };
  }
}
