/**
 * Customer order history without accounts: the customer asks for a link, we EMAIL it to the address they
 * ordered with (proving they own the inbox), and the link shows only that address's orders.
 * Token = base64url({e: email, x: expiry}) + "." + HMAC-SHA256(ORDER_LINK_SECRET, "history:" + payload).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Db } from "../db/client";
import type { CurrencyCode } from "../money";
import type { OrderStatus } from "../orders/state-machine";
import { getEmailProvider } from "../email/provider";
import { orderToken } from "./order-link";

const DEV_SECRET = "dev-only-order-link-secret-not-for-production";
export const HISTORY_LINK_TTL_HOURS = 24;

function secret(env: NodeJS.ProcessEnv = process.env): string {
  const s = env.ORDER_LINK_SECRET ?? "";
  if (s.length >= 32) return s;
  if (env.NODE_ENV === "production") throw new Error("ORDER_LINK_SECRET (32+ chars) must be set in production");
  return DEV_SECRET;
}
const sign = (payload: string, env?: NodeJS.ProcessEnv) => createHmac("sha256", secret(env)).update(`history:${payload}`).digest("base64url");

export function historyToken(email: string, nowMs = Date.now(), env?: NodeJS.ProcessEnv): string {
  const payload = Buffer.from(JSON.stringify({ e: email.trim().toLowerCase(), x: nowMs + HISTORY_LINK_TTL_HOURS * 3_600_000 })).toString("base64url");
  return `${payload}.${sign(payload, env)}`;
}

/** The email the token was issued for, or null (forged, tampered or expired). */
export function verifyHistoryToken(token: string | null | undefined, nowMs = Date.now(), env?: NodeJS.ProcessEnv): string | null {
  if (!token || token.length > 600) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const a = Buffer.from(sign(payload, env));
  const b = Buffer.from(sig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { e, x } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { e?: unknown; x?: unknown };
    if (typeof e !== "string" || typeof x !== "number" || x < nowMs) return null;
    return e;
  } catch {
    return null;
  }
}

export interface CustomerOrderSummary {
  id: string;
  orderNumber: number;
  status: OrderStatus;
  createdAt: string;
  total: { amount: number; currency: CurrencyCode };
  itemCount: number;
  trackingCount: number;
  /** Signed link to the full order page. */
  token: string;
}

/** Orders of exactly this email (case-insensitive). Unpaid abandoned checkouts are left out. */
export async function listCustomerOrders(db: Db, email: string): Promise<CustomerOrderSummary[]> {
  const rows = await db<{ id: string; order_number: number; status: OrderStatus; created_at: Date; total: number; currency: CurrencyCode; items: number; tracking: number }[]>`
    select o.id, o.order_number, o.status, o.created_at, o.total, o.currency,
      (select coalesce(sum(quantity), 0)::int from public.order_items i where i.order_id = o.id) as items,
      (select count(*)::int from public.shipments s where s.order_id = o.id) as tracking
    from public.orders o
    where lower(o.email) = ${email.trim().toLowerCase()} and not (o.status = 'cancelled' and not exists
      (select 1 from public.payments p where p.order_id = o.id and p.status <> 'pending'))
    order by o.created_at desc limit 100`;
  return rows.map((r) => ({
    id: r.id, orderNumber: Number(r.order_number), status: r.status, createdAt: new Date(r.created_at).toISOString(),
    total: { amount: Number(r.total), currency: r.currency }, itemCount: r.items, trackingCount: r.tracking, token: orderToken(r.id),
  }));
}

/**
 * Emails the history link if (and only if) the address has orders. The caller always shows the same answer,
 * so this can't be used to find out who shops here. At most one email per address per hour.
 */
export async function requestHistoryLink(db: Db, email: string, siteUrl: string): Promise<"queued" | "not_configured" | "no_orders" | "throttled"> {
  const e = email.trim().toLowerCase();
  const [has] = await db<{ n: number }[]>`select count(*)::int as n from public.orders where lower(email) = ${e}`;
  if (!has?.n) return "no_orders";
  const url = new URL("/account/orders", siteUrl);
  url.searchParams.set("t", historyToken(e));
  const subject = "Your WEGO SHIIIP orders";
  const text = `Hello,\n\nHere is your private link to see all your WEGO SHIIIP orders, their tracking and refund status:\n\n${url.toString()}\n\nThe link works for ${HISTORY_LINK_TTL_HOURS} hours. If you didn't ask for it, you can ignore this email.\n\nWEGO SHIIIP · Happy Family, Happy Animals`;
  const status = getEmailProvider() ? "queued" : "not_configured";
  const bucket = new Date().toISOString().slice(0, 13); // one per hour
  const rows = await db`insert into public.email_outbox (to_address, subject, body_text, template, status, dedupe_key)
    values (${e}, ${subject}, ${text}, 'order_history_link', ${status}, ${`history:${e}:${bucket}`})
    on conflict (dedupe_key) where dedupe_key is not null do nothing returning id`;
  if (!rows.length) return "throttled";
  return status === "queued" ? "queued" : "not_configured";
}
