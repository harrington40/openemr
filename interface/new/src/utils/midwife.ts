/**
 * Midwifery clinical scoring used by the midwife dashboard.
 *
 * Extracted from the page so the numbers can be unit tested — a risk score that
 * is quietly wrong changes whether a pregnancy is escalated.
 */

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
  color: string;
  label: string;
  /** Every factor that contributed, so the midwife can see what drove the total. */
  factors: RiskFactor[];
  /** Highest reachable score — the true denominator for the progress display. */
  maxScore: number;
}

/** Worst case: every factor present at its highest band. Mirrors the backend. */
export const RISK_MAX_SCORE = 27;

/** A 28-day cycle is what Naegele's rule assumes. */
export const DEFAULT_CYCLE_DAYS = 28;

/** Standard pregnancy risk scoring algorithm (modified Bishop/PARs) */
export function computeRiskScore(
  age: number,
  parity: number,
  gestationWeeks: number,
  bpSystolic: number,
  bpDiastolic: number,
  hemoglobin: number,
  hasDiabetes: boolean,
  hasPreeclampsia: boolean,
): RiskResult {
  const factors: RiskFactor[] = [];
  const add = (label: string, detail: string, points: number) => {
    if (points > 0) factors.push({ label, detail, points });
  };

  // Age risk. The higher band must be tested first: written the other way round
  // the >40 case is unreachable (anything over 40 is also over 35), so the
  // highest-risk age group would score as if it were the moderate one.
  //
  // These bands are the clinic's existing policy and are deliberately unchanged:
  // 18–35 scores nothing, so a 35-year-old scores 0 even though ACOG defines
  // advanced maternal age as 35 and over. Moving that boundary retriages a whole
  // cohort, which is a clinical decision rather than a code change.
  if (age < 18) add('Teenage pregnancy', `${age} years`, 2);
  else if (age > 40) add('Advanced maternal age', `${age} years`, 5);
  else if (age > 35) add('Age 36–40', `${age} years`, 3);

  // Parity risk
  if (parity === 0) add('First pregnancy', 'parity 0', 1);
  else if (parity > 4) add('Grand multiparity', `parity ${parity}`, 2);

  // Gestation risk
  if (gestationWeeks < 28) add('Preterm gestation', `${gestationWeeks} weeks`, 3);
  else if (gestationWeeks > 40) add('Post-term gestation', `${gestationWeeks} weeks`, 2);

  // Blood pressure (standard ACOG thresholds)
  const bp = `${bpSystolic}/${bpDiastolic} mmHg`;
  if (bpSystolic >= 160 || bpDiastolic >= 110) add('Severe hypertension', bp, 5);
  else if (bpSystolic >= 140 || bpDiastolic >= 90) add('Hypertension', bp, 3);
  else if (bpSystolic >= 130 || bpDiastolic >= 85) add('Elevated blood pressure', bp, 1);

  // Anaemia (WHO severity in pregnancy)
  const hb = `${hemoglobin} g/dL`;
  if (hemoglobin < 7) add('Severe anaemia', hb, 4);
  else if (hemoglobin < 10) add('Moderate anaemia', hb, 2);
  else if (hemoglobin < 11) add('Mild anaemia', hb, 1);

  // Comorbidities
  if (hasDiabetes) add('Diabetes', 'recorded', 3);
  if (hasPreeclampsia) add('Pre-eclampsia', 'recorded', 5);

  const score = factors.reduce((sum, f) => sum + f.points, 0);
  const maxScore = RISK_MAX_SCORE;

  if (score <= 3) return { score, level: 'low', color: '#198754', label: 'Low Risk', factors, maxScore };
  if (score <= 7) return { score, level: 'moderate', color: '#fd7e14', label: 'Moderate Risk', factors, maxScore };
  return { score, level: 'high', color: '#dc3545', label: 'High Risk', factors, maxScore };
}

export interface EddResult {
  edd: string;
  gestationWeeks: number;
  gestationDays: number;
}

/**
 * EDD calculator using Naegele's Rule (LMP + 280 days).
 *
 * `cycleLengthDays` corrects for cycle length: Naegele's rule assumes ovulation
 * on day 14 of a 28-day cycle, so a longer cycle ovulates later and the
 * unadjusted date lands early. Defaults to 28 — the previous behaviour.
 */
export function calculateEDD(
  lmpDate: string,
  now: Date = new Date(),
  cycleLengthDays: number = DEFAULT_CYCLE_DAYS,
): EddResult {
  const lmp = new Date(lmpDate);
  if (isNaN(lmp.getTime())) {
    return { edd: '', gestationWeeks: 0, gestationDays: 0 };
  }

  // Guard the input rather than trusting it: a stray keystroke in the cycle
  // field should not silently shift the due date by months.
  const adjustment =
    Number.isFinite(cycleLengthDays) && cycleLengthDays >= 20 && cycleLengthDays <= 45
      ? cycleLengthDays - DEFAULT_CYCLE_DAYS
      : 0;

  const edd = new Date(lmp);
  edd.setUTCDate(edd.getUTCDate() + 280 + adjustment);

  // An LMP in the future would otherwise report negative gestation.
  const diffMs = Math.max(0, now.getTime() - lmp.getTime());
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  return {
    edd: edd.toISOString().split('T')[0],
    gestationWeeks: Math.floor(diffDays / 7),
    gestationDays: diffDays % 7,
  };
}

/** APGAR score interpretation */
export function interpretApgar(total: number): { color: string; interpretation: string } {
  if (total >= 7) return { color: '#198754', interpretation: 'Normal' };
  if (total >= 4) return { color: '#fd7e14', interpretation: 'Moderately Depressed' };
  return { color: '#dc3545', interpretation: 'Severely Depressed — Needs Resuscitation' };
}

/**
 * What to do next, keyed to the minute the score was taken.
 *
 * The five-minute score is the one that predicts outcome, and standard practice
 * (NRP) is to keep rescoring every 5 minutes up to 20 minutes while it stays
 * below 7. The one-minute score guides the first intervention only.
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
