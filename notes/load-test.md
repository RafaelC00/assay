# Load test

Date: 2026-10-01. Commit under test: `e951a4c` (`main` at the time). Times are UTC.

> **Production cannot be load-tested on this platform.**
>
> An earlier attempt pointed a load generator at the production URL. Vercel's automatic DDoS mitigation reacted: the whole project returned HTTP 403 with `X-Vercel-Mitigated: challenge`, from every network, for roughly 20 minutes, until the traffic stopped. Nothing was misconfigured. The platform defended itself, and the defence is project-wide, so it also blocked real visitors for the duration.
>
> Consequences for anyone repeating this:
>
> - Never send load to the production hostname. Not "a little", not "to see".
> - Test a throwaway preview deployment of the same commit, with a protection-bypass secret, and delete both afterwards. That is the method below.
> - The mitigation threshold is not published and cannot be configured on the Hobby plan, so the safe rate is learned by ramping slowly and watching. A preview belongs to the same project as production, so it is not fully isolated for this purpose, and production was health-checked after every stage.
> - It also means this site has no way to prove its capacity at a rate Vercel would treat as an attack. Anything above what this document measured is untested by necessity, not by choice.

## Result in one paragraph

Nothing broke. Up to 100 concurrent connections against a single preview deployment, 19,000 requests in total, there were zero errors, zero timeouts and zero non-2xx responses on the three pages and `/status`. Median latency did not move (about 140 to 150 ms for the pages, 26 to 38 ms for `/status`). The only degradation is in the tail: p90 on the home and collection pages rose from about 160 ms to about 205 ms at 50 connections, and to 271 ms on the home page at 100, with the p50 unchanged. I did not reach a failure point. What stopped the test was the request budget I set (see Cost), not the site and not the platform: no mitigation was triggered at any stage. The ceiling actually reached is about 500 requests per second on the home page from one client machine.

## What was and was not measured

| Endpoint | Method | Measured |
|---|---|---|
| `/` | GET | yes |
| `/collections/all` | GET | yes |
| `/products/northbound-creatine-monohydrate` | GET | yes |
| `/status` | GET | yes (reads Postgres) |
| `/api/vitals` | POST | **partly**: rejected-body path only, see below |

**The vitals endpoint's database insert was not load-tested.** A valid beacon is written to the same Postgres database production uses (a preview deployment inherits the project's environment), and there is no way from this test to delete the rows afterwards. Valid load would have polluted the real-user numbers on `/status`. So the beacon was sent with a deliberately invalid body (`{"device":"nope","metrics":[]}`), which exercises routing, the per-client rate limiter, the capped body read and validation, and is refused before any insert. The vitals rows below therefore show the cheap rejection path: the first 30 requests per instance per minute reach validation and get a 400, the rest are stopped by the rate limiter with a 429. Both are the intended behaviour. Insert latency under load is unmeasured. A fair test needs a database that can be thrown away.

## Method

- **Target:** a preview deployment of the current commit, created with `vercel deploy --archive=tgz` (same build as production, same project, same region `iad1`, Node 24, fluid compute).
- **Access:** a temporary deployment-protection bypass secret, generated through the Vercel API for the project and sent as the `x-vercel-protection-bypass` header. Read from the environment, never written to the results or this document. Revoked at the end.
- **Tool:** `autocannon` 8.0.0 (free, local, pinned), driven by `loadtest/run.mjs`. No cloud load generator and no account.
- **Client:** one Windows machine on a home connection, talking to `iad1`. The round trip is a large share of every number below. The floor is roughly 25 ms (`/status` p50 at one connection is 26 ms), so the pages' 140 to 150 ms is mostly server rendering plus the upstream-snapshot read, not network.
- **Shape:** for each concurrency level, each endpoint in turn for a fixed number of requests (closed loop: a connection sends its next request when the previous one returns). A health gate on production ran after every stage.
- **Guards built into the tool:** `run.mjs` refuses the production hostname, refuses to run without the bypass secret, caps a stage at 5,000 requests, 60 seconds and 100 connections, and exits non-zero on any 403 so the driver stops. `health.mjs` checks `/`, `/status` and `/collections/all` on production for 200 and no `X-Vercel-Mitigated` header.
- **Warm-up:** 10 requests to `/` before stage 1, discarded. Within each stage the first requests include cold starts, and that cost is in the numbers (it shows up as `max`).

