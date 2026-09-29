import {
    categorise,
    groupThreads,
    isArchiveCandidate,
    normaliseSubject,
    scoreMail,
    threadKey,
} from './mail-triage.util';

/**
 * Tests for the smart-mailbox triage algorithm.
 *
 * The behaviour worth protecting is the two deliberate inversions: ageing
 * *unread* mail gets more urgent, and long threads decay. Those are the bits a
 * well-meaning future refactor is most likely to "fix" back to a plain
 * newest-first sort.
 */
const NOW = new Date('2026-09-27T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

const base = {
    id: 1,
    title: 'Lab result available',
    body: 'The panel for bed 4 is ready.',
    user: 'drhouse',
    pid: 42,
    message_status: 'New',
    date: hoursAgo(1),
};

describe('subject normalisation and threading', () => {
    it('strips reply and forward prefixes', () => {
        expect(normaliseSubject('Re: Fwd: RE: Glucose result')).toBe(
            'glucose result',
        );
    });

    it('strips bracketed ticket tags', () => {
        expect(normaliseSubject('[LAB-4471] Glucose result')).toBe(
            'glucose result',
        );
    });

    it('falls back to a placeholder for an empty subject', () => {
        expect(normaliseSubject('   ')).toBe('(no subject)');
    });

    it('groups a reply with its original by subject and patient', () => {
        expect(threadKey({ id: 1, title: 'Glucose result', pid: 42 })).toBe(
            threadKey({ id: 2, title: 'RE: [LAB-9] Glucose result', pid: 42 }),
        );
    });

    it('keeps the same subject for different patients apart', () => {
        expect(threadKey({ id: 1, title: 'Renewal', pid: 42 })).not.toBe(
            threadKey({ id: 2, title: 'Renewal', pid: 43 }),
        );
    });
});

describe('categorisation', () => {
    it.each([
        ['Creatinine panel back', 'lab'],
        ['Pharmacy needs a refill authorisation', 'pharmacy'],
        ['Claim denied by insurance', 'billing'],

        ['Patient wants to reschedule', 'scheduling'],
        ['Nightly backup completed', 'system'],
        ['Something nobody classified', 'admin'],
    ])('classifies %j as %s', (text, expected) => {
        expect(categorise(text)).toBe(expected);
    });
});

describe('scoring', () => {
    it('puts a STAT message in the critical band', () => {
        const r = scoreMail({ ...base, title: 'STAT: potassium 6.9' }, NOW);
        expect(r.priority).toBe('critical');
        expect(r.score).toBeGreaterThanOrEqual(80);
        expect(r.why).toContain('flagged urgent in the body');
    });

    it('does not treat a word containing "stat" as urgent', () => {
        const r = scoreMail(
            { ...base, title: 'Status update', body: 'All good.' },
            NOW,
        );
        expect(r.priority).not.toBe('critical');
    });

    it('escalates unread mail as it ages', () => {
        const fresh = scoreMail({ ...base, date: hoursAgo(1) }, NOW);
        const dayOld = scoreMail({ ...base, date: hoursAgo(30) }, NOW);
        const weekOld = scoreMail({ ...base, date: hoursAgo(24 * 7) }, NOW);
        expect(fresh.score).toBeLessThan(dayOld.score);
        expect(dayOld.score).toBeLessThan(weekOld.score);
        expect(weekOld.why.join(' ')).toContain('unread for 7 days');
    });

    it('does not escalate read mail with age', () => {
        const r = scoreMail(
            { ...base, message_status: 'Read', date: hoursAgo(24 * 7) },
            NOW,
        );
        expect(r.why.join(' ')).not.toContain('unread for');
        expect(r.score).toBeLessThan(
            scoreMail({ ...base, date: hoursAgo(1) }, NOW).score,
        );
    });

    it('damps a long conversation instead of counting every message as new work', () => {
        const single = scoreMail(base, NOW, 1);
        const deep = scoreMail(base, NOW, 9);
        expect(deep.score).toBeLessThan(single.score);
        expect(deep.why).toContain('9 messages in this thread');
    });

    it('trusts a colleague over the system account', () => {
        const human = scoreMail({ ...base, user: 'drhouse' }, NOW);
        const robot = scoreMail({ ...base, user: 'system' }, NOW);
        expect(human.score).toBeGreaterThan(robot.score);
        expect(robot.why).toContain('sent by the system');
    });

    it('ranks a patient-linked message above a broadcast of the same age', () => {
        expect(scoreMail({ ...base, pid: 42 }, NOW).score).toBeGreaterThan(
            scoreMail({ ...base, pid: 0 }, NOW).score,
        );
    });

    it('keeps every score inside 0..100', () => {
        const noisy = scoreMail(
            {
                ...base,
                title: 'STAT EMERGENCY critical',
                body: 'anaphylaxis',
                date: hoursAgo(24 * 30),
            },
            NOW,
        );
        const quiet = scoreMail(
            {
                id: 2,
                title: 'fyi',
                body: '',
                user: 'system',
                pid: 0,
                message_status: 'Read',
                date: hoursAgo(24 * 90),
            },
            NOW,
            20,
        );
        expect(noisy.score).toBeLessThanOrEqual(100);
        expect(quiet.score).toBeGreaterThanOrEqual(0);
    });
});

describe('thread grouping', () => {
    const messages = [
        {
            id: 1,
            title: 'Glucose result',
            body: 'first',
            user: 'labtech',
            pid: 42,
            message_status: 'Read',
            date: hoursAgo(50),
        },
        {
            id: 2,
            title: 'Re: Glucose result',
            body: 'second',
            user: 'drhouse',
            pid: 42,
            message_status: 'New',
            date: hoursAgo(2),
        },
        {
            id: 3,
            title: 'STAT potassium 6.9',
            body: 'call now',
            user: 'labtech',
            pid: 7,
            message_status: 'New',
            date: hoursAgo(3),
        },
    ];

    it('collapses a conversation into one thread with a message count', () => {
        const threads = groupThreads(messages, NOW);
        // The label follows the newest message, mail-client style, but the reply
        // still lands in the same thread because the key ignores "Re:".
        const glucose = threads.find((t) => t.key === threadKey(messages[1]));
        expect(glucose?.subject).toBe('Re: Glucose result');
        expect(glucose?.messageCount).toBe(2);
        expect(glucose?.unreadCount).toBe(1);
        expect(glucose?.messages).toHaveLength(2);
    });

    it('sorts the urgent conversation first', () => {
        expect(groupThreads(messages, NOW)[0].subject).toContain('potassium');
    });

    it('carries a per-message triage result', () => {
        const glucose = groupThreads(messages, NOW).find(
            (t) => t.key === threadKey(messages[1]),
        );
        expect(glucose?.messages[0].triage.score).toBeGreaterThan(0);
        expect(glucose?.messages[0].triage.category).toBe('lab');
    });

    it('scores a thread by its most urgent message', () => {
        const glucose = groupThreads(messages, NOW).find(
            (t) => t.key === threadKey(messages[1]),
        )!;
        expect(glucose.score).toBe(
            Math.max(...glucose.messages.map((m) => m.triage.score)),
        );
    });
});

describe('archive eligibility', () => {
    const rule = { olderThanDays: 30 };

    it('never archives unread mail, however old', () => {
        expect(
            isArchiveCandidate(
                { ...base, message_status: 'New', date: hoursAgo(24 * 400) },
                { olderThanDays: 1 },
                NOW,
            ),
        ).toBe(false);
    });

    it('archives read mail past the cut-off', () => {
        expect(
            isArchiveCandidate(
                { ...base, message_status: 'Read', date: hoursAgo(24 * 31) },
                rule,
                NOW,
            ),
        ).toBe(true);
    });

    it('keeps recent read mail in the inbox', () => {
        expect(
            isArchiveCandidate(
                { ...base, message_status: 'Read', date: hoursAgo(24 * 3) },
                rule,
                NOW,
            ),
        ).toBe(false);
    });

    it('honours the collapse-threads rule', () => {
        const opts = { olderThanDays: 365, collapseThreadsOver: 5 };
        expect(
            isArchiveCandidate(
                {
                    ...base,
                    message_status: 'Read',
                    date: hoursAgo(1),
                    _threadDepth: 9,
                },
                opts,
                NOW,
            ),
        ).toBe(true);
        expect(
            isArchiveCandidate(
                {
                    ...base,
                    message_status: 'Read',
                    date: hoursAgo(1),
                    _threadDepth: 3,
                },
                opts,
                NOW,
            ),
        ).toBe(false);
    });
});
