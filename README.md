# ASSAY

A storefront for a multi-brand premium supplement retailer. ASSAY stocks only products that have a third-party assay, and publishes the test panel alongside each product.

ASSAY and all brands and products are fictional.

The engineering focus is MAP pricing, described below. This repository covers the storefront skeleton, the catalog model, the pricing rule engine and a checkout Function that enforces the same rule. It runs against local catalog data when no Shopify credentials are set, and against a Shopify store through the Storefront API when they are.

## The MAP problem

Premium brands typically sign Minimum Advertised Price agreements with their retailers. The agreement limits how far a retailer may discount the brand's products in public. The terms differ by vendor, so a retailer that runs a site-wide sale cannot apply one rule to the whole catalog.

The five invented house brands cover the cases that occur in practice:

| Brand | MAP policy | Meaning |
|---|---|---|
| Kestrel Labs | `none` | Never discounted |
| Elia | `none` | Never discounted |
| Meridian Botanicals | `partial` | MAP covers selected SKUs, flagged per variant |
| Vireo | `floor` | Discount may not exceed 15% off list |
| Northbound | `open` | Freely discountable |

This is interesting for three reasons.

1. The rule is a property of the vendor, but for `partial` vendors it resolves per SKU. The decision has to be made at the variant level.
2. Correctness is asymmetric. Advertising a protected product below its floor can cost a retailer the vendor relationship. Failing to discount something permitted costs a little margin. The engine therefore fails closed: a `partial` SKU with no explicit flag is treated as protected.
3. The shopper needs an explanation. A banner reading "25% off" is false if four of five brands are excluded or capped. The home page states how the sale applies to each brand, and a product page says why a given product is excluded or reduced.

Convention: `map_floor_pct` is the deepest permitted discount, as percent off list. A floor of 15 means the advertised price may not fall below 85% of list. The floor price is rounded up to the cent so that rounding can never put a price under it.

## Architecture

```
data/catalog.json            Vendors, products, variants, MAP fields, active sale
app/lib/catalog/types.ts     Catalog types
app/lib/catalog/source.ts    CatalogSource interface and the single active binding
app/lib/catalog/local.ts     JSON-backed implementation
app/lib/catalog/shopify.ts   Storefront API implementation
scripts/provision.mjs        Idempotent Shopify provisioning
app/lib/pricing/map.ts       MAP rule engine (pure)
app/lib/pricing/sale.ts      Prices a variant under the active sale; per-vendor summary
extensions/map-guard/        Checkout Function enforcing the same rule (see Checkout enforcement)
extensions/map-guard-settings/ Admin form for the sale percentage and label
app/routes/                  Home, collection, product
server.ts                    Oxygen worker entry
tests/                       Vitest (tests/map-parity.test.ts keeps storefront and checkout in step)
migrations/                  SQL migrations for the metrics store (see Status)
```

**Rule engine.** `applyDiscount(listPriceCents, requestedPct, terms)` in `app/lib/pricing/map.ts` is a pure function with no imports beyond a type. It returns the advertisable price, a status (`applied`, `clamped`, `excluded`, `none_requested`), a machine-readable reason code, and a sentence suitable for display. Invalid input throws `RangeError`.

**Data boundary.** Routes read catalog data only through the `catalog` export in `app/lib/catalog/source.ts`, typed as the `CatalogSource` interface. It binds to `app/lib/catalog/shopify.ts` (Storefront API) when `PUBLIC_STOREFRONT_API_TOKEN` and `SHOPIFY_STORE_DOMAIN` are set, and to the local JSON otherwise. The Shopify source keeps one snapshot for 30 seconds per server instance. Nothing else in the app imports the JSON file. If MAP terms cannot be read from Shopify (no vendor profile, an unknown policy, a floor with no value) the product is treated as never discounted.

**Shopify model.** Vendor MAP policy is a metaobject, `assay_vendor` (fields `name`, `positioning`, `map_policy`, `map_floor_pct`; the entry handle is the vendor handle), because it is shared by every product of a vendor and edited once. Per-variant protection is the variant metafield `custom.map_protected`, because it varies per SKU. Products reference their vendor through `custom.vendor_profile` (metaobject reference) and carry their test panel in `custom.assay_panel`. Every definition must have storefront access `PUBLIC_READ`: a definition left at the default looks the same in the admin and returns null from the Storefront API. `npm run shopify:provision` (`scripts/provision.mjs`) creates all of it idempotently, repairs access on existing definitions, and needs `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_API_VERSION` and `SHOPIFY_ADMIN_TOKEN` in `.env`. The Admin token is for provisioning only and is never set in the deployed storefront. The active sale is site configuration and stays in `data/catalog.json`.

