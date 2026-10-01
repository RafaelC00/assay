# Incident 01: Shopify upstream fails or hangs

Status: findings below are as originally observed; the fixes and their re-test are recorded in "Fix" and "After the fix".
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

## Fix (implemented in PR #7)

What was built, against the three diagnosed properties:

1. **Timeout.** Every Storefront request carries `AbortSignal.timeout(5000)`. 5 seconds is more than ten times the 230 to 450 ms a catalog page took in these runs, and below the roughly 10 seconds the runtime takes to give up on an unreachable host by itself. A longer bound only holds visitors for an upstream that is not going to answer; a shorter one risks failing a slow but healthy paginated read. It is a judgement informed by those numbers, and it is configurable (`timeoutMs`).
2. **Stale-if-error.** The source keeps the last good snapshot. When a refresh fails it serves that snapshot instead of throwing, for up to 10 minutes (`maxStaleMs`); older than that, the read fails again. The limit is deliberate: prices and MAP terms decide discounting, and they should not be served indefinitely. This is per process, so each serverless instance has its own snapshot, and only an instance that has already read a good catalog can serve stale.
3. **Bounded retry rate.** A failed refresh is remembered for 5 seconds (`failureBackoffMs`), so a failing upstream receives about one attempt per window per instance instead of one per page view.
4. **Visible, not silent.** Every failed refresh is logged with the age of the snapshot being served. `GET /healthz` performs a real catalog read and reports the state:

| State | HTTP | Meaning |
|---|---|---|
| `healthy` | 200 | Fresh snapshot, refreshed within 30 seconds. |
| `stale` | 200 | Last refresh failed; an older snapshot is being served. Body and `X-Catalog-State` say so, with `snapshotAgeMs`, `lastError` and `lastErrorAt`. |
| `broken` | 503 | Nothing can be served: no snapshot, or the snapshot is older than `maxStaleMs`. |

`stale` returns 200 on purpose, because visitors are being served; a monitor that must alert on it has to match the state in the body or header, not the status code. If the probe itself throws, the route answers 503, never 200.

Not done from the original proposal:

- **No specific "catalog unavailable" page with 503 and `Retry-After`.** With no snapshot to fall back on, a visitor still gets the generic error page. Stale-if-error only helps an instance that has already read the catalog once.
- **README wording is not corrected here.** The fallback to local JSON is still a start-up decision only. What exists now is stale-if-error from the last live snapshot, which is a different thing, and the README sentence should say so.
- **`/status` is unchanged.** It still reports on the metrics store only. `/healthz` is the source of truth for the catalog.
- **No external monitor or log alert was set up.** The endpoint exists; nothing is calling it yet.

One trade-off introduced: because failures are now remembered for 5 seconds, recovery after the upstream heals can take up to 5 seconds on an instance, where before it was immediate.

## After the fix

Local runs of the unchanged `scripts/incidents/` scripts against the new module (same 3-second TTL stand-in as before):

```
t+0.0s  upstream up, cold read             served (USD)
--- upstream now returns 503 ---
t+0.0s  inside TTL                         served (USD)
t+3.3s  after TTL expired                  served (USD)     (before: FAILED)
t+3.3s  immediately again                  served (USD)     (before: FAILED, another upstream call)
```

Each failed refresh also logged `catalog refresh failed (Storefront API responded 503); serving snapshot from <time of last good read>`.

Upstream that accepts and never answers (`stall-upstream.mjs stall`): request 1 rejected after 5014 ms (before: no result after 45 s); request 2 rejected in 0 ms; 2 upstream requests received in total, one shop and products attempt, with the second request not forwarded (before: 4 for 2 reads).

On throwaway preview deployments of this branch, probed with `probe.mjs` and deleted afterwards:

| Case | `/` | `/healthz` | `/status` |
|---|---|---|---|
| Correct variables | 200 | 200, `healthy`, age 1126 ms | 200 |
| Invalid token | 500 (794 ms) | **503**, `broken`, `Storefront API responded 401` | 200 |
| Unreachable domain (192.0.2.1) | 500 after 5656 ms (before: 10.4 to 11.2 s); next request 172 ms | **503** | 200 |

What this does and does not show. The 503 on `/healthz` is the detection that did not exist. The two failing previews had never read a good catalog, so there was nothing to serve stale and their pages still returned 500; that is expected and unchanged. **Serving stale was not demonstrated on a deployment**, because that needs an upstream that can be switched off after a warm read, and the project's Shopify store is not something to break for a demonstration. It is demonstrated by the local script above and by unit tests that flip a fake upstream between up, down and stalled.

Still true: `/status` stays green during an outage, and nothing watches `/healthz` yet. The honest answer to "what would have told me" is now "an external check on `/healthz`, once someone sets one up". Until then it is still the owner finding out from a visitor.

## Prevention

- `/healthz` now exists (see Fix). Still to do: point an external uptime check at it, matching on the state as well as the status code.
- Show catalog source state on `/status` (age of the last successful snapshot, whether the last refresh failed). Not done. `/status` reports on one dependency only, which makes it look like it reports on all of them.
- Alert on 5xx rate from the runtime logs.
- Keep the three scripts in `scripts/incidents/` as regression checks: they now report a rejection within the timeout or a stale served read, not a wait.

## What did not happen (as originally observed, before the fix)

- No silent serving of stale or local data. It was a plausible outcome and did not occur: the source either served a live snapshot or threw. After the fix it does serve stale data, which is why the age and the last error are exposed.
- No cached error. A failed read was not remembered, so recovery was immediate. After the fix failures are remembered for 5 seconds.
- The loader errors did not take down `/status`. The two are independent, which is good for isolation and bad for detection.
