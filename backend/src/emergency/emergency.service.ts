import {
    BadRequestException,
    Injectable,
    Logger,
    NotFoundException,
    OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SmartRoutingService } from '../nursing/smart-routing.service';
import { BillingService } from '../billing/billing.service';
import { MessageProducer } from '../messaging/message-producer.service';
import {
    TRIAGE_LEVELS,
    TriageAssessment,
    TriageInput,
    TriageLevel,
    TriageVitals,
    clampLevel,
    minutesUntilReassessment,
    nextEscalation,
    queuePriority,
    triageAcuity,
} from './triage-acuity.util';
import { bandedObservations } from './pediatric-vitals.util';

/** Visits still occupying a place in the department. */
export const ACTIVE_STATUSES = [
    'waiting',
    'in_treatment',
    'observation',
] as const;

/** Statuses a visit can move to, and what they mean for the metrics. */
export const CLOSED_STATUSES = [
    'admitted',
    'discharged',
    'transferred',
    'lwbs',
    'deceased',
] as const;

export type VisitStatus =
    | (typeof ACTIVE_STATUSES)[number]
    | (typeof CLOSED_STATUSES)[number];

/** Observations older than this are not treated as the patient's current state. */
const OBSERVATION_FRESHNESS_MINUTES = 120;

export interface TriageDto {
    chiefComplaint?: string;
    mode?: string;
    vitals?: TriageVitals;
    resources?: number | null;
    painScore?: number | null;
    pregnant?: boolean;
    gestationalWeeks?: number | null;
    immunocompromised?: boolean;
    anticoagulated?: boolean;
    sickleCell?: boolean;
    /** When true, also record the vitals in the chart's vitals table. */
    saveVitals?: boolean;
    /** Set false to record an attendance without raising the TRIAGE/VITALS charges. */
    bill?: boolean;
    arrivedAt?: string;
    providerId?: number | null;
    room?: string | null;
}

/** Actor recorded against a triage / reassessment action. */
interface EmergencyUser {
    id?: number;
    name?: string;
}

/** `patient_data` row used by triage. */
interface EmergencyPatientRow {
    id: number;
    pid: number;
    fname: string;
    lname: string;
    DOB: string | null;
    sex: string | null;
    providerID: number | null;
}

/** `emergency_visits` row joined to patient demographics (VISIT_SELECT). */
interface EmergencyVisitRow {
    id: number;
    pid: number;
    patient_id: number | null;
    arrived_at: string;
    mode: string;
    chief_complaint: string | null;
    esi_level: number;
    color: string;
    label: string;
    triage_score: number;
    news2: number;
    shock_index: number | string | null;
    target_minutes: number;
    reassess_minutes: number;
    acuity: string;
    bypass: unknown;
    modifiers: unknown;
    reasons: unknown;
    needs_vitals: number;
    resources: number | null;
    vitals: string | TriageVitals | null;
    vitals_source: string | null;
    status: string;
    room: string | null;
    provider_id: number | null;
    triaged_at: string | null;
    first_seen_at: string | null;
    closed_at: string | null;
    disposition: string | null;
    escalated_level: number | null;
    escalated_reason: string | null;
    escalated_at: string | null;
    paged_at: string | null;
    reassess_paged_at: string | null;
    created_by: string | null;
    fname: string | null;
    lname: string | null;
    DOB: string | null;
    sex: string | null;
    public_id: string | null;
    last_observation_at: string | null;
}

/** `form_vitals` row used for triage scoring. */
interface FormVitalsRow {
    date: string;
    bps: number | string | null;
    bpd: number | string | null;
    pulse: number | string | null;
    respiration: number | string | null;
    temperature: number | string | null;
    oxygen_saturation: number | string | null;
}

/** Previous-visit observations row. */
interface PriorVisitRow {
    esi_level: number | null;
    news2: number | string | null;
    vitals: string | TriageVitals | null;
    arrived_at: string;
}

/** `emergency_reassessments` row (with optional patient join). */
interface ReassessmentRow {
    id: number;
    visit_id: number;
    at: string;
    level_before: number | null;
    level_after: number | null;
    news2: number | string;
    note: string | null;
    recorded_by: string | null;
    kind: string;
    pid?: number;
    fname?: string | null;
    lname?: string | null;
}

/** Affected-row result of an INSERT / UPDATE / DELETE. */
interface AffectedRowsResult {
    affectedRows: number;
    insertId: number;
}

/** `getStats()` totals row. */
interface EmergencyStatsTotalsRow {
    attendances: number | string;
    lwbs: number | string | null;
    escalated: number | string | null;
    door_to_triage: number | string | null;
    door_to_provider: number | string | null;
    length_of_stay: number | string | null;
}

/** `getStats()` per-level row. */
interface EmergencyStatsLevelRow {
    level: number | string;
    count: number | string;
    breaches: number | string;
}

/** `getStats()` per-disposition row. */
interface EmergencyStatsDispositionRow {
    outcome: string;
    count: number | string;
}

/** `getStats()` reassessment totals row. */
interface EmergencyReassessStatsRow {
    total: number | string;
    escalations: number | string;
    de_escalations: number | string;
    unchanged: number | string;
}

/** One visit reported by the reassessment sweep. */
export interface ReassessmentPageRef {
    visitId: number;
    pid: number;
    patientName: string;
    level: number;
}

/** One escalated visit reported by `escalateOverdue()`. */
export interface EscalatedVisitRef {
    visitId: number;
    pid: number;
    patientName: string;
    from: number;
    to: number;
    reason: string;
    room: string | null;
}

@Injectable()
export class EmergencyService implements OnModuleInit {
    private readonly logger = new Logger(EmergencyService.name);

    constructor(
        @InjectDataSource() private readonly dataSource: DataSource,
        private readonly routing: SmartRoutingService,
        private readonly billing: BillingService,
        private readonly messages: MessageProducer,
    ) {}

    async onModuleInit(): Promise<void> {
        await this.ensureSchema();
    }

