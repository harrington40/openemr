import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface ReferralUser {
  sub: number;
  username: string;
  displayName?: string;
  role?: string;
}

interface SpecialtyRule {
  specialty: string;
  keywords: string[];
}

/** Keyword → specialty mapping used by the smart referral engine. */
const SPECIALTY_RULES: SpecialtyRule[] = [
  { specialty: 'Cardiology', keywords: ['chest pain', 'cardiac', 'heart', 'hypertension', 'arrhythmia', 'palpitation', 'cholesterol', 'coronary', 'angina'] },
  { specialty: 'Endocrinology', keywords: ['diabetes', 'thyroid', 'endocrine', 'hormone', 'glucose', 'insulin', 'adrenal'] },
  { specialty: 'Pulmonology', keywords: ['asthma', 'copd', 'lung', 'respiratory', 'breath', 'cough', 'pneumonia', 'bronchitis'] },
  { specialty: 'Neurology', keywords: ['neuro', 'seizure', 'migraine', 'headache', 'stroke', 'dementia', 'tremor', 'multiple sclerosis'] },
  { specialty: 'Orthopedics', keywords: ['bone', 'fracture', 'ortho', 'joint', 'knee', 'hip', 'back pain', 'arthritis', 'sprain'] },
  { specialty: 'Dermatology', keywords: ['skin', 'rash', 'dermatitis', 'eczema', 'psoriasis', 'acne', 'lesion'] },
  { specialty: 'Gastroenterology', keywords: ['abdominal', 'stomach', 'digestive', 'gastro', 'liver', 'hepatitis', 'ulcer', 'nausea', 'diarrhea'] },
  { specialty: 'Psychiatry', keywords: ['mental', 'depression', 'anxiety', 'psych', 'bipolar', 'schizophrenia', 'mood', 'suicidal'] },
  { specialty: 'Obstetrics / Midwifery', keywords: ['pregnancy', 'pregnant', 'obstetric', 'antenatal', 'delivery', 'maternal'] },
  { specialty: 'Nephrology', keywords: ['kidney', 'renal', 'dialysis', 'nephro'] },
  { specialty: 'Ophthalmology', keywords: ['eye', 'vision', 'glaucoma', 'cataract', 'retina'] },
  { specialty: 'ENT', keywords: ['ear', 'hearing', 'throat', 'sinus', 'tonsil', 'nose'] },
  { specialty: 'Oncology', keywords: ['cancer', 'tumor', 'oncology', 'malignant', 'biopsy'] },
  { specialty: 'Infectious Disease', keywords: ['infection', 'fever', 'hiv', 'tuberculosis', 'malaria', 'sepsis'] },
  { specialty: 'Urology', keywords: ['urology', 'prostate', 'bladder', 'urinary'] },
];

