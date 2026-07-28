/*
  A fixed-window limiter for the endpoints worth protecting.

  In-memory on purpose, with eyes open: it resets on restart and each instance
  counts separately, so two API containers give an attacker twice the budget.
  That is a real weakness and the honest fix is Redis — but the current state
  is *no limit at all*, which means `/auth/login` will answer credential
  stuffing as fast as bcrypt can reject it. Something bounded beats nothing
  while single-instance, which is where this runs today.

  Keyed on IP + identifier so one person fat-fingering their password cannot
  lock out everyone behind the same office NAT.
*/

type Window = { count: number; resetAt: number };

const buckets = new Map<string, Window>();

/* Bounded so a flood of distinct keys cannot grow the map without limit —
   the limiter itself must not become the denial of service. */
const MAX_KEYS = 10_000;

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets — goes in the Retry-After header. */
  retryAfter: number;
};

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    if (buckets.size >= MAX_KEYS) sweep(now);
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfter: 0 };
  }

  existing.count++;
  const retryAfter = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));

  if (existing.count > limit) {
    return { allowed: false, remaining: 0, retryAfter };
  }
  return { allowed: true, remaining: limit - existing.count, retryAfter };
}

/* Drop expired windows; if that frees nothing, drop everything rather than
   let the map pin memory. */
function sweep(now: number): void {
  for (const [k, w] of buckets) {
    if (w.resetAt <= now) buckets.delete(k);
  }
  if (buckets.size >= MAX_KEYS) buckets.clear();
}

/** Clears a key early — used after a successful login so a legitimate user who
    mistyped twice is not still penalised. */
export function clearRateLimit(key: string): void {
  buckets.delete(key);
}

/*
  Best guess at the caller's address.

  Behind a proxy the socket address is the proxy, so the forwarded headers are
  the only signal available. They are also trivially spoofable by a direct
  caller — which is acceptable here because the fallback is the socket address
  and the consequence of a wrong key is a limiter that is too generous, not one
  that locks somebody out.
*/
export function clientIp(headers: Headers, fallback?: string): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return headers.get("x-real-ip") ?? fallback ?? "unknown";
}
