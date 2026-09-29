import {
    Injectable,
    Logger,
    OnModuleInit,
    BadRequestException,
    NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PatientsService } from '../patients/patients.service';

export interface CreateBookingDto {
    fname: string;
    lname: string;
    phone_contact: string;
    email?: string;
    preferred_date: string;
    preferred_time?: string;
    reason?: string;
    source?: string;
}

/** `booking_requests` row (with the joined provider name). */
export interface BookingRequestRow {
    id: number;
    fname: string;
    lname: string;
    phone_contact: string;
    email: string | null;
    preferred_date: string;
    preferred_time: string | null;
    reason: string | null;
    source: string | null;
    status: string;
    provider_id: number | null;
    patient_id: number | null;
    pid: number | null;
    appointment_id: number | null;
    reviewer_note: string | null;
    created_at: string;
    reviewed_at: string | null;
    provider_name?: string | null;
}

/** Affected-rows result of an INSERT / UPDATE / DELETE. */
interface AffectedRowsResult {
    affectedRows: number;
    insertId: number;
}

@Injectable()
export class BookingsService implements OnModuleInit {
    private readonly logger = new Logger(BookingsService.name);

    constructor(
        @InjectDataSource() private readonly dataSource: DataSource,
        private readonly patients: PatientsService,
    ) {}

    async onModuleInit(): Promise<void> {
        await this.ensureSchema();
    }

