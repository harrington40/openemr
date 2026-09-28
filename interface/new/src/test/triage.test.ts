import { describe, it, expect } from 'vitest';
import {
  TRIAGE_LEVELS,
  emergencyBanner,
  levelMeta,
  orderVisits,
  queuePriority,
  severityWeight,
  waitClock,
} from '../utils/triage';

/**
 * The shared level table and queue ordering.
 *
 * `reverseColour` is worth testing twice: the colours are what a clinician reads
 * across a crowded room, and rendering Orange as Green is the kind of mistake
 * nobody notices until it matters.
 */
describe('level table', () => {
  it('keeps the five standard ED colours', () => {
    expect(TRIAGE_LEVELS[1].color).toBe('#dc3545');
    expect(TRIAGE_LEVELS[2].color).toBe('#fd7e14');
    expect(TRIAGE_LEVELS[3].color).toBe('#ffc107');
    expect(TRIAGE_LEVELS[4].color).toBe('#198754');
    expect(TRIAGE_LEVELS[5].color).toBe('#0dcaf0');
  });

  it('keeps the agreed targets and reassessment intervals', () => {
    expect([1, 2, 3, 4, 5].map((l) => TRIAGE_LEVELS[l as 1].targetMinutes)).toEqual([0, 10, 30, 60, 120]);
    expect([1, 2, 3, 4, 5].map((l) => TRIAGE_LEVELS[l as 1].reassessMinutes)).toEqual([0, 15, 30, 60, 60]);
  });

  it('carries a badge class and an icon for each level', () => {
    for (const level of [1, 2, 3, 4, 5]) {
      expect(TRIAGE_LEVELS[level as 1].badge).toBeTruthy();
      expect(TRIAGE_LEVELS[level as 1].icon).toMatch(/^bi-/);
      expect(TRIAGE_LEVELS[level as 1].meaning).toBeTruthy();
    }
  });

  it('clamps unknown levels to something safe rather than undefined', () => {
    expect(levelMeta(0).level).toBe(1);
    expect(levelMeta(9).level).toBe(5);
    expect(levelMeta(null).level).toBe(1);
    expect(levelMeta(NaN).level).toBe(1);
    expect(levelMeta(3).label).toBe('Yellow');
  });

  it('ranks severity the right way round', () => {
    expect(severityWeight(1)).toBeGreaterThan(severityWeight(5));
  });
});

describe('queue priority', () => {
  it('puts a sicker patient ahead of a well one who waited longer', () => {
    expect(queuePriority({ level: 2, waitMinutes: 1 })).toBeGreaterThan(
      queuePriority({ level: 5, waitMinutes: 100 }),
    );
  });

  it('lets a long-waiting Yellow overtake a just-arrived Yellow', () => {
    expect(queuePriority({ level: 3, waitMinutes: 45 })).toBeGreaterThan(
      queuePriority({ level: 3, waitMinutes: 2 }),
    );
  });

  it('adds a bonus once the target is breached', () => {
    expect(queuePriority({ level: 3, waitMinutes: 31 })).toBeGreaterThan(
      queuePriority({ level: 3, waitMinutes: 29 }),
    );
  });

  it('never lets waiting time outrank a sicker patient', () => {
    // Matches the backend: wait orders patients *within* a level only.
    expect(queuePriority({ level: 3, waitMinutes: 600 })).toBeLessThan(
      queuePriority({ level: 2, waitMinutes: 0 }),
    );
    expect(queuePriority({ level: 5, waitMinutes: 900 })).toBeLessThan(
      queuePriority({ level: 4, waitMinutes: 0 }),
    );
  });

  it('orders a messy board sensibly', () => {
    const ordered = orderVisits([
      { level: 5, waitMinutes: 200 },
      { level: 3, waitMinutes: 5 },
      { level: 2, waitMinutes: 0 },
      { level: 3, waitMinutes: 40 },
    ]);
    expect(ordered[0]).toEqual({ level: 2, waitMinutes: 0 });
    expect(ordered[1]).toEqual({ level: 3, waitMinutes: 40 });
    expect(ordered[ordered.length - 1].level).toBe(5);
  });
});

