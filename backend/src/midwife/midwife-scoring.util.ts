/**
 * Pregnancy risk scoring, computed server-side.
 *
 * The dashboard also scores locally so the midwife sees the band immediately,
 * but the row that lands in the chart is recomputed here from the raw inputs —
 * a stored clinical score should not be whatever the browser happened to send.
 *
 * Keep in step with interface/new/src/utils/midwife.ts.
 */

export interface RiskInputs {
    age: number;
    parity: number;
    gestationWeeks: number;
    bpSystolic: number;
    bpDiastolic: number;
    hemoglobin: number;
    hasDiabetes: boolean;
    hasPreeclampsia: boolean;
}

/** One scored contribution, so the midwife can see what drove the total. */
export interface RiskFactor {
    /** Clinical wording, e.g. "Severe hypertension". */
    label: string;
    /** The reading behind it, e.g. "168/112 mmHg". */
    detail: string;
    points: number;
}

export interface RiskResult {
    score: number;
    level: 'low' | 'moderate' | 'high';
    label: string;
    /** Every factor that contributed, in the order it was scored. */
    factors: RiskFactor[];
    /** Highest reachable score, so the UI can show a true denominator. */
    maxScore: number;
}

export const EDD_GESTATION_DAYS = 280; // Naegele's rule

/** A 28-day cycle is what Naegele's rule assumes; longer cycles ovulate later. */
export const DEFAULT_CYCLE_DAYS = 28;

/**
 * Sum of the highest band in each category — the worst case is every factor
 * present at once. Kept as a constant so a new factor cannot leave the
 * denominator shown in the UI stale.
 *
 * age 5 + parity 2 + gestation 3 + BP 5 + haemoglobin 4 + diabetes 3 + PET 5
 */
export const RISK_MAX_SCORE = 27;

/**
 * LMP + 280 days, in UTC so the date cannot drift with the server timezone.
 *
 * `cycleLengthDays` corrects for cycle length: Naegele's rule assumes ovulation
 * on day 14 of a 28-day cycle, so a woman with a 35-day cycle ovulates about a
 * week later and the unadjusted date would be a week early. Defaults to 28, so
 * existing callers get exactly the previous answer.
 */
export function eddFromLmp(
    lmp: string,
    cycleLengthDays: number = DEFAULT_CYCLE_DAYS,
): string {
    const d = new Date(lmp);
    if (isNaN(d.getTime())) return '';
    const adjustment = isValidCycleLength(cycleLengthDays)
        ? cycleLengthDays - DEFAULT_CYCLE_DAYS
        : 0;
    d.setUTCDate(d.getUTCDate() + EDD_GESTATION_DAYS + adjustment);
    return d.toISOString().split('T')[0];
}

/** Cycle lengths outside 20–45 days are treated as data entry error, not fact. */
function isValidCycleLength(cycleLengthDays: number): boolean {
    return (
        Number.isFinite(cycleLengthDays) &&
        cycleLengthDays >= 20 &&
        cycleLengthDays <= 45
    );
}

