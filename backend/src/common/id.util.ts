import { BadRequestException } from '@nestjs/common';

/**
 * Parse an id from a route parameter, safely.
 *
 * `parseInt('abc', 10)` is `NaN`, and mysql2 interpolates placeholders on the
 * client — so a NaN reached the database as the bare token `NaN` and MySQL read
 * it as a column name: `Unknown column 'NaN' in 'WHERE'`, returned to the caller
 * as a 500 that leaks the query. That is what a stale link to
 * `/appointments/some-uuid` did.
 *
 * Rejecting it at the boundary gives a 400 that says what is wrong, and keeps a
 * malformed id from ever being described as "not found" (which invites a retry
 * that can never work).
 */
/** Render a rejected value for an error message; objects are described by type. */
function describeValue(value: unknown): string {
    if (value === undefined || value === null) return '(missing)';
    if (typeof value === 'string') return `"${value}"`;
    if (typeof value === 'number' || typeof value === 'boolean') {
        return `"${String(value)}"`;
    }
    return `[${typeof value}]`;
}

export function parseNumericId(value: unknown, label = 'id'): number {
    // Only numbers and strings can be ids. A boolean is the sneaky one:
    // `Number(true)` is 1, so allowing it would silently fetch record #1.
    if (typeof value !== 'number' && typeof value !== 'string') {
        const shown = describeValue(value);
        throw new BadRequestException(
            `${label} must be a positive whole number — received ${shown}.`,
        );
    }

    const raw = typeof value === 'string' ? value.trim() : value;
    const n = Number(raw);

    if (!Number.isInteger(n) || n <= 0) {
        const shown = raw === '' ? '(missing)' : `"${String(value)}"`;
        throw new BadRequestException(
            `${label} must be a positive whole number — received ${shown}.`,
        );
    }
    return n;
}

/** Non-throwing variant, for callers that want to decide what to do. */
export function isNumericId(value: unknown): boolean {
    try {
        parseNumericId(value);
        return true;
    } catch {
        return false;
    }
}