describe('wait clock', () => {
  it('formats minutes and hours', () => {
    expect(waitClock({ level: 3, waitMinutes: 7 }).text).toBe('7m');
    expect(waitClock({ level: 3, waitMinutes: 64 }).text).toBe('1h 04m');
    expect(waitClock({ level: 3, waitMinutes: 180 }).text).toBe('3h 00m');
  });

  it('flags a breach and how far over', () => {
    const over = waitClock({ level: 2, waitMinutes: 26 });
    expect(over.breached).toBe(true);
    expect(over.overByMinutes).toBe(16);
    expect(over.minutesToTarget).toBe(0);
  });

  it('does not treat a Red patient as breached', () => {
    // A zero-minute target is "now", not "already late".
    expect(waitClock({ level: 1, waitMinutes: 3 }).breached).toBe(false);
  });

  it('respects an explicit target instead of the default', () => {
    const custom = waitClock({ level: 3, waitMinutes: 20, targetMinutes: 15 });
    expect(custom.breached).toBe(true);
    expect(custom.overByMinutes).toBe(5);
  });

  it('flags a missed reassessment interval', () => {
    expect(waitClock({ level: 2, waitMinutes: 20, reassessDueInMinutes: 0 }).reassessOverdue).toBe(true);
    expect(waitClock({ level: 2, waitMinutes: 20, reassessDueInMinutes: 12 }).reassessOverdue).toBe(false);
    // Continuous monitoring still produces a due time — a Red patient is not exempt.
    expect(waitClock({ level: 1, waitMinutes: 20, reassessDueInMinutes: 0 }).reassessOverdue).toBe(true);
  });
});

describe('chart banner', () => {
  const NOW = new Date('2026-09-27T12:00:00Z');
  const arrival = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * 60000).toISOString();
  const activeVisit = (over: Record<string, any> = {}) => ({
    level: 3,
    arrivedAt: arrival(5),
    targetMinutes: 30,
    reassessDueInMinutes: 25,
    needsVitals: false,
    awaitingFirstReview: true,
    escalatedLevel: null,
    chiefComplaint: 'abdominal pain',
    ...over,
  });

  it('says nothing when nobody is in the department', () => {
    expect(emergencyBanner(null, NOW)).toBeNull();
    expect(emergencyBanner({ active: null, total: 0 }, NOW)).toBeNull();
    // A past attendance must not leave a permanent banner on the chart.
    expect(emergencyBanner({ active: null, current: { level: 2 }, total: 3 }, NOW)).toBeNull();
  });

  it('carries the level, colour and a red tone for the sickest', () => {
    const banner = emergencyBanner({ active: activeVisit({ level: 2 }) }, NOW)!;
    expect(banner.level).toBe(2);
    expect(banner.color).toBe('#fd7e14');
    expect(banner.tone).toBe('danger');
    expect(banner.headline).toContain('Orange');
    expect(banner.headline).toContain('cannot wait');
  });

  it('uses a calmer tone as the level drops', () => {
    expect(emergencyBanner({ active: activeVisit({ level: 1 }) }, NOW)!.tone).toBe('danger');
    expect(emergencyBanner({ active: activeVisit({ level: 3 }) }, NOW)!.tone).toBe('warning');
    expect(emergencyBanner({ active: activeVisit({ level: 5 }) }, NOW)!.tone).toBe('info');
  });

  it('computes the wait from the arrival time, not from a stale number', () => {
    const banner = emergencyBanner({ active: activeVisit({ arrivedAt: arrival(42), waitMinutes: 1 }) }, NOW)!;
    expect(banner.detail).toContain('42m');
    expect(banner.breached).toBe(true);
    expect(banner.action).toMatch(/12 min past the 30 min target/);
  });

  it('asks for the missing observations before anything else', () => {
    const banner = emergencyBanner({ active: activeVisit({ needsVitals: true }) }, NOW)!;
    expect(banner.action).toMatch(/complete the observations/i);
  });

  it('nudges a reassessment when the interval has passed', () => {
    const banner = emergencyBanner({ active: activeVisit({ reassessDueInMinutes: 0 }) }, NOW)!;
    expect(banner.action).toMatch(/reassessment is due/i);
  });

  it('reports how long is left when everything is on track', () => {
    const banner = emergencyBanner({ active: activeVisit({ level: 4, targetMinutes: 60, arrivedAt: arrival(10) }) }, NOW)!;
    expect(banner.breached).toBe(false);
    expect(banner.action).toMatch(/within 50 min/);
  });

  it('notes a patient already under treatment', () => {
    const banner = emergencyBanner({ active: activeVisit({ awaitingFirstReview: false }) }, NOW)!;
    expect(banner.action).toBe('Under treatment.');
  });

  it('mentions an escalation for delay', () => {
    const banner = emergencyBanner({ active: activeVisit({ escalatedLevel: 2, level: 2 }) }, NOW)!;
    expect(banner.detail).toMatch(/escalated for delay/);
  });

  it('never renders the word undefined', () => {
    const banner = emergencyBanner({ active: activeVisit({ chiefComplaint: '', arrivedAt: null }) }, NOW)!;
    expect(`${banner.headline} ${banner.detail} ${banner.action}`).not.toMatch(/undefined|NaN/);
  });
});
