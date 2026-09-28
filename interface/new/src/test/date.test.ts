import { describe, it, expect } from 'vitest';
import { formatDateOnly, toDateInput } from '../utils/date';

/**
 * Date-only handling.
 *
 * A DATE column has no time or timezone, so it must cross the API as a date-only
 * string. When it arrives as a JS Date instead, mysql2 reads it in server-local
 * time and JSON serialises it in UTC — a patient whose DOB is `2026-09-28` on a
 * UTC+2 server came back as `2026-09-27T22:00:00.000Z`, and the walk-in column
 * showed the birthday a day early. The fix is `DATE_FORMAT(pd.DOB, '%Y-%m-%d')`
 * in the query; these cases record why.
 */
describe('formatDateOnly', () => {
  it('keeps the day for the date-only strings the API sends', () => {
    expect(formatDateOnly('2026-09-28')).toBe('2026-09-28');
    expect(formatDateOnly('2026-01-01')).toBe('2026-01-01');
  });

  it('keeps the day for a local datetime and for a date-and-time string', () => {
    expect(formatDateOnly('2026-09-27 23:21:20')).toBe('2026-09-27');
    expect(formatDateOnly('2026-09-27T23:21:20')).toBe('2026-09-27');
  });

  it('documents the trap: a UTC-shifted datetime slices to the previous day', () => {
    // Not a desired outcome — the reason DATE_FORMAT is used server-side. If this
    // ever starts failing, the API began sending a different shape.
    expect(formatDateOnly('2026-09-27T22:00:00.000Z')).toBe('2026-09-27');
  });

  it('shows a placeholder for empty values', () => {
    expect(formatDateOnly(null)).toBe('—');
    expect(formatDateOnly(undefined)).toBe('—');
    expect(formatDateOnly('')).toBe('—');
    expect(formatDateOnly('   ')).toBe('—');
  });
});

describe('toDateInput', () => {
  it('formats the local calendar date, not the UTC one', () => {
    // 00:30 local on the 28th is still the 27th in UTC for a UTC+2 server; the
    // input must show the local day the user means.
    const local = new Date(2026, 8, 28, 0, 30);
    expect(toDateInput(local)).toBe('2026-09-28');
  });

  it('passes through date-only strings', () => {
    expect(toDateInput('2026-09-28')).toBe('2026-09-28');
  });

  it('is empty for empty values', () => {
    expect(toDateInput(null)).toBe('');
    expect(toDateInput(undefined)).toBe('');
  });
});
