import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface NotificationUser {
  sub?: number;
  role?: string;
  username?: string;
  displayName?: string;
}

/**
 * Per-user badge counts for the sidebar, plus the drug-information notices that
 * are raised when a provider looks a prescribed drug up in the FDA data.
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    await this.ensureSchema();
  }

  private async ensureSchema(): Promise<void> {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS drug_info_notifications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        pid INT NULL,
        patient_name VARCHAR(160) NULL,
        drug VARCHAR(160) NOT NULL,
        summary VARCHAR(255) NULL,
        details MEDIUMTEXT NULL,
        created_by VARCHAR(120) NULL,
        assigned_to VARCHAR(120) NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'New',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        read_at DATETIME NULL,
        INDEX idx_druginfo_status (status),
        INDEX idx_druginfo_pid (pid)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    this.logger.log('Drug info notification schema ready');
  }

  /** Run a COUNT query, returning 0 if the table/shape is missing. */
  private async count(query: string, params: any[] = []): Promise<number> {
    try {
      const rows = await this.dataSource.query(query, params);
      return Number(rows?.[0]?.n) || 0;
    } catch (err) {
      this.logger.warn(`Notification count failed: ${(err as Error).message}`);
      return 0;
    }
  }

  /**
   * Badge counts for every notification-bearing area. Each count is scoped to
   * the signed-in user (admins see everything and also pick up unassigned
   * items, so nothing gets stranded).
   */
  async getSummary(user: NotificationUser) {
    const userId = Number(user?.sub) || 0;
    const adminFlag = user?.role === 'admin' ? 1 : 0;
    const uid = String(userId);

    const [messages, referrals, drugInfo, pharmacy, patientFlow] = await Promise.all([
      this.count(
        `SELECT COUNT(*) AS n FROM pnotes
          WHERE deleted = 0 AND message_status = 'New'
            AND groupname IN ('events', 'Default')`,
      ),
      this.count(
        `SELECT COUNT(*) AS n FROM pnotes
          WHERE deleted = 0 AND groupname = 'referral'
            AND message_status IN ('pending', 'New')
            AND (? = 1 OR assigned_to = ? OR assigned_to = '' OR assigned_to IS NULL)`,
        [adminFlag, uid],
      ),
      this.count(
        `SELECT COUNT(*) AS n FROM drug_info_notifications
          WHERE status = 'New'
            AND (? = 1 OR assigned_to IS NULL OR assigned_to = '' OR assigned_to = ?)`,
        [adminFlag, uid],
      ),
      this.count(
        `SELECT COUNT(*) AS n FROM billing_holds
          WHERE hold_type = 'pharmacy' AND cleared_at IS NULL`,
      ),
      this.count(
        `SELECT COUNT(*) AS n FROM patient_tracker WHERE DATE(date) = CURDATE()`,
      ),
    ]);

    return {
      messages,
      referrals,
      drugInfo,
      pharmacy,
      patientFlow,
      generatedAt: new Date().toISOString(),
    };
  }

  // ─── Drug information notifications ─────────────────────────────

  /**
   * Record that a prescribed drug was looked up in the FDA data. `details` can
   * be an object (stored as JSON) so the modal can show every specific that was
   * on screen when the lookup happened.
   */
  async createDrugInfoNotification(user: NotificationUser, dto: any) {
    const drug = String(dto?.drug || '').trim();
    if (!drug) {
      throw new BadRequestException('Drug name is required');
    }
    const pid = Number(dto?.pid) > 0 ? Number(dto.pid) : null;
    const patientName = dto?.patientName ? String(dto.patientName).slice(0, 160) : null;
    const summary = dto?.summary ? String(dto.summary).slice(0, 255) : null;
    const details =
      dto?.details == null
        ? null
        : typeof dto.details === 'string'
          ? dto.details
          : JSON.stringify(dto.details);
    const createdBy =
      user?.displayName || user?.username || (user?.sub ? String(user.sub) : null);

    const result = await this.dataSource.query(
      `INSERT INTO drug_info_notifications
         (pid, patient_name, drug, summary, details, created_by, assigned_to, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'New')`,
      [
        pid,
        patientName,
        drug.slice(0, 160),
        summary,
        details,
        createdBy,
        dto?.assignedTo ? String(dto.assignedTo) : null,
      ],
    );

    this.logger.log(`Drug info notification #${result.insertId} raised for "${drug}"`);
    return { id: result.insertId, drug, pid, status: 'New' };
  }

  /** Notices this user should see, newest first, with the unread count. */
  async listDrugInfoNotifications(user: NotificationUser, limit = 25) {
    const adminFlag = user?.role === 'admin' ? 1 : 0;
    const uid = String(Number(user?.sub) || 0);
    const take = Math.min(Math.max(Number(limit) || 25, 1), 100);

    const rows = await this.dataSource.query(
      `SELECT id, pid, patient_name AS patientName, drug, summary, details,
              created_by AS createdBy, assigned_to AS assignedTo, status,
              created_at AS createdAt, read_at AS readAt
         FROM drug_info_notifications
        WHERE ? = 1 OR assigned_to IS NULL OR assigned_to = '' OR assigned_to = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ?`,
      [adminFlag, uid, take],
    );

    const notifications = (rows as any[]).map((r) => {
      let parsed: any = null;
      if (r.details) {
        try {
          parsed = JSON.parse(r.details);
        } catch {
          parsed = { note: String(r.details) };
        }
      }
      return { ...r, details: parsed };
    });

    return {
      unread: notifications.filter((n) => String(n.status || '').toLowerCase() === 'new').length,
      notifications,
    };
  }

  /** Mark a drug info notice as read. */
  async ackDrugInfoNotification(id: number) {
    await this.dataSource.query(
      `UPDATE drug_info_notifications SET status = 'Read', read_at = NOW() WHERE id = ?`,
      [id],
    );
    return { id, status: 'Read' };
  }
}
