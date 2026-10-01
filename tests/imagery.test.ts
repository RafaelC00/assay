import {describe, expect, it} from 'vitest';
import {cdnUrl, srcSet} from '../app/lib/images';
import {mapImages, mapProduct, type ProductNode} from '../app/lib/catalog/shopify';
import {meterGeometry, policySentence} from '../app/lib/pricing/explain';
import {applyDiscount} from '../app/lib/pricing/map';

const URL_ = 'https://cdn.shopify.com/s/files/1/0001/files/assay-x.jpg?v=1';

describe('cdnUrl', () => {
  it('asks the Shopify CDN for a width and an encoding, keeping the version', () => {
    const u = new URL(cdnUrl(URL_, 480, 'webp'));
    expect(u.searchParams.get('width')).toBe('480');
    expect(u.searchParams.get('format')).toBe('webp');
    expect(u.searchParams.get('v')).toBe('1');
  });
  it('leaves URLs that are not on the Shopify CDN alone', () => {
    expect(cdnUrl('https://example.com/a.jpg', 480, 'webp')).toBe('https://example.com/a.jpg');
    expect(cdnUrl('not a url', 480, 'webp')).toBe('not a url');
  });
  it('builds a srcset with a width descriptor for every candidate', () => {
    const set = srcSet(URL_, [240, 480], 'pjpg').split(', ');
    expect(set).toHaveLength(2);
    expect(set[0]).toMatch(/width=240.* 240w$/);
    expect(set[1]).toMatch(/format=pjpg.* 480w$/);
  });
});

const node = (images: ProductNode['images']): ProductNode => ({
  handle: 'p',
  title: 'Magnesium Glycinate',
  vendor: 'Kestrel Labs',
  productType: 'Magnesium',
  description: '',
  vendorProfile: null,
  assayPanel: null,
  images,
  variants: {nodes: [{sku: 'A', title: '90', price: {amount: '28.0'}, mapProtected: null}]},
});

describe('mapImages', () => {
  it('never returns an empty alt text', () => {
    const [img] = mapImages(node({nodes: [{url: URL_, altText: null, width: 1024, height: 1024}]}));
    expect(img.alt).toBe('Kestrel Labs Magnesium Glycinate');
    const [blank] = mapImages(node({nodes: [{url: URL_, altText: '   ', width: 1024, height: 1024}]}));
    expect(blank.alt.length).toBeGreaterThan(0);
  });
  it('keeps the alt text Shopify holds', () => {
    const [img] = mapImages(node({nodes: [{url: URL_, altText: 'A white bottle', width: 1024, height: 1024}]}));
    expect(img.alt).toBe('A white bottle');
  });
  it('drops an image without dimensions, since it cannot reserve space', () => {
    expect(mapImages(node({nodes: [{url: URL_, altText: 'x', width: null, height: null}]}))).toEqual([]);
  });
  it('tolerates a response with no images field', () => {
    expect(mapProduct(node(undefined)).images).toEqual([]);
  });
});

describe('meterGeometry', () => {
  const terms = (policy: 'none' | 'open' | 'floor') => ({policy, floorPct: policy === 'floor' ? 15 : undefined});

  it('marks an excluded product as blocked, with the advertised price at list', () => {
    const g = meterGeometry(applyDiscount(3400, 25, terms('none')));
    expect(g.blocked).toBe(true);
    expect(g.advertisedAt).toBe(100);
    expect(g.requestedAt).toBeLessThan(g.advertisedAt);
  });
  it('puts a capped price between the asked price and list', () => {
    const g = meterGeometry(applyDiscount(3900, 25, terms('floor')));
    expect(g.blocked).toBe(true);
    expect(g.requestedAt).toBeLessThan(g.advertisedAt);
    expect(g.advertisedAt).toBeLessThan(100);
  });
  it('shows no blocked zone when the full discount applies', () => {
    const g = meterGeometry(applyDiscount(2800, 25, terms('open')));
    expect(g.blocked).toBe(false);
    expect(g.advertisedAt).toBeCloseTo(g.requestedAt, 5);
  });
  it('stays on the track for a zero price', () => {
    const g = meterGeometry(applyDiscount(0, 25, terms('open')));
    expect(g.requestedAt).toBeGreaterThanOrEqual(0);
    expect(g.advertisedAt).toBeLessThanOrEqual(100);
  });
});

describe('policySentence', () => {
  it('states the floor in the vendor words', () => {
    expect(policySentence({name: 'Vireo', map_policy: 'floor', map_floor_pct: 15})).toContain('15%');
  });
  it('covers every policy', () => {
    for (const p of ['none', 'floor', 'partial', 'open'] as const) {
      expect(policySentence({name: 'V', map_policy: p, map_floor_pct: 10})).toMatch(/^V /);
    }
  });
});
