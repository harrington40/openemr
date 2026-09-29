/**
 * System-wide duplicate-prevention helpers.
 *
 * These utilities implement the shared "smart dedup" algorithm used across the
 * platform (labs, clinical, billing, etc.):
 *
 *   1. normalizeKey() — case-insensitive, whitespace-collapsed key so
 *      "CBC", "cbc", and "  CBC " are treated as the same entity.
 *   2. WINDOW_SQL / DEDUP_WINDOW_HOURS — a recency window so legitimate
 *      re-entries after the window are allowed.
 */
export const DEDUP_WINDOW_HOURS = 24;

export const WINDOW_SQL = `DATE_SUB(NOW(), INTERVAL ${DEDUP_WINDOW_HOURS} HOUR)`;

export function normalizeKey(value: string): string {
    return (value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}
