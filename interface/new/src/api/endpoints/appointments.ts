import nestClient from '../nest-client';
import type { Appointment, AppointmentCreatePayload } from '../../types/appointment';

/** Fetch all appointments (with optional date filters via query params) */
export async function getAppointments(params?: {
  date?: string;
  startDate?: string;
  endDate?: string;
  provider?: string;
}): Promise<Appointment[]> {
  const response = await nestClient.get('/appointments', { params });
  return response.data;
}

/**
 * Reject an id that would be interpolated into a URL as `undefined`.
 *
 * A missing `pc_eid` used to produce `/appointments/undefined`, which the server
 * then read as NaN — the same fault as the backend guard in `common/id.util.ts`,
 * caught one layer earlier where the mistake is easier to attribute.
 */
export function assertId(value: unknown, label = 'id'): number {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${label} must be a positive whole number (received ${JSON.stringify(value)}).`);
  }
  return n;
}

/** Fetch a single appointment by EID */
export async function getAppointment(eid: number): Promise<Appointment> {
  const response = await nestClient.get(`/appointments/${assertId(eid, 'Appointment id')}`);
  return response.data;
}

/** Fetch appointments for a specific patient */
export async function getPatientAppointments(pid: string): Promise<Appointment[]> {
  const response = await nestClient.get(`/patients/${pid}/appointments`);
  return response.data;
}

/** Create a new appointment for a patient */
export async function createAppointment(
  pid: string,
  data: AppointmentCreatePayload,
): Promise<Appointment> {
  const response = await nestClient.post(`/patients/${pid}/appointments`, data);
  return response.data;
}

/** Delete an appointment */
export async function deleteAppointment(pid: string, eid: number): Promise<void> {
  await nestClient.delete(`/patients/${assertId(pid, 'Patient id')}/appointments/${assertId(eid, 'Appointment id')}`);
}
