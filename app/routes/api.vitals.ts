import type {Route} from './+types/api.vitals';
import {insertSamples, pruneOld} from '~/lib/vitals/db.server';
import {RateLimiter} from '~/lib/vitals/rate-limit';
import {MAX_BODY_BYTES} from '~/lib/vitals/schema';
import {parseBeaconBody} from '~/lib/vitals/validate';

/**
 * POST /api/vitals: receives real-user Core Web Vitals beacons.
 *
 * PRIVACY. What is stored per sample: metric name, value, route pattern, a
 * coarse device class (mobile/desktop) and a timestamp. Nothing else. This
 * handler does not read the User-Agent header, cookies or the Referer, and it
 * never writes an IP address anywhere. The IP is used for exactly one thing:
 * an in-memory rate limit that keeps only a keyed hash for the current minute
 * (see rate-limit.ts, which also states the limits of that approach).
 */

const limiter = new RateLimiter(30, 60_000);

/** Roughly 1 in 100 writes also prunes samples past retention. */
const PRUNE_ODDS = 0.01;

const text = (status: number, message: string) =>
  new Response(message, {status, headers: {'Content-Type': 'text/plain; charset=utf-8'}});

function clientAddress(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  return (forwarded ? forwarded.split(',')[0].trim() : request.headers.get('x-real-ip')) || 'unknown';
}

export async function loader() {
  return text(405, 'POST only');
}

export async function action({request}: Route.ActionArgs) {
  if (request.method !== 'POST') return text(405, 'POST only');

  // Noise reduction, not security: drop cross-site posts that announce
  // themselves. A request with no Origin header (some beacons) is allowed.
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) {
    return text(403, 'cross-origin');
  }

  if (!limiter.allow(clientAddress(request))) return text(429, 'rate limited');

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return text(413, 'body too large');

  // Read at most one byte past the cap, so a missing or lying Content-Length
  // cannot make us buffer an unbounded body.
  const body = await readCapped(request, MAX_BODY_BYTES);
  if (body === null) return text(413, 'body too large');

  const result = parseBeaconBody(body);
  if (!result.ok) return text(400, result.reason);

  try {
    await insertSamples(result.samples);
    if (Math.random() < PRUNE_ODDS) await pruneOld();
  } catch (err) {
    console.error('vitals insert failed', err instanceof Error ? err.message : 'unknown error');
    return text(503, 'store unavailable');
  }

  return new Response(null, {status: 204});
}

async function readCapped(request: Request, max: number): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(all);
}
