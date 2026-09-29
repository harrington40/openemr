/**
 * Mail triage — pure, database-free logic for the internal mailbox.
 *
 * The internal `pnotes` inbox is a flat, chronological list: everything ever
 * sent stays at the same weight forever, so after a few weeks the top of the
 * list is noise and the two things that actually need a human are buried. These
 * helpers give each message a triage score and collapse conversations into
 * threads so the inbox stays shallow and urgent mail floats to the top.
 */

export type MailPriority = 'critical' | 'high' | 'normal' | 'low';

export type MailCategory =
    | 'lab'
    | 'pharmacy'
    | 'billing'
    | 'clinical'
    | 'scheduling'
    | 'system'
    | 'admin';

export interface TriageInput {
    id: number;
    title?: string | null;
    body?: string | null;
    user?: string | null;
    pid?: number | null;
    message_status?: string | null;
    date?: string | Date | null;
}

export interface TriageResult {
    score: number;
    priority: MailPriority;
    category: MailCategory;
    ageHours: number;
    /** Plain-English reasons, shown in the UI so the ordering is never a mystery. */
    why: string[];
}

/**
 * Explicit urgency markers. Word-boundary matched so "high" does not fire
 * inside "highlight" and "stat" does not fire inside "status".
 */
const CRITICAL_MARKERS =
    /\b(stat|emergency|code blue|critical|immediately|asap|life.?threatening|overdose|anaphyla)\b/i;
const HIGH_MARKERS =
    /\b(urgent|high priority|escalat|abnormal|failed|reject|refus|overdue|breach|recall|warning|alert)\b/i;

/**
 * Category keywords. Stems that take inflections are written out (`allerg\w*`,
 * `reschedul\w*`) because a trailing `\b` after `reschedul` would never match
 * "reschedule" — the boundary is between two word characters.
 */
const CATEGORY_RULES: Array<{ category: MailCategory; re: RegExp }> = [
    {
        category: 'lab',
        re: /\b(labs?|results?|cultures?|specimens?|patholog\w*|hemoglobin|a1c|glucose|creatinine|inr|panels?)\b/i,
    },
    {
        category: 'pharmacy',
        re: /\b(pharmac\w*|refills?|dispens\w*|prescriptions?|medications?|drugs?|dosages?|apothec\w*)\b/i,
    },
    {
        category: 'billing',
        re: /\b(bill\w*|invoices?|claims?|copay|payments?|charges?|insur\w*|denials?|reimburse\w*|cpt|icd)\b/i,
    },
    {
        category: 'scheduling',
        re: /\b(appointments?|schedul\w*|reschedul\w*|calendar|bookings?|no.?shows?|slots?|reminders?)\b/i,
    },
    {
        category: 'system',
        re: /\b(systems?|automated|backups?|sync\w*|uptime|servers?|migrations?|cron|integrations?)\b/i,
    },
    {
        category: 'clinical',
        re: /\b(patients?|vitals?|diagnos\w*|allerg\w*|notes?|symptoms?|exams?|treatments?|care plans?|referrals?)\b/i,
    },
];

/** Senders that are the platform talking to itself rather than a colleague. */
const SYSTEM_SENDER =
    /\b(system|automated|noreply|no-reply|daemon|bot|cron|monitor)\b/i;

/**
 * Threading ignores reply/forward prefixes and bracketed ticket tags so
 * "Re: Fwd: [LAB-4471] Glucose result" groups with "Glucose result".
 */
export function normaliseSubject(title?: string | null): string {
    const raw = (title || '').trim();
    if (!raw) return '(no subject)';
    const cleaned = raw
        .replace(/^(\s*(re|fwd|fw|aw|sv)\s*(\[\d+\])?\s*:\s*)+/gi, '')
        .replace(/\[[^\]]*\]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()
        .slice(0, 160);
    return cleaned || '(no subject)';
}

/** A thread is one conversation: same subject, same patient (pid 0 = broadcast). */
export function threadKey(msg: TriageInput): string {
    return `${msg.pid || 0}|${normaliseSubject(msg.title)}`;
}

export function categorise(text: string): MailCategory {
    for (const rule of CATEGORY_RULES) {
        if (rule.re.test(text)) return rule.category;
    }
    return 'admin';
}

function ageHoursOf(date: string | Date | null | undefined, now: Date): number {
    if (!date) return 0;
    const t = date instanceof Date ? date.getTime() : new Date(date).getTime();
    if (Number.isNaN(t)) return 0;
    return Math.max(0, (now.getTime() - t) / 3_600_000);
}

export function priorityBand(score: number): MailPriority {
    if (score >= 80) return 'critical';
    if (score >= 58) return 'high';
    if (score >= 32) return 'normal';
    return 'low';
}

/**
 * Score one message 0..100.
 *
 * Everyone starts "normal" (30) and earns/loses points from there. The two
 * deliberate inversions are that **unread mail gets more urgent as it ages** (an
 * unread lab result from three days ago is a liability, not old news) and that
 * **long threads decay** (a 12-message back-and-forth is a conversation in
 * progress, not twelve pieces of new work).
 */
