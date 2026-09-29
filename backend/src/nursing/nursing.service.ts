import {
    Injectable,
    Logger,
    NotFoundException,
    BadRequestException,
    OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SmartRoutingService } from './smart-routing.service';
import type { RoutingDecision, RoutingVitals } from './smart-routing.service';

export interface NoteAuthor {
    id?: number;
    username: string;
    displayName?: string;
}

/** `pnotes` row joined with care assignment. */
export interface NursingNoteRow {
    id: number;
    date: string;
    title: string | null;
    body: string | null;
    pid: number;
    user: string | null;
    groupname: string | null;
    message_status: string | null;
    assigned_to?: string | number | null;
    room?: string | null;
    acuity_level?: string | null;
    acuity_score?: number | string | null;
    assigned_nurse_id?: number | null;
    charge_nurse_id?: number | null;
    author_name?: string | null;
    fname?: string;
    lname?: string;
}

/** `patient_care_assignment` row. */
export interface CareAssignmentRow {
    pid: number;
    room: string | null;
    assigned_nurse_id: number | null;
    charge_nurse_id: number | null;
    acuity_level: string | null;
    acuity_score: number | string | null;
}

/** `users` nurse row. */
export interface NurseUserRow {
    id: number;
    username: string;
    fname: string;
    lname: string;
    title: string | null;
}

/** Nurse-dashboard patient row. */
export interface WardPatientRow {
    id: number;
    pid: number;
    fname: string;
    lname: string;
    DOB: string | null;
    sex: string | null;
    room: string | null;
    acuity_level: string | null;
    acuity_score: number | string | null;
    is_assigned: number;
    bps: number | string | null;
    bpd: number | string | null;
    pulse: number | string | null;
    temperature: number | string | null;
    respiration: number | string | null;
    oxygen_saturation: number | string | null;
    weight: number | string | null;
    height: number | string | null;
    BMI: number | string | null;
    last_vital_date: string | null;
    awaiting_vitals: number;
}

/** Payload accepted by `createPatientNote()`. */
export interface PatientNoteDto {
    note?: string;
    body?: string;
    noteType?: string;
    shareWithNursing?: boolean;
    title?: string;
    vitals?: RoutingVitals;
}

/** Affected-rows result of an INSERT / UPDATE / DELETE. */
interface AffectedRowsResult {
    affectedRows: number;
    insertId: number;
}

@Injectable()
export class NursingService implements OnModuleInit {
    private readonly logger = new Logger(NursingService.name);

    constructor(
        @InjectDataSource() private readonly dataSource: DataSource,
        private readonly routing: SmartRoutingService,
    ) {}

    async onModuleInit(): Promise<void> {
        await this.routing.ensureSchema();
    }

    // ── Patient notes (shared with the patient full chart) ──────────────────

    async getPatientNotes(pid: number): Promise<NursingNoteRow[]> {
        return this.dataSource.query<NursingNoteRow[]>(
            `SELECT n.id, n.date, n.title, n.body, n.pid, n.user, n.groupname,
              n.message_status, n.assigned_to,
              ca.room, ca.acuity_level, ca.acuity_score,
              ca.assigned_nurse_id, ca.charge_nurse_id,
              CONCAT(COALESCE(u.fname,''), ' ', COALESCE(u.lname,'')) AS author_name
       FROM pnotes n
       LEFT JOIN patient_care_assignment ca ON ca.pid = n.pid
       LEFT JOIN users u ON u.username = n.user
       WHERE n.pid = ? AND n.deleted = 0
         AND n.groupname IN ('clinical', 'progress', 'nurse')
       ORDER BY n.date DESC
       LIMIT 100`,
            [pid],
        );
    }

    async createPatientNote(
        pid: number,
        dto: PatientNoteDto,
        author: NoteAuthor,
    ) {
        const note = String(dto?.note ?? dto?.body ?? '').trim();
        if (!note) {
            throw new BadRequestException('Note text is required');
        }

        // "nurse" notes are always shared with the care team and become part of
        // the patient history visible to all providers.
        const isNurseNote = dto.noteType === 'nurse';
        const shareWithNursing = isNurseNote || dto.shareWithNursing === true;
        const title = String(
            dto.title || (isNurseNote ? 'Nurse Note' : 'Progress Note'),
        ).slice(0, 255);
        const groupname = isNurseNote
            ? 'nurse'
            : shareWithNursing
              ? 'clinical'
              : 'progress';

        let decision: RoutingDecision | null = null;

        if (shareWithNursing) {
            // Smart routing: acuity classification + nurse/charge-nurse assignment.
            decision = await this.routing.routePatient(pid, note, dto.vitals);
            await this.routing.persistAssignment(pid, decision, author.id);
        }

        const assignedTo =
            decision?.assignedNurseId != null
                ? String(decision.assignedNurseId)
                : '';

        const result = await this.dataSource.query<AffectedRowsResult>(
            `INSERT INTO pnotes (date, title, body, pid, user, groupname, message_status, assigned_to)
       VALUES (NOW(), ?, ?, ?, ?, ?, 'New', ?)`,
            [
                title,
                note,
                pid,
                author.username || 'provider',
                groupname,
                assignedTo,
            ],
        );

        this.logger.log(
            `Clinical note #${result.insertId} saved for patient #${pid}` +
                (decision
                    ? ` → routed to RN #${decision.assignedNurseId} (${decision.acuityLevel})`
                    : ''),
        );

        return {
            id: result.insertId,
            pid,
            title,
            note,
            groupname,
            message_status: 'New',
            shared: shareWithNursing,
            routing: decision,
        };
    }

