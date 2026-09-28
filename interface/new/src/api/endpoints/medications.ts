import nestClient from '../nest-client';
import type { Medication } from '../../types/medication';

export async function getPatientMedications(pid: string): Promise<Medication[]> {
  const response = await nestClient.get(`/patients/${pid}/medications`);
  return response.data;
}

export async function createMedication(pid: string, data: Partial<Medication>): Promise<{ id: number }> {
  const response = await nestClient.post(`/patients/${pid}/medications`, data);
  return response.data;
}

export async function updateMedication(pid: string, id: number, data: Partial<Medication>): Promise<void> {
  await nestClient.put(`/patients/${pid}/medications/${id}`, data);
}

export async function deleteMedication(pid: string, id: number): Promise<void> {
  await nestClient.delete(`/patients/${pid}/medications/${id}`);
}
