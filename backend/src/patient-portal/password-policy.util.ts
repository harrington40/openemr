import { randomInt } from 'crypto';

/**
 * Password rules for patient portal credentials.
 *
 * Portal accounts are handed out at the registration desk, so the generated
 * password has to survive being read aloud and written on paper. That shapes
 * two decisions below: ambiguous glyphs are never generated, and the rules are
 * a floor rather than a puzzle — the strength that matters comes from length.
 */

/** Minimum length. Length is the dominant factor in resisting offline guessing. */
export const PASSWORD_MIN_LENGTH = 12;

/**
 * bcrypt only reads the first 72 bytes — anything beyond is silently ignored,
 * so a 100-character password and its first 72 characters would be the same
 * credential. Rejecting over-long input is honest; silently truncating is not.
 */
export const PASSWORD_MAX_BYTES = 72;

/**
 * Characters excluded from generation: O/0, l/1/I, and 5/S are the pairs that
 * get mis-transcribed when someone copies a password off a card.
 */
const UPPER = 'ABCDEFGHJKLMNPQRTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGITS = '2346789';
const SYMBOLS = '!@#$%^&*-_=+?';

/** Deny-list of passwords that clear the composition rules but are still awful. */
const COMMON = [
  'password', 'passw0rd', 'qwerty', 'letmein', 'welcome', 'admin',
  'changeme', 'iloveyou', 'monkey', 'dragon', 'football', 'baseball',
  'openrx', 'hospital', 'patient', 'portal',
];

export interface PasswordCheck {
  ok: boolean;
  /** Empty when `ok` is true; otherwise one human-readable sentence per failure. */
  problems: string[];
}

/** Straightforward ascending or descending runs, e.g. "abcd", "4321". */
function hasSequentialRun(value: string, runLength = 4): boolean {
  const lower = value.toLowerCase();
  let run = 1;
  for (let i = 1; i < lower.length; i++) {
    const step = lower.charCodeAt(i) - lower.charCodeAt(i - 1);
    run = (step === 1 || step === -1) ? run + 1 : 1;
    if (run >= runLength) return true;
  }
  return false;
}

/** Three or more of the same character in a row, e.g. "aaa", "111". */
function hasRepeatedRun(value: string, runLength = 3): boolean {
  let run = 1;
  for (let i = 1; i < value.length; i++) {
    run = value[i] === value[i - 1] ? run + 1 : 1;
    if (run >= runLength) return true;
  }
  return false;
}

/**
 * Validates a password a human chose.
 *
 * Returns every problem rather than the first, so the portal can show the whole
 * list in one pass instead of making the patient fix one thing at a time.
 */
export function validatePassword(password: unknown): PasswordCheck {
  const problems: string[] = [];

  if (typeof password !== 'string' || password.length === 0) {
    return { ok: false, problems: ['Password is required.'] };
  }

  if (password.length < PASSWORD_MIN_LENGTH) {
    problems.push(`Use at least ${PASSWORD_MIN_LENGTH} characters.`);
  }
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
    problems.push(`Use at most ${PASSWORD_MAX_BYTES} bytes — anything longer is ignored.`);
  }
  if (/[\u0000-\u001f\u007f]/.test(password)) {
    problems.push('Password cannot contain control characters.');
  }
  if (!/[a-z]/.test(password)) problems.push('Add a lowercase letter.');
  if (!/[A-Z]/.test(password)) problems.push('Add an uppercase letter.');
  if (!/[0-9]/.test(password)) problems.push('Add a number.');
  if (!/[^A-Za-z0-9]/.test(password)) problems.push('Add a symbol.');

  const lower = password.toLowerCase();
  if (COMMON.some(word => lower.includes(word))) {
    problems.push('Avoid common words such as "password" or "welcome".');
  }
  if (hasRepeatedRun(password)) {
    problems.push('Avoid repeating the same character three or more times.');
  }
  if (hasSequentialRun(password)) {
    problems.push('Avoid runs such as "abcd" or "1234".');
  }

  return { ok: problems.length === 0, problems };
}

/** Uniform random index — randomInt avoids the modulo bias of `% length`. */
function pick(pool: string): string {
  return pool[randomInt(pool.length)];
}

/**
 * One random draw from the pools. Not policy-checked — see generatePassword.
 */
function drawPassword(length: number): string {
  const size = Math.max(PASSWORD_MIN_LENGTH, Math.min(length, 32));

  const required = [
    pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS),
  ];
  const everything = UPPER + LOWER + DIGITS + SYMBOLS;

  while (required.length < size) required.push(pick(everything));

  // Fisher-Yates, descending, so every ordering is equally likely.
  for (let i = required.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [required[i], required[j]] = [required[j], required[i]];
  }

  return required.join('');
}

/**
 * Generates a password that satisfies {@link validatePassword}.
 *
 * One character is drawn from each required class before the remainder is
 * filled, so the result cannot fail the composition rules by chance, and the
 * whole thing is shuffled so the required characters are not in fixed positions.
 *
 * A random draw can still land on something the validator refuses — an
 * incidental run such as "ghij" (roughly one draw in fifty). Rather than trying
 * to construct a run-free string, redraw until one passes: the desk must never
 * hand out a password the portal would then reject.
 */
export function generatePassword(length = 16): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = drawPassword(length);
    if (validatePassword(candidate).ok) return candidate;
  }
  // Unreachable in practice — 50 consecutive failures is about 1 in 10^85.
  throw new Error('Could not generate a password that satisfies the policy');
}
