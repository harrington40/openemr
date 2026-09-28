/**
 * Who gets a maternity surface.
 *
 * The backend is authoritative — `GET /patients/:id` returns
 * `maternity_eligibility` — but this mirrors the rule so screens that only hold
 * a partial patient object (a list row, a dashboard selection) still behave
 * correctly instead of showing the Maternity tab for a man.
 *
 * Rule: female, and at least `MIN_CHILDBEARING_AGE` old. No upper age limit —
 * gravida/para and past pregnancy history stay clinically relevant for life, so
 * an older woman keeps her maternity record.
 */

/** Age at which a female is treated as of childbearing age. Mirrors the backend. */
export const MIN_CHILDBEARING_AGE = 12;

export interface MaternityApplicability {
  applicable: boolean;
  reason: string;
  ageYears: number | null;
}

export interface MaternityPatientLike {
  sex?: string | null;
  dob?: string | null;
  DOB?: string | null;
  /** Authoritative flag from the API, when present. */
  maternity_eligibility?: { applicable: boolean; reason: string; ageYears: number | null } | null;
}

/** Mirrors the backend `sexKind`: only an explicit male reading counts as male. */
export function sexKind(sex?: string | null): 'female' | 'male' | 'unknown' {
  const s = String(sex ?? '').trim().toLowerCase();
  if (!s) return 'unknown';
  if (s === 'f' || s.startsWith('fem') || s === 'woman') return 'female';
  if (s === 'm' || s.startsWith('mal') || s === 'man') return 'male';
  return 'unknown';
}

export function ageInYears(dob?: string | null, now: Date = new Date()): number | null {
  if (!dob) return null;

  let born: Date;
  const raw = String(dob).trim();
  // A date-only value is a calendar date, not an instant: `new Date('1996-09-28')`
  // is UTC midnight and reads back as the previous day west of UTC, which would
  // flip an age gate a day early.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const [y, m, d] = dateOnly ? [Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3])] : [0, 0, 0];
  // Reject calendar nonsense before it becomes a number: MySQL's zero date
  // "0000-00-00" would otherwise land in 1899 and score as age 127.
  born =
    dateOnly && y >= 1850 && m >= 1 && m <= 12 && d >= 1 && d <= 31
      ? new Date(y, m - 1, d)
      : new Date(raw.replace(' ', 'T'));

  if (Number.isNaN(born.getTime())) return null;

  let age = now.getFullYear() - born.getFullYear();
  const monthDelta = now.getMonth() - born.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < born.getDate())) age -= 1;
  return age >= 0 && age < 140 ? age : null;
}

export function maternityApplicability(
  patient: MaternityPatientLike | null | undefined,
  now: Date = new Date(),
): MaternityApplicability {
  // Trust the API when it has spoken.
  const fromApi = patient?.maternity_eligibility;
  if (fromApi && typeof fromApi.applicable === 'boolean') {
    return { applicable: fromApi.applicable, reason: fromApi.reason, ageYears: fromApi.ageYears ?? null };
  }

  const kind = sexKind(patient?.sex);
  const ageYears = ageInYears(patient?.dob ?? patient?.DOB ?? null, now);

  if (kind === 'male') {
    return { applicable: false, reason: 'Maternity does not apply — this patient is recorded as male.', ageYears };
  }
  if (kind === 'unknown') {
    return { applicable: true, reason: 'Sex is not recorded, so maternity is shown in case it is clinically relevant.', ageYears };
  }
  if (ageYears === null) {
    return { applicable: true, reason: 'Female, but no date of birth on file to check age against.', ageYears };
  }
  if (ageYears < MIN_CHILDBEARING_AGE) {
    return {
      applicable: false,
      reason: `Maternity does not apply — this patient is female but ${ageYears} years old (childbearing age starts at ${MIN_CHILDBEARING_AGE}).`,
      ageYears,
    };
  }
  return { applicable: true, reason: `Female, ${ageYears} years old — of childbearing age.`, ageYears };
}
