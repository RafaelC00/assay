import {describe, expect, it, vi} from 'vitest';
import {
  createShopifyCatalogSource,
  mapProduct,
  mapSnapshot,
  mapVendor,
  toCents,
  type CatalogResponse,
  type MetaobjectNode,
  type ProductNode,
  type ProductsResponse,
} from '../app/lib/catalog/shopify';
import {selectCatalogSource} from '../app/lib/catalog/source';
import {localCatalogSource} from '../app/lib/catalog/local';
import {priceVariant} from '../app/lib/pricing/sale';

const sale = {name: 'Test Sale', percent_off: 25};

const meridian: MetaobjectNode = {
  handle: 'meridian-botanicals',
  fields: [
    {key: 'map_policy', value: 'partial'},
    {key: 'name', value: 'Meridian Botanicals'},
    {key: 'positioning', value: 'Herbal extracts.'},
    {key: 'map_floor_pct', value: null},
  ],
};
const vireo: MetaobjectNode = {
  handle: 'vireo',
  fields: [
    {key: 'map_policy', value: 'floor'},
    {key: 'name', value: 'Vireo'},
    {key: 'positioning', value: 'Plant-based.'},
    {key: 'map_floor_pct', value: '15'},
  ],
};

function node(over: Partial<ProductNode> = {}): ProductNode {
  return {
    handle: 'meridian-ashwagandha-root',
    title: 'Ashwagandha Root Extract',
    vendor: 'Meridian Botanicals',
    productType: 'Adaptogens',
    description: 'Root extract.',
    vendorProfile: {reference: meridian},
    assayPanel: {value: JSON.stringify(['Potency', 'Pesticide residues'])},
    variants: {
      nodes: [
        {sku: 'A-60', title: '60 capsules', price: {amount: '26.0'}, mapProtected: {value: 'true'}},
        {sku: 'A-120', title: '120 capsules', price: {amount: '46.0'}, mapProtected: {value: 'false'}},
      ],
    },
    ...over,
  };
}

describe('toCents', () => {
  it('converts Shopify money strings to integer cents', () => {
    expect(toCents('34.0')).toBe(3400);
    expect(toCents('19.99')).toBe(1999);
    expect(toCents('0.1')).toBe(10);
    expect(toCents('1.005')).toBe(101);
  });
  it('rejects garbage rather than guessing', () => {
    expect(() => toCents('abc')).toThrow(RangeError);
    expect(() => toCents('-1')).toThrow(RangeError);
  });
});

describe('mapVendor', () => {
  it('maps a floor vendor with its floor', () => {
    expect(mapVendor(vireo)).toEqual({
      handle: 'vireo',
      name: 'Vireo',
      positioning: 'Plant-based.',
      map_policy: 'floor',
      map_floor_pct: 15,
    });
  });
  it('omits the floor when null', () => {
    expect(mapVendor(meridian).map_floor_pct).toBeUndefined();
  });
  it('fails closed on an unknown policy', () => {
    const v = mapVendor({handle: 'x', fields: [{key: 'map_policy', value: 'whatever'}]});
    expect(v.map_policy).toBe('none');
  });
  it('fails closed on a floor policy with no usable floor', () => {
    for (const value of [null, '0', 'abc', '150']) {
      const v = mapVendor({
        handle: 'x',
        fields: [
          {key: 'map_policy', value: 'floor'},
          {key: 'map_floor_pct', value},
        ],
      });
      expect(v.map_policy, String(value)).toBe('none');
      expect(v.map_floor_pct).toBeUndefined();
    }
  });
});

