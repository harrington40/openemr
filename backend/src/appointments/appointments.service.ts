import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { resolveVisitCategoryId } from '../common/calendar-categories.util';
import { parseNumericId } from '../common/id.util';

export interface AppointmentRow {
  pc_eid: number;
  pc_catid: number;
  pc_aid: string | null;
  pc_pid: string | null;
  pc_title: string | null;
  pc_time: string | null;
  pc_hometext: string | null;
  pc_eventDate: string;
  pc_endDate: string | null;
  pc_duration: number;
  pc_startTime: string | null;
  pc_endTime: string | null;
  pc_apptstatus: string;
  pc_facility: number;
  pc_billing_location: number;
  pc_uuid: string | null;
  // Flow board enriched fields
  provider_name?: string | null;
  provider_title?: string | null;
  provider_color?: string | null;
  checked_in_at?: string | null;
  wait_minutes?: number | null;
  patient_provider_name?: string | null;
}

export interface CreateAppointmentDto {
  pc_catid: number;
  pc_title: string;
  pc_duration: number;
  pc_hometext?: string;
  pc_apptstatus?: string;
  pc_eventDate: string;
  pc_startTime: string;
  pc_facility?: number;
  pc_billing_location?: number;
  pc_aid?: string;
}

@Injectable()
export class AppointmentsService {
  constructor(@InjectDataSource() private dataSource: DataSource) {}

  async findAll(params?: {
    date?: string;
    startDate?: string;
    endDate?: string;
    category?: string;
  }): Promise<AppointmentRow[]> {
    let query = `
      SELECT e.pc_eid, e.pc_catid, e.pc_aid, e.pc_pid,
        e.pc_title, e.pc_time, e.pc_hometext,
        e.pc_eventDate, e.pc_endDate,
        DATE_FORMAT(e.pc_eventDate, '%Y-%m-%d') as eventDateStr,
        e.pc_duration, e.pc_startTime, e.pc_endTime,
        e.pc_apptstatus, e.pc_facility,
        e.pc_billing_location,
        LOWER(HEX(e.uuid)) as pc_uuid,
        -- An appointment whose category row is missing used to read as NULL and
        -- vanish from any UI that filters or groups by category. Say so instead.
        COALESCE(c.pc_catname, CONCAT('Unknown category #', e.pc_catid)) as category,
        pd.fname as fname,
        pd.lname as lname,
        pd.pid as pid,
        pd.id as patient_id,
        pd.public_id as patient_public_id,
        CONCAT(u.fname, ' ', u.lname) as provider_name,
        u.title as provider_title,
        u.calendar_color as provider_color,
        pt.date as checked_in_at,
        TIMESTAMPDIFF(MINUTE, pt.date, NOW()) as wait_minutes,
        CONCAT(pu.fname, ' ', pu.lname) as patient_provider_name
      FROM openemr_postcalendar_events e
      LEFT JOIN openemr_postcalendar_categories c ON e.pc_catid = c.pc_catid
      LEFT JOIN users u ON e.pc_aid = u.id
      LEFT JOIN patient_tracker pt ON e.pc_eid = pt.eid
      LEFT JOIN patient_data pd ON e.pc_pid = pd.pid
      LEFT JOIN users pu ON pd.providerID = pu.id
    `;
    const conditions: string[] = [];
    const values: any[] = [];

    if (params?.date) {
      conditions.push('e.pc_eventDate = ?');
      values.push(params.date);
    }
    if (params?.startDate) {
      conditions.push('e.pc_eventDate >= ?');
      values.push(params.startDate);
    }
    if (params?.endDate) {
      conditions.push('e.pc_eventDate <= ?');
      values.push(params.endDate);
    }
    if (params?.category) {
      conditions.push('c.pc_catname = ?');
      values.push(params.category);
    }

    if (conditions.length) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY e.pc_eventDate ASC, e.pc_startTime ASC LIMIT 100';

    return this.dataSource.query(query, values);
  }

  async findOne(eid: number): Promise<AppointmentRow> {
    // Defence in depth: the controller rejects a malformed id, but this must not
    // depend on every future caller remembering. Without it a NaN is interpolated
    // into the SQL as the bare token `NaN` and MySQL reports "Unknown column".
    const id = parseNumericId(eid, 'Appointment id');
    const rows = await this.dataSource.query(
      `SELECT pc_eid, pc_catid, pc_aid, pc_pid,
        pc_title, pc_time, pc_hometext,
        pc_eventDate, pc_endDate,
        pc_duration, pc_startTime, pc_endTime,
        pc_apptstatus, pc_facility,
        pc_billing_location,
        LOWER(HEX(uuid)) as pc_uuid
      FROM openemr_postcalendar_events WHERE pc_eid = ?`,
      [id],
    );
    if (!rows.length) {
      throw new NotFoundException(`Appointment #${id} not found`);
    }
    return rows[0];
  }

