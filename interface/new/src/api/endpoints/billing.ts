import nestClient from '../nest-client';
import type { InsuranceCompany, Procedure, Drug } from '../../types/billing';

/** Fetch insurance companies */
export async function getInsuranceCompanies(): Promise<InsuranceCompany[]> {
  const response = await nestClient.get('/insurance-companies');
  return response.data;
}

/** Fetch procedures */
export async function getProcedures(): Promise<Procedure[]> {
  const response = await nestClient.get('/procedures');
  return response.data;
}

/** Fetch drugs */
export async function getDrugs(): Promise<Drug[]> {
  const response = await nestClient.get('/drugs');
  return response.data;
}
