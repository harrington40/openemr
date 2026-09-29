import {
    computeRisk,
    eddFromLmp,
    gestationFromLmp,
    apgarTotal,
    interpretApgar,
    apgarGuidance,
    RISK_MAX_SCORE,
    type RiskInputs,
} from './midwife-scoring.util';

const base: RiskInputs = {
    age: 28,
    parity: 1,
    gestationWeeks: 30,
    bpSystolic: 120,
    bpDiastolic: 80,
    hemoglobin: 12,
    hasDiabetes: false,
    hasPreeclampsia: false,
};

describe('computeRisk', () => {
    it('scores the over-40 band at 5, not 3', () => {
        // Regression: >40 was tested after >35 and could never be reached, so the
        // highest-risk age group scored as the moderate one.
        expect(computeRisk({ ...base, age: 41 }).score).toBe(5);
        expect(computeRisk({ ...base, age: 36 }).score).toBe(3);
        expect(computeRisk({ ...base, age: 42 }).score).toBeGreaterThan(
            computeRisk({ ...base, age: 38 }).score,
        );
    });

    it('scores a teenager and an average age', () => {
        expect(computeRisk({ ...base, age: 17 }).score).toBe(2);
        expect(computeRisk({ ...base, age: 25 }).score).toBe(0);
    });

    it('adds for parity, gestation, BP, anaemia and comorbidity', () => {
        expect(computeRisk({ ...base, parity: 0 }).score).toBe(1);
        expect(computeRisk({ ...base, gestationWeeks: 27 }).score).toBe(3);
        expect(computeRisk({ ...base, bpSystolic: 160 }).score).toBe(5);
        expect(computeRisk({ ...base, hemoglobin: 6 }).score).toBe(4);
        expect(computeRisk({ ...base, hasPreeclampsia: true }).score).toBe(5);
    });

    it('maps the score to a risk band', () => {
        expect(computeRisk(base).level).toBe('low');
        expect(computeRisk({ ...base, age: 38, hasDiabetes: true }).level).toBe(
            'moderate',
        );
        expect(
            computeRisk({ ...base, hasDiabetes: true, hasPreeclampsia: true })
                .level,
        ).toBe('high');
    });
});

describe('eddFromLmp', () => {
    it("applies Naegele's rule in UTC", () => {
        expect(eddFromLmp('2026-01-01')).toBe('2026-10-08');
    });

    it('returns blank for an unusable date', () => {
        expect(eddFromLmp('')).toBe('');
        expect(eddFromLmp('not-a-date')).toBe('');
    });

    it('dates a long cycle later and a short cycle earlier', () => {
        // Naegele assumes ovulation on day 14 of 28; a 35-day cycle ovulates a week
        // later, so the due date moves out by 7 days.
        expect(eddFromLmp('2026-01-01', 35)).toBe('2026-10-15');
        expect(eddFromLmp('2026-01-01', 21)).toBe('2026-10-01');
    });

    it('ignores a 28-day cycle, matching the unadjusted answer', () => {
        expect(eddFromLmp('2026-01-01', 28)).toBe(eddFromLmp('2026-01-01'));
    });

    it('ignores an impossible cycle length rather than shifting the date', () => {
        // A stray keystroke must not move a due date by months.
        expect(eddFromLmp('2026-01-01', 0)).toBe('2026-10-08');
        expect(eddFromLmp('2026-01-01', 400)).toBe('2026-10-08');
        expect(eddFromLmp('2026-01-01', NaN)).toBe('2026-10-08');
    });
});

describe('risk breakdown', () => {
    it('attributes every point to a named factor', () => {
        const r = computeRisk({
            ...base,
            bpSystolic: 168,
            bpDiastolic: 112,
            hemoglobin: 6,
        });
        expect(r.score).toBe(9);
        expect(r.factors.map((f) => f.label)).toEqual([
            'Severe hypertension',
            'Severe anaemia',
        ]);
        expect(r.factors.reduce((s, f) => s + f.points, 0)).toBe(r.score);
    });

    it('carries the reading behind each factor', () => {
        const r = computeRisk({ ...base, bpSystolic: 145, bpDiastolic: 95 });
        expect(r.factors[0]).toMatchObject({
            label: 'Hypertension',
            detail: '145/95 mmHg',
            points: 3,
        });
    });

    it('returns no factors for a woman with nothing wrong', () => {
        expect(computeRisk(base).factors).toEqual([]);
    });

    it('reports the maximum so the UI denominator is not stale', () => {
        // Worst case in every category must actually reach the reported maximum.
        const worst = computeRisk({
            age: 44,
            parity: 6,
            gestationWeeks: 26,
            bpSystolic: 170,
            bpDiastolic: 115,
            hemoglobin: 6,
            hasDiabetes: true,
            hasPreeclampsia: true,
        });
        expect(worst.score).toBe(RISK_MAX_SCORE);
        expect(worst.maxScore).toBe(RISK_MAX_SCORE);
        expect(worst.level).toBe('high');
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
        // 3 is below the resuscitation threshold, so "call for help" must take
        // priority over the note about repeating the score.
        expect(apgarGuidance(2, 1)).toContain('Resuscitation');
        expect(apgarGuidance(3, 5)).toContain('Resuscitation');
        expect(apgarGuidance(3, 5)).not.toContain('every 5 minutes');
    });
});

describe('gestationFromLmp', () => {
    it('reports whole weeks and leftover days', () => {
        expect(
            gestationFromLmp('2026-01-01', new Date('2026-03-15T00:00:00Z')),
        ).toEqual({ weeks: 10, days: 3 });
    });

    it('clamps a future LMP to zero rather than going negative', () => {
        expect(
            gestationFromLmp('2026-06-01', new Date('2026-03-12T00:00:00Z')),
        ).toEqual({ weeks: 0, days: 0 });
    });
});

describe('apgar', () => {
    it('totals the five components', () => {
        expect(
            apgarTotal({
                appearance: 2,
                pulse: 2,
                grimace: 2,
                activity: 2,
                respiration: 2,
            }),
        ).toBe(10);
        expect(
            apgarTotal({
                appearance: 0,
                pulse: 1,
                grimace: 2,
                activity: 1,
                respiration: 0,
            }),
        ).toBe(4);
    });

    it('interprets the total', () => {
        expect(interpretApgar(10)).toBe('Normal');
        expect(interpretApgar(7)).toBe('Normal');
        expect(interpretApgar(6)).toBe('Moderately Depressed');
        expect(interpretApgar(3)).toBe('Severely Depressed');
    });
});