  async findByPatient(pid: string): Promise<AppointmentRow[]> {
    return this.dataSource.query(
      `SELECT pc_eid, pc_catid, pc_aid, pc_pid,
        pc_title, pc_time, pc_hometext,
        pc_eventDate, pc_endDate,
        pc_duration, pc_startTime, pc_endTime,
        pc_apptstatus, pc_facility,
        pc_billing_location,
        LOWER(HEX(uuid)) as pc_uuid
      FROM openemr_postcalendar_events WHERE pc_pid = ?
      ORDER BY pc_eventDate DESC, pc_startTime ASC`,
      [pid],
    );
  }

  async create(pid: string, dto: CreateAppointmentDto): Promise<{ id: number }> {
    // Never file an appointment against a category that does not exist — that is
    // exactly how the 23 orphaned appointments happened.
    const categoryId = await resolveVisitCategoryId(this.dataSource, dto.pc_catid);
    const result = await this.dataSource.query(
      `INSERT INTO openemr_postcalendar_events
        (pc_catid, pc_aid, pc_pid, pc_title, pc_hometext, pc_eventDate,
         pc_startTime, pc_duration, pc_apptstatus, pc_facility, pc_billing_location,
         pc_time, pc_eventstatus, pc_multiple)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 0, 1)`,
      [
        categoryId,
        dto.pc_aid || '1',
        pid,
        dto.pc_title,
        dto.pc_hometext || '',
        dto.pc_eventDate,
        dto.pc_startTime,
        dto.pc_duration,
        dto.pc_apptstatus || '-',
        dto.pc_facility || 0,
        dto.pc_billing_location || 0,
      ],
    );
    return { id: result.insertId };
  }

  async updateStatus(eid: number, status: string): Promise<void> {
    await this.dataSource.query(
      'UPDATE openemr_postcalendar_events SET pc_apptstatus = ? WHERE pc_eid = ?',
      [status, eid],
    );
  }