### Exact commands

```
# 1. Throwaway preview of the current commit
vercel deploy --archive=tgz --yes

# 2. Temporary bypass secret (API: PATCH /v1/projects/<id>/protection-bypass
#    with {"generate":{"note":"loadtest-temp"}}); export it, do not print it
export VERCEL_BYPASS=<secret>
export PREVIEW=https://<preview-host>
export PRODUCTION=https://<production-host>

# 3. Production gate before starting
node loadtest/health.mjs "$PRODUCTION"

# 4. Stages: connections, requests per endpoint
./loadtest/stage.sh 1 100
./loadtest/stage.sh 5 400
./loadtest/stage.sh 10 600
./loadtest/stage.sh 25 1000
./loadtest/stage.sh 50 1500

# 5. One more step, home page only
node loadtest/run.mjs "$PREVIEW" / --connections 100 --amount 1000 --duration 40 --label home

# 6. Production gate after, then clean up
node loadtest/health.mjs "$PRODUCTION"
vercel remove <preview-host> --yes
# revoke: PATCH /v1/projects/<id>/protection-bypass
#         with {"revoke":{"secret":"<secret>","regenerate":false}}
```

Run `stage.sh` from the repository root. On Windows under Git Bash, set `MSYS_NO_PATHCONV=1`, otherwise a bare `/` argument is rewritten into a filesystem path (this cost one failed run of 10 requests).

Raw per-stage results are in `loadtest/results.jsonl`. They contain latencies and counts only.

## Results

Latencies are in milliseconds, measured by the client. autocannon reports p50, p75, p90, p97.5 and p99 but not p95, so p90 and p99 bracket it. `rps` is autocannon's per-second sample average and is coarse for short runs. Every row had zero connection errors and zero timeouts.

### Stage 1: 1 connection, 100 requests each

| Endpoint | rps | p50 | p75 | p90 | p99 | max | Status |
|---|---|---|---|---|---|---|---|
| home | 6.3 | 146 | 155 | 164 | 223 | 274 | 200:100 |
| collection | 6.7 | 147 | 154 | 160 | 212 | 258 | 200:100 |
| product | 6.7 | 141 | 148 | 158 | 224 | 377 | 200:100 |
| status | 25 | 26 | 32 | 38 | 58 | 93 | 200:100 |
| vitals (rejected body) | 6.7 | 141 | 146 | 156 | 176 | 197 | 400:55 429:45 |

### Stage 2: 5 connections, 400 requests each

| Endpoint | rps | p50 | p75 | p90 | p99 | max | Status |
|---|---|---|---|---|---|---|---|
| home | 30.8 | 143 | 149 | 157 | 269 | 685 | 200:400 |
| collection | 30.8 | 144 | 150 | 160 | 233 | 338 | 200:400 |
| product | 33.3 | 138 | 143 | 155 | 203 | 331 | 200:400 |
| status | 133.3 | 28 | 33 | 39 | 97 | 127 | 200:400 |
| vitals (rejected body) | 33.3 | 140 | 148 | 163 | 232 | 394 | 400:118 429:282 |

### Stage 3: 10 connections, 600 requests each

| Endpoint | rps | p50 | p75 | p90 | p99 | max | Status |
|---|---|---|---|---|---|---|---|
| home | 60 | 144 | 151 | 163 | 237 | 654 | 200:600 |
| collection | 60 | 146 | 152 | 163 | 247 | 412 | 200:600 |
| product | 66.7 | 141 | 147 | 158 | 231 | 307 | 200:600 |
| status | 200 | 28 | 32 | 39 | 118 | 206 | 200:600 |
| vitals (rejected body) | 66.7 | 137 | 142 | 154 | 219 | 392 | 400:199 429:401 |

