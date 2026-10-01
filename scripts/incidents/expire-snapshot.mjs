#!/usr/bin/env node
/**
 * Warm the Shopify catalog snapshot, break the upstream, and watch what the
 * snapshot does when its TTL runs out. Uses the production module with a
 * 3-second TTL standing in for the real 30.
 *
 *   node scripts/incidents/expire-snapshot.mjs
 *
 * Question answered: is the last good snapshot served while the upstream is
 * down (stale-if-error), or does the read fail as soon as the TTL passes?
 */
import http from 'node:http';
import {createShopifyCatalogSource} from '../../app/lib/catalog/shopify.ts';

let up = true;
const server = http.createServer((req, res) => {
  req.resume();
  if (!up) {
    res.statusCode = 503;
    return res.end('down');
  }
  res.setHeader('content-type', 'application/json');
  res.end(
    JSON.stringify({
      data: {
        shop: {paymentSettings: {currencyCode: 'USD'}},
        vendors: {nodes: []},
        products: {pageInfo: {hasNextPage: false, endCursor: null}, nodes: []},
      },
    }),
  );
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const source = createShopifyCatalogSource({
  domain: `127.0.0.1:${server.address().port}`,
  apiVersion: 'test',
  token: 'not-a-real-token',
  sale: {name: 'x', percent_off: 0},
  ttlMs: 3000,
  fetch: (url, init) => fetch(String(url).replace('https://', 'http://'), init),
});

const t0 = Date.now();
const read = async (label) => {
  const outcome = await source.getCurrency().then(
    (v) => `served (${v})`,
    (e) => `FAILED: ${e.message}`,
  );
  console.log(`t+${((Date.now() - t0) / 1000).toFixed(1)}s  ${label.padEnd(34)} ${outcome}`);
};

await read('upstream up, cold read');
up = false;
console.log('--- upstream now returns 503 ---');
await read('inside TTL');
await new Promise((r) => setTimeout(r, 3200));
await read('after TTL expired');
await read('immediately again');
up = true;
console.log('--- upstream healthy again ---');
await read('first read after recovery');
process.exit(0);
