/**
 * "Is this patient's chart finished?"
 *
 * A patient registered at the front desk starts life with only what the
 * registrar or nurse-aide captured. The chart is not usable for a visit until
 * the registration demographics are filled in *and* a provider has been
 * assigned (which is what the registrar's approval does). Until then the
 * patient is flagged so their chart can be highlighted as incomplete.
 *
 * Field keys are the `patient_data` column names, matching `PatientRow`.
 */

export interface ChartRequirement {
    /** Property name on the patient row. */
    key: string;
    /** Human-readable name, surfaced to the user as "still missing". */
    label: string;
}

export const CHART_REQUIREMENTS: ChartRequirement[] = [
    { key: 'fname', label: 'First name' },
    { key: 'lname', label: 'Last name' },
    { key: 'DOB', label: 'Date of birth' },
    { key: 'sex', label: 'Sex' },
    { key: 'phone_contact', label: 'Phone' },
    { key: 'street', label: 'Street' },
    { key: 'city', label: 'City' },
    { key: 'providerID', label: 'Assigned provider' },
];

const isBlank = (value: unknown): boolean => {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return value.trim() === '';
    // providerID has no "unassigned" sentinel other than 0/negative.
    if (typeof value === 'number') return value <= 0;
    return false;
};

/** Human-readable names of the registration details still outstanding. */
export function missingChartFields(
    patient: Record<string, any> | null | undefined,
): string[] {
    return CHART_REQUIREMENTS.filter((req) => isBlank(patient?.[req.key])).map(
        (req) => req.label,
    );
}

/**
 * A pending patient is never complete, however much was typed in — the
 * registrar still has to approve the chart and assign the patient to a
 * provider before the chart counts as finished.
 */
export function isChartComplete(
    patient: Record<string, any> | null | undefined,
): boolean {
    if (!patient) return false;
    if (patient.status === 'pending') return false;
    return missingChartFields(patient).length === 0;
}

/** Adds the completeness flags the chart UI and the registrar list render. */
export function withChartStatus<T extends Record<string, any>>(
    patient: T,
): T & {
    chart_complete: boolean;
    missing_fields: string[];
} {
    return {
        ...patient,
        chart_complete: isChartComplete(patient),
        missing_fields: missingChartFields(patient),
    };
}
