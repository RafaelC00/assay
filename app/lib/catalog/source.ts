/**
 * THE DATA BOUNDARY.
 *
 * Routes and components read catalog data only through the `catalog` export
 * below. It is bound to the Shopify Storefront API when
 * PUBLIC_STOREFRONT_API_TOKEN (and SHOPIFY_STORE_DOMAIN) are set, and to the
 * local JSON source otherwise, which keeps the app runnable and testable
 * without network. Nothing else in the app imports data/catalog.json or the
 * individual sources.
 */
import type {Product, Sale, Vendor} from './types';
import {catalogData, localCatalogSource} from './local';
import {createShopifyCatalogSource} from './shopify';

export interface ProductQuery {
  /** Vendor handles to include. Empty or omitted means all vendors. */
  vendors?: string[];
}

export interface CatalogSource {
  getCurrency(): Promise<string>;
  getSale(): Promise<Sale>;
  listVendors(): Promise<Vendor[]>;
  getVendor(handle: string): Promise<Vendor | null>;
  listProducts(query?: ProductQuery): Promise<Product[]>;
  getProduct(handle: string): Promise<Product | null>;
}

/**
 * Pick a source from an environment. Only the public Storefront token is ever
 * read here: the storefront never needs write access.
 */
export function selectCatalogSource(env: Record<string, string | undefined>): CatalogSource {
  const token = env.PUBLIC_STOREFRONT_API_TOKEN;
  const domain = env.SHOPIFY_STORE_DOMAIN;
  if (!token || !domain) return localCatalogSource;
  return createShopifyCatalogSource({
    domain,
    apiVersion: env.SHOPIFY_API_VERSION || '2026-01',
    token,
    // The sale is site configuration, kept in data/catalog.json.
    sale: catalogData.sale,
  });
}

export const catalog: CatalogSource = selectCatalogSource(process.env);
