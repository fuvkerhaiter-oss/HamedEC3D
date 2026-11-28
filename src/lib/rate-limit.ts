/**
 * Rate limiting for public endpoints.
 * - rateLimited(): in-memory sliding window, per server instance. Cheap first layer for high-volume endpoints
 *   (cart pricing, view/visit beacons) where a shared store would add a DB write per request.
 * - rateLimitedShared(): the same memory check, then a fixed-window counter in Postgres shared by every instance
 *   (table rate_limit_buckets, keys stored as sha256). Use it for abuse-sensitive actions: OTP, login, checkout,
 *   contact, order lookup, withdrawal, rental booking. If the database is unavailable it falls back to the memory
 *   result (and logs), so an outage never blocks every customer.
 * An edge WAF (Vercel Firewall rules) remains the right tool against large distributed attacks.
 */
import { createHash } from "node:crypto";
import { getSql, isDbConfigured, type Db } from "./db/client";
import { logError } from "./log";

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

/** Start of the fixed window containing `now`. */
export function windowStart(now: number, windowMs: number): Date {
  return new Date(Math.floor(now / windowMs) * windowMs);
}

/** Counts one hit in the shared store and returns the window's total. */
export async function sharedHit(db: Db, key: string, windowMs: number, now = Date.now()): Promise<number> {
  const keyHash = createHash("sha256").update(key).digest("hex");
  const [row] = await db<{ hits: number }[]>`
    insert into public.rate_limit_buckets (key_hash, window_start, hits) values (${keyHash}, ${windowStart(now, windowMs)}, 1)
    on conflict (key_hash, window_start) do update set hits = public.rate_limit_buckets.hits + 1
    returning hits`;
  return Number(row?.hits ?? 1);
}

/** Memory check first (no DB round trip when one instance already sees abuse), then the shared counter. */
export async function rateLimitedShared(key: string, limit: number, windowMs: number, opts: { db?: Db; now?: number } = {}): Promise<boolean> {
  const now = opts.now ?? Date.now();
  if (rateLimited(key, limit, windowMs, now)) return true;
  const db = opts.db ?? (isDbConfigured() ? getSql() : null);
  if (!db) return false;
  try {
    return (await sharedHit(db, key, windowMs, now)) > limit;
  } catch (e) {
    logError("shared rate limit unavailable (memory limit still applied)", e);
    return false;
  }
}

/** Deletes expired counters (daily cron). */
export async function purgeRateLimitBuckets(db: Db): Promise<number> {
  const rows = await db`delete from public.rate_limit_buckets where window_start < now() - interval '1 day' returning 1`;
  return rows.length;
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
