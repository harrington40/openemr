/**
 * Who has a maternity record.
 *
 * Maternity (antenatal risk scores, EDDs, APGARs) is only meaningful for a
 * female patient who is old enough to carry a pregnancy, so the chart used to
 * offer the Maternity tab to every patient — including men and children — which
 * invites an assessment being filed against the wrong chart. This is the single
 * rule that decides, and every surface (chart tab, midwife dashboard roster and
 * search, write guard) reads it rather than re-implementing the comparison.
 */

/** Age at which a female is treated as of childbearing age. */
export const MIN_CHILDBEARING_AGE = 12;

export interface MaternityPatient {
    sex?: string | null;
    /** patient_data.DOB — MySQL date string or Date. */
    DOB?: string | null | Date;
    dob?: string | null | Date;
}

export interface MaternityEligibility {
    applicable: boolean;
    /** Plain-English explanation, safe to show to a clinician. */
    reason: string;
    sex: string | null;
    ageYears: number | null;
    minAge: number;
}

/** Whole years between a date of birth and now, or null when unknowable. */
export function ageInYears(
    dob: string | Date | null | undefined,
    now: Date = new Date(),
): number | null {
    if (!dob) return null;

    let born: Date;
    if (dob instanceof Date) {
        born = dob;
    } else {
        const raw = String(dob).trim();
        // "1996-09-28" is a calendar date, not an instant. `new Date('1996-09-28')`
        // parses as UTC midnight, which reads back as the previous day in any
        // timezone behind UTC — an off-by-one on every age gate, exactly at the
        // birthday boundary where these gates matter. Build local dates instead.
        const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
        const [y, m, d] = dateOnly
            ? [Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3])]
            : [0, 0, 0];
        // Reject calendar nonsense before it becomes a number: MySQL's zero date
        // "0000-00-00" would otherwise land in 1899 and score as age 127.
        born =
            dateOnly && y >= 1850 && m >= 1 && m <= 12 && d >= 1 && d <= 31
                ? new Date(y, m - 1, d)
                : new Date(raw.replace(' ', 'T'));
    }

    if (Number.isNaN(born.getTime())) return null;

    let age = now.getFullYear() - born.getFullYear();
    const monthDelta = now.getMonth() - born.getMonth();
    // Not had this year's birthday yet.
    if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < born.getDate()))
        age -= 1;
    return age >= 0 && age < 140 ? age : null;
}

/**
 * `patient_data.sex` is free text on this schema ('Male', 'Female', 'male',
 * 'M', '', sometimes 'Other'). Only an explicit male reading counts as male —
 * anything unrecorded stays visible, because hiding a chart section on a blank
 * field is how care gets missed.
 */
export function sexKind(sex?: string | null): 'female' | 'male' | 'unknown' {
    const s = String(sex ?? '')
        .trim()
        .toLowerCase();
    if (!s) return 'unknown';
    if (s === 'f' || s.startsWith('fem') || s === 'woman') return 'female';
    if (s === 'm' || s.startsWith('mal') || s === 'man') return 'male';
    return 'unknown';
}

export function maternityEligibility(
    patient: MaternityPatient | null | undefined,
    now: Date = new Date(),
    opts: { minAge?: number } = {},
): MaternityEligibility {
    const minAge = Number.isFinite(opts.minAge)
        ? Number(opts.minAge)
        : MIN_CHILDBEARING_AGE;
    const rawSex = patient?.sex ?? null;
    const kind = sexKind(rawSex);
    const ageYears = ageInYears(patient?.DOB ?? patient?.dob ?? null, now);
    const base = { sex: rawSex, ageYears, minAge };

    if (kind === 'male') {
        return {
            ...base,
            applicable: false,
            reason: 'Maternity does not apply — this patient is recorded as male.',
        };
    }

    if (kind === 'unknown') {
        return {
            ...base,
            applicable: true,
            reason: 'Sex is not recorded, so maternity is shown in case it is clinically relevant.',
        };
    }

    if (ageYears === null) {
        return {
            ...base,
            applicable: true,
            reason: 'Female, but no date of birth on file to check age against.',
        };
    }

    if (ageYears < minAge) {
        return {
            ...base,
            applicable: false,
            reason: `Maternity does not apply — this patient is female but ${ageYears} years old (childbearing age starts at ${minAge}).`,
        };
    }

    return {
        ...base,
        applicable: true,
        reason: `Female, ${ageYears} years old — of childbearing age.`,
    };
}
