import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/** `insurance_companies` row. */
export interface InsuranceCompanyRow {
    id: number;
    uuid: string;
    name: string;
    attn: string | null;
    cms_id: string | null;
    ins_type_code: number | string | null;
    x12_receiver_id: string | null;
    inactive: number | boolean;
}

/** `procedure_order` row. */
export interface ReferenceProcedureRow {
    id: number;
    uuid: string;
    provider_id: number | null;
    patient_id: number | null;
    encounter_id: number | null;
    date_ordered: string | null;
    order_status: string | null;
    order_priority: string | null;
}

/** `drugs` row. */
export interface ReferenceDrugRow {
    id: number;
    uuid: string;
    name: string;
    ndc_number: string | null;
    form: number | string | null;
    size: string | null;
    unit: string | null;
    route: string | null;
    active: number | boolean;
}

/** `insurance_data` row. */
export interface PatientInsuranceRow {
    id: number;
    uuid: string;
    type: string | null;
    provider: string | null;
    plan_name: string | null;
    policy_number: string | null;
    group_number: string | null;
    subscriber_lname: string | null;
    subscriber_fname: string | null;
    subscriber_relationship: string | null;
    date: string | null;
    copay: string | null;
}

/** `prescriptions` row as returned by the reference endpoint. */
export interface ReferenceMedicationRow {
    id: number;
    uuid: string;
    patient_id: number;
    drug: string | null;
    dosage: string | null;
    quantity: string | null;
    route: string | null;
    dose_interval: string | null;
    refills: number | null;
    start_date: string | null;
    end_date: string | null;
    active: number | boolean;
    note: string | null;
}

/** `lists` row as returned for allergies. */
export interface ReferenceAllergyRow {
    id: number;
    allergen: string;
    reaction: string | null;
    type: string;
    date: string | null;
}

@Injectable()
export class ReferenceService {
    constructor(@InjectDataSource() private dataSource: DataSource) {}

    // --- Insurance Companies ---
    async getInsuranceCompanies(): Promise<InsuranceCompanyRow[]> {
        return this.dataSource.query<InsuranceCompanyRow[]>(
            `SELECT id, LOWER(HEX(uuid)) as uuid, name, attn, cms_id, ins_type_code,
        x12_receiver_id, inactive
      FROM insurance_companies ORDER BY name LIMIT 200`,
        );
    }

    // --- Procedures ---
    async getProcedures(): Promise<ReferenceProcedureRow[]> {
        return this.dataSource.query<ReferenceProcedureRow[]>(
            `SELECT procedure_order_id as id, LOWER(HEX(uuid)) as uuid,
        provider_id, patient_id, encounter_id, date_ordered, order_status,
        order_priority
      FROM procedure_order ORDER BY date_ordered DESC LIMIT 100`,
        );
    }

    // --- Drugs ---
    async getDrugs(): Promise<ReferenceDrugRow[]> {
        return this.dataSource.query<ReferenceDrugRow[]>(
            `SELECT drug_id as id, LOWER(HEX(uuid)) as uuid, name, ndc_number,
        form, size, unit, route, active
      FROM drugs ORDER BY name LIMIT 200`,
        );
    }

    // --- Patient Insurance ---
    async getPatientInsurance(pid: number): Promise<PatientInsuranceRow[]> {
        return this.dataSource.query<PatientInsuranceRow[]>(
            `SELECT id, LOWER(HEX(uuid)) as uuid, type, provider, plan_name,
        policy_number, group_number, subscriber_lname, subscriber_fname,
        subscriber_relationship, date, copay
      FROM insurance_data WHERE pid = ? ORDER BY type`,
            [pid],
        );
    }

    // --- Patient Medications ---
    async getPatientMedications(
        pid: number,
    ): Promise<ReferenceMedicationRow[]> {
        return this.dataSource.query<ReferenceMedicationRow[]>(
            `SELECT id, LOWER(HEX(uuid)) as uuid, patient_id, drug, dosage,
        quantity, route, \`interval\` AS dose_interval, refills, start_date, end_date, active, note
      FROM prescriptions WHERE patient_id = ? AND active = 1
      ORDER BY start_date DESC LIMIT 100`,
            [pid],
        );
    }

    // --- Patient Allergies ---
    async getPatientAllergies(pid: number): Promise<ReferenceAllergyRow[]> {
        return this.dataSource.query<ReferenceAllergyRow[]>(
            `SELECT id, title as allergen, comments as reaction, type, date
      FROM lists WHERE pid = ? AND type = 'allergy'
      ORDER BY date DESC LIMIT 100`,
            [pid],
        );
    }
}
