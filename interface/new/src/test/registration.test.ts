import { describe, it, expect } from 'vitest';
import {
  EMPTY_REGISTRATION,
  canAdvance,
  invalidPhone,
  registrationPayload,
  type RegistrationForm,
} from '../features/patients/components/RegisterPatientModal';

/**
 * The registration contract shared by the register page and the emergency window.
 *
 * The payload shape matters more than it looks: the nurse dashboard lists only
 * `status = 'active'` patients, so an emergency registration that quietly filed
 * `pending` would leave the patient invisible to the ward while they are lying in
 * a resuscitation bay.
 */
const form = (over: Partial<RegistrationForm> = {}): RegistrationForm => ({
  ...EMPTY_REGISTRATION,
  fname: 'Ada',
  lname: 'Bility',
  ...over,
});

describe('canAdvance', () => {
  it('requires both names, since the chart is filed under them', () => {
    expect(canAdvance(form())).toBe(true);
    expect(canAdvance(form({ fname: '' }))).toBe(false);
    expect(canAdvance(form({ lname: '' }))).toBe(false);
  });

  it('treats whitespace as empty', () => {
    expect(canAdvance(form({ fname: '   ' }))).toBe(false);
    expect(canAdvance(form({ lname: '\t' }))).toBe(false);
  });
});

describe('registrationPayload', () => {
  it('trims names and keeps the fields the API expects', () => {
    const payload = registrationPayload(form({ fname: ' Ada ', lname: ' Bility ', mname: '  M ' }));
    expect(payload.fname).toBe('Ada');
    expect(payload.lname).toBe('Bility');
    expect(payload.mname).toBe('M');
  });

  it('sends a null date of birth rather than an empty string', () => {
    expect(registrationPayload(form({ DOB: '' })).DOB).toBeNull();
    expect(registrationPayload(form({ DOB: '1990-01-01' })).DOB).toBe('1990-01-01');
  });

  it('omits the provider when none was chosen, and includes it when one was', () => {
    expect(registrationPayload(form({ providerID: '' })).providerID).toBeUndefined();
    expect(registrationPayload(form({ providerID: '12' })).providerID).toBe(12);
    // A non-numeric selection must not become NaN in the SQL params.
    expect(registrationPayload(form({ providerID: 'abc' })).providerID).toBeUndefined();
  });

  it('passes status through only when the caller sets it', () => {
    // Normal registration: let the service default apply (`active`).
    expect(registrationPayload(form()).status).toBeUndefined();
    // Emergency arrival: active, so the ward can see the patient immediately.
    expect(registrationPayload(form(), 'active').status).toBe('active');
    // Nurse-aide intake: pending, for registrar approval.
    expect(registrationPayload(form(), 'pending').status).toBe('pending');
  });

  it('never sends undefined fields that would break the insert', () => {
    const payload = registrationPayload(form());
    for (const [key, value] of Object.entries(payload)) {
      expect(value, `${key} must not be undefined`).not.toBeUndefined();
    }
  });
});

describe('invalidPhone', () => {
  it('accepts a blank phone and rejects a malformed national number', () => {
    expect(invalidPhone(form({ phone_contact: '' }))).toBe(false);
    expect(invalidPhone(form({ phone_contact: '231' }))).toBe(true);
  });
});
