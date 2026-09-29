import {
    Injectable,
    Logger,
    OnModuleDestroy,
    OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { MailboxService } from './mailbox.service';
import { isNightlyRunDue, NightlyPolicy } from './mail-schedule.util';

/**
 * The nightly cold-storage sweep.
 *
 * The smart mailbox only stays shallow if old mail actually leaves — relying on
 * somebody remembering to press a button is how a 61-conversation inbox happens.
 * This runs the same `archive()` path the button uses (so the preview, the undo
 * and the "unread is never archived" rule all still apply), once a day after a
 * configured hour, and records enough to explain itself in the UI afterwards.
 *
 * Scheduling style deliberately mirrors `BillingIntegrityService`: a dependency
 * free 15-minute tick plus a boot check, guarded by the recorded last run.
 * @nestjs/schedule is not installed and the deploy ships dist/ only, so a new
 * runtime dependency would have to be installed on the server.
 */
/** `mailbox_settings` row. */
interface MailboxSettingRow {
    setting_key: string;
    setting_value: string;
}

/** The most recent automatic archive. */
interface LastAutoArchiveRow {
    id: number;
    created_at: string | Date;
    message_count: number;
    byte_size: number;
    b2_file_name: string;
}

/** Aggregated automatic-archive totals. */
interface AutoArchiveTotalsRow {
    archives: number | string;
    messages: number | string;
    bytes: number | string;
}

@Injectable()
export class MailboxSchedulerService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(MailboxSchedulerService.name);
    private timer?: NodeJS.Timeout;
    private bootTimer?: NodeJS.Timeout;
    private running = false;

    private static readonly DEFAULTS: NightlyPolicy = {
        enabled: true,
        hour: 3,
        retentionDays: 90,
    };

    constructor(
        @InjectDataSource() private readonly dataSource: DataSource,
        private readonly mailbox: MailboxService,
        private readonly config: ConfigService,
    ) {}

    async onModuleInit(): Promise<void> {
        try {
            await this.ensureSchema();
            await this.seedPolicyFromEnv();
        } catch (err) {
            this.logger.warn(`Could not prepare mailbox policy: ${err}`);
        }

        this.timer = setInterval(
            () => {
                void this.maybeRunScheduled();
            },
            15 * 60 * 1000,
        );
        this.bootTimer = setTimeout(() => {
            void this.maybeRunScheduled();
        }, 120 * 1000);
        this.logger.log(
            'Mailbox archive scheduler armed (daily sweep of read mail to Backblaze).',
        );
    }

    onModuleDestroy(): void {
        if (this.timer) clearInterval(this.timer);
        if (this.bootTimer) clearTimeout(this.bootTimer);
    }

    private async ensureSchema(): Promise<void> {
        await this.dataSource.query(
            `CREATE TABLE IF NOT EXISTS mailbox_settings (
         setting_key VARCHAR(64) NOT NULL PRIMARY KEY,
         setting_value VARCHAR(255) NOT NULL,
         updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        );
    }

    /** First boot only: take the retention policy from the environment. */
    private async seedPolicyFromEnv(): Promise<void> {
        const [row] = await this.dataSource.query<MailboxSettingRow[]>(
            `SELECT setting_key FROM mailbox_settings WHERE setting_key = 'auto_retention_days'`,
        );
        if (row) return;

        const days =
            Number(this.config.get<string>('MAILBOX_ARCHIVE_AFTER_DAYS')) ||
            MailboxSchedulerService.DEFAULTS.retentionDays;
        const hourRaw = Number(this.config.get<string>('MAILBOX_ARCHIVE_HOUR'));
        const hour = Number.isFinite(hourRaw)
            ? hourRaw
            : MailboxSchedulerService.DEFAULTS.hour;
        const enabled =
            (this.config.get<string>('MAILBOX_AUTO_ARCHIVE') ?? '1') === '1';

        await this.putMany({
            auto_enabled: enabled ? '1' : '0',
            auto_retention_days: String(days),
            auto_hour: String(hour),
        });
        // Log the values actually stored, not the raw env strings — an unset
        // MAILBOX_ARCHIVE_HOUR printed as "NaN:00" and hid the fallback.
        this.logger.log(
            `Mailbox auto-archive seeded from env: enabled=${enabled}, ${days} days at ${hour}:00.`,
        );
    }

    private async putMany(pairs: Record<string, string>): Promise<void> {
        for (const [key, value] of Object.entries(pairs)) {
            await this.dataSource.query(
                `INSERT INTO mailbox_settings (setting_key, setting_value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
                [key, value],
            );
        }
    }

    private async readSettings(): Promise<Record<string, string>> {
        const rows = await this.dataSource.query<MailboxSettingRow[]>(
            `SELECT setting_key, setting_value FROM mailbox_settings`,
        );
        const map: Record<string, string> = {};
        for (const r of rows) map[r.setting_key] = r.setting_value;
        return map;
    }
    /** The live policy plus what happened on the last sweep. */
    async getPolicy() {
        const map = await this.readSettings();
        const hour = Number(map.auto_hour);
        const days = Number(map.auto_retention_days);

        const policy: NightlyPolicy = {
            enabled: (map.auto_enabled ?? '1') === '1',
            hour: Number.isFinite(hour)
                ? hour
                : MailboxSchedulerService.DEFAULTS.hour,
            retentionDays: Number.isFinite(days)
                ? days
                : MailboxSchedulerService.DEFAULTS.retentionDays,
        };

        const [lastAuto] = await this.dataSource.query<LastAutoArchiveRow[]>(
            `SELECT id, created_at, message_count, byte_size, b2_file_name
         FROM mailbox_archives WHERE reason = 'auto' ORDER BY created_at DESC LIMIT 1`,
        );
        const [totals] = await this.dataSource.query<AutoArchiveTotalsRow[]>(
            `SELECT COUNT(*) AS archives, COALESCE(SUM(message_count),0) AS messages,
              COALESCE(SUM(byte_size),0) AS bytes
         FROM mailbox_archives WHERE reason = 'auto'`,
        );
        const due = isNightlyRunDue(
            policy,
            map.auto_last_run_at || null,
            new Date(),
        );

        return {
            ...policy,
            dueNow: due.due,
            dueReason: due.reason,
            windowOpensAt: due.dueAt,
            lastRunAt: map.auto_last_run_at || null,
            lastRunOutcome: map.auto_last_run_note || null,
            lastAutoArchive: lastAuto
                ? {
                      id: lastAuto.id,
                      at: lastAuto.created_at,
                      messages: lastAuto.message_count,
                      bytes: lastAuto.byte_size,
                      file: lastAuto.b2_file_name,
                  }
                : null,
            autoTotals: {
                archives: Number(totals?.archives) || 0,
                messages: Number(totals?.messages) || 0,
                bytes: Number(totals?.bytes) || 0,
            },
        };
    }

    async setPolicy(dto: {
        enabled?: boolean;
        retentionDays?: number;
        hour?: number;
    }) {
        const pairs: Record<string, string> = {};
        if (dto.enabled !== undefined)
            pairs.auto_enabled = dto.enabled ? '1' : '0';
        if (dto.retentionDays !== undefined) {
            // A floor of 14 days: anything shorter would start moving mail a person
            // has realistically not read a second time yet.
            pairs.auto_retention_days = String(
                Math.min(
                    3650,
                    Math.max(14, Math.trunc(Number(dto.retentionDays) || 0)),
                ),
            );
        }
        if (dto.hour !== undefined) {
            pairs.auto_hour = String(
                Math.min(23, Math.max(0, Math.trunc(Number(dto.hour) || 0))),
            );
        }
        if (Object.keys(pairs).length) await this.putMany(pairs);
        return this.getPolicy();
    }

    /**
     * Run the sweep if today's window is open and it has not run yet. Safe to call
     * as often as you like — the recorded last run is the guard, so a restart
     * mid-day cannot double-archive.
     */
    async maybeRunScheduled(): Promise<{
        ran: boolean;
        reason?: string;
        archived?: number;
    }> {
        try {
            const policy = await this.getPolicy();
            const decision = isNightlyRunDue(
                {
                    enabled: policy.enabled,
                    hour: policy.hour,
                    retentionDays: policy.retentionDays,
                },
                policy.lastRunAt,
                new Date(),
            );
            if (!decision.due) return { ran: false, reason: decision.reason };

            const result = await this.runSweep('scheduled');
            return { ran: true, archived: result.archived };
        } catch (err) {
            this.logger.error(
                `Scheduled mailbox archive failed: ${err instanceof Error ? err.message : String(err)}`,
            );
            return { ran: false, reason: 'error' };
        }
    }

    /** Admin-triggered immediate sweep, ignoring the window. */
    async runNow(actor = 'admin') {
        return this.runSweep('manual', actor);
    }

    private async runSweep(trigger: 'scheduled' | 'manual', actor = 'system') {
        if (this.running)
            return {
                archived: 0,
                bytes: 0,
                message: 'A sweep is already running.',
            };

        this.running = true;
        const started = Date.now();
        try {
            const policy = await this.getPolicy();
            const outcome = await this.mailbox.archive(
                {
                    olderThanDays: policy.retentionDays,
                    reason: trigger === 'scheduled' ? 'auto' : 'manual-auto',
                },
                actor,
            );

            const archived =
                'archived' in outcome ? Number(outcome.archived) || 0 : 0;
            const bytes = 'bytes' in outcome ? Number(outcome.bytes) || 0 : 0;
            // Only a completed sweep carries a file name; the dry-run and
            // "nothing to do" shapes do not, and only reach here with archived = 0.
            const file = 'file' in outcome ? outcome.file : undefined;
            const note = archived
                ? `${archived} message${archived === 1 ? '' : 's'} (${bytes} bytes) to ${file ?? 'B2'}`
                : 'nothing was old enough';
            await this.putMany({
                auto_last_run_at: new Date().toISOString(),
                auto_last_run_note: `${trigger} sweep in ${Date.now() - started}ms: ${note}`,
            });
            this.logger.log(`Mailbox ${trigger} sweep: ${note}`);
            return { archived, bytes, file, message: note };
        } catch (err) {
            // Record the failure so the UI can explain why nothing moved, then rethrow
            // for the admin-triggered caller.
            await this.putMany({
                auto_last_run_at: new Date().toISOString(),
                auto_last_run_note: `${trigger} sweep failed: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            });
            throw err;
        } finally {
            this.running = false;
        }
    }
}
