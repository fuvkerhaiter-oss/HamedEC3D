/**
 * Stripe provider over Stripe's REST API (Checkout Sessions, PaymentIntents, Refunds).
 * Server-only. Use test-mode keys (sk_test_) until the business is verified for live payments.
 * Webhook signature: HMAC-SHA256 of `${t}.${rawBody}` with the endpoint secret (Stripe-Signature header).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { isCurrencyCode, money, type Money } from "../money";
import { WebhookVerificationError, type PaymentEvent, type PaymentProvider } from "./types";

const API = "https://api.stripe.com/v1";
const TOLERANCE_SECONDS = 300;

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
      // One line for the server-computed order total, so Stripe charges exactly what we validated.
      const f = new URLSearchParams({
        mode: "payment",
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        customer_email: input.customerEmail,
        client_reference_id: input.orderId,
        "metadata[order_id]": input.orderId,
        "payment_intent_data[metadata][order_id]": input.orderId,
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": input.amount.currency.toLowerCase(),
        "line_items[0][price_data][unit_amount]": String(input.amount.amount),
        "line_items[0][price_data][product_data][name]": input.label ?? `Order ${input.orderId}`,
      });
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

    async refund(providerPaymentId, amount, idempotencyKey) {
      const f = new URLSearchParams({ payment_intent: providerPaymentId, amount: String(amount.amount) });
      const r = await call("POST", "/refunds", f, idempotencyKey);
      return { refundId: String(r.id) };
    },
  };
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
      return { eventId: event.id, type: "payment.succeeded", orderId, providerPaymentId: String(o.payment_intent), amount: toMoney(o.amount_total, o.currency), occurredAt };
    case "checkout.session.async_payment_failed":
      return { eventId: event.id, type: "payment.failed", orderId, providerPaymentId: String(o.payment_intent), amount: toMoney(o.amount_total, o.currency), occurredAt };
    case "charge.refunded":
      // Only full refunds move the order to `refunded`; partial refunds are handled by admin.
      if (o.refunded !== true) return null;
      return { eventId: event.id, type: "refund.succeeded", orderId: meta.order_id ?? null, providerPaymentId: String(o.payment_intent), amount: toMoney(o.amount_refunded, o.currency), occurredAt };
    default:
      return null;
  }
}
