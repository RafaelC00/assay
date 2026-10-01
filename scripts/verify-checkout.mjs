#!/usr/bin/env node
/**
 * Prove MAP at checkout: build real carts through the Storefront API and print
 * what the discount function actually did to each line.
 *
 *   node scripts/verify-checkout.mjs
 *
 * One cart per MAP case. Needs SHOPIFY_STORE_DOMAIN, SHOPIFY_API_VERSION and
 * PUBLIC_STOREFRONT_API_TOKEN (read from .env when present). Tokens are never
 * printed. Exits 1 when any case is not what MAP requires, and says so plainly
 * when no discount is applied anywhere (function deployed but not firing).
 */
import {readFileSync, existsSync} from 'node:fs';

if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const {SHOPIFY_STORE_DOMAIN: domain, SHOPIFY_API_VERSION: version, PUBLIC_STOREFRONT_API_TOKEN: token} = process.env;
if (!domain || !version || !token) {
  console.error('Missing SHOPIFY_STORE_DOMAIN, SHOPIFY_API_VERSION or PUBLIC_STOREFRONT_API_TOKEN.');
  process.exit(2);
}

const catalog = JSON.parse(readFileSync('data/catalog.json', 'utf8'));
const salePct = catalog.sale.percent_off;

async function sf(query, variables) {
  const res = await fetch(`https://${domain}/api/${version}/graphql.json`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'X-Shopify-Storefront-Access-Token': token},
    body: JSON.stringify({query, variables}),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

const variantId = async (handle, sku) => {
  const d = await sf(
    `query($h:String!){product(handle:$h){variants(first:10){nodes{id sku}}}}`,
    {h: handle},
  );
  const v = d.product?.variants.nodes.find((n) => n.sku === sku);
  if (!v) throw new Error(`variant ${sku} not found`);
  return v.id;
};

// expectedPct is the deepest discount MAP permits for that line at the sale percentage.
const cases = [
  {label: 'open', handle: 'northbound-creatine-monohydrate', sku: 'NORTHBOUNDCREATINEMONOHYDRATE-300', listCents: 2800, expectedPct: salePct},
  {label: 'none', handle: 'kestrel-omega-3-triglyceride', sku: 'KESTRELOMEGA3TRIGLYCERIDE-60', listCents: 3400, expectedPct: 0},
  {label: 'floor (15%)', handle: 'vireo-plant-protein', sku: 'VIREOPLANTPROTEIN-900', listCents: 3900, expectedPct: Math.min(salePct, 15)},
  {label: 'partial, protected', handle: 'meridian-ashwagandha-root', sku: 'MERIDIANASHWAGANDHAROOT-60', listCents: 2600, expectedPct: 0},
  {label: 'partial, unprotected', handle: 'meridian-ashwagandha-root', sku: 'MERIDIANASHWAGANDHAROOT-120', listCents: 4600, expectedPct: salePct},
];

let failed = 0;
let anyDiscount = false;
for (const c of cases) {
  const id = await variantId(c.handle, c.sku);
  const d = await sf(
    `mutation($l:[CartLineInput!]!){cartCreate(input:{lines:$l}){cart{
       cost{subtotalAmount{amount} totalAmount{amount}}
       discountAllocations{discountedAmount{amount} ... on CartAutomaticDiscountAllocation{title}}
       lines(first:5){nodes{cost{subtotalAmount{amount} totalAmount{amount}}
         discountAllocations{discountedAmount{amount} ... on CartAutomaticDiscountAllocation{title}}}}
     } userErrors{message}}}`,
    {l: [{merchandiseId: id, quantity: 1}]},
  );
  const cart = d.cartCreate.cart;
  const line = cart.lines.nodes[0];
  const off = Math.round((Number(line.cost.subtotalAmount.amount) - Number(line.cost.totalAmount.amount)) * 100);
  // Mirrors the rule: a floor vendor's price rounds up, so it never lands under the floor.
  const round = c.label.startsWith('floor') ? Math.ceil : Math.round;
  const expectedOff = c.listCents - round((c.listCents * (100 - c.expectedPct)) / 100);
  const ok = off === expectedOff;
  if (off > 0) anyDiscount = true;
  if (!ok) failed++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${c.label.padEnd(22)} list ${(c.listCents / 100).toFixed(2)}  ` +
      `subtotal ${line.cost.subtotalAmount.amount}  total ${line.cost.totalAmount.amount}  ` +
      `off ${(off / 100).toFixed(2)} (expected ${(expectedOff / 100).toFixed(2)})  allocations ${JSON.stringify(line.discountAllocations)}`,
  );
}
if (!anyDiscount) {
  console.log('\nNo discount was applied to any line: the function is deployed but NOT firing (no active discount instance).');
}
process.exit(failed ? 1 : 0);
