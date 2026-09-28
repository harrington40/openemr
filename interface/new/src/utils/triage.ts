/**
 * Triage levels, colours and queue ordering.
 *
 * The backend is authoritative — it owns the targets, the bands and the score —
 * and this mirrors only what the screen has to render. Mirrored rather than
 * fetched so a board that has not loaded its data yet still shows a patient in
 * the right colour instead of a blank row.
 *
 * Keep these in step with `backend/src/emergency/triage-acuity.util.ts`; the
 * test file asserts the values so a change on one side and not the other is
 * caught rather than silently rendering the wrong colour.
 */

export type TriageLevel = 1 | 2 | 3 | 4 | 5;

export interface TriageLevelMeta {
  level: TriageLevel;
  color: string;
  label: string;
  meaning: string;
  targetMinutes: number;
  reassessMinutes: number;
  acuity: 'routine' | 'urgent' | 'stat';
  /** Bootstrap badge class, so the colour is used consistently in tables. */
  badge: string;
  icon: string;
}

export const TRIAGE_LEVELS: Record<TriageLevel, TriageLevelMeta> = {
  1: { level: 1, color: '#dc3545', label: 'Red', meaning: 'Resuscitation — immediate', targetMinutes: 0, reassessMinutes: 0, acuity: 'stat', badge: 'bg-danger', icon: 'bi-heart-pulse-fill' },
  2: { level: 2, color: '#fd7e14', label: 'Orange', meaning: 'Emergent — cannot wait', targetMinutes: 10, reassessMinutes: 15, acuity: 'stat', badge: 'bg-warning text-dark', icon: 'bi-exclamation-triangle-fill' },
  3: { level: 3, color: '#ffc107', label: 'Yellow', meaning: 'Urgent — stable, needs work-up', targetMinutes: 30, reassessMinutes: 30, acuity: 'urgent', badge: 'bg-warning text-dark', icon: 'bi-hourglass-split' },
  4: { level: 4, color: '#198754', label: 'Green', meaning: 'Less urgent — one resource', targetMinutes: 60, reassessMinutes: 60, acuity: 'routine', badge: 'bg-success', icon: 'bi-check-circle' },
  5: { level: 5, color: '#0dcaf0', label: 'Blue', meaning: 'Non-urgent — no resources', targetMinutes: 120, reassessMinutes: 60, acuity: 'routine', badge: 'bg-info text-dark', icon: 'bi-emoji-smile' },
};

export function levelMeta(level: number | null | undefined): TriageLevelMeta {
  const n = Math.round(Number(level));
  if (!Number.isFinite(n) || n <= 1) return TRIAGE_LEVELS[1];
  if (n >= 5) return TRIAGE_LEVELS[5];
  return TRIAGE_LEVELS[n as TriageLevel];
}

/** Severity ordering weight — higher is sicker. Used for sorting and display. */
export function severityWeight(level: number): number {
  return (6 - levelMeta(level).level) * 20;
}

/**
 * The colour to paint a patient's state.
 *
 * The API sends `color` on an emergency visit, and it is the same value as the
 * board uses. Falling back to `levelMeta(level)` keeps a card coloured if the
 * field is ever absent — an uncoloured emergency patient on a clinician's
 * dashboard is worse than a slightly redundant helper.
 */
