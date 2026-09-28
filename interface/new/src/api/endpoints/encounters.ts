import nestClient from '../nest-client';
import type { Encounter, EncounterCreatePayload, SoapNote, VitalSign } from '../../types/encounter';

/** Fetch encounters for a patient */
export async function getPatientEncounters(puuid: string): Promise<Encounter[]> {
  const response = await nestClient.get(`/patients/${puuid}/encounters`);
  return response.data;
}

/** Fetch a single encounter */
export async function getEncounter(puuid: string, euuid: string): Promise<Encounter> {
  const response = await nestClient.get(`/patients/${puuid}/encounters/${euuid}`);
  return response.data;
}

/** Create a new encounter */
export async function createEncounter(
  puuid: string,
  data: EncounterCreatePayload,
): Promise<Encounter> {
  const response = await nestClient.post(`/patients/${puuid}/encounters`, data);
  return response.data;
}

/** Update an encounter */
export async function updateEncounter(
  puuid: string,
  euuid: string,
  data: Partial<EncounterCreatePayload>,
): Promise<Encounter> {
  const response = await nestClient.put(`/patients/${puuid}/encounters/${euuid}`, data);
  return response.data;
}

/** Fetch SOAP notes for an encounter */
export async function getSoapNotes(
  pid: string,
  eid: string,
): Promise<SoapNote[]> {
  const response = await nestClient.get(`/patients/${pid}/encounters/${eid}/soap`);
  return response.data;
}

/** Fetch vitals for an encounter */
export async function getVitals(
  pid: string,
  eid: string,
): Promise<VitalSign[]> {
  const response = await nestClient.get(`/patients/${pid}/encounters/${eid}/vitals`);
  return response.data;
}
