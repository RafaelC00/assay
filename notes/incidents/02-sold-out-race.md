# Incident 02: two carts contend for the last unit

Status: DRAFT, not reviewed. Not linked from the README or the site.
Date: 2026-10-01. Times are UTC.

## Summary

The race cannot occur in production as the store is configured, because inventory tracking is off for every variant. Every variant reports `quantityAvailable: 0` with `availableForSale: true`: the store has no stock model, so nothing can sell out. The race was therefore staged on one variant by turning tracking on and setting stock to 1, then restoring it.

Staged, the result was:

1. Two buyers can both put the last unit in a cart. Carts do not reserve stock.
2. The Storefront API does not see inventory changes immediately: 5 to 17 seconds to show a new stock level and about 28 seconds to show a sell-out. That lag is the real race window.
3. The ASSAY site itself never says anything about stock, so a visitor is told nothing at any point.

The final step, what the second buyer sees at Shopify's checkout, was not exercised. See "Limits".

## How it was induced

`scripts/incidents/sold-out-race.mjs`. It records the variant's state, sets tracking on and stock to 1 on `NORTHBOUNDELECTROLYTEMIX-30`, runs the scenario through the Storefront API, and restores the recorded state in a `finally` block. A separate preview deployment of the site was probed at the same time to see what visitors saw.

Limit on realism: the Admin token available has no order-creation scope, so "buyer A completes the purchase" was simulated by setting stock to 0. The stock level is the same as after a real order. The code path is not.

## Detection

Run 2, UTC:

```
18:36:14  stock set: tracked=true available=1
18:36:31  storefront caught up (available=1) after 17462ms
18:36:32  buyer A: cartCreate qty=1 -> qty=1 quantityAvailable=1 userErrors=[] warnings=[]
18:36:32  buyer B: cartCreate qty=1 -> qty=1 quantityAvailable=1 userErrors=[] warnings=[]
18:36:33  buyer C: cartCreate qty=2 -> qty=1 warnings=[MERCHANDISE_NOT_ENOUGH_STOCK "Only 1 item was added to your cart due to availability."]
18:36:33  stock set: available=0   (buyer A "buys")
18:37:01  storefront caught up (available=0) after 28022ms
18:37:02  B reads cart: qty=1 availableForSale=false quantityAvailable=0
18:37:02  B cartLinesUpdate qty=1 -> qty=0 warnings=[MERCHANDISE_OUT_OF_STOCK "The product 'Electrolyte Mix, Citrus - 30 sticks' is already sold out."]
18:37:03  buyer D: cartCreate qty=1 -> qty=0 warnings=[MERCHANDISE_OUT_OF_STOCK ...]
```

Propagation lag across the runs: stock 1 became visible after 17.5 s and 5.2 s; stock 0 became visible after 28.0 s and 28.2 s.

What each buyer saw:

- **A and B, both told yes.** Both carts hold quantity 1 of a single unit, with no warning. Nothing is reserved.
- **C, asking for 2, told the truth immediately**, with a clear warning and the quantity corrected to 1.
- **B, after A bought.** A plain cart read still says `qty=1` while the same payload says `availableForSale=false`. The cart contradicts itself until the buyer changes it. When B does touch the cart, the line drops to quantity 0 and a warning explains why. The warning is accurate and specific, but it arrives only as a field on the response to a mutation. A client that ignores `warnings` shows an empty cart with no explanation.
- **D, a new buyer,** is refused correctly once the Storefront API has caught up.
- **The ASSAY product page** did not change at any point: no "sold out" wording, no stock wording, no add-to-cart. A search of the rendered page for sold out, in stock, out of stock, add to cart and available found nothing, and the application code contains no inventory handling. The site has no cart, so it cannot mislead a buyer at the moment of purchase, but it also cannot tell anyone a product is gone.

Run 1 showed the inverse problem. The scenario began immediately after setting stock to 1, before the Storefront API had caught up. Every cart came back with quantity 0 and "already sold out" for a variant that actually had a unit. Buyers are turned away for the length of the lag while stock exists.

**What would have told me: nothing.** There is no inventory view on the site, no oversell counter, no log line, no alert. An oversell would show up only as negative or inconsistent stock in the Shopify admin, found by someone looking. Whether the second buyer is treated honestly at the end depends on a step that was not tested (below).

## Diagnosis

- Carts are intent, not reservations. Stock is checked at cart time against a view that can be about 30 seconds stale, and again at checkout. Contention is settled at checkout, by Shopify, not by this application.
- Two stock views disagree during the lag window, in both directions: a unit that exists is refused, and a unit that is gone is accepted.
- The store is not configured to track inventory at all. That is why the race cannot happen today. It is a configuration fact, not a property of the code.

## Fix (proposed, not implemented here)

- Decide deliberately whether the store tracks inventory. If it does, the product page should read `availableForSale` and say "Sold out", and the pricing note must not advertise a sale price on a product that cannot be bought. `availableForSale` and `quantityAvailable` are already exposed to the existing public token.
- When a cart UI is built, render `warnings` from every cart mutation, and treat a line whose merchandise is `availableForSale: false` as removed even when a read still reports its quantity.
- Do not rely on the Storefront API for a hard stock guarantee. The guarantee is checkout's.

## Prevention

- Add an inventory check to post-deploy verification so that every variant being unexpectedly untracked, or unexpectedly sold out, is noticed. `scripts/verify-checkout.mjs` is the natural home, since it already builds real carts.
- If inventory tracking is turned on, count cart warnings of type `MERCHANDISE_OUT_OF_STOCK` and alert on a spike. It means the storefront is selling something that is gone.

## Limits and what did not happen

- Checkout was not exercised. Without an order scope and a payment method on the store, buyer B was not taken through Shopify's checkout, so what B sees on the final page, and whether it is worded honestly, is not known from this exercise.
- No oversell was demonstrated. Two carts held the last unit, which is the precondition, not the failure.
- No error reached any visitor of the real site. Each run touched one variant's stock for under a minute. The site does not read stock and the variant looked the same throughout. Tracking and quantity were restored and confirmed after each run (tracked false, available 0, `availableForSale` true).
