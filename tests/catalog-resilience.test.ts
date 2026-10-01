import {afterEach, describe, expect, it, vi} from 'vitest';
import {createShopifyCatalogSource} from '../app/lib/catalog/shopify';
import {localCatalogSource} from '../app/lib/catalog/local';
import {catalogHealthResponse} from '../app/lib/catalog/health';
import type {CatalogSource} from '../app/lib/catalog/source';

const sale = {name: 'Test Sale', percent_off: 25};
const shopData = {shop: {paymentSettings: {currencyCode: 'USD'}}, vendors: {nodes: []}};
const productsData = {products: {pageInfo: {hasNextPage: false, endCursor: null}, nodes: []}};

function respond(init?: RequestInit) {
  const body = JSON.parse(String(init?.body));
  const data = body.query.includes('AssayShop') ? shopData : productsData;
  return new Response(JSON.stringify({data}), {status: 200});
}

/** A fetch whose behaviour the test flips: healthy, 503, or never answers. */
function controllable() {
  const state = {mode: 'up' as 'up' | 'down' | 'stall'};
  const f = vi.fn(async (_u: unknown, init?: RequestInit) => {
    if (state.mode === 'down') return new Response('down', {status: 503});
    if (state.mode === 'stall') {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      });
    }
    return respond(init);
  });
  return {state, f: f as unknown as typeof fetch, calls: () => f.mock.calls.length};
}

function make(f: typeof fetch, clock: {t: number}, extra = {}) {
  return createShopifyCatalogSource({
    domain: 'example.myshopify.com',
    apiVersion: '2026-01',
    token: 'test-token',
    sale,
    fetch: f,
    now: () => clock.t,
    ...extra,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('timeout', () => {
  it('passes an abort signal to every Storefront request', async () => {
    const c = controllable();
    await make(c.f, {t: 0}).getCurrency();
    const calls = (c.f as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const [, init] of calls) expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it('gives up on an upstream that never answers, instead of waiting forever', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = controllable();
    c.state.mode = 'stall';
    const src = make(c.f, {t: 0}, {timeoutMs: 50});
    const t0 = Date.now();
    await expect(src.getCurrency()).rejects.toThrow();
    expect(Date.now() - t0).toBeLessThan(2_000);
  });

  it('defaults to a 5 second bound', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout');
    await make(controllable().f, {t: 0}).getCurrency();
    expect(spy).toHaveBeenCalledWith(5_000);
  });
});

describe('stale-if-error', () => {
  it('serves the last good snapshot when a refresh fails, up to maxStaleMs', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const clock = {t: 0};
    const c = controllable();
    const src = make(c.f, clock);
    expect(await src.getCurrency()).toBe('USD');

    c.state.mode = 'down';
    clock.t = 31_000; // past the 30s ttl, upstream failing
    expect(await src.getCurrency()).toBe('USD');
    clock.t = 5 * 60_000;
    expect(await src.getCurrency()).toBe('USD');
  });

  it('stops serving stale data once it is older than maxStaleMs', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const clock = {t: 0};
    const c = controllable();
    const src = make(c.f, clock);
    await src.getCurrency();
    c.state.mode = 'down';
    clock.t = 600_001;
    await expect(src.getCurrency()).rejects.toThrow(/503/);
  });

  it('fails when there is no snapshot to fall back on', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = controllable();
    c.state.mode = 'down';
    await expect(make(c.f, {t: 0}).getCurrency()).rejects.toThrow(/503/);
  });

  it('does not hammer a failing upstream: one attempt per backoff window', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const clock = {t: 0};
    const c = controllable();
    const src = make(c.f, clock);
    await src.getCurrency();
    c.state.mode = 'down';
    clock.t = 31_000;
    await src.getCurrency();
    const after = c.calls();
    for (let i = 0; i < 20; i++) await src.getCurrency();
    expect(c.calls()).toBe(after); // 20 more reads, zero more upstream calls
    clock.t = 31_000 + 5_001;
    await src.getCurrency();
    expect(c.calls()).toBeGreaterThan(after); // window over, tries again
  });

  it('recovers on the first read after the upstream heals', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const clock = {t: 0};
    const c = controllable();
    const src = make(c.f, clock);
    await src.getCurrency();
    c.state.mode = 'down';
    clock.t = 31_000;
    await src.getCurrency();
    c.state.mode = 'up';
    clock.t = 40_000;
    await src.getCurrency();
    expect((await src.getHealth()).state).toBe('healthy');
  });

  it('is never silent: logs each failed refresh', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const clock = {t: 0};
    const c = controllable();
    const src = make(c.f, clock);
    await src.getCurrency();
    c.state.mode = 'down';
    clock.t = 31_000;
    await src.getCurrency();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/serving snapshot from/);
  });
});

