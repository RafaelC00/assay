/**
 * Catalog source backed by data/catalog.json. Imported only by source.ts
 * (and by the integrity tests).
 */
import raw from '../../../data/catalog.json';
import type {CatalogData} from './types';
import type {CatalogSource} from './source';

export const catalogData = raw as CatalogData;

export const localCatalogSource: CatalogSource = {
  async getCurrency() {
    return catalogData.currency;
  },
  async getSale() {
    return catalogData.sale;
  },
  async listVendors() {
    return catalogData.vendors;
  },
  async getVendor(handle) {
    return catalogData.vendors.find((v) => v.handle === handle) ?? null;
  },
  async listProducts(query) {
    const wanted = query?.vendors ?? [];
    if (wanted.length === 0) return catalogData.products;
    return catalogData.products.filter((p) => wanted.includes(p.vendor));
  },
  async getProduct(handle) {
    return catalogData.products.find((p) => p.handle === handle) ?? null;
  },
};
