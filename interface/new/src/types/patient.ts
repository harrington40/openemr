/** Basic patient record from the OpenEMR API */
export interface Patient {
  id?: number;
  pid?: number;
  uuid: string;
  fname: string;
  lname: string;
  mname?: string;
  dob: string;
  /** The API also returns the raw column name; prefer `dob`. */
  DOB?: string;
  sex: string;
  email?: string;
  phone?: string;
  /** The API also returns the raw column name; prefer `phone`. */
  phone_contact?: string;
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  postal_code?: string;
  provider?: string | number;
  /** The API also returns the raw column name; prefer `provider`. */
  providerID?: string | number;
  provider_name?: string;
  providerName?: string;
  pubpid?: string;
  public_id?: string;
  suffix?: string;
  status?: string;
  chart_shared?: boolean;
  /** False until registration details are captured and a provider is assigned. */
  chart_complete?: boolean;
  /** Human-readable names of the registration details still outstanding. */
  missing_fields?: string[];
  image?: string;
  regdate?: string;
  created_by?: number;
}

/** Parameters for searching patients */
export interface PatientSearchParams {
  search?: string;
  fname?: string;
  lname?: string;
  dob?: string;
  limit?: number;
  offset?: number;
}
