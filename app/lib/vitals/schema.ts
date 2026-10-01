/**
 * The vocabulary shared by the beacon, the endpoint and the status page.
 *
 * Everything the system will ever accept is enumerated here. Anything not in
 * these lists is rejected at the door, which is what makes the privacy claim
 * checkable: there is no free-text field a visitor's data could ride in on.
 */

export const METRICS = ['LCP', 'INP', 'CLS'] as const;
export type MetricName = (typeof METRICS)[number];

export const DEVICES = ['mobile', 'desktop'] as const;
export type DeviceClass = (typeof DEVICES)[number];

/**
 * Route patterns, never resolved URLs. `/products/:handle` is one bucket for
 * every product, so no URL, and no query string, is ever stored. "other" is the
 * catch-all for any path that is not one of the known pages.
 */
export const ROUTES = ['/', '/collections/all', '/products/:handle', '/status', 'other'] as const;
export type RoutePattern = (typeof ROUTES)[number];

/** Upper bounds a real measurement can plausibly reach. LCP/INP in ms. */
export const VALUE_LIMITS: Record<MetricName, number> = {
  LCP: 60_000,
  INP: 60_000,
  CLS: 10,
};

/** Core Web Vitals thresholds: [good up to, poor beyond]. LCP/INP in ms. */
export const THRESHOLDS: Record<MetricName, readonly [number, number]> = {
  LCP: [2500, 4000],
  INP: [200, 500],
  CLS: [0.1, 0.25],
};

/** A p75 over fewer samples than this is noise and is not shown as a number. */
export const MIN_SAMPLES = 20;

/** The status page covers this many days of samples. */
export const WINDOW_DAYS = 7;

/** Samples older than this are deleted. */
export const RETENTION_DAYS = 30;

export const MAX_BODY_BYTES = 2048;
export const MAX_METRICS_PER_BEACON = 3;
