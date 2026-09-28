import { isNumericId, parseNumericId } from './id.util';

/**
 * Id parsing at the request boundary.
 *
 * This exists because `parseInt('abc', 10)` is `NaN`, mysql2 interpolates
 * placeholders client-side, and `String(NaN)` is the unquoted token `NaN` — so
 * MySQL read it as a column name and answered
 * `Unknown column 'NaN' in 'WHERE'` as a 500 from a stale link.
 */
describe('parseNumericId', () => {
  it('accepts whole positive ids as numbers or strings', () => {
    expect(parseNumericId(5)).toBe(5);
    expect(parseNumericId('5')).toBe(5);
    expect(parseNumericId(' 42 ')).toBe(42);
    expect(parseNumericId(1)).toBe(1);
  });

  it('rejects a non-numeric id instead of producing NaN', () => {
    // The exact request that caused the database error.
    expect(() => parseNumericId('some-uuid')).toThrow(/positive whole number/);
    expect(() => parseNumericId('undefined')).toThrow();
    expect(() => parseNumericId(NaN)).toThrow();
    expect(() => parseNumericId(undefined)).toThrow();
    expect(() => parseNumericId(null)).toThrow();
    expect(() => parseNumericId('')).toThrow();
  });

  it('rejects the values that would silently become something else', () => {
    // '12abc' -> parseInt would give 12, Number gives NaN. Reject it.
    expect(() => parseNumericId('12abc')).toThrow();
    // 0 and negatives are not valid auto-increment ids.
    expect(() => parseNumericId(0)).toThrow();
    expect(() => parseNumericId(-3)).toThrow();
    expect(() => parseNumericId('0')).toThrow();
    // Fractions mean the caller computed something wrong.
    expect(() => parseNumericId(3.5)).toThrow();
    // Booleans are not ids.
    expect(() => parseNumericId(true)).toThrow();
  });

  it('names the parameter and shows what arrived, so the caller can see it', () => {
    expect(() => parseNumericId('abc', 'Appointment id')).toThrow(/Appointment id.*"abc"/);
    expect(() => parseNumericId('', 'Patient id')).toThrow(/Patient id.*\(missing\)/);
  });

  it('isNumericId answers without throwing', () => {
    expect(isNumericId(7)).toBe(true);
    expect(isNumericId('7')).toBe(true);
    expect(isNumericId('abc')).toBe(false);
    expect(isNumericId(undefined)).toBe(false);
  });
});
