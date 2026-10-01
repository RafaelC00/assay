import {describe, expect, it} from 'vitest';
import {buildTable, formatValue, percentile, rate, summariseCell} from '../app/lib/vitals/aggregate';
import {RateLimiter} from '../app/lib/vitals/rate-limit';
import {routePattern} from '../app/lib/vitals/route';
import {MAX_BODY_BYTES, MIN_SAMPLES} from '../app/lib/vitals/schema';
import {parseBeaconBody, validateBeacon} from '../app/lib/vitals/validate';

describe('percentile', () => {
  it('returns null for an empty set, never zero', () => {
    expect(percentile([], 0.75)).toBeNull();
  });

  it('returns the only value for a single sample', () => {
    expect(percentile([1234], 0.75)).toBe(1234);
    expect(percentile([1234], 0)).toBe(1234);
    expect(percentile([1234], 1)).toBe(1234);
  });

  it('handles an odd count', () => {
    // rank = 0.75 * 4 = 3, an exact index
    expect(percentile([1, 2, 3, 4, 5], 0.75)).toBe(4);
  });

  it('interpolates for an even count', () => {
    // rank = 0.75 * 3 = 2.25 -> 3 + 0.25 * (4 - 3)
    expect(percentile([1, 2, 3, 4], 0.75)).toBeCloseTo(3.25, 10);
  });

  it('does not depend on input order and does not mutate it', () => {
    const input = [5, 1, 4, 2, 3];
    expect(percentile(input, 0.75)).toBe(4);
    expect(input).toEqual([5, 1, 4, 2, 3]);
  });

  it('handles the extremes and the median', () => {
    expect(percentile([10, 20, 30], 0)).toBe(10);
    expect(percentile([10, 20, 30], 1)).toBe(30);
    expect(percentile([10, 20, 30], 0.5)).toBe(20);
  });

  it('is not dragged by one extreme visit the way the mean is', () => {
    const values = [...Array(9).fill(1000), 60000];
    expect(percentile(values, 0.75)).toBe(1000);
  });

  it('rejects a p outside [0, 1]', () => {
    expect(() => percentile([1], 1.5)).toThrow(RangeError);
    expect(() => percentile([1], -0.1)).toThrow(RangeError);
    expect(() => percentile([1], NaN)).toThrow(RangeError);
  });
});

describe('rate', () => {
  it('uses the published Core Web Vitals bands, inclusive at the boundary', () => {
    expect(rate('LCP', 2500)).toBe('good');
    expect(rate('LCP', 2501)).toBe('needs-improvement');
    expect(rate('LCP', 4000)).toBe('needs-improvement');
    expect(rate('LCP', 4001)).toBe('poor');
    expect(rate('INP', 200)).toBe('good');
    expect(rate('INP', 501)).toBe('poor');
    expect(rate('CLS', 0.1)).toBe('good');
    expect(rate('CLS', 0.25)).toBe('needs-improvement');
    expect(rate('CLS', 0.26)).toBe('poor');
  });
});

describe('summariseCell: the too-few-samples threshold', () => {
  const many = (n: number, v = 1000) => Array(n).fill(v);

  it('shows nothing for an empty group', () => {
    expect(summariseCell('LCP', [])).toEqual({state: 'none'});
  });

  it('refuses a number below the threshold', () => {
    const cell = summariseCell('LCP', many(MIN_SAMPLES - 1));
    expect(cell).toEqual({state: 'too-few', count: MIN_SAMPLES - 1, needed: MIN_SAMPLES});
    expect(cell).not.toHaveProperty('p75');
  });

  it('shows a number exactly at the threshold', () => {
    const cell = summariseCell('LCP', many(MIN_SAMPLES, 1800));
    expect(cell).toEqual({state: 'ok', count: MIN_SAMPLES, p75: 1800, rating: 'good'});
  });

  it('judges the threshold on the true count, not the capped values read', () => {
    const cell = summariseCell('LCP', many(MIN_SAMPLES), 5000);
    expect(cell.state).toBe('ok');
    expect((cell as {count: number}).count).toBe(5000);
  });

  it('a p75 over a handful of visits is not rendered as a confident number', () => {
    expect(summariseCell('INP', [90, 120, 80, 100]).state).toBe('too-few');
  });

  it('honours a custom threshold', () => {
    expect(summariseCell('CLS', [0.01, 0.02, 0.03], 3, 3).state).toBe('ok');
    expect(summariseCell('CLS', [0.01, 0.02], 2, 3).state).toBe('too-few');
  });
});