export function computeRisk(inputs: RiskInputs): RiskResult {
    const factors: RiskFactor[] = [];
    const add = (label: string, detail: string, points: number) => {
        if (points > 0) factors.push({ label, detail, points });
    };

    // Age. NOTE: the bands are the clinic's existing policy and are unchanged here
    // — 18–35 scores nothing. ACOG defines advanced maternal age as 35 and over,
    // so a 35-year-old currently scores 0. Left as-is deliberately: moving the
    // boundary retriages a whole cohort and needs clinical sign-off, not a code
    // change. Highest band is tested first — the other way round >40 is unreachable.
    if (inputs.age < 18) add('Teenage pregnancy', `${inputs.age} years`, 2);
    else if (inputs.age > 40)
        add('Advanced maternal age', `${inputs.age} years`, 5);
    else if (inputs.age > 35) add('Age 36–40', `${inputs.age} years`, 3);

    if (inputs.parity === 0) add('First pregnancy', 'parity 0', 1);
    else if (inputs.parity > 4)
        add('Grand multiparity', `parity ${inputs.parity}`, 2);

    if (inputs.gestationWeeks < 28)
        add('Preterm gestation', `${inputs.gestationWeeks} weeks`, 3);
    else if (inputs.gestationWeeks > 40)
        add('Post-term gestation', `${inputs.gestationWeeks} weeks`, 2);

    // Blood pressure (ACOG thresholds).
    const bp = `${inputs.bpSystolic}/${inputs.bpDiastolic} mmHg`;
    if (inputs.bpSystolic >= 160 || inputs.bpDiastolic >= 110)
        add('Severe hypertension', bp, 5);
    else if (inputs.bpSystolic >= 140 || inputs.bpDiastolic >= 90)
        add('Hypertension', bp, 3);
    else if (inputs.bpSystolic >= 130 || inputs.bpDiastolic >= 85)
        add('Elevated blood pressure', bp, 1);

    // Anaemia (WHO severity in pregnancy).
    const hb = `${inputs.hemoglobin} g/dL`;
    if (inputs.hemoglobin < 7) add('Severe anaemia', hb, 4);
    else if (inputs.hemoglobin < 10) add('Moderate anaemia', hb, 2);
    else if (inputs.hemoglobin < 11) add('Mild anaemia', hb, 1);

    if (inputs.hasDiabetes) add('Diabetes', 'recorded', 3);
    if (inputs.hasPreeclampsia) add('Pre-eclampsia', 'recorded', 5);

    const score = factors.reduce((sum, f) => sum + f.points, 0);

    const band = (level: RiskResult['level'], label: string) => ({
        score,
        level,
        label,
        factors,
        maxScore: RISK_MAX_SCORE,
    });

    if (score <= 3) return band('low', 'Low Risk');
    if (score <= 7) return band('moderate', 'Moderate Risk');
    return band('high', 'High Risk');
}

export interface ApgarSet {
    appearance: number;
    pulse: number;
    grimace: number;
    activity: number;
    respiration: number;
}

/** APGAR total, 0–10. */
export function apgarTotal(set: ApgarSet): number {
    return (
        set.appearance +
        set.pulse +
        set.grimace +
        set.activity +
        set.respiration
    );
}

export function interpretApgar(
    total: number,
): 'Normal' | 'Moderately Depressed' | 'Severely Depressed' {
    if (total >= 7) return 'Normal';
    if (total >= 4) return 'Moderately Depressed';
    return 'Severely Depressed';
}

/**
 * What to do next, keyed to the minute the score was taken.
 *
 * The five-minute score is the one that predicts outcome, and the standard
 * practice (NRP) is to keep rescoring every 5 minutes up to 20 minutes while it
 * stays below 7. The one-minute score guides the first intervention only.
 */
export function apgarGuidance(total: number, minutes: 1 | 5): string {
    // Most urgent first: a severely depressed baby needs help now, and the note
    // about repeating the score matters less than that.
    if (total < 4) return 'Resuscitation is likely needed — call for help now.';
    if (minutes === 5 && total < 7) {
        return 'Repeat every 5 minutes up to 20 minutes and follow the resuscitation protocol.';
    }
    if (total < 7) return 'Stimulate and give assisted ventilation as needed.';
    return 'No action needed — record the 5-minute score.';
}

/** Gestational age at a point in time, for the EDD record. */
export function gestationFromLmp(
    lmp: string,
    now: Date = new Date(),
): { weeks: number; days: number } {
    const d = new Date(lmp);
    if (isNaN(d.getTime())) return { weeks: 0, days: 0 };
    const diffDays = Math.max(
        0,
        Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24)),
    );
    return { weeks: Math.floor(diffDays / 7), days: diffDays % 7 };
}
