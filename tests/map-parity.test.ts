/**
 * Parity between the two copies of the MAP rule.
 *
 *   storefront:  applyDiscount()          app/lib/pricing/map.ts
 *   checkout:    mapPriceCents()          extensions/map-guard/src/map-rule.ts
 *
 * If these drift, the page promises a price checkout will not honour. Every
 * test here asserts agreement, never a hard-coded price, except where a case
 * documents behaviour that exists on one side only (see "fail closed").
 */
import {describe, expect, it} from 'vitest';
import catalog from '../data/catalog.json';
import {applyDiscount, type MapTerms} from '../app/lib/pricing/map';
import {priceVariant} from '../app/lib/pricing/sale';
import type {CatalogData} from '../app/lib/catalog/types';
import {mapPriceCents} from '../extensions/map-guard/src/map-rule';
import {
  cartLinesDiscountsGenerateRun,
  type RunInput,
} from '../extensions/map-guard/src/cart_lines_discounts_generate_run';

const fn = (list: number, pct: number, t: MapTerms) =>
  mapPriceCents(list, pct, {policy: t.policy, floorPct: t.floorPct, protected: t.protected});

function expectParity(list: number, pct: number, t: MapTerms) {
  expect(fn(list, pct, t), `list=${list} pct=${pct} ${JSON.stringify(t)}`).toBe(
    applyDiscount(list, pct, t).priceCents,
  );
}

const LISTS = [0, 1, 2, 3, 99, 100, 101, 333, 999, 1999, 2999, 3400, 4750, 12345, 999999];
const PCTS = [0, 0.01, 1, 5, 10, 14.99, 15, 15.01, 20, 25, 33.33, 50, 75, 99, 99.99, 100];
const FLOORS = [0, 1, 10, 15, 15.5, 25, 50, 99, 100];

const TERMS: Array<[string, MapTerms]> = [
  ['none', {policy: 'none'}],
  ['none, flag ignored (false)', {policy: 'none', protected: false}],
  ['open', {policy: 'open'}],
  ['open, flag ignored (true)', {policy: 'open', protected: true}],
  ['partial, protected', {policy: 'partial', protected: true}],
  ['partial, unprotected', {policy: 'partial', protected: false}],
  ['partial, flag missing', {policy: 'partial'}],
  ...FLOORS.map((f): [string, MapTerms] => [`floor ${f}`, {policy: 'floor', floorPct: f}]),
  ['floor, flag ignored', {policy: 'floor', floorPct: 15, protected: false}],
];

describe('parity: every policy x boundary list prices x boundary discounts', () => {
  for (const [label, terms] of TERMS) {
    it(label, () => {
      for (const list of LISTS) for (const pct of PCTS) expectParity(list, pct, terms);
    });
  }
});

describe('parity: named boundary cases', () => {
  const floor15: MapTerms = {policy: 'floor', floorPct: 15};
  const cases: Array<[string, number, number, MapTerms]> = [
    ['zero percent leaves price alone', 3400, 0, {policy: 'open'}],
    ['100 percent on open', 3400, 100, {policy: 'open'}],
    ['100 percent on floor clamps to the floor', 3400, 100, floor15],
    ['100 percent on none', 3400, 100, {policy: 'none'}],
    ['request exactly at the floor', 3400, 15, floor15],
    ['request one hundredth over the floor', 3400, 15.01, floor15],
    ['request just under the floor', 3400, 14.99, floor15],
    ['floor of zero allows no discount', 3400, 25, {policy: 'floor', floorPct: 0}],
    ['floor of 100 allows everything', 3400, 100, {policy: 'floor', floorPct: 100}],
    ['floor price rounds up (odd cents)', 999, 15, floor15],
    ['rounding on a half cent', 1, 50, {policy: 'open'}],
    ['free item', 0, 25, {policy: 'open'}],
    ['partial protected', 3400, 25, {policy: 'partial', protected: true}],
    ['partial unprotected', 3400, 25, {policy: 'partial', protected: false}],
    ['partial with no flag is protected', 3400, 25, {policy: 'partial'}],
  ];
  for (const [name, list, pct, terms] of cases) {
    it(name, () => expectParity(list, pct, terms));
  }

  it('fails closed the same way on the cases that matter', () => {
    expect(fn(3400, 25, {policy: 'none'})).toBe(3400);
    expect(fn(3400, 25, {policy: 'partial'})).toBe(3400);
    expect(fn(3400, 100, floor15)).toBe(2890);
  });
});

