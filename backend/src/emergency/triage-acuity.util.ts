/**
 * Emergency triage acuity — pure, database-free.
 *
 * Five-stage algorithm, ESI-anchored (Emergency Severity Index v4) with the
 * NEWS2 early-warning score (already used by the RN workspace) as its
 * physiological input:
 *
 *   1. bypass      — immediate life threats, no scoring at all
 *   2. physiology  — NEWS2, shock index, sepsis screen
 *   3. modifiers   — high-risk situations that override a mild score
 *   4. resources   — how much work this presentation will need (the ESI question)
 *   5. trend       — deterioration against the previous set of observations
 *
 * Design rules, in the order they matter:
 *  - **Over-triage beats under-triage.** Every uncertainty resolves upward.
 *  - **Missing data is never reassuring.** Without a full set of observations a
 *    patient cannot be graded 4 or 5, and without a resource estimate they
 *    cannot be graded 5 — the level is floored instead of defaulted to zero.
 *  - **Escalation is automatic, de-escalation is a clinical decision** (see
 *    `nextReassessment` / the override endpoint in the service).
 *  - The algorithm *advises*; a human assigns the final level and every
 *    override is recorded so agreement can be measured.
 */

export type TriageLevel = 1 | 2 | 3 | 4 | 5;

/** The acuity bucket the nursing router already understands. */
export type NursingAcuity = 'routine' | 'urgent' | 'stat';

export interface TriageLevelMeta {
    level: TriageLevel;
    /** Standard ED triage colour. Single source of truth for the whole app. */
    color: string;
    label: string;
    meaning: string;
    /** Minutes a patient at this level should wait at most before being seen. */
    targetMinutes: number;
    /** How often observations must be repeated while waiting. */
    reassessMinutes: number;
    acuity: NursingAcuity;
}

/**
 * 1 red → 5 blue. Targets and reassessment intervals are the ones the clinical
 * team signed off; changing them here changes them everywhere.
 */
export const TRIAGE_LEVELS: Record<TriageLevel, TriageLevelMeta> = {
    1: {
        level: 1,
        color: '#dc3545',
        label: 'Red',
        meaning: 'Resuscitation — immediate',
        targetMinutes: 0,
        reassessMinutes: 0,
        acuity: 'stat',
    },
    2: {
        level: 2,
        color: '#fd7e14',
        label: 'Orange',
        meaning: 'Emergent — cannot wait',
        targetMinutes: 10,
        reassessMinutes: 15,
        acuity: 'stat',
    },
    3: {
        level: 3,
        color: '#ffc107',
        label: 'Yellow',
        meaning: 'Urgent — stable, needs work-up',
        targetMinutes: 30,
        reassessMinutes: 30,
        acuity: 'urgent',
    },
    4: {
        level: 4,
        color: '#198754',
        label: 'Green',
        meaning: 'Less urgent — one resource',
        targetMinutes: 60,
        reassessMinutes: 60,
        acuity: 'routine',
    },
    5: {
        level: 5,
        color: '#0dcaf0',
        label: 'Blue',
        meaning: 'Non-urgent — no resources',
        targetMinutes: 120,
        reassessMinutes: 60,
        acuity: 'routine',
    },
};

export function levelMeta(level: TriageLevel): TriageLevelMeta {
    return TRIAGE_LEVELS[level] || TRIAGE_LEVELS[3];
}

/** Clamp any number into the 1..5 band. */
export function clampLevel(level: number): TriageLevel {
    const n = Math.round(Number(level));
    if (!Number.isFinite(n) || n <= 1) return 1;
    if (n >= 5) return 5;
    return n as TriageLevel;
}

export interface TriageVitals {
    respiration?: number | string | null;
    oxygen_saturation?: number | string | null;
    onSupplementalO2?: boolean;
    temperature?: number | string | null;
    /** Systolic blood pressure. */
    bps?: number | string | null;
    bpd?: number | string | null;
    pulse?: number | string | null;
    /** false = not fully alert on AVPU. */
    avpuAlert?: boolean | null;
    painScore?: number | null;
}

const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

