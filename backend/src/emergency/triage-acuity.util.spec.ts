import {
  TRIAGE_LEVELS,
  clampLevel,
  computeNews2,
  escalationGraceMinutes,
  levelMeta,
  minutesUntilReassessment,
  missingObservations,
  nextEscalation,
  queuePriority,
  triageAcuity,
  type TriageInput,
} from './triage-acuity.util';

/**
 * Tests for the emergency triage algorithm.
 *
 * Two classes of behaviour are protected here: the clinical boundaries (who is
 * Red, who may be Blue) and the safety floor — a patient without observations
 * must never be graded non-urgent, because that is the failure mode that sends
 * somebody home from a waiting room.
 */
/** A complete, unremarkable set of adult observations. */
const normalVitals = {
  respiration: 16,
  oxygen_saturation: 98,
  temperature: 36.8,
  bps: 120,
  bpd: 78,
  pulse: 76,
  avpuAlert: true,
  painScore: 0,
};

const triage = (over: Partial<TriageInput> = {}) =>
  triageAcuity({ vitals: normalVitals, complaints: 'sore throat', resources: 0, ageYears: 30, ...over });

describe('level table (single source of truth for colour)', () => {
  it('keeps the five standard ED colours', () => {
    expect(TRIAGE_LEVELS[1].color).toBe('#dc3545');
    expect(TRIAGE_LEVELS[2].color).toBe('#fd7e14');
    expect(TRIAGE_LEVELS[3].color).toBe('#ffc107');
    expect(TRIAGE_LEVELS[4].color).toBe('#198754');
    expect(TRIAGE_LEVELS[5].color).toBe('#0dcaf0');
  });

  it('keeps the agreed targets', () => {
    expect([1, 2, 3, 4, 5].map((l) => TRIAGE_LEVELS[l as 1].targetMinutes)).toEqual([0, 10, 30, 60, 120]);
  });

  it('maps onto the acuity buckets the nursing router already uses', () => {
    expect(TRIAGE_LEVELS[1].acuity).toBe('stat');
    expect(TRIAGE_LEVELS[2].acuity).toBe('stat');
    expect(TRIAGE_LEVELS[3].acuity).toBe('urgent');
    expect(TRIAGE_LEVELS[4].acuity).toBe('routine');
    expect(TRIAGE_LEVELS[5].acuity).toBe('routine');
  });

  it('clamps out-of-range levels rather than returning nonsense', () => {
    expect(clampLevel(0)).toBe(1);
    expect(clampLevel(9)).toBe(5);
    expect(clampLevel(NaN)).toBe(1);
    expect(levelMeta(3).label).toBe('Yellow');
  });
});

describe('NEWS2', () => {
  it('scores a healthy adult at zero', () => {
    expect(computeNews2(normalVitals).total).toBe(0);
  });

  it('scores each parameter the way the RN workspace does', () => {
    expect(computeNews2({ respiration: 8 }).total).toBe(3);
    expect(computeNews2({ respiration: 22 }).total).toBe(2);
    expect(computeNews2({ oxygen_saturation: 91 }).total).toBe(3);
    expect(computeNews2({ oxygen_saturation: 96 }).total).toBe(0);
    expect(computeNews2({ onSupplementalO2: true }).total).toBe(2);
    expect(computeNews2({ temperature: 34.5 }).total).toBe(3);
    expect(computeNews2({ bps: 88 }).total).toBe(3);
    expect(computeNews2({ bps: 225 }).total).toBe(3);
    expect(computeNews2({ pulse: 135 }).total).toBe(3);
    expect(computeNews2({ avpuAlert: false }).total).toBe(3);
  });

  it('names the parameters that scored the maximum', () => {
    expect(computeNews2({ bps: 88, pulse: 39 }).criticalParameters).toEqual(['systolic_bp', 'pulse']);
  });

  it('does not invent a score from missing observations', () => {
    expect(computeNews2({}).total).toBe(0);
    expect(computeNews2(null).total).toBe(0);
  });
});

