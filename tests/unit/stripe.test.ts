import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createStripeProvider, mapStripeEvent } from "../../src/lib/payments/stripe";
import { WebhookVerificationError } from "../../src/lib/payments/types";
import { money } from "../../src/lib/money";

const WHSEC = "whsec_test_secret";
const NOW = 1_800_000_000;

function sign(body: string, t = NOW, secret = WHSEC) {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

const completed = {
  id: "evt_1",
  type: "checkout.session.completed",
  created: NOW,
  data: { object: { payment_status: "paid", payment_intent: "pi_1", amount_total: 1599, currency: "eur", metadata: { order_id: "ord_1" } } },
};

function provider(fetchImpl?: typeof fetch) {
  return createStripeProvider({ secretKey: "sk_test_x", webhookSecret: WHSEC, now: () => NOW, fetch: fetchImpl });
}

test("refuses live keys unless allowed", () => {
  assert.throws(() => createStripeProvider({ secretKey: "sk_live_x", webhookSecret: WHSEC }));
  assert.throws(() => createStripeProvider({ secretKey: "sk_test_x", webhookSecret: "bad" }));
});

test("valid signature yields a mapped payment event", async () => {
  const body = JSON.stringify(completed);
  const ev = await provider().verifyWebhook(body, new Headers({ "stripe-signature": sign(body) }));
  assert.deepEqual(ev && { type: ev.type, orderId: ev.orderId, pi: ev.providerPaymentId, amount: ev.amount }, {
    type: "payment.succeeded",
    orderId: "ord_1",
    pi: "pi_1",
    amount: money(1599, "EUR"),
  });
});

test("accepts any matching v1 among several (secret rotation)", async () => {
  const body = JSON.stringify(completed);
  const header = `t=${NOW},v1=${"a".repeat(64)},${sign(body).split(",")[1]}`;
  assert.ok(await provider().verifyWebhook(body, new Headers({ "stripe-signature": header })));
});

test("rejects tampered body, wrong secret, missing header and stale timestamp", async () => {
  const body = JSON.stringify(completed);
  const p = provider();
  await assert.rejects(p.verifyWebhook(body.replace("1599", "1"), new Headers({ "stripe-signature": sign(body) })), WebhookVerificationError);
  await assert.rejects(p.verifyWebhook(body, new Headers({ "stripe-signature": sign(body, NOW, "whsec_other") })), WebhookVerificationError);
  await assert.rejects(p.verifyWebhook(body, new Headers()), WebhookVerificationError);
  await assert.rejects(p.verifyWebhook(body, new Headers({ "stripe-signature": sign(body, NOW - 1000) })), WebhookVerificationError);
});

test("unpaid completion, expiry of an already-paid session and partial refunds are ignored", () => {
  assert.equal(mapStripeEvent({ ...completed, data: { object: { ...completed.data.object, payment_status: "unpaid" } } }), null);
  assert.equal(mapStripeEvent({ ...completed, type: "checkout.session.expired" }), null);
  assert.equal(mapStripeEvent({ ...completed, type: "charge.refunded", data: { object: { refunded: false, payment_intent: "pi_1", amount_refunded: 100, currency: "eur" } } }), null);
  const full = mapStripeEvent({ ...completed, type: "charge.refunded", data: { object: { refunded: true, payment_intent: "pi_1", amount_refunded: 1599, currency: "eur" } } });
  assert.equal(full?.type, "refund.succeeded");
  assert.equal(full?.orderId, null);
});

test("createSession sends server total, metadata and idempotency key", async () => {
  let captured: { url: string; init: RequestInit } | undefined;
  const fakeFetch = (async (url: string, init: RequestInit) => {
    captured = { url, init };
    return new Response(JSON.stringify({ id: "cs_1", url: "https://checkout.stripe.com/c/cs_1" }), { status: 200 });
  }) as unknown as typeof fetch;
  const s = await provider(fakeFetch).createSession({
    orderId: "ord_1",
    amount: money(1599, "EUR"),
    customerEmail: "a@b.it",
    successUrl: "http://x/ok",
    cancelUrl: "http://x/no",
    idempotencyKey: "checkout:ord_1",
  });
  assert.equal(s.redirectUrl, "https://checkout.stripe.com/c/cs_1");
  assert.equal(captured?.url, "https://api.stripe.com/v1/checkout/sessions");
  const headers = captured?.init.headers as Record<string, string>;
  assert.equal(headers["Idempotency-Key"], "checkout:ord_1");
  const form = new URLSearchParams(String(captured?.init.body));
  assert.equal(form.get("line_items[0][price_data][unit_amount]"), "1599");
  assert.equal(form.get("line_items[0][price_data][currency]"), "eur");
  assert.equal(form.get("metadata[order_id]"), "ord_1");
});

test("createSession lists every cart line, shipping, added tax and a one-off coupon", async () => {
  const calls: { url: string; form: URLSearchParams; key?: string }[] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, form: new URLSearchParams(String(init.body)), key: (init.headers as Record<string, string>)["Idempotency-Key"] });
    const body = url.endsWith("/coupons") ? { id: "co_1" } : { id: "cs_2", url: "https://checkout.stripe.com/c/cs_2" };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  // 2×1000 + 1×500 = 2500, −300 discount, +200 tax, +499 shipping = 2899
  await provider(fakeFetch).createSession({
    orderId: "ord_2", amount: money(2899, "USD"), customerEmail: "a@b.us", successUrl: "http://x/ok", cancelUrl: "http://x/no", idempotencyKey: "checkout:ord_2",
    breakdown: {
      lines: [{ name: "Cat fountain", unitAmount: 1000, quantity: 2, imageUrl: "https://cdn.x/a.jpg" }, { name: "Dog bowl — L", unitAmount: 500, quantity: 1, imageUrl: "/api/media/b.jpg" }],
      discount: 300, discountLabel: "WELCOME", shipping: 499, shippingLabel: "Standard", taxAdded: 200,
    },
  });
  const [coupon, session] = calls;
  assert.equal(coupon?.url, "https://api.stripe.com/v1/coupons");
  assert.equal(coupon?.form.get("amount_off"), "300");
  assert.equal(coupon?.form.get("max_redemptions"), "1");
  assert.equal(coupon?.key, "checkout:ord_2:coupon");
  const f = session!.form;
  assert.equal(f.get("line_items[0][quantity]"), "2");
  assert.equal(f.get("line_items[0][price_data][unit_amount]"), "1000");
  assert.equal(f.get("line_items[0][price_data][product_data][images][0]"), "https://cdn.x/a.jpg");
  assert.equal(f.get("line_items[1][price_data][product_data][images][0]"), null); // relative URL: Stripe can't load it
  assert.equal(f.get("line_items[2][price_data][product_data][name]"), "Sales tax");
  assert.equal(f.get("line_items[2][price_data][unit_amount]"), "200");
  assert.equal(f.get("shipping_options[0][shipping_rate_data][fixed_amount][amount]"), "499");
  assert.equal(f.get("discounts[0][coupon]"), "co_1");
  assert.equal(f.get("billing_address_collection"), "required");
});