@Injectable()
export class ReferralsService {
  private readonly logger = new Logger(ReferralsService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Smart referral suggestion for a patient.
   * Returns the patient's conditions and clinical notes (sorted by date),
   * plus ranked specialist suggestions based on keyword matching.
   */
  async smartSuggest(pid: number) {
    const patients = await this.dataSource.query(
      `SELECT pid, fname, lname, DOB, sex FROM patient_data WHERE pid = ?`,
      [pid],
    );
    if (!patients.length) {
      throw new NotFoundException(`Patient #${pid} not found`);
    }
    const patient = patients[0];

    // Conditions / diagnoses
    const conditions = await this.dataSource.query(
      `SELECT id, title AS diagnosis, comments AS note, COALESCE(date, begdate) AS date
         FROM lists
        WHERE pid = ? AND type = 'medical_problem' AND activity = 1
        ORDER BY COALESCE(date, begdate) DESC
        LIMIT 30`,
      [pid],
    );

    // Clinical notes (pnotes) + encounters, merged and sorted by date DESC.
    const notes = await this.dataSource.query(
      `SELECT id, date, title, body
         FROM pnotes
        WHERE pid = ? AND deleted = 0
        ORDER BY date DESC
        LIMIT 20`,
      [pid],
    );
    const encounters = await this.dataSource.query(
      `SELECT encounter AS id, date, reason AS title
         FROM form_encounter
        WHERE pid = ?
        ORDER BY date DESC
        LIMIT 10`,
      [pid],
    );

    const clinicalNotes = [
      ...notes.map((n: any) => ({ ...n, kind: 'note' })),
      ...encounters.map((e: any) => ({ ...e, body: '', kind: 'encounter' })),
    ].sort((a: any, b: any) => {
      const da = a.date ? new Date(a.date).getTime() : 0;
      const db = b.date ? new Date(b.date).getTime() : 0;
      return db - da;
    });

    // Build a searchable corpus from conditions + notes + encounter reasons.
    const corpus = [
      ...conditions.map((c: any) => `${c.diagnosis} ${c.note || ''}`),
      ...notes.map((n: any) => `${n.title || ''} ${n.body || ''}`),
      ...encounters.map((e: any) => e.title || ''),
    ]
      .join(' ')
      .toLowerCase();

    // Rank specialties by keyword hits.
    const ranked = SPECIALTY_RULES.map((rule) => {
      let score = 0;
      const matched: string[] = [];
      for (const kw of rule.keywords) {
        if (corpus.includes(kw)) {
          score++;
          matched.push(kw);
        }
      }
      return { specialty: rule.specialty, score, matchedKeywords: matched };
    })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score);

    // Find providers for each matched specialty.
    const providers: any[] = await this.dataSource.query(
      `SELECT id, username, fname, lname, title, specialty
         FROM users
        WHERE active = 1 AND specialty IS NOT NULL AND specialty <> ''
        ORDER BY lname, fname`,
    );

    const suggestions = ranked.slice(0, 5).map((r) => {
      const matchedProviders = providers.filter((p: any) => {
        const pSpecialty = (p.specialty || '').toLowerCase();
        const target = r.specialty.toLowerCase();
        return (
          pSpecialty.includes(target) ||
          target.includes(pSpecialty) ||
          r.matchedKeywords.some((kw) => pSpecialty.includes(kw))
        );
      });
      return {
        specialty: r.specialty,
        score: r.score,
        matchedKeywords: r.matchedKeywords,
        providers: matchedProviders.slice(0, 5),
      };
    });

    // Auto-generate a suggested reason from the most relevant condition/specialty.
    const topCondition = conditions[0]?.diagnosis;
    const topSpecialty = suggestions[0]?.specialty;
    const suggestedReason = topSpecialty
      ? `Referral for ${topCondition || 'evaluation'} — ${topSpecialty}`
      : topCondition || '';

    return {
      patient: {
        pid: patient.pid,
        name: `${patient.fname} ${patient.lname}`.trim(),
        DOB: patient.DOB,
        sex: patient.sex,
      },
      conditions,
      clinicalNotes,
      suggestions,
      suggestedReason,
    };
  }

  /** Create a referral (persisted as a pnote with groupname = 'referral'). */
  async createReferral(user: ReferralUser, dto: {
    pid: number;
    specialistId?: number;
    reason: string;
    body?: string;
    urgency?: string;
  }) {
    const pid = Number(dto.pid);
    if (!pid) {
      throw new BadRequestException('Patient is required');
    }
    const patients = await this.dataSource.query(
      `SELECT pid, fname, lname FROM patient_data WHERE pid = ?`,
      [pid],
    );
    if (!patients.length) {
      throw new NotFoundException(`Patient #${pid} not found`);
    }

    const urgency = ['routine', 'urgent', 'stat'].includes(dto.urgency || '')
      ? dto.urgency!
      : 'routine';
    const reason = (dto.reason || 'Specialist referral').trim();
    const title = `[${urgency}] ${reason}`;

    const result = await this.dataSource.query(
      `INSERT INTO pnotes (date, title, body, pid, user, groupname, message_status, assigned_to)
       VALUES (NOW(), ?, ?, ?, ?, 'referral', 'pending', ?)`,
      [
        title,
        dto.body || '',
        pid,
        user.username || String(user.sub),
        dto.specialistId ? String(dto.specialistId) : '',
      ],
    );

    return {
      id: result.insertId,
      pid,
      urgency,
      reason,
      specialistId: dto.specialistId || null,
      status: 'pending',
    };
  }