### Stage 4: 25 connections, 1,000 requests each

| Endpoint | rps | p50 | p75 | p90 | p99 | max | Status |
|---|---|---|---|---|---|---|---|
| home | 142.9 | 140 | 146 | 157 | 245 | 754 | 200:1000 |
| collection | 142.9 | 144 | 150 | 163 | 249 | 465 | 200:1000 |
| product | 166.7 | 137 | 143 | 153 | 225 | 354 | 200:1000 |
| status | 500 | 32 | 38 | 46 | 117 | 136 | 200:1000 |
| vitals (rejected body) | 166.7 | 138 | 143 | 151 | 233 | 443 | 400:339 429:661 |

### Stage 5: 50 connections, 1,500 requests each

| Endpoint | rps | p50 | p75 | p90 | p99 | max | Status |
|---|---|---|---|---|---|---|---|
| home | 250 | 145 | 155 | **204** | 267 | 447 | 200:1500 |
| collection | 250 | 150 | 162 | **209** | 300 | 405 | 200:1500 |
| product | 300 | 139 | 145 | 158 | 253 | 609 | 200:1500 |
| status | 750 | 38 | 47 | 65 | 168 | 183 | 200:1500 |
| vitals (rejected body) | 300 | 136 | 142 | 153 | 249 | 326 | 400:293 429:1207 |

### Stage 6: 100 connections, home page only, 1,000 requests

| Endpoint | rps | p50 | p75 | p90 | p99 | max | Status |
|---|---|---|---|---|---|---|---|
| home | 500 | 149 | 160 | **271** | 332 | 365 | 200:1000 |

### Production health gate

| When | `/` | `/status` | `/collections/all` | `X-Vercel-Mitigated` |
|---|---|---|---|---|
| Before the test | 200 | 200 | 200 | absent |
| After each of stages 1 to 5 | 200 | 200 | 200 | absent |
| After stage 6 | 200 | 200 | 200 | absent |
| After cleanup | 200 | 200 | 200 | absent |

Some single production requests during the run were slow: `/` at 1.4 to 2.7 s on four checks, `/collections/all` at 3.2 s once. Production was idle between checks and a function instance is cold on first touch, which fits; but I did not prove that, and I cannot rule out that load on the preview (same project, same Shopify upstream) contributed. The later checks were 150 to 410 ms.

## What degraded first

The tail of the two catalog-listing pages, and only at 50 connections or more. p50 stayed flat from 1 to 100 connections. p90 on `/` went 164, 157, 163, 157, **204**, **271** across the six stages, and on `/collections/all` 160, 160, 163, 163, **209**. The product page and `/status` degraded far less (product p90 stayed under 160 ms at 50 connections).

I cannot attribute this to the server. At 250 to 500 requests per second a single Windows client with 50 to 100 sockets is itself a plausible source of tail latency, and fan-out to new serverless instances (each cold start adds latency to a few requests) would look the same. Both explanations predict the same numbers here. What can be said: it is a modest tail effect, no request failed, and the median is unaffected.

The most informative number is throughput rather than latency. Pages cost roughly 140 ms of serial time each, so rps scaled linearly with connections (6.3, 30.8, 60, 143, 250, 500) all the way up. A saturated server would flatten that line. It never did.

## Phase 6 properties, under load

The phase 6 incident work established that the Shopify read is a 30-second per-instance snapshot, that the local-JSON fallback is chosen once at process start and never engages at runtime, that the Storefront fetch has no timeout, and that during an outage every request re-hits the upstream. This test did not induce an outage, so it did not exercise the failure half of that. What it does show on the healthy path:

