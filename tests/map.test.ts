import {describe, expect, it} from 'vitest';
import {applyDiscount} from '../app/lib/pricing/map';

describe('policy: none', () => {
  it.each([1, 10, 25, 50, 100])('rejects a %i%% discount', (pct) => {
    const d = applyDiscount(3400, pct, {policy: 'none'});
    expect(d.status).toBe('excluded');
    expect(d.code).toBe('policy_none');
    expect(d.priceCents).toBe(3400);
    expect(d.appliedPct).toBe(0);
    expect(d.reason).toMatch(/does not permit/);
  });

  it('ignores a stray floor or protected flag', () => {
    const d = applyDiscount(3400, 25, {policy: 'none', floorPct: 50, protected: false});
    expect(d.priceCents).toBe(3400);
  });
});

describe('policy: open', () => {
  it('passes the requested discount through', () => {
    const d = applyDiscount(4800, 25, {policy: 'open'});
    expect(d.status).toBe('applied');
    expect(d.code).toBe('policy_open');
    expect(d.priceCents).toBe(3600);
    expect(d.appliedPct).toBe(25);
  });

  it('allows a 100% discount', () => {
    expect(applyDiscount(1000, 100, {policy: 'open'}).priceCents).toBe(0);
  });

  it('rounds to the nearest cent', () => {
    // 1999 * 0.75 = 1499.25
    expect(applyDiscount(1999, 25, {policy: 'open'}).priceCents).toBe(1499);
    // 1001 * 0.5 = 500.5
    expect(applyDiscount(1001, 50, {policy: 'open'}).priceCents).toBe(501);
  });
});

describe('policy: floor', () => {
  const terms = {policy: 'floor' as const, floorPct: 15};

  it('applies a discount below the floor untouched', () => {
    const d = applyDiscount(4000, 10, terms);
    expect(d.status).toBe('applied');
    expect(d.code).toBe('floor_within');
    expect(d.priceCents).toBe(3600);
  });

  it('applies a discount exactly at the floor', () => {
    const d = applyDiscount(4000, 15, terms);
    expect(d.status).toBe('applied');
    expect(d.priceCents).toBe(3400);
    expect(d.appliedPct).toBe(15);
  });

  it('clamps a deeper discount to the floor', () => {
    const d = applyDiscount(4000, 25, terms);
    expect(d.status).toBe('clamped');
    expect(d.code).toBe('floor_clamped');
    expect(d.priceCents).toBe(3400);
    expect(d.requestedPct).toBe(25);
    expect(d.appliedPct).toBe(15);
    expect(d.reason).toMatch(/15%/);
  });

  it('clamps even a 100% request', () => {
    expect(applyDiscount(2000, 100, terms).priceCents).toBe(1700);
  });

  it('never lets rounding put the price below the floor', () => {
    // 1999 at 15% off is 1699.15. Nearest-cent rounding gives 1699, under the floor.
    expect(applyDiscount(1999, 15, terms).priceCents).toBe(1700);
    expect(applyDiscount(1999, 40, terms).priceCents).toBe(1700);
  });

  it('holds for every price in a sweep', () => {
    for (let list = 100; list <= 20000; list += 37) {
      for (const pct of [5, 15, 15.5, 30, 99]) {
        const d = applyDiscount(list, pct, terms);
        expect(d.priceCents).toBeGreaterThanOrEqual((list * 85) / 100);
        expect(d.priceCents).toBeLessThanOrEqual(list);
      }
    }
  });

  it('with a zero floor behaves like policy none', () => {
    const d = applyDiscount(2000, 25, {policy: 'floor', floorPct: 0});
    expect(d.priceCents).toBe(2000);
    expect(d.status).toBe('clamped');
  });

  it('throws when the floor is missing or out of range', () => {
    expect(() => applyDiscount(2000, 10, {policy: 'floor'})).toThrow(RangeError);
    expect(() => applyDiscount(2000, 10, {policy: 'floor', floorPct: -1})).toThrow(RangeError);
    expect(() => applyDiscount(2000, 10, {policy: 'floor', floorPct: 101})).toThrow(RangeError);
    expect(() => applyDiscount(2000, 10, {policy: 'floor', floorPct: NaN})).toThrow(RangeError);
  });
});

describe('policy: partial', () => {
  it('excludes a protected SKU', () => {
    const d = applyDiscount(2600, 25, {policy: 'partial', protected: true});
    expect(d.status).toBe('excluded');
    expect(d.code).toBe('partial_protected');
    expect(d.priceCents).toBe(2600);
  });

  it('discounts an unprotected SKU', () => {
    const d = applyDiscount(4600, 25, {policy: 'partial', protected: false});
    expect(d.status).toBe('applied');
    expect(d.code).toBe('partial_unprotected');
    expect(d.priceCents).toBe(3450);
  });

  it('fails closed when the flag is missing', () => {
    const d = applyDiscount(2600, 25, {policy: 'partial'});
    expect(d.status).toBe('excluded');
    expect(d.priceCents).toBe(2600);
  });

  it('is not subject to a floor even if one is supplied', () => {
    const d = applyDiscount(4600, 40, {policy: 'partial', protected: false, floorPct: 15});
    expect(d.priceCents).toBe(2760);
  });
});

describe('no discount requested', () => {
  it.each(['none', 'open', 'partial'] as const)('returns list price for %s', (policy) => {
    const d = applyDiscount(1234, 0, {policy});
    expect(d.status).toBe('none_requested');
    expect(d.priceCents).toBe(1234);
    expect(d.appliedPct).toBe(0);
  });

  it('still validates floor terms', () => {
    expect(() => applyDiscount(1234, 0, {policy: 'floor'})).toThrow(RangeError);
  });
});

describe('input validation', () => {
  const open = {policy: 'open' as const};

  it('rejects bad discounts', () => {
    expect(() => applyDiscount(1000, -1, open)).toThrow(RangeError);
    expect(() => applyDiscount(1000, 100.01, open)).toThrow(RangeError);
    expect(() => applyDiscount(1000, NaN, open)).toThrow(RangeError);
    expect(() => applyDiscount(1000, Infinity, open)).toThrow(RangeError);
  });

  it('rejects bad prices', () => {
    expect(() => applyDiscount(-1, 10, open)).toThrow(RangeError);
    expect(() => applyDiscount(10.5, 10, open)).toThrow(RangeError);
    expect(() => applyDiscount(NaN, 10, open)).toThrow(RangeError);
  });

  it('handles a zero price', () => {
    const d = applyDiscount(0, 25, open);
    expect(d.priceCents).toBe(0);
    expect(d.appliedPct).toBe(0);
  });
});