describe('stage 1 — bypass: life threats ignore the score', () => {
  it.each([
    ['cardiac arrest in the waiting room', 'cardiac arrest'],
    ['found unresponsive', 'unresponsive at home'],
    ['actively seizing', 'active seizure'],
    ['throat closing after a bee sting', 'throat closing, anaphylaxis suspected'],
    ['major haemorrhage', 'severe bleeding from a stab wound'],
    ['FAST positive', 'sudden facial droop and slurred speech'],
  ])('grades "%s" as level 1', (_label, complaint) => {
    const r = triage({ complaints: complaint, resources: 0 });
    expect(r.level).toBe(1);
    expect(r.color).toBe('#dc3545');
    expect(r.targetMinutes).toBe(0);
    expect(r.bypass.length).toBeGreaterThan(0);
  });

  it('bypasses on desaturation despite oxygen even with a quiet complaint', () => {
    const r = triage({
      complaints: 'feels a bit tired',
      vitals: { ...normalVitals, oxygen_saturation: 88, onSupplementalO2: true },
    });
    expect(r.level).toBe(1);
    expect(r.bypass.join(' ')).toMatch(/below 90%/i);
  });

  it('does not bypass on a word that merely contains a red flag', () => {
    // "shocked" is not shock; a boundary-blind matcher would over-triage this.
    const r = triage({ complaints: 'shocked by the bill', resources: 0 });
    expect(r.level).toBeGreaterThan(1);
  });
});

describe('stage 2 — physiology', () => {
  it('grades a high NEWS2 as level 2', () => {
    const r = triage({ vitals: { ...normalVitals, respiration: 26, oxygen_saturation: 93 }, resources: 0 });
    expect(r.news2).toBeGreaterThanOrEqual(5);
    expect(r.level).toBe(2);
  });

  it('grades a single maximum NEWS2 parameter as level 2', () => {
    const r = triage({ vitals: { ...normalVitals, bps: 86 }, resources: 0 });
    expect(r.level).toBe(2);
    expect(r.reasons.join(' ')).toMatch(/parameter at maximum/i);
  });

  it('grades a raised shock index as level 2', () => {
    const r = triage({ vitals: { ...normalVitals, pulse: 118, bps: 118 }, resources: 0 });
    expect(r.shockIndex).toBeGreaterThanOrEqual(0.9);
    expect(r.level).toBe(2);
  });

  it('grades a mild NEWS2 as level 3 when work-up is needed', () => {
    const r = triage({ vitals: { ...normalVitals, respiration: 22 }, resources: 2 });
    expect(r.news2).toBe(2);
    expect(r.level).toBe(3);
    expect(r.score).toBeGreaterThan(0);
  });

  it('will not call a patient non-urgent while any observation is abnormal', () => {
    // A low-grade fever with otherwise normal observations and no predicted
    // work-up: level 5 would mean "nothing needs doing", which is not true.
    const r = triage({ vitals: { ...normalVitals, temperature: 38.5 }, resources: 0 });
    expect(r.news2).toBe(1);
    expect(r.level).toBe(4);
    expect(r.reasons.join(' ')).toMatch(/outside its normal range/i);
  });
});

describe('stage 4 — resource prediction decides 3 / 4 / 5', () => {
  it('level 3 when two or more resources are expected', () => {
    expect(triage({ resources: 3 }).level).toBe(3);
  });

  it('level 4 for a single resource', () => {
    expect(triage({ resources: 1 }).level).toBe(4);
  });

  it('level 5 only when nothing is expected', () => {
    const r = triage({ resources: 0 });
    expect(r.level).toBe(5);
    expect(r.color).toBe('#0dcaf0');
  });

  it('never calls an unassessed patient non-urgent', () => {
    expect(triage({ resources: null }).level).toBe(3);
    expect(triage({ resources: undefined }).level).toBe(3);
  });
});