- With a 30-second snapshot per instance, 19,000 requests produced no upstream-related 5xx. Each new instance does its own cold read, so upstream reads grow with instance count rather than request count. No Shopify throttling (a 429 from the Storefront API would surface as a 500 here) was seen at up to 500 rps.
- It does not show what happens when the upstream is slow or down at this load. Combine the two and the exposure is clear: with no timeout and no stale-if-error, an upstream stall at 100 connections would hold 100 function invocations open at once, and every retry after a failure goes straight back to Shopify. That combination is the next thing to test, on a preview, with the upstream stalled on purpose (`scripts/incidents/stall-upstream.mjs` is the local half of that).

## Cost and consumption

The project is on the Vercel Hobby plan, which has no overage billing: crossing an included limit pauses the project rather than charging, and that pause would take production down too. So the budget protected availability rather than a bill.

| Resource | Estimate before | Cap set | Actual | Hobby included |
|---|---|---|---|---|
| Requests (function invocations) | about 19,000 | 20,000 | 19,000 in stages, plus about 35 warm-up, smoke and health-gate requests | 1,000,000 / month |
| Bandwidth | about 0.25 GB (8 to 24 KB per page, uncompressed) | none | about 0.23 GB | 100 GB / month |
| Active CPU | up to about 25 min, if each request costs 50 ms | none | not read from the dashboard; same order | 4 h / month |

Share of the monthly allowance consumed: about 1.9% of invocations and about 0.2% of bandwidth. Spend: $0. No paid service, no new account, no cloud generator. The caps were enforced in the tool (`--amount` and `--duration` on every run, plus the hard ceilings in `run.mjs`), not by watching.

The database was read by `/status` 3,600 times across the stages (100 + 400 + 600 + 1,000 + 1,500), plus the health gates. No rows were written.

## Conclusions

1. Within what one client machine can generate (about 500 rps, 100 connections) this storefront does not fail, and its median latency is flat. For a catalog-and-product storefront whose traffic is a small fraction of that, capacity is not the risk.
2. The real ceiling is outside the application. Vercel's DDoS mitigation can take the whole project, production included, offline at a rate far below what the platform's compute could serve. That, not CPU or memory, is the limit that matters, and it cannot be tested directly.
3. Each page costs roughly 120 ms of server time above the network floor, paid on every request, because the pages are server-rendered per request rather than served from a CDN cache. That is why throughput is bounded by function invocations, and why a traffic spike costs invocations.
4. The weaknesses found in phase 6 are the ones that matter under load, and this test did not exercise them.

## What I would fix

In priority order.

1. **Cache the catalog pages at the CDN.** The home, collection and product pages are identical for every anonymous visitor and are rendered per request. A short `s-maxage` with `stale-while-revalidate` would turn most requests into CDN hits, remove most function invocations, keep serving a page during an upstream outage, and make it less likely that ordinary traffic looks like an attack. This also changes which phase 6 failure modes can reach a visitor.
2. **Add a timeout to the Storefront fetch** (a few seconds, `AbortSignal.timeout`) so a stalled upstream cannot hold invocations open.
3. **Serve a stale snapshot on upstream error** instead of a 500, and make the fallback decision at runtime, not once at process start.
4. **Add a health endpoint that reads the catalog**, and monitor it, so an outage is not discovered by a visitor. `/status` reads Postgres, not Shopify, and stayed 200 through every induced failure.
5. **Load-test the vitals insert against a disposable database**, and decide whether the in-memory per-instance rate limit (30 per minute, per instance) is acceptable. The 400/429 split above shows the effective limit grows with the number of instances.
6. **Repeat from a second machine**, to separate client-side tail latency from server-side, if the p90 rise at 50 to 100 connections ever matters.

## Cleanup, confirmed

- The preview deployment was deleted (`vercel remove`); its hostname now returns 404.
- The bypass secret was revoked through the API; the project's list of bypass secrets is empty.
- The secret was held only in an environment variable and a scratch file outside the repository, which was deleted. `loadtest/results.jsonl` was checked for it and does not contain it.
- Production returned 200 on `/`, `/status` and `/collections/all` with no `X-Vercel-Mitigated` header before the test, after every stage, and after cleanup.
