import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { Response } from 'express';

/** `patient_data` row for the CCDA header. */
interface CcdaPatientRow {
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
}

/** `lists` row (allergy / problem). */
interface CcdaListRow {
    title: string;
    comments?: string | null;
    date?: string | null;
}

/** `prescriptions` row. */
interface CcdaMedicationRow {
    drug: string | null;
    dosage: string | null;
    start_date: string | null;
}

/** `form_vitals` row. */
interface CcdaVitalsRow {
    date: string;
    bps: number | string | null;
    bpd: number | string | null;
    weight: number | string | null;
    height: number | string | null;
    temperature: number | string | null;
    pulse: number | string | null;
}

/** `form_encounter` row. */
interface CcdaEncounterRow {
    id: number;
    date: string | null;
    reason: string | null;
    class_code: string | null;
}

@Controller()
@UseGuards(JwtAuthGuard)
export class CcdaController {
    constructor(@InjectDataSource() private dataSource: DataSource) {}

    @Get('patients/:pid/ccda')
    async generateCcda(@Param('pid') pid: string, @Res() res: Response) {
        const [patient] = await this.dataSource.query<CcdaPatientRow[]>(
            `SELECT id, fname, lname, mname, DOB, sex, street, city, state, postal_code, phone_contact FROM patient_data WHERE id = ?`,
            [+pid],
        );
        if (!patient)
            return res.status(404).json({ error: 'Patient not found' });

        const allergies = await this.dataSource.query<CcdaListRow[]>(
            `SELECT title, comments FROM lists WHERE pid = ? AND type='allergy' AND activity=1`,
            [+pid],
        );
        const medications = await this.dataSource.query<CcdaMedicationRow[]>(
            `SELECT drug, dosage, start_date FROM prescriptions WHERE patient_id=? AND active=1`,
            [+pid],
        );
        const conditions = await this.dataSource.query<CcdaListRow[]>(
            `SELECT title, date FROM lists WHERE pid=? AND type='medical_problem'`,
            [+pid],
        );
        const vitals = await this.dataSource.query<CcdaVitalsRow[]>(
            `SELECT date, bps, bpd, weight, height, temperature, pulse FROM form_vitals WHERE pid=? ORDER BY date DESC LIMIT 5`,
            [+pid],
        );
        const encounters = await this.dataSource.query<CcdaEncounterRow[]>(
            `SELECT id, date, reason, class_code FROM form_encounter WHERE pid=? ORDER BY date DESC LIMIT 10`,
            [+pid],
        );

        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ClinicalDocument xmlns="urn:hl7-org:v3" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <realmCode code="US"/>
  <typeId root="2.16.840.1.113883.1.3" extension="POCD_HD000040"/>
  <templateId root="2.16.840.1.113883.10.20.22.1.1"/>
  <id root="${Date.now()}" extension="patient-${pid}"/>
  <code code="34133-9" codeSystem="2.16.840.1.113883.6.1" displayName="Summarization of Episode Note"/>
  <title>Continuity of Care Document</title>
  <effectiveTime value="${new Date().toISOString().split('T')[0]}"/>
  <confidentialityCode code="N" codeSystem="2.16.840.1.113883.5.25"/>
  <languageCode code="en-US"/>

  <recordTarget>
    <patientRole>
      <id extension="${pid}" root="2.16.840.1.113883.19.5"/>
      <addr><streetAddressLine>${patient.street || ''}</streetAddressLine><city>${patient.city || ''}</city><state>${patient.state || ''}</state><postalCode>${patient.postal_code || ''}</postalCode></addr>
      <telecom value="tel:${patient.phone_contact || ''}" use="HP"/>
      <patient>
        <name><given>${patient.fname || ''}</given><family>${patient.lname || ''}</family></name>
        <administrativeGenderCode code="${patient.sex === 'Male' ? 'M' : patient.sex === 'Female' ? 'F' : 'UN'}" codeSystem="2.16.840.1.113883.5.1"/>
        <birthTime value="${patient.DOB ? new Date(patient.DOB).toISOString().split('T')[0] : ''}"/>
      </patient>
    </patientRole>
  </recordTarget>

  ${
      allergies.length
          ? `<component><section>
    <templateId root="2.16.840.1.113883.10.20.22.2.6.1"/>
    <code code="48765-2" codeSystem="2.16.840.1.113883.6.1" displayName="Allergies"/>
    <title>Allergies</title>
    <text>${allergies.map((a) => `${a.title}: ${a.comments || 'No reaction'}`).join('; ')}</text>
  </section></component>`
          : ''
  }

  ${
      medications.length
          ? `<component><section>
    <templateId root="2.16.840.1.113883.10.20.22.2.1.1"/>
    <code code="10160-0" codeSystem="2.16.840.1.113883.6.1" displayName="Medications"/>
    <title>Medications</title>
    <text>${medications.map((m) => `${m.drug || ''} ${m.dosage || ''} (since ${m.start_date || 'unknown'})`).join('; ')}</text>
  </section></component>`
          : ''
  }

  ${
      conditions.length
          ? `<component><section>
    <templateId root="2.16.840.1.113883.10.20.22.2.5.1"/>
    <code code="11450-4" codeSystem="2.16.840.1.113883.6.1" displayName="Problems"/>
    <title>Problems</title>
    <text>${conditions.map((c) => `${c.title} (${c.date || 'unknown'})`).join('; ')}</text>
  </section></component>`
          : ''
  }

  ${
      vitals.length
          ? `<component><section>
    <templateId root="2.16.840.1.113883.10.20.22.2.4.1"/>
    <code code="8716-3" codeSystem="2.16.840.1.113883.6.1" displayName="Vital Signs"/>
    <title>Vital Signs</title>
    <text>Latest: BP ${vitals[0].bps || '—'}/${vitals[0].bpd || '—'}, Pulse ${vitals[0].pulse || '—'}, Temp ${vitals[0].temperature || '—'}°C, Weight ${vitals[0].weight || '—'}kg</text>
  </section></component>`
          : ''
  }

  ${
      encounters.length
          ? `<component><section>
    <templateId root="2.16.840.1.113883.10.20.22.2.22.1"/>
    <code code="46240-8" codeSystem="2.16.840.1.113883.6.1" displayName="Encounters"/>
    <title>Encounters</title>
    <text>${encounters.map((e) => `${e.date || 'unknown'}: ${e.reason || e.class_code || 'Visit'}`).join('; ')}</text>
  </section></component>`
          : ''
  }

</ClinicalDocument>`;

        res.setHeader('Content-Type', 'application/xml');
        res.setHeader(
            'Content-Disposition',
            `attachment; filename=ccda_patient_${pid}.xml`,
        );
        res.send(xml);
    }
}
