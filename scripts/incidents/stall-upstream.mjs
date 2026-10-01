#!/usr/bin/env node
/**
 * Point the real Shopify catalog source at a local server that accepts the
 * request and then says nothing, and measure how long a catalog read waits.
 *
 *   node scripts/incidents/stall-upstream.mjs [mode] [seconds]
 *
 * mode: stall (never respond), slow (respond after <seconds>), 500 (respond 500)
 *
 * This is the case a connect timeout cannot cover: the TCP connection is
 * healthy, the upstream is just not answering. The source under test is the
 * production module, imported unchanged. Needs a Node that strips
 * TypeScript types natively (22.18 or later).
 */
import http from 'node:http';
import {createShopifyCatalogSource} from '../../app/lib/catalog/shopify.ts';

const mode = process.argv[2] ?? 'stall';
const seconds = Number(process.argv[3] ?? '5');
const waitLimitMs = 45_000;

let healthy = false;
const hits = [];
const server = http.createServer((req, res) => {
  hits.push(Date.now());
  req.resume();
  if (mode === 'stall' && !healthy) return; // never answer
  if (mode === '500' && !healthy) {
    res.statusCode = 500;
    return res.end('upstream broke');
  }
  setTimeout(() => {
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
  }, mode === 'slow' && !healthy ? seconds * 1000 : 0);
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const {port} = server.address();

const source = createShopifyCatalogSource({
  domain: `127.0.0.1:${port}`,
  apiVersion: 'test',
  token: 'not-a-real-token',
  sale: {name: 'x', percent_off: 0},
  // The module builds an https:// URL; route it to the plain-http local server.
  fetch: (url, init) => fetch(String(url).replace('https://', 'http://'), init),
});

async function timed(label) {
  const t0 = Date.now();
  const outcome = await Promise.race([
    source.getCurrency().then((v) => `ok (${v})`, (e) => `rejected: ${e.message}`),
    new Promise((r) => setTimeout(() => r(`STILL WAITING after ${waitLimitMs / 1000}s, gave up observing`), waitLimitMs)),
  ]);
  console.log(`${new Date().toISOString().slice(11, 19)}Z ${label.padEnd(22)} ${String(Date.now() - t0).padStart(6)}ms  ${outcome}`);
}

console.log(`mode=${mode}${mode === 'slow' ? ` (${seconds}s)` : ''}`);
await timed('request 1');
await timed('request 2 (no cache)');
console.log(`upstream requests received: ${hits.length}`);
healthy = true;
await timed('after upstream heals');
await timed('and again (cached)');
console.log(`upstream requests received: ${hits.length}`);
process.exit(0);
