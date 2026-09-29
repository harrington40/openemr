/**
 * Pure inventory status + quantity rules.
 *
 * Kept free of any database dependency so the rules can be unit-tested in
 * isolation and reused consistently across the service and (future) modules.
 */

export type StockStatus =
    | 'IN_STOCK'
    | 'LOW_STOCK'
    | 'OUT_OF_STOCK'
    | 'NOT_STOCKED';
export type ExpirationStatus =
    | 'OK'
    | 'EXPIRING_SOON'
    | 'EXPIRED'
    | 'NO_EXPIRATION';
export type TransactionType =
    | 'RECEIVE'
    | 'ISSUE'
    | 'TRANSFER'
    | 'RETURN'
    | 'ADJUSTMENT';

/** Default expiration alert window (days). */
export const DEFAULT_EXPIRATION_ALERT_DAYS = 90;

export interface StockRuleInput {
    current: number | string | null | undefined;
    minimum: number | string | null | undefined;
}

export interface ExpirationRuleInput {
    expirationDate: string | Date | null | undefined;
    now?: Date;
    alertDays?: number;
}

const toNum = (value: unknown): number => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
};

const startOfDay = (d: Date): Date =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * Parse an expiration date without timezone drift.
 * Date-only strings ("YYYY-MM-DD", as stored in a DATE column) are interpreted
 * as local midnight rather than UTC midnight, so day arithmetic stays stable
 * across timezones.
 */
function parseDate(value: string | Date | null | undefined): Date | null {
    if (!value) return null;
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }
    const s = String(value).trim();
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (dateOnly) {
        return new Date(
            Number(dateOnly[1]),
            Number(dateOnly[2]) - 1,
            Number(dateOnly[3]),
        );
    }
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * OUT OF STOCK:  current_quantity == 0 AND the item is expected to carry stock
 *                (minimum_quantity > 0, or has inventory history).
 * NOT STOCKED:   current_quantity == 0 AND minimum_quantity == 0 — a catalog /
 *                price-list entry, not a physical stock item.
 * LOW STOCK:     current_quantity > 0 AND current_quantity <= minimum_quantity
 * IN STOCK:      current_quantity > minimum_quantity
 */
export function computeStockStatus(
    current: StockRuleInput['current'],
    minimum: StockRuleInput['minimum'],
): StockStatus {
    const qty = toNum(current);
    const min = toNum(minimum);
    if (qty <= 0) return min <= 0 ? 'NOT_STOCKED' : 'OUT_OF_STOCK';
    if (qty <= min) return 'LOW_STOCK';
    return 'IN_STOCK';
}

/**
 * How much of its minimum an item still holds: 0 = empty, 1 = exactly at the
 * minimum, above 1 = more than the minimum. `null` when there is no minimum to
 * compare against, i.e. a catalog entry that is not a physical stock item.
 */
export function depletionRatio(
    current: StockRuleInput['current'],
    minimum: StockRuleInput['minimum'],
): number | null {
    const min = toNum(minimum);
    if (min <= 0) return null;
    return toNum(current) / min;
}

/** Minimal shape the depletion comparator needs. */
export interface DepletionSortable {
    current_quantity: number | string | null | undefined;
    minimum_quantity: number | string | null | undefined;
    /** Optional; breaks a tie between two equally depleted items. */
    suggested_quantity?: number | string | null | undefined;
}

/**
 * Rank stock by urgency: most depleted first, so an item sitting at 10% of its
 * minimum is listed before one at 90%.
 *
 * Shared by `lowStock()`, the dashboard list and the reorder suggestions so the
 * three cannot drift apart — the reorder list previously sorted ascending on the
 * suggested quantity, which put the *smallest* shortfall at the top of a list a
 * buyer works down from the top.
 *
 * Rows with no minimum (not stocked) have no ratio and sort last.
 */
