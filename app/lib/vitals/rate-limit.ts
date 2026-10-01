import {createHmac, randomBytes} from 'node:crypto';

/**
 * Per-client rate limit that never stores an IP address.
 *
 * The address is turned into a keyed hash (HMAC with a secret generated in
 * memory, never persisted or logged). The hash lives only in this process's
 * memory, and both the table and the secret are replaced when the window rolls
 * over, so nothing identifies a visitor across windows and nothing is ever
 * written to disk or the database.
 *
 * Limits, stated plainly: the counter is per server instance. Serverless
 * instances do not share memory, so a determined client spread across many
 * instances can exceed the nominal limit, and a restart resets it. This is a
 * brake on casual abuse and accidental loops, not a security boundary. The
 * hard protection is strict validation plus a small body cap.
 */
export class RateLimiter {
  private secret = randomBytes(32);
  private counts = new Map<string, number>();
  private window = -1;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10_000,
  ) {}

  /** True if this request is within the limit and has been counted. */
  allow(ip: string, now: number = Date.now()): boolean {
    const window = Math.floor(now / this.windowMs);
    if (window !== this.window) {
      this.window = window;
      this.counts.clear();
      this.secret = randomBytes(32);
    }

    const key = createHmac('sha256', this.secret).update(ip).digest('base64url').slice(0, 16);
    const seen = this.counts.get(key) ?? 0;
    if (seen >= this.limit) return false;

    // Bound memory under a flood of distinct addresses: refuse new keys
    // rather than grow without limit.
    if (seen === 0 && this.counts.size >= this.maxKeys) return false;

    this.counts.set(key, seen + 1);
    return true;
  }
}
