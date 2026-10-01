# Incident 01: Shopify upstream fails or hangs

Status: DRAFT, not reviewed. Not linked from the README or the site.
Date: 2026-10-01. Times below are UTC.

## Summary

The spec expected: "the storefront reads Shopify with a 30-second snapshot and falls back to local JSON". The second half is not true at runtime. The fallback to `data/catalog.json` is decided once, at process start, by whether the two Shopify environment variables exist (`selectCatalogSource` in `app/lib/catalog/source.ts`). Once the Shopify source is bound there is no fallback and no stale-if-error. When the snapshot expires and the upstream is failing, every catalog page returns HTTP 500 with the generic error page. When the upstream hangs rather than fails, there is no timeout at all.

Meanwhile `/status` stays 200 and looks fine. Nothing in the project would tell an owner the storefront is down.

## How it was induced

Production was not touched. Each failure was induced on a throwaway preview deployment of the same commit as production, with one environment variable changed, and each preview was deleted afterwards. Production's environment variables were never edited.

| Preview | Change | Models |
|---|---|---|
| A | Storefront token replaced with an invalid string | Token revoked or rotated |
| B | Shopify domain set to 192.0.2.1 (a reserved, unroutable address) | Upstream unreachable |
| local | The production `createShopifyCatalogSource` pointed at a local HTTP server that accepts and never answers, answers slowly, or answers 500 | Upstream hung or degraded |

The hang case could not be induced on a deployment, because that needs a public server that stalls on purpose. It was run locally against the unmodified production module. What a deployment would do with it is derived, and marked as derived below.

Scripts: `scripts/incidents/probe.mjs`, `stall-upstream.mjs`, `expire-snapshot.mjs`.

## Detection

What was observed, in the order a person could actually see it.

Invalid token (preview A), 18:28:09Z:

```
/                                          500    464ms body=error-page
/status                                    200    293ms body=content
/collections/all                           500    229ms body=error-page
/products/northbound-creatine-monohydrate  500    227ms body=error-page
```

Unreachable upstream (preview B), 18:31:04Z:

```
/                                          500  11180ms body=error-page
/status                                    200    447ms body=content
/products/northbound-creatine-monohydrate  500  10387ms body=error-page
```

The visitor sees a page titled "Error | ASSAY" with the heading "Something went wrong" and a link to "Browse all products", which leads to another 500. The page does not say the catalog is unavailable or that retrying may help.

Runtime log on preview A, one `error`-level entry per failed request:

```
Error: Storefront API responded 401
    at query (.../index.js:298:24)
    at async load (.../index.js:306:31)
```

**What would have told me: nothing proactive.**

- `/status` returned 200 throughout, because it reads Postgres, not Shopify. Its page says nothing about the catalog.
- The vitals beacons measure page performance. An error page that loads quickly looks like a fast page.
- There is no health endpoint that exercises the catalog read, no uptime monitor, and no alert on 5xx rate.
- The only record is the runtime log entry above, which helps only if someone opens the logs.
- `scripts/verify-checkout.mjs` would fail on a revoked token, but it talks to Shopify directly, not through the site, and only when run by hand.

In one sentence: the owner would find out from a visitor.

## Diagnosis

Three separate properties of `app/lib/catalog/shopify.ts`, each confirmed by experiment.

1. **No fallback after startup.** Local run against a 503 upstream, with a 3-second TTL standing in for 30:

```
t+0.0s  upstream up, cold read             served (USD)
--- upstream now returns 503 ---
t+0.0s  inside TTL                         served (USD)
t+3.3s  after TTL expired                  FAILED: Storefront API responded 503
t+3.3s  immediately again                  FAILED: Storefront API responded 503
```

   Inside the TTL the snapshot hides the outage. The instant it expires the read fails, and the last good snapshot is not used even though it is still in memory. So the answer to "does it serve stale data silently" is no: it is stricter than that, it serves nothing. The window of apparent health is at most 30 seconds per instance, and instances expire independently, so during a real outage some visitors see pages and others see errors.

2. **No timeout.** `fetch` is called without a signal. Observed:
   - Unreachable address on a deployment: the request fails after 10.4 to 11.2 seconds, which is the runtime's default connect timeout, not something this code set.
   - Server that accepts and never answers (local): the read had not resolved after 45 seconds, when observation stopped. A server that answers after 20 seconds is simply waited for, and the read succeeds after 20.0 seconds.
   - Derived, not observed: on the deployed project function duration is limited only by the platform default, which for this project (fluid compute) is long, so a stalled upstream would hold each visitor's request for minutes before a 500.

3. **Failures are not cached, so an outage is amplified.** Each failed read issues two upstream queries (shop and products) and the next request issues two more. The local stall run counted 4 upstream requests for 2 reads, and in the connect-timeout case each costs the visitor about 10 seconds. A degraded upstream therefore receives the full page-view rate of traffic, not one request per TTL.

## Recovery

Nothing needs to recover on the storefront side. Because failures are not cached, the first read after the upstream heals succeeds: 7 to 26 ms in the local runs, with the next read served from the new snapshot in 0 ms. On a deployment the time to recover is therefore the upstream's own recovery time plus at most one request. One exception: requests already stalled never settle on their own; they end only when the platform kills them.

A control preview with the correct variables served `/` at 200 with 5 product links in about a second, which confirms the 500s above came from the one changed variable and not from the preview mechanism. All preview deployments were deleted at the end.

## Fix (proposed, not implemented in this change)

In order:

1. `AbortSignal.timeout(3000)` on the Storefront `fetch`. Cheap, and removes the unbounded hang.
2. Serve the last good snapshot when a refresh fails (stale-if-error), up to a limit such as 10 minutes, and expose that the data is stale. This is the behaviour the spec assumed.
3. Cache the failure for a few seconds so an outage is retried at a bounded rate.
4. Render a specific "catalog temporarily unavailable" page with a 503 and `Retry-After`, instead of the generic error page.
5. Correct the README sentence that implies a runtime fallback. As written it describes startup selection only.

## Prevention

- A `/healthz` route that performs the real catalog read and returns non-200 when it fails, with an external uptime check on it. This is the detection that was missing.
- Show catalog source state on `/status` (age of the last successful snapshot, whether the last refresh failed). `/status` currently reports on one dependency only, which makes it look like it reports on all of them.
- Alert on 5xx rate from the runtime logs.
- Keep the three scripts in `scripts/incidents/` as regression checks once the fixes land: `stall-upstream.mjs` should then report a rejection or a stale served page within the timeout, not a wait.

## What did not happen

- No silent serving of stale or local data. It was a plausible outcome and did not occur: the source either serves a live snapshot or throws.
- No cached error. A failed read is not remembered, so recovery was immediate.
- The loader errors did not take down `/status`. The two are independent, which is good for isolation and bad for detection.
