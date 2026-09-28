import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class FhirService {
  constructor(@InjectDataSource() private dataSource: DataSource) {}

  private baseUrl = 'http://localhost:3002/fhir';

  async getPatient(id: number) {
    const rows = await this.dataSource.query(
      `SELECT id, fname, lname, mname, DOB, sex, street, city, state, postal_code, phone_contact, email
       FROM patient_data WHERE id = ?`, [id],
    );
    if (!rows.length) throw new NotFoundException(`Patient ${id} not found`);
    const p = rows[0];
    return {
      resourceType: 'Patient',
      id: String(p.id),
      name: [{ family: p.lname, given: [p.fname, p.mname].filter(Boolean) }],
      gender: p.sex?.toLowerCase() || 'unknown',
      birthDate: p.DOB ? new Date(p.DOB).toISOString().split('T')[0] : undefined,
      address: p.street ? [{ line: [p.street], city: p.city, state: p.state, postalCode: p.postal_code }] : [],
      telecom: [
        ...(p.phone_contact ? [{ system: 'phone', value: p.phone_contact }] : []),
        ...(p.email ? [{ system: 'email', value: p.email }] : []),
      ],
    };
  }

  async searchPatients(name?: string) {
    let query = `SELECT id, fname, lname, mname, DOB, sex FROM patient_data`;
    const params: any[] = [];
    if (name) { query += ' WHERE lname LIKE ? OR fname LIKE ?'; params.push(`%${name}%`, `%${name}%`); }
    query += ' LIMIT 50';
    const rows = await this.dataSource.query(query, params);
    return {
      resourceType: 'Bundle',
      type: 'searchset',
      total: rows.length,
      entry: rows.map((p: any) => ({
        resource: {
          resourceType: 'Patient',
          id: String(p.id),
          name: [{ family: p.lname, given: [p.fname, p.mname].filter(Boolean) }],
          gender: p.sex?.toLowerCase() || 'unknown',
          birthDate: p.DOB ? new Date(p.DOB).toISOString().split('T')[0] : undefined,
        },
      })),
    };
  }

  async getObservations(pid: number) {
    const rows = await this.dataSource.query(
      `SELECT id, date, bps, bpd, weight, height, temperature, pulse, respiration, BMI, oxygen_saturation
       FROM form_vitals WHERE pid = ? ORDER BY date DESC LIMIT 50`, [pid],
    );
    const entries: any[] = [];
    for (const v of rows) {
      const addObs = (code: string, display: string, value: any, unit: string, system = 'http://loinc.org') => {
        if (value == null || value === 0 || value === '') return;
        entries.push({
          resource: {
            resourceType: 'Observation',
            id: `${v.id}-${code}`,
            status: 'final',
            code: { coding: [{ system, code, display }] },
            subject: { reference: `Patient/${pid}` },
            effectiveDateTime: v.date,
            valueQuantity: { value: Number(value), unit, system: 'http://unitsofmeasure.org' },
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
    return { resourceType: 'Bundle', type: 'searchset', total: entries.length, entry: entries };
  }

  async getConditions(pid: number) {
    const rows = await this.dataSource.query(
      `SELECT id, title, comments, date FROM lists WHERE pid = ? AND type = 'medical_problem' ORDER BY date DESC`, [pid],
    );
    return {
      resourceType: 'Bundle', type: 'searchset', total: rows.length,
      entry: rows.map((c: any) => ({
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
    const rows = await this.dataSource.query(
      `SELECT id, drug, dosage, route, start_date, end_date, note FROM prescriptions
       WHERE patient_id = ? AND active = 1 ORDER BY start_date DESC`, [pid],
    );
    return {
      resourceType: 'Bundle', type: 'searchset', total: rows.length,
      entry: rows.map((m: any) => ({
        resource: {
          resourceType: 'MedicationRequest',
          id: String(m.id),
          status: m.end_date && new Date(m.end_date) < new Date() ? 'stopped' : 'active',
          intent: 'order',
          medicationCodeableConcept: { text: m.drug },
          subject: { reference: `Patient/${pid}` },
          dosageInstruction: m.dosage ? [{ text: m.dosage, route: m.route ? { text: m.route } : undefined }] : [],
          note: m.note ? [{ text: m.note }] : [],
        },
      })),
    };
  }

  async getAllergyIntolerances(pid: number) {
    const rows = await this.dataSource.query(
      `SELECT id, title, comments, date FROM lists WHERE pid = ? AND type = 'allergy' AND activity = 1`, [pid],
    );
    return {
      resourceType: 'Bundle', type: 'searchset', total: rows.length,
      entry: rows.map((a: any) => ({
        resource: {
          resourceType: 'AllergyIntolerance',
          id: String(a.id),
          code: { text: a.title },
          patient: { reference: `Patient/${pid}` },
          reaction: a.comments ? [{ manifestation: [{ text: a.comments }] }] : [],
        },
      })),
    };
  }

  async getImmunizations(pid: number) {
    const rows = await this.dataSource.query(
      `SELECT id, cvx_code, manufacturer, lot_number, administered_date, route, administration_site, note
       FROM immunizations WHERE patient_id = ? ORDER BY administered_date DESC`, [pid],
    );
    return {
      resourceType: 'Bundle', type: 'searchset', total: rows.length,
      entry: rows.map((i: any) => ({
        resource: {
          resourceType: 'Immunization',
          id: String(i.id),
          status: 'completed',
          vaccineCode: { coding: [{ code: i.cvx_code }] },
          patient: { reference: `Patient/${pid}` },
          occurrenceDateTime: i.administered_date,
          manufacturer: i.manufacturer ? { display: i.manufacturer } : undefined,
          lotNumber: i.lot_number,
          route: i.route ? { text: i.route } : undefined,
          site: i.administration_site ? { text: i.administration_site } : undefined,
        },
      })),
    };
  }

  async getEncounters(pid: number) {
    const rows = await this.dataSource.query(
      `SELECT id, date, reason, class_code FROM form_encounter WHERE pid = ? ORDER BY date DESC LIMIT 50`, [pid],
    );
    return {
      resourceType: 'Bundle', type: 'searchset', total: rows.length,
      entry: rows.map((e: any) => ({
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
