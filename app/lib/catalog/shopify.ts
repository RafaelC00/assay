/**
 * Catalog source backed by the Shopify Storefront API.
 *
 * Mapping
 * - Vendor MAP policy lives in the `assay_vendor` metaobject. Each product
 *   points at it through the product metafield `custom.vendor_profile`
 *   (metaobject_reference). The metaobject's own handle is the vendor handle.
 * - Per-variant MAP protection is the variant metafield `custom.map_protected`.
 * - The assay panel is the product metafield `custom.assay_panel`
 *   (a JSON list of strings).
 *
 * Fail closed: when MAP terms cannot be read (no vendor profile, an unknown
 * policy, a floor policy with no floor), the product is treated as
 * `none` (never discounted). Advertising below an unreadable floor is the
 * expensive mistake; a missed discount is not.
 *
 * Every definition behind these fields must have storefront access
 * PUBLIC_READ or the API returns null for them (see scripts/provision.mjs).
 *
 * This module is pure apart from `fetch`, which is injectable so tests can
 * run with fixture payloads and no network.
 */
import type {MapPolicy, Product, ProductImage, Sale, Variant, Vendor} from './types';
import type {CatalogHealth, CatalogSource, ProductQuery} from './source';

// ---------------------------------------------------------------- response shapes

export interface MetaobjectNode {
  handle: string;
  fields: Array<{key: string; value: string | null}>;
}

export interface ProductNode {
  handle: string;
  title: string;
  vendor: string;
  productType: string;
  description: string;
  vendorProfile: {reference: MetaobjectNode | null} | null;
  assayPanel: {value: string} | null;
  images?: {
    nodes: Array<{url: string; altText: string | null; width: number | null; height: number | null}>;
  };
  variants: {
    nodes: Array<{
      sku: string | null;
      title: string;
      price: {amount: string};
      mapProtected: {value: string} | null;
    }>;
  };
}

export interface CatalogResponse {
  shop: {paymentSettings: {currencyCode: string}};
  vendors: {nodes: MetaobjectNode[]};
}

export interface ProductsResponse {
  products: {
    pageInfo: {hasNextPage: boolean; endCursor: string | null};
    nodes: ProductNode[];
  };
}

// ---------------------------------------------------------------- queries

const VENDOR_FIELDS = `handle fields { key value }`;

const SHOP_QUERY = `#graphql
  query AssayShop {
    shop { paymentSettings { currencyCode } }
    vendors: metaobjects(type: "assay_vendor", first: 50) { nodes { ${VENDOR_FIELDS} } }
  }
`;

const PRODUCTS_QUERY = `#graphql
  query AssayProducts($after: String) {
    products(first: 100, after: $after, sortKey: ID) {
      pageInfo { hasNextPage endCursor }
      nodes {
        handle
        title
        vendor
        productType
        description
        vendorProfile: metafield(namespace: "custom", key: "vendor_profile") {
          reference { ... on Metaobject { ${VENDOR_FIELDS} } }
        }
        assayPanel: metafield(namespace: "custom", key: "assay_panel") { value }
        images(first: 4) { nodes { url altText width height } }
        variants(first: 100) {
          nodes {
            sku
            title
            price { amount }
            mapProtected: metafield(namespace: "custom", key: "map_protected") { value }
          }
        }
      }
    }
  }
`;

// ---------------------------------------------------------------- mapping (pure)

const POLICIES: readonly MapPolicy[] = ['none', 'floor', 'partial', 'open'];

function fieldMap(node: MetaobjectNode): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of node.fields) if (f.value != null) out[f.key] = f.value;
  return out;
}

/** Money string ("34.0") to integer cents, rounding to the nearest cent. */
export function toCents(amount: string): number {
  // Exponent shift avoids binary float error (1.005 * 100 = 100.49999...).
  const n = Number(`${amount}e2`);
  if (!Number.isFinite(n) || n < 0) throw new RangeError(`Invalid price from Shopify: ${amount}`);
  return Math.round(n);
}

/**
 * Read MAP terms from a vendor metaobject. Anything unreadable resolves to
 * `none` (fail closed).
 */
