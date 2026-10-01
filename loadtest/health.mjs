#!/usr/bin/env node
/**
 * Production health gate: three GETs, no load. Exits non-zero if any path is not
 * 200 or carries an X-Vercel-Mitigated header.
 *
 *   node loadtest/health.mjs https://<production-host>
 */
const base = process.argv[2]?.replace(/\/$/, '');
if (!base) {
  console.error('usage: health.mjs <production-url>');
  process.exit(2);
}
let bad = false;
for (const p of ['/', '/status', '/collections/all']) {
  const t0 = Date.now();
  const res = await fetch(base + p, {headers: {'user-agent': 'assay-loadtest-health/1'}, redirect: 'manual'});
  await res.arrayBuffer();
  const mitigated = res.headers.get('x-vercel-mitigated');
  const ok = res.status === 200 && !mitigated;
  if (!ok) bad = true;
  console.log(`${new Date().toISOString().slice(11, 19)}Z ${p.padEnd(18)} ${res.status} ${Date.now() - t0}ms mitigated=${mitigated ?? 'no'} ${ok ? 'OK' : 'FAIL'}`);
}
process.exit(bad ? 1 : 0);
