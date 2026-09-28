/** Encounter record from the OpenEMR API */
export interface Encounter {
  id: string;
  uuid: string;
  puuid?: string;
  date: string;
  reason?: string;
  facility?: string;
  facility_id?: string;
  pid?: string;
  onset_date?: string;
  sensitivity?: string;
  billing_note?: string;
  pc_catid?: string;
  pc_catname?: string;
  last_level_billed?: string;
  last_level_closed?: string;
  last_stmt_date?: string;
  stmt_count?: string;
  provider_id?: string;
  supervisor_id?: string;
  invoice_refno?: string;
  referral_source?: string;
  billing_facility?: string;
  billing_facility_name?: string;
  external_id?: string;
  pos_code?: string;
  class_code?: string;
  class_title?: string;
}

/** Payload for creating/updating an encounter */
export interface EncounterCreatePayload {
  date: string;
  reason?: string;
  facility?: string;
  facility_id?: string;
  pc_catid: string;
  class_code: string;
  provider_id?: string;
  sensitivity?: string;
  billing_facility?: string;
  onset_date?: string;
  pos_code?: string;
  referral_source?: string;
}

/** SOAP note */
export interface SoapNote {
  id: string;
  encounter_id: string;
  date: string;
  subjective?: string;
  objective?: string;
  assessment?: string;
  plan?: string;
}

/** Vital signs */
export interface VitalSign {
  id: string;
  encounter_id: string;
  date: string;
  weight?: string;
  height?: string;
  BMI?: string;
  BP_systolic?: string;
  BP_diastolic?: string;
  pulse?: string;
  temperature?: string;
  respiration?: string;
  oxygen_saturation?: string;
  waist_circumference?: string;
  head_circumference?: string;
}
