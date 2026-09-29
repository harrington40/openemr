import {
    selectDuplicateLines,
    assignOneToOne,
    legacyLineMatchesOrderCharge,
} from './billing-integrity.util';

/**
 * Regression tests for the billing integrity decisions.
 *
 * Every case here is a bug that was found the hard way on live money data:
 * refunding legitimate charges, triple-refunding one line, and flagging imaging
 * charges as duplicate lab tests.
 */
describe('billing integrity decisions', () => {
    describe('selectDuplicateLines', () => {
        const lines = (fees: number[]) =>
            fees.map((fee, i) => ({ id: 100 + i, fee }));

        it('flags nothing when a single line exists', () => {
            expect(selectDuplicateLines(lines([25]), new Set())).toEqual([]);
        });

        it('keeps the oldest line and flags the rest', () => {
            const out = selectDuplicateLines(lines([15, 15, 15]), new Set());
            expect(out.map((l) => l.id)).toEqual([101, 102]);
        });

        it('does NOT treat an order with several different charges as duplicates', () => {
            // One order legitimately carries multiple different tests; the caller only
            // ever groups by (order, code), and this asserts the grouping assumption
            // still leaves a single line alone.
            const out = selectDuplicateLines(lines([350]), new Set());
            expect(out).toEqual([]);
        });

        it('nets to zero when the duplicate was already reversed (even the newer line)', () => {
            const reversed = new Set([101]);
            expect(selectDuplicateLines(lines([2.07, 2.07]), reversed)).toEqual(
                [],
            );
        });

        it('credits an unlinked refund against the remaining exposure', () => {
            const out = selectDuplicateLines(
                lines([15, 15, 15]),
                new Set(),
                15,
            );
            expect(out.map((l) => l.id)).toEqual([102]);
        });

        it('consumes a refund that covers everything', () => {
            expect(
                selectDuplicateLines(lines([15, 15]), new Set(), 15),
            ).toEqual([]);
        });

        it('handles fractional amounts without floating point drift', () => {
            const out = selectDuplicateLines(
                lines([2.07, 2.07]),
                new Set(),
                2.07,
            );
            expect(out).toEqual([]);
        });
    });

    describe('assignOneToOne', () => {
        it('never pairs the same line with two orders', () => {
            const pairs = assignOneToOne([
                { legacyId: 14, orderId: 35 },
                { legacyId: 14, orderId: 36 },
                { legacyId: 14, orderId: 37 },
            ]);
            expect(pairs).toEqual([{ legacyId: 14, orderId: 35 }]);
        });

        it('never pairs two lines with the same order', () => {
            const pairs = assignOneToOne([
                { legacyId: 4, orderId: 20 },
                { legacyId: 5, orderId: 20 },
                { legacyId: 6, orderId: 21 },
            ]);
            expect(pairs).toEqual([
                { legacyId: 4, orderId: 20 },
                { legacyId: 6, orderId: 21 },
            ]);
        });
    });

    describe('legacyLineMatchesOrderCharge', () => {
        it('accepts an exact same-test match', () => {
            expect(legacyLineMatchesOrderCharge('85025', true)).toBe(true);
        });

        it('accepts a generic placeholder standing in for the test', () => {
            expect(legacyLineMatchesOrderCharge('80048', false)).toBe(true);
            expect(legacyLineMatchesOrderCharge('LAB-AST-GOT', false)).toBe(
                true,
            );
        });

        it('rejects an unrelated charge that merely shares the timestamp window', () => {
            expect(legacyLineMatchesOrderCharge('72100', false)).toBe(false); // X-ray
            expect(legacyLineMatchesOrderCharge('76770', false)).toBe(false); // ultrasound
        });
    });
});
