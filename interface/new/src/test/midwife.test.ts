import { describe, it, expect } from 'vitest';
import { computeRiskScore, calculateEDD, interpretApgar, apgarGuidance, RISK_MAX_SCORE } from '../utils/midwife';

/** Baseline: a low-risk 28-year-old at 30 weeks, normal BP and haemoglobin. */
const base = {
  age: 28, parity: 1, gestationWeeks: 30,
  bpSystolic: 120, bpDiastolic: 80, hemoglobin: 12,
  hasDiabetes: false, hasPreeclampsia: false,
};

const score = (over: Partial<typeof base> = {}) => {
  const v = { ...base, ...over };
  return computeRiskScore(
    v.age, v.parity, v.gestationWeeks,
    v.bpSystolic, v.bpDiastolic, v.hemoglobin,
    v.hasDiabetes, v.hasPreeclampsia,
  );
};

describe('computeRiskScore — age bands', () => {
  it('scores a teenager at 2', () => {
    expect(score({ age: 17 }).score).toBe(2);
  });

  it('scores 18–35 with no age points', () => {
    expect(score({ age: 18 }).score).toBe(0);
    expect(score({ age: 35 }).score).toBe(0);
  });

  it('scores over 35 at 3', () => {
    expect(score({ age: 36 }).score).toBe(3);
    expect(score({ age: 40 }).score).toBe(3);
  });

  it('scores over 40 at 5, not 3', () => {
    // Regression: the >40 branch sat after the >35 branch, so it was unreachable
    // and the highest-risk age group scored as the moderate one.
    expect(score({ age: 41 }).score).toBe(5);
    expect(score({ age: 45 }).score).toBe(5);
  });

  it('is strictly worse for over 40 than for over 35', () => {
    expect(score({ age: 42 }).score).toBeGreaterThan(score({ age: 38 }).score);
  });
});

describe('computeRiskScore — other contributions', () => {
  it('adds 1 for a first pregnancy and 2 for high parity', () => {
    expect(score({ parity: 0 }).score).toBe(1);
    expect(score({ parity: 5 }).score).toBe(2);
  });

  it('adds for early and post-term gestation', () => {
    expect(score({ gestationWeeks: 27 }).score).toBe(3);
    expect(score({ gestationWeeks: 41 }).score).toBe(2);
  });

  it('grades blood pressure on the ACOG thresholds', () => {
    expect(score({ bpSystolic: 130, bpDiastolic: 85 }).score).toBe(1);
    expect(score({ bpSystolic: 140, bpDiastolic: 90 }).score).toBe(3);
    expect(score({ bpSystolic: 160, bpDiastolic: 110 }).score).toBe(5);
  });

  it('grades anaemia', () => {
    expect(score({ hemoglobin: 10.5 }).score).toBe(1);
    expect(score({ hemoglobin: 9 }).score).toBe(2);
    expect(score({ hemoglobin: 6 }).score).toBe(4);
  });

  it('adds for diabetes and preeclampsia', () => {
    expect(score({ hasDiabetes: true }).score).toBe(3);
    expect(score({ hasPreeclampsia: true }).score).toBe(5);
  });
});

describe('computeRiskScore — bands', () => {
  it('reports low, moderate and high with a matching label', () => {
    expect(score()).toMatchObject({ score: 0, level: 'low', label: 'Low Risk' });
    expect(score({ age: 38 })).toMatchObject({ score: 3, level: 'low' });
    expect(score({ age: 38, hasDiabetes: true })).toMatchObject({ score: 6, level: 'moderate', label: 'Moderate Risk' });
    expect(score({ hasPreeclampsia: true, hasDiabetes: true })).toMatchObject({ score: 8, level: 'high', label: 'High Risk' });
  });
});

describe('calculateEDD', () => {
  it("applies Naegele's rule: LMP + 280 days", () => {
    // 1 Jan + 280 days = 8 Oct.
    expect(calculateEDD('2026-01-01').edd).toBe('2026-10-08');
  });

  it('reports gestational age from the LMP', () => {
    const now = new Date('2026-03-12T00:00:00Z');
    const r = calculateEDD('2026-01-01', now);
    // 70 days = 10 weeks exactly.
    expect(r.gestationWeeks).toBe(10);
    expect(r.gestationDays).toBe(0);
  });

  it('reports the leftover days within the current week', () => {
    const now = new Date('2026-03-15T00:00:00Z'); // 73 days after 1 Jan
    const r = calculateEDD('2026-01-01', now);
    expect(r.gestationWeeks).toBe(10);
    expect(r.gestationDays).toBe(3);
  });

  it('does not report negative gestation for a future LMP', () => {
    const r = calculateEDD('2026-06-01', new Date('2026-03-12T00:00:00Z'));
    expect(r.gestationWeeks).toBe(0);
    expect(r.gestationDays).toBe(0);
  });

  it('returns a blank EDD for an unusable date instead of NaN', () => {
    expect(calculateEDD('')).toMatchObject({ edd: '', gestationWeeks: 0 });
    expect(calculateEDD('not-a-date')).toMatchObject({ edd: '' });
  });
});

