/**
 * Catalog types. These mirror the shape of data/catalog.json and are the
 * contract the rest of the app depends on. A Storefront API source must map
 * its responses onto these types (see source.ts).
 */

/**
 * How a vendor's Minimum Advertised Price agreement limits discounting.
 *
 * - none:    never discounted
 * - floor:   discounted, but not deeper than `map_floor_pct` off list
 * - partial: MAP covers only SKUs flagged `map_protected`; the rest are free
 * - open:    no restriction
 */
export type MapPolicy = 'none' | 'floor' | 'partial' | 'open';

export interface Vendor {
  handle: string;
  name: string;
  positioning: string;
  map_policy: MapPolicy;
  /** Maximum discount, in percent off list. Required when map_policy is "floor". */
  map_floor_pct?: number;
}

export interface Variant {
  sku: string;
  /** Size or count, e.g. "120 capsules". */
  title: string;
  price_cents: number;
  /** Only meaningful when the product's map_policy is "partial". */
  map_protected?: boolean;
}

/** A product photograph as the Storefront API reports it. */
export interface ProductImage {
  url: string;
  /** Describes the product for people who cannot see it. Never empty. */
  alt: string;
  width: number;
  height: number;
}

export interface Product {
  handle: string;
  title: string;
  /** Vendor handle. */
  vendor: string;
  category: string;
  /** Price of the default (first) variant, in cents. */
  list_price_cents: number;
  variants: Variant[];
  description: string;
  /** Tests covered by the published third-party assay for this product. */
  assay_panel: string[];
  /** Photographs, featured image first. Absent in the local JSON source. */
  images?: ProductImage[];
  map_policy: MapPolicy;
  map_floor_pct?: number;
}

export interface Sale {
  name: string;
  /** Requested site-wide discount, in percent off list. */
  percent_off: number;
}

export interface CatalogData {
  currency: string;
  sale: Sale;
  vendors: Vendor[];
  products: Product[];
}