/**
 * NEWS2 — National Early Warning Score 2.
 *
 * Mirrors the frontend implementation in `utils/nursingSafety.ts` band for band,
 * so the RN workspace, the chart and triage never disagree about the same
 * observations. Validated for adults; paediatric patients are scored by
 * `computeBandedScore` instead (see pediatric-vitals.util.ts).
 */
export function computeNews2(v: TriageVitals | null | undefined): {
    total: number;
    /** Parameters individually scoring the maximum 3. */
    criticalParameters: string[];
} {
    const total = { value: 0 };
    const criticalParameters: string[] = [];
    if (!v) return { total: 0, criticalParameters };

    const add = (points: number, name: string) => {
        total.value += points;
        if (points >= 3) criticalParameters.push(name);
    };

    const resp = num(v.respiration);
    if (resp !== null)
        add(
            resp <= 8
                ? 3
                : resp <= 11
                  ? 1
                  : resp <= 20
                    ? 0
                    : resp <= 24
                      ? 2
                      : 3,
            'respiration',
        );

    const spo2 = num(v.oxygen_saturation);
    if (spo2 !== null)
        add(
            spo2 <= 91 ? 3 : spo2 <= 93 ? 2 : spo2 <= 95 ? 1 : 0,
            'oxygen_saturation',
        );
    if (v.onSupplementalO2) total.value += 2;

    const temp = num(v.temperature);
    if (temp !== null)
        add(
            temp <= 35
                ? 3
                : temp <= 36
                  ? 1
                  : temp <= 38
                    ? 0
                    : temp <= 39
                      ? 1
                      : 2,
            'temperature',
        );

    const sbp = num(v.bps);
    if (sbp !== null)
        add(
            sbp <= 90
                ? 3
                : sbp <= 100
                  ? 2
                  : sbp <= 110
                    ? 1
                    : sbp >= 220
                      ? 3
                      : 0,
            'systolic_bp',
        );

    const pulse = num(v.pulse);
    if (pulse !== null) {
        add(
            pulse <= 40
                ? 3
                : pulse <= 50
                  ? 1
                  : pulse <= 90
                    ? 0
                    : pulse <= 110
                      ? 1
                      : pulse <= 130
                        ? 2
                        : 3,
            'pulse',
        );
    }

    if (v.avpuAlert === false) add(3, 'consciousness');

    return { total: total.value, criticalParameters };
}

/**
 * Immediate life threats. Word-boundary matched against the presenting
 * complaint; these bypass scoring entirely and go straight to level 1 — the
 * score is irrelevant when the patient is already arresting.
 */
const RED_FLAG_PATTERNS: { code: string; label: string; re: RegExp }[] = [
    {
        code: 'ARREST',
        label: 'cardiac or respiratory arrest',
        re: /\b(cardiac arrest|respiratory arrest|no pulse|not breathing|apnoea|apnea|asystole)\b/i,
    },
    {
        code: 'UNRESPONSIVE',
        label: 'unresponsive',
        re: /\b(unresponsive|unconscious|not responding|coma|gcs\s*[3-8]\b)\b/i,
    },
    {
        code: 'SEIZURE',
        label: 'active seizure',
        re: /\b(status epilepticus|active seizure|seizing|convulsing)\b/i,
    },
    {
        code: 'ANAPHYLAXIS',
        label: 'anaphylaxis',
        re: /\b(anaphyla\w*|airway swelling|throat closing)\b/i,
    },
    {
        code: 'HEMORRHAGE',
        label: 'major haemorrhage',
        re: /\b(severe bleeding|major h\w*morrhage|massive bleed|haemorrhage|hemorrhage|exsanguinat\w*)\b/i,
    },
    {
        code: 'STROKE',
        label: 'stroke symptoms (FAST positive)',
        re: /\b(stroke|fast positive|facial droop|hemiplegia|slurred speech|cva)\b/i,
    },
    {
        code: 'SHOCK',
        label: 'shock',
        re: /\b(signs of shock|hypovolemic shock|septic shock|shock)\b/i,
    },
];