**Stack.** Shopify Hydrogen tooling on React Router 7, TypeScript, Vite, Vitest. Server-side rendered on an Oxygen-compatible worker runtime.

**Copy.** Product descriptions state form, dosage, sourcing and testing only. They make no claims about treating or preventing any condition. A test in `tests/catalog.test.ts` checks the catalog copy against a list of claim terms.

## Checkout enforcement

A storefront price is only a promise. Checkout is where it is kept, so the sale is also enforced by a Shopify Function, `extensions/map-guard`, written in TypeScript against the Discount Function API (target `cart.lines.discounts.generate.run`, API version 2026-07). For each cart line it looks up the vendor's MAP terms and the variant's flag, applies the same rule as the storefront, and returns a `productDiscountsAdd` operation with one fixed amount per item, in cents-exact terms, so checkout lands on the same price the page showed. Lines it cannot read terms for get no discount.

### The parity test is the deliverable

The same rule now exists twice: `applyDiscount()` in `app/lib/pricing/map.ts` for the storefront and `mapPriceCents()` in `extensions/map-guard/src/map-rule.ts` for checkout. A Function is bundled on its own and cannot import the storefront code, so the duplication is deliberate. If the two drift, the page promises a price checkout will not honour, which is worse than having no discount. The real work of this phase is therefore `tests/map-parity.test.ts`, which asserts they agree rather than asserting prices:

- every policy (`none`, `open`, `floor` at nine floors from 0 to 100, `partial` protected, unprotected and flag missing) against 15 list prices and 16 requested discounts, including 0%, 100%, the floor itself, one hundredth either side of it, odd cents and a zero price;
- named boundary cases: floor price rounding, half-cent rounding, a free item, a floor of 0 and of 100;
- the real catalog under the real sale: a cart holding every variant is run through the Function entry point and each line's discount is compared with `priceVariant()`, and no excluded variant may receive a discount;
- fail-closed cases that exist only on the checkout side: unknown or missing policy, a floor policy with no readable floor, a non-numeric floor, a non-boolean flag. The storefront throws `RangeError` on invalid input and the Function must not throw at checkout, so the agreed behaviour is "no discount";
- the Function entry point: wrong discount class, missing or unusable configuration, missing terms, and lines that are not product variants.

### What the docs changed

The first design had the Function read `custom.vendor_profile` and follow it to the vendor metaobject. That is not possible. The Function input schema has no `reference` field on `Metafield` (only `value`, `jsonValue`, `type`, `namespace`, `key`), and the one way to reach a metaobject, the `metaobject` root field, serves only app-owned metaobjects under the reserved `$app` prefix. `assay_vendor` is a store-owned metaobject, so it is out of reach.

The simplest correct alternative is a mirror. `npm run shopify:provision` now also writes `custom.map_terms` on every product (JSON, `{"policy": "floor", "floor_pct": 15}`), derived from the same catalog data as the vendor entry and corrected on each run if it differs. The storefront still reads the metaobject; the Function reads the mirror. The cost is a second copy of the vendor's terms that must stay in step, which is why provisioning rewrites it rather than trusting it, and why a missing or unreadable mirror means no discount. Editing a vendor in the admin without re-running provisioning leaves the mirror stale; that is the main operational gap of this design.

Input query cost is 12 of the 30 allowed (three metafield reads at 3 each, plus leaf fields). The query validates against the 2026-07 schema.

### Function inputs

- `custom.map_terms` on the product (the mirror above).
- `custom.map_protected` on the variant. Only an explicit `false` unprotects a SKU of a `partial` vendor; absent or unreadable means protected.
- A `$app:map-guard` / `config` metafield on the discount itself, JSON `{"percentOff": 25, "name": "Autumn Sale"}`. The sale is site configuration in `data/catalog.json` for the storefront and has to be set here too; the Function does nothing without it.
- The line's list price comes from the cart (`cost.amountPerQuantity`), assumed to be in the store currency (USD) and to carry no compare-at price.

### Deployment status

Live. The function ships in the app `assay-map-guard`, is installed on the
store, and an automatic discount of its type is active: "Autumn Sale (MAP
guarded)", 25% off, product class.

The sale is configured by a Discount Function Settings extension,
`extensions/map-guard-settings` (target
`admin.discount-details.function-settings.render`). It writes the sale label and
percentage to the `$app:map-guard` / `config` metafield that the function reads,
so changing the sale does not mean changing code.

`node scripts/verify-checkout.mjs` builds one real cart per MAP case through the
Storefront API and compares each line against what the rule allows. It exits
non-zero on any mismatch. Observed against the live store under a 25% sale:

