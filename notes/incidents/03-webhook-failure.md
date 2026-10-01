# Incident 03: a failing webhook

Status: findings as originally observed. **Not fixed**: see "Fix and prevention".
Date: 2026-10-01. Times are UTC.

## Summary

Nothing failed, because there is nothing to fail. The project has no webhook receiver and no webhook subscription. The spec expected one; this exercise found its absence.

The closest thing the project has to an inbound endpoint that can fail is the vitals beacon, `POST /api/vitals`. A failure of its store was induced instead. It is not a substitute for a webhook and is reported as what it is.

## What was checked

- Source search for `webhook` or `hmac` in the application, scripts and extensions. The only hits are an unrelated keyed hash in the rate limiter and the `[webhooks]` API-version line in `shopify.app.toml`, which declares no subscriptions.
- Admin API `webhookSubscriptions(first: 20)`: an empty list.
- POST of a Shopify-shaped request (topic header, an HMAC header with a bogus value, a JSON body) to five plausible paths on a preview deployment: `/webhooks`, `/api/webhooks`, `/api/webhooks/orders`, `/webhooks/orders-create`, `/api/auth`. All five returned 404 in 217 to 232 ms.

A 404 is the answer a webhook sender would get. The bad HMAC is never examined, because no code looks at it.

## Detection

For a webhook that Shopify tries to deliver to this app: none is registered, so Shopify sends none. If a subscription were added today, every delivery would 404 and nothing in the project would notice. The only trace would be the 404 in the platform's request log. **What would have told me: nothing.**

What Shopify itself does about repeated delivery failures (retry schedule, removing a subscription that keeps failing) is documented platform behaviour and was not observed here.

## The nearest real failure: the vitals store goes away

Induced on a preview deployment with an unreachable database address, deleted afterwards.

```
/                                          200   1027ms productLinks=5
/status                                    503    288ms
/collections/all                           200    402ms productLinks=20
/products/northbound-creatine-monohydrate  200    317ms productLinks=2
POST /api/vitals  (valid beacon)           503    302ms  "store unavailable"
POST /api/vitals  (valid beacon)           503    246ms  "store unavailable"
```

What this showed:

- The storefront was unaffected. It does not depend on the metrics database.
- `/status` failed the way its design says it should: HTTP 503, `Cache-Control: no-store`, and the text "Measurements are unavailable ... That says nothing about the site's speed either way." It does not render zeros or an old figure as health. That is honest.
- Ingestion returned 503 and logged `vitals insert failed` with the error message only.
- The browser sends beacons with `navigator.sendBeacon`, which reports nothing back to the page. Every sample sent during a database outage is lost, with no retry, no queue and no client-side record.

**What would have told me:** a person opening `/status`, which shows the 503 or, if the database is reachable but ingestion is broken, a "newest sample" timestamp that stops advancing. Nothing alerts. A silent ingestion failure with a healthy read path would show only as an aging newest-sample time.

Not tested: production's `/status` is served with `s-maxage=60` and `stale-while-revalidate=300`, so a database outage would reach the live page up to about 6 minutes late. That follows from the header in the code and was not observed.

## Fix and prevention (not implemented; remains open)

Nothing in PR #7 or any other change addresses this incident, and it was not re-run. There is no fix for a webhook that does not exist, and building a receiver only to have something to test would add a public, authenticated endpoint and its upkeep for no current need: the storefront reads Shopify on demand and nothing it does depends on being told about changes. The gap becomes real the day a feature needs webhooks, and the absence of detection described above would apply to it from the first delivery. If one is built, the checklist this exercise implies:

- Verify the HMAC over the raw body, before parsing, with a constant-time comparison. Return 401 on mismatch and log it as a counted event.
- Respond quickly, do the work asynchronously, and make the handler idempotent on the webhook id, since delivery is at least once.
- Log every delivery outcome with topic and id, and alert on any 4xx or 5xx rate above zero.
- Reconcile periodically against the Admin API, because a dropped webhook leaves no trace by definition.
- Add this scenario (bad HMAC, handler error) to `scripts/incidents/` at the same time as the handler.

For the vitals path: show the age of the newest sample prominently on `/status`, and alert when it exceeds a threshold during hours with traffic.

## What did not happen

- No webhook was dropped, retried or rejected, because none was ever accepted.
- The expected "bad HMAC is detected" outcome is untestable: no code reads the header.
