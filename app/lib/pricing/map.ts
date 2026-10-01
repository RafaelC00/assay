/**
 * MAP (Minimum Advertised Price) rule engine.
 *
 * Pure and dependency-free: given a list price, a requested discount and a
 * vendor's MAP terms, return the price that may be advertised and why.
 *
 * Conventions
 * - Money is integer cents.
 * - `floorPct` is the deepest permitted discount, as percent off list.
 *   A floor of 15 means the advertised price may not drop below 85% of list.
 * - The engine fails closed: a "partial" SKU with no explicit flag is treated
 *   as protected.
 * - Invalid input (negative prices, discounts outside 0-100, a "floor" policy
 *   with no floor) is a data error and throws RangeError.
 */
import type {MapPolicy} from '../catalog/types';

export interface MapTerms {
  policy: MapPolicy;
  /** Required when policy is "floor". */
  floorPct?: number;
  /** Consulted only when policy is "partial". Undefined means protected. */
  protected?: boolean;
}

export type MapReasonCode =
  | 'no_discount_requested'
  | 'policy_none'
  | 'policy_open'
  | 'floor_within'
  | 'floor_clamped'
  | 'partial_protected'
  | 'partial_unprotected';

export type MapStatus =
  /** Requested discount applied in full. */
  | 'applied'
  /** Discount applied, but reduced to the vendor's floor. */
  | 'clamped'
  /** Discount refused; list price stands. */
  | 'excluded'
  /** No discount was requested. */
  | 'none_requested';

export interface MapDecision {
  status: MapStatus;
  code: MapReasonCode;
  listPriceCents: number;
  /** Price that may be advertised. */
  priceCents: number;
  requestedPct: number;
  /** Discount actually granted, as percent off list (derived from the price). */
  appliedPct: number;
  /** Human-readable explanation, safe to show to shoppers. */
  reason: string;
}

function assertInput(listPriceCents: number, requestedPct: number, terms: MapTerms): void {
  if (!Number.isInteger(listPriceCents) || listPriceCents < 0) {
    throw new RangeError(`listPriceCents must be a non-negative integer, got ${listPriceCents}`);
  }
  if (!Number.isFinite(requestedPct) || requestedPct < 0 || requestedPct > 100) {
    throw new RangeError(`requestedPct must be between 0 and 100, got ${requestedPct}`);
  }
  if (terms.policy === 'floor') {
    const f = terms.floorPct;
    if (f === undefined || !Number.isFinite(f) || f < 0 || f > 100) {
      throw new RangeError(`A "floor" policy requires floorPct between 0 and 100, got ${f}`);
    }
  }
}

/** Price after `pct` off list, rounded to the nearest cent. */
function discountedCents(list: number, pct: number): number {
  return Math.round((list * (100 - pct)) / 100);
}

function pctOff(list: number, price: number): number {
  if (list === 0) return 0;
  return Math.round(((list - price) / list) * 10000) / 100;
}

function decision(
  base: Pick<MapDecision, 'listPriceCents' | 'requestedPct'>,
  status: MapStatus,
  code: MapReasonCode,
  priceCents: number,
  reason: string,
): MapDecision {
  return {
    ...base,
    status,
    code,
    priceCents,
    appliedPct: pctOff(base.listPriceCents, priceCents),
    reason,
  };
}

export function applyDiscount(
  listPriceCents: number,
  requestedPct: number,
  terms: MapTerms,
): MapDecision {
  assertInput(listPriceCents, requestedPct, terms);
  const base = {listPriceCents, requestedPct};

  if (requestedPct === 0) {
    return decision(base, 'none_requested', 'no_discount_requested', listPriceCents, 'No discount requested.');
  }

  switch (terms.policy) {
    case 'none':
      return decision(
        base,
        'excluded',
        'policy_none',
        listPriceCents,
        'Excluded: this vendor does not permit discounting of its products.',
      );

    case 'open':
      return decision(
        base,
        'applied',
        'policy_open',
        discountedCents(listPriceCents, requestedPct),
        'Discount applied: this vendor has no price restrictions.',
      );

    case 'floor': {
      const floorPct = terms.floorPct as number;
      // Round the floor price up so rounding can never push the price below it.
      const floorPrice = Math.ceil((listPriceCents * (100 - floorPct)) / 100);
      if (requestedPct > floorPct) {
        return decision(
          base,
          'clamped',
          'floor_clamped',
          floorPrice,
          `Discount reduced to ${floorPct}%: this vendor does not permit more than ${floorPct}% off list.`,
        );
      }
      const price = Math.max(discountedCents(listPriceCents, requestedPct), floorPrice);
      return decision(
        base,
        'applied',
        'floor_within',
        price,
        `Discount applied: within this vendor's ${floorPct}% limit.`,
      );
    }

    case 'partial': {
      if (terms.protected === false) {
        return decision(
          base,
          'applied',
          'partial_unprotected',
          discountedCents(listPriceCents, requestedPct),
          "Discount applied: this item is not covered by the vendor's price agreement.",
        );
      }
      return decision(
        base,
        'excluded',
        'partial_protected',
        listPriceCents,
        "Excluded: this item is covered by the vendor's price agreement.",
      );
    }
  }
}