    private async ensureSchema(): Promise<void> {
        await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS booking_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        fname VARCHAR(60) NOT NULL,
        lname VARCHAR(60) NOT NULL,
        phone_contact VARCHAR(40) NOT NULL,
        email VARCHAR(120) NULL,
        preferred_date DATE NOT NULL,
        preferred_time VARCHAR(5) NULL,
        reason VARCHAR(255) NULL,
        source VARCHAR(20) NOT NULL DEFAULT 'social',
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        patient_id INT NULL,
        pid INT NULL,
        appointment_id INT NULL,
        provider_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        reviewed_at DATETIME NULL,
        reviewer_note VARCHAR(255) NULL,
        INDEX idx_booking_status (status),
        INDEX idx_booking_date (preferred_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
        this.logger.log('booking_requests schema ready');
    }

    async createRequest(
        dto: CreateBookingDto,
    ): Promise<{ id: number; status: string }> {
        const fname = String(dto.fname || '').trim();
        const lname = String(dto.lname || '').trim();
        const phone = String(dto.phone_contact || '').trim();
        const date = String(dto.preferred_date || '').trim();

        if (!fname || !lname)
            throw new BadRequestException('First and last name are required');
        if (!phone) throw new BadRequestException('Phone number is required');
        if (!date) throw new BadRequestException('Preferred date is required');

        const result = await this.dataSource.query<AffectedRowsResult>(
            `INSERT INTO booking_requests
        (fname, lname, phone_contact, email, preferred_date, preferred_time, reason, source, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
            [
                fname,
                lname,
                phone,
                dto.email || null,
                date,
                dto.preferred_time || '09:00',
                dto.reason || 'General appointment',
                dto.source || 'social',
            ],
        );

        return { id: result.insertId, status: 'pending' };
    }

    async listRequests(): Promise<BookingRequestRow[]> {
        return this.dataSource.query<BookingRequestRow[]>(
            `SELECT br.*, CONCAT(COALESCE(u.fname,''), ' ', COALESCE(u.lname,'')) AS provider_name
       FROM booking_requests br
       LEFT JOIN users u ON u.id = br.provider_id
       ORDER BY FIELD(br.status, 'pending', 'approved', 'declined'), br.created_at DESC`,
        );
    }

    private async pickProvider(
        providerId?: number | string,
        date?: string,
    ): Promise<{ id: number; fname: string; lname: string } | null> {
        if (providerId) {
            const rows = await this.dataSource.query<
                { id: number; fname: string; lname: string }[]
            >(
                `SELECT id, fname, lname FROM users WHERE id = ? AND active = 1 LIMIT 1`,
                [providerId],
            );
            return rows[0] || null;
        }
        const rows = await this.dataSource.query<
            { id: number; fname: string; lname: string }[]
        >(
            `SELECT u.id, u.fname, u.lname,
              (SELECT COUNT(*) FROM openemr_postcalendar_events e
               WHERE e.pc_aid = u.id AND e.pc_eventDate = ?
                 AND e.pc_apptstatus NOT IN ('Canceled','No Show')) AS booked
       FROM users u
       WHERE u.active = 1 AND u.main_menu_role = 'standard'
       ORDER BY booked ASC, u.id ASC
       LIMIT 1`,
            [date || new Date().toISOString().slice(0, 10)],
        );
        return rows[0] || null;
    }

    async approve(id: number, providerId?: number | string) {
        const [req] = await this.dataSource.query<BookingRequestRow[]>(
            `SELECT * FROM booking_requests WHERE id = ? LIMIT 1`,
            [id],
        );
        if (!req) throw new NotFoundException(`Booking #${id} not found`);
        if (req.status !== 'pending')
            throw new BadRequestException(
                `Booking #${id} is already ${req.status}`,
            );

        const provider = await this.pickProvider(
            providerId,
            req.preferred_date,
        );

        // 1. Create the patient record (active — they are verified by the registrar).
        const created = await this.patients.create(
            {
                fname: req.fname,
                lname: req.lname,
                phone_contact: req.phone_contact,
                email: req.email || undefined,
                status: 'active',
                providerID: provider ? provider.id : undefined,
            },
            `Social Media Booking #${id}`,
        );

        // 2. Place the appointment on the calendar for the requested date/time.
        let appointmentId: number | null = null;
        if (provider && req.preferred_date) {
            const [cat] = await this.dataSource.query<{ pc_catid: number }[]>(
                `SELECT pc_catid FROM openemr_postcalendar_categories WHERE pc_active = 1 ORDER BY pc_catid ASC LIMIT 1`,
            );
            const catId = cat?.pc_catid || 1;
            const startTime =
                req.preferred_time && req.preferred_time.length >= 5
                    ? req.preferred_time
                    : '09:00';
            const ins = await this.dataSource.query<AffectedRowsResult>(
                `INSERT INTO openemr_postcalendar_events
          (pc_catid, pc_aid, pc_pid, pc_title, pc_hometext, pc_eventDate,
           pc_startTime, pc_duration, pc_apptstatus, pc_facility, pc_billing_location,
           pc_time, pc_eventstatus, pc_multiple)
         VALUES (?, ?, ?, 'Booked Appointment', ?, ?, ?, 30, '-', 0, 0, NOW(), 0, 1)`,
                [
                    catId,
                    provider.id,
                    created.pid,
                    `Source: ${req.source || 'social'} · ${req.reason || 'General appointment'}`,
                    req.preferred_date,
                    startTime,
                ],
            );
            appointmentId = ins.insertId;
        }

        await this.dataSource.query(
            `UPDATE booking_requests
       SET status = 'approved', patient_id = ?, pid = ?, appointment_id = ?, provider_id = ?, reviewed_at = NOW()
       WHERE id = ?`,
            [created.id, created.pid, appointmentId, provider?.id ?? null, id],
        );

        this.logger.log(
            `Booking #${id} approved → patient #${created.pid} + appointment #${appointmentId}`,
        );
        return {
            message: 'approved',
            bookingId: id,
            patientId: created.id,
            pid: created.pid,
            publicId: created.publicId,
            providerId: provider?.id ?? null,
            providerName: provider
                ? `${provider.fname} ${provider.lname}`.trim()
                : null,
            appointmentId,
        };
    }

    async decline(id: number, note?: string): Promise<{ message: string }> {
        const [req] = await this.dataSource.query<
            { id: number; status: string }[]
        >(`SELECT id, status FROM booking_requests WHERE id = ? LIMIT 1`, [id]);
        if (!req) throw new NotFoundException(`Booking #${id} not found`);
        await this.dataSource.query(
            `UPDATE booking_requests SET status = 'declined', reviewer_note = ?, reviewed_at = NOW() WHERE id = ?`,
            [note || null, id],
        );
        return { message: 'declined' };
    }
}
