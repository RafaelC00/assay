/**
 * The MAP rule, as the checkout Function applies it.
 *
 * This is deliberately a second, independent implementation of
 * `applyDiscount()` in app/lib/pricing/map.ts: a Function is bundled on its
 * own and cannot import from the storefront. tests/map-parity.test.ts keeps
 * the two in agreement.
 *
 * Money is integer cents. Fail closed: anything that cannot be read as valid
 * MAP terms yields the list price, so no discount is granted. (The storefront
 * engine throws on the same inputs; a Function must never throw at checkout,
 * so here the failure is expressed as "no discount".)
 */

export interface RawMapTerms {
  /** Vendor policy mirrored onto the product: none | floor | partial | open. */
  policy?: unknown;
  /** Deepest permitted discount, percent off list. Required for "floor". */
  floorPct?: unknown;
  /** Variant flag. Consulted for "partial" only; anything but false is protected. */
  protected?: unknown;
}

const isPct = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100;

const discounted = (list: number, pct: number): number => Math.round((list * (100 - pct)) / 100);

/** Price in cents after applying `requestedPct` under the given MAP terms. */
export function mapPriceCents(listCents: number, requestedPct: number, terms: RawMapTerms): number {
  if (!Number.isInteger(listCents) || listCents < 0) return listCents;
  if (!isPct(requestedPct) || requestedPct === 0) return listCents;

  switch (terms.policy) {
    case 'open':
      return discounted(listCents, requestedPct);

    case 'floor': {
      const floorPct = terms.floorPct;
      if (!isPct(floorPct)) return listCents;
      // Round the floor price up so rounding can never put the price under it.
      const floorPrice = Math.ceil((listCents * (100 - floorPct)) / 100);
      if (requestedPct > floorPct) return floorPrice;
      return Math.max(discounted(listCents, requestedPct), floorPrice);
    }

    case 'partial':
      return terms.protected === false ? discounted(listCents, requestedPct) : listCents;

    // "none", an unknown policy, or no policy at all.
    default:
      return listCents;
  }
}
