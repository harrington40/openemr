import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import type { IEventBus, BusEvent } from '../event-bus/event-bus.interface';

export interface ChatMessageRow {
  id: number;
  pid: number;
  body: string;
  direction: 'patient' | 'provider';
  sender: string;
  date: string;
  message_status: string;
}

export interface ChatUser {
  sub: number;
  username: string;
  displayName?: string;
  role?: string;
}

/**
 * Patient ↔ Doctor chat.
 *
 * Conversations are persisted in the existing `pnotes` table using a dedicated
 * groupname (`patient-chat`). Direction is encoded in the title prefix so the
 * frontend can render bubbles without extra columns.
 *
 *   groupname  = 'patient-chat'
 *   user       = sender identity ('patient' or provider username)
 *   assigned_to= recipient identity (provider user id or patient pid)
 */
@Injectable()
export class PatientChatService implements OnModuleInit {
  private readonly logger = new Logger(PatientChatService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject('EVENT_BUS') private readonly eventBus: IEventBus,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.dataSource.query(
      `CREATE TABLE IF NOT EXISTS patient_chat_share (
         id INT AUTO_INCREMENT PRIMARY KEY,
         pid INT NOT NULL,
         user_id INT NOT NULL,
         access VARCHAR(10) NOT NULL DEFAULT 'read',
         granted_by INT NULL,
         created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
         UNIQUE KEY uq_chat_share (pid, user_id)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    );
  }

  /** Providers (physician/admin) have full access; others need an explicit share. */
  private isProvider(user: ChatUser): boolean {
    return ['admin', 'physician'].includes(user.role || '');
  }

  async resolveAccess(user: ChatUser, pid: number): Promise<'write' | 'read' | 'none'> {
    if (this.isProvider(user)) return 'write';
    const rows = await this.dataSource.query(
      `SELECT access FROM patient_chat_share WHERE pid = ? AND user_id = ? LIMIT 1`,
      [pid, user.sub],
    );
    if (rows.length) return rows[0].access === 'write' ? 'write' : 'read';
    // Fallback: the patient's assigned provider.
    const [pd] = await this.dataSource.query(
      `SELECT providerID FROM patient_data WHERE pid = ? LIMIT 1`,
      [pid],
    );
    if (pd && Number(pd.providerID) === Number(user.sub)) return 'write';
    return 'none';
  }

  async assertAccess(user: ChatUser, pid: number, level: 'read' | 'write'): Promise<'read' | 'write'> {
    const access = await this.resolveAccess(user, pid);
    if (access === 'none') {
      throw new ForbiddenException('Patient chat is restricted — request access from a doctor or administrator.');
    }
    if (level === 'write' && access !== 'write') {
      throw new ForbiddenException('You have read-only access to this patient chat.');
    }
    return access;
  }

  async getAccess(user: ChatUser, pid: number) {
    const access = await this.resolveAccess(user, pid);
    return { pid, access, canShare: this.isProvider(user) };
  }

  async getThreadForUser(user: ChatUser, pid: number): Promise<ChatMessageRow[]> {
    await this.assertAccess(user, pid, 'read');
    return this.getThread(pid);
  }

  async markThreadReadForUser(user: ChatUser, pid: number) {
    await this.assertAccess(user, pid, 'read');
    return this.markThreadRead(pid);
  }

  async listShares(pid: number) {
    return this.dataSource.query(
      `SELECT s.id, s.pid, s.user_id, s.access, s.created_at,
              u.username, u.fname, u.lname, u.main_menu_role
         FROM patient_chat_share s
         LEFT JOIN users u ON u.id = s.user_id
        WHERE s.pid = ?
        ORDER BY s.created_at DESC`,
      [pid],
    );
  }

  async shareWith(pid: number, userId: number, access: string, grantedBy: number | null) {
    const a = access === 'write' ? 'write' : 'read';
    await this.dataSource.query(
      `INSERT INTO patient_chat_share (pid, user_id, access, granted_by)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE access = VALUES(access), granted_by = VALUES(granted_by)`,
      [pid, userId, a, grantedBy],
    );
    return { pid, userId, access: a };
  }

  async revokeShare(pid: number, userId: number) {
    await this.dataSource.query(
      `DELETE FROM patient_chat_share WHERE pid = ? AND user_id = ?`,
      [pid, userId],
    );
    return { pid, userId, removed: true };
  }

  async getShareableUsers() {
    return this.dataSource.query(
      `SELECT id, username, fname, lname, main_menu_role
         FROM users WHERE active = 1 ORDER BY lname, fname`,
    );
  }

  /** Resolve and (optionally) validate a patient by pid + date of birth. */
  async validatePatient(pid: number, dob?: string): Promise<any> {
    if (!pid) {
      throw new BadRequestException('Patient ID is required');
    }

    const rows = await this.dataSource.query(
      `SELECT pid, fname, lname, DOB, providerID
         FROM patient_data
        WHERE pid = ?`,
      [pid],
    );

    if (!rows.length) {
      throw new NotFoundException('Patient not found');
    }

    const patient = rows[0];

    if (dob) {
      const patientDob = patient.DOB
        ? new Date(patient.DOB).toISOString().split('T')[0]
        : '';
      if (patientDob !== dob) {
        throw new UnauthorizedException(
          'Date of birth does not match our records',
        );
      }
    }

    return patient;
  }

  /** Patient (portal) sends a message to their provider. */
  async sendPatientMessage(pid: number, dob: string | undefined, body: string) {
    const patient = await this.validatePatient(pid, dob);

    if (!body || !body.trim()) {
      throw new BadRequestException('Message body is required');
    }

    const title = `[PATIENT→DOCTOR] ${patient.fname} ${patient.lname}`.trim();
    const result = await this.dataSource.query(
      `INSERT INTO pnotes (date, title, body, pid, user, groupname, message_status, assigned_to)
       VALUES (NOW(), ?, ?, ?, 'patient', 'patient-chat', 'New', ?)`,
      [
        title,
        body.trim(),
        pid,
        patient.providerID ? String(patient.providerID) : '',
      ],
    );

    await this.publishChatEvent({
      pid,
      body: body.trim(),
      direction: 'patient',
      messageId: result.insertId,
      providerId: patient.providerID,
      patientName: `${patient.fname} ${patient.lname}`.trim(),
    });

    return {
      id: result.insertId,
      pid,
      direction: 'patient' as const,
      body: body.trim(),
      title,
      message_status: 'New',
    };
  }

  /** Provider replies to a patient thread. */
  async sendProviderMessage(user: ChatUser, pid: number, body: string) {
    await this.assertAccess(user, pid, 'write');
    const patient = await this.validatePatient(pid);

    if (!body || !body.trim()) {
      throw new BadRequestException('Message body is required');
    }

    const senderName = user.displayName || user.username || String(user.sub);
    const title = `[DOCTOR→PATIENT] ${senderName}`;
    const result = await this.dataSource.query(
      `INSERT INTO pnotes (date, title, body, pid, user, groupname, message_status, assigned_to)
       VALUES (NOW(), ?, ?, ?, ?, 'patient-chat', 'New', ?)`,
      [
        title,
        body.trim(),
        pid,
        user.username || String(user.sub),
        String(pid),
      ],
    );

    await this.publishChatEvent({
      pid,
      body: body.trim(),
      direction: 'provider',
      messageId: result.insertId,
      providerId: patient.providerID,
      patientName: `${patient.fname} ${patient.lname}`.trim(),
      senderName,
    });

    return {
      id: result.insertId,
      pid,
      direction: 'provider' as const,
      body: body.trim(),
      title,
      message_status: 'New',
    };
  }

  /** Full conversation for one patient, oldest first. */
  async getThread(pid: number): Promise<ChatMessageRow[]> {
    const rows = await this.dataSource.query(
      `SELECT n.id, n.pid, n.date, n.title, n.body, n.user, n.message_status
         FROM pnotes n
        WHERE n.pid = ? AND n.groupname = 'patient-chat'
        ORDER BY n.date ASC, n.id ASC`,
      [pid],
    );

    return rows.map((r: any) => this.toChatMessage(r));
  }

  /** Patient portal thread (validates identity first). */
  async getPatientThread(pid: number, dob?: string): Promise<ChatMessageRow[]> {
    await this.validatePatient(pid, dob);
    return this.getThread(pid);
  }

  /** Unread patient messages for the provider dashboard notification. */
  async getUnread(user: ChatUser) {
    const isBroad = this.isProvider(user);

    const countRows = await this.dataSource.query(
      `SELECT COUNT(*) AS cnt
         FROM pnotes n
         JOIN patient_data pd ON pd.pid = n.pid
        WHERE n.groupname = 'patient-chat'
          AND n.user = 'patient'
          AND n.message_status = 'New'
          ${isBroad ? '' : 'AND n.pid IN (SELECT pid FROM patient_chat_share WHERE user_id = ?)'}`,
      isBroad ? [] : [user.sub],
    );

    const messages = await this.dataSource.query(
      `SELECT n.id, n.pid, n.date, n.title, n.body, pd.fname, pd.lname
         FROM pnotes n
         JOIN patient_data pd ON pd.pid = n.pid
        WHERE n.groupname = 'patient-chat'
          AND n.user = 'patient'
          AND n.message_status = 'New'
          ${isBroad ? '' : 'AND n.pid IN (SELECT pid FROM patient_chat_share WHERE user_id = ?)'}
        ORDER BY n.date DESC
        LIMIT 20`,
      isBroad ? [] : [user.sub],
    );

    return { count: Number(countRows[0]?.cnt || 0), messages };
  }

  /** All patients (with unread counts + last message preview) for the chat sidebar. */
  async getChatPatients(user: ChatUser) {
    const isBroad = this.isProvider(user);

    return this.dataSource.query(
      `SELECT pd.pid,
              pd.fname,
              pd.lname,
              COALESCE(SUM(CASE WHEN n.user = 'patient' AND n.message_status = 'New' THEN 1 ELSE 0 END), 0) AS unread,
              MAX(n.date) AS last_date,
              (SELECT n2.body FROM pnotes n2
                WHERE n2.pid = pd.pid AND n2.groupname = 'patient-chat'
                ORDER BY n2.date DESC, n2.id DESC LIMIT 1) AS last_message
         FROM patient_data pd
         LEFT JOIN pnotes n ON n.pid = pd.pid AND n.groupname = 'patient-chat'
         ${isBroad ? '' : 'WHERE pd.pid IN (SELECT pid FROM patient_chat_share WHERE user_id = ?)'}
        GROUP BY pd.pid, pd.fname, pd.lname
        ORDER BY unread DESC, last_date DESC, pd.lname ASC
        LIMIT 200`,
      isBroad ? [] : [user.sub],
    );
  }

  /** Mark patient-originated messages in a thread as read. */
  async markThreadRead(pid: number) {
    await this.dataSource.query(
      `UPDATE pnotes
          SET message_status = 'Read'
        WHERE pid = ? AND groupname = 'patient-chat'
          AND user = 'patient' AND message_status = 'New'`,
      [pid],
    );
    return { pid, status: 'read' };
  }

  // ---- private helpers ----

  private toChatMessage(r: any): ChatMessageRow {
    return {
      id: Number(r.id),
      pid: Number(r.pid),
      body: r.body,
      direction: r.title?.startsWith('[PATIENT→DOCTOR]') ? 'patient' : 'provider',
      sender: r.user,
      date: r.date,
      message_status: r.message_status,
    };
  }

  private async publishChatEvent(data: {
    pid: number;
    body: string;
    direction: 'patient' | 'provider';
    messageId: number;
    providerId?: number;
    patientName?: string;
    senderName?: string;
  }): Promise<void> {
    const event: BusEvent = {
      topic: 'openrx.messages.patient-chat',
      eventId: randomUUID(),
      timestamp: new Date().toISOString(),
      type: 'message',
      priority: 'NORMAL',
      source: { module: 'patient-chat' },
      payload: {
        title:
          data.direction === 'patient'
            ? `Patient message from ${data.patientName || 'a patient'}`
            : `Doctor reply to ${data.patientName || 'a patient'}`,
        body: data.body,
        pid: data.pid,
        direction: data.direction,
        messageId: data.messageId,
        providerId: data.providerId,
        patientName: data.patientName,
        senderName: data.senderName,
      },
    };

    try {
      await this.eventBus.publish(event);
    } catch (err) {
      this.logger.warn(`Failed to publish patient-chat event: ${err}`);
    }
  }
}
