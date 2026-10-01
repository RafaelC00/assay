import {onCLS, onINP, onLCP, type Metric} from 'web-vitals';
import {routePattern} from './route';
import type {DeviceClass, MetricName, RoutePattern} from './schema';

/**
 * Real-user monitoring beacon.
 *
 * Measurement is delegated to the web-vitals library: LCP, INP and CLS each
 * have subtle rules (which element counts, when a layout shift is "expected",
 * how an interaction is grouped) that hand-written PerformanceObserver code
 * tends to get wrong.
 *
 * Reports are collected and sent once, when the page is hidden, with
 * navigator.sendBeacon. That call is queued by the browser and never blocks
 * the page from unloading.
 *
 * PRIVACY. What leaves the browser: metric name, value, a route pattern such
 * as /products/:handle (never the resolved URL, never a query string) and a
 * coarse device class. No cookies, no storage, no identifier of any kind.
 */

const ENDPOINT = '/api/vitals';

type Pending = {name: MetricName; value: number; route: RoutePattern};

export function startVitalsBeacon(): void {
  if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return;

  const pending = new Map<MetricName, Pending>();
  // One sample per metric per page load: a metric re-reported after the page
  // is hidden and shown again must not count the same visit twice.
  const sent = new Set<MetricName>();
  // LCP belongs to the page the visit started on, even if the visitor has
  // since navigated within the app.
  const landingRoute = routePattern(location.pathname);

  const collect = (metric: Metric) => {
    const name = metric.name as MetricName;
    if (sent.has(name)) return;
    pending.set(name, {
      name,
      value: metric.value,
      route: name === 'LCP' ? landingRoute : routePattern(location.pathname),
    });
  };

  onLCP(collect);
  onINP(collect);
  onCLS(collect);

  // Registered after the web-vitals listeners, so on a hidden event the
  // library reports first and this flush sees the final values.
  const flush = () => {
    if (pending.size === 0) return;
    const device: DeviceClass = matchMedia('(pointer: coarse)').matches ? 'mobile' : 'desktop';
    const body = JSON.stringify({
      device,
      metrics: [...pending.values()].map(({name, value, route}) => ({name, value, route})),
    });
    for (const name of pending.keys()) sent.add(name);
    pending.clear();
    navigator.sendBeacon(ENDPOINT, new Blob([body], {type: 'application/json'}));
  };

  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  addEventListener('pagehide', flush);
}
