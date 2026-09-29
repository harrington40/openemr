import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/** `patient_data` demographics row. */
interface FhirPatientRow {
    id: number;
    fname: string;
    lname: string;
    mname: string | null;
    DOB: string | null;
    sex: string | null;
    street: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
    phone_contact: string | null;
    email: string | null;
}

/** Minimal patient row for the search bundle. */
interface FhirPatientSearchRow {
    id: number;
    fname: string;
    lname: string;
    mname: string | null;
    DOB: string | null;
    sex: string | null;
}

/** `form_vitals` row. */
interface FhirVitalsRow {
    id: number;
    date: string;
    bps: number | string | null;
    bpd: number | string | null;
    weight: number | string | null;
    height: number | string | null;
    temperature: number | string | null;
    pulse: number | string | null;
    respiration: number | string | null;
    BMI: number | string | null;
    oxygen_saturation: number | string | null;
}

/** `lists` row (conditions and allergies). */
interface FhirListRow {
    id: number;
    title: string;
    comments: string | null;
    date: string | null;
}

/** `prescriptions` row. */
interface FhirMedicationRow {
    id: number;
    drug: string | null;
    dosage: string | null;
    route: string | null;
    start_date: string | null;
    end_date: string | null;
    note: string | null;
}

/** `immunizations` row. */
interface FhirImmunizationRow {
    id: number;
    cvx_code: string | null;
    manufacturer: string | null;
    lot_number: string | null;
    administered_date: string | null;
    route: string | null;
    administration_site: string | null;
    note: string | null;
}

/** `form_encounter` row. */
interface FhirEncounterRow {
    id: number;
    date: string | null;
    reason: string | null;
    class_code: string | null;
}

/** A FHIR Observation entry. */
export interface FhirObservationEntry {
    resource: {
        resourceType: 'Observation';
        id: string;
        status: string;
        code: { coding: { system: string; code: string; display: string }[] };
        subject: { reference: string };
        effectiveDateTime: string;
        valueQuantity: { value: number; unit: string; system: string };
    };
}

@Injectable()
export class FhirService {
    constructor(@InjectDataSource() private dataSource: DataSource) {}

    private baseUrl = 'http://localhost:3002/fhir';

    async getPatient(id: number) {
        const rows = await this.dataSource.query<FhirPatientRow[]>(
            `SELECT id, fname, lname, mname, DOB, sex, street, city, state, postal_code, phone_contact, email
       FROM patient_data WHERE id = ?`,
            [id],
        );
        if (!rows.length)
            throw new NotFoundException(`Patient ${id} not found`);
        const p = rows[0];
        return {
            resourceType: 'Patient',
            id: String(p.id),
            name: [
                { family: p.lname, given: [p.fname, p.mname].filter(Boolean) },
            ],
            gender: p.sex?.toLowerCase() || 'unknown',
            birthDate: p.DOB
                ? new Date(p.DOB).toISOString().split('T')[0]
                : undefined,
            address: p.street
                ? [
                      {
                          line: [p.street],
                          city: p.city,
                          state: p.state,
                          postalCode: p.postal_code,
                      },
                  ]
                : [],
            telecom: [
                ...(p.phone_contact
                    ? [{ system: 'phone', value: p.phone_contact }]
                    : []),
                ...(p.email ? [{ system: 'email', value: p.email }] : []),
            ],
        };
    }

    async searchPatients(name?: string) {
        let query = `SELECT id, fname, lname, mname, DOB, sex FROM patient_data`;
        const params: unknown[] = [];
        if (name) {
            query += ' WHERE lname LIKE ? OR fname LIKE ?';
            params.push(`%${name}%`, `%${name}%`);
        }
        query += ' LIMIT 50';
        const rows = await this.dataSource.query<FhirPatientSearchRow[]>(
            query,
            params,
        );
        return {
            resourceType: 'Bundle',
            type: 'searchset',
            total: rows.length,
            entry: rows.map((p) => ({
                resource: {
                    resourceType: 'Patient',
                    id: String(p.id),
                    name: [
                        {
                            family: p.lname,
                            given: [p.fname, p.mname].filter(Boolean),
                        },
                    ],
                    gender: p.sex?.toLowerCase() || 'unknown',
                    birthDate: p.DOB
                        ? new Date(p.DOB).toISOString().split('T')[0]
                        : undefined,
                },
            })),
        };
    }