/**
 * High-risk situations that make a patient "cannot wait" even when the numbers
 * look acceptable — the presentations ESI places at level 2 on sight alone.
 */
const HIGH_RISK_PATTERNS: { code: string; label: string; re: RegExp }[] = [
    {
        code: 'CHEST_PAIN',
        label: 'chest pain',
        re: /\b(chest pain|crushing chest|chest tightness|angina)\b/i,
    },
    {
        code: 'BREATHLESS',
        label: 'difficulty breathing',
        re: /\b(short\w* of breath|difficulty breathing|dyspnoea|dyspnea|respiratory distress|wheez\w*|cannot breathe)\b/i,
    },
    {
        code: 'SEPSIS',
        label: 'possible sepsis',
        re: /\b(sepsis|septic|rigors)\b/i,
    },
    {
        code: 'MENTAL_STATE',
        label: 'altered mental state',
        re: /\b(confus\w*|altered mental|disorient\w*|lethargic|drowsy)\b/i,
    },
    {
        code: 'SELF_HARM',
        label: 'suicidal ideation, overdose or poisoning',
        re: /\b(suicid\w*|self.?harm|overdose|ingestion|poison\w*)\b/i,
    },
    {
        code: 'OBSTETRIC',
        label: 'obstetric emergency',
        re: /\b(antepartum h\w*morrhage|placental abruption|eclampsia|pre.?eclampsia|cord prolapse)\b/i,
    },
    {
        code: 'TRAUMA',
        label: 'significant trauma',
        re: /\b(major trauma|road traffic|stab|gunshot|penetrating|head injury)\b/i,
    },
];

function matchPatterns(
    text: string,
    patterns: { label: string; re: RegExp }[],
): string[] {
    return patterns.filter((p) => p.re.test(text)).map((p) => p.label);
}

export interface PriorObservations {
    news2?: number | null;
    bps?: number | null;
    level?: TriageLevel | null;
}

export interface TriageInput {
    vitals?: TriageVitals | null;
    /** Presenting complaint / triage note, used for red flags and modifiers. */
    complaints?: string | string[] | null;
    ageYears?: number | null;
    pregnant?: boolean;
    gestationalWeeks?: number | null;
    immunocompromised?: boolean;
    anticoagulated?: boolean;
    sickleCell?: boolean;
    /** Last structured midwife risk level, when the chart has one. */
    midwifeRiskLevel?: 'low' | 'moderate' | 'high' | null;
    /**
     * Predicted number of resources (labs, imaging, IV, ECG, consult...).
     * `null` means "not assessed" and floors the level at 3 — never assume zero.
     */
    resources?: number | null;
    prior?: PriorObservations | null;
}

export interface TriageAssessment {
    level: TriageLevel;
    color: string;
    label: string;
    meaning: string;
    targetMinutes: number;
    reassessMinutes: number;
    acuity: NursingAcuity;
    /** 0..100, for ranking and display. Higher = sicker. */
    score: number;
    news2: number;
    shockIndex: number | null;
    /** Life threats that forced level 1. */
    bypass: string[];
    modifiers: string[];
    /** Plain-English reasons, shown to the clinician who assigns the level. */
    reasons: string[];
    /** True when observations were incomplete and the level was floored. */
    needsVitals: boolean;
    trendEscalated: boolean;
}

/** Observations that must be present before a patient can be called non-urgent. */
export const REQUIRED_OBSERVATIONS = [
    'respiration',
    'oxygen_saturation',
    'temperature',
    'bps',
    'pulse',
] as const;

export function missingObservations(
    v: TriageVitals | null | undefined,
): string[] {
    if (!v) return [...REQUIRED_OBSERVATIONS];
    return REQUIRED_OBSERVATIONS.filter(
        (key) => num((v as Record<string, unknown>)[key]) === null,
    );
}

/**
 * Score a presentation and assign a triage level.
 *
 * Order of operations is deliberate: life threats short-circuit everything, and
 * after that the level can only be pushed *up* (lower number) by modifiers —
 * never pulled down by a reassuring number.
 */
