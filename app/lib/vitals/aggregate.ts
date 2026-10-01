import {MIN_SAMPLES, THRESHOLDS, type DeviceClass, type MetricName, type RoutePattern} from './schema';

/**
 * Percentile by linear interpolation between closest ranks (the method most
 * statistics packages call "type 7", and what Postgres' percentile_cont does).
 * `p` is a fraction in [0, 1]. Returns null for an empty set rather than 0:
 * zero would read as a perfect score.
 */
export function percentile(values: readonly number[], p: number): number | null {
  if (!(p >= 0 && p <= 1)) throw new RangeError('p must be between 0 and 1');
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const rank = p * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

export type Rating = 'good' | 'needs-improvement' | 'poor';

/** Google's published Core Web Vitals bands for a metric. */
export function rate(metric: MetricName, value: number): Rating {
  const [good, poor] = THRESHOLDS[metric];
  if (value <= good) return 'good';
  if (value <= poor) return 'needs-improvement';
  return 'poor';
}

export type Cell =
  | {state: 'none'}
  | {state: 'too-few'; count: number; needed: number}
  | {state: 'ok'; count: number; p75: number; rating: Rating};

/**
 * Turns the samples for one (route, device, metric) into what the page may
 * show. Below MIN_SAMPLES there is no number at all: a p75 over a handful of
 * visits is noise, and rendering it confidently would be the dishonest part.
 *
 * `count` is the true sample count, which can exceed `values.length` when the
 * query caps how many raw values it returns.
 */
export function summariseCell(
  metric: MetricName,
  values: readonly number[],
  count: number = values.length,
  minSamples: number = MIN_SAMPLES,
): Cell {
  if (count === 0 || values.length === 0) return {state: 'none'};
  if (count < minSamples) return {state: 'too-few', count, needed: minSamples};
  const p75 = percentile(values, 0.75)!;
  return {state: 'ok', count, p75, rating: rate(metric, p75)};
}

export type GroupRow = {
  route: RoutePattern;
  device: DeviceClass;
  metric: MetricName;
  count: number;
  values: number[];
};

export type TableRow = {
  route: RoutePattern;
  device: DeviceClass;
  cells: Record<MetricName, Cell>;
};

/** Pivots (route, device, metric) groups into one row per (route, device). */
export function buildTable(groups: readonly GroupRow[]): TableRow[] {
  const rows = new Map<string, TableRow>();
  for (const g of groups) {
    const key = `${g.route}|${g.device}`;
    let row = rows.get(key);
    if (!row) {
      row = {
        route: g.route,
        device: g.device,
        cells: {LCP: {state: 'none'}, INP: {state: 'none'}, CLS: {state: 'none'}},
      };
      rows.set(key, row);
    }
    row.cells[g.metric] = summariseCell(g.metric, g.values, g.count);
  }
  return [...rows.values()].sort(
    (a, b) => a.route.localeCompare(b.route) || a.device.localeCompare(b.device),
  );
}

/** Formats a p75 for display: LCP as seconds, INP as ms, CLS unitless. */
export function formatValue(metric: MetricName, value: number): string {
  if (metric === 'CLS') return value.toFixed(3);
  if (metric === 'INP') return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}
