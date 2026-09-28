import { describe, it, expect } from 'vitest';
import { assertId } from '../api/endpoints/appointments';

/**
 * The client half of the NaN-id fix.
 *
 * A missing `pc_eid` used to become `/appointments/undefined`, which the API read
 * as NaN and passed to the database. Catching it here means the failure names the
 * component that had no id, instead of surfacing as a server error.
 */
describe('assertId', () => {
  it('passes through whole positive ids', () => {
    expect(assertId(7)).toBe(7);
    expect(assertId('7')).toBe(7);
    expect(assertId(' 7 ')).toBe(7);
  });

  it('throws for the values that produced the broken URL', () => {
    expect(() => assertId(undefined)).toThrow(/positive whole number/);
    expect(() => assertId(null)).toThrow();
    expect(() => assertId('')).toThrow();
    expect(() => assertId('undefined')).toThrow();
    expect(() => assertId(NaN)).toThrow();
  });

  it('rejects ids that are not usable ids', () => {
    expect(() => assertId(0)).toThrow();
    expect(() => assertId(-1)).toThrow();
    expect(() => assertId(2.5)).toThrow();
    expect(() => assertId('abc')).toThrow();
    expect(() => assertId(true)).toThrow();
  });

  it('names the field so the caller can be found', () => {
    expect(() => assertId(undefined, 'Appointment id')).toThrow(/Appointment id/);
  });
});
