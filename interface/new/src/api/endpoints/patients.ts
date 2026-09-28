import nestClient from '../nest-client';
import type { Patient, PatientSearchParams } from '../../types/patient';

/** Search for patients by name, ID, or other criteria */
export async function searchPatients(
  params: PatientSearchParams,
): Promise<Patient[]> {
  const response = await nestClient.get('/patients', { params });
  return response.data;
}

/** Fetch a single patient by internal ID */
export async function getPatient(id: string): Promise<Patient> {
  const response = await nestClient.get(`/patients/${id}`);
  return response.data;
}

/** Create a new patient */
export async function createPatient(
  data: Partial<Patient>,
): Promise<Patient> {
  const response = await nestClient.post('/patients', data);
  return response.data;
}

/** Update an existing patient */
export async function updatePatient(
  id: string,
  data: Partial<Patient>,
): Promise<Patient> {
  const response = await nestClient.patch(`/patients/${id}`, data);
  return response.data;
}
