import { describe, expect, it } from '@jest/globals';
import {
  computeStockStatus,
  computeExpirationStatus,
  daysUntilExpiration,
  applyStockChange,
  resolveTransactionDelta,
  compareByDepletion,
  depletionRatio,
} from './inventory-status.util';

describe('inventory status rules', () => {
  describe('computeStockStatus', () => {
    it('flags zero quantity as OUT_OF_STOCK', () => {
      expect(computeStockStatus(0, 10)).toBe('OUT_OF_STOCK');
    });

    it('flags negative quantity as OUT_OF_STOCK', () => {
      expect(computeStockStatus(-3, 10)).toBe('OUT_OF_STOCK');
    });

    it('flags quantity at or below minimum as LOW_STOCK', () => {
      expect(computeStockStatus(5, 10)).toBe('LOW_STOCK');
      expect(computeStockStatus(10, 10)).toBe('LOW_STOCK');
    });

    it('flags quantity above minimum as IN_STOCK', () => {
      expect(computeStockStatus(11, 10)).toBe('IN_STOCK');
    });

    it('treats non-numeric input as zero', () => {
      expect(computeStockStatus(null, 10)).toBe('OUT_OF_STOCK');
      expect(computeStockStatus('abc', 10)).toBe('OUT_OF_STOCK');
    });
  });

  describe('depletionRatio', () => {
    it('reports the fraction of the minimum still held', () => {
      expect(depletionRatio(5, 10)).toBe(0.5);
      expect(depletionRatio(10, 10)).toBe(1);
      expect(depletionRatio(0, 10)).toBe(0);
    });

    it('has no ratio when the item carries no minimum', () => {
      expect(depletionRatio(0, 0)).toBeNull();
      expect(depletionRatio(50, 0)).toBeNull();
      expect(depletionRatio(5, null)).toBeNull();
    });
  });

  describe('compareByDepletion', () => {
    const item = (current: number, minimum: number, suggested?: number) => ({
      current_quantity: current,
      minimum_quantity: minimum,
      suggested_quantity: suggested,
    });

    it('ranks the most depleted item first', () => {
      expect(compareByDepletion(item(5, 50), item(40, 50))).toBeLessThan(0);
      expect(compareByDepletion(item(40, 50), item(5, 50))).toBeGreaterThan(0);
    });

    it('puts an item at 10% of minimum ahead of one at 90%, regardless of pack size', () => {
      // The old reorder list sorted ascending on suggested_quantity, which floated
      // the smallest shortfall to the top; urgency is about how depleted it is.
      const nearlyEmptyBigPack = item(10, 100, 190);
      const almostFullSmallPack = item(90, 100, 110);
      expect([nearlyEmptyBigPack, almostFullSmallPack].sort(compareByDepletion))
        .toEqual([nearlyEmptyBigPack, almostFullSmallPack]);
    });

    it('breaks a tie on the larger shortfall', () => {
      expect(compareByDepletion(item(5, 10, 15), item(5, 10, 40))).toBeGreaterThan(0);
    });

    it('sorts items with no minimum (not stocked) last', () => {
      const notStocked = item(0, 0);
      const lowStock = item(5, 50);
      expect([notStocked, lowStock].sort(compareByDepletion)).toEqual([lowStock, notStocked]);
    });

    it('treats non-numeric quantities as zero, i.e. fully depleted', () => {
      // 'abc' -> 0, so 0/10 ranks ahead of 1/10: the most depleted item first.
      expect(compareByDepletion(item('abc' as any, 10), item(1, 10))).toBeLessThan(0);
      expect(compareByDepletion(item(1, 10), item('abc' as any, 10))).toBeGreaterThan(0);
    });
  });

  describe('computeExpirationStatus', () => {
    const now = new Date('2026-08-18T12:00:00Z');

    it('returns NO_EXPIRATION when no date is provided', () => {
      expect(computeExpirationStatus(null, now)).toBe('NO_EXPIRATION');
      expect(computeExpirationStatus(undefined, now)).toBe('NO_EXPIRATION');
    });

    it('returns EXPIRED when date is in the past', () => {
      expect(computeExpirationStatus('2026-08-10', now)).toBe('EXPIRED');
    });

    it('returns EXPIRING_SOON within the alert window', () => {
      expect(computeExpirationStatus('2026-08-28', now, 90)).toBe('EXPIRING_SOON');
    });

    it('returns OK outside the alert window', () => {
      expect(computeExpirationStatus('2027-08-18', now, 90)).toBe('OK');
    });

    it('ignores unparseable dates', () => {
      expect(computeExpirationStatus('not-a-date', now)).toBe('NO_EXPIRATION');
    });
  });

  describe('daysUntilExpiration', () => {
    it('computes whole days remaining', () => {
      const now = new Date('2026-08-18T12:00:00Z');
      expect(daysUntilExpiration('2026-08-28', now)).toBe(10);
    });

    it('returns a negative number for past dates', () => {
      const now = new Date('2026-08-18T12:00:00Z');
      expect(daysUntilExpiration('2026-08-10', now)).toBe(-8);
    });
  });

  describe('applyStockChange', () => {
    it('adds positive deltas', () => {
      expect(applyStockChange(100, 25)).toBe(125);
    });

    it('subtracts negative deltas', () => {
      expect(applyStockChange(100, -25)).toBe(75);
    });

    it('prevents negative inventory by default', () => {
      expect(() => applyStockChange(10, -20)).toThrow(/Insufficient stock/);
    });

    it('allows negative inventory when explicitly permitted', () => {
      expect(applyStockChange(10, -20, true)).toBe(-10);
    });
  });

  describe('resolveTransactionDelta', () => {
    it('RECEIVE increases quantity', () => {
      expect(resolveTransactionDelta('RECEIVE', 25, 100).delta).toBe(25);
    });

    it('ISSUE decreases quantity', () => {
      expect(resolveTransactionDelta('ISSUE', 25, 100).delta).toBe(-25);
    });

    it('RETURN increases quantity', () => {
      expect(resolveTransactionDelta('RETURN', 10, 50).delta).toBe(10);
    });

    it('TRANSFER decreases source quantity', () => {
      expect(resolveTransactionDelta('TRANSFER', 10, 50).delta).toBe(-10);
    });

    it('ADJUSTMENT computes delta from target quantity', () => {
      expect(resolveTransactionDelta('ADJUSTMENT', 1, 100, 120).delta).toBe(20);
      expect(resolveTransactionDelta('ADJUSTMENT', 1, 100, 80).delta).toBe(-20);
    });

    it('ADJUSTMENT requires a target quantity', () => {
      expect(() => resolveTransactionDelta('ADJUSTMENT', 1, 100)).toThrow(/target quantity/);
    });

    it('rejects non-positive quantities', () => {
      expect(() => resolveTransactionDelta('ISSUE', 0, 100)).toThrow(/positive/);
      expect(() => resolveTransactionDelta('ISSUE', -5, 100)).toThrow(/positive/);
    });
  });
});
