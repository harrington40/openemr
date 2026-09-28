/**
 * Helpers for building patient-chart links.
 *
 * The API returns several spellings for a patient reference:
 *   patientId / id    -> patient_data.id   (what /patients/:id matches first)
 *   patientPid / pid  -> patient_data.pid  (OpenEMR pid)
 *
 * On the OpenEMR schema these are NOT the same value (typically id = pid + 1),
 * and notifications used to be written with pid = 0. Resolving the id here
 * keeps two failure modes out of the UI:
 *   1. navigating to /patients/0 (or /patients/undefined) -> "Failed to load"
 *   2. falling back to a pid and landing on the neighbouring patient
 */

/** First usable positive integer among the candidates, else null. */
export function chartPatientId(...candidates: unknown[]): number | null {
  for (const candidate of candidates) {
    const n = Number(candidate);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/** `/patients/<id>` for the best available identifier, else null. */
export function patientChartPath(...candidates: unknown[]): string | null {
  const id = chartPatientId(...candidates);
  return id === null ? null : `/patients/${id}`;
}
