/**
 * Checkout: server-priced order (createOrder: fresh prices, stock reserved atomically) → payment session at the
 * configured provider → redirect. The order becomes "paid" ONLY through a verified provider webhook.
 */
import { databaseUrl, type Db } from "../db/client";
import { createOrder, OrderError, transitionOrderInDb, type CreateOrderInput } from "../admin/services/orders";
import type { CurrencyCode } from "../money";
import { getPaymentProvider, paymentProviderStatuses } from "../payments/registry";
import type { OrderBreakdown, PaymentProvider } from "../payments/types";
import { publicStorageUrl } from "../catalog/source-map";
import { orderUrl } from "./order-link";
import { getSetting } from "../admin/services/settings";
import { legalReadiness, type SellerIdentity } from "../legal/readiness";

/**
 * Unpaid checkouts hold stock briefly: the payment page expires after CHECKOUT_SESSION_SECONDS (Stripe minimum
 * 30 min) and the order is released 30 min after that, so no payment can complete on a released order.
 */
export const CHECKOUT_SESSION_SECONDS = 60 * 60;
export const PENDING_ORDER_TTL_MINUTES = 90;

/** The provider checkout uses: PAYMENT_PROVIDER=dev-simulator (local only) or Stripe. Null = not configured. */
export function checkoutProvider(env: NodeJS.ProcessEnv = process.env): PaymentProvider | null {
  if (env.PAYMENT_PROVIDER === "dev-simulator") return getPaymentProvider("dev-simulator", env);
  return getPaymentProvider("stripe", env);
}

export function checkoutUnavailableReason(env: NodeJS.ProcessEnv = process.env): string | null {
  if (!databaseUrl(env)) return "Checkout isn't connected to the order database yet.";
  if (checkoutProvider(env)) return null;
  const stripe = paymentProviderStatuses(env).find((s) => s.id === "stripe");
  return stripe?.detail ?? "No payment provider is configured.";
}

/** Pages the checkout links to; selling without them published is not allowed in the EU. */
export const REQUIRED_LEGAL_PAGES = ["terms", "privacy", "returns"] as const;

export async function missingLegalPages(db: Db): Promise<string[]> {
  const rows = await db<{ slug: string }[]>`
    select slug from public.cms_pages where status = 'published' and published_body is not null and slug = any(${[...REQUIRED_LEGAL_PAGES]})`;
  const have = new Set(rows.map((r) => r.slug));
  return REQUIRED_LEGAL_PAGES.filter((s) => !have.has(s));
}

/** Everything that keeps the shop from selling legally: unpublished/unfinished legal pages, missing seller identity. */
export async function legalProblems(db: Db): Promise<string[]> {
  const pages = await db<{ slug: string; published_body: string }[]>`
    select slug, published_body from public.cms_pages
     where status = 'published' and published_body is not null and slug = any(${[...REQUIRED_LEGAL_PAGES]})`;
  const seller = (await getSetting(db, "store.seller")) as SellerIdentity | null;
  return legalReadiness(pages.map((p) => ({ slug: p.slug, body: p.published_body })), seller, REQUIRED_LEGAL_PAGES);
}

/**
 * Production refuses orders until the legal pages are published AND filled in and the seller identity is complete
 * (development only warns). Fails closed in production: if the check itself errors, no order is taken.
 */
export async function legalBlocker(db: Db, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const prod = env.NODE_ENV === "production";
  let problems: string[];
  try {
    problems = await legalProblems(db);
  } catch {
    return prod ? "The store's legal information could not be checked." : null;
  }
  if (!problems.length) return null;
  return prod ? `The store's legal information is incomplete (${problems.slice(0, 3).join("; ")}).` : null;
}