export function emergencyAccent(visit: { color?: string | null; level?: number | null }): string {
  const sent = typeof visit?.color === 'string' ? visit.color.trim() : '';
  if (/^#[0-9a-fA-F]{3,8}$/.test(sent)) return sent;
  return levelMeta(visit?.level).color;
}

/**
 * Where a patient sits in the queue: acuity first, then how overdue they are
 * against their own target. Mirrors the backend so the board and the API agree
 * on what "next" means.
 *
 * The waiting term is capped below one acuity band (20 points) so it can only
 * order patients *within* a level — an overdue Yellow must never be shown ahead
 * of a just-arrived Orange.
 */
export function queuePriority(visit: { level: number; waitMinutes: number }): number {
  const meta = levelMeta(visit.level);
  const elapsed = Math.max(0, Number(visit.waitMinutes) || 0);
  const target = Math.max(1, meta.targetMinutes || 1);
  const pressure = Math.min(elapsed / target, 2);
  const breached = meta.targetMinutes > 0 && elapsed > meta.targetMinutes;
  return Math.round((6 - meta.level) * 20 + pressure * 7 + (breached ? 5 : 0));
}

export interface WaitClock {
  /** "12m" / "1h 04m" — compact enough for a board column. */
  text: string;
  breached: boolean;
  overByMinutes: number;
  minutesToTarget: number;
  /** True once past their own reassessment interval. */
  reassessOverdue: boolean;
}

/** How long a patient has waited against their target, and whether that matters. */
export function waitClock(visit: {
  level: number;
  waitMinutes: number;
  targetMinutes?: number | null;
  reassessDueInMinutes?: number | null;
}): WaitClock {
  const meta = levelMeta(visit.level);
  const wait = Math.max(0, Number(visit.waitMinutes) || 0);
  const target = visit.targetMinutes === null || visit.targetMinutes === undefined ? meta.targetMinutes : Number(visit.targetMinutes);
  const breached = target > 0 && wait > target;
  const hours = Math.floor(wait / 60);
  const minutes = wait % 60;

  return {
    text: hours > 0 ? `${hours}h ${String(minutes).padStart(2, '0')}m` : `${minutes}m`,
    breached,
    overByMinutes: breached ? wait - target : 0,
    minutesToTarget: Math.max(0, target - wait),
    reassessOverdue:
      visit.reassessDueInMinutes !== null &&
      visit.reassessDueInMinutes !== undefined &&
      Number(visit.reassessDueInMinutes) === 0,
  };
}

/** Sorted copy of a board's visits: sickest, then most overdue. */
export function orderVisits<T extends { level: number; waitMinutes: number }>(visits: T[]): T[] {
  return [...visits].sort(
    (a, b) => queuePriority(b) - queuePriority(a) || b.waitMinutes - a.waitMinutes,
  );
}

export interface EmergencyBanner {
  /** Bootstrap alert tone. */
  tone: 'danger' | 'warning' | 'info';
  headline: string;
  detail: string;
  /** The one thing that should happen next. */
  action: string;
  level: number;
  color: string;
  label: string;
  breached: boolean;
}

/**
 * The chart banner for a patient who is currently in the department.
 *
 * Returns null when there is nothing active: a chart should not carry a red
 * strip because somebody attended three weeks ago, and a banner that becomes
 * permanent decoration stops being read at all. Past attendances live in the
 * Triage tab instead.
 */
export function emergencyBanner(emergency: any, now: Date = new Date()): EmergencyBanner | null {
  const visit = emergency?.active;
  if (!visit) return null;

  const meta = levelMeta(visit.level);
  const arrivedAt = visit.arrivedAt ? new Date(visit.arrivedAt) : null;
  const waitMinutes = arrivedAt && !Number.isNaN(arrivedAt.getTime())
    ? Math.max(0, Math.round((now.getTime() - arrivedAt.getTime()) / 60000))
    : Number(visit.waitMinutes) || 0;
  const clock = waitClock({ level: visit.level, waitMinutes, targetMinutes: visit.targetMinutes, reassessDueInMinutes: visit.reassessDueInMinutes });

  const tone: EmergencyBanner['tone'] = visit.level <= 2 ? 'danger' : visit.level === 3 ? 'warning' : 'info';
  const target = visit.targetMinutes === 0 ? 'immediate' : `${visit.targetMinutes} min`;
  const elapsed = clock.text;

  let action: string;
  if (clock.breached) {
    action = `Escalate — ${clock.overByMinutes} min past the ${target} target.`;
  } else if (visit.needsVitals) {
    action = 'Complete the observations — the level is floored until they are recorded.';
  } else if (clock.reassessOverdue) {
    action = 'Reassessment is due.';
  } else if (!visit.awaitingFirstReview) {
    action = 'Under treatment.';
  } else {
    action = `Must be seen within ${clock.minutesToTarget} min.`;
  }

  return {
    tone,
    headline: `In the emergency department — level ${meta.level} ${meta.label} (${meta.meaning})`,
    detail: [
      `arrived ${arrivedAt && !Number.isNaN(arrivedAt.getTime()) ? arrivedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'unknown'}`,
      `waiting ${elapsed} of a ${target} target`,
      visit.escalatedLevel !== null && visit.escalatedLevel !== undefined ? 'escalated for delay' : null,
      visit.chiefComplaint || null,
    ]
      .filter(Boolean)
      .join(' · '),
    action,
    level: meta.level,
    color: meta.color,
    label: meta.label,
    breached: clock.breached,
  };
}
