import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class ReferenceService {
  constructor(@InjectDataSource() private dataSource: DataSource) {}

  // --- Insurance Companies ---
  async getInsuranceCompanies() {
    return this.dataSource.query(
      `SELECT id, LOWER(HEX(uuid)) as uuid, name, attn, cms_id, ins_type_code,
        x12_receiver_id, inactive
      FROM insurance_companies ORDER BY name LIMIT 200`,
    );
  }

  // --- Procedures ---
  async getProcedures() {
    return this.dataSource.query(
      `SELECT procedure_order_id as id, LOWER(HEX(uuid)) as uuid,
        provider_id, patient_id, encounter_id, date_ordered, order_status,
        order_priority
      FROM procedure_order ORDER BY date_ordered DESC LIMIT 100`,
    );
  }

  // --- Drugs ---
  async getDrugs() {
    return this.dataSource.query(
      `SELECT drug_id as id, LOWER(HEX(uuid)) as uuid, name, ndc_number,
        form, size, unit, route, active
      FROM drugs ORDER BY name LIMIT 200`,
    );
  }

  // --- Patient Insurance ---
  async getPatientInsurance(pid: number) {
    return this.dataSource.query(
      `SELECT id, LOWER(HEX(uuid)) as uuid, type, provider, plan_name,
        policy_number, group_number, subscriber_lname, subscriber_fname,
        subscriber_relationship, date, copay
      FROM insurance_data WHERE pid = ? ORDER BY type`,
      [pid],
    );
  }

  // --- Patient Medications ---
  async getPatientMedications(pid: number) {
    return this.dataSource.query(
      `SELECT id, LOWER(HEX(uuid)) as uuid, patient_id, drug, dosage,
        quantity, route, \`interval\` AS dose_interval, refills, start_date, end_date, active, note
      FROM prescriptions WHERE patient_id = ? AND active = 1
      ORDER BY start_date DESC LIMIT 100`,
      [pid],
    );
  }

  // --- Patient Allergies ---
  async getPatientAllergies(pid: number) {
    return this.dataSource.query(
      `SELECT id, title as allergen, comments as reaction, type, date
      FROM lists WHERE pid = ? AND type = 'allergy'
      ORDER BY date DESC LIMIT 100`,
      [pid],
    );
  }
}
