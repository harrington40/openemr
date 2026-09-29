import { isNightlyRunDue, NightlyPolicy } from './mail-schedule.util';

/**
 * Tests for the nightly archive decision.
 *
 * The failure modes worth pinning down are the ones that only show up in
 * production: running twice in a day after a restart, and never running because
 * the process happened to boot before the window opened.
 */
const at = (iso: string) => new Date(iso);
const policy = (over: Partial<NightlyPolicy> = {}): NightlyPolicy => ({
    enabled: true,
    hour: 3,
    retentionDays: 90,
    ...over,
});

describe('nightly archive scheduling', () => {
    it('runs after the window opens when it has not run today', () => {
        const d = isNightlyRunDue(
            policy(),
            '2026-09-26T03:00:05Z',
            at('2026-09-27T04:00:00'),
        );
        expect(d.due).toBe(true);
    });

    it('does not run before the window opens', () => {
        const d = isNightlyRunDue(
            policy(),
            '2026-09-26T03:00:05Z',
            at('2026-09-27T02:30:00'),
        );
        expect(d.due).toBe(false);
        expect(d.reason).toContain('window opens 03:00');
    });

    it('does not run twice in the same day (restart-safe)', () => {
        // Ran at 03:00 today; the 03:15 and 12:00 checks must both decline.
        expect(
            isNightlyRunDue(
                policy(),
                at('2026-09-27T03:00:05'),
                at('2026-09-27T03:15:00'),
            ).due,
        ).toBe(false);
        const second = isNightlyRunDue(
            policy(),
            at('2026-09-27T03:00:05'),
            at('2026-09-27T12:00:00'),
        );
        expect(second.due).toBe(false);
        expect(second.reason).toBe('already ran today');
    });

    it('runs again the next day', () => {
        expect(
            isNightlyRunDue(
                policy(),
                at('2026-09-27T03:00:05'),
                at('2026-09-28T03:00:00'),
            ).due,
        ).toBe(true);
    });

    it('runs when it has never run before', () => {
        expect(
            isNightlyRunDue(policy(), null, at('2026-09-27T09:00:00')).due,
        ).toBe(true);
    });

    it('stays quiet when switched off, however due it looks', () => {
        const d = isNightlyRunDue(
            policy({ enabled: false }),
            null,
            at('2026-09-27T09:00:00'),
        );
        expect(d.due).toBe(false);
        expect(d.reason).toContain('off');
    });

    it('clamps a nonsense hour instead of scheduling for never', () => {
        expect(
            isNightlyRunDue(
                policy({ hour: 99 }),
                null,
                at('2026-09-27T23:30:00'),
            ).due,
        ).toBe(true);
        expect(
            isNightlyRunDue(
                policy({ hour: -4 }),
                null,
                at('2026-09-27T00:30:00'),
            ).due,
        ).toBe(true);
    });

    it('treats an unparseable last-run value as never run', () => {
        expect(
            isNightlyRunDue(policy(), 'not-a-date', at('2026-09-27T05:00:00'))
                .due,
        ).toBe(true);
    });

    it('handles a boot before midnight and a check after it', () => {
        // Ran yesterday at 03:00; at 23:00 the next day it is due again.
        expect(
            isNightlyRunDue(
                policy(),
                at('2026-09-26T03:00:05'),
                at('2026-09-27T23:00:00'),
            ).due,
        ).toBe(true);
    });
});
