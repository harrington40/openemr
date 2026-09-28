import nestClient from '../nest-client';
import type { Allergy } from '../../types/allergy';

export async function getPatientAllergies(puuid: string): Promise<Allergy[]> {
  const response = await nestClient.get(`/patients/${puuid}/allergies`);
  return response.data;
}

export async function createAllergy(puuid: string, data: { allergen: string; reaction?: string }): Promise<{ id: number }> {
  const response = await nestClient.post(`/patients/${puuid}/allergies`, data);
  return response.data;
}

export async function deleteAllergy(puuid: string, id: number): Promise<void> {
  await nestClient.delete(`/patients/${puuid}/allergies/${id}`);
}
