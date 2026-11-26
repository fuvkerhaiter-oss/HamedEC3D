/**
 * Signed links that let a guest open their own order (confirmation page, emails, order lookup) without an
 * account. token = HMAC-SHA256(ORDER_LINK_SECRET, orderId); unguessable, and nothing to store.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const DEV_SECRET = "dev-only-order-link-secret-not-for-production";

function secret(env: NodeJS.ProcessEnv = process.env): string {
  const s = env.ORDER_LINK_SECRET ?? "";
  if (s.length >= 32) return s;
  if (env.NODE_ENV === "production") throw new Error("ORDER_LINK_SECRET (32+ chars) must be set in production");
  return DEV_SECRET;
}

export function orderToken(orderId: string, env?: NodeJS.ProcessEnv): string {
  return createHmac("sha256", secret(env)).update(`order:${orderId}`).digest("base64url").slice(0, 32);
}

export function verifyOrderToken(orderId: string, token: string | null | undefined, env?: NodeJS.ProcessEnv): boolean {
  if (!token || !/^[0-9a-f-]{36}$/i.test(orderId)) return false;
  const a = Buffer.from(orderToken(orderId, env));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Absolute link to the order page. */
export function orderUrl(siteUrl: string, orderId: string, env?: NodeJS.ProcessEnv): string {
  const u = new URL("/order", siteUrl);
  u.searchParams.set("id", orderId);
  u.searchParams.set("t", orderToken(orderId, env));
  return u.toString();
}

/** Absolute link to the online withdrawal form for this order (EU "withdraw from contract" function). */
export function withdrawUrl(siteUrl: string, orderId: string, env?: NodeJS.ProcessEnv): string {
  const u = new URL("/withdraw", siteUrl);
  u.searchParams.set("id", orderId);
  u.searchParams.set("t", orderToken(orderId, env));
  return u.toString();
}

/** Public base URL. Production must pin it (never trust the Host header for payment redirects). */
export function siteUrl(req: Request, env: NodeJS.ProcessEnv = process.env): string {
  if (env.NEXT_PUBLIC_SITE_URL) return env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  if (env.NODE_ENV === "production") throw new Error("NEXT_PUBLIC_SITE_URL must be set in production");
  return new URL(req.url).origin;
}

/** Signed link a shop tenant uses to open their rental (same secret as order links, different purpose prefix). */
export function leaseToken(leaseId: string, env?: NodeJS.ProcessEnv): string {
  return createHmac("sha256", secret(env)).update(`lease:${leaseId}`).digest("base64url").slice(0, 32);
}

export function verifyLeaseToken(leaseId: string, token: string | null | undefined, env?: NodeJS.ProcessEnv): boolean {
  if (!token || !/^[0-9a-f-]{36}$/i.test(leaseId)) return false;
  const a = Buffer.from(leaseToken(leaseId, env));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Absolute link to the tenant's rental page. */
export function leaseUrl(siteUrl: string, leaseId: string, env?: NodeJS.ProcessEnv): string {
  const u = new URL("/rent-a-shop/lease", siteUrl);
  u.searchParams.set("id", leaseId);
  u.searchParams.set("t", leaseToken(leaseId, env));
  return u.toString();
}
