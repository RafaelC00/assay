#!/usr/bin/env node
/**
 * Two carts contend for the last unit of a variant.
 *
 *   node scripts/incidents/sold-out-race.mjs [handle] [sku]
 *
 * Needs SHOPIFY_STORE_DOMAIN, SHOPIFY_API_VERSION, PUBLIC_STOREFRONT_API_TOKEN
 * and SHOPIFY_ADMIN_TOKEN (read from .env). Tokens are never printed.
 *
 * What it does to the store, and undoes:
 *   1. turns inventory tracking on for ONE variant and sets its stock to 1
 *   2. runs the scenario below
 *   3. in a finally block, restores tracking and the stock it found
 * Nothing else is touched. The storefront does not read inventory, so the
 * variant looks the same to visitors throughout.
 *
 * The token available here cannot create orders, so "buyer A completes the
 * purchase" is simulated by taking the last unit out of stock with an
 * inventory adjustment. That is the same effect on the stock level but not the
 * same code path as a real order; the report says so.
 */
import {readFileSync, existsSync} from 'node:fs';

if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const {
  SHOPIFY_STORE_DOMAIN: domain,
  SHOPIFY_API_VERSION: version,
  PUBLIC_STOREFRONT_API_TOKEN: sfToken,
  SHOPIFY_ADMIN_TOKEN: adminToken,
} = process.env;
if (!domain || !version || !sfToken || !adminToken) {
  console.error('Missing SHOPIFY_STORE_DOMAIN, SHOPIFY_API_VERSION, PUBLIC_STOREFRONT_API_TOKEN or SHOPIFY_ADMIN_TOKEN.');
  process.exit(2);
}
const handle = process.argv[2] ?? 'northbound-electrolyte-mix';
const sku = process.argv[3] ?? 'NORTHBOUNDELECTROLYTEMIX-30';

const log = (msg) => console.log(`${new Date().toISOString().slice(11, 23)}Z  ${msg}`);

async function gql(url, headers, query, variables) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {'content-type': 'application/json', ...headers},
    body: JSON.stringify({query, variables}),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}
const admin = (q, v) => gql(`https://${domain}/admin/api/${version}/graphql.json`, {'x-shopify-access-token': adminToken}, q, v);
const sf = (q, v) => gql(`https://${domain}/api/${version}/graphql.json`, {'x-shopify-storefront-access-token': sfToken}, q, v);

const CART_FIELDS = `id checkoutUrl
  lines(first:5){nodes{id quantity merchandise{... on ProductVariant{sku availableForSale quantityAvailable currentlyNotInStock}}}}`;
const WARN = `warnings{code message}`;

// Locate the variant and remember what it looked like.
const found = await admin(
  `query($h:String!){productByHandle(handle:$h){variants(first:20){nodes{id sku inventoryPolicy inventoryItem{id tracked inventoryLevels(first:5){nodes{location{id} quantities(names:["available"]){quantity}}}}}}}}`,
  {h: handle},
);
const variant = found.productByHandle?.variants.nodes.find((v) => v.sku === sku);
if (!variant) throw new Error(`variant ${sku} not found`);
const item = variant.inventoryItem;
const level = item.inventoryLevels.nodes[0];
const original = {tracked: item.tracked, available: level.quantities[0].quantity, policy: variant.inventoryPolicy};
log(`found ${sku}: tracked=${original.tracked} available=${original.available} policy=${original.policy}`);

const setStock = async (qty) => {
  const d = await admin(
    `mutation($i:InventorySetQuantitiesInput!){inventorySetQuantities(input:$i){userErrors{field message}}}`,
    {
      i: {
        name: 'available',
        reason: 'correction',
        ignoreCompareQuantity: true,
        quantities: [{inventoryItemId: item.id, locationId: level.location.id, quantity: qty}],
      },
    },
  );
  const e = d.inventorySetQuantities.userErrors;
  if (e.length) throw new Error(JSON.stringify(e));
};
const setTracked = (tracked) =>
  admin(`mutation($id:ID!,$t:Boolean){inventoryItemUpdate(id:$id,input:{tracked:$t}){userErrors{message}}}`, {
    id: item.id,
    t: tracked,
  });


