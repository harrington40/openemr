import {
    CHART_REQUIREMENTS,
    isChartComplete,
    missingChartFields,
    withChartStatus,
} from './chart-completeness.util';

/** A patient whose registration details are all present and who has a provider. */
const completePatient = {
    fname: 'Ada',
    lname: 'Lovelace',
    DOB: '1985-12-10',
    sex: 'Female',
    phone_contact: '555-0100',
    street: '12 Analytical Way',
    city: 'Lagos',
    providerID: 7,
    status: 'active',
};

describe('missingChartFields', () => {
    it('reports nothing for a fully registered patient', () => {
        expect(missingChartFields(completePatient)).toEqual([]);
    });

    it('lists the registration details a front-desk capture has not filled yet', () => {
        const missing = missingChartFields({
            fname: 'Ada',
            lname: 'Lovelace',
            DOB: '1985-12-10',
            status: 'pending',
        });

        expect(missing).toEqual([
            'Sex',
            'Phone',
            'Street',
            'City',
            'Assigned provider',
        ]);
    });

    it('treats empty and whitespace-only strings as missing', () => {
        expect(missingChartFields({ ...completePatient, city: '' })).toEqual([
            'City',
        ]);
        expect(
            missingChartFields({ ...completePatient, street: '   ' }),
        ).toEqual(['Street']);
    });

    it('treats a null or undefined value as missing', () => {
        expect(missingChartFields({ ...completePatient, DOB: null })).toEqual([
            'Date of birth',
        ]);
        expect(
            missingChartFields({
                ...completePatient,
                phone_contact: undefined,
            }),
        ).toEqual(['Phone']);
    });

    it('treats provider 0 as unassigned', () => {
        expect(
            missingChartFields({ ...completePatient, providerID: 0 }),
        ).toEqual(['Assigned provider']);
        expect(
            missingChartFields({ ...completePatient, providerID: null }),
        ).toEqual(['Assigned provider']);
    });

    it('matches the column names on the patient row', () => {
        // Guards against a rename in patient_data silently disabling a requirement.
        expect(CHART_REQUIREMENTS.map((r) => r.key)).toEqual([
            'fname',
            'lname',
            'DOB',
            'sex',
            'phone_contact',
            'street',
            'city',
            'providerID',
        ]);
    });

    it('does not throw on a missing patient', () => {
        expect(missingChartFields(null)).toHaveLength(
            CHART_REQUIREMENTS.length,
        );
        expect(missingChartFields(undefined)).toHaveLength(
            CHART_REQUIREMENTS.length,
        );
    });
});

describe('isChartComplete', () => {
    it('is true once registration details and a provider are present', () => {
        expect(isChartComplete(completePatient)).toBe(true);
    });

    it('stays false while the patient is still pending, however full the form is', () => {
        // The registrar has not approved the chart, so no provider is on it yet.
        expect(isChartComplete({ ...completePatient, status: 'pending' })).toBe(
            false,
        );
    });

    it('is false when a required detail is missing', () => {
        expect(isChartComplete({ ...completePatient, sex: '' })).toBe(false);
        expect(isChartComplete({ ...completePatient, providerID: 0 })).toBe(
            false,
        );
    });

    it('is false for a patient that does not exist', () => {
        expect(isChartComplete(null)).toBe(false);
    });
});

describe('withChartStatus', () => {
    it('passes the row through and adds the flags the UI renders', () => {
        const result = withChartStatus({
            fname: 'Ada',
            lname: 'Lovelace',
            status: 'pending',
        });

        expect(result.fname).toBe('Ada');
        expect(result.status).toBe('pending');
        expect(result.chart_complete).toBe(false);
        expect(result.missing_fields).toContain('Assigned provider');
    });

    it('marks a fully registered patient complete with no missing fields', () => {
        const result = withChartStatus(completePatient);

        expect(result.chart_complete).toBe(true);
        expect(result.missing_fields).toEqual([]);
    });
});
