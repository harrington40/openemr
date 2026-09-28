import nestClient from '../nest-client';
import type { Insurance } from '../../types/insurance';

/** Fetch insurance records for a patient */
export async function getPatientInsurance(puuid: string): Promise<Insurance[]> {
  const response = await nestClient.get(`/patients/${puuid}/insurance`);
  return response.data;
}
