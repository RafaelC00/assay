/**
 * Plain-language framing of a vendor's MAP policy, and the geometry of the
 * price meter shown on product pages. Pure, so it is testable without React.
 */
import type {MapPolicy, Vendor} from '../catalog/types';
import type {MapDecision} from './map';

/** One sentence on what the vendor's agreement says. No claims about the product. */
export function policySentence(vendor: Pick<Vendor, 'name' | 'map_policy' | 'map_floor_pct'>): string {
  switch (vendor.map_policy) {
    case 'none':
      return `${vendor.name} does not allow its products to be advertised below list price.`;
    case 'floor':
      return `${vendor.name} allows discounts of up to ${vendor.map_floor_pct}% off list, and no more.`;
    case 'partial':
      return `${vendor.name} protects selected products and sizes. The rest can be discounted.`;
    case 'open':
      return `${vendor.name} places no limit on discounting.`;
  }
}

export const POLICY_LABEL: Record<MapPolicy, string> = {
  none: 'Never discounted',
  floor: 'Capped discount',
  partial: 'Per-SKU protection',
  open: 'Open pricing',
};

export interface MeterGeometry {
  /** Positions along the track, 0 (left) to 100 (right = list price). */
  requestedAt: number;
  advertisedAt: number;
  /** Cents at the left edge of the track. */
  lowCents: number;
  /** True when MAP held the price above what the sale asked for. */
  blocked: boolean;
}

/**
 * Lay the sale price that was asked for, and the price that may be advertised,
 * on one track that ends at list price. The track starts a little below the
 * deepest price shown so the two markers are never crammed together.
 */
export function meterGeometry(d: MapDecision): MeterGeometry {
  const list = d.listPriceCents;
  const requested = Math.round((list * (100 - d.requestedPct)) / 100);
  const low = Math.max(0, Math.floor(requested - list * 0.08));
  const span = Math.max(1, list - low);
  const pos = (c: number) => Math.min(100, Math.max(0, ((c - low) / span) * 100));
  return {
    requestedAt: pos(requested),
    advertisedAt: pos(d.priceCents),
    lowCents: low,
    blocked: d.priceCents > requested,
  };
}