test("createSession falls back to one total line when the breakdown doesn't add up", async () => {
  let form: URLSearchParams | undefined;
  const fakeFetch = (async (_u: string, init: RequestInit) => {
    form = new URLSearchParams(String(init.body));
    return new Response(JSON.stringify({ id: "cs_3", url: "https://checkout.stripe.com/c/cs_3" }), { status: 200 });
  }) as unknown as typeof fetch;
  await provider(fakeFetch).createSession({
    orderId: "ord_3", amount: money(1000, "EUR"), customerEmail: "a@b.it", successUrl: "http://x/ok", cancelUrl: "http://x/no", idempotencyKey: "k",
    breakdown: { lines: [{ name: "X", unitAmount: 999, quantity: 1 }], discount: 0, shipping: 0, shippingLabel: "Free", taxAdded: 0 },
  });
  assert.equal(form?.get("line_items[0][price_data][unit_amount]"), "1000");
  assert.equal(form?.get("line_items[1][quantity]"), null);
  assert.equal(form?.get("shipping_options[0][shipping_rate_data][type]"), null);
});

test("maps checkout.session.expired and payment_intent.payment_failed", () => {
  const exp = mapStripeEvent({ id: "evt_e", type: "checkout.session.expired", created: 1, data: { object: { id: "cs_9", payment_status: "unpaid", payment_intent: null, amount_total: 500, currency: "eur", metadata: { order_id: "ord_9" } } } });
  assert.equal(exp?.type, "payment.expired");
  assert.equal(exp?.providerSessionId, "cs_9");
  assert.equal(exp?.orderId, "ord_9");
  const fail = mapStripeEvent({ id: "evt_f", type: "payment_intent.payment_failed", created: 1, data: { object: { id: "pi_9", amount: 500, currency: "eur", metadata: { order_id: "ord_9" }, last_payment_error: { message: "Your card was declined.", decline_code: "generic_decline" } } } });
  assert.equal(fail?.type, "payment.attempt_failed");
  assert.equal(fail?.failureMessage, "Your card was declined. — generic_decline");
});

test("API errors surface as StripeApiError", async () => {
  const fakeFetch = (async () => new Response(JSON.stringify({ error: { message: "No such payment_intent", code: "resource_missing" } }), { status: 404 })) as unknown as typeof fetch;
  await assert.rejects(provider(fakeFetch).getPaymentStatus("pi_x"), /No such payment_intent/);
});
