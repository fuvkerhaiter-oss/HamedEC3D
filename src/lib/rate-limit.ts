/**
 * Small in-memory sliding-window limiter for public endpoints (checkout, contact, order lookup, coupons).
 * Per server instance: it slows abuse from one client; put a WAF / edge rate limit in front for real attacks.
 */
const hits = new Map<string, number[]>();
/** Hard cap on tracked keys so a flood of distinct keys (spoofed IPs) cannot exhaust memory. */
const MAX_KEYS = 20_000;
let lastSweep = 0;

export function rateLimited(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.delete(key); // re-insert → Map order = least recently used first
  hits.set(key, recent.length > limit * 2 ? recent.slice(-limit * 2) : recent);
  // Sweep expired keys at most once a second (a sweep per call would be O(n²) under a flood).
  if (hits.size > MAX_KEYS / 2 && Math.abs(now - lastSweep) > 1000) {
    lastSweep = now;
    for (const [k, v] of hits) if (now - v[v.length - 1]! > windowMs) hits.delete(k);
  }
  while (hits.size > MAX_KEYS) hits.delete(hits.keys().next().value!);
  return recent.length > limit;
}

/** Client IP. On Vercel these headers are set by the platform (a client-sent X-Forwarded-For is not passed through). */
export function clientIp(req: Request): string {
  const h = req.headers;
  return (
    h.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip")?.trim() ||
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  ).slice(0, 64);
}