describe('getHealth', () => {
  it('healthy: fresh snapshot, age reported', async () => {
    const clock = {t: 1_000};
    const src = make(controllable().f, clock);
    const h = await src.getHealth();
    expect(h).toMatchObject({state: 'healthy', source: 'shopify', snapshotAgeMs: 0, lastError: null});
    clock.t = 11_000;
    expect((await src.getHealth()).snapshotAgeMs).toBe(10_000);
  });

  it('stale: serving, but says so and says how old', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const clock = {t: 0};
    const c = controllable();
    const src = make(c.f, clock);
    await src.getCurrency();
    c.state.mode = 'down';
    clock.t = 90_000;
    const h = await src.getHealth();
    expect(h.state).toBe('stale');
    expect(h.snapshotAgeMs).toBe(90_000);
    expect(h.lastError).toMatch(/503/);
    expect(h.lastRefreshAt).toBe(new Date(0).toISOString());
  });

  it('broken: nothing servable', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = controllable();
    c.state.mode = 'down';
    const h = await make(c.f, {t: 0}).getHealth();
    expect(h).toMatchObject({state: 'broken', snapshotAgeMs: null});
    expect(h.lastError).toMatch(/503/);
  });

  it('broken once the stale snapshot is too old to serve', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const clock = {t: 0};
    const c = controllable();
    const src = make(c.f, clock);
    await src.getCurrency();
    c.state.mode = 'down';
    clock.t = 700_000;
    expect((await src.getHealth()).state).toBe('broken');
  });

  it('does a real read: notices an outage without any page traffic', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const clock = {t: 0};
    const c = controllable();
    const src = make(c.f, clock);
    await src.getCurrency();
    c.state.mode = 'down';
    clock.t = 31_000;
    // No page read has happened since the failure began; the probe finds it.
    expect((await src.getHealth()).lastError).toMatch(/503/);
  });
});

describe('catalogHealthResponse', () => {
  const stub = (state: 'healthy' | 'stale' | 'broken'): CatalogSource => ({
    ...localCatalogSource,
    getHealth: async () => ({
      state,
      source: 'shopify',
      snapshotAgeMs: 123,
      lastRefreshAt: null,
      lastError: null,
      lastErrorAt: null,
      maxStaleMs: 600_000,
    }),
  });

  it('200 when healthy', async () => {
    const res = await catalogHealthResponse(stub('healthy'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-catalog-state')).toBe('healthy');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('200 when stale, but the state and age are in the payload', async () => {
    const res = await catalogHealthResponse(stub('stale'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-catalog-state')).toBe('stale');
    expect(await res.json()).toMatchObject({state: 'stale', snapshotAgeMs: 123});
  });

  it('503 when broken', async () => {
    const res = await catalogHealthResponse(stub('broken'));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({state: 'broken'});
  });

  it('503 if the probe itself throws, never a 200 by accident', async () => {
    const res = await catalogHealthResponse({
      ...localCatalogSource,
      getHealth: async () => {
        throw new Error('boom');
      },
    });
    expect(res.status).toBe(503);
  });

  it('end to end: a dead upstream through the real source gives 503', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = controllable();
    c.state.mode = 'down';
    const res = await catalogHealthResponse(make(c.f, {t: 0}));
    expect(res.status).toBe(503);
  });

  it('the local source is reported healthy', async () => {
    const res = await catalogHealthResponse(localCatalogSource);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({state: 'healthy', source: 'local'});
  });
});
