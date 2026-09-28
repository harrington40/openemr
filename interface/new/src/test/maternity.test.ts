import { describe, it, expect } from 'vitest';
import {
  MIN_CHILDBEARING_AGE,
  ageInYears,
  maternityApplicability,
  sexKind,
} from '../utils/maternity';

/**
 * The maternity gate the chart menu and the midwife dashboard both rely on.
 *
 * The important case is the API-provided flag taking precedence: those two
 * screens hold different patient shapes, and the backend must be able to
 * overrule the local guess.
 */
const NOW = new Date('2026-09-27T12:00:00Z');
/**
 * DOB that makes someone exactly `age` on 2026-09-27. A plain string, not an ISO
 * round-trip through a local Date — that shifts the day in any TZ ahead of UTC.
 */
const bornYearsAgo = (age: number) => `${2026 - age}-09-27`;

describe('sexKind', () => {
  it.each([
    ['Female', 'female'],
    ['F', 'female'],
    [' FEMALE ', 'female'],
    ['Male', 'male'],
    ['m', 'male'],
    ['', 'unknown'],
    [null, 'unknown'],
    [undefined, 'unknown'],
  ])('reads %j as %s', (input, expected) => {
    expect(sexKind(input as any)).toBe(expected);
  });
});

describe('ageInYears', () => {
  it('counts whole years and respects the birthday', () => {
    expect(ageInYears(bornYearsAgo(30), NOW)).toBe(30);
    // Born one day later, so still 29 on the 27th.
    expect(ageInYears('1996-09-28', NOW)).toBe(29);
  });

  it('returns null for anything unusable', () => {
    expect(ageInYears(null, NOW)).toBeNull();
    expect(ageInYears('', NOW)).toBeNull();
    expect(ageInYears('nonsense', NOW)).toBeNull();
  });

  it('rejects MySQL zero dates instead of scoring them as a very old patient', () => {
    expect(ageInYears('0000-00-00', NOW)).toBeNull();
    expect(ageInYears('1800-01-01', NOW)).toBeNull();
  });
});

describe('maternityApplicability', () => {
  it('hides maternity for a male', () => {
    const r = maternityApplicability({ sex: 'Male', dob: bornYearsAgo(40) }, NOW);
    expect(r.applicable).toBe(false);
    expect(r.reason).toMatch(/male/i);
  });

  it('shows maternity for a woman of childbearing age', () => {
    expect(maternityApplicability({ sex: 'Female', dob: bornYearsAgo(27) }, NOW).applicable).toBe(true);
  });

  it('hides maternity for a young girl', () => {
    expect(maternityApplicability({ sex: 'Female', dob: bornYearsAgo(3) }, NOW).applicable).toBe(false);
  });

  it('includes a girl at the threshold and keeps older women', () => {
    expect(maternityApplicability({ sex: 'Female', dob: bornYearsAgo(MIN_CHILDBEARING_AGE) }, NOW).applicable).toBe(true);
    expect(maternityApplicability({ sex: 'Female', dob: bornYearsAgo(68) }, NOW).applicable).toBe(true);
  });

  it('stays visible when the sex is unrecorded', () => {
    expect(maternityApplicability({ sex: '', dob: bornYearsAgo(30) }, NOW).applicable).toBe(true);
  });

  it('reads the DOB alias as well as dob', () => {
    expect(maternityApplicability({ sex: 'Female', DOB: bornYearsAgo(22) }, NOW).ageYears).toBe(22);
  });

  it('lets the API flag overrule the local rule', () => {
    // A locally-ineligible-looking patient the backend has approved (e.g. a
    // corrected sex value the list row has not refreshed yet).
    const approved = maternityApplicability(
      { sex: 'Male', dob: bornYearsAgo(40), maternity_eligibility: { applicable: true, reason: 'Female per record', ageYears: 40 } },
      NOW,
    );
    expect(approved.applicable).toBe(true);

    const denied = maternityApplicability(
      { sex: 'Female', dob: bornYearsAgo(30), maternity_eligibility: { applicable: false, reason: 'Recorded male', ageYears: 30 } },
      NOW,
    );
    expect(denied.applicable).toBe(false);
    expect(denied.reason).toBe('Recorded male');
  });

  it('survives a null patient', () => {
    expect(maternityApplicability(null, NOW).applicable).toBe(true);
  });
});