export function triageAcuity(input: TriageInput): TriageAssessment {
    const vitals = input.vitals || null;
    const text = Array.isArray(input.complaints)
        ? input.complaints.join(' ')
        : String(input.complaints || '');

    const { total: news2, criticalParameters } = computeNews2(vitals);
    const missing = missingObservations(vitals);
    const reasons: string[] = [];
    const modifiers: string[] = [];

    // ── Stage 1: bypass ──────────────────────────────────────────
    const bypass = matchPatterns(text, RED_FLAG_PATTERNS);
    const spo2 = num(vitals?.oxygen_saturation);
    const onO2 = vitals?.onSupplementalO2 === true;
    if (onO2 && spo2 !== null && spo2 < 90)
        bypass.push('oxygen saturation below 90% despite oxygen');

    const bp = num(vitals?.bps);
    const pulse = num(vitals?.pulse);
    const shockIndex = bp && pulse ? Number((pulse / bp).toFixed(2)) : null;

    if (bypass.length) {
        return finish(1, {
            news2,
            shockIndex,
            bypass,
            modifiers,
            reasons: [`Life threat on presentation: ${bypass.join(', ')}.`],
            needsVitals: missing.length > 0,
            trendEscalated: false,
        });
    }

    // ── Stage 2 (physiology) and stage 4 (resources) ─────────────
    let level: TriageLevel = 5;
    if (news2 >= 5) {
        level = 2;
        reasons.push(`NEWS2 ${news2} — high early-warning score.`);
    } else if (criticalParameters.length) {
        level = 2;
        reasons.push(
            `NEWS2 parameter at maximum (${criticalParameters.join(', ')}).`,
        );
    } else if (shockIndex !== null && shockIndex >= 0.9) {
        level = 2;
        reasons.push(`Shock index ${shockIndex} (pulse divided by systolic).`);
    } else if (news2 >= 3) {
        level = 3;
        reasons.push(`NEWS2 ${news2} — needs work-up and monitoring.`);
    } else if (news2 >= 1) {
        // Some observation is abnormal, so this cannot be "non-urgent" — the
        // resource prediction decides between 3 and 4, never 5.
        level = resourcesToLevel(input.resources, 4);
        reasons.push(
            `NEWS2 ${news2} — an observation is outside its normal range.`,
        );
        reasons.push(resourceReason(input.resources));
    } else {
        level = resourcesToLevel(input.resources, 5);
        reasons.push(resourceReason(input.resources));
    }

    // ── Stage 3: high-risk modifiers ─────────────────────────────
    const highRisk = matchPatterns(text, HIGH_RISK_PATTERNS);
    if (highRisk.length) {
        modifiers.push(...highRisk);
        level = floorLevel(level, 2);
    }

    const age = num(input.ageYears);
    if (age !== null && age >= 65) {
        modifiers.push('age 65 or over');
        level = floorLevel(level, 2);
    }
    if (age !== null && age < 1) {
        modifiers.push('infant under 1 year');
        level = floorLevel(level, 2);
    }

    if (input.pregnant) {
        const weeks = num(input.gestationalWeeks);
        if (weeks === null || weeks >= 20) {
            modifiers.push(
                weeks === null ? 'pregnant' : `pregnant at ${weeks} weeks`,
            );
            level = floorLevel(level, 2);
        } else {
            modifiers.push(`pregnant at ${weeks} weeks`);
        }
    }
    if (input.midwifeRiskLevel === 'high') {
        modifiers.push('midwife risk score high');
        level = floorLevel(level, 2);
    }
    if (input.immunocompromised) {
        modifiers.push('immunocompromised');
        level = floorLevel(level, 2);
    }
    if (input.anticoagulated) {
        modifiers.push('anticoagulated');
        level = floorLevel(level, 2);
    }
    if (input.sickleCell) {
        modifiers.push('sickle cell disease');
        level = floorLevel(level, 2);
    }
    if (vitals?.avpuAlert === false) {
        modifiers.push('not fully alert (AVPU)');
        level = floorLevel(level, 2);
    }

    // Sepsis screen: two qSOFA-style criteria, or one criterion plus fever.
    const sepsisCriteria: string[] = [];
    const resp = num(vitals?.respiration);
    if (resp !== null && resp >= 22)
        sepsisCriteria.push('respirations 22 or more');
    if (bp !== null && bp <= 100) sepsisCriteria.push('systolic 100 or less');
    if (vitals?.avpuAlert === false) sepsisCriteria.push('altered mentation');
    const febrile = (num(vitals?.temperature) ?? 0) >= 38;
    if (sepsisCriteria.length >= 2 || (febrile && sepsisCriteria.length >= 1)) {
        modifiers.push(`sepsis screen positive (${sepsisCriteria.join(', ')})`);
        level = floorLevel(level, 2);
    }

    const pain = num(vitals?.painScore);
    if (pain !== null && pain >= 7) {
        modifiers.push(`severe pain ${pain}/10`);
        level = floorLevel(level, 2);
    } else if (pain !== null && pain >= 4) {
        modifiers.push(`moderate pain ${pain}/10`);
        level = floorLevel(level, 3);
    }

    // ── Safety floor: unknowns are never reassuring ──────────────
    const needsVitals = missing.length > 0;
    if (needsVitals) {
        level = floorLevel(level, 3);
        reasons.push(
            `Observations incomplete (${missing.join(', ')}) — cannot be graded non-urgent.`,
        );
    }

    // ── Stage 5: trend against the previous set ──────────────────
    let trendEscalated = false;
    const priorNews2 = num(input.prior?.news2);
    const priorBps = num(input.prior?.bps);
    if (priorNews2 !== null && news2 - priorNews2 >= 2) {
        level = clampLevel(level - 1);
        trendEscalated = true;
        reasons.push(
            `NEWS2 rose from ${priorNews2} to ${news2} since the last set — deterioration.`,
        );
    } else if (priorBps !== null && bp !== null && priorBps - bp >= 20) {
        level = clampLevel(level - 1);
        trendEscalated = true;
        reasons.push(
            `Systolic fell from ${priorBps} to ${bp} since the last set — deterioration.`,
        );
    }

    return finish(level, {
        news2,
        shockIndex,
        bypass,
        modifiers,
        reasons,
        needsVitals,
        trendEscalated,
    });
}

