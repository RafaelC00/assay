/**
 * Sale pricing on top of the MAP engine: price a variant under the active
 * sale, and summarise how each vendor is treated for display.
 */
import type {Product, Sale, Variant, Vendor} from '../catalog/types';
import {applyDiscount, type MapDecision, type MapTerms} from './map';

export function termsFor(product: Product, variant: Variant): MapTerms {
  return {
    policy: product.map_policy,
    floorPct: product.map_floor_pct,
    protected: variant.map_protected,
  };
}

export function priceVariant(product: Product, variant: Variant, sale: Sale): MapDecision {
  return applyDiscount(variant.price_cents, sale.percent_off, termsFor(product, variant));
}

export type VendorSaleTreatment = 'full' | 'capped' | 'partial' | 'excluded';

export interface VendorSaleSummary {
  vendor: Vendor;
  treatment: VendorSaleTreatment;
  /** Deepest discount shoppers can get from this vendor during the sale. */
  maxPct: number;
  discountedSkus: number;
  totalSkus: number;
}

/** How the sale lands on each vendor, derived by running the engine on every SKU. */
export function summariseSale(vendors: Vendor[], products: Product[], sale: Sale): VendorSaleSummary[] {
  return vendors.map((vendor) => {
    let discounted = 0;
    let total = 0;
    let maxPct = 0;
    let clamped = false;
    for (const product of products.filter((p) => p.vendor === vendor.handle)) {
      for (const variant of product.variants) {
        total += 1;
        const d = priceVariant(product, variant, sale);
        if (d.priceCents < d.listPriceCents) {
          discounted += 1;
          maxPct = Math.max(maxPct, d.appliedPct);
        }
        if (d.status === 'clamped') clamped = true;
      }
    }
    let treatment: VendorSaleTreatment;
    if (discounted === 0) treatment = 'excluded';
    else if (discounted < total) treatment = 'partial';
    else treatment = clamped ? 'capped' : 'full';
    return {vendor, treatment, maxPct, discountedSkus: discounted, totalSkus: total};
  });
}
