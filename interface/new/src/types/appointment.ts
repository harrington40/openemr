/** Appointment record from the OpenEMR API */
export interface Appointment {
  pc_eid: number;
  pc_uuid?: string;
  puuid?: string;
  pc_pid?: number;
  pid?: number;
  patient_id?: number;
  fname?: string;
  lname?: string;
  patient_public_id?: string;
  DOB?: string;
  pc_aid?: number;
  pce_aid_uuid?: string;
  pce_aid_fname?: string;
  pce_aid_lname?: string;
  pc_apptstatus?: string;
  pc_eventDate: string;
  /**
   * `DATE_FORMAT(pc_eventDate, '%Y-%m-%d')` from the API. Prefer this when you need
   * the calendar day: `pc_eventDate` is a DATE column that crosses the wire as a JS
   * Date, so a 2026-09-17 appointment arrives as "2026-09-16T22:00:00.000Z".
   */
  eventDateStr?: string;
  pc_startTime: string;
  pc_endTime?: string;
  pc_time?: string;
  pc_facility?: number;
  pc_billing_location?: number;
  pc_catid?: number;
  pc_catname?: string;
  pc_duration?: number;
  pc_title: string;
  pc_hometext?: string;
  pc_website?: string;
  // Flow board enriched fields
  provider_name?: string;
  provider_title?: string;
  provider_color?: string;
  checked_in_at?: string;
  wait_minutes?: number;
  patient_provider_name?: string;
}

/** Appointment status colors */
export const APPOINTMENT_STATUS_COLORS: Record<string, string> = {
  '': 'bg-secondary',
  'Scheduled': 'bg-primary',
  'Checked In': 'bg-info',
  'Checked Out': 'bg-success',
  'Canceled': 'bg-danger',
  'No Show': 'bg-warning text-dark',
  'Pending': 'bg-warning text-dark',
};

/** Appointment creation payload */
export interface AppointmentCreatePayload {
  pc_catid: number;
  pc_title: string;
  pc_duration: number;
  pc_hometext: string;
  pc_apptstatus: string;
  pc_eventDate: string;
  pc_startTime: string;
  pc_facility: number;
  pc_billing_location: number;
  pc_aid?: number;
  pid?: number;
}
