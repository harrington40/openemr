import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  OBSERVATION_ROLES,
  PHYSICIAN_ONLY_ROLES,
  VITALS_ROLES,
  canManageChartRecords,
  canRecordObservations,
  canRecordVitals,
  readOnlyNote,
} from '../utils/clinicalPermissions';

// Read once, at module scope: the guards straight out of the controller so the
// frontend mirror and the API cannot drift silently. Skipped when the backend tree
// is not next to this one (a standalone frontend checkout).
const CONTROLLER_PATH = join(
  __dirname, '..', '..', '..', '..', 'backend', 'src', 'clinical', 'clinical.controller.ts',
);
const HAS_BACKEND = existsSync(CONTROLLER_PATH);

const CHART_PAGE = join(
  __dirname, '..', 'features', 'patients', 'PatientDetailPage.tsx',
);

/**
 * The chart's save buttons against the API's rules.
 *
 * The bug this covers: every clinical tab was passed `readOnly={role === 'nurse'}`.
 * That is right for allergies/medications/conditions/immunizations, but the API
 * accepts observations *from nurses* — so a nurse saw the form and no Save button,
 * exactly the "saving observations is not working" report.
 */
describe('observation and vitals permissions', () => {
  it('lets nurses record observations, because the API does', () => {
    expect(canRecordObservations('nurse')).toBe(true);
    expect(canRecordObservations('midwife')).toBe(true);
    expect(canRecordObservations('physician')).toBe(true);
    expect(canRecordObservations('admin')).toBe(true);
  });

  it('does not let a role the API refuses fill in the form', () => {
    for (const role of ['front_desk', 'billing', 'lab_tech', 'pharmacist', '']) {
      expect(canRecordObservations(role)).toBe(false);
      expect(canRecordObservations(role)).toBe(canRecordVitals(role));
    }
  });

  it('keeps vitals to the three roles createVital allows', () => {
    expect(canRecordVitals('admin')).toBe(true);
    expect(canRecordVitals('physician')).toBe(true);
    expect(canRecordVitals('nurse')).toBe(true);
    // A midwife may chart observations but not vitals — the API is explicit.
    expect(canRecordObservations('midwife')).toBe(true);
    expect(canRecordVitals('midwife')).toBe(false);
  });

  it('handles a missing role without throwing', () => {
    expect(canRecordObservations(undefined)).toBe(false);
    expect(canRecordObservations(null)).toBe(false);
    expect(canRecordVitals(undefined)).toBe(false);
  });

  it('explains the refusal, naming the roles and the signed-in one', () => {
    const note = readOnlyNote('observations', 'front_desk');
    expect(note).toMatch(/front_desk/);
    expect(note).toMatch(/admin, physician, nurse or midwife/);

    const vitalsNote = readOnlyNote('vitals', 'midwife');
    expect(vitalsNote).toMatch(/admin, physician or nurse/);
    expect(vitalsNote).toMatch(/midwife/);
  });

  it('keeps the physician-owned tabs closed to everyone else', () => {
    expect(canManageChartRecords('admin')).toBe(true);
    expect(canManageChartRecords('physician')).toBe(true);
    // Today's behaviour for a nurse was right; the other roles were the hole —
    // they saw an editable form and got a silent 403 on save.
    for (const role of ['nurse', 'midwife', 'front_desk', 'billing', 'lab_tech', '']) {
      expect(canManageChartRecords(role)).toBe(false);
    }
  });

  it('wires the chart tabs to these rules, not an inline role check', () => {
    // The regression itself: `readOnly={isNurse}` on the Observations tab hid the
    // Save button from nurses while the API accepted their writes.
    const page = readFileSync(CHART_PAGE, 'utf8');
    expect(page).toMatch(/readOnly=\{!canRecordObservations\(/);
    expect(page).toMatch(/readOnly=\{!canRecordVitals\(/);
    expect(page).toMatch(/readOnly=\{!canManageChartRecords\(/);
    expect(page).not.toMatch(/readOnly=\{isNurse\}/);
    expect(page).not.toMatch(/const isNurse/);
  });

  it.skipIf(!HAS_BACKEND)('matches the @Roles on createObservation, createVital and the chart tabs', () => {
    const controller = readFileSync(CONTROLLER_PATH, 'utf8');

    // Anchor on the method *declaration*: a bare `indexOf('createMedication(')`
    // finds the call inside createPrescription's body and reports the wrong guard.
    const rolesFor = (handler: string) => {
      const match = new RegExp(
        `@Roles\\(([^)]*)\\)\\s*\\n\\s*${handler.replace('(', '\\(')}`,
      ).exec(controller);
      expect(match, `no @Roles directly above ${handler} in the controller`).not.toBeNull();
      return match![1].split(',').map((r) => r.trim().replace(/'/g, '')).filter(Boolean);
    };

    expect(rolesFor('createObservation(')).toEqual([...OBSERVATION_ROLES]);
    expect(rolesFor('createVital(')).toEqual([...VITALS_ROLES]);
    for (const handler of ['createAllergy(', 'createMedication(', 'createCondition(', 'createImmunization(']) {
      expect(rolesFor(handler), handler).toEqual([...PHYSICIAN_ONLY_ROLES]);
    }
  });
});
