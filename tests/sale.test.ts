import {describe, expect, it} from 'vitest';
import {priceVariant, summariseSale} from '../app/lib/pricing/sale';
import {catalogData as data} from '../app/lib/catalog/local';

const sale = data.sale;
const byHandle = (h: string) => data.products.find((p) => p.handle === h)!;

describe('priceVariant against catalog data', () => {
  it('never discounts a "none" vendor', () => {
    for (const p of data.products.filter((p) => p.map_policy === 'none')) {
      for (const v of p.variants) {
        expect(priceVariant(p, v, sale).priceCents).toBe(v.price_cents);
      }
    }
  });

  it('keeps every "floor" product at or above its floor', () => {
    for (const p of data.products.filter((p) => p.map_policy === 'floor')) {
      for (const v of p.variants) {
        const d = priceVariant(p, v, sale);
        expect(d.priceCents).toBeGreaterThanOrEqual(v.price_cents * (1 - p.map_floor_pct! / 100));
        expect(d.status).toBe('clamped');
      }
    }
  });

  it('discounts "open" products at the full sale rate', () => {
    const p = byHandle('northbound-whey-isolate');
    const d = priceVariant(p, p.variants[0], sale);
    expect(d.priceCents).toBe(Math.round(p.variants[0].price_cents * 0.75));
  });

  it('splits a "partial" product by SKU flag', () => {
    const p = byHandle('meridian-ashwagandha-root');
    expect(priceVariant(p, p.variants[0], sale).status).toBe('excluded');
    expect(priceVariant(p, p.variants[1], sale).status).toBe('applied');
  });
});

describe('summariseSale', () => {
  const summary = Object.fromEntries(
    summariseSale(data.vendors, data.products, sale).map((s) => [s.vendor.handle, s]),
  );

  it('classifies each vendor', () => {
    expect(summary['kestrel-labs'].treatment).toBe('excluded');
    expect(summary['elia'].treatment).toBe('excluded');
    expect(summary['meridian-botanicals'].treatment).toBe('partial');
    expect(summary['vireo'].treatment).toBe('capped');
    expect(summary['northbound'].treatment).toBe('full');
  });

  it('reports the deepest discount per vendor', () => {
    expect(summary['kestrel-labs'].maxPct).toBe(0);
    expect(summary['vireo'].maxPct).toBe(15);
    expect(summary['northbound'].maxPct).toBeCloseTo(25, 1);
  });

  it('counts SKUs consistently', () => {
    const total = Object.values(summary).reduce((n, s) => n + s.totalSkus, 0);
    expect(total).toBe(data.products.reduce((n, p) => n + p.variants.length, 0));
    const m = summary['meridian-botanicals'];
    expect(m.discountedSkus).toBeGreaterThan(0);
    expect(m.discountedSkus).toBeLessThan(m.totalSkus);
  });
});