describe('buildTable', () => {
  it('pivots groups into one row per route and device, with missing metrics as none', () => {
    const table = buildTable([
      {route: '/', device: 'mobile', metric: 'LCP', count: 3, values: [1, 2, 3]},
      {route: '/', device: 'mobile', metric: 'CLS', count: MIN_SAMPLES, values: Array(MIN_SAMPLES).fill(0.01)},
      {route: '/', device: 'desktop', metric: 'LCP', count: 1, values: [1]},
    ]);
    expect(table).toHaveLength(2);
    const mobile = table.find((r) => r.device === 'mobile')!;
    expect(mobile.cells.LCP.state).toBe('too-few');
    expect(mobile.cells.CLS.state).toBe('ok');
    expect(mobile.cells.INP).toEqual({state: 'none'});
  });

  it('is empty when there is no data', () => {
    expect(buildTable([])).toEqual([]);
  });
});

describe('formatValue', () => {
  it('formats each metric in its natural unit', () => {
    expect(formatValue('LCP', 1300)).toBe('1.30 s');
    expect(formatValue('INP', 184.6)).toBe('185 ms');
    expect(formatValue('CLS', 0.0123)).toBe('0.012');
  });
});

const valid = {
  device: 'mobile',
  metrics: [
    {name: 'LCP', value: 1800, route: '/'},
    {name: 'CLS', value: 0.02, route: '/products/:handle'},
  ],
};

describe('validateBeacon', () => {
  it('accepts a well-formed beacon', () => {
    const r = validateBeacon(valid);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.samples).toEqual([
        {metric: 'LCP', value: 1800, route: '/', device: 'mobile'},
        {metric: 'CLS', value: 0.02, route: '/products/:handle', device: 'mobile'},
      ]);
    }
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'LCP'],
    ['a number', 7],
  ])('rejects %s as the body', (_label, body) => {
    expect(validateBeacon(body).ok).toBe(false);
  });

  it('rejects an unknown metric name', () => {
    const r = validateBeacon({...valid, metrics: [{name: 'TTFB', value: 100, route: '/'}]});
    expect(r).toEqual({ok: false, reason: 'unknown metric'});
  });

  it.each([
    ['negative', -1],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['a string', '100'],
    ['null', null],
    ['over the LCP limit', 60_001],
  ])('rejects an LCP value that is %s', (_label, value) => {
    expect(validateBeacon({...valid, metrics: [{name: 'LCP', value, route: '/'}]}).ok).toBe(false);
  });

  it('applies a per-metric range: 11 is plausible for LCP ms but not for CLS', () => {
    expect(validateBeacon({...valid, metrics: [{name: 'LCP', value: 11, route: '/'}]}).ok).toBe(true);
    expect(validateBeacon({...valid, metrics: [{name: 'CLS', value: 11, route: '/'}]}).ok).toBe(false);
  });

  it('accepts a value of exactly zero', () => {
    expect(validateBeacon({...valid, metrics: [{name: 'CLS', value: 0, route: '/'}]}).ok).toBe(true);
  });

  it('rejects an unknown device class', () => {
    expect(validateBeacon({...valid, device: 'tablet'}).ok).toBe(false);
    expect(validateBeacon({...valid, device: undefined}).ok).toBe(false);
  });

  it('rejects a route that is not a known pattern, so resolved URLs cannot be stored', () => {
    for (const route of ['/products/magnesium-glycinate', '/?email=a@b.c', 'https://x.test/', '', 42]) {
      expect(validateBeacon({...valid, metrics: [{name: 'LCP', value: 1, route}]}).ok).toBe(false);
    }
  });

  it('rejects unknown fields at both levels instead of ignoring them', () => {
    expect(validateBeacon({...valid, userAgent: 'Mozilla/5.0'}).ok).toBe(false);
    expect(validateBeacon({...valid, metrics: [{name: 'LCP', value: 1, route: '/', id: 'abc'}]}).ok).toBe(false);
  });

  it('rejects empty, oversized and duplicate metric lists', () => {
    expect(validateBeacon({...valid, metrics: []}).ok).toBe(false);
    expect(validateBeacon({...valid, metrics: 'LCP'}).ok).toBe(false);
    const four = ['LCP', 'INP', 'CLS', 'LCP'].map((name) => ({name, value: 1, route: '/'}));
    expect(validateBeacon({...valid, metrics: four}).ok).toBe(false);
    const dup = [
      {name: 'LCP', value: 1, route: '/'},
      {name: 'LCP', value: 2, route: '/'},
    ];
    expect(validateBeacon({...valid, metrics: dup})).toEqual({ok: false, reason: 'duplicate metric'});
  });

  it('rejects an __proto__ style payload', () => {
    expect(parseBeaconBody('{"__proto__":{"x":1},"device":"mobile","metrics":[]}').ok).toBe(false);
  });
});

