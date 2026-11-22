/**
 * Stripe provider over Stripe's REST API (Checkout Sessions, PaymentIntents, Refunds).
 * Server-only. Use test-mode keys (sk_test_) until the business is verified for live payments.
 * Webhook signature: HMAC-SHA256 of `${t}.${rawBody}` with the endpoint secret (Stripe-Signature header).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { isCurrencyCode, money, type Money } from "../money";
import { WebhookVerificationError, type OrderBreakdown, type PaymentEvent, type PaymentProvider, type ProviderRefundStatus, type VerifiedPayment } from "./types";

const API = "https://api.stripe.com/v1";
const TOLERANCE_SECONDS = 300;
/** Stripe allows 30 min – 24 h. 23 h keeps it inside the 24 h idempotency-key window, so a retry never gets an expired session. */
export const SESSION_TTL_SECONDS = 23 * 3600;

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  fetch?: typeof fetch;
  now?: () => number; // unix seconds
  /** Refuse live keys unless explicitly allowed (set only after business verification). */
  allowLive?: boolean;
}

export class StripeApiError extends Error {
  override name = "StripeApiError";
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

type StripeObject = Record<string, unknown>;

export function createStripeProvider(cfg: StripeConfig): PaymentProvider {
  if (!cfg.secretKey.startsWith("sk_test_") && !cfg.secretKey.startsWith("rk_test_")) {
    if (!cfg.allowLive) throw new Error("Live Stripe keys are disabled until the business is verified (allowLive=false)");
  }
  if (!cfg.webhookSecret.startsWith("whsec_")) throw new Error("STRIPE_WEBHOOK_SECRET must start with whsec_");
  const doFetch = cfg.fetch ?? fetch;
  const now = cfg.now ?? (() => Math.floor(Date.now() / 1000));

  async function call(method: "GET" | "POST", path: string, form?: URLSearchParams, idempotencyKey?: string): Promise<StripeObject> {
    const headers: Record<string, string> = { Authorization: `Bearer ${cfg.secretKey}` };
    if (form) headers["Content-Type"] = "application/x-www-form-urlencoded";
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    const res = await doFetch(`${API}${path}`, { method, headers, body: form?.toString() });
    const json = (await res.json()) as StripeObject;
    if (!res.ok) {
      const err = (json.error ?? {}) as { message?: string; code?: string };
      throw new StripeApiError(err.message ?? `Stripe error ${res.status}`, res.status, err.code);
    }
    return json;
  }

  return {
    id: "stripe",
    isSandbox: cfg.secretKey.includes("_test_"),

    async createSession(input) {
      const cur = input.amount.currency.toLowerCase();
      const f = new URLSearchParams({
        mode: "payment",
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        customer_email: input.customerEmail,
        client_reference_id: input.orderId,
        "metadata[order_id]": input.orderId,
        "payment_intent_data[metadata][order_id]": input.orderId,
        billing_address_collection: "required",
        // Session lifetime: unpaid orders are released after it (checkout.session.expired).
        expires_at: String(now() + SESSION_TTL_SECONDS),
      });
      if (input.label) f.set("payment_intent_data[description]", input.label);
      const b = input.breakdown && breakdownTotal(input.breakdown) === input.amount.amount ? input.breakdown : null;
      if (b) {
        // Every product line from the saved order (server prices), so the customer sees exactly what they buy.
        let i = 0;
        for (const l of b.lines) {
          f.set(`line_items[${i}][quantity]`, String(l.quantity));
          f.set(`line_items[${i}][price_data][currency]`, cur);
          f.set(`line_items[${i}][price_data][unit_amount]`, String(l.unitAmount));
          f.set(`line_items[${i}][price_data][product_data][name]`, l.name.slice(0, 250));
          if (l.imageUrl?.startsWith("https://")) f.set(`line_items[${i}][price_data][product_data][images][0]`, l.imageUrl);
          i++;
        }
        if (b.taxAdded > 0) {
          f.set(`line_items[${i}][quantity]`, "1");
          f.set(`line_items[${i}][price_data][currency]`, cur);
          f.set(`line_items[${i}][price_data][unit_amount]`, String(b.taxAdded));
          f.set(`line_items[${i}][price_data][product_data][name]`, "Sales tax");
        }
        f.set("shipping_options[0][shipping_rate_data][type]", "fixed_amount");
        f.set("shipping_options[0][shipping_rate_data][display_name]", b.shippingLabel.slice(0, 100) || "Shipping");
        f.set("shipping_options[0][shipping_rate_data][fixed_amount][amount]", String(b.shipping));
        f.set("shipping_options[0][shipping_rate_data][fixed_amount][currency]", cur);
        if (b.discount > 0) {
          // Single-use coupon for exactly the discount the server validated (Checkout has no negative lines).
          const c = await call("POST", "/coupons", new URLSearchParams({
            amount_off: String(b.discount), currency: cur, duration: "once", max_redemptions: "1",
            name: (b.discountLabel || "Discount").slice(0, 40), "metadata[order_id]": input.orderId,
          }), `${input.idempotencyKey}:coupon`);
          f.set("discounts[0][coupon]", String(c.id));
        }
        if (b.note) f.set("custom_text[submit][message]", b.note.slice(0, 1200));
      } else {
        // Fallback: one line for the server-computed order total, so Stripe charges exactly what we validated.
        f.set("line_items[0][quantity]", "1");
        f.set("line_items[0][price_data][currency]", cur);
        f.set("line_items[0][price_data][unit_amount]", String(input.amount.amount));
        f.set("line_items[0][price_data][product_data][name]", input.label ?? `Order ${input.orderId}`);
      }
      const session = await call("POST", "/checkout/sessions", f, input.idempotencyKey);
      return { providerSessionId: String(session.id), redirectUrl: String(session.url) };
    },

    async verifyWebhook(rawBody, headers) {
      verifyStripeSignature(rawBody, headers.get("stripe-signature"), cfg.webhookSecret, now());
      const event = JSON.parse(rawBody) as { id: string; type: string; created: number; data: { object: StripeObject } };
      return mapStripeEvent(event);
    },

    async getPaymentStatus(providerPaymentId) {
      const pi = await call("GET", `/payment_intents/${encodeURIComponent(providerPaymentId)}`);
      const s = String(pi.status);
      if (s === "succeeded") return "succeeded";
      if (s === "canceled") return "failed";
      return "pending";
    },

    async retrievePayment(providerPaymentId) {
      const pi = await call("GET", `/payment_intents/${encodeURIComponent(providerPaymentId)}?expand[]=latest_charge.balance_transaction`);
      return mapPaymentIntent(pi);
    },

    async refund(providerPaymentId, amount, idempotencyKey, meta) {
      const f = new URLSearchParams({ payment_intent: providerPaymentId, amount: String(amount.amount) });
      if (meta) {
        f.set("metadata[local_refund_id]", meta.localRefundId);
        f.set("metadata[order_id]", meta.orderId);
      }
      const r = await call("POST", "/refunds", f, idempotencyKey);
      return { refundId: String(r.id), status: mapRefundStatus(r.status) };
    },
  };
}

/** What Stripe will charge for a breakdown: Σ unit×qty + added tax + shipping − discount. */
export function breakdownTotal(b: OrderBreakdown): number {
  const items = b.lines.reduce((s, l) => s + l.unitAmount * l.quantity, 0);
  if (b.discount < 0 || b.discount > items + b.taxAdded) return Number.NaN; // coupon can't exceed the items
  return items + b.taxAdded + b.shipping - b.discount;
}

export function verifyStripeSignature(rawBody: string, header: string | null, secret: string, nowSeconds: number): void {
  if (!header) throw new WebhookVerificationError("Missing Stripe-Signature header");
  let t: number | null = null;
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.split("=", 2);
    if (k === "t" && v && /^\d+$/.test(v)) t = Number(v);
    if (k === "v1" && v) v1.push(v);
  }
  if (t === null || v1.length === 0) throw new WebhookVerificationError("Malformed Stripe-Signature header");
  if (Math.abs(nowSeconds - t) > TOLERANCE_SECONDS) throw new WebhookVerificationError("Stripe signature timestamp outside tolerance");
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
  const ok = v1.some((sig) => {
    if (!/^[a-f0-9]{64}$/.test(sig)) return false;
    const given = Buffer.from(sig, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!ok) throw new WebhookVerificationError("Invalid Stripe signature");
}

export function mapRefundStatus(s: unknown): ProviderRefundStatus {
  if (s === "succeeded") return "succeeded";
  if (s === "failed") return "failed";
  if (s === "canceled") return "canceled";
  return "pending"; // pending, requires_action
}

/** PaymentIntent (with latest_charge.balance_transaction expanded) → trusted payment figures. */
export function mapPaymentIntent(pi: StripeObject): VerifiedPayment {
  const s = String(pi.status);
  const status: VerifiedPayment["status"] =
    s === "succeeded" ? "succeeded" : s === "canceled" ? "canceled" : s === "requires_payment_method" && pi.last_payment_error ? "failed" : "pending";
  const cur = String(pi.currency ?? "").toUpperCase();
  if (!isCurrencyCode(cur)) throw new StripeApiError(`Unsupported PaymentIntent currency ${cur}`, 0);
  const charge = typeof pi.latest_charge === "object" && pi.latest_charge !== null ? (pi.latest_charge as StripeObject) : null;
  const bt = charge && typeof charge.balance_transaction === "object" && charge.balance_transaction !== null ? (charge.balance_transaction as StripeObject) : null;
  const int = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);
  const gross = int(bt?.amount), fee = int(bt?.fee), net = int(bt?.net);
  const btCur = String(bt?.currency ?? "").toUpperCase();
  return {
    status,
    amountReceived: money(int(pi.amount_received) ?? 0, cur),
    amountRefunded: charge ? int(charge.amount_refunded) : null,
    livemode: typeof pi.livemode === "boolean" ? pi.livemode : null,
    balance: bt && gross !== null && fee !== null && net !== null && /^[A-Z]{3}$/.test(btCur)
      ? { transactionId: String(bt.id), gross, fee, net, currency: btCur }
      : null,
  };
}

function toMoney(amount: unknown, currency: unknown): Money {
  const cur = String(currency ?? "").toUpperCase();
  if (!isCurrencyCode(cur) || typeof amount !== "number") throw new WebhookVerificationError("Unsupported amount/currency in event");
  return money(amount, cur);
}

/** Map Stripe events to our provider-agnostic events; null = acknowledged but not acted on. */
export function mapStripeEvent(event: { id: string; type: string; created: number; data: { object: StripeObject } }): PaymentEvent | null {
  const o = event.data.object;
  const occurredAt = new Date(event.created * 1000).toISOString();
  const meta = (o.metadata ?? {}) as Record<string, string>;
  const orderId = meta.order_id ?? (typeof o.client_reference_id === "string" ? o.client_reference_id : null);

  switch (event.type) {
    case "checkout.session.completed":
      // Card payments are paid here; delayed methods (e.g. SEPA debit) arrive as async_payment_succeeded.
      if (o.payment_status !== "paid") return null;
    // falls through
    case "checkout.session.async_payment_succeeded":
      return { eventId: event.id, type: "payment.succeeded", orderId, providerPaymentId: String(o.payment_intent), amount: toMoney(o.amount_total, o.currency), occurredAt, providerSessionId: String(o.id) };
    case "checkout.session.async_payment_failed":
      return { eventId: event.id, type: "payment.failed", orderId, providerPaymentId: String(o.payment_intent), amount: toMoney(o.amount_total, o.currency), occurredAt, providerSessionId: String(o.id) };
    case "checkout.session.expired":
      if (o.payment_status === "paid") return null;
      return { eventId: event.id, type: "payment.expired", orderId, providerPaymentId: typeof o.payment_intent === "string" ? o.payment_intent : "", amount: toMoney(o.amount_total, o.currency), occurredAt, providerSessionId: String(o.id) };
    case "payment_intent.payment_failed": {
      const err = (o.last_payment_error ?? {}) as { message?: string; code?: string; decline_code?: string };
      return {
        eventId: event.id, type: "payment.attempt_failed", orderId: meta.order_id ?? null, providerPaymentId: String(o.id), amount: toMoney(o.amount, o.currency), occurredAt,
        failureMessage: [err.message, err.decline_code ?? err.code].filter(Boolean).join(" — ").slice(0, 300) || null,
      };
    }
    case "charge.refunded":
      // Only full refunds move the order to `refunded`; partial refunds are handled by admin.
      if (o.refunded !== true) return null;
      return { eventId: event.id, type: "refund.succeeded", orderId: meta.order_id ?? null, providerPaymentId: String(o.payment_intent), amount: toMoney(o.amount_refunded, o.currency), occurredAt };
    case "refund.created":
    case "refund.updated":
    case "refund.failed":
    case "charge.refund.updated":
      // Per-refund status (partial refunds, failures). Matched to the local refund by id / metadata.
      return {
        eventId: event.id, type: "refund.updated", orderId: meta.order_id ?? null, providerPaymentId: String(o.payment_intent),
        amount: toMoney(o.amount, o.currency), occurredAt,
        refund: { providerRefundId: String(o.id), status: mapRefundStatus(o.status), localRefundId: meta.local_refund_id ?? null },
      };
    default:
      return null;
  }
}