  /** List referrals (newest first). */
  async listReferrals() {
    const rows = await this.dataSource.query(
      `SELECT n.id, n.date, n.pid, n.title, n.body, n.user, n.assigned_to, n.message_status,
              pd.id AS patient_id, pd.fname, pd.lname, pd.DOB, pd.sex,
              u.fname AS specialist_fname, u.lname AS specialist_lname, u.specialty
         FROM pnotes n
         LEFT JOIN patient_data pd ON pd.pid = n.pid
         LEFT JOIN users u ON u.id = n.assigned_to
        WHERE n.groupname = 'referral' AND n.deleted = 0
        ORDER BY n.date DESC
        LIMIT 200`,
    );

    return rows.map((r: any) => this.toReferralRow(r));
  }

  // ─── Notifications ──────────────────────────────────────────────

  /**
   * Referrals that still need attention for this provider. A provider is
   * notified when another provider refers a patient to them (`assigned_to`),
   * and admins also see unassigned referrals so nothing gets stranded.
   */
  async getReferralNotifications(user: ReferralUser) {
    const adminFlag = user?.role === 'admin' ? 1 : 0;
    const uid = String(Number(user?.sub) || 0);

    const rows = await this.dataSource.query(
      `SELECT n.id, n.date, n.pid, n.title, n.body, n.user, n.assigned_to, n.message_status,
              pd.id AS patient_id, pd.fname, pd.lname, pd.DOB, pd.sex,
              u.fname AS specialist_fname, u.lname AS specialist_lname, u.specialty
         FROM pnotes n
         LEFT JOIN patient_data pd ON pd.pid = n.pid
         LEFT JOIN users u ON u.id = n.assigned_to
        WHERE n.groupname = 'referral' AND n.deleted = 0
          AND n.message_status IN ('pending', 'New')
          AND (? = 1 OR n.assigned_to = ? OR n.assigned_to = '' OR n.assigned_to IS NULL)
        ORDER BY
          CASE
            WHEN n.title LIKE '[stat]%' THEN 0
            WHEN n.title LIKE '[urgent]%' THEN 1
            ELSE 2
          END,
          n.date DESC
        LIMIT 50`,
      [adminFlag, uid],
    );

    const referrals = rows.map((r: any) => this.toReferralRow(r));
    return {
      pendingCount: referrals.length,
      urgentCount: referrals.filter(
        (r: any) => r.urgency === 'urgent' || r.urgency === 'stat',
      ).length,
      referrals,
    };
  }

  /** Mark a referral as reviewed/accepted once the provider has acted on it. */
  async ackReferral(id: number, status?: string) {
    const allowed = ['reviewed', 'accepted', 'declined', 'pending'];
    const next = allowed.includes(String(status)) ? String(status) : 'reviewed';
    const result = await this.dataSource.query(
      `UPDATE pnotes SET message_status = ? WHERE id = ? AND groupname = 'referral'`,
      [next, id],
    );
    if (!result?.affectedRows) {
      throw new NotFoundException(`Referral #${id} not found`);
    }
    return { id, status: next };
  }

  // ---- private helpers ----

  private toReferralRow(r: any) {
    const urgencyMatch = (r.title || '').match(/^\[(routine|urgent|stat)\]\s*/i);
    const urgency = urgencyMatch ? urgencyMatch[1].toLowerCase() : 'routine';
    const reason = (r.title || '').replace(/^\[(routine|urgent|stat)\]\s*/i, '');
    const patientName = `${r.fname || ''} ${r.lname || ''}`.trim() || `Patient #${r.pid}`;
    const specialistName =
      `${r.specialist_fname || ''} ${r.specialist_lname || ''}`.trim() ||
      (r.assigned_to ? `Provider #${r.assigned_to}` : '');

    return {
      id: r.id,
      date: r.date,
      pid: r.pid,
      /** Canonical `patient_data.id` — use this for chart links. */
      patientId: r.patient_id ? Number(r.patient_id) : null,
      patientDOB: r.DOB || null,
      patientSex: r.sex || null,
      patientName,
      reason,
      urgency,
      body: r.body,
      referringProvider: r.user,
      specialistId: r.assigned_to ? Number(r.assigned_to) : null,
      specialistName,
      specialty: r.specialty || '',
      status: r.message_status || 'pending',
    };
  }
}