export function compareByDepletion(
    a: DepletionSortable,
    b: DepletionSortable,
): number {
    const ar = depletionRatio(a.current_quantity, a.minimum_quantity);
    const br = depletionRatio(b.current_quantity, b.minimum_quantity);
    if (ar === null && br === null) return 0;
    if (ar === null) return 1;
    if (br === null) return -1;
    if (ar !== br) return ar - br;
    // Equally depleted: the bigger shortfall is the more urgent one.
    return toNum(b.suggested_quantity) - toNum(a.suggested_quantity);
}

/**
 * EXPIRED:       expiration_date < today
 * EXPIRING_SOON: within alertDays of today (and not expired)
 * NO_EXPIRATION: no expiration date recorded
 * OK:            otherwise
 */
export function computeExpirationStatus(
    expirationDate: ExpirationRuleInput['expirationDate'],
    now: Date = new Date(),
    alertDays: number = DEFAULT_EXPIRATION_ALERT_DAYS,
): ExpirationStatus {
    const exp = parseDate(expirationDate);
    if (!exp) return 'NO_EXPIRATION';

    const today = startOfDay(now).getTime();
    const expiry = startOfDay(exp).getTime();

    if (expiry < today) return 'EXPIRED';
    const daysUntil = Math.ceil((expiry - today) / 86_400_000);
    if (daysUntil <= alertDays) return 'EXPIRING_SOON';
    return 'OK';
}

/** Whole days until expiration (negative if already expired), or null. */
export function daysUntilExpiration(
    expirationDate: ExpirationRuleInput['expirationDate'],
    now: Date = new Date(),
): number | null {
    const exp = parseDate(expirationDate);
    if (!exp) return null;
    return Math.round(
        (startOfDay(exp).getTime() - startOfDay(now).getTime()) / 86_400_000,
    );
}

/**
 * Apply a signed change to a stock level.
 * Throws when the change would drive stock negative (unless explicitly allowed).
 */
export function applyStockChange(
    current: number | string | null | undefined,
    delta: number,
    allowNegative = false,
): number {
    const cur = toNum(current);
    const next = cur + delta;
    if (!allowNegative && next < 0) {
        throw new Error(
            `Insufficient stock: only ${cur} available but the operation requires ${Math.abs(delta)}`,
        );
    }
    return next;
}

export interface TransactionDelta {
    /** Signed change to apply to the source item. */
    delta: number;
}

/**
 * Map a transaction type + quantity (+ optional target quantity for
 * ADJUSTMENT) to the signed delta for the source item.
 */
export function resolveTransactionDelta(
    type: TransactionType,
    quantity: number,
    currentQuantity: number,
    targetQuantity?: number | null,
): TransactionDelta {
    const qty = toNum(quantity);
    if (qty <= 0) {
        throw new Error('Quantity must be a positive number');
    }

    switch (type) {
        case 'RECEIVE':
        case 'RETURN':
            return { delta: qty };
        case 'ISSUE':
            return { delta: -qty };
        case 'TRANSFER':
            // Source loses the quantity; the destination item is credited separately.
            return { delta: -qty };
        case 'ADJUSTMENT': {
            const target = toNum(targetQuantity);
            if (targetQuantity === undefined || targetQuantity === null) {
                throw new Error(
                    'A target quantity is required for adjustments',
                );
            }
            if (target < 0) {
                throw new Error('Adjusted quantity cannot be negative');
            }
            return { delta: target - toNum(currentQuantity) };
        }
        default:
            // Exhaustive by type; this only runs for a value that bypassed it.
            throw new Error(`Unsupported transaction type: ${String(type)}`);
    }
}

/** Stable ordering of statuses for display + filters. */
export const STOCK_STATUSES: StockStatus[] = [
    'OUT_OF_STOCK',
    'LOW_STOCK',
    'IN_STOCK',
];

export const EXPIRATION_STATUSES: ExpirationStatus[] = [
    'EXPIRED',
    'EXPIRING_SOON',
    'OK',
    'NO_EXPIRATION',
];
