import { normaliseVitals, vitalsInsertParams } from './vitals.util';

describe('normaliseVitals', () => {
    it('reads the screening form payload, which uses different field names', () => {
        // This is the shape StartScreeningPage posts. Reading only the column names
        // dropped all of these, so triage vitals were saved blank.
        const { row, invalid, hasReading } = normaliseVitals({
            bp_systolic: '138',
            bp_diastolic: '86',
            pulse: '78',
            temp: '37.2',
            resp: '18',
            o2_sat: '97',
            weight: '72',
            height: '170',
        });

        expect(invalid).toEqual([]);
        expect(hasReading).toBe(true);
        expect(row.bps).toBe('138');
        expect(row.bpd).toBe('86');
        expect(row.pulse).toBe(78);
        expect(row.temperature).toBe(37.2);
        expect(row.respiration).toBe(18);
        expect(row.oxygen_saturation).toBe(97);
        expect(row.weight).toBe(72);
        expect(row.height).toBe(170);
    });

    it('reads the patient chart / intake payload, which uses column names', () => {
        const { row, invalid } = normaliseVitals({
            bps: '120',
            bpd: '80',
            pulse: 66,
            temperature: 36.8,
            respiration: 14,
            oxygen_saturation: 99,
        });

        expect(invalid).toEqual([]);
        expect(row.temperature).toBe(36.8);
        expect(row.pulse).toBe(66);
        expect(row.oxygen_saturation).toBe(99);
    });

    it('accepts a compound blood-pressure string', () => {
        // bps is varchar, so "120/80" is storable.
        expect(normaliseVitals({ bps: '120/80' }).row.bps).toBe('120/80');
    });

    it('never returns NULL for a numeric vital that was not supplied', () => {
        const { row } = normaliseVitals({ pulse: 80 });

        expect(row.temperature).toBe(0);
        expect(row.respiration).toBe(0);
        expect(row.oxygen_saturation).toBe(0);
        expect(row.weight).toBe(0);
        expect(row.height).toBe(0);
        expect(row.BMI).toBe(0);
    });

    it('rejects a supplied vital that is zero or negative, naming the field', () => {
        const { invalid } = normaliseVitals({
            pulse: 0,
            temp: -1,
            o2_sat: '0',
        });

        expect(invalid).toEqual(['Temperature', 'Pulse', 'SpO2']);
    });

    it('rejects a supplied value that is not a number', () => {
        expect(normaliseVitals({ pulse: 'abc' }).invalid).toEqual(['Pulse']);
        expect(normaliseVitals({ temp: '' }).invalid).toEqual([]); // blank = not supplied
    });

    it('reports no reading when nothing usable was supplied', () => {
        expect(normaliseVitals({}).hasReading).toBe(false);
        expect(normaliseVitals({ pulse: 0 }).hasReading).toBe(false);
        expect(normaliseVitals({ note: 'feeling unwell' }).hasReading).toBe(
            false,
        );
    });

    it('treats an empty payload as no reading rather than throwing', () => {
        expect(() => normaliseVitals(null)).not.toThrow();
        expect(normaliseVitals(null).hasReading).toBe(false);
        expect(normaliseVitals(undefined).hasReading).toBe(false);
    });

    it('keeps a note and BMI status while zeroing the numerics', () => {
        const { row } = normaliseVitals({
            note: 'fasting',
            BMI_status: 'Normal',
        });

        expect(row.note).toBe('fasting');
        expect(row.BMI_status).toBe('Normal');
        expect(row.BMI).toBe(0);
    });
});

describe('vitalsInsertParams', () => {
    it('returns parameters in the INSERT column order', () => {
        const { row } = normaliseVitals({
            bp_systolic: '130',
            temp: '37',
            o2_sat: '98',
            note: 'ok',
        });

        // (pid, date) are supplied by the query, then these eleven columns.
        expect(vitalsInsertParams(row)).toEqual([
            '130',
            null,
            0,
            0,
            37,
            0,
            0,
            0,
            null,
            98,
            'ok',
        ]);
    });

    it('contains no null for any numeric column', () => {
        const params = vitalsInsertParams(normaliseVitals({ pulse: 70 }).row);

        // indices 2..7 are weight, height, temperature, pulse, respiration, BMI
        expect(params.slice(2, 8)).toEqual([0, 0, 0, 70, 0, 0]);
        expect(params[9]).toBe(0); // oxygen_saturation
    });
});
