import {
    MIN_CHILDBEARING_AGE,
    ageInYears,
    maternityEligibility,
    sexKind,
} from './maternity-eligibility.util';

/**
 * Tests for the maternity applicability rule.
 *
 * The two behaviours that matter clinically are that a recorded male never gets
 * a maternity surface, and that an *unrecorded* sex still does — hiding a chart
 * section because a field is blank is how care gets missed.
 */
const NOW = new Date('2026-09-27T12:00:00Z');
/**
 * DOB that makes someone exactly `age` on 2026-09-27.
 *
 * Built as a plain string rather than via `new Date(...).toISOString()`: the ISO
 * round-trip shifts the calendar date by a day in any timezone ahead of UTC, so
 * the test would have measured the helper, not the rule.
 */
const bornYearsAgo = (age: number) => `${2026 - age}-09-27`;

describe('sexKind', () => {
    it.each([
        ['Female', 'female'],
        ['female', 'female'],
        [' FEMALE ', 'female'],
        ['F', 'female'],
        ['Male', 'male'],
        ['m', 'male'],
        ['Male ', 'male'],
        ['', 'unknown'],
        [null, 'unknown'],
        [undefined, 'unknown'],
        ['Other', 'unknown'],
        ['Non-binary', 'unknown'],
    ])('reads %j as %s', (input, expected) => {
        expect(sexKind(input)).toBe(expected);
    });
});

describe('ageInYears', () => {
    it('counts whole years', () => {
        expect(ageInYears(bornYearsAgo(30), NOW)).toBe(30);
    });

    it('has not aged up before the birthday', () => {
        const tomorrow = new Date(
            NOW.getFullYear() - 30,
            NOW.getMonth(),
            NOW.getDate() + 1,
        );
        expect(ageInYears(tomorrow, NOW)).toBe(29);
    });

    it('counts the birthday itself', () => {
        expect(ageInYears(bornYearsAgo(30), NOW)).toBe(30);
    });

    it('accepts a MySQL date string', () => {
        expect(ageInYears('1996-09-27', NOW)).toBe(30);
    });

    it('accepts a datetime string with a space separator', () => {
        expect(ageInYears('1996-09-27 00:00:00', NOW)).toBe(30);
    });

    it('treats a date-only DOB as a calendar date, not a UTC instant', () => {
        // The birthday boundary is where an age gate actually matters: a date-only
        // value must not land a day early in a timezone behind UTC.
        expect(ageInYears('1996-09-28', NOW)).toBe(29);
        expect(ageInYears('2026-09-27', NOW)).toBe(0);
    });

    it('returns null for a date of birth in the future', () => {
        expect(ageInYears('2026-09-28', NOW)).toBeNull();
    });

    it('returns null for junk, blanks and impossible ages', () => {
        expect(ageInYears('', NOW)).toBeNull();
        expect(ageInYears(null, NOW)).toBeNull();
        expect(ageInYears('0000-00-00', NOW)).toBeNull();
        expect(ageInYears('not a date', NOW)).toBeNull();
        expect(ageInYears('1800-01-01', NOW)).toBeNull();
    });
});

describe('maternityEligibility', () => {
    it('hides maternity for a recorded male, whatever his age', () => {
        const r = maternityEligibility(
            { sex: 'Male', DOB: bornYearsAgo(35) },
            NOW,
        );
        expect(r.applicable).toBe(false);
        expect(r.reason).toMatch(/male/i);
    });

    it('hides maternity for a male even with no date of birth', () => {
        expect(
            maternityEligibility({ sex: 'M', DOB: null }, NOW).applicable,
        ).toBe(false);
    });

    it('shows maternity for a woman of childbearing age', () => {
        const r = maternityEligibility(
            { sex: 'Female', DOB: bornYearsAgo(28) },
            NOW,
        );
        expect(r.applicable).toBe(true);
        expect(r.ageYears).toBe(28);
        expect(r.reason).toMatch(/childbearing age/i);
    });

    it('shows maternity for an older woman — past maternity history is still clinical', () => {
        expect(
            maternityEligibility({ sex: 'Female', DOB: bornYearsAgo(71) }, NOW)
                .applicable,
        ).toBe(true);
    });

    it('hides maternity for a female child below the threshold', () => {
        const r = maternityEligibility(
            { sex: 'Female', DOB: bornYearsAgo(4) },
            NOW,
        );
        expect(r.applicable).toBe(false);
        expect(r.reason).toMatch(/childbearing age starts at 12/);
    });

    it('includes a girl exactly at the threshold', () => {
        expect(
            maternityEligibility(
                { sex: 'Female', DOB: bornYearsAgo(MIN_CHILDBEARING_AGE) },
                NOW,
            ).applicable,
        ).toBe(true);
    });

    it('stays visible when the sex is not recorded', () => {
        const r = maternityEligibility({ sex: '', DOB: bornYearsAgo(30) }, NOW);
        expect(r.applicable).toBe(true);
        expect(r.reason).toMatch(/not recorded/i);
    });

    it('stays visible for a female with no date of birth, rather than guessing', () => {
        const r = maternityEligibility({ sex: 'Female', DOB: null }, NOW);
        expect(r.applicable).toBe(true);
        expect(r.ageYears).toBeNull();
        expect(r.reason).toMatch(/no date of birth/i);
    });

    it('reads either DOB or dob', () => {
        expect(
            maternityEligibility({ sex: 'Female', dob: bornYearsAgo(24) }, NOW)
                .ageYears,
        ).toBe(24);
    });

    it('survives a null patient', () => {
        const r = maternityEligibility(null, NOW);
        expect(r.applicable).toBe(true);
        expect(r.ageYears).toBeNull();
    });

    it('honours a custom threshold', () => {
        const patient = { sex: 'Female', DOB: bornYearsAgo(15) };
        expect(
            maternityEligibility(patient, NOW, { minAge: 16 }).applicable,
        ).toBe(false);
        expect(
            maternityEligibility(patient, NOW, { minAge: 12 }).applicable,
        ).toBe(true);
    });
});