describe('mapProduct', () => {
  it('maps fields, cents, variants and the assay panel', () => {
    const p = mapProduct(node());
    expect(p).toMatchObject({
      handle: 'meridian-ashwagandha-root',
      title: 'Ashwagandha Root Extract',
      vendor: 'meridian-botanicals',
      category: 'Adaptogens',
      list_price_cents: 2600,
      map_policy: 'partial',
      assay_panel: ['Potency', 'Pesticide residues'],
    });
    expect(p.variants).toEqual([
      {sku: 'A-60', title: '60 capsules', price_cents: 2600, map_protected: true},
      {sku: 'A-120', title: '120 capsules', price_cents: 4600, map_protected: false},
    ]);
  });

  it('carries the vendor floor onto the product', () => {
    const p = mapProduct(node({vendorProfile: {reference: vireo}}));
    expect(p.map_policy).toBe('floor');
    expect(p.map_floor_pct).toBe(15);
  });

  it('leaves map_protected undefined when the metafield is missing', () => {
    const p = mapProduct(
      node({variants: {nodes: [{sku: 'A', title: 'x', price: {amount: '10.0'}, mapProtected: null}]}}),
    );
    expect(p.variants[0].map_protected).toBeUndefined();
  });

  it('never discounts a product whose vendor profile is not readable', () => {
    // This is what the Storefront API returns when definition access is wrong.
    const p = mapProduct(node({vendorProfile: null}));
    expect(p.map_policy).toBe('none');
    expect(p.vendor).toBe('meridian-botanicals');
    expect(priceVariant(p, p.variants[1], sale).priceCents).toBe(4600);
    const unresolved = mapProduct(node({vendorProfile: {reference: null}}));
    expect(unresolved.map_policy).toBe('none');
  });

  it('tolerates a missing or malformed assay panel', () => {
    expect(mapProduct(node({assayPanel: null})).assay_panel).toEqual([]);
    expect(mapProduct(node({assayPanel: {value: 'not json'}})).assay_panel).toEqual([]);
    expect(mapProduct(node({assayPanel: {value: '{"a":1}'}})).assay_panel).toEqual([]);
  });
});

describe('MAP decisions on mapped Shopify data', () => {
  it('excludes a protected SKU with its reason and discounts the free one', () => {
    const p = mapProduct(node());
    const protectedSku = priceVariant(p, p.variants[0], sale);
    expect(protectedSku.status).toBe('excluded');
    expect(protectedSku.code).toBe('partial_protected');
    expect(protectedSku.reason.length).toBeGreaterThan(0);
    expect(protectedSku.priceCents).toBe(2600);
    const free = priceVariant(p, p.variants[1], sale);
    expect(free.status).toBe('applied');
    expect(free.priceCents).toBe(3450);
  });

  it('clamps a floor vendor to its floor', () => {
    const p = mapProduct(node({vendorProfile: {reference: vireo}}));
    const d = priceVariant(p, p.variants[0], sale);
    expect(d.status).toBe('clamped');
    expect(d.appliedPct).toBe(15);
  });
});

describe('mapSnapshot', () => {
  const shop: CatalogResponse = {
    shop: {paymentSettings: {currencyCode: 'USD'}},
    vendors: {nodes: [meridian, vireo]},
  };
  it('maps currency, vendors and products, dropping products with no variants', () => {
    const empty = node({handle: 'empty', variants: {nodes: []}});
    const s = mapSnapshot(shop, [node(), empty]);
    expect(s.currency).toBe('USD');
    expect(s.vendors.map((v) => v.handle)).toEqual(['meridian-botanicals', 'vireo']);
    expect(s.products.map((p) => p.handle)).toEqual(['meridian-ashwagandha-root']);
  });
});