export function mapVendor(node: MetaobjectNode): Vendor {
  const f = fieldMap(node);
  const policy = POLICIES.find((p) => p === f.map_policy);
  const floor = f.map_floor_pct != null ? Number(f.map_floor_pct) : undefined;
  const floorOk = floor !== undefined && Number.isFinite(floor) && floor > 0 && floor <= 100;
  const vendor: Vendor = {
    handle: node.handle,
    name: f.name ?? node.handle,
    positioning: f.positioning ?? '',
    map_policy: policy ?? 'none',
  };
  if (vendor.map_policy === 'floor') {
    if (floorOk) vendor.map_floor_pct = floor;
    else vendor.map_policy = 'none';
  } else if (floorOk) {
    vendor.map_floor_pct = floor;
  }
  return vendor;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parsePanel(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Images with a guaranteed alt text. An empty alt on a commerce page is a
 * defect, so a missing one falls back to naming the product.
 */
export function mapImages(node: ProductNode): ProductImage[] {
  return (node.images?.nodes ?? [])
    .filter((i) => i.url && i.width && i.height)
    .map((i) => ({
      url: i.url,
      alt: i.altText?.trim() || `${node.vendor} ${node.title}`,
      width: i.width as number,
      height: i.height as number,
    }));
}

export function mapProduct(node: ProductNode): Product {
  const ref = node.vendorProfile?.reference ?? null;
  const vendor = ref
    ? mapVendor(ref)
    : // No readable vendor profile: keep the product, never discount it.
      ({handle: slug(node.vendor), name: node.vendor, positioning: '', map_policy: 'none'} as Vendor);

  const variants: Variant[] = node.variants.nodes.map((v) => {
    const variant: Variant = {
      sku: v.sku ?? '',
      title: v.title,
      price_cents: toCents(v.price.amount),
    };
    // Absent metafield stays undefined: the engine treats that as protected.
    if (v.mapProtected) variant.map_protected = v.mapProtected.value === 'true';
    return variant;
  });

  const product: Product = {
    handle: node.handle,
    title: node.title,
    vendor: vendor.handle,
    category: node.productType,
    list_price_cents: variants[0]?.price_cents ?? 0,
    variants,
    description: node.description,
    assay_panel: parsePanel(node.assayPanel?.value),
    images: mapImages(node),
    map_policy: vendor.map_policy,
  };
  if (vendor.map_floor_pct !== undefined) product.map_floor_pct = vendor.map_floor_pct;
  return product;
}

export interface Snapshot {
  currency: string;
  vendors: Vendor[];
  products: Product[];
}

export function mapSnapshot(shop: CatalogResponse, productNodes: ProductNode[]): Snapshot {
  const products = productNodes.filter((n) => n.variants.nodes.length > 0).map(mapProduct);
  const vendors = shop.vendors.nodes.map(mapVendor);
  return {currency: shop.shop.paymentSettings.currencyCode, vendors, products};
}

// ---------------------------------------------------------------- source

export interface ShopifySourceConfig {
  domain: string;
  apiVersion: string;
  /** Public Storefront API token. Never an Admin token. */
  token: string;
  /** The sale is site configuration, not store data. */
  sale: Sale;
  /** Snapshot lifetime in ms. Default 30s. */
  ttlMs?: number;
  /**
   * Per-request bound on a Storefront API call, in ms. Default 5s.
   *
   * Why 5s: the Storefront API answers a catalog page in a few hundred ms
   * (observed 230-450 ms), so 5s is more than 10x normal and still short of
   * the ~10s the runtime takes to give up on an unreachable host by itself.
   * A longer bound only holds visitors' requests for an upstream that is not
   * going to answer; a shorter one risks failing a slow but healthy paginated
   * read. Before this existed a stalled upstream had not resolved after 45
   * seconds.
   */
  timeoutMs?: number;
  /**
   * How long a failed refresh is remembered, in ms. Default 5s. During that
   * window the source does not call the upstream again, so an outage costs
   * one attempt per window per instance instead of one per page view.
   */
  failureBackoffMs?: number;
  /**
   * How old the last good snapshot may be and still be served when a refresh
   * fails, in ms. Default 10 minutes. Beyond it the read fails: prices and
   * MAP terms drive discounting, and they should not be served indefinitely
   * with nobody noticing.
   */
  maxStaleMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
}

function errorMessage(error: unknown): string {
  const m = error instanceof Error ? error.message : 'unknown error';
  return m.slice(0, 200);
}

export function createShopifyCatalogSource(config: ShopifySourceConfig): CatalogSource {
  const doFetch = config.fetch ?? fetch;
  const now = config.now ?? Date.now;
  const ttl = config.ttlMs ?? 30_000;
  const endpoint = `https://${config.domain}/api/${config.apiVersion}/graphql.json`;

  const timeoutMs = config.timeoutMs ?? 5_000;
  const backoff = config.failureBackoffMs ?? 5_000;
  const maxStale = config.maxStaleMs ?? 600_000;

  async function query<T>(q: string, variables: Record<string, unknown> = {}): Promise<T> {
    const res = await doFetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-shopify-storefront-access-token': config.token,
      },
      body: JSON.stringify({query: q, variables}),
      // Covers reading the body as well as the response headers.
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`Storefront API responded ${res.status}`);
    const json = (await res.json()) as {data?: T; errors?: Array<{message: string}>};
    if (json.errors?.length || !json.data) {
      throw new Error(`Storefront API error: ${json.errors?.map((e) => e.message).join('; ')}`);
    }
    return json.data;
  }

  async function load(): Promise<Snapshot> {
    const [shop, firstPage] = await Promise.all([
      query<CatalogResponse>(SHOP_QUERY),
      query<ProductsResponse>(PRODUCTS_QUERY),
    ]);
    const nodes = [...firstPage.products.nodes];
    let page = firstPage.products;
    while (page.pageInfo.hasNextPage) {
      page = (await query<ProductsResponse>(PRODUCTS_QUERY, {after: page.pageInfo.endCursor})).products;
      nodes.push(...page.nodes);
    }
    return mapSnapshot(shop, nodes);
  }

  // State is per process (per serverless instance), not shared.
  let good: {at: number; value: Snapshot} | null = null;
  let failure: {at: number; error: unknown} | null = null;
  let inflight: Promise<Snapshot> | null = null;

  /** The last good snapshot, if still young enough to serve on error. */
  function staleOr(error: unknown): Snapshot {
    if (good && now() - good.at <= maxStale) return good.value;
    throw error;
  }

  function refresh(): Promise<Snapshot> {
    if (!inflight) {
      inflight = (async () => {
        try {
          const value = await load();
          good = {at: now(), value};
          failure = null;
          return value;
        } catch (error) {
          failure = {at: now(), error};
          console.warn(
            `catalog refresh failed (${errorMessage(error)}); ` +
              (good ? `serving snapshot from ${new Date(good.at).toISOString()}` : 'no snapshot to serve'),
          );
          throw error;
        } finally {
          inflight = null;
        }
      })();
    }
    return inflight;
  }

  // One snapshot serves all the calls a single page render makes. When a
  // refresh fails the last good snapshot is served instead of an error, for up
  // to maxStaleMs. That is never silent: getHealth() reports the age and the
  // last error, and every failed refresh is logged.
  async function snapshot(): Promise<Snapshot> {
    const t = now();
    if (good && t - good.at < ttl) return good.value;
    if (failure && t - failure.at < backoff) return staleOr(failure.error);
    try {
      return await refresh();
    } catch (error) {
      return staleOr(error);
    }
  }

  async function getHealth(): Promise<CatalogHealth> {
    // A real read, not a look at cached state: this is what makes it a probe.
    let served = true;
    try {
      await snapshot();
    } catch {
      served = false;
    }
    const age = good ? Math.max(0, now() - good.at) : null;
    const base = {
      source: 'shopify' as const,
      snapshotAgeMs: age,
      lastRefreshAt: good ? new Date(good.at).toISOString() : null,
      lastError: failure ? errorMessage(failure.error) : null,
      lastErrorAt: failure ? new Date(failure.at).toISOString() : null,
      maxStaleMs: maxStale,
    };
    if (!served) return {...base, state: 'broken'};
    return {...base, state: age !== null && age >= ttl ? 'stale' : 'healthy'};
  }

  return {
    getHealth,
    async getCurrency() {
      return (await snapshot()).currency;
    },
    async getSale() {
      return config.sale;
    },
    async listVendors() {
      return (await snapshot()).vendors;
    },
    async getVendor(handle) {
      return (await snapshot()).vendors.find((v) => v.handle === handle) ?? null;
    },
    async listProducts(q?: ProductQuery) {
      const {products} = await snapshot();
      const wanted = q?.vendors ?? [];
      return wanted.length === 0 ? products : products.filter((p) => wanted.includes(p.vendor));
    },
    async getProduct(handle) {
      return (await snapshot()).products.find((p) => p.handle === handle) ?? null;
    },
  };
}
