/**
 * Who may chart what — the frontend mirror of the API's `@Roles` lists.
 *
 * These drifted apart. The chart passed `readOnly={role === 'nurse'}` to every
 * clinical tab, which is right for allergies, medications, conditions and
 * immunizations (all `@Roles('admin', 'physician')` on the server) but wrong for
 * observations: `POST patients/:pid/observations` accepts nurses, so a nurse was
 * shown the form with no Save button and the tab looked broken. The vitals tab had
 * the opposite problem — no gate at all, so a role the API refuses could fill the
 * form in and watch the Save quietly 403.
 *
 * The API is the authority. If you change `@Roles` in clinical.controller.ts,
 * change the matching list here.
 */

/** `@Roles('admin', 'physician', 'nurse', 'midwife')` on createObservation. */
export const OBSERVATION_ROLES = ['admin', 'physician', 'nurse', 'midwife'] as const;

/** `@Roles('admin', 'physician', 'nurse')` on createVital. */
export const VITALS_ROLES = ['admin', 'physician', 'nurse'] as const;

/** Chart-owned records a physician owns; nurses read them. */
export const PHYSICIAN_ONLY_ROLES = ['admin', 'physician'] as const;

function hasRole(role: string | null | undefined, allowed: readonly string[]): boolean {
  return !!role && allowed.includes(role);
}

/**
 * Allergies, medications, conditions and immunizations — `@Roles('admin',
 * 'physician')` on every write. Nurses and registrars read these.
 */
export function canManageChartRecords(role?: string | null): boolean {
  return hasRole(role, PHYSICIAN_ONLY_ROLES);
}

export function canRecordObservations(role?: string | null): boolean {
  return hasRole(role, OBSERVATION_ROLES);
}

export function canRecordVitals(role?: string | null): boolean {
  return hasRole(role, VITALS_ROLES);
}

/**
 * Why a tab is read-only, in the user's words — shown in place of the form, so a
 * missing button is explained rather than looking like a broken page.
 */
export function readOnlyNote(kind: 'observations' | 'vitals', role?: string | null): string {
  const allowed = kind === 'observations' ? OBSERVATION_ROLES : VITALS_ROLES;
  const who = allowed.join(', ').replace(/, ([^,]*)$/, ' or $1');
  const you = role ? `you are signed in as ${role}` : 'your role is not set';
  return `Recording ${kind} needs ${who} — ${you}. The notes are still visible here.`;
}