export async function startCheckout(
  db: Db,
  input: Omit<CreateOrderInput, "isTest">,
  opts: { provider: PaymentProvider; siteUrl: string },
): Promise<{ redirectUrl: string; orderId: string; orderNumber: number }> {
  const { provider, siteUrl } = opts;
  const { orderId, orderNumber } = await createOrder(db, { ...input, isTest: provider.isSandbox });
  const [o] = await db<OrderRow[]>`
    select total, currency, status, email, tax_mode, tax_total, tax_rate_bps, shipping_total, discount_total, discount_code, shipping_method_name
      from public.orders where id = ${orderId}`;
  if (!o) throw new OrderError("Order not found");
  const confirmation = orderUrl(siteUrl, orderId);
  // Same checkout submitted again after paying (double click, back button): just show the order.
  if (o.status !== "pending_payment") return { redirectUrl: confirmation, orderId, orderNumber };

  const session = await provider.createSession({
    orderId,
    amount: { amount: o.total, currency: o.currency },
    customerEmail: o.email,
    successUrl: `${confirmation}&paid=1`,
    cancelUrl: `${siteUrl}/checkout?cancelled=1`,
    idempotencyKey: `checkout:${orderId}`, // a retry for the same order reuses the same provider session
    label: `WEGO SHIIIP order #${orderNumber}`,
    expiresInSeconds: CHECKOUT_SESSION_SECONDS,
    breakdown: await orderBreakdown(db, orderId, o),
  });
  const updated = await db`update public.payments set provider_session_id = ${session.providerSessionId}, updated_at = now()
                           where order_id = ${orderId} and provider = ${provider.id} and status = 'pending' returning id`;
  if (!updated.length) {
    await db`insert into public.payments (order_id, provider, provider_session_id, status, amount, currency, is_test)
             values (${orderId}, ${provider.id}, ${session.providerSessionId}, 'pending', ${o.total}, ${o.currency}, ${provider.isSandbox})
             on conflict (provider, provider_session_id) do nothing`;
  }
  return { redirectUrl: session.redirectUrl, orderId, orderNumber };
}

interface OrderRow {
  total: number; currency: CurrencyCode; status: string; email: string;
  tax_mode: "inclusive" | "exclusive"; tax_total: number; tax_rate_bps: number | null;
  shipping_total: number; discount_total: number; discount_code: string | null; shipping_method_name: string | null;
}

/** Line-by-line breakdown of the SAVED order (server prices) for the payment page. */
export async function orderBreakdown(db: Db, orderId: string, o: OrderRow): Promise<OrderBreakdown> {
  const items = await db<{ product_name: string; variant_name: string; unit_price: number; quantity: number; image: string | null; bucket: string | null }[]>`
    select oi.product_name, oi.variant_name, oi.unit_price, oi.quantity, img.storage_path as image, img.bucket
      from public.order_items oi
      left join public.product_variants v on v.id = oi.variant_id
      left join lateral (select pi.storage_path, pi.bucket from public.product_images pi where pi.product_id = v.product_id
                         order by pi.is_primary desc, pi.sort_order limit 1) img on true
     where oi.order_id = ${orderId} order by oi.product_name, oi.variant_name`;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const pct = o.tax_rate_bps ? `${(o.tax_rate_bps / 100).toLocaleString("en", { maximumFractionDigits: 2 })}% ` : "";
  return {
    lines: items.map((i) => ({
      name: !i.variant_name || /^default$/i.test(i.variant_name) ? i.product_name : `${i.product_name} — ${i.variant_name}`,
      unitAmount: Number(i.unit_price),
      quantity: Number(i.quantity),
      imageUrl: i.image && i.bucket ? publicStorageUrl(supabaseUrl, i.bucket, i.image) : null,
    })),
    discount: Number(o.discount_total),
    discountLabel: o.discount_code,
    shipping: Number(o.shipping_total),
    shippingLabel: o.shipping_method_name ?? "Shipping",
    taxAdded: o.tax_mode === "exclusive" ? Number(o.tax_total) : 0,
    note: o.tax_mode === "inclusive" && Number(o.tax_total) > 0 ? `Prices include ${pct}VAT.` : null,
  };
}

/** Releases reserved stock of checkouts that were never paid (state machine: system → cancelled). */
export async function expireStalePendingOrders(db: Db, ttlMinutes = PENDING_ORDER_TTL_MINUTES): Promise<number> {
  const stale = await db<{ id: string }[]>`
    select id from public.orders where status = 'pending_payment' and created_at < now() - make_interval(mins => ${ttlMinutes}) limit 50`;
  let n = 0;
  for (const { id } of stale) {
    try {
      await transitionOrderInDb(db, id, "cancelled", { type: "system", id: "checkout-expiry" }, { reason: "Payment not completed in time" });
      n++;
    } catch {
      /* raced with a webhook: fine */
    }
  }
  return n;
}
