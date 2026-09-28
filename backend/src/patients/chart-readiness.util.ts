import { isChartComplete } from './chart-completeness.util';

/**
 * Chart readiness — a richer view than "complete / not complete".
 *
 * `isChartComplete` answers a yes/no question (used by the registrar list and the
 * yellow chart banner) and must keep behaving exactly as before. This adds a
 * weighted score so the chart can show *how far* it is from ready and what the
 * next useful action is, without changing that contract.
 *
 * Weights reflect what actually blocks a visit: you cannot prescribe or bill for
 * an unassigned patient, and you cannot assess anyone without a name and a DOB.
 * Diagnoses and allergies are deliberately NOT scored — a healthy new patient
 * legitimately has neither, and penalising that would nag clinicians forever.
 */

export interface ChartSignals {
  /** Recorded vitals sets (form_vitals). */
  vitals?: number;
  /** Clinical notes (pnotes). */
  notes?: number;
  /** Structured observations. */
  observations?: number;
  /** Documented allergies (reported, not scored). */
  allergies?: number;
  /** Diagnoses on the problem list (reported, not scored). */
  diagnoses?: number;
}

export interface ChartReadinessSection {
  key: 'identity' | 'contact' | 'assignment' | 'clinical';
  label: string;
  weight: number;
  /** Score earned, 0..weight. */
  earned: number;
  complete: boolean;
  missing: string[];
}

export interface ChartReadiness {
  /** 0-100, rounded. */
  score: number;
  /** Same meaning as `isChartComplete` — kept so callers can still gate on it. */
  complete: boolean;
  sections: ChartReadinessSection[];
  missing: string[];
  nextAction: string;
}

const WEIGHTS: Record<ChartReadinessSection['key'], number> = {
  identity: 35,
  contact: 20,
  assignment: 25,
  clinical: 20,
};

const isBlank = (value: unknown): boolean => {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  return typeof value === 'number' ? value <= 0 : false;
};

const round = (n: number) => Math.round(n * 100) / 100;

export function chartReadiness(
  patient: Record<string, any> | null | undefined,
  signals: ChartSignals = {},
): ChartReadiness {
  const p = patient || {};

  // ── Identity: who is this? ─────────────────────────────────────
  const identityFields: { key: string; label: string }[] = [
    { key: 'fname', label: 'First name' },
    { key: 'lname', label: 'Last name' },
    { key: 'DOB', label: 'Date of birth' },
    { key: 'sex', label: 'Sex' },
  ];
  const identityMissing = identityFields.filter((f) => isBlank(p[f.key])).map((f) => f.label);
  const identityEarned = round(WEIGHTS.identity * ((identityFields.length - identityMissing.length) / identityFields.length));

  // ── Contact: can we reach them? ────────────────────────────────
  const contactFields: { key: string; label: string }[] = [
    { key: 'phone_contact', label: 'Phone' },
    { key: 'street', label: 'Street' },
    { key: 'city', label: 'City' },
  ];
  const contactMissing = contactFields.filter((f) => isBlank(p[f.key])).map((f) => f.label);
  const contactEarned = round(WEIGHTS.contact * ((contactFields.length - contactMissing.length) / contactFields.length));

  // ── Assignment: a provider must own the chart (pending blocks it) ──
  const pending = p.status === 'pending';
  const noProvider = isBlank(p.providerID) && isBlank(p.provider);
  const assignmentMissing: string[] = [];
  if (pending) assignmentMissing.push('Registrar approval');
  if (noProvider) assignmentMissing.push('Assigned provider');
  const assignmentEarned = assignmentMissing.length ? 0 : WEIGHTS.assignment;

  // ── Clinical baseline: at least one objective + one narrative record ──
  const vitals = Number(signals.vitals) || 0;
  const narrative = (Number(signals.notes) || 0) + (Number(signals.observations) || 0);
  const clinicalMissing: string[] = [];
  if (!vitals) clinicalMissing.push('Vitals recording');
  if (!narrative) clinicalMissing.push('Clinical note or observation');
  const halves = (vitals ? 0.5 : 0) + (narrative ? 0.5 : 0);
  const clinicalEarned = round(WEIGHTS.clinical * halves);

  const sections: ChartReadinessSection[] = [
    {
      key: 'identity', label: 'Patient identity', weight: WEIGHTS.identity,
      earned: identityEarned, complete: identityMissing.length === 0, missing: identityMissing,
    },
    {
      key: 'contact', label: 'Contact details', weight: WEIGHTS.contact,
      earned: contactEarned, complete: contactMissing.length === 0, missing: contactMissing,
    },
    {
      key: 'assignment', label: 'Care assignment', weight: WEIGHTS.assignment,
      earned: assignmentEarned, complete: assignmentMissing.length === 0, missing: assignmentMissing,
    },
    {
      key: 'clinical', label: 'Clinical baseline', weight: WEIGHTS.clinical,
      earned: clinicalEarned, complete: clinicalMissing.length === 0, missing: clinicalMissing,
    },
  ];

  const earned = round(sections.reduce((sum, s) => sum + s.earned, 0));
  const missing = sections.flatMap((s) => s.missing);

  // One concrete next step, in the order that unblocks care fastest.
  let nextAction: string;
  if (pending) nextAction = 'Registrar must approve the chart before it can be used clinically.';
  else if (noProvider) nextAction = 'Assign a provider — the chart cannot be billed or prescribed from without one.';
  else if (identityMissing.length) nextAction = `Complete the patient identity: ${identityMissing.join(', ')}.`;
  else if (contactMissing.length) nextAction = `Add contact details: ${contactMissing.join(', ')}.`;
  else if (!vitals) nextAction = 'Record baseline vitals at the next visit.';
  else if (!narrative) nextAction = 'Document a clinical note or observation.';
  else nextAction = 'Chart is ready for a visit.';

  return {
    score: Math.max(0, Math.min(100, Math.round(earned))),
    complete: isChartComplete(patient),
    sections,
    missing,
    nextAction,
  };
}