    async ensureSchema(): Promise<void> {
        try {
            await this.dataSource.query(
                `CREATE TABLE IF NOT EXISTS emergency_visits (
           id INT AUTO_INCREMENT PRIMARY KEY,
           pid INT NOT NULL,
           patient_id INT NULL,
           arrived_at DATETIME NOT NULL,
           mode VARCHAR(24) NOT NULL DEFAULT 'walk-in',
           chief_complaint TEXT NULL,
           esi_level TINYINT NOT NULL,
           color VARCHAR(16) NOT NULL,
           label VARCHAR(16) NOT NULL,
           triage_score INT NOT NULL DEFAULT 0,
           news2 INT NOT NULL DEFAULT 0,
           shock_index DECIMAL(4,2) NULL,
           target_minutes INT NOT NULL DEFAULT 0,
           reassess_minutes INT NOT NULL DEFAULT 0,
           acuity VARCHAR(16) NOT NULL DEFAULT 'routine',
           bypass JSON NULL,
           modifiers JSON NULL,
           reasons JSON NULL,
           needs_vitals TINYINT(1) NOT NULL DEFAULT 0,
           resources INT NULL,
           vitals JSON NULL,
           vitals_source VARCHAR(16) NULL,
           status VARCHAR(24) NOT NULL DEFAULT 'waiting',
           room VARCHAR(64) NULL,
           provider_id INT NULL,
           triaged_at DATETIME NULL,
           first_seen_at DATETIME NULL,
           closed_at DATETIME NULL,
           disposition VARCHAR(120) NULL,
           escalated_level TINYINT NULL,
           escalated_reason VARCHAR(255) NULL,
           escalated_at DATETIME NULL,
           paged_at DATETIME NULL,
           /* Last time a missed reassessment was chased, so the sweep does not repeat itself. */
           reassess_paged_at DATETIME NULL,
           created_by VARCHAR(64) NULL,
           created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
           updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
           KEY idx_ev_board (status, arrived_at),
           KEY idx_ev_pid (pid, arrived_at)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
            );
            await this.dataSource.query(
                `CREATE TABLE IF NOT EXISTS emergency_reassessments (
           id INT AUTO_INCREMENT PRIMARY KEY,
           visit_id INT NOT NULL,
           at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
           level_before TINYINT NULL,
           level_after TINYINT NOT NULL,
           news2 INT NOT NULL DEFAULT 0,
           vitals JSON NULL,
           reasons JSON NULL,
           note VARCHAR(255) NULL,
           recorded_by VARCHAR(64) NULL,
           KEY idx_er_visit (visit_id, at)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
            );
            /**
             * 'observation' = a clinician took a fresh set of observations.
             * 'escalation'  = an audit entry from the waiting-time check, with none.
             *
             * Without this the escalation's own audit row (stamped NOW()) counted as a
             * fresh observation, so a patient escalated for delay read as "just
             * observed" and was never chased for a missed reassessment.
             */
            try {
                await this.dataSource.query(
                    `ALTER TABLE emergency_reassessments ADD COLUMN kind VARCHAR(16) NOT NULL DEFAULT 'observation'`,
                );
            } catch {
                /* column already exists */
            }
            // Added after the first release: the reassessment chase needs its own
            // stamp so a 5-minute tick does not page the same nurse repeatedly.
            try {
                await this.dataSource.query(
                    `ALTER TABLE emergency_visits ADD COLUMN reassess_paged_at DATETIME NULL`,
                );
            } catch {
                /* column already exists */
            }

            this.logger.log('Emergency triage schema ready');
        } catch (err) {
            this.logger.error(`Could not ensure emergency schema: ${err}`);
        }
    }
    // ── Triage ───────────────────────────────────────────────────

    /**
     * Dry run: what level would this be? Nothing is written, so the triage form
     * can show the colour before anybody commits to it.
     */
    async preview(pid: number, dto: TriageDto) {
        const { patient, observations, input } = await this.buildInput(
            pid,
            dto,
        );
        const assessment = triageAcuity(input);
        const band = bandedObservations(input.vitals, input.ageYears);

        return {
            patient: {
                pid: patient.pid,
                patientId: patient.id,
                name: `${patient.fname} ${patient.lname}`.trim(),
                ageYears: input.ageYears,
                sex: patient.sex,
            },
            assessment,
            observations: {
                source: observations.source,
                takenAt: observations.takenAt,
                staleMinutes: observations.staleMinutes,
                stale:
                    observations.staleMinutes !== null &&
                    observations.staleMinutes > OBSERVATION_FRESHNESS_MINUTES,
            },
            band: {
                band: band.band,
                abnormal: band.abnormal,
                reassuringForAge: band.reassuringForAge,
            },
            written: false,
        };
    }

    /**
     * Record an emergency attendance: score it, open the visit, and hand the
     * acuity to the nursing router so the right nurse picks it up.
     */
    async triage(pid: number, dto: TriageDto, user?: EmergencyUser) {
        const { patient, observations, input } = await this.buildInput(
            pid,
            dto,
        );
        const assessment = triageAcuity(input);
        const band = bandedObservations(input.vitals, input.ageYears);
        const arrivedAt = dto.arrivedAt ? new Date(dto.arrivedAt) : new Date();
        if (Number.isNaN(arrivedAt.getTime()))
            throw new BadRequestException('arrivedAt is not a valid date');

        if (dto.saveVitals && input.vitals)
            await this.recordVitals(pid, input.vitals);

        const result = await this.dataSource.query<AffectedRowsResult>(
            `INSERT INTO emergency_visits
         (pid, patient_id, arrived_at, mode, chief_complaint, esi_level, color, label,
          triage_score, news2, shock_index, target_minutes, reassess_minutes, acuity,
          bypass, modifiers, reasons, needs_vitals, resources, vitals, vitals_source,
          status, room, provider_id, triaged_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting', ?, ?, NOW(), ?)`,
            [
                patient.pid,
                patient.id,
                arrivedAt,
                dto.mode || 'walk-in',
                dto.chiefComplaint || '',
                assessment.level,
                assessment.color,
                assessment.label,
                assessment.score,
                assessment.news2,
                assessment.shockIndex,
                assessment.targetMinutes,
                assessment.reassessMinutes,
                assessment.acuity,
                JSON.stringify(assessment.bypass),
                JSON.stringify(assessment.modifiers),
                JSON.stringify(assessment.reasons),
                assessment.needsVitals ? 1 : 0,
                dto.resources === undefined ? null : dto.resources,
                JSON.stringify(input.vitals || {}),
                observations.source,
                dto.room || null,
                dto.providerId ?? patient.providerID ?? null,
                user?.name || 'system',
            ],
        );

        const visitId = result.insertId;
        const assignment = await this.handToNursing(
            patient.pid,
            assessment,
            dto,
            user,
        );
        const billing = await this.billTriage(patient.pid, dto);

        this.logger.log(
            `Triage: PID ${patient.pid} → level ${assessment.level} (${assessment.label}), NEWS2 ${assessment.news2}, visit ${visitId}`,
        );

        return {
            ...(await this.getVisit(visitId)),
            assignment,
            billing,
            band: {
                band: band.band,
                abnormal: band.abnormal,
                reassuringForAge: band.reassuringForAge,
            },
        };
    }

    /**
     * Bill the triage attendance.
     *
     * Delegates to the existing `billTriageIntake`, which already refuses to
     * create a second TRIAGE/VITALS charge for the same patient — so this is safe
     * to call on every attendance and will not double-bill. Billing problems must
     * never stop a patient being triaged, hence the catch.
     */
    private async billTriage(pid: number, dto: TriageDto) {
        if (dto.bill === false) return { billed: false, skipped: true };
        try {
            const result = await this.billing.billTriageIntake(pid);
            // `itemsCreated` is the field the billing service reports. Checking a
            // non-existent `created` made this always say "not billed".
            const created = Number(result?.itemsCreated) || 0;
            return {
                billed: created > 0,
                itemsCreated: created,
                detail: result,
            };
        } catch (err) {
            this.logger.warn(`Could not bill triage for PID ${pid}: ${err}`);
            return { billed: false, error: 'billing failed' };
        }
    }

    // ── Nurse handoff and vitals capture ─────────────────────────

    /**
     * Push the triage acuity into the existing nursing assignment so the patient
     * appears on the RN workspace with the right priority and a named nurse. The
     * triage level overrides the note-keyword classifier — it actually saw the
     * patient.
     */
    private async handToNursing(
        pid: number,
        assessment: TriageAssessment,
        dto: TriageDto,
        user?: EmergencyUser,
    ) {
        try {
            const decision = await this.routing.routePatient(
                pid,
                dto.chiefComplaint || '',
                {
                    bp_systolic: dto.vitals?.bps,
                    pulse: dto.vitals?.pulse,
                    temp: dto.vitals?.temperature,
                    o2_sat: dto.vitals?.oxygen_saturation,
                },
            );
            await this.routing.persistAssignment(
                pid,
                {
                    ...decision,
                    acuityLevel: assessment.acuity,
                    acuityScore: assessment.score,
                    reason: `Emergency triage level ${assessment.level} (${assessment.label}) — ${
                        assessment.reasons[0] || 'no detail'
                    }`,
                },
                user?.id ?? null,
            );
            return {
                assignedNurseId: decision.assignedNurseId,
                assignedNurseName: decision.assignedNurseName,
                chargeNurseId: decision.chargeNurseId,
                chargeNurseName: decision.chargeNurseName,
            };
        } catch (err) {
            // Triage must never fail because assignment could not be worked out.
            this.logger.warn(
                `Could not hand triage to nursing for PID ${pid}: ${err}`,
            );
            return null;
        }
    }

    /** Persist the triage observations into the chart so they are not lost. */
    private async recordVitals(pid: number, vitals: TriageVitals) {
        const number = (x: unknown) =>
            x === undefined || x === null || x === '' ? null : Number(x);
        try {
            await this.dataSource.query(
                `INSERT INTO form_vitals
           (pid, date, bps, bpd, pulse, respiration, temperature, oxygen_saturation, note, activity, authorized)
         VALUES (?, NOW(), ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
                [
                    pid,
                    number(vitals.bps),
                    number(vitals.bpd),
                    number(vitals.pulse),
                    number(vitals.respiration),
                    number(vitals.temperature),
                    number(vitals.oxygen_saturation),
                    `Emergency triage observations${
                        vitals.painScore !== undefined &&
                        vitals.painScore !== null
                            ? ` — pain ${vitals.painScore}/10`
                            : ''
                    }`,
                ],
            );
        } catch (err) {
            this.logger.warn(
                `Could not save triage vitals for PID ${pid}: ${err}`,
            );
        }
    }

    // ── Context the algorithm needs ──────────────────────────────

    private async resolvePatient(pid: number): Promise<EmergencyPatientRow> {
        const rows = await this.dataSource.query<EmergencyPatientRow[]>(
            `SELECT id, pid, fname, lname, DOB, sex, providerID FROM patient_data WHERE pid = ? LIMIT 1`,
            [pid],
        );
        if (!rows?.length)
            throw new NotFoundException(`Patient #${pid} not found`);
        return rows[0];
    }

    private static ageYears(
        dob: string | Date | null | undefined,
        now = new Date(),
    ): number | null {
        if (!dob) return null;
        const raw = String(dob).trim();
        const dateOnly = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
        const born = dateOnly
            ? new Date(
                  Number(dateOnly[1]),
                  Number(dateOnly[2]) - 1,
                  Number(dateOnly[3]),
              )
            : new Date(raw.replace(' ', 'T'));
        if (Number.isNaN(born.getTime())) return null;
        let age = now.getFullYear() - born.getFullYear();
        const monthDelta = now.getMonth() - born.getMonth();
        if (
            monthDelta < 0 ||
            (monthDelta === 0 && now.getDate() < born.getDate())
        )
            age -= 1;
        return age >= 0 && age < 140 ? age : null;
    }

    /**
     * The observations to score: what the triage nurse just took, or the most
     * recent charted set *only if it is fresh*. Scoring an hours-old set as if it
     * were the patient's current state is how a deteriorating patient looks fine.
     */
    private async observationsFor(
        pid: number,
        supplied?: TriageVitals | null,
    ): Promise<{
        vitals: TriageVitals | null;
        source: 'triage' | 'chart' | 'chart-stale' | null;
        takenAt: Date | null;
        staleMinutes: number | null;
    }> {
        const hasSupplied = supplied && Object.keys(supplied).length > 0;
        if (hasSupplied)
            return {
                vitals: supplied,
                source: 'triage' as const,
                takenAt: new Date(),
                staleMinutes: 0,
            };

        const [row] = await this.dataSource.query<FormVitalsRow[]>(
            `SELECT date, bps, bpd, pulse, respiration, temperature, oxygen_saturation
         FROM form_vitals WHERE pid = ? ORDER BY date DESC LIMIT 1`,
            [pid],
        );
        if (!row)
            return {
                vitals: null,
                source: null,
                takenAt: null,
                staleMinutes: null,
            };

        const takenAt = new Date(row.date);
        const staleMinutes = Math.max(
            0,
            Math.round((Date.now() - takenAt.getTime()) / 60000),
        );
        if (staleMinutes > OBSERVATION_FRESHNESS_MINUTES) {
            // Too old to represent "now" — return nothing so the level floors at 3 and
            // the UI can say why.
            return {
                vitals: null,
                source: 'chart-stale' as const,
                takenAt,
                staleMinutes,
            };
        }

        return {
            vitals: {
                bps: row.bps,
                bpd: row.bpd,
                pulse: row.pulse,
                respiration: row.respiration,
                temperature: row.temperature,
                oxygen_saturation: row.oxygen_saturation,
            },
            source: 'chart' as const,
            takenAt,
            staleMinutes,
        };
    }

    /** Last structured midwife risk level, when the chart has one. */
    private async latestMidwifeRisk(
        pid: number,
    ): Promise<'low' | 'moderate' | 'high' | null> {
        try {
            const [row] = await this.dataSource.query<
                { level: string | null }[]
            >(
                `SELECT level FROM midwife_assessments
          WHERE pid = ? AND kind = 'risk' AND level IS NOT NULL
          ORDER BY recorded_at DESC LIMIT 1`,
                [pid],
            );
            const level = String(row?.level || '').toLowerCase();
            return level === 'high' || level === 'moderate' || level === 'low'
                ? level
                : null;
        } catch {
            return null;
        }
    }

    /** The previous set of observations for this patient, for the trend stage. */
    private async priorObservations(pid: number, excludeVisitId?: number) {
        const rows = await this.dataSource.query<PriorVisitRow[]>(
            `SELECT esi_level, news2, vitals, arrived_at FROM emergency_visits
        WHERE pid = ? AND (? IS NULL OR id <> ?)
        ORDER BY arrived_at DESC LIMIT 1`,
            [pid, excludeVisitId ?? null, excludeVisitId ?? null],
        );
        if (!rows?.length) return null;
        const previous = rows[0];
        let bps: number | null = null;
        try {
            let v: TriageVitals = {};
            if (typeof previous.vitals === 'string') {
                v = JSON.parse(previous.vitals) as TriageVitals;
            } else if (previous.vitals) {
                v = previous.vitals;
            }
            bps =
                v.bps !== undefined && v.bps !== null && v.bps !== ''
                    ? Number(v.bps)
                    : null;
        } catch {
            bps = null;
        }
        return {
            news2: Number(previous.news2) || 0,
            bps,
            level: (previous.esi_level as TriageLevel) || null,
        };
    }

    /** Assemble the algorithm input from the chart plus what triage supplied. */
    private async buildInput(pid: number, dto: TriageDto) {
        const patient = await this.resolvePatient(pid);
        const observations = await this.observationsFor(pid, dto.vitals);
        const vitals = observations.vitals
            ? {
                  ...observations.vitals,
                  painScore:
                      dto.painScore ?? observations.vitals.painScore ?? null,
              }
            : dto.painScore !== undefined && dto.painScore !== null
              ? { painScore: dto.painScore }
              : null;

        const input: TriageInput = {
            vitals,
            complaints: dto.chiefComplaint || '',
            ageYears: EmergencyService.ageYears(patient.DOB),
            pregnant: dto.pregnant === true,
            gestationalWeeks: dto.gestationalWeeks ?? null,
            immunocompromised: dto.immunocompromised === true,
            anticoagulated: dto.anticoagulated === true,
            sickleCell: dto.sickleCell === true,
            midwifeRiskLevel: await this.latestMidwifeRisk(pid),
            resources: dto.resources === undefined ? null : dto.resources,
            prior: await this.priorObservations(pid),
        };

        return { patient, observations, input };
    }

    // ── Board ────────────────────────────────────────────────────

    /** One visit, shaped for both the board and the chart banner. */
    private decorate(row: EmergencyVisitRow, now = new Date()) {
        const level = clampLevel(row.esi_level);
        const meta = TRIAGE_LEVELS[level];
        const arrivedAt = new Date(row.arrived_at);
        const waitMinutes = Math.max(
            0,
            Math.round((now.getTime() - arrivedAt.getTime()) / 60000),
        );
        const targetMinutes = Number(row.target_minutes ?? meta.targetMinutes);
        const targetAt = new Date(arrivedAt.getTime() + targetMinutes * 60000);
        const breached = targetMinutes > 0 && waitMinutes > targetMinutes;
        const lastObservation = row.last_observation_at
            ? new Date(row.last_observation_at)
            : arrivedAt;
        const sinceObservation = Math.max(
            0,
            Math.round((now.getTime() - lastObservation.getTime()) / 60000),
        );

        const json = (value: unknown, fallback: unknown): unknown => {
            if (value === null || value === undefined) return fallback;
            if (typeof value === 'object') return value;
            if (
                typeof value === 'string' ||
                typeof value === 'number' ||
                typeof value === 'boolean'
            ) {
                try {
                    return JSON.parse(String(value)) as unknown;
                } catch {
                    return fallback;
                }
            }
            return fallback;
        };

        return {
            id: Number(row.id),
            pid: Number(row.pid),
            patientId:
                row.patient_id !== null && row.patient_id !== undefined
                    ? Number(row.patient_id)
                    : null,
            patientName: `${row.fname || ''} ${row.lname || ''}`.trim(),
            patientPublicId: row.public_id || null,
            sex: row.sex || null,
            ageYears: EmergencyService.ageYears(row.DOB, now),
            arrivedAt: arrivedAt.toISOString(),
            mode: row.mode,
            chiefComplaint: row.chief_complaint || '',
            status: row.status,
            room: row.room || null,
            providerId:
                row.provider_id !== null && row.provider_id !== undefined
                    ? Number(row.provider_id)
                    : null,
            level,
            color: meta.color,
            label: meta.label,
            meaning: meta.meaning,
            acuity: meta.acuity,
            news2: Number(row.news2) || 0,
            score: Number(row.triage_score) || 0,
            shockIndex:
                row.shock_index === null || row.shock_index === undefined
                    ? null
                    : Number(row.shock_index),
            waitMinutes,
            targetMinutes,
            targetAt: targetAt.toISOString(),
            minutesToTarget: Math.max(0, targetMinutes - waitMinutes),
            breached,
            overByMinutes: breached ? waitMinutes - targetMinutes : 0,
            reassessMinutes: Number(
                row.reassess_minutes ?? meta.reassessMinutes,
            ),
            reassessDueInMinutes: minutesUntilReassessment(
                level,
                sinceObservation,
            ),
            minutesSinceObservation: sinceObservation,
            reassessOverdue:
                row.status === 'waiting' &&
                minutesUntilReassessment(level, sinceObservation) === 0,
            bypass: json(row.bypass, []),
            modifiers: json(row.modifiers, []),
            reasons: json(row.reasons, []),
            needsVitals: Number(row.needs_vitals) === 1,
            escalatedLevel:
                row.escalated_level === null ||
                row.escalated_level === undefined
                    ? null
                    : Number(row.escalated_level),
            escalatedReason: row.escalated_reason || null,
            escalatedAt: row.escalated_at
                ? new Date(row.escalated_at).toISOString()
                : null,
            priority: queuePriority({ level, elapsedMinutes: waitMinutes }),
            awaitingFirstReview: !row.first_seen_at,
            doorToTriageMinutes: row.triaged_at
                ? Math.max(
                      0,
                      Math.round(
                          (new Date(row.triaged_at).getTime() -
                              arrivedAt.getTime()) /
                              60000,
                      ),
                  )
                : null,
            doorToProviderMinutes: row.first_seen_at
                ? Math.max(
                      0,
                      Math.round(
                          (new Date(row.first_seen_at).getTime() -
                              arrivedAt.getTime()) /
                              60000,
                      ),
                  )
                : null,
            disposition: row.disposition || null,
        };
    }

    private static readonly VISIT_SELECT = `
    SELECT v.*, pd.fname, pd.lname, pd.DOB, pd.sex, pd.public_id,
           -- Only a clinical observation counts as "the patient has just been
           -- looked at". An escalation audit row must not reset this clock.
           (SELECT MAX(at) FROM emergency_reassessments r
             WHERE r.visit_id = v.id AND r.kind = 'observation') AS last_observation_at
      FROM emergency_visits v
      LEFT JOIN patient_data pd ON pd.pid = v.pid`;

    async getVisit(id: number) {
        const [row] = await this.dataSource.query<EmergencyVisitRow[]>(
            `${EmergencyService.VISIT_SELECT} WHERE v.id = ? LIMIT 1`,
            [id],
        );
        if (!row)
            throw new NotFoundException(`Emergency visit #${id} not found`);
        return this.decorate(row);
    }

    /**
     * Active attendances assigned to one clinician, in the board's order.
     *
     * The provider dashboard shows these, and it goes through `decorate()` so the
     * colour, the target time and the breach flag are the same numbers the triage
     * board shows — a second implementation would drift the moment a threshold
     * moved. Assignment comes from `provider_id`, which triage fills from the visit's
     * provider or the patient's registered one.
     */
    async getActiveVisitsForProvider(providerId: number) {
        if (!Number.isFinite(providerId) || providerId <= 0) return [];

        const placeholders = ACTIVE_STATUSES.map(() => '?').join(', ');
        const rows = await this.dataSource.query<EmergencyVisitRow[]>(
            `${EmergencyService.VISIT_SELECT}
        WHERE v.status IN (${placeholders}) AND v.provider_id = ?
        ORDER BY v.arrived_at ASC`,
            [...ACTIVE_STATUSES, providerId],
        );

        return rows
            .map((row) => this.decorate(row))
            .sort(
                (a, b) =>
                    b.priority - a.priority || b.waitMinutes - a.waitMinutes,
            );
    }

    /**
     * The live department: active visits ordered so the sickest and the most
     * overdue come first, with the counts the board header shows.
     */
    async getBoard() {
        const placeholders = ACTIVE_STATUSES.map(() => '?').join(', ');
        const rows = await this.dataSource.query<EmergencyVisitRow[]>(
            `${EmergencyService.VISIT_SELECT} WHERE v.status IN (${placeholders}) ORDER BY v.arrived_at ASC`,
            [...ACTIVE_STATUSES],
        );
        const visits = rows.map((r) => this.decorate(r));
        // Ties go to the longest waiting, matching queuePriority's contract ("among
        // equals the one who has waited longest") and the frontend's orderVisits. This
        // used to run the other way, so the API and the board disagreed about which of
        // two equally sick patients was next.
        visits.sort(
            (a, b) => b.priority - a.priority || b.waitMinutes - a.waitMinutes,
        );

        const byLevel: Record<string, number> = {
            1: 0,
            2: 0,
            3: 0,
            4: 0,
            5: 0,
        };
        for (const visit of visits)
            byLevel[String(visit.level)] =
                (byLevel[String(visit.level)] || 0) + 1;

        return {
            generatedAt: new Date().toISOString(),
            counts: {
                active: visits.length,
                waiting: visits.filter((v) => v.status === 'waiting').length,
                inTreatment: visits.filter((v) => v.status === 'in_treatment')
                    .length,
                breached: visits.filter((v) => v.breached).length,
                awaitingFirstReview: visits.filter((v) => v.awaitingFirstReview)
                    .length,
                reassessOverdue: visits.filter((v) => v.reassessOverdue).length,
                needsVitals: visits.filter((v) => v.needsVitals).length,
                escalated: visits.filter((v) => v.escalatedLevel !== null)
                    .length,
                byLevel,
            },
            longestWaitMinutes: visits.reduce(
                (max: number, v) => Math.max(max, v.waitMinutes),
                0,
            ),
            levels: TRIAGE_LEVELS,
            visits,
        };
    }

    /** Everything triage recorded for one patient, for the chart banner. */
    async getForPatient(pid: number) {
        const rows = await this.dataSource.query<EmergencyVisitRow[]>(
            `${EmergencyService.VISIT_SELECT} WHERE v.pid = ? ORDER BY v.arrived_at DESC LIMIT 20`,
            [pid],
        );
        const visits = rows.map((r) => this.decorate(r));
        const active =
            visits.find((v) =>
                (ACTIVE_STATUSES as readonly string[]).includes(v.status),
            ) || null;

        // The reassessment trail — what changed and who decided it. This is the
        // history a clinician needs when a patient is handed over mid-attendance.
        const reassessments = await this.dataSource.query<ReassessmentRow[]>(
            `SELECT r.id, r.visit_id, r.at, r.level_before, r.level_after, r.news2, r.note, r.recorded_by, r.kind
         FROM emergency_reassessments r
         JOIN emergency_visits v ON v.id = r.visit_id
        WHERE v.pid = ?
        ORDER BY r.at DESC LIMIT 25`,
            [pid],
        );

        return {
            active,
            current: active || visits[0] || null,
            history: visits.slice(1, 10),
            reassessments: reassessments.map((r) => ({
                id: Number(r.id),
                visitId: Number(r.visit_id),
                at: new Date(r.at).toISOString(),
                levelBefore: Number(r.level_before),
                levelAfter: Number(r.level_after),
                news2: Number(r.news2) || 0,
                note: r.note || null,
                by: r.recorded_by || null,
                /** 'escalation' entries came from the waiting-time check, not a clinician. */
                kind: r.kind === 'escalation' ? 'escalation' : 'observation',
            })),
            total: visits.length,
        };
    }

    // ── Reassessment ─────────────────────────────────────────────

    /**
     * Re-score a patient on new observations.
     *
     * Escalation is applied automatically. De-escalation is refused unless the
     * caller states a clinical reason, because "the numbers look better now" is
     * not the same as "this patient is safe to wait".
     */
    async reassess(
        visitId: number,
        dto: TriageDto & { note?: string; overrideReason?: string },
        user?: EmergencyUser,
    ) {
        const visit = await this.getVisit(visitId);
        if (!(ACTIVE_STATUSES as readonly string[]).includes(visit.status)) {
            throw new BadRequestException(
                `Visit #${visitId} is ${visit.status} — it is no longer in the department.`,
            );
        }

        const { observations, input } = await this.buildInput(visit.pid, dto);
        const assessment = triageAcuity(input);
        const next = nextEscalation({
            level: visit.level,
            targetMinutes: visit.targetMinutes,
            elapsedMinutes: visit.waitMinutes,
        });

        let finalLevel: TriageLevel = assessment.level;
        let appliedReason: string | null = null;

        // Never let a re-score silently under-triage a patient who is already
        // overdue: the breach escalation is a floor, not a suggestion.
        if (next.escalate && (assessment.level as number) > next.level) {
            finalLevel = next.level;
            appliedReason = next.reason;
        }

        if (
            (finalLevel as number) > (visit.level as number) &&
            !dto.overrideReason
        ) {
            throw new BadRequestException(
                `Re-score would lower this patient from ${visit.label} (${visit.level}) to level ${finalLevel}. ` +
                    'A clinical reason is required to de-escalate — supply overrideReason.',
            );
        }

        if (dto.saveVitals && observations.vitals)
            await this.recordVitals(visit.pid, observations.vitals);

        const meta = TRIAGE_LEVELS[finalLevel];
        await this.dataSource.query(
            `INSERT INTO emergency_reassessments
         (visit_id, level_before, level_after, news2, vitals, reasons, note, recorded_by, kind)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'observation')`,
            [
                visitId,
                visit.level,
                finalLevel,
                assessment.news2,
                JSON.stringify(observations.vitals || {}),
                JSON.stringify(assessment.reasons),
                dto.note || appliedReason || dto.overrideReason || null,
                user?.name || 'system',
            ],
        );

        await this.dataSource.query(
            `UPDATE emergency_visits
          SET esi_level = ?, color = ?, label = ?, triage_score = ?, news2 = ?, shock_index = ?,
              target_minutes = ?, reassess_minutes = ?, acuity = ?, reasons = ?, modifiers = ?,
              needs_vitals = ?, vitals = ?, vitals_source = ?,
              /* A fresh set of observations restarts the reassessment chase. */
              reassess_paged_at = NULL
        WHERE id = ?`,
            [
                finalLevel,
                meta.color,
                meta.label,
                assessment.score,
                assessment.news2,
                assessment.shockIndex,
                meta.targetMinutes,
                meta.reassessMinutes,
                meta.acuity,
                JSON.stringify(assessment.reasons),
                JSON.stringify(assessment.modifiers),
                assessment.needsVitals ? 1 : 0,
                JSON.stringify(observations.vitals || {}),
                observations.source,
                visitId,
            ],
        );

        if ((finalLevel as number) < (visit.level as number)) {
            await this.handToNursing(
                visit.pid,
                { ...assessment, level: finalLevel, acuity: meta.acuity },
                dto,
                user,
            );
        }

        const updated = await this.getVisit(visitId);
        return {
            ...updated,
            reassessment: {
                levelBefore: visit.level,
                levelAfter: finalLevel,
                /** True when the waiting-time breach raised the level, not the observations. */
                escalatedForDelay: !!appliedReason,
                deEscalated: (finalLevel as number) > (visit.level as number),
                reason: appliedReason || dto.overrideReason || null,
                news2: assessment.news2,
            },
        };
    }

    // ── Journey ──────────────────────────────────────────────────

    /**
     * Move a visit along its journey. The first move into treatment stamps
     * `first_seen_at`, which is what makes door-to-provider measurable.
     */
    async updateStatus(
        visitId: number,
        dto: {
            status?: string;
            room?: string | null;
            providerId?: number | null;
            disposition?: string | null;
        },
        user?: EmergencyUser,
    ) {
        const visit = await this.getVisit(visitId);
        const status = String(dto.status || '').trim();
        const allowedStatuses: readonly string[] = [
            ...ACTIVE_STATUSES,
            ...CLOSED_STATUSES,
        ];
        if (!allowedStatuses.includes(status)) {
            throw new BadRequestException(
                `status must be one of: ${allowedStatuses.join(', ')}`,
            );
        }

        const closing = (CLOSED_STATUSES as readonly string[]).includes(status);
        await this.dataSource.query(
            `UPDATE emergency_visits
          SET status = ?,
              room = COALESCE(?, room),
              provider_id = COALESCE(?, provider_id),
              disposition = COALESCE(?, disposition),
              first_seen_at = CASE
                WHEN first_seen_at IS NULL
                 AND ? IN ('in_treatment', 'observation', 'admitted', 'discharged', 'transferred')
                THEN NOW()
                ELSE first_seen_at END,
              closed_at = CASE WHEN ? = 1 THEN NOW() ELSE closed_at END
        WHERE id = ?`,
            [
                status,
                dto.room ?? null,
                dto.providerId ?? null,
                dto.disposition ?? null,
                status,
                closing ? 1 : 0,
                visitId,
            ],
        );

        this.logger.log(
            `Emergency visit ${visitId}: ${visit.status} → ${status} (by ${user?.name || 'system'})`,
        );
        return this.getVisit(visitId);
    }

    // ── Escalation ───────────────────────────────────────────────

    /**
     * Find patients who have waited past their target plus grace and escalate them
     * one level. Called by the scheduler on a timer, and directly by an
     * administrator who wants it now.
     *
     * Each visit escalates at most once, so a repeated tick cannot ratchet
     * somebody to Red.
     */
    async escalateOverdue(actor = 'system') {
        const board = await this.getBoard();
        const escalated: EscalatedVisitRef[] = [];

        for (const visit of board.visits) {
            if (visit.status !== 'waiting' || !visit.awaitingFirstReview)
                continue;
            if (visit.escalatedLevel !== null) continue;

            const decision = nextEscalation({
                level: visit.level,
                targetMinutes: visit.targetMinutes,
                elapsedMinutes: visit.waitMinutes,
            });
            if (!decision.escalate) continue;

            const meta = TRIAGE_LEVELS[decision.level];
            await this.dataSource.query(
                `UPDATE emergency_visits
            SET esi_level = ?, color = ?, label = ?, target_minutes = ?, reassess_minutes = ?, acuity = ?,
                escalated_level = ?, escalated_reason = ?, escalated_at = NOW()
          WHERE id = ?`,
                [
                    decision.level,
                    meta.color,
                    meta.label,
                    meta.targetMinutes,
                    meta.reassessMinutes,
                    meta.acuity,
                    decision.level,
                    decision.reason,
                    visit.id,
                ],
            );
            await this.dataSource.query(
                `INSERT INTO emergency_reassessments
           (visit_id, level_before, level_after, news2, reasons, note, recorded_by, kind)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'escalation')`,
                [
                    visit.id,
                    visit.level,
                    decision.level,
                    visit.news2,
                    JSON.stringify([decision.reason]),
                    decision.reason,
                    `${actor} (waiting-time escalation)`,
                ],
            );

            escalated.push({
                visitId: visit.id,
                pid: visit.pid,
                patientName: visit.patientName,
                from: visit.level,
                to: decision.level,
                reason: decision.reason,
                room: visit.room,
            });
            // Tell the nurse who owns this patient, and the nurse in charge.
            await this.page(
                visit,
                `${visit.patientName || `PID ${visit.pid}`} has waited too long`,
                [
                    decision.reason,
                    visit.chiefComplaint
                        ? `Presenting complaint: ${visit.chiefComplaint}`
                        : null,
                    visit.room ? `Location: ${visit.room}` : null,
                    `Now level ${decision.level} (${meta.label}) — reassess and escalate care.`,
                ]
                    .filter(Boolean)
                    .join('\n'),
                decision.level <= 2 ? 'STAT' : 'URGENT',
            );
            this.logger.warn(`Escalated visit ${visit.id}: ${decision.reason}`);
        }

        return {
            checked: board.visits.length,
            escalated,
            reassessmentPages: [],
        };
    }

    /**
     * Chase observations that are overdue for the patient's level.
     *
     * A level-2 patient should be re-observed every 15 minutes; while the board
     * shows that, nobody is told. One page per interval — the stamp is cleared
     * whenever a reassessment is recorded, so the next interval can speak again.
     */
    async pageOverdueReassessments(actor = 'system') {
        const board = await this.getBoard();
        const paged: ReassessmentPageRef[] = [];

        for (const visit of board.visits) {
            // Level 1 included on purpose: a patient escalated to Red still needs
            // re-observing, and `minutesUntilReassessment` gives them a 15-minute floor.
            if (visit.status !== 'waiting') continue;
            if (!visit.reassessOverdue) continue;

            const [row] = await this.dataSource.query<
                { reassess_paged_at: string | null }[]
            >(
                `SELECT reassess_paged_at FROM emergency_visits WHERE id = ? LIMIT 1`,
                [visit.id],
            );
            if (row?.reassess_paged_at) continue;

            await this.page(
                visit,
                `${visit.patientName || `PID ${visit.pid}`} is due a reassessment`,
                [
                    `Level ${visit.level} (${visit.label}) patients are re-observed every ${visit.reassessMinutes} minutes.`,
                    `Waiting ${visit.waitMinutes} min against a ${visit.targetMinutes} min target.`,
                    visit.chiefComplaint
                        ? `Presenting complaint: ${visit.chiefComplaint}`
                        : null,
                ]
                    .filter(Boolean)
                    .join('\n'),
                visit.level === 2 ? 'URGENT' : 'NORMAL',
            );

            await this.dataSource.query(
                `UPDATE emergency_visits SET reassess_paged_at = NOW() WHERE id = ?`,
                [visit.id],
            );
            paged.push({
                visitId: visit.id,
                pid: visit.pid,
                patientName: visit.patientName,
                level: visit.level,
            });
            this.logger.warn(
                `Reassessment overdue for visit ${visit.id} (level ${visit.level}) — paged (${actor}).`,
            );
        }

        return paged;
    }

    /**
     * One full safety sweep: escalate anyone past their target, then chase missed
     * observations. Used by the scheduler and by the manual "check breaches"
     * button, so both behave identically.
     */
    async runSafetySweep(actor = 'system') {
        const escalation = await this.escalateOverdue(actor);
        const reassessmentPages = await this.pageOverdueReassessments(actor);
        return { ...escalation, reassessmentPages };
    }

    /**
     * Page through the existing messaging pipeline rather than a new channel:
     * it already gives realtime delivery to the clinic topic, email/SMS for
     * STAT/URGENT, dedup, and a durable entry in the mailbox.
     */
    private async page(
        visit: {
            pid: number;
            patientId?: number | null;
            id: number;
            room?: string | null;
        },
        title: string,
        body: string,
        priority: 'STAT' | 'URGENT' | 'NORMAL',
    ) {
        try {
            const [assignment] = await this.dataSource.query<
                {
                    assigned_nurse_id: number | null;
                    charge_nurse_id: number | null;
                }[]
            >(
                `SELECT assigned_nurse_id, charge_nurse_id FROM patient_care_assignment WHERE pid = ? LIMIT 1`,
                [visit.pid],
            );
            const recipients = [
                assignment?.assigned_nurse_id,
                assignment?.charge_nurse_id,
            ]
                .map((id: any) => Number(id))
                .filter((id: number) => Number.isFinite(id) && id > 0);

            // No named nurse: still publish, so the charge team and the mailbox see it.
            const targets = recipients.length
                ? recipients
                : [undefined as unknown as number];
            for (const recipientId of targets) {
                await this.messages.produceMessage({
                    title: `[Triage] ${title}`,
                    body,
                    pid: visit.pid,
                    recipientId,
                    priority,
                    type: 'clinic',
                });
            }
            await this.dataSource.query(
                `UPDATE emergency_visits SET paged_at = NOW() WHERE id = ?`,
                [visit.id],
            );
            return true;
        } catch (err) {
            // Paging must never break the sweep.
            this.logger.error(`Could not page for visit ${visit.id}: ${err}`);
            return false;
        }
    }

    // ── Metrics ──────────────────────────────────────────────────

    /**
     * Department throughput for the last `days`, plus what happened to the
     * algorithm's levels on reassessment — that last block is how the weights get
     * tuned against real practice instead of opinion.
     */
    async getStats(days = 7) {
        const window = Math.min(Math.max(Number(days) || 7, 1), 365);
        const since = `DATE_SUB(NOW(), INTERVAL ${window} DAY)`;

        const [totals] = await this.dataSource.query<EmergencyStatsTotalsRow[]>(
            `SELECT COUNT(*) AS attendances,
              SUM(status = 'lwbs') AS lwbs,
              SUM(escalated_level IS NOT NULL) AS escalated,
              AVG(TIMESTAMPDIFF(MINUTE, arrived_at, triaged_at)) AS door_to_triage,
              AVG(CASE WHEN first_seen_at IS NOT NULL
                       THEN TIMESTAMPDIFF(MINUTE, arrived_at, first_seen_at) END) AS door_to_provider,
              AVG(CASE WHEN closed_at IS NOT NULL
                       THEN TIMESTAMPDIFF(MINUTE, arrived_at, closed_at) END) AS length_of_stay
         FROM emergency_visits WHERE arrived_at >= ${since}`,
        );
        const byLevel = await this.dataSource.query<EmergencyStatsLevelRow[]>(
            `SELECT esi_level AS level, COUNT(*) AS count,
              SUM(TIMESTAMPDIFF(MINUTE, arrived_at, COALESCE(first_seen_at, NOW())) > target_minutes) AS breaches
         FROM emergency_visits WHERE arrived_at >= ${since}
        GROUP BY esi_level ORDER BY esi_level`,
        );
        const byDisposition = await this.dataSource.query<
            EmergencyStatsDispositionRow[]
        >(
            `SELECT COALESCE(disposition, status) AS outcome, COUNT(*) AS count
         FROM emergency_visits WHERE arrived_at >= ${since}
        GROUP BY outcome ORDER BY count DESC`,
        );
        const [reassess] = await this.dataSource.query<
            EmergencyReassessStatsRow[]
        >(
            `SELECT COUNT(*) AS total,
              SUM(r.level_after < r.level_before) AS escalations,
              SUM(r.level_after > r.level_before) AS de_escalations,
              SUM(r.level_after = r.level_before) AS unchanged
         FROM emergency_reassessments r
         JOIN emergency_visits v ON v.id = r.visit_id
        WHERE r.at >= ${since}`,
        );

        const round = (v: unknown) =>
            v === null || v === undefined ? null : Math.round(Number(v));
        const attendances = Number(totals?.attendances) || 0;
        const lwbs = Number(totals?.lwbs) || 0;

        return {
            windowDays: window,
            attendances,
            lwbs,
            lwbsRate: attendances
                ? Number(((lwbs / attendances) * 100).toFixed(1))
                : 0,
            escalated: Number(totals?.escalated) || 0,
            doorToTriageMinutes: round(totals?.door_to_triage),
            doorToProviderMinutes: round(totals?.door_to_provider),
            lengthOfStayMinutes: round(totals?.length_of_stay),
            byLevel: byLevel.map((r) => ({
                level: Number(r.level),
                color: TRIAGE_LEVELS[clampLevel(Number(r.level))].color,
                label: TRIAGE_LEVELS[clampLevel(Number(r.level))].label,
                count: Number(r.count) || 0,
                breaches: Number(r.breaches) || 0,
            })),
            byDisposition: byDisposition.map((r) => ({
                outcome: r.outcome,
                count: Number(r.count) || 0,
            })),
            reassessment: {
                total: Number(reassess?.total) || 0,
                escalated: Number(reassess?.escalations) || 0,
                deEscalated: Number(reassess?.de_escalations) || 0,
                unchanged: Number(reassess?.unchanged) || 0,
            },
        };
    }

    /** Escalation audit trail, newest first — every one with its reason. */
    async getEscalationLog(limit = 25) {
        const rows = await this.dataSource.query<ReassessmentRow[]>(
            `SELECT r.id, r.visit_id, r.level_before, r.level_after, r.note, r.recorded_by, r.at,
              v.pid, pd.fname, pd.lname
         FROM emergency_reassessments r
         JOIN emergency_visits v ON v.id = r.visit_id
         LEFT JOIN patient_data pd ON pd.pid = v.pid
        WHERE r.level_after < r.level_before
        ORDER BY r.at DESC LIMIT ?`,
            [Math.min(Math.max(Number(limit) || 25, 1), 200)],
        );
        return rows.map((r) => ({
            id: Number(r.id),
            visitId: Number(r.visit_id),
            pid: Number(r.pid),
            patientName: `${r.fname || ''} ${r.lname || ''}`.trim(),
            from: Number(r.level_before),
            to: Number(r.level_after),
            note: r.note || null,
            by: r.recorded_by || null,
            at: new Date(r.at).toISOString(),
        }));
    }
}
