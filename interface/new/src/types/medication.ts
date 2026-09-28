/** Medication record from the OpenEMR API */
export interface Medication {
  id?: number;
  list_id?: string;
  puuid?: string;
  title: string;
  code?: string;
  code_text?: string;
  code_table?: string;
  provider?: string;
  provider_uuid?: string;
  drug_code?: string;
  drug_code_text?: string;
  dosage?: string;
  dosage_label?: string;
  quantity?: string;
  size?: string;
  refills?: string;
  note?: string;
  begin_date?: string;
  end_date?: string;
  date_added?: string;
  date_modified?: string;
  unit?: string;
  route?: string;
  interval?: string;
  subscription?: string;
  referrals_source?: string;
  encountered?: string;
  encounter_uuid?: string;
  created_by?: string;
}