export function scoreMail(
    msg: TriageInput,
    now: Date = new Date(),
    threadDepth = 1,
): TriageResult {
    const text = `${msg.title || ''}\n${msg.body || ''}`;
    const why: string[] = [];

    let score = 30;
    const unread = (msg.message_status || 'New') === 'New';
    const ageHours = ageHoursOf(msg.date, now);

    if (CRITICAL_MARKERS.test(text)) {
        score += 34;
        why.push('flagged urgent in the body');
    } else if (HIGH_MARKERS.test(text)) {
        score += 14;
        why.push('mentions something needing action');
    }

    if (msg.pid && Number(msg.pid) > 0) {
        score += 16;
        why.push('about a specific patient');
    }

    if (unread) {
        score += 10;
        why.push('unread');
        if (ageHours >= 72) {
            score += 16;
            why.push(`unread for ${Math.floor(ageHours / 24)} days`);
        } else if (ageHours >= 24) {
            score += 9;
            why.push('unread for over a day');
        }
    } else if (ageHours >= 24 * 30) {
        // Long-read mail is genuinely dealt with; let it sink toward the archive.
        score -= 12;
        why.push('read and over a month old');
    }

    if (SYSTEM_SENDER.test(msg.user || '')) {
        score -= 8;
        why.push('sent by the system');
    } else if (msg.user) {
        score += 8;
        why.push(`from ${msg.user}`);
    }

    if (threadDepth > 1) {
        score -= Math.min(15, (threadDepth - 1) * 2);
        why.push(`${threadDepth} messages in this thread`);
    }

    score = Math.max(0, Math.min(100, Math.round(score)));

    return {
        score,
        priority: priorityBand(score),
        category: categorise(text),
        ageHours: Math.round(ageHours),
        why,
    };
}

export interface MailThread<T extends TriageInput = TriageInput> {
    key: string;
    subject: string;
    pid: number;
    messageCount: number;
    unreadCount: number;
    score: number;
    priority: MailPriority;
    category: MailCategory;
    latestAt: string;
    oldestAt: string;
    latestUser: string;
    preview: string;
    messages: Array<T & { triage: TriageResult }>;
}

/**
 * Collapse messages into threads, most urgent conversation first, each thread
 * scored by its most urgent member — so one STAT inside a long thread still
 * surfaces at the top.
 */
export function groupThreads<T extends TriageInput>(
    messages: T[],
    now: Date = new Date(),
): MailThread<T>[] {
    const buckets = new Map<string, T[]>();
    for (const m of messages) {
        const key = threadKey(m);
        const list = buckets.get(key);
        if (list) list.push(m);
        else buckets.set(key, [m]);
    }

    const threads: MailThread<T>[] = [];
    for (const [key, list] of buckets) {
        const sorted = [...list].sort(
            (a, b) => +new Date(b.date || 0) - +new Date(a.date || 0),
        );
        const withTriage = sorted.map((m) => ({
            ...m,
            triage: scoreMail(m, now, sorted.length),
        }));
        const best = withTriage.reduce(
            (acc, m) => (m.triage.score > acc.triage.score ? m : acc),
            withTriage[0],
        );
        const unreadCount = sorted.filter(
            (m) => (m.message_status || 'New') === 'New',
        ).length;

        threads.push({
            key,
            subject: (sorted[0].title || '(no subject)').trim(),
            pid: Number(sorted[0].pid) || 0,
            messageCount: sorted.length,
            unreadCount,
            score: best.triage.score,
            priority: best.triage.priority,
            category: best.triage.category,
            latestAt: new Date(sorted[0].date || 0).toISOString(),
            oldestAt: new Date(
                sorted[sorted.length - 1].date || 0,
            ).toISOString(),
            latestUser: sorted[0].user || '',
            preview: (sorted[0].body || '').replace(/\s+/g, ' ').slice(0, 160),
            messages: withTriage,
        });
    }

    // Unread threads outrank an equally-scored thread that is already dealt with.
    return threads.sort(
        (a, b) =>
            b.score - a.score ||
            +(b.unreadCount > 0) - +(a.unreadCount > 0) ||
            +new Date(b.latestAt) - +new Date(a.latestAt),
    );
}

export interface ArchiveRule {
    olderThanDays: number;
    /** Threads longer than this collapse into the archive even if slightly newer. */
    collapseThreadsOver?: number;
}

export interface ArchiveCandidateInput extends TriageInput {
    _threadDepth?: number;
}

/**
 * Which mail is safe to move to cold storage.
 *
 * Deliberately conservative: **unread mail is never archived**, however old,
 * because "unseen" means a human still owes it a look. Read mail is fair game
 * once it is past the cut-off.
 */
export function isArchiveCandidate(
    msg: ArchiveCandidateInput,
    rule: ArchiveRule,
    now: Date = new Date(),
): boolean {
    if ((msg.message_status || 'New') === 'New') return false;
    if (ageHoursOf(msg.date, now) >= rule.olderThanDays * 24) return true;
    if (
        rule.collapseThreadsOver &&
        msg._threadDepth &&
        msg._threadDepth > rule.collapseThreadsOver
    )
        return true;
    return false;
}