  async findOpenSlots(date: string, providerId?: string) {
    // 1. Find "In Office" blocks for this provider on this date
    //    Categories with pc_cattype = 2 (In Office) define provider availability windows
    const inOfficeEvents = await this.dataSource.query(
      `SELECT e.pc_startTime, e.pc_endTime, e.pc_duration
       FROM openemr_postcalendar_events e
       JOIN openemr_postcalendar_categories c ON e.pc_catid = c.pc_catid
       WHERE e.pc_eventDate = ?
         AND c.pc_cattype = 2
         ${providerId ? 'AND e.pc_aid = ?' : ''}
         AND c.pc_active = 1
       ORDER BY e.pc_startTime`,
      providerId ? [date, providerId] : [date],
    );

    // 2. If no In Office blocks found, fall back to default hours (8 AM - 5 PM)
    const officeRanges: { start: string; end: string }[] = [];
    if (inOfficeEvents.length > 0) {
      for (const ev of inOfficeEvents) {
        if (ev.pc_startTime && ev.pc_endTime) {
          officeRanges.push({
            start: ev.pc_startTime.substring(0, 5),
            end: ev.pc_endTime.substring(0, 5),
          });
        }
      }
    } else {
      officeRanges.push({ start: '08:00', end: '17:00' });
    }

    // 3. Generate 30-minute slots within office ranges
    const allSlots: string[] = [];
    for (const range of officeRanges) {
      const startParts = range.start.split(':').map(Number);
      const endParts = range.end.split(':').map(Number);
      let hour = startParts[0];
      let min = startParts[1];

      while (hour < endParts[0] || (hour === endParts[0] && min < endParts[1])) {
        allSlots.push(`${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
        min += 30;
        if (min >= 60) { min = 0; hour++; }
      }
    }

    // 4. Remove slots already booked
    const existing = await this.dataSource.query(
      `SELECT pc_startTime FROM openemr_postcalendar_events
       WHERE pc_eventDate = ?
         AND pc_apptstatus NOT IN ('Canceled', 'No Show')
         ${providerId ? 'AND pc_aid = ?' : ''}`,
      providerId ? [date, providerId] : [date],
    );
    const taken = new Set(existing.map((e: any) => e.pc_startTime?.substring(0, 5)));

    const available = allSlots.filter(s => !taken.has(s));

    return {
      date,
      providerId: providerId || null,
      officeRanges,
      slots: available.map(time => ({ time, available: true })),
      total: available.length,
    };
  }

  /** List active physicians and their "In Office" availability blocks for a date. */
  async getProviderSchedule(date: string) {
    const providers = await this.dataSource.query(
      `SELECT u.id, u.fname, u.lname, u.title, u.calendar_color, u.active, u.main_menu_role
       FROM users u
       WHERE u.active = 1 AND u.main_menu_role = 'standard'
       ORDER BY u.lname, u.fname`,
    );
    const blocks = await this.dataSource.query(
      `SELECT e.pc_eid, e.pc_aid, e.pc_startTime, e.pc_endTime, e.pc_eventDate
       FROM openemr_postcalendar_events e
       JOIN openemr_postcalendar_categories c ON e.pc_catid = c.pc_catid
       WHERE e.pc_eventDate = ? AND c.pc_cattype = 2`,
      [date],
    );
    return providers.map((p: any) => ({
      ...p,
      blocks: blocks.filter((b: any) => String(b.pc_aid) === String(p.id)),
      onSchedule: blocks.some((b: any) => String(b.pc_aid) === String(p.id)),
    }));
  }

  /** Add an "In Office" availability block for a provider on a date. */
  async addProviderSchedule(date: string, providerId: number, startTime: string, endTime: string) {
    const [cat] = await this.dataSource.query(
      `SELECT pc_catid FROM openemr_postcalendar_categories WHERE pc_cattype = 2 AND pc_active = 1 ORDER BY pc_catid ASC LIMIT 1`,
    );
    let catId = cat?.pc_catid;
    if (!catId) {
      // Self-heal: create the "In Office" category if it doesn't exist yet.
      const ins = await this.dataSource.query(
        `INSERT INTO openemr_postcalendar_categories
          (pc_catname, pc_catcolor, pc_catdesc, pc_recurrtype, pc_recurrfreq, pc_duration,
           pc_end_date_flag, pc_end_date_freq, pc_end_all_day, pc_dailylimit, pc_cattype, pc_active, pc_seq, aco_spec)
         VALUES ('In Office', '#0d6efd', 'Provider availability block', 0, 0, 0, 0, 0, 0, 0, 2, 1, 0, 'encounters|notes')`,
      );
      catId = ins.insertId;
    }
    const norm = (t: string) => (t && t.length <= 5 ? `${t}:00` : t);
    const result = await this.dataSource.query(
      `INSERT INTO openemr_postcalendar_events
        (pc_catid, pc_aid, pc_pid, pc_title, pc_hometext, pc_eventDate,
         pc_startTime, pc_endTime, pc_duration, pc_apptstatus, pc_facility, pc_billing_location,
         pc_time, pc_eventstatus, pc_multiple)
       VALUES (?, ?, '', 'In Office', '', ?, ?, ?, 0, '-', 0, 0, NOW(), 0, 1)`,
      [catId, providerId, date, norm(startTime), norm(endTime)],
    );
    return { id: result.insertId };
  }

  /** Remove a provider availability block. */
  async deleteProviderSchedule(eid: number) {
    await this.dataSource.query(`DELETE FROM openemr_postcalendar_events WHERE pc_eid = ?`, [eid]);
    return { message: 'removed' };
  }

  async delete(eid: number): Promise<void> {
    await this.dataSource.query(
      'DELETE FROM openemr_postcalendar_events WHERE pc_eid = ?',
      [eid],
    );
  }

  /**
   * Create a walk-in patient_tracker entry so patient appears on flow board.
   */
  async createWalkInCheckin(pid: number, providerId: number) {
    const result = await this.dataSource.query(
      `INSERT INTO patient_tracker (date, apptdate, appttime, eid, pid, original_user, encounter, lastseq)
       VALUES (NOW(), CURDATE(), CURTIME(), 0, ?, '', 0, '')`,
      [pid],
    );
    return { id: result.insertId };
  }

  /**
   * Get patients from patient_tracker that don't have appointments (walk-ins).
   */
  async getWalkInPatients(date?: string) {
    const today = date || new Date().toISOString().substring(0, 10);
    return this.dataSource.query(
      `SELECT pt.id as tracker_id, pt.date as checked_in_at, pt.pid,
              pd.id as patient_id,
              pd.fname, pd.lname,
              DATE_FORMAT(pd.DOB, '%Y-%m-%d') as DOB,
              pd.sex,
              pd.providerID,
              CONCAT(u.fname, ' ', u.lname) as provider_name,
              u.title as provider_title,
              u.calendar_color as provider_color,
              TIMESTAMPDIFF(MINUTE, pt.date, NOW()) as wait_minutes
       FROM patient_tracker pt
       JOIN patient_data pd ON pt.pid = pd.pid
       LEFT JOIN users u ON pd.providerID = u.id
       WHERE pt.apptdate = ? AND pt.eid = 0
       ORDER BY pt.date ASC`,
      [today],
    );
  }
}
