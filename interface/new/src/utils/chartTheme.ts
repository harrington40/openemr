import { levelMeta } from './triage';

/**
 * The colour theme for the patient chart page.
 *
 * The chart's cards used to take the colour of whichever tab was open. What
 * actually matters about a patient at a glance is how sick they are, so when the
 * patient is in the department the **triage level colour** themes the page: Red
 * through Blue, the same colour the board and the banner use. With no emergency
 * attendance it falls back to the section colour, so an ordinary chart still has
 * a theme rather than going grey.
 *
 * Returned as values rather than CSS so the same numbers can be used for the
 * shadow tint, the header rule and the page wash without them drifting apart.
 */

export interface ChartTheme {
  /** The theme colour: the triage level when in the department, else the tab. */
  accent: string;
  /** True when the accent came from a triage level rather than the section. */
  fromLevel: boolean;
  level: number | null;
  levelLabel: string | null;
  /** Very light wash for page backgrounds, e.g. an 8% tint of the accent. */
  tint: string;
  /** Slightly stronger tint for rails and insets. */
  ring: string;
  /** Soft, layered, accent-tinted shadow — the "lifted card" look. */
  shadow: string;
  /** The same shadow, deeper, for hover. */
  shadowHover: string;
}

/** Hex colours in this codebase are all `#rrggbb`, so an alpha suffix is safe. */
export function withAlpha(hex: string, alpha: string): string {
  const clean = String(hex || '').trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(clean)) return clean || 'transparent';
  return `${clean}${alpha}`;
}

/**
 * Darken a hex colour by a factor (0..1, where 0.6 means 60% brightness).
 *
 * Needed because two of the five level colours are light — Yellow and Blue — and
 * the chart's header card carries white text. Using the raw level colour there
 * would make the patient's name unreadable for exactly those two levels, so the
 * header uses a darkened variant while everything else uses the true colour.
 */
export function darken(hex: string, factor = 0.6): string {
  const clean = String(hex || '').trim();
  const match = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(clean);
  if (!match) return clean || '#0b1020';
  const f = Math.min(1, Math.max(0.1, Number(factor) || 0.6));
  const channel = (h: string) => Math.round(Math.min(255, parseInt(h, 16) * f)).toString(16).padStart(2, '0');
  return `#${channel(match[1])}${channel(match[2])}${channel(match[3])}`;
}

export function chartTheme({
  level,
  tabColor,
  inDepartment,
}: {
  /** The active visit's triage level, when there is one. */
  level?: number | null;
  /** The colour of the section being viewed — the fallback theme. */
  tabColor: string;
  /** Whether the patient is currently in the department. */
  inDepartment?: boolean;
}): ChartTheme {
  const hasLevel = inDepartment === true && typeof level === 'number' && Number.isFinite(level);
  const meta = hasLevel ? levelMeta(level as number) : null;
  const accent = meta ? meta.color : (tabColor || '#0d6efd');

  return {
    accent,
    fromLevel: !!meta,
    level: meta ? meta.level : null,
    levelLabel: meta ? meta.label : null,
    tint: withAlpha(accent, '14'),   // ~8%
    ring: withAlpha(accent, '40'),   // ~25%
    // Two soft layers plus an accent-tinted bloom: reads as depth without the
    // hard grey drop shadow that made the old cards look pasted on.
    shadow: `0 1px 2px rgba(16,24,40,0.04), 0 12px 28px -18px ${withAlpha(accent, '59')}, 0 24px 48px -32px rgba(16,24,40,0.22)`,
    shadowHover: `0 2px 4px rgba(16,24,40,0.05), 0 20px 40px -20px ${withAlpha(accent, '73')}, 0 32px 64px -36px rgba(16,24,40,0.26)`,
  };
}
