import {describe, expect, it} from 'vitest';
import {catalogData as data, localCatalogSource as source} from '../app/lib/catalog/local';

describe('catalog data integrity', () => {
  it('has the five vendors with the intended policies', () => {
    const policies = Object.fromEntries(data.vendors.map((v) => [v.handle, v.map_policy]));
    expect(policies).toEqual({
      'kestrel-labs': 'none',
      elia: 'none',
      'meridian-botanicals': 'partial',
      vireo: 'floor',
      northbound: 'open',
    });
  });

  it('has twenty products with unique handles and SKUs', () => {
    expect(data.products.length).toBe(20);
    expect(new Set(data.products.map((p) => p.handle)).size).toBe(data.products.length);
    const skus = data.products.flatMap((p) => p.variants.map((v) => v.sku));
    expect(new Set(skus).size).toBe(skus.length);
  });

  it('references real vendors and mirrors vendor MAP terms', () => {
    for (const p of data.products) {
      const v = data.vendors.find((v) => v.handle === p.vendor);
      expect(v, p.handle).toBeDefined();
      expect(p.map_policy, p.handle).toBe(v!.map_policy);
      expect(p.map_floor_pct, p.handle).toBe(v!.map_floor_pct);
    }
  });

  it('requires a floor on floor vendors and flags on partial products', () => {
    for (const v of data.vendors.filter((v) => v.map_policy === 'floor')) {
      expect(v.map_floor_pct).toBeGreaterThan(0);
    }
    for (const p of data.products.filter((p) => p.map_policy === 'partial')) {
      for (const variant of p.variants) {
        expect(typeof variant.map_protected, variant.sku).toBe('boolean');
      }
    }
  });

  it('has a coherent list price and non-empty variants', () => {
    for (const p of data.products) {
      expect(p.variants.length).toBeGreaterThan(0);
      expect(p.list_price_cents, p.handle).toBe(p.variants[0].price_cents);
      for (const v of p.variants) expect(Number.isInteger(v.price_cents)).toBe(true);
      expect(p.assay_panel.length).toBeGreaterThan(0);
    }
  });

  it('covers the required categories', () => {
    const text = data.products.map((p) => `${p.title} ${p.category}`.toLowerCase()).join(' | ');
    const terms = [
      'omega-3', 'glycinate', 'citrate', 'threonate', 'd3', 'vitamin c', 'zinc',
      'creatine', 'whey', 'plant protein', 'electrolyte', 'collagen', 'b-complex',
    ];
    for (const term of terms) expect(text, term).toContain(term);
  });

  it('keeps copy free of treatment and prevention claims', () => {
    const banned =
      /\b(cure|cures|treat|treats|treatment|prevent|prevents|prevention|heal|heals|relieve|relief|boosts?|supports?|immune|detox|clinically proven|anti-?inflammatory|fertility|diabetes|cancer|disease|stress|anxiety|sleep|pain)\b/i;
    for (const p of data.products) {
      expect(p.description, p.handle).not.toMatch(banned);
      expect(p.title, p.handle).not.toMatch(banned);
    }
  });
});

describe('local catalog source', () => {
  it('lists, filters and fetches', async () => {
    expect((await source.listProducts()).length).toBe(20);
    const vireo = await source.listProducts({vendors: ['vireo']});
    expect(vireo.length).toBeGreaterThan(0);
    expect(vireo.every((p) => p.vendor === 'vireo')).toBe(true);
    expect((await source.listProducts({vendors: []})).length).toBe(20);
    expect((await source.getProduct('vireo-d3-k2'))?.title).toBe('Vitamin D3 + K2');
    expect(await source.getProduct('nope')).toBeNull();
    expect((await source.getVendor('elia'))?.name).toBe('Elia');
    expect(await source.getVendor('nope')).toBeNull();
  });
});