/** Push a level up (lower number) to at least `atMost`. */
function floorLevel(level: TriageLevel, atMost: TriageLevel): TriageLevel {
    return clampLevel(Math.min(level, atMost));
}

/**
 * The ESI resource question: no resources → can wait (up to `wellLevel`), one
 * resource → less urgent, two or more → needs work-up. An unassessed resource
 * count is treated as "needs work-up" rather than "needs nothing".
 */
function resourcesToLevel(
    resources: number | null | undefined,
    wellLevel: TriageLevel,
): TriageLevel {
    if (resources === null || resources === undefined) return 3;
    if (resources >= 2) return 3;
    if (resources === 1) return clampLevel(Math.min(4, wellLevel));
    return wellLevel;
}

function resourceReason(resources: number | null | undefined): string {
    if (resources === null || resources === undefined)
        return 'Resource need not assessed yet, so graded as needing work-up.';
    if (resources >= 2)
        return `${resources} resources predicted — multiple investigations.`;
    if (resources === 1) return '1 resource predicted.';
    return 'No resources predicted.';
}

function finish(
    level: TriageLevel,
    parts: Omit<
        TriageAssessment,
        | 'level'
        | 'color'
        | 'label'
        | 'meaning'
        | 'targetMinutes'
        | 'reassessMinutes'
        | 'acuity'
        | 'score'
    >,
): TriageAssessment {
    const meta = levelMeta(level);
    // Severity 0..100 for ranking and display: the level dominates, physiology
    // breaks ties so two Yellow patients are still ordered sensibly.
    const score = Math.max(
        0,
        Math.min(
            100,
            Math.round(
                (6 - level) * 18 +
                    Math.min(parts.news2, 10) * 1.5 +
                    (parts.bypass.length ? 6 : 0),
            ),
        ),
    );
    return {
        level,
        color: meta.color,
        label: meta.label,
        meaning: meta.meaning,
        targetMinutes: meta.targetMinutes,
        reassessMinutes: meta.reassessMinutes,
        acuity: meta.acuity,
        score,
        ...parts,
    };
}

