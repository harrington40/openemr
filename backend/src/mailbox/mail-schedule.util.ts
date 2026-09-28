export interface NightlyPolicy {
  enabled: boolean;
  hour: number;
  retentionDays: number;
}

export interface NightlyDecision {
  due: boolean;
  reason: string;
  /** When today's window opened, ISO — useful for the UI countdown. */
  dueAt: string;
}

/**
 * Should the nightly sweep run now?
 *
 * Kept pure and separate because "once a day, after hour H, surviving restarts"
 * is exactly the kind of logic that silently double-runs or never runs. The
 * caller passes the last run time it has recorded, so a crash mid-day cannot
 * cause a second sweep and a restart cannot cause a missed one.
 */
export function isNightlyRunDue(
  policy: NightlyPolicy,
  lastRunAt: string | Date | null | undefined,
  now: Date = new Date(),
): NightlyDecision {
  const hour = Number.isFinite(policy.hour) ? Math.min(23, Math.max(0, Math.trunc(policy.hour))) : 3;
  const due = new Date(now);
  due.setHours(hour, 0, 0, 0);

  if (!policy.enabled) return { due: false, reason: 'automatic archiving is off', dueAt: due.toISOString() };
  if (now.getTime() < due.getTime()) {
    return { due: false, reason: `window opens ${String(hour).padStart(2, '0')}:00`, dueAt: due.toISOString() };
  }

  const last = lastRunAt ? new Date(lastRunAt) : null;
  if (last && !Number.isNaN(last.getTime()) && last.getTime() >= due.getTime()) {
    return { due: false, reason: 'already ran today', dueAt: due.toISOString() };
  }

  return { due: true, reason: 'due', dueAt: due.toISOString() };
}
