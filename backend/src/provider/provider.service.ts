import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EmergencyService } from '../emergency/emergency.service';

@Injectable()
export class ProviderService {
  constructor(
    @InjectDataSource() private dataSource: DataSource,
    private readonly emergency: EmergencyService,
  ) {}

  /**
   * Get today's dashboard for a specific provider.
   * Includes: today's appointments, assigned patients, stats.
   */
  async getDashboard(providerId: number, date?: string) {
    const today =
      date || new Date().toISOString().substring(0, 10); // YYYY-MM-DD

    // Provider info
    const [provider] = await this.dataSource.query(
      `SELECT id, username, fname, lname, title, specialty, physician_type,
              npi, upin, taxonomy, email, phone, phonecell, calendar_color
       FROM users WHERE id = ? AND active = 1`,
      [providerId],
    );

    if (!provider) return null;

    // Today's appointments
    const todayAppointments = await this.dataSource.query(
      `SELECT e.pc_eid, e.pc_pid, e.pc_title, e.pc_startTime, e.pc_endTime,
              e.pc_duration, e.pc_apptstatus, e.pc_hometext,
              e.pc_eventDate, c.pc_catname, c.pc_catcolor,
              p.id as patient_id, p.fname as patientFname, p.lname as patientLname,
              p.DOB as patientDob, p.sex as patientSex,
              p.phone_contact as patientPhone
       FROM openemr_postcalendar_events e
       JOIN openemr_postcalendar_categories c ON e.pc_catid = c.pc_catid
       LEFT JOIN patient_data p ON e.pc_pid = p.pid
       WHERE e.pc_eventDate = ? AND e.pc_aid = ?
       ORDER BY e.pc_startTime`,
      [today, String(providerId)],
    );

    // All assigned patients — with billing, encounter, and schedule synced
    const assignedPatients = await this.dataSource.query(
      `SELECT pd.id, pd.pid, pd.fname, pd.mname, pd.lname, pd.suffix, pd.DOB, pd.sex,
              pd.phone_contact, pd.email, pd.status,
              pd.regdate, pd.provider_since_date,
              DATEDIFF(NOW(), pd.regdate) as days_since_registration,
              -- Billing sync: total charges + payments + balance
              COALESCE(b.totalCharges, 0) as totalCharges,
              COALESCE(b.totalPayments, 0) as totalPayments,
              GREATEST(0, COALESCE(b.totalCharges, 0) - COALESCE(b.totalPayments, 0)) as balance,
              -- Last encounter sync
              fe.lastEncounterDate,
              fe.lastEncounterReason,
              fe.lastEncounterId,
              DATEDIFF(NOW(), fe.lastEncounterDate) as daysSinceLastEncounter,
              -- Next appointment sync
              apt.nextApptDate,
              apt.nextApptTime,
              apt.nextApptStatus,
              apt.nextApptCategory
       FROM patient_data pd
       -- Billing subquery
       LEFT JOIN (
         SELECT pid,
                SUM(fee) as totalCharges,
                COALESCE((SELECT SUM(ar.pay_amount) FROM ar_activity ar WHERE ar.pid = b2.pid), 0) as totalPayments
         FROM billing b2 WHERE b2.activity = 1
         GROUP BY pid
       ) b ON b.pid = pd.pid
       -- Last encounter subquery
       LEFT JOIN (
         SELECT fe2.pid,
                MAX(fe2.date) as lastEncounterDate,
                (SELECT fe3.reason FROM form_encounter fe3
                 WHERE fe3.pid = fe2.pid ORDER BY fe3.date DESC LIMIT 1) as lastEncounterReason,
                (SELECT fe4.encounter FROM form_encounter fe4
                 WHERE fe4.pid = fe2.pid ORDER BY fe4.date DESC LIMIT 1) as lastEncounterId
         FROM form_encounter fe2
         GROUP BY fe2.pid
       ) fe ON fe.pid = pd.pid
       -- Next appointment subquery
       LEFT JOIN (
         SELECT e.pc_pid,
                MIN(e.pc_eventDate) as nextApptDate,
                (SELECT e2.pc_startTime FROM openemr_postcalendar_events e2
                 WHERE e2.pc_pid = e.pc_pid AND e2.pc_eventDate >= CURDATE()
                 ORDER BY e2.pc_eventDate, e2.pc_startTime LIMIT 1) as nextApptTime,
                (SELECT e3.pc_apptstatus FROM openemr_postcalendar_events e3
                 WHERE e3.pc_pid = e.pc_pid AND e3.pc_eventDate >= CURDATE()
                 ORDER BY e3.pc_eventDate, e3.pc_startTime LIMIT 1) as nextApptStatus,
                (SELECT c.pc_catname FROM openemr_postcalendar_events e4
                 JOIN openemr_postcalendar_categories c ON e4.pc_catid = c.pc_catid
                 WHERE e4.pc_pid = e.pc_pid AND e4.pc_eventDate >= CURDATE()
                 ORDER BY e4.pc_eventDate, e4.pc_startTime LIMIT 1) as nextApptCategory
         FROM openemr_postcalendar_events e
         WHERE e.pc_eventDate >= CURDATE()
         GROUP BY e.pc_pid
       ) apt ON apt.pc_pid = pd.pid
       ORDER BY
         CASE WHEN fe.lastEncounterDate IS NULL THEN 1 ELSE 0 END,
         fe.lastEncounterDate DESC,
         pd.lname, pd.fname`,
     [],
   );

    // Stats
    const [stats] = await this.dataSource.query(
      `SELECT
         (SELECT COUNT(*) FROM patient_data) as totalPatients,
         (SELECT COUNT(*) FROM openemr_postcalendar_events
          WHERE pc_eventDate = ? AND pc_aid = ? AND pc_apptstatus NOT IN ('Canceled','No Show')) as todayAppointments,
         (SELECT COUNT(*) FROM openemr_postcalendar_events
          WHERE pc_eventDate = ? AND pc_aid = ? AND pc_apptstatus = 'Checkout') as completed,
         (SELECT COUNT(*) FROM openemr_postcalendar_events
          WHERE pc_eventDate = ? AND pc_aid = ? AND pc_apptstatus IN ('-','Check In')) as pending`,
      [
        today, String(providerId),
        today, String(providerId),
        today, String(providerId),
      ],
    );

    // Anyone this clinician is carrying in the emergency department right now.
    // Decorated by the emergency service, so the colour and the breach flag are
    // the ones the triage board is showing.
    const emergencyPatients = await this.emergency.getActiveVisitsForProvider(providerId);

    // Recent encounters for this provider
    const recentEncounters = await this.dataSource.query(
      `SELECT fe.encounter as id, fe.date, fe.reason, fe.pid,
              pd.fname, pd.mname, pd.lname, pd.suffix
       FROM form_encounter fe
       JOIN patient_data pd ON fe.pid = pd.pid
       WHERE fe.provider_id = ?
       ORDER BY fe.date DESC LIMIT 5`,
      [providerId],
    );

    return {
      provider,
      stats: {
        totalPatients: Number(stats.totalPatients) || 0,
        todayAppointments: Number(stats.todayAppointments) || 0,
        completed: Number(stats.completed) || 0,
        pending: Number(stats.pending) || 0,
      },
      todayAppointments,
      assignedPatients,
      emergencyPatients,
      emergency: {
        active: emergencyPatients.length,
        breached: emergencyPatients.filter((v: any) => v.breached).length,
        sickestLevel: emergencyPatients.length
          ? Math.min(...emergencyPatients.map((v: any) => Number(v.level) || 5))
          : null,
      },
      recentEncounters,
      date: today,
      syncedAt: new Date().toISOString(),
    };
  }