// ── Queue behaviour ────────────────────────────────────────────

export interface WaitingVisit {
    level: TriageLevel;
    /** Minutes since arrival. */
    elapsedMinutes: number;
}

/**
 * Sort score for the waiting room: the sickest patient first, and among equals
 * the one who has waited longest relative to their own target.
 *
 * The waiting term is deliberately capped below one acuity band (20 points), so
 * it can only ever order patients *within* a level. Without that cap a
 * 40-minute-overdue Yellow outscores a just-arrived Orange, and the board starts
 * recommending that the sicker patient waits — a neglected patient is raised by
 * `nextEscalation`, which changes their level and pages someone, not by quietly
 * out-ranking somebody who is in more danger.
 */
export function queuePriority(visit: WaitingVisit): number {
    const meta = levelMeta(visit.level);
    const elapsed = Math.max(0, Number(visit.elapsedMinutes) || 0);
    const target = Math.max(1, meta.targetMinutes || 1);
    const waitPressure = Math.min(elapsed / target, 2); // capped at 2x the target
    const breached = meta.targetMinutes > 0 && elapsed > meta.targetMinutes;

    // waitPressure * 7 (max 14) + breach (5) = 19 < 20, so acuity always leads.
    return Math.round(
        (6 - visit.level) * 20 + waitPressure * 7 + (breached ? 5 : 0),
    );
}

/**
 * Grace before a breached target becomes an escalation: a quarter of the target
 * again, with a five-minute floor so a 10-minute target is not chased at 11.
 */
export function escalationGraceMinutes(targetMinutes: number): number {
    const target = Math.max(0, Number(targetMinutes) || 0);
    return Math.max(5, Math.round(target * 0.25));
}

export interface EscalationDecision {
    escalate: boolean;
    /** The level to move to (never above 1). */
    level: TriageLevel;
    reason: string;
}

/**
 * Has this patient waited past their target plus grace? If so they move up one
 * level — the safety net that catches a busy department, not a substitute for
 * seeing people on time.
 */
export function nextEscalation(
    visit: {
        level: TriageLevel;
        targetMinutes: number;
        elapsedMinutes: number;
    },
    alreadyEscalated = false,
): EscalationDecision {
    const grace = escalationGraceMinutes(visit.targetMinutes);
    const deadline = visit.targetMinutes + grace;

    if (visit.level === 1) {
        return {
            escalate: false,
            level: 1,
            reason: 'Already the highest acuity.',
        };
    }
    if (visit.elapsedMinutes <= deadline) {
        return {
            escalate: false,
            level: visit.level,
            reason: `Within target (${deadline} min).`,
        };
    }
    if (alreadyEscalated) {
        return {
            escalate: false,
            level: visit.level,
            reason: 'Already escalated for this visit.',
        };
    }

    const level = clampLevel(visit.level - 1);
    return {
        escalate: true,
        level,
        reason:
            `Waited ${Math.round(visit.elapsedMinutes)} min against a ${visit.targetMinutes} min target ` +
            `(${Math.round(visit.elapsedMinutes - visit.targetMinutes)} min over) — escalated to ${levelMeta(level).label}.`,
    };
}

/**
 * When the next set of observations is due, in minutes from now.
 *
 * Level 1 is "continuous monitoring" in the level table, which is not something
 * a timer can check — so it gets a 15-minute floor instead of being skipped.
 * Skipping it was a real hole: a level-2 patient who breaches is escalated to
 * Red, and they were then never chased again, when they are the patient most
 * likely to need re-observing.
 */
export const CONTINUOUS_MONITORING_FLOOR_MINUTES = 15;

export function minutesUntilReassessment(
    level: TriageLevel,
    minutesSinceLastSet: number,
): number {
    const cadence =
        levelMeta(level).reassessMinutes || CONTINUOUS_MONITORING_FLOOR_MINUTES;
    return Math.max(0, cadence - Math.max(0, minutesSinceLastSet));
}