| Case | Vendor | List | Cart total | Discount |
|---|---|---|---|---|
| `open` | Northbound | 28.00 | 21.00 | 7.00, the full 25% |
| `none` | Kestrel | 34.00 | 34.00 | none, refused |
| `floor` at 15% | Vireo | 39.00 | 33.15 | 5.85, clamped from 9.75 |
| `partial`, protected | Meridian | 26.00 | 26.00 | none |
| `partial`, unprotected | Meridian | 46.00 | 34.50 | 11.50 |

The Vireo and Meridian rows are the ones worth reading. Vireo sits under a 25%
sale and takes 15%, because Shopify's discount engine applied the vendor's floor
rather than the advertised rate. The same Meridian product discounts or does not
depending on one per-variant flag.

Note that `none` and `protected` are only meaningful alongside a case that does
discount. Before the discount instance existed every cart came back at list
price, and those two rows "passed" while proving nothing.

## Running it

Requires Node 20 or later.

```
npm install
npm run dev        # local dev server
npm test           # Vitest
npm run typecheck  # route type generation + tsc
npm run build      # production build into dist/
```

## Scope of phase 1

Included: catalog model and data, MAP engine with tests, home page with an exclusions-aware sale banner, collection page with vendor filtering, product page with price and discount explanation.

Not included: cart, checkout, customer accounts.

## Status

`/status` is a public page showing how the storefront performs for real visitors, not for one synthetic run. A Lighthouse score is a single measurement on a fast machine; this is what actual browsers on actual connections experience, continuously.

**What is measured.** The three Core Web Vitals: LCP (how long the main content takes to appear), INP (how quickly the page responds to input) and CLS (how much the layout jumps). Measurement is done by the [`web-vitals`](https://github.com/GoogleChrome/web-vitals) library rather than hand-written `PerformanceObserver` code, because each metric has subtle rules that are easy to get wrong. The browser sends one beacon with `navigator.sendBeacon` when the page is hidden, which never blocks the page from unloading.

**Why p75.** Each figure is the 75th percentile: three quarters of visits were at least that good. That is the standard Google uses to assess Core Web Vitals. The mean is the wrong summary for latency: a few very slow visits drag it up and a fast majority hides the tail. The page shows p75 by route pattern and device class, with the sample count next to every number.

**Honest about small samples.** A p75 over four visits is noise. A figure is only rendered when a group has at least 20 samples (`MIN_SAMPLES` in `app/lib/vitals/schema.ts`); below that the page shows the count and says there are too few samples. With no data at all it says so, and never renders a zero or a dash that could be read as health. The window is the last 7 days, and the page states when it was generated.

**Privacy position.** Only these fields are stored: metric name, value, route pattern (such as `/products/:handle`, never the resolved URL and never a query string), a coarse device class (mobile or desktop, from the pointer type) and a timestamp. There is no column for anything else. The endpoint does not read the User-Agent, cookies or Referer; the beacon sets no cookie and uses no browser storage; there is no session or visitor identifier, so two visits cannot be linked. Unknown fields, metric names and routes are rejected rather than ignored, so free text cannot be smuggled in. Samples are deleted after 30 days.

The client IP is used for one thing: a per-sender rate limit (30 requests a minute). It is turned into a keyed hash with a secret that lives only in process memory and is replaced every window, held in memory for that window, and never written anywhere. The limit is per server instance, so serverless instances do not share a count and a restart resets it. It is a brake on accidental loops and casual abuse, not a security boundary; the hard protection is strict validation and a 2 KiB body cap.

**Layout.**

```
migrations/                   Plain SQL migrations
scripts/migrate.mjs           Applies migrations once each, in order
app/lib/vitals/schema.ts      Accepted metrics, routes, ranges, thresholds
app/lib/vitals/validate.ts    Strict payload validation
app/lib/vitals/aggregate.ts   Percentile, rating and the too-few-samples rule
app/lib/vitals/rate-limit.ts  In-memory, hashed, windowed rate limiter
app/lib/vitals/db.server.ts   The only code that talks to Postgres
app/lib/vitals/beacon.client.ts  web-vitals reporting via sendBeacon
app/routes/api.vitals.ts      POST /api/vitals
app/routes/status.tsx         /status
```

**Running it.** The store is a Postgres database (Neon). Set `DATABASE_URL` for reads and writes, and run `npm run db:migrate` with `DATABASE_URL_UNPOOLED` set to apply the schema. Without `DATABASE_URL` the status page reports that measurements are unavailable, which is distinct from having no data.

## License

MIT. See `LICENSE`.