describe('stage 3 — high-risk modifiers cannot be outvoted by good numbers', () => {
  it.each([
    ['chest pain', { complaints: 'chest pain' }],
    ['difficulty breathing', { complaints: 'shortness of breath' }],
    ['possible sepsis', { complaints: 'fever and rigors' }],
    ['altered mental state', { complaints: 'confused since this morning' }],
    ['suicidal ideation', { complaints: 'suicidal thoughts' }],
    ['overdose', { complaints: 'took an overdose' }],
    ['significant trauma', { complaints: 'stab wound to the arm' }],
    ['age 70', { ageYears: 70 }],
    ['age under 1', { ageYears: 0 }],
    ['pregnancy beyond 20 weeks', { pregnant: true, gestationalWeeks: 28 }],
    ['pregnancy of unknown gestation', { pregnant: true, gestationalWeeks: null }],
    ['high midwife risk score', { midwifeRiskLevel: 'high' as const }],
    ['immunocompromised', { immunocompromised: true }],
    ['anticoagulated', { anticoagulated: true }],
    ['sickle cell disease', { sickleCell: true }],
    ['not fully alert', { vitals: { ...normalVitals, avpuAlert: false } }],
    ['severe pain', { vitals: { ...normalVitals, painScore: 9 } }],
  ])('never grades %s below level 2', (_label, over) => {
    const r = triage(over as Partial<TriageInput>);
    expect(r.level).toBeLessThanOrEqual(2);
    expect(r.modifiers.length).toBeGreaterThan(0);
  });

  it('treats early pregnancy as a note rather than an escalation', () => {
    const r = triage({ pregnant: true, gestationalWeeks: 8, resources: 1 });
    expect(r.level).toBe(4);
    expect(r.modifiers).toContain('pregnant at 8 weeks');
  });

  it('escalates moderate pain only to level 3', () => {
    const r = triage({ vitals: { ...normalVitals, painScore: 5 }, resources: 0 });
    expect(r.level).toBe(3);
  });

  it('flags a positive sepsis screen from vitals alone', () => {
    const r = triage({
      complaints: 'feels unwell',
      vitals: { ...normalVitals, respiration: 24, bps: 96, temperature: 38.4 },
      resources: 1,
    });
    expect(r.modifiers.join(' ')).toMatch(/sepsis screen positive/i);
    expect(r.level).toBeLessThanOrEqual(2);
  });
});


describe('safety floor — unknowns are never reassuring', () => {
  it('cannot be graded 4 or 5 without a full set of observations', () => {
    expect(triage({ vitals: { painScore: 0 }, resources: 0 }).level).toBe(3);
    expect(triage({ vitals: null, resources: 0 }).level).toBe(3);
  });

  it('reports exactly which observations are missing', () => {
    expect(missingObservations({ respiration: 16, pulse: 70 })).toEqual([
      'oxygen_saturation',
      'temperature',
      'bps',
    ]);
    expect(missingObservations(null).length).toBe(5);
  });

  it('marks the assessment as needing vitals and says why', () => {
    const r = triage({ vitals: { respiration: 16 }, resources: 0 });
    expect(r.needsVitals).toBe(true);
    expect(r.reasons.join(' ')).toMatch(/observations incomplete/i);
  });

  it('still lets a complete set reach level 5', () => {
    const r = triage({ resources: 0, vitals: { ...normalVitals, painScore: 0 } });
    expect(r.needsVitals).toBe(false);
    expect(r.level).toBe(5);
  });

  it('floors at 3 even when every modifier argues for less', () => {
    const r = triage({ resources: 0, vitals: { painScore: 0, avpuAlert: true } });
    expect(r.level).toBe(3);
  });
});

describe('stage 5 — trend against the previous set', () => {
  it('escalates one level when NEWS2 has risen by two or more', () => {
    const r = triage({
      resources: 2,
      vitals: { ...normalVitals, respiration: 22, oxygen_saturation: 94 },
      prior: { news2: 1, bps: 120 },
    });
    expect(r.trendEscalated).toBe(true);
    expect(r.level).toBe(2);
    expect(r.reasons.join(' ')).toMatch(/deterioration/i);
  });

  it('escalates on a 20 mmHg systolic fall', () => {
    const r = triage({ resources: 1, vitals: { ...normalVitals, bps: 105 }, prior: { bps: 128, news2: 0 } });
    expect(r.trendEscalated).toBe(true);
    expect(r.level).toBe(3);
  });

  it('does not escalate on a stable or improving trend', () => {
    const r = triage({ resources: 1, prior: { news2: 0, bps: 118 } });
    expect(r.trendEscalated).toBe(false);
    expect(r.level).toBe(4);
  });

  it('never escalates past level 1', () => {
    const r = triage({ vitals: { ...normalVitals, bps: 100 }, resources: 2, prior: { bps: 150, news2: 4 } });
    expect(r.level).toBeGreaterThanOrEqual(1);
  });
});

