import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/** NEWS2-style aggregate early-warning score from the latest vitals. */
function news2(v: any): { score: number; level: 'low' | 'medium' | 'high'; flags: string[] } {
  const flags: string[] = [];
  let score = 0;
  const num = (x: any) => (x === null || x === undefined || x === '' ? null : Number(x));

  const resp = num(v?.respiration);
  if (resp != null) {
    if (resp <= 8) { score += 3; flags.push('Low respiration'); }
    else if (resp <= 11) score += 1;
    else if (resp >= 25) { score += 3; flags.push('High respiration'); }
    else if (resp >= 21) score += 2;
  }
  const spo2 = num(v?.oxygen_saturation);
  if (spo2 != null) {
    if (spo2 <= 91) { score += 3; flags.push('Hypoxia'); }
    else if (spo2 <= 93) score += 2;
    else if (spo2 <= 95) score += 1;
  }
  const temp = num(v?.temperature);
  if (temp != null) {
    const c = temp > 45 ? (temp - 32) * 5 / 9 : temp;
    if (c <= 35) { score += 3; flags.push('Hypothermia'); }
    else if (c <= 36) score += 1;
    else if (c >= 39.1) { score += 2; flags.push('High fever'); }
    else if (c >= 38.1) score += 1;
  }
  const sys = num(v?.bps);
  if (sys != null) {
    if (sys <= 90) { score += 3; flags.push('Hypotension'); }
    else if (sys <= 100) score += 2;
    else if (sys <= 110) score += 1;
    else if (sys >= 220) { score += 3; flags.push('Severe hypertension'); }
  }
  const pulse = num(v?.pulse);
  if (pulse != null) {
    if (pulse <= 40) { score += 3; flags.push('Bradycardia'); }
    else if (pulse <= 50) score += 1;
    else if (pulse >= 131) { score += 3; flags.push('Tachycardia'); }
    else if (pulse >= 111) score += 2;
    else if (pulse >= 91) score += 1;
  }

  const level = score >= 7 ? 'high' : score >= 5 ? 'medium' : 'low';
  return { score, level, flags };
}

const dayMs = 24 * 60 * 60 * 1000;

@Injectable()
export class InpatientService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Real inpatients: any patient currently assigned to a room. */
  async getOverview() {
    const rows = await this.dataSource.query(
      `SELECT pd.id, pd.pid, pd.fname, pd.lname, pd.mname, pd.suffix, pd.DOB, pd.sex, pd.public_id,
              ca.room, ca.acuity_level, ca.acuity_score, ca.assigned_nurse_id,
              ca.updated_at,
              v.bps, v.bpd, v.pulse, v.temperature, v.respiration, v.oxygen_saturation, v.weight, v.height, v.BMI,
              DATE_FORMAT(v.date, '%Y-%m-%d %H:%i') AS last_vital_date,
              CONCAT(COALESCE(u.fname,''), ' ', COALESCE(u.lname,'')) AS provider_name
         FROM patient_care_assignment ca
         JOIN patient_data pd ON pd.pid = ca.pid
         LEFT JOIN users u ON u.id = pd.providerID
         LEFT JOIN form_vitals v ON v.id = (
            SELECT id FROM form_vitals WHERE pid = pd.pid ORDER BY date DESC, id DESC LIMIT 1)
        WHERE ca.room IS NOT NULL AND ca.room <> ''
        ORDER BY pd.lname, pd.fname`,
    ).catch(async () => {
      // Fallback in case an unexpected column is missing.
      return this.dataSource.query(
        `SELECT pd.id, pd.pid, pd.fname, pd.lname, pd.mname, pd.suffix, pd.DOB, pd.sex, pd.public_id,
                ca.room, ca.acuity_level, ca.acuity_score, ca.assigned_nurse_id, ca.updated_at,
                v.bps, v.bpd, v.pulse, v.temperature, v.respiration, v.oxygen_saturation, v.weight, v.height, v.BMI,
                DATE_FORMAT(v.date, '%Y-%m-%d %H:%i') AS last_vital_date,
                CONCAT(COALESCE(u.fname,''), ' ', COALESCE(u.lname,'')) AS provider_name
           FROM patient_care_assignment ca
           JOIN patient_data pd ON pd.pid = ca.pid
           LEFT JOIN users u ON u.id = pd.providerID
           LEFT JOIN form_vitals v ON v.id = (
              SELECT id FROM form_vitals WHERE pid = pd.pid ORDER BY date DESC, id DESC LIMIT 1)
          WHERE ca.room IS NOT NULL AND ca.room <> ''
          ORDER BY pd.lname, pd.fname`,
      );
    });

    const inpatients = (rows as any[]).map((r) => {
      const risk = news2(r);
      const since = r.updated_at ? Math.floor((Date.now() - new Date(r.updated_at).getTime()) / dayMs) : null;
      return {
        pid: r.pid,
        id: r.id,
        fname: r.fname,
        lname: r.lname,
        mname: r.mname,
        suffix: r.suffix,
        DOB: r.DOB,
        sex: r.sex,
        public_id: r.public_id,
        room: r.room,
        acuity_level: r.acuity_level,
        acuity_score: r.acuity_score,
        assigned_nurse_id: r.assigned_nurse_id,
        since: r.updated_at,
        los_days: since,
        risk,
        last_vital_date: r.last_vital_date,
        provider_name: r.provider_name?.trim() || null,
      };
    });

    const total = inpatients.length;
    const highRisk = inpatients.filter((p) => p.risk.level === 'high').length;
    const staleVitals = inpatients.filter((p) => {
      if (!p.last_vital_date) return true;
      return Date.now() - new Date(p.last_vital_date).getTime() > 8 * 60 * 60 * 1000;
    }).length;
    const longStay = inpatients.filter((p) => (p.los_days ?? 0) > 7).length;

    return {
      inpatients,
      summary: {
        total,
        highRisk,
        staleVitals,
        longStay,
        lastUpdated: new Date().toISOString(),
      },
    };
  }
}
