/**
 * Pure decision helpers for the billing integrity rules.
 *
 * These are extracted from the service so the *decisions* — which charge lines
 * are duplicates, how an already-posted refund offsets them, the 1:1 pairing
 * between legacy charges and lab orders — can be unit tested without a database.
 *
 * They exist because the first version of these rules shipped untested and would
 * have refunded $372 of legitimate charges unattended. Money decisions belong in
 * small, provable functions.
 */

export interface MoneyLine {
    id: number;
    fee: number;
}

/**
 * Which lines are duplicates for one (order, code) group.
 *
 * Exactly one line is legitimate: the oldest one still open (not already
 * reversed). Refunds that are not already accounted for by an exact reversal link
 * are consumed against the remaining candidates, so a group that was already
 * corrected nets to zero and is never re-flagged.
 */
export function selectDuplicateLines(
    lines: MoneyLine[],
    reversedIds: Set<number>,
    refundOffsetUSD = 0,
): MoneyLine[] {
    const open = [...lines]
        .sort((a, b) => a.id - b.id)
        .filter((l) => !reversedIds.has(l.id));
    if (open.length <= 1) return [];

    let offset = Math.abs(Number(refundOffsetUSD) || 0);
    const out: MoneyLine[] = [];
    for (const candidate of open.slice(1)) {
        // keep the oldest open line
        const amount = Math.abs(Number(candidate.fee) || 0);
        if (offset >= amount - 0.005) {
            offset = Math.round((offset - amount) * 100) / 100;
            continue;
        }
        out.push(candidate);
    }
    return out;
}

export interface PairCandidate {
    legacyId: number;
    orderId: number;
}

/**
 * Greedy 1:1 pairing: one order per legacy line AND one legacy line per order.
 * Without the second guard a single line could pair with several orders and be
 * reported (and refunded) more than once.
 */
export function assignOneToOne<T extends PairCandidate>(candidates: T[]): T[] {
    const usedOrders = new Set<number>();
    const usedLines = new Set<number>();
    const out: T[] = [];
    for (const candidate of candidates) {
        if (
            usedOrders.has(candidate.orderId) ||
            usedLines.has(candidate.legacyId)
        )
            continue;
        usedOrders.add(candidate.orderId);
        usedLines.add(candidate.legacyId);
        out.push(candidate);
    }
    return out;
}

/**
 * A legacy line only duplicates an order's own charge when it is the SAME test,
 * or a generic placeholder standing in for it. Pairing is by timestamp, so
 * without this an unrelated imaging charge in the same two-minute window would be
 * reported as a duplicate lab charge.
 */
export function legacyLineMatchesOrderCharge(
    code: string,
    exact: boolean,
): boolean {
    return exact || /^(80048|LAB-)/i.test(String(code || ''));
}