describe('computeRiskScore — breakdown', () => {
  it('attributes every point to a named factor', () => {
    const r = score({ bpSystolic: 168, bpDiastolic: 112, hemoglobin: 6 });
    expect(r.score).toBe(9);
    expect(r.factors.map(f => f.label)).toEqual(['Severe hypertension', 'Severe anaemia']);
    expect(r.factors.reduce((s, f) => s + f.points, 0)).toBe(r.score);
  });

  it('carries the reading behind each factor', () => {
    const r = score({ bpSystolic: 145, bpDiastolic: 95 });
    expect(r.factors[0]).toMatchObject({ label: 'Hypertension', detail: '145/95 mmHg', points: 3 });
  });

  it('has no factors for a woman with nothing wrong', () => {
    expect(score().factors).toEqual([]);
  });

  it('reports a maximum the worst case actually reaches', () => {
    const worst = score({
      age: 44, parity: 6, gestationWeeks: 26,
      bpSystolic: 170, bpDiastolic: 115, hemoglobin: 6,
      hasDiabetes: true, hasPreeclampsia: true,
    });
    expect(worst.score).toBe(RISK_MAX_SCORE);
    expect(worst.maxScore).toBe(RISK_MAX_SCORE);
    // The old UI showed "/ 20+", which understated a 27-point scale.
    expect(worst.maxScore).toBeGreaterThan(20);
  });
});

describe('calculateEDD — cycle length', () => {
  it('dates a long cycle later and a short cycle earlier', () => {
    expect(calculateEDD('2026-01-01', new Date(), 35).edd).toBe('2026-10-15');
    expect(calculateEDD('2026-01-01', new Date(), 21).edd).toBe('2026-10-01');
  });

  it('leaves the answer alone at 28 days', () => {
    // The default must stay identical to the previous behaviour.
    expect(calculateEDD('2026-01-01', new Date(), 28).edd).toBe(calculateEDD('2026-01-01').edd);
    expect(calculateEDD('2026-01-01').edd).toBe('2026-10-08');
  });

  it('ignores an impossible cycle length rather than shifting the date', () => {
    expect(calculateEDD('2026-01-01', new Date(), 0).edd).toBe('2026-10-08');
    expect(calculateEDD('2026-01-01', new Date(), 400).edd).toBe('2026-10-08');
    expect(calculateEDD('2026-01-01', new Date(), NaN).edd).toBe('2026-10-08');
  });
});

describe('apgarGuidance', () => {
  it('calls for repeat scoring when the 5-minute score stays low', () => {
    expect(apgarGuidance(6, 5)).toContain('every 5 minutes');
    expect(apgarGuidance(5, 5)).toContain('every 5 minutes');
  });

  it('does not ask for a repeat when the 5-minute score is normal', () => {
    expect(apgarGuidance(9, 5)).not.toContain('every 5 minutes');
  });

  it('flags resuscitation ahead of everything else for a very low score', () => {
    expect(apgarGuidance(2, 1)).toContain('Resuscitation');
    expect(apgarGuidance(3, 5)).toContain('Resuscitation');
    expect(apgarGuidance(3, 5)).not.toContain('every 5 minutes');
  });
});

describe('interpretApgar', () => {
  it('is Normal at 7 and above', () => {
    expect(interpretApgar(10).interpretation).toBe('Normal');
    expect(interpretApgar(7).interpretation).toBe('Normal');
  });

  it('is Moderately Depressed from 4 to 6', () => {
    expect(interpretApgar(6).interpretation).toBe('Moderately Depressed');
    expect(interpretApgar(4).interpretation).toBe('Moderately Depressed');
  });

  it('calls for resuscitation below 4', () => {
    expect(interpretApgar(3).interpretation).toContain('Resuscitation');
    expect(interpretApgar(0).color).toBe('#dc3545');
  });
});
