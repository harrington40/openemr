import nestClient from '../nest-client';

export interface Immunization {
  id: number;
  patient_id: number;
  administered_date: string;
  cvx_code: string;
  manufacturer: string;
  lot_number: string;
  administered_by: string;
  note: string;
  route: string;
  administration_site: string;
  completion_status: string;
}

export async function getPatientImmunizations(pid: string): Promise<Immunization[]> {
  const response = await nestClient.get(`/patients/${pid}/immunizations`);
  return response.data;
}

export async function createImmunization(pid: string, data: Partial<Immunization>): Promise<{ id: number }> {
  const response = await nestClient.post(`/patients/${pid}/immunizations`, data);
  return response.data;
}

export async function deleteImmunization(pid: string, id: number): Promise<void> {
  await nestClient.delete(`/patients/${pid}/immunizations/${id}`);
}