// The Storefront API is not read-your-writes: an inventory change made through
// the Admin API takes a while to show up. Poll until it does and report how long.
async function waitForStorefront(label, predicate, limitMs = 60_000) {
  const t0 = Date.now();
  for (;;) {
    const d = await sf(
      `query($id:ID!){node(id:$id){... on ProductVariant{availableForSale quantityAvailable currentlyNotInStock}}}`,
      {id: variant.id},
    );
    if (predicate(d.node)) {
      log(`storefront caught up (${label}) after ${Date.now() - t0}ms: ${JSON.stringify(d.node)}`);
      return Date.now() - t0;
    }
    if (Date.now() - t0 > limitMs) {
      log(`storefront did NOT catch up (${label}) within ${limitMs}ms: ${JSON.stringify(d.node)}`);
      return null;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

const readCart = async (id) => (await sf(`query($id:ID!){cart(id:$id){${CART_FIELDS}}}`, {id})).cart;
const describe = (c) => {
  const l = c.lines.nodes[0];
  return l
    ? `qty=${l.quantity} availableForSale=${l.merchandise.availableForSale} quantityAvailable=${l.merchandise.quantityAvailable} currentlyNotInStock=${l.merchandise.currentlyNotInStock}`
    : 'cart has NO lines';
};

try {
  await setTracked(true);
  await setStock(1);
  log('stock set: tracked=true available=1');
  await waitForStorefront('available=1', (n) => n.quantityAvailable === 1);

  const create = async (who, quantity) => {
    const d = await sf(
      `mutation($l:[CartLineInput!]!){cartCreate(input:{lines:$l}){cart{${CART_FIELDS}} userErrors{code message} ${WARN}}}`,
      {l: [{merchandiseId: variant.id, quantity}]},
    );
    const r = d.cartCreate;
    log(
      `${who}: cartCreate qty=${quantity} -> ${r.cart ? describe(r.cart) : 'NO CART'} userErrors=${JSON.stringify(r.userErrors)} warnings=${JSON.stringify(r.warnings)}`,
    );
    return r.cart;
  };

  log('--- Step 1: both buyers add the last unit');
  const cartA = await create('buyer A', 1);
  const cartB = await create('buyer B', 1);
  log('--- Step 1b: a buyer asks for 2 when 1 exists');
  await create('buyer C', 2);

  log('--- Step 2: buyer A completes the purchase (simulated: stock -> 0)');
  await setStock(0);
  log('stock set: available=0');
  await waitForStorefront('available=0', (n) => n.quantityAvailable === 0);

  log('--- Step 3: what buyer B sees with no action of their own');
  const before = await readCart(cartB.id);
  log(`B reads cart: ${describe(before)}`);

  log('--- Step 4: buyer B touches the cart');
  const upd = await sf(
    `mutation($c:ID!,$l:[CartLineUpdateInput!]!){cartLinesUpdate(cartId:$c,lines:$l){cart{${CART_FIELDS}} userErrors{code message} ${WARN}}}`,
    {c: cartB.id, l: [{id: before.lines.nodes[0].id, quantity: 1}]},
  );
  const u = upd.cartLinesUpdate;
  log(
    `B cartLinesUpdate qty=1 -> ${u.cart ? describe(u.cart) : 'NO CART'} userErrors=${JSON.stringify(u.userErrors)} warnings=${JSON.stringify(u.warnings)}`,
  );

  log('--- Step 5: a new buyer tries to add the sold-out unit');
  await create('buyer D', 1);

  log('--- Step 6: does the checkout URL of buyer B still resolve?');
  const res = await fetch(cartB.checkoutUrl, {redirect: 'manual'});
  log(`GET checkoutUrl (B) -> HTTP ${res.status}${res.headers.get('location') ? ' (redirect)' : ''}`);
} finally {
  await setStock(original.available);
  await setTracked(original.tracked);
  const back = await admin(
    `query($h:String!){productByHandle(handle:$h){variants(first:20){nodes{sku inventoryItem{tracked inventoryLevels(first:1){nodes{quantities(names:["available"]){quantity}}}}}}}}`,
    {h: handle},
  );
  await waitForStorefront('restored', (n) => n.availableForSale === true);
  const v = back.productByHandle.variants.nodes.find((x) => x.sku === sku);
  log(
    `RESTORED ${sku}: tracked=${v.inventoryItem.tracked} available=${v.inventoryItem.inventoryLevels.nodes[0].quantities[0].quantity}`,
  );
}
