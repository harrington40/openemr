import { chartReadiness } from './chart-readiness.util';
import { isChartComplete, missingChartFields } from './chart-completeness.util';

/**
 * Tests for the chart readiness score.
 *
 * The existing yes/no contract (`isChartComplete` / `missingChartFields`) is
 * asserted alongside the new score, because the registrar list and the yellow
 * chart banner depend on it and must not change behaviour.
 */
const completePatient = {
  fname: 'Charles', lname: 'Seekey', DOB: '2004-12-21', sex: 'Male',
  phone_contact: '231777654321', street: 'Broad St', city: 'Monrovia',
  providerID: 6, status: 'approved',
};
const fullSignals = { vitals: 2, notes: 1, observations: 1 };

describe('existing completeness contract (unchanged)', () => {
  it('still reports a pending patient as incomplete', () => {
    expect(isChartComplete({ ...completePatient, status: 'pending' })).toBe(false);
    expect(missingChartFields(completePatient)).toEqual([]);
  });

  it('still lists the outstanding registration fields in order', () => {
    expect(missingChartFields({ fname: 'A' })).toEqual([
      'Last name', 'Date of birth', 'Sex', 'Phone', 'Street', 'City', 'Assigned provider',
    ]);
  });
});

describe('chart readiness', () => {
  it('scores a fully documented chart at 100', () => {
    const r = chartReadiness(completePatient, fullSignals);
    expect(r.score).toBe(100);
    expect(r.missing).toEqual([]);
    expect(r.complete).toBe(true);
    expect(r.nextAction).toMatch(/ready for a visit/i);
  });

  it('does not penalise a healthy patient with no diagnoses or allergies', () => {
    const r = chartReadiness(completePatient, { vitals: 1, notes: 1, diagnoses: 0, allergies: 0 });
    expect(r.score).toBe(100);
  });

  it('holds care assignment at zero until approval and a provider', () => {
    const pending = chartReadiness({ ...completePatient, status: 'pending' }, fullSignals);
    expect(pending.sections.find((s) => s.key === 'assignment')!.earned).toBe(0);
    expect(pending.nextAction).toMatch(/registrar/i);

    const unassigned = chartReadiness({ ...completePatient, providerID: 0 }, fullSignals);
    expect(unassigned.score).toBe(75);
    expect(unassigned.nextAction).toMatch(/assign a provider/i);
  });

  it('gives partial credit for identity and names the missing fields', () => {
    const r = chartReadiness({ ...completePatient, DOB: '', sex: '' }, fullSignals);
    expect(r.sections.find((s) => s.key === 'identity')!.earned).toBe(17.5);
    expect(r.missing).toEqual(['Date of birth', 'Sex']);
  });

  it('gives half the clinical weight for vitals only, and names the gap', () => {
    const r = chartReadiness(completePatient, { vitals: 1 });
    expect(r.sections.find((s) => s.key === 'clinical')!.earned).toBe(10);
    expect(r.nextAction).toMatch(/clinical note or observation/i);
  });

  it('nudges for baseline vitals when only narrative exists', () => {
    expect(chartReadiness(completePatient, { notes: 3 }).nextAction).toMatch(/baseline vitals/i);
  });

  it('counts structured observations as narrative documentation', () => {
    expect(chartReadiness(completePatient, { vitals: 1, observations: 2 }).score).toBe(100);
  });

  it('never returns a score outside 0-100', () => {
    expect(chartReadiness(null).score).toBe(0);
    expect(chartReadiness({}).score).toBe(0);
    expect(chartReadiness(completePatient, fullSignals).score).toBeLessThanOrEqual(100);
  });
});
