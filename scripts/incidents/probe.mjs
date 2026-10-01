#!/usr/bin/env node
/**
 * Probe a deployment and print one line per request: UTC time, path, status,
 * elapsed ms, cache header, and a coarse reading of the body.
 *
 *   node scripts/incidents/probe.mjs <base-url> [--paths /,/status] [--count 1] [--every 5]
 *
 * VERCEL_BYPASS (optional): a deployment-protection bypass secret, sent as a
 * header so preview deployments can be probed. Read from the environment only,
 * never printed.
 *
 * The body reading is deliberately crude: it reports whether the page is the
 * error boundary and how many product links it contains, which is enough to
 * tell "rendered the catalog" from "rendered the error page" from "rendered
 * nothing".
 */
const args = process.argv.slice(2);
const base = args[0]?.replace(/\/$/, '');
if (!base) {
  console.error('usage: probe.mjs <base-url> [--paths a,b] [--count n] [--every seconds] [--timeout seconds]');
  process.exit(2);
}
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const paths = opt('paths', '/,/status,/collections/all,/products/northbound-creatine-monohydrate').split(',');
const count = Number(opt('count', '1'));
const every = Number(opt('every', '5'));
const timeoutMs = Number(opt('timeout', '60')) * 1000;
const headers = {'user-agent': 'assay-incident-probe/1'};
if (process.env.VERCEL_BYPASS) headers['x-vercel-protection-bypass'] = process.env.VERCEL_BYPASS;

for (let n = 0; n < count; n++) {
  for (const p of paths) {
    const t0 = Date.now();
    const at = new Date(t0).toISOString().slice(11, 19);
    try {
      const res = await fetch(base + p, {headers, signal: AbortSignal.timeout(timeoutMs), redirect: 'manual'});
      const body = await res.text();
      const ms = Date.now() - t0;
      const links = (body.match(/\/products\/[a-z0-9-]+/g) ?? []).length;
      const kind = /Something went wrong/.test(body)
        ? 'error-page'
        : /Security Checkpoint/.test(body)
          ? 'vercel-challenge'
          : links > 0 || /Core Web Vitals|Window:/.test(body)
            ? 'content'
            : 'other';
      console.log(
        `${at}Z ${p.padEnd(42)} ${res.status} ${String(ms).padStart(6)}ms cache=${res.headers.get('x-vercel-cache') ?? '-'} body=${kind} productLinks=${links}`,
      );
    } catch (err) {
      console.log(`${at}Z ${p.padEnd(42)} ERR ${String(Date.now() - t0).padStart(6)}ms ${err.name}`);
    }
  }
  if (n < count - 1) await new Promise((r) => setTimeout(r, every * 1000));
}
