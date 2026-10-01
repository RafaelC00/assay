#!/usr/bin/env node
/**
 * One load-test stage against one path, with hard caps.
 *
 *   VERCEL_BYPASS=... node loadtest/run.mjs <base-url> <path> \
 *     --connections 5 --amount 300 --duration 30 [--vitals] [--label name]
 *
 * Runs autocannon (pinned) and prints a single summary line. The caps are
 * enforced by autocannon itself: it stops at --amount total requests or
 * --duration seconds, whichever comes first. A summary row is appended to
 * loadtest/results.jsonl. The bypass secret is read from the environment, sent
 * as a header, and never written anywhere: the raw autocannon output (which
 * echoes request headers) is discarded and only selected fields are kept.
 *
 * Refuses to run against the production host.
 */
import {spawnSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const PRODUCTION_HOSTS = ['assay-gamma-ten.vercel.app'];
const AUTOCANNON = 'autocannon@8.0.0';

const args = process.argv.slice(2);
const [base, path] = args;
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
if (!base || !path) {
  console.error('usage: run.mjs <base-url> <path> --connections n --amount n --duration s [--vitals] [--label x]');
  process.exit(2);
}
if (PRODUCTION_HOSTS.includes(new URL(base).host)) {
  console.error('refusing: this is the production host. Load-test a preview deployment only.');
  process.exit(2);
}
const secret = process.env.VERCEL_BYPASS;
if (!secret) {
  console.error('VERCEL_BYPASS is not set; a protected preview would answer 401 to every request.');
  process.exit(2);
}

const connections = Number(opt('connections', '1'));
const amount = Number(opt('amount', '100'));
const duration = Number(opt('duration', '30'));
const label = opt('label', path);
const vitals = args.includes('--vitals');
if (amount > 5000 || duration > 60 || connections > 100) {
  console.error('refusing: a single stage is capped at 5000 requests, 60 s and 100 connections.');
  process.exit(2);
}

const cli = [
  '--yes', AUTOCANNON, '--json', '-c', String(connections), '-a', String(amount), '-d', String(duration),
  '-t', '30', '-H', `x-vercel-protection-bypass=${secret}`, '-H', 'user-agent=assay-loadtest/1',
];
if (vitals) {
  // Deliberately invalid body: exercises routing, the rate limiter, the body
  // read and validation, and is rejected before the database insert.
  cli.push('-m', 'POST', '-H', 'content-type=application/json', '-b', '{"device":"nope","metrics":[]}');
}
cli.push(base.replace(/\/$/, '') + path);

const started = new Date().toISOString();
const r = spawnSync('npx', cli, {encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 64 * 1024 * 1024});
let j;
try {
  j = JSON.parse(r.stdout);
} catch {
  console.error('autocannon produced no JSON; exit', r.status);
  process.exit(1);
}

const lat = j.latency;
const row = {
  started,
  label,
  path,
  method: vitals ? 'POST' : 'GET',
  connections,
  capAmount: amount,
  capSeconds: duration,
  requests: j.requests.total,
  rps: Math.round(j.requests.average * 10) / 10,
  non2xx: j.non2xx,
  errors: j.errors,
  timeouts: j.timeouts,
  statusCodes: j.statusCodeStats ? Object.fromEntries(Object.entries(j.statusCodeStats).map(([k, v]) => [k, v.count])) : {},
  latencyMs: {p50: lat.p50, p75: lat.p75, p90: lat.p90, p97_5: lat.p97_5, p99: lat.p99, max: lat.max},
  durationS: j.duration,
  bytesPerSecond: j.throughput.average,
  bytesTotal: Math.round(j.throughput.average * j.duration),
};
appendFileSync(join(dirname(fileURLToPath(import.meta.url)), 'results.jsonl'), JSON.stringify(row) + '\n');

const codes = Object.entries(row.statusCodes).map(([k, v]) => `${k}:${v}`).join(' ') || '-';
console.log(
  `${label.padEnd(26)} c=${String(connections).padStart(3)} n=${String(row.requests).padStart(5)} ` +
    `rps=${String(row.rps).padStart(6)} p50=${lat.p50} p75=${lat.p75} p90=${lat.p90} p99=${lat.p99} max=${lat.max}ms ` +
    `status[${codes}] err=${row.errors} timeouts=${row.timeouts}`,
);
if (row.statusCodes['403']) {
  console.error('403 seen: possible platform mitigation. STOP and check the mitigation header.');
  process.exit(3);
}