    // ── Room assignment ─────────────────────────────────────────────────────

    async getRoom(pid: number): Promise<CareAssignmentRow> {
        const rows = await this.dataSource.query<CareAssignmentRow[]>(
            `SELECT pid, room, assigned_nurse_id, charge_nurse_id, acuity_level, acuity_score
       FROM patient_care_assignment WHERE pid = ?`,
            [pid],
        );
        if (rows[0]) return rows[0];
        return {
            pid,
            room: null,
            assigned_nurse_id: null,
            charge_nurse_id: null,
            acuity_level: 'routine',
            acuity_score: 0,
        };
    }

    async updateRoom(
        pid: number,
        room?: string | null,
    ): Promise<{ pid: number; room: string | null }> {
        await this.dataSource.query(
            `INSERT INTO patient_care_assignment (pid, room, updated_at)
       VALUES (?, ?, NOW())
       ON DUPLICATE KEY UPDATE room = VALUES(room), updated_at = NOW()`,
            [pid, room || null],
        );
        return { pid, room: room || null };
    }

    // ── Registered nurse dashboard ──────────────────────────────────────────

    async getNurseDashboard(nurseId: number) {
        const [nurse] = await this.dataSource.query<NurseUserRow[]>(
            `SELECT id, username, fname, lname, title
       FROM users WHERE id = ? AND active = 1`,
            [nurseId],
        );

        // All active patients, enriched with care assignment + latest vitals.
        // The nurse sees every patient on the ward; assigned patients are flagged.
        const patients = await this.dataSource.query<WardPatientRow[]>(
            `SELECT pd.id, pd.pid, pd.fname, pd.lname, pd.DOB, pd.sex,
              ca.room, ca.acuity_level, ca.acuity_score,
              (ca.assigned_nurse_id = ? OR ca.charge_nurse_id = ?) AS is_assigned,
              v.bps, v.bpd, v.pulse, v.temperature, v.respiration, v.oxygen_saturation,
              v.weight, v.height, v.BMI,
              DATE_FORMAT(v.date, '%Y-%m-%d %H:%i') AS last_vital_date,
              (EXISTS(
                 SELECT 1 FROM booking_requests br
                 WHERE br.pid = pd.pid AND br.status = 'approved' AND br.preferred_date = CURDATE()
              ) AND NOT EXISTS(
                 SELECT 1 FROM form_vitals fv WHERE fv.pid = pd.pid
              )) AS awaiting_vitals
       FROM patient_data pd
       LEFT JOIN patient_care_assignment ca ON ca.pid = pd.pid
       LEFT JOIN form_vitals v ON v.id = (
          SELECT id FROM form_vitals WHERE pid = pd.pid ORDER BY date DESC, id DESC LIMIT 1)
       WHERE pd.status = 'active'
       ORDER BY FIELD(ca.acuity_level, 'stat', 'urgent', 'routine'), pd.lname, pd.fname`,
            [nurseId, nurseId],
        );
        const assignedPatients = patients.filter((p) => p.is_assigned);

        // Clinical notes shared from provider screenings for those patients.
        const sharedNotes = await this.dataSource.query<NursingNoteRow[]>(
            `SELECT n.id, n.date, n.title, n.body, n.pid, n.user, n.groupname,
              n.message_status,
              ca.room, ca.acuity_level, ca.acuity_score,
              pd.fname, pd.lname
       FROM pnotes n
       JOIN patient_care_assignment ca ON ca.pid = n.pid
       JOIN patient_data pd ON pd.pid = n.pid
       WHERE n.deleted = 0
         AND n.groupname IN ('clinical', 'progress', 'nurse')
         AND (ca.assigned_nurse_id = ? OR ca.charge_nurse_id = ?)
       ORDER BY FIELD(ca.acuity_level, 'stat', 'urgent', 'routine'), n.date DESC
       LIMIT 100`,
            [nurseId, nurseId],
        );

        const unreadCount = sharedNotes.filter(
            (n) => n.message_status === 'New',
        ).length;

        return { nurse, patients, assignedPatients, sharedNotes, unreadCount };
    }

    async markNoteRead(
        nurseId: number,
        noteId: number,
    ): Promise<{ id: number; message_status: string }> {
        const rows = await this.dataSource.query<{ id: number }[]>(
            `SELECT n.id
       FROM pnotes n
       JOIN patient_care_assignment ca ON ca.pid = n.pid
       WHERE n.id = ? AND (ca.assigned_nurse_id = ? OR ca.charge_nurse_id = ?)`,
            [noteId, nurseId, nurseId],
        );
        if (!rows.length) {
            throw new NotFoundException(
                'Note not found or not assigned to you',
            );
        }
        await this.dataSource.query(
            `UPDATE pnotes SET message_status = 'Read' WHERE id = ?`,
            [noteId],
        );
        return { id: noteId, message_status: 'Read' };
    }

    async markAllNotesRead(nurseId: number): Promise<{ updated: boolean }> {
        await this.dataSource.query(
            `UPDATE pnotes n
       JOIN patient_care_assignment ca ON ca.pid = n.pid
       SET n.message_status = 'Read'
       WHERE n.groupname IN ('clinical', 'progress', 'nurse')
         AND n.message_status = 'New'
         AND (ca.assigned_nurse_id = ? OR ca.charge_nurse_id = ?)`,
            [nurseId, nurseId],
        );
        return { updated: true };
    }
}