  /**
   * Sync status — returns timestamps of when each data component was last updated.
   * Used by frontend to show "last synced" indicators.
   */
  async getSyncStatus(providerId: number) {
    const now = new Date().toISOString();

    const [lastRegistration] = await this.dataSource.query(
      `SELECT MAX(regdate) as lastReg FROM patient_data WHERE providerID = ?`, [providerId],
    );
    const [lastEncounter] = await this.dataSource.query(
      `SELECT MAX(date) as lastEnc FROM form_encounter WHERE provider_id = ?`, [providerId],
    );
    const [lastBilling] = await this.dataSource.query(
      `SELECT MAX(b.date) as lastBill FROM billing b
       JOIN patient_data pd ON pd.pid = b.pid
       WHERE pd.providerID = ?`, [providerId],
    );
    const [lastAppointment] = await this.dataSource.query(
      `SELECT MAX(pc_eventDate) as lastApt FROM openemr_postcalendar_events
       WHERE pc_aid = ?`, [String(providerId)],
    );

    return {
      syncedAt: now,
      components: {
        registration: lastRegistration?.lastReg || null,
        encounters: lastEncounter?.lastEnc || null,
        billing: lastBilling?.lastBill || null,
        appointments: lastAppointment?.lastApt || null,
      },
      status: 'synced',
    };
  }

  /**
   * Get provider profile by id (public-facing, for registration staff).
   */
  async getProfile(id: number) {
    const [provider] = await this.dataSource.query(
      `SELECT id, username, fname, lname, title,
              specialty, physician_type, npi, upin, taxonomy,
              email, phone, phonecell,
              calendar_color, active
       FROM users WHERE id = ? AND active = 1`,
      [id],
    );

    if (!provider) return null;

    // Get today's availability (In Office blocks)
    const today = new Date().toISOString().substring(0, 10);
    const inOffice = await this.dataSource.query(
      `SELECT e.pc_startTime, e.pc_endTime
       FROM openemr_postcalendar_events e
       JOIN openemr_postcalendar_categories c ON e.pc_catid = c.pc_catid
       WHERE e.pc_eventDate = ? AND e.pc_aid = ? AND c.pc_cattype = 2`,
      [today, String(id)],
    );

    return { ...provider, todayAvailability: inOffice };
  }

  /**
   * Get list of all active providers (for registration dropdowns).
   */
  async getProviders() {
    return this.dataSource.query(
      `SELECT id, username, fname, lname, title, specialty,
              physician_type, npi, calendar_color, active
       FROM users WHERE active = 1
       ORDER BY lname, fname`,
    );
  }

  /**
   * Get providers available today (have In Office blocks on schedule).
   * Used for quick-assign of walk-in patients.
   */
  async getAvailableToday() {
    const today = new Date().toISOString().substring(0, 10);
    return this.dataSource.query(
      `SELECT DISTINCT u.id, u.username, u.fname, u.lname, u.title, u.specialty,
              u.physician_type, u.npi, u.calendar_color,
              c.pc_catname as availability_type,
              MIN(e.pc_startTime) as first_available,
              MAX(e.pc_endTime) as last_available,
              COUNT(DISTINCT e.pc_eid) as appointment_count
       FROM users u
       JOIN openemr_postcalendar_events e ON e.pc_aid = u.id
       JOIN openemr_postcalendar_categories c ON e.pc_catid = c.pc_catid
       WHERE u.active = 1
         AND e.pc_eventDate = ?
         AND c.pc_cattype = 2
       GROUP BY u.id, u.username, u.fname, u.lname, u.title, u.specialty,
                u.physician_type, u.npi, u.calendar_color, c.pc_catname
       ORDER BY u.lname, u.fname`,
      [today],
    );
  }
}