    async getObservations(pid: number) {
        const rows = await this.dataSource.query<FhirVitalsRow[]>(
            `SELECT id, date, bps, bpd, weight, height, temperature, pulse, respiration, BMI, oxygen_saturation
       FROM form_vitals WHERE pid = ? ORDER BY date DESC LIMIT 50`,
            [pid],
        );
        const entries: FhirObservationEntry[] = [];
        for (const v of rows) {
            const addObs = (
                code: string,
                display: string,
                value: unknown,
                unit: string,
                system = 'http://loinc.org',
            ) => {
                if (value == null || value === 0 || value === '') return;
                entries.push({
                    resource: {
                        resourceType: 'Observation',
                        id: `${v.id}-${code}`,
                        status: 'final',
                        code: { coding: [{ system, code, display }] },
                        subject: { reference: `Patient/${pid}` },
                        effectiveDateTime: v.date,
                        valueQuantity: {
                            value: Number(value),
                            unit,
                            system: 'http://unitsofmeasure.org',
                        },
                    },
                });
            };
            addObs('8480-6', 'Systolic BP', v.bps, 'mmHg');
            addObs('8462-4', 'Diastolic BP', v.bpd, 'mmHg');
            addObs('29463-7', 'Weight', v.weight, 'kg');
            addObs('8302-2', 'Height', v.height, 'cm');
            addObs('8310-5', 'Temperature', v.temperature, 'C');
            addObs('8867-4', 'Heart rate', v.pulse, '/min');
            addObs('9279-1', 'Respiratory rate', v.respiration, '/min');
            addObs('39156-5', 'BMI', v.BMI, 'kg/m2');
            addObs('2708-6', 'Oxygen saturation', v.oxygen_saturation, '%');
        }
        return {
            resourceType: 'Bundle',
            type: 'searchset',
            total: entries.length,
            entry: entries,
        };
    }

    async getConditions(pid: number) {
        const rows = await this.dataSource.query<FhirListRow[]>(
            `SELECT id, title, comments, date FROM lists WHERE pid = ? AND type = 'medical_problem' ORDER BY date DESC`,
            [pid],
        );
        return {
            resourceType: 'Bundle',
            type: 'searchset',
            total: rows.length,
            entry: rows.map((c) => ({
                resource: {
                    resourceType: 'Condition',
                    id: String(c.id),
                    code: { text: c.title },
                    subject: { reference: `Patient/${pid}` },
                    onsetDateTime: c.date,
                    note: c.comments ? [{ text: c.comments }] : [],
                },
            })),
        };
    }

    async getMedicationRequests(pid: number) {
        const rows = await this.dataSource.query<FhirMedicationRow[]>(
            `SELECT id, drug, dosage, route, start_date, end_date, note FROM prescriptions
       WHERE patient_id = ? AND active = 1 ORDER BY start_date DESC`,
            [pid],
        );
        return {
            resourceType: 'Bundle',
            type: 'searchset',
            total: rows.length,
            entry: rows.map((m) => ({
                resource: {
                    resourceType: 'MedicationRequest',
                    id: String(m.id),
                    status:
                        m.end_date && new Date(m.end_date) < new Date()
                            ? 'stopped'
                            : 'active',
                    intent: 'order',
                    medicationCodeableConcept: { text: m.drug },
                    subject: { reference: `Patient/${pid}` },
                    dosageInstruction: m.dosage
                        ? [
                              {
                                  text: m.dosage,
                                  route: m.route
                                      ? { text: m.route }
                                      : undefined,
                              },
                          ]
                        : [],
                    note: m.note ? [{ text: m.note }] : [],
                },
            })),
        };
    }

    async getAllergyIntolerances(pid: number) {
        const rows = await this.dataSource.query<FhirListRow[]>(
            `SELECT id, title, comments, date FROM lists WHERE pid = ? AND type = 'allergy' AND activity = 1`,
            [pid],
        );
        return {
            resourceType: 'Bundle',
            type: 'searchset',
            total: rows.length,
            entry: rows.map((a) => ({
                resource: {
                    resourceType: 'AllergyIntolerance',
                    id: String(a.id),
                    code: { text: a.title },
                    patient: { reference: `Patient/${pid}` },
                    reaction: a.comments
                        ? [{ manifestation: [{ text: a.comments }] }]
                        : [],
                },
            })),
        };
    }

    async getImmunizations(pid: number) {
        const rows = await this.dataSource.query<FhirImmunizationRow[]>(
            `SELECT id, cvx_code, manufacturer, lot_number, administered_date, route, administration_site, note
       FROM immunizations WHERE patient_id = ? ORDER BY administered_date DESC`,
            [pid],
        );
        return {
            resourceType: 'Bundle',
            type: 'searchset',
            total: rows.length,
            entry: rows.map((i) => ({
                resource: {
                    resourceType: 'Immunization',
                    id: String(i.id),
                    status: 'completed',
                    vaccineCode: { coding: [{ code: i.cvx_code }] },
                    patient: { reference: `Patient/${pid}` },
                    occurrenceDateTime: i.administered_date,
                    manufacturer: i.manufacturer
                        ? { display: i.manufacturer }
                        : undefined,
                    lotNumber: i.lot_number,
                    route: i.route ? { text: i.route } : undefined,
                    site: i.administration_site
                        ? { text: i.administration_site }
                        : undefined,
                },
            })),
        };
    }

    async getEncounters(pid: number) {
        const rows = await this.dataSource.query<FhirEncounterRow[]>(
            `SELECT id, date, reason, class_code FROM form_encounter WHERE pid = ? ORDER BY date DESC LIMIT 50`,
            [pid],
        );
        return {
            resourceType: 'Bundle',
            type: 'searchset',
            total: rows.length,
            entry: rows.map((e) => ({
                resource: {
                    resourceType: 'Encounter',
                    id: String(e.id),
                    status: 'finished',
                    class: { code: e.class_code || 'AMB' },
                    subject: { reference: `Patient/${pid}` },
                    period: e.date ? { start: e.date } : undefined,
                    reasonCode: e.reason ? [{ text: e.reason }] : [],
                },
            })),
        };
    }
}