describe('createShopifyCatalogSource', () => {
  const shopData: CatalogResponse = {
    shop: {paymentSettings: {currencyCode: 'USD'}},
    vendors: {nodes: [meridian, vireo]},
  };
  const page1: ProductsResponse = {
    products: {pageInfo: {hasNextPage: true, endCursor: 'c1'}, nodes: [node()]},
  };
  const page2: ProductsResponse = {
    products: {
      pageInfo: {hasNextPage: false, endCursor: null},
      nodes: [node({handle: 'vireo-d3', vendorProfile: {reference: vireo}})],
    },
  };

  function fakeFetch() {
    return vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      let data: unknown;
      if (body.query.includes('AssayShop')) data = shopData;
      else data = body.variables.after === 'c1' ? page2 : page1;
      return new Response(JSON.stringify({data}), {status: 200});
    });
  }

  function make(f: typeof fetch, now = () => 0) {
    return createShopifyCatalogSource({
      domain: 'example.myshopify.com',
      apiVersion: '2026-01',
      token: 'test-token',
      sale,
      fetch: f,
      now,
    });
  }

  it('reads through the Storefront API with the token header, following pagination', async () => {
    const f = fakeFetch();
    const src = make(f as unknown as typeof fetch);
    const products = await src.listProducts();
    expect(products.map((p) => p.handle)).toEqual(['meridian-ashwagandha-root', 'vireo-d3']);
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toBe('https://example.myshopify.com/api/2026-01/graphql.json');
    expect((init!.headers as Record<string, string>)['x-shopify-storefront-access-token']).toBe(
      'test-token',
    );
  });

  it('implements the whole CatalogSource surface', async () => {
    const src = make(fakeFetch() as unknown as typeof fetch);
    expect(await src.getCurrency()).toBe('USD');
    expect(await src.getSale()).toEqual(sale);
    expect((await src.listVendors()).length).toBe(2);
    expect((await src.getVendor('vireo'))?.map_floor_pct).toBe(15);
    expect(await src.getVendor('nope')).toBeNull();
    expect((await src.listProducts({vendors: ['vireo']})).map((p) => p.handle)).toEqual(['vireo-d3']);
    expect((await src.getProduct('vireo-d3'))?.vendor).toBe('vireo');
    expect(await src.getProduct('nope')).toBeNull();
  });

  it('serves one page render from one snapshot, then refreshes after the ttl', async () => {
    const f = fakeFetch();
    let t = 0;
    const src = make(f as unknown as typeof fetch, () => t);
    await Promise.all([src.getCurrency(), src.listVendors(), src.listProducts()]);
    const first = f.mock.calls.length;
    await src.getProduct('vireo-d3');
    expect(f.mock.calls.length).toBe(first);
    t = 31_000;
    await src.listProducts();
    expect(f.mock.calls.length).toBeGreaterThan(first);
  });

  it('throws on API errors and does not cache the failure', async () => {
    let fail = true;
    const f = vi.fn(async (_u: unknown, init?: RequestInit) => {
      if (fail) return new Response(JSON.stringify({errors: [{message: 'boom'}]}), {status: 200});
      const body = JSON.parse(String(init?.body));
      const data = body.query.includes('AssayShop') ? shopData : page2;
      return new Response(JSON.stringify({data}), {status: 200});
    });
    const src = make(f as unknown as typeof fetch);
    await expect(src.listProducts()).rejects.toThrow(/boom/);
    fail = false;
    expect((await src.listProducts()).length).toBe(1);
  });

  it('throws on a non-200 response', async () => {
    const f = vi.fn(async () => new Response('nope', {status: 401}));
    await expect(make(f as unknown as typeof fetch).listProducts()).rejects.toThrow(/401/);
  });
});

describe('selectCatalogSource', () => {
  it('falls back to the local JSON without a token or domain', () => {
    expect(selectCatalogSource({})).toBe(localCatalogSource);
    expect(selectCatalogSource({SHOPIFY_STORE_DOMAIN: 'x.myshopify.com'})).toBe(localCatalogSource);
    expect(selectCatalogSource({PUBLIC_STOREFRONT_API_TOKEN: 't'})).toBe(localCatalogSource);
  });
  it('uses Shopify when both are set', () => {
    const src = selectCatalogSource({
      PUBLIC_STOREFRONT_API_TOKEN: 't',
      SHOPIFY_STORE_DOMAIN: 'x.myshopify.com',
    });
    expect(src).not.toBe(localCatalogSource);
  });
});