describe('parity: the actual catalog under the actual sale', () => {
  const data = catalog as CatalogData;

  // A checkout cart containing one of every variant, with the data the input
  // query would return for it: mirrored product terms and the variant flag.
  const lines = data.products.flatMap((p) => p.variants.map((v) => ({product: p, variant: v})));
  const input: RunInput = {
    cart: {
      lines: lines.map(({product, variant}) => ({
        id: `gid://shopify/CartLine/${variant.sku}`,
        cost: {amountPerQuantity: {amount: (variant.price_cents / 100).toFixed(1)}},
        merchandise: {
          __typename: 'ProductVariant' as const,
          mapProtected:
            typeof variant.map_protected === 'boolean' ? {value: String(variant.map_protected)} : null,
          product: {
            mapTerms: {
              jsonValue: {policy: product.map_policy, floor_pct: product.map_floor_pct ?? null},
            },
          },
        },
      })),
    },
    discount: {
      discountClasses: ['PRODUCT'],
      metafield: {jsonValue: {percentOff: data.sale.percent_off, name: data.sale.name}},
    },
  };
  const out = cartLinesDiscountsGenerateRun(input);
  const candidates = out.operations[0]?.productDiscountsAdd.candidates ?? [];
  const checkoutOff = new Map(
    candidates.map((c) => [
      c.targets[0]!.cartLine.id,
      Math.round(Number(c.value.fixedAmount.amount) * 100),
    ]),
  );

  it('covers every variant in the catalog', () => {
    expect(lines.length).toBeGreaterThan(20);
  });

  it('checkout discount equals list minus the storefront price for every variant', () => {
    for (const {product, variant} of lines) {
      const shown = priceVariant(product, variant, data.sale);
      const off = checkoutOff.get(`gid://shopify/CartLine/${variant.sku}`) ?? 0;
      expect(variant.price_cents - off, variant.sku).toBe(shown.priceCents);
    }
  });

  it('never discounts a variant the storefront excludes', () => {
    for (const {product, variant} of lines) {
      const shown = priceVariant(product, variant, data.sale);
      if (shown.status === 'excluded') {
        expect(checkoutOff.has(`gid://shopify/CartLine/${variant.sku}`), variant.sku).toBe(false);
      }
    }
  });
});

describe('fail closed: unreadable terms grant no discount at checkout', () => {
  const list = 3400;
  const unreadable: Array<[string, Parameters<typeof mapPriceCents>[2]]> = [
    ['no terms at all', {}],
    ['unknown policy', {policy: 'bogus'}],
    ['numeric policy', {policy: 1}],
    ['null policy', {policy: null}],
    ['floor without a floor', {policy: 'floor'}],
    ['floor of null', {policy: 'floor', floorPct: null}],
    ['floor as a string', {policy: 'floor', floorPct: '15'}],
    ['floor above 100', {policy: 'floor', floorPct: 101}],
    ['negative floor', {policy: 'floor', floorPct: -1}],
    ['NaN floor', {policy: 'floor', floorPct: Number.NaN}],
    ['partial with a non-boolean flag', {policy: 'partial', protected: 'false'}],
    ['partial with a null flag', {policy: 'partial', protected: null}],
  ];
  for (const [name, terms] of unreadable) {
    it(name, () => expect(mapPriceCents(list, 25, terms)).toBe(list));
  }

  it('where the storefront throws on invalid input, checkout grants nothing', () => {
    expect(() => applyDiscount(list, 25, {policy: 'floor'})).toThrow(RangeError);
    expect(() => applyDiscount(list, 101, {policy: 'open'})).toThrow(RangeError);
    expect(() => applyDiscount(list, -1, {policy: 'open'})).toThrow(RangeError);
    expect(() => applyDiscount(-5, 25, {policy: 'open'})).toThrow(RangeError);
    expect(() => applyDiscount(10.5, 25, {policy: 'open'})).toThrow(RangeError);
    expect(mapPriceCents(list, 101, {policy: 'open'})).toBe(list);
    expect(mapPriceCents(list, -1, {policy: 'open'})).toBe(list);
    expect(mapPriceCents(-5, 25, {policy: 'open'})).toBe(-5);
    expect(mapPriceCents(10.5, 25, {policy: 'open'})).toBe(10.5);
    expect(mapPriceCents(list, Number.NaN, {policy: 'open'})).toBe(list);
  });
});

describe('Function entry point', () => {
  const base = (
    over: Partial<RunInput['discount']> = {},
    terms: unknown = {policy: 'open'},
  ): RunInput => ({
    cart: {
      lines: [
        {
          id: 'gid://shopify/CartLine/1',
          cost: {amountPerQuantity: {amount: '34.0'}},
          merchandise: {
            __typename: 'ProductVariant',
            mapProtected: null,
            product: {mapTerms: terms === null ? null : {jsonValue: terms}},
          },
        },
      ],
    },
    discount: {
      discountClasses: ['PRODUCT'],
      metafield: {jsonValue: {percentOff: 25, name: 'Autumn Sale'}},
      ...over,
    },
  });

  it('emits a fixed amount per item for a discountable line', () => {
    expect(cartLinesDiscountsGenerateRun(base())).toEqual({
      operations: [
        {
          productDiscountsAdd: {
            selectionStrategy: 'ALL',
            candidates: [
              {
                message: 'Autumn Sale',
                targets: [{cartLine: {id: 'gid://shopify/CartLine/1'}}],
                value: {fixedAmount: {amount: '8.50', appliesToEachItem: true}},
              },
            ],
          },
        },
      ],
    });
  });

  it('does nothing when the discount is not a product discount', () => {
    expect(cartLinesDiscountsGenerateRun(base({discountClasses: ['ORDER']}))).toEqual({operations: []});
  });

  it('does nothing when the configuration is missing or unusable', () => {
    for (const metafield of [
      null,
      {jsonValue: null},
      {jsonValue: {percentOff: 'x'}},
      {jsonValue: {percentOff: 0}},
    ]) {
      expect(cartLinesDiscountsGenerateRun(base({metafield}))).toEqual({operations: []});
    }
  });

  it('does nothing when the product carries no MAP terms', () => {
    expect(cartLinesDiscountsGenerateRun(base({}, null))).toEqual({operations: []});
    expect(cartLinesDiscountsGenerateRun(base({}, {policy: 'floor'}))).toEqual({operations: []});
  });

  it('ignores lines that are not product variants', () => {
    const input = base();
    input.cart.lines[0]!.merchandise = {__typename: 'CustomProduct'};
    expect(cartLinesDiscountsGenerateRun(input)).toEqual({operations: []});
  });
});
