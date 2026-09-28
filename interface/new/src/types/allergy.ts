/** Allergy/Intolerance record from the OpenEMR API */
export interface Allergy {
  uuid: string;
  puuid?: string;
  puuidTitle?: string;
  title: string;
  severity?: string;
  severity_text?: string;
  reaction?: string;
  reaction_text?: string;
  allergy_type?: string;
  allergy_type_text?: string;
  begin_date?: string;
  end_date?: string;
  diagnosis?: string;
  status?: string;
}
