import {
  DEVICES,
  MAX_METRICS_PER_BEACON,
  METRICS,
  ROUTES,
  VALUE_LIMITS,
  type DeviceClass,
  type MetricName,
  type RoutePattern,
} from './schema';

export type Sample = {
  metric: MetricName;
  value: number;
  route: RoutePattern;
  device: DeviceClass;
};

export type Validation = {ok: true; samples: Sample[]} | {ok: false; reason: string};

const fail = (reason: string): Validation => ({ok: false, reason});
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const hasOnly = (obj: Record<string, unknown>, keys: string[]) =>
  Object.keys(obj).every((k) => keys.includes(k));

/**
 * Strict validation of a beacon body, already parsed from JSON.
 *
 * Shape: {device, metrics: [{name, value, route}]}. Unknown keys are rejected
 * rather than ignored: the endpoint is public, and "ignore what you do not
 * recognise" is how unexpected data gets stored. Values must be finite numbers
 * inside the range a real measurement can reach.
 */
export function validateBeacon(raw: unknown): Validation {
  if (!isRecord(raw)) return fail('body must be an object');
  if (!hasOnly(raw, ['device', 'metrics'])) return fail('unknown field');

  const device = raw.device;
  if (typeof device !== 'string' || !(DEVICES as readonly string[]).includes(device)) {
    return fail('invalid device');
  }

  const metrics = raw.metrics;
  if (!Array.isArray(metrics) || metrics.length === 0) return fail('metrics must be a non-empty array');
  if (metrics.length > MAX_METRICS_PER_BEACON) return fail('too many metrics');

  const seen = new Set<string>();
  const samples: Sample[] = [];

  for (const m of metrics) {
    if (!isRecord(m)) return fail('metric must be an object');
    if (!hasOnly(m, ['name', 'value', 'route'])) return fail('unknown field');

    const {name, value, route} = m;
    if (typeof name !== 'string' || !(METRICS as readonly string[]).includes(name)) {
      return fail('unknown metric');
    }
    if (seen.has(name)) return fail('duplicate metric');
    seen.add(name);

    if (typeof value !== 'number' || !Number.isFinite(value)) return fail('value must be a finite number');
    if (value < 0 || value > VALUE_LIMITS[name as MetricName]) return fail('value out of range');

    if (typeof route !== 'string' || !(ROUTES as readonly string[]).includes(route)) {
      return fail('unknown route');
    }

    samples.push({
      metric: name as MetricName,
      value,
      route: route as RoutePattern,
      device: device as DeviceClass,
    });
  }

  return {ok: true, samples};
}

/** Parses and validates a raw request body. Never throws. */
export function parseBeaconBody(text: string): Validation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail('invalid JSON');
  }
  return validateBeacon(parsed);
}