describe('parseBeaconBody', () => {
  it('rejects malformed JSON without throwing', () => {
    expect(parseBeaconBody('{not json')).toEqual({ok: false, reason: 'invalid JSON'});
    expect(parseBeaconBody('')).toEqual({ok: false, reason: 'invalid JSON'});
  });

  it('accepts a valid body and a normal beacon fits inside the body cap', () => {
    const body = JSON.stringify(valid);
    expect(body.length).toBeLessThan(MAX_BODY_BYTES);
    expect(parseBeaconBody(body).ok).toBe(true);
  });
});

describe('routePattern', () => {
  it('maps known pages and collapses product handles', () => {
    expect(routePattern('/')).toBe('/');
    expect(routePattern('/collections/all')).toBe('/collections/all');
    expect(routePattern('/collections/all/')).toBe('/collections/all');
    expect(routePattern('/products/magnesium-glycinate')).toBe('/products/:handle');
    expect(routePattern('/status')).toBe('/status');
  });

  it('sends anything unknown to "other" rather than passing it through', () => {
    expect(routePattern('/account/orders/1234')).toBe('other');
    expect(routePattern('/products/a/b')).toBe('other');
    expect(routePattern('/products/')).toBe('other');
  });
});

describe('RateLimiter', () => {
  it('allows up to the limit per window and then refuses', () => {
    const rl = new RateLimiter(3, 60_000);
    const t = 1_000_000;
    expect([1, 2, 3, 4].map(() => rl.allow('203.0.113.9', t))).toEqual([true, true, true, false]);
  });

  it('counts senders independently', () => {
    const rl = new RateLimiter(1, 60_000);
    expect(rl.allow('203.0.113.9', 0)).toBe(true);
    expect(rl.allow('203.0.113.10', 0)).toBe(true);
    expect(rl.allow('203.0.113.9', 0)).toBe(false);
  });

  it('forgets everything when the window rolls over', () => {
    const rl = new RateLimiter(1, 60_000);
    expect(rl.allow('203.0.113.9', 0)).toBe(true);
    expect(rl.allow('203.0.113.9', 1)).toBe(false);
    expect(rl.allow('203.0.113.9', 60_000)).toBe(true);
  });

  it('refuses new senders rather than growing without bound', () => {
    const rl = new RateLimiter(5, 60_000, 2);
    expect(rl.allow('a', 0)).toBe(true);
    expect(rl.allow('b', 0)).toBe(true);
    expect(rl.allow('c', 0)).toBe(false);
    expect(rl.allow('a', 0)).toBe(true);
  });
});