describe('score and reasons', () => {
  it('always explains itself in plain English', () => {
    const r = triage({ complaints: 'chest pain', resources: 2 });
    expect(r.reasons.length).toBeGreaterThan(0);
    expect(r.reasons.join(' ')).not.toMatch(/undefined|NaN/);
    expect(r.meaning).toBeTruthy();
  });

  it('orders severity Red > Orange > Yellow > Green > Blue', () => {
    const scores = [1, 2, 3, 4, 5].map((l) => triage({ resources: 0, vitals: { ...normalVitals, bps: 200 } , ageYears: 70 }).score);
    expect(scores[0]).toBeGreaterThanOrEqual(scores[4]);
    const red = triage({ complaints: 'cardiac arrest' }).score;
    const blue = triage({ resources: 0 }).score;
    expect(red).toBeGreaterThan(blue);
  });
});

describe('queue priority', () => {
  it('puts a sicker patient ahead of a well one who waited longer', () => {
    const red = queuePriority({ level: 2, elapsedMinutes: 1 });
    const blue = queuePriority({ level: 5, elapsedMinutes: 100 });
    expect(red).toBeGreaterThan(blue);
  });

  it('lets a long-waiting Yellow overtake a just-arrived Yellow', () => {
    const waited = queuePriority({ level: 3, elapsedMinutes: 45 });
    const fresh = queuePriority({ level: 3, elapsedMinutes: 2 });
    expect(waited).toBeGreaterThan(fresh);
  });

  it('adds a breach bonus', () => {
    const breached = queuePriority({ level: 3, elapsedMinutes: 31 });
    const nearly = queuePriority({ level: 3, elapsedMinutes: 29 });
    expect(breached).toBeGreaterThan(nearly);
  });

  it('never lets waiting time outrank a sicker patient', () => {
    // The cap that keeps the board clinically sane: however long somebody has
    // waited, they cannot be shown ahead of a patient one level more acute.
    const overdueWell = queuePriority({ level: 3, elapsedMinutes: 600 });
    const freshSicker = queuePriority({ level: 2, elapsedMinutes: 0 });
    expect(overdueWell).toBeLessThan(freshSicker);

    const overdueBlue = queuePriority({ level: 5, elapsedMinutes: 900 });
    const freshGreen = queuePriority({ level: 4, elapsedMinutes: 0 });
    expect(overdueBlue).toBeLessThan(freshGreen);
  });
});

describe('breach escalation', () => {
  it('allows a grace of a quarter of the target, with a five-minute floor', () => {
    expect(escalationGraceMinutes(0)).toBe(5);
    expect(escalationGraceMinutes(10)).toBe(5);
    expect(escalationGraceMinutes(30)).toBe(8);
    expect(escalationGraceMinutes(120)).toBe(30);
  });

  it('escalates a patient who waited past the target plus grace', () => {
    const d = nextEscalation({ level: 3, targetMinutes: 30, elapsedMinutes: 40 });
    expect(d.escalate).toBe(true);
    expect(d.level).toBe(2);
    expect(d.reason).toMatch(/30 min target/);
  });

  it('leaves a patient inside the grace alone', () => {
    expect(nextEscalation({ level: 3, targetMinutes: 30, elapsedMinutes: 35 }).escalate).toBe(false);
  });

  it('does not escalate a level 1 patient or one already escalated', () => {
    expect(nextEscalation({ level: 1, targetMinutes: 0, elapsedMinutes: 90 }).escalate).toBe(false);
    expect(nextEscalation({ level: 2, targetMinutes: 10, elapsedMinutes: 60 }, true).escalate).toBe(false);
  });
});

describe('reassessment countdown', () => {
  it('uses the level cadence', () => {
    expect(minutesUntilReassessment(2, 0)).toBe(15);
    expect(minutesUntilReassessment(3, 20)).toBe(10);
    expect(minutesUntilReassessment(4, 60)).toBe(0);
  });

  it('gives continuous monitoring a 15-minute floor instead of never chasing it', () => {
    // A patient escalated to Red is the one most in need of re-observing, so
    // "continuous" must still produce a due time rather than an exemption.
    expect(minutesUntilReassessment(1, 0)).toBe(15);
    expect(minutesUntilReassessment(1, 14)).toBe(1);
    expect(minutesUntilReassessment(1, 15)).toBe(0);
    expect(minutesUntilReassessment(1, 120)).toBe(0);
  });
});

