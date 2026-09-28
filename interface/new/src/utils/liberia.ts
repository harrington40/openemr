/**
 * Liberia-specific formatting helpers and reference data.
 * Country calling code: +231
 */

export const LIBERIA_COUNTRY_CODE = '+231';

/** Major Liberian cities/towns for address dropdowns. */
export const LIBERIA_CITIES: string[] = [
  'Monrovia',
  'Paynesville',
  'Sinkor',
  'Congo Town',
  'Buchanan',
  'Ganta',
  'Kakata',
  'Gbarnga',
  'Zwedru',
  'Harper',
  'Greenville',
  'Voinjama',
  'Tubmanburg',
  'Robertsport',
  'Sanniquellie',
  'Fish Town',
  'Barclayville',
  'Cestos City',
  'Bensonville',
  'Bomi Hills',
  'Harbel',
  'Marshall',
  'Careysburg',
  'Arthington',
  'White Plains',
  'Red Light',
];

/** Strip everything but digits from a phone value. */
export function phoneDigits(value: string | null | undefined): string {
  return (value || '').replace(/\D/g, '');
}

/**
 * Extract the national (local) part of a Liberia phone number,
 * removing the +231 country code if present.
 */
export function nationalDigits(value: string | null | undefined): string {
  let digits = phoneDigits(value);
  if (digits.startsWith('231') && digits.length > 3) {
    digits = digits.slice(3);
  }
  return digits.slice(0, 9);
}

/**
 * True when the national number itself begins with the reserved "231" prefix.
 * After the +231 country code, the first three digits must never be 231 —
 * that would duplicate the country code (e.g. +231 231 888955552) and is invalid.
 */
export function isInvalidLiberiaNationalNumber(value: string | null | undefined): boolean {
  const national = nationalDigits(value);
  return national.length >= 3 && national.startsWith('231');
}

/** Format a 9-digit national Liberian number as "888-955552" style. */
export function formatNationalNumber(digits: string): string {
  const d = digits.replace(/\D/g, '');
  if (d.length <= 3) return d;
  return `${d.slice(0, 3)}-${d.slice(3, 9)}`;
}

/** Build the full international Liberian number from local digits. */
export function toLiberiaPhone(digits: string): string {
  const d = digits.replace(/\D/g, '');
  return d ? `${LIBERIA_COUNTRY_CODE}${d}` : '';
}

/** Format a stored phone value for display, adding +231 when missing. */
export function formatLiberiaPhone(value: string | null | undefined): string {
  if (!value) return '';
  const digits = phoneDigits(value);
  if (!digits) return value;
  let national = digits;
  if (national.startsWith('231')) national = national.slice(3);
  return `${LIBERIA_COUNTRY_CODE} ${formatNationalNumber(national)}`;
}
