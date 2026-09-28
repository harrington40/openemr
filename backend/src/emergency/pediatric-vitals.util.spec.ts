import {
  PAEDIATRIC_BANDS,
  bandForAge,
  bandedObservations,
  needsPaediatricScoring,
} from './pediatric-vitals.util';

/**
 * Tests for age-appropriate observation bands.
 *
 * The two errors worth preventing run in opposite directions: scoring a healthy
 * infant with adult thresholds (which cries wolf until nobody trusts the score)
 * and scoring a sick child as normal (which is dangerous). Both are asserted.
 */

describe('bandForAge', () => {
  it.each([
    [0, 'under1'],
    [0.9, 'under1'],
    [1, '1to4'],
    [4, '1to4'],
    [5, '5to11'],
    [11, '5to11'],
    [12, '12to17'],
    [17, '12to17'],
    [18, 'adult'],
    [90, 'adult'],
  ])('maps age %s to %s', (age, band) => {
    expect(bandForAge(age)).toBe(band);
  });

  it('treats an unknown age as an adult rather than guessing a band', () => {
    expect(bandForAge(null)).toBe('adult');
    expect(bandForAge(undefined)).toBe('adult');
    expect(bandForAge(NaN)).toBe('adult');
    expect(bandForAge(-3)).toBe('adult');
  });

  it('only switches scoring for patients under 18', () => {
    expect(needsPaediatricScoring(0.5)).toBe(true);
    expect(needsPaediatricScoring(6)).toBe(true);
    expect(needsPaediatricScoring(14)).toBe(true);
    expect(needsPaediatricScoring(30)).toBe(false);
    expect(needsPaediatricScoring(null)).toBe(false);
  });

  it('band thresholds really do differ from the adult ones', () => {
    expect(PAEDIATRIC_BANDS.under1.respiration.max).toBeGreaterThan(PAEDIATRIC_BANDS.adult.respiration.max);
    expect(PAEDIATRIC_BANDS.under1.pulse.max).toBeGreaterThan(PAEDIATRIC_BANDS.adult.pulse.max);
    expect(PAEDIATRIC_BANDS.under1.systolic.min).toBeLessThan(PAEDIATRIC_BANDS.adult.systolic.min);
  });
});

describe('bandedObservations', () => {
  it('does not flag a healthy infant — these numbers are normal at that age', () => {
    const r = bandedObservations({ respiration: 40, pulse: 130, bps: 75, oxygen_saturation: 98 }, 0.5);
    expect(r.band).toBe('under1');
    expect(r.abnormal).toEqual([]);
    // …but it records *why* they look alarming to adult eyes.
    expect(r.reassuringForAge.join(' ')).toMatch(/normal for infant under 1 year/i);
  });

  it('flags an infant whose observations are genuinely abnormal', () => {
    const low = bandedObservations({ respiration: 18 }, 0);
    expect(low.abnormal.join(' ')).toMatch(/respirations 18/);

    const fast = bandedObservations({ pulse: 200 }, 0);
    expect(fast.abnormal.join(' ')).toMatch(/pulse 200/);

    const lowSats = bandedObservations({ oxygen_saturation: 92 }, 0);
    expect(lowSats.abnormal.join(' ')).toMatch(/oxygen saturation 92/);
  });

  it('applies the child band to a school-age patient', () => {
    const r = bandedObservations({ respiration: 14, pulse: 130 }, 6);
    expect(r.band).toBe('5to11');
    expect(r.abnormal).toHaveLength(2);
    expect(r.abnormal.join(' ')).toMatch(/expected 18–30/);
  });

  it('applies the adolescent band at 14', () => {
    const r = bandedObservations({ pulse: 130 }, 14);
    expect(r.band).toBe('12to17');
    expect(r.abnormal.join(' ')).toMatch(/pulse 130/);
  });

  it('leaves a normal adult unflagged and unqualified', () => {
    const r = bandedObservations({ respiration: 16, pulse: 76, bps: 120, oxygen_saturation: 98 }, 40);
    expect(r.band).toBe('adult');
    expect(r.abnormal).toEqual([]);
    expect(r.reassuringForAge).toEqual([]);
  });

  it('flags an adult with a paediatric-normal pulse', () => {
    // 120 in an adult is a real finding; in a toddler it is not.
    expect(bandedObservations({ pulse: 120 }, 40).abnormal).toHaveLength(1);
    expect(bandedObservations({ pulse: 120 }, 2).abnormal).toEqual([]);
  });

  it('ignores observations that were not recorded, rather than assuming zero', () => {
    const r = bandedObservations({ respiration: null, pulse: undefined, bps: '', oxygen_saturation: 'n/a' }, 3);
    expect(r.abnormal).toEqual([]);
  });

  it('survives missing vitals entirely', () => {
    expect(bandedObservations(null, 5).abnormal).toEqual([]);
    expect(bandedObservations(undefined, null).band).toBe('adult');
  });

  it('accepts the string values that come out of a database row', () => {
    // 1–4 years: respirations 22–37, pulse 90–140.
    const r = bandedObservations({ respiration: '30', pulse: '120' }, '1');
    expect(r.abnormal).toEqual([]);
    expect(r.band).toBe('1to4');
  });
});
