/**
 * Paediatric observation bands.
 *
 * NEWS2 is validated for adults. Applying adult bands to a 6-month-old scores a
 * normal infant as deteriorating (a resting rate of 130 is normal at that age)
 * and, worse, scores a genuinely sick child as fine. These are age-appropriate
 * ranges in the same shape as NEWS2 so the triage algorithm can use one code
 * path with the right thresholds.
 *
 * Bands follow the usual early-warning groupings (<1, 1–4, 5–11, 12–17). The
 * numbers need sign-off by the clinical lead before go-live; they are written as
 * data so that sign-off is a one-line change here rather than a code rewrite.
 */

export type AgeBand = 'under1' | '1to4' | '5to11' | '12to17' | 'adult';

export interface BandRanges {
    band: AgeBand;
    label: string;
    /** Plausible / normal range for the band. */
    respiration: { min: number; max: number };
    pulse: { min: number; max: number };
    systolic: { min: number; max: number };
    /** SpO2 below this is abnormal for the band. */
    oxygenSaturationMin: number;
    /** Below this age, the adult NEWS2 must not be used. */
    adultScoringFrom?: number;
}

export const PAEDIATRIC_BANDS: Record<AgeBand, BandRanges> = {
    under1: {
        band: 'under1',
        label: 'Infant under 1 year',
        respiration: { min: 30, max: 53 },
        pulse: { min: 100, max: 160 },
        systolic: { min: 60, max: 90 },
        oxygenSaturationMin: 94,
    },
    '1to4': {
        band: '1to4',
        label: 'Child 1–4 years',
        respiration: { min: 22, max: 37 },
        pulse: { min: 90, max: 140 },
        systolic: { min: 80, max: 110 },
        oxygenSaturationMin: 94,
    },
    '5to11': {
        band: '5to11',
        label: 'Child 5–11 years',
        respiration: { min: 18, max: 30 },
        pulse: { min: 70, max: 120 },
        systolic: { min: 90, max: 120 },
        oxygenSaturationMin: 94,
    },
    '12to17': {
        band: '12to17',
        label: 'Adolescent 12–17 years',
        respiration: { min: 12, max: 24 },
        pulse: { min: 60, max: 100 },
        systolic: { min: 100, max: 130 },
        oxygenSaturationMin: 94,
        adultScoringFrom: 12,
    },
    adult: {
        band: 'adult',
        label: 'Adult 18 years and over',
        respiration: { min: 12, max: 20 },
        pulse: { min: 51, max: 90 },
        systolic: { min: 111, max: 219 },
        oxygenSaturationMin: 96,
    },
};

/** Age in whole years → band. An unknown age is treated as an adult. */
export function bandForAge(
    ageYears: number | string | null | undefined,
): AgeBand {
    // `Number(null)` is 0, which would quietly put every patient without a
    // recorded date of birth on the *infant* bands — a normal adult pulse of 76
    // then reads as bradycardia (infant range 100-160) and the whole department
    // gets flagged. Absence of an age is not age zero.
    if (
        ageYears === null ||
        ageYears === undefined ||
        (ageYears as unknown) === ''
    )
        return 'adult';

    const age = Number(ageYears);
    if (!Number.isFinite(age) || age < 0) return 'adult';
    if (age < 1) return 'under1';
    if (age < 5) return '1to4';
    if (age < 12) return '5to11';
    if (age < 18) return '12to17';
    return 'adult';
}

/** True when this patient must be scored with band-appropriate thresholds. */
export function needsPaediatricScoring(
    ageYears: number | null | undefined,
): boolean {
    return bandForAge(ageYears) !== 'adult';
}

export interface BandedObservationFlags {
    band: AgeBand;
    /** Observations outside the band's range, e.g. "respirations 8 (normal 30–53)". */
    abnormal: string[];
    /** Observations that are only reassuring because of the patient's age. */
    reassuringForAge: string[];
}

/**
 * Compare observations against the patient's band.
 *
 * `reassuringForAge` exists to stop over-triage in the other direction: an
 * infant with a pulse of 130 and 40 breaths a minute is normal, and a triage
 * system that scores that as deterioration will be ignored by the people using
 * it, which is worse than no score at all.
 */
export function bandedObservations(
    vitals:
        | {
              respiration?: number | string | null;
              oxygen_saturation?: number | string | null;
              pulse?: number | string | null;
              bps?: number | string | null;
          }
        | null
        | undefined,
    ageYears: number | string | null | undefined,
): BandedObservationFlags {
    const band = bandForAge(ageYears);
    const range = PAEDIATRIC_BANDS[band];
    const abnormal: string[] = [];
    const reassuringForAge: string[] = [];

    const value = (v: unknown): number | null => {
        if (v === null || v === undefined || v === '') return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    };

    const check = (
        label: string,
        raw: unknown,
        limits: { min: number; max: number },
        runsHighInChildren = false,
    ) => {
        const v = value(raw);
        if (v === null) return;
        if (v < limits.min || v > limits.max) {
            abnormal.push(
                `${label} ${v} (expected ${limits.min}–${limits.max} for ${range.label.toLowerCase()})`,
            );
        } else if (runsHighInChildren && band !== 'adult') {
            // A rate that would be abnormal for an adult but is normal here — worth
            // stating, so nobody "corrects" the triage note later.
            reassuringForAge.push(
                `${label} ${v} is normal for ${range.label.toLowerCase()}`,
            );
        }
    };

    // Respiration and pulse are the two that run high in small children.
    check('respirations', vitals?.respiration, range.respiration, true);
    check('pulse', vitals?.pulse, range.pulse, true);
    check('systolic', vitals?.bps, range.systolic);
    check('oxygen saturation', vitals?.oxygen_saturation, {
        min: range.oxygenSaturationMin,
        max: 100,
    });

    return { band, abnormal, reassuringForAge };
}
