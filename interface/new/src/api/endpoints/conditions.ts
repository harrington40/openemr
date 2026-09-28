import nestClient from '../nest-client';

export interface Condition {
  id: number;
  diagnosis: string;
  note: string;
  date: string;
  begdate: string;
  enddate: string;
}

export async function getPatientConditions(pid: string): Promise<Condition[]> {
  const response = await nestClient.get(`/patients/${pid}/conditions`);
  return response.data;
}

export async function createCondition(pid: string, data: { diagnosis: string; note?: string }): Promise<{ id: number }> {
  const response = await nestClient.post(`/patients/${pid}/conditions`, data);
  return response.data;
}

export async function updateCondition(pid: string, id: number, data: Partial<Condition>): Promise<void> {
  await nestClient.put(`/patients/${pid}/conditions/${id}`, data);
}

export async function deleteCondition(pid: string, id: number): Promise<void> {
  await nestClient.delete(`/patients/${pid}/conditions/${id}`);
}
