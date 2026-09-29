import {
    Injectable,
    Logger,
    NotFoundException,
    OnModuleInit,
    BadRequestException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { BucketConfig } from '../storage/b2-storage.service';
import { B2StorageService } from '../storage';
import {
    ArchiveRule,
    groupThreads,
    isArchiveCandidate,
    threadKey,
    TriageInput,
} from './mail-triage.util';

const HOT_LIMIT = 500;

export interface RawMail extends TriageInput {
    patientId?: number | null;
    patientPid?: number | null;
    patientName?: string | null;
    assigned_to?: string | null;
    groupname?: string | null;
    archivedAt?: string | null;
}

export interface InboxQuery {
    folder?: 'inbox' | 'archived' | 'all';
    priority?: string;
    category?: string;
    q?: string;
    limit?: number;
    offset?: number;
    unreadOnly?: boolean;
}

/** `mailbox_archive_items` row. */
interface ArchivedMessageIdRow {
    message_id: number;
}

/** Aggregated archive totals. */
interface ArchiveTotalsRow {
    archives: number | string;
    messages: number | string;
    bytes: number | string;
    last_at: string | Date | null;
}

/** `mailbox_archives` row. */
interface MailboxArchiveRow {
    id: number;
    from_date: string | Date | null;
    to_date: string | Date | null;
    message_count: number;
    byte_size: number;
    b2_file_name: string;
    b2_file_id: string;
    reason: string | null;
    created_by: string | null;
    created_at: string | Date;
    restored_at: string | Date | null;
    restored_by: string | null;
}

/** `mailbox_archives` row with its linked-message count. */
export interface MailboxArchiveListRow extends MailboxArchiveRow {
    linked_messages: number | string;
}

/** Affected-rows result of an INSERT / UPDATE / DELETE. */
interface AffectedRowsResult {
    affectedRows: number;
    insertId: number;
}

/** Archive options accepted from the UI. */
export interface ArchiveOptionsDto {
    olderThanDays?: number;
    collapseThreadsOver?: number;
    reason?: string;
    dryRun?: boolean;
}

@Injectable()
export class MailboxService implements OnModuleInit {
    private readonly logger = new Logger(MailboxService.name);

    constructor(
        @InjectDataSource() private readonly dataSource: DataSource,
        private readonly b2: B2StorageService,
        private readonly config: ConfigService,
        private readonly http: HttpService,
    ) {}

    async onModuleInit(): Promise<void> {
        // Which messages have been shipped to cold storage is tracked in side tables
        // rather than in `pnotes`, so the core clinical table keeps its own shape and
        // an archive stays reversible by simply dropping rows here.
        try {
            await this.dataSource.query(
                `CREATE TABLE IF NOT EXISTS mailbox_archives (
           id INT AUTO_INCREMENT PRIMARY KEY,
           from_date DATETIME NULL,
           to_date DATETIME NULL,
           message_count INT NOT NULL DEFAULT 0,
           byte_size INT NOT NULL DEFAULT 0,
           b2_file_name VARCHAR(512) NOT NULL,
           b2_file_id VARCHAR(128) NOT NULL DEFAULT '',
           reason VARCHAR(64) NOT NULL DEFAULT 'age',
           created_by VARCHAR(64) NOT NULL DEFAULT '',
           created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
           restored_at DATETIME NULL,
           restored_by VARCHAR(64) NULL
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
            );
            await this.dataSource.query(
                `CREATE TABLE IF NOT EXISTS mailbox_archive_items (
           archive_id INT NOT NULL,
           message_id INT NOT NULL,
           PRIMARY KEY (archive_id, message_id),
           KEY idx_mailbox_item_message (message_id)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
            );
        } catch (err) {
            this.logger.warn(`Could not ensure mailbox tables: ${err}`);
        }
    }

    /** Archive bucket, falling back to the documents bucket when none is set. */
    private bucket(): BucketConfig {
        const mailId = this.config.get<string>('B2_BUCKET_MAIL_ID');
        if (mailId) {
            return {
                bucketId: mailId,
                bucketName:
                    this.config.get<string>('B2_BUCKET_MAIL_NAME') || '',
            };
        }
        return {
            bucketId: this.config.get<string>('B2_BUCKET_DOCUMENTS_ID') || '',
            bucketName:
                this.config.get<string>('B2_BUCKET_DOCUMENTS_NAME') || '',
        };
    }

    private async archivedIds(): Promise<Set<number>> {
        const rows = await this.dataSource.query<ArchivedMessageIdRow[]>(
            `SELECT DISTINCT message_id FROM mailbox_archive_items`,
        );
        return new Set<number>(rows.map((r) => Number(r.message_id)));
    }

    /** The whole visible mailbox, newest first. The cap keeps the triage pass bounded. */
    private async fetchMail(limit = HOT_LIMIT): Promise<RawMail[]> {
        // Joining patient_data lets the UI open the chart with the canonical id
        // (patient_data.id = pid + 1 on this schema).
        return this.dataSource.query<RawMail[]>(
            `SELECT p.id, p.date, p.title, p.body, p.pid, p.user, p.groupname,
              p.message_status, p.assigned_to,
              pd.id  AS patientId,
              pd.pid AS patientPid,
              CONCAT(COALESCE(pd.fname,''), ' ', COALESCE(pd.lname,'')) AS patientName
       FROM pnotes p
       LEFT JOIN patient_data pd ON pd.pid = p.pid
       WHERE p.deleted = 0 AND p.groupname IN ('events', 'Default')
       ORDER BY p.date DESC
       LIMIT ?`,
            [limit],
        );
    }

    /**
     * The triaged inbox: messages collapsed into conversations, ranked by urgency
     * rather than by arrival, with paging applied to threads (not raw rows) so one
     * chatty thread cannot fill the first page.
     */
    async getInbox(query: InboxQuery = {}) {
        const folder = query.folder || 'inbox';
        const archivedIds = await this.archivedIds();
        const all = await this.fetchMail();
        const isArchived = (m: RawMail) => archivedIds.has(Number(m.id));

        let rows = all;
        if (folder === 'inbox') rows = all.filter((m) => !isArchived(m));
        else if (folder === 'archived') rows = all.filter(isArchived);

        let threads = groupThreads(rows);

        if (query.unreadOnly)
            threads = threads.filter((t) => t.unreadCount > 0);
        if (query.priority) {
            const want = query.priority
                .split(',')
                .map((p) => p.trim().toLowerCase());
            threads = threads.filter((t) => want.includes(t.priority));
        }
        if (query.category) {
            const want = query.category
                .split(',')
                .map((c) => c.trim().toLowerCase());
            threads = threads.filter((t) => want.includes(t.category));
        }
        const q = (query.q || '').trim().toLowerCase();
        if (q) {
            threads = threads.filter((t) =>
                `${t.subject} ${t.preview} ${t.latestUser} ${t.messages.map((m) => m.body || '').join(' ')}`
                    .toLowerCase()
                    .includes(q),
            );
        }

        const total = threads.length;
        const limit = Math.min(Math.max(Number(query.limit) || 25, 1), 200);
        const offset = Math.max(Number(query.offset) || 0, 0);
        const page = threads.slice(offset, offset + limit).map((t) => ({
            ...t,
            archived: t.messages.every((m) => isArchived(m as RawMail)),
        }));

        return {
            folder,
            total,
            limit,
            offset,
            hasMore: offset + page.length < total,
            threads: page,
            stats: await this.buildStats(all, archivedIds),
        };
    }

    private async buildStats(all: RawMail[], archivedIds: Set<number>) {
        const hot = all.filter((m) => !archivedIds.has(Number(m.id)));
        const threads = groupThreads(hot);
        const now = Date.now();
        const unread = hot.filter((m) => (m.message_status || 'New') === 'New');
        const byPriority: Record<string, number> = {
            critical: 0,
            high: 0,
            normal: 0,
            low: 0,
        };
        const byCategory: Record<string, number> = {};
        for (const t of threads) {
            byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
            byCategory[t.category] = (byCategory[t.category] || 0) + 1;
        }

        const [archiveAgg] = await this.dataSource.query<ArchiveTotalsRow[]>(
            `SELECT COUNT(*) AS archives, COALESCE(SUM(message_count),0) AS messages,
              COALESCE(SUM(byte_size),0) AS bytes, MAX(created_at) AS last_at
       FROM mailbox_archives`,
        );

        const oldestUnread = unread.length
            ? unread.reduce(
                  (acc, m) => Math.min(acc, +new Date(m.date || 0)),
                  now,
              )
            : null;

        return {
            hotMessages: hot.length,
            hotThreads: threads.length,
            unread: unread.length,
            unreadThreads: threads.filter((t) => t.unreadCount > 0).length,
            urgentThreads: threads.filter(
                (t) => t.priority === 'critical' || t.priority === 'high',
            ).length,
            oldestUnreadAt: oldestUnread
                ? new Date(oldestUnread).toISOString()
                : null,
            oldestUnreadDays: oldestUnread
                ? Math.floor((now - oldestUnread) / 86_400_000)
                : 0,
            depthScore: this.depthScore(threads.length, unread.length),
            byPriority,
            byCategory,
            archived: {
                archives: Number(archiveAgg?.archives) || 0,
                messages: Number(archiveAgg?.messages) || 0,
                bytes: Number(archiveAgg?.bytes) || 0,
                lastArchivedAt: archiveAgg?.last_at
                    ? new Date(archiveAgg.last_at).toISOString()
                    : null,
            },
        };
    }

    /**
     * How buried the inbox is, 0..100 (100 = pristine). Derived from how many
     * conversations a person has to scan and how much of it is unread, so the UI
     * can show one honest number instead of a raw message count.
     */
    private depthScore(threads: number, unread: number): number {
        const clutter = Math.min(55, threads * 1.5);
        const backlog = Math.min(45, unread * 1.5);
        return Math.max(0, Math.round(100 - clutter - backlog));
    }

    async getStats() {
        const archivedIds = await this.archivedIds();
        const all = await this.fetchMail();
        return this.buildStats(all, archivedIds);
    }

    // ── Archiving to cold storage ───────────────────────────────

    private rule(dto: {
        olderThanDays?: number;
        collapseThreadsOver?: number;
    }): ArchiveRule {
        const days = Number(dto?.olderThanDays);
        return {
            olderThanDays: Number.isFinite(days) && days >= 1 ? days : 30,
            collapseThreadsOver: Number(dto?.collapseThreadsOver) || undefined,
        };
    }

    /**
     * Read mail that is old enough to move off the hot list. Unread mail is never
     * a candidate — an unopened message still belongs to somebody.
     */
    private async candidates(rule: ArchiveRule): Promise<RawMail[]> {
        const archivedIds = await this.archivedIds();
        const all = await this.fetchMail(2000);
        const depths = new Map<string, number>();
        for (const t of groupThreads(all)) depths.set(t.key, t.messageCount);

        return all.filter(
            (m) =>
                !archivedIds.has(Number(m.id)) &&
                isArchiveCandidate(
                    {
                        ...m,
                        _threadDepth: depths.get(threadKey(m as TriageInput)),
                    },
                    rule,
                ),
        );
    }

    /** Dry-run summary so the UI can promise exactly what will happen offline. */
    async previewArchive(dto: ArchiveOptionsDto) {
        const rule = this.rule(dto);
        const rows = await this.candidates(rule);
        const all = await this.fetchMail();
        const bytes = rows.reduce(
            (acc, m) =>
                acc +
                Buffer.byteLength(`${m.title || ''}${m.body || ''}`, 'utf8'),
            0,
        );
        const oldestDays = rows.length
            ? Math.floor(
                  (Date.now() -
                      Math.min(
                          ...rows.map((m) => +new Date(m.date || Date.now())),
                      )) /
                      86_400_000,
              )
            : 0;
        return {
            olderThanDays: rule.olderThanDays,
            count: rows.length,
            bytes,
            oldestDays,
            // Showing what was deliberately left behind is what makes the rule trustworthy.
            unreadSkipped: all.filter(
                (m) =>
                    (m.message_status || 'New') === 'New' &&
                    +new Date(m.date || Date.now()) <
                        Date.now() - rule.olderThanDays * 86_400_000,
            ).length,
            sample: rows.slice(0, 5).map((m) => ({
                id: m.id,
                title: m.title,
                date: m.date,
                user: m.user,
            })),
        };
    }

    /**
     * Ship old mail to Backblaze B2 as NDJSON, then mark it archived so it leaves
     * the working inbox. Nothing is deleted — the rows stay in `pnotes` and can be
     * restored, so this is a move to cold storage, not a purge.
     */
    async archive(dto: ArchiveOptionsDto, user = 'system') {
        const rule = this.rule(dto);
        if (dto?.dryRun)
            return { dryRun: true, ...(await this.previewArchive(dto)) };

        const rows = await this.candidates(rule);
        if (!rows.length)
            return {
                archived: 0,
                bytes: 0,
                message: 'Nothing is old enough to archive yet.',
            };

        const ndjson = [rows.map((m) => JSON.stringify(m)).join('\n'), ''].join(
            '\n',
        );
        const buffer = Buffer.from(ndjson, 'utf8');

        const stamp = new Date().toISOString().slice(0, 10);
        const fileName = `mail-archive/${stamp}/mailbox-${Date.now()}.ndjson`;

        let fileId = '';
        try {
            const res = await this.b2.upload(
                this.bucket(),
                buffer,
                fileName,
                'application/x-ndjson',
            );
            fileId = res.fileId;
        } catch (err) {
            this.logger.error(`Mail archive upload failed: ${err}`);
            throw new BadRequestException(
                'Could not upload the archive to Backblaze — nothing was archived, your inbox is unchanged.',
            );
        }

        const dates = rows.map((m) => +new Date(m.date || Date.now()));
        const result = await this.dataSource.query<AffectedRowsResult>(
            `INSERT INTO mailbox_archives
         (from_date, to_date, message_count, byte_size, b2_file_name, b2_file_id, reason, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                new Date(Math.min(...dates)),
                new Date(Math.max(...dates)),
                rows.length,
                buffer.length,
                fileName,
                fileId,
                dto?.reason || 'age',
                user,
            ],
        );
        const archiveId = result.insertId;

        await this.dataSource.query(
            `INSERT IGNORE INTO mailbox_archive_items (archive_id, message_id) VALUES ?`,
            [rows.map((m) => [archiveId, m.id])],
        );

        this.logger.log(
            `Archived ${rows.length} messages to B2 ${fileName} (archive ${archiveId})`,
        );
        return {
            archived: rows.length,
            bytes: buffer.length,
            archiveId,
            file: fileName,
            fileId,
            from: new Date(Math.min(...dates)),
            to: new Date(Math.max(...dates)),
        };
    }

    async listArchives(): Promise<MailboxArchiveListRow[]> {
        return this.dataSource.query<MailboxArchiveListRow[]>(
            `SELECT a.*, (SELECT COUNT(*) FROM mailbox_archive_items i WHERE i.archive_id = a.id) AS linked_messages
       FROM mailbox_archives a
       ORDER BY a.created_at DESC`,
        );
    }

    /** Time-limited B2 link so an archive can be pulled down by hand. */
    async archiveDownloadUrl(id: number) {
        const [archive] = await this.dataSource.query<MailboxArchiveRow[]>(
            `SELECT * FROM mailbox_archives WHERE id = ?`,
            [id],
        );
        if (!archive) throw new NotFoundException(`Archive ${id} not found`);
        return {
            id,
            file: archive.b2_file_name,
            url: await this.b2.getDownloadUrl(
                this.bucket(),
                archive.b2_file_name,
                900,
            ),
            expiresInSeconds: 900,
        };
    }

    /**
     * Pull an archive back out of B2 and return its messages to the mailbox. The
     * archive record is kept (marked restored) as a record of what happened.
     */
    async restore(id: number, user = 'system') {
        const [archive] = await this.dataSource.query<MailboxArchiveRow[]>(
            `SELECT * FROM mailbox_archives WHERE id = ?`,
            [id],
        );
        if (!archive) throw new NotFoundException(`Archive ${id} not found`);

        const url = await this.b2.getDownloadUrl(
            this.bucket(),
            archive.b2_file_name,
            600,
        );
        let body: string;
        try {
            // transformResponse bypasses axios' JSON parse — this payload is NDJSON.
            const res = await firstValueFrom(
                this.http.get<string>(url, {
                    responseType: 'text',
                    transformResponse: [(d: string): string => d],
                }),
            );
            body = String(res.data);
        } catch (err) {
            this.logger.error(`Mail archive download failed: ${err}`);
            throw new BadRequestException(
                'Could not download the archive from Backblaze.',
            );
        }

        const messages = body
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => {
                try {
                    return JSON.parse(line) as RawMail;
                } catch {
                    return null;
                }
            })
            .filter((m): m is RawMail => !!m && typeof m === 'object');

        if (!messages.length)
            throw new BadRequestException(
                'The archive file is empty or unreadable.',
            );

        for (const m of messages) {
            await this.dataSource.query(
                `INSERT INTO pnotes (date, title, body, pid, user, groupname, message_status, assigned_to)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    m.date ? new Date(m.date) : new Date(),
                    m.title || '',
                    m.body || '',
                    m.pid || 0,
                    m.user || 'restored',
                    m.groupname || 'Default',
                    m.message_status || 'Read',
                    m.assigned_to || '',
                ],
            );
        }

        await this.dataSource.query(
            `DELETE FROM mailbox_archive_items WHERE archive_id = ?`,
            [id],
        );
        await this.dataSource.query(
            `UPDATE mailbox_archives SET restored_at = NOW(), restored_by = ? WHERE id = ?`,
            [user, id],
        );

        this.logger.log(
            `Restored ${messages.length} messages from archive ${id}`,
        );
        return {
            restored: messages.length,
            archiveId: id,
            file: archive.b2_file_name,
        };
    }

    /** Permanent removal: the B2 object and the bookkeeping rows go away. */
    async deleteArchive(id: number) {
        const [archive] = await this.dataSource.query<MailboxArchiveRow[]>(
            `SELECT * FROM mailbox_archives WHERE id = ?`,
            [id],
        );
        if (!archive) throw new NotFoundException(`Archive ${id} not found`);
        try {
            await this.b2.deleteFile(archive.b2_file_id, archive.b2_file_name);
        } catch (err) {
            this.logger.warn(
                `Could not delete B2 object ${archive.b2_file_name}: ${err}`,
            );
        }
        await this.dataSource.query(
            `DELETE FROM mailbox_archive_items WHERE archive_id = ?`,
            [id],
        );
        await this.dataSource.query(
            `DELETE FROM mailbox_archives WHERE id = ?`,
            [id],
        );
        return { id, deleted: true };
    }

    /** Bulk triage: mark every message in a thread read in one call. */
    async markThreadRead(ids: number[]) {
        if (!ids?.length)
            throw new BadRequestException('No messages supplied.');
        await this.dataSource.query(
            `UPDATE pnotes SET message_status = 'Read' WHERE id IN (?)`,
            [ids],
        );
        return { updated: ids.length };
    }
}
