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

test("unpaid completion, expired sessions and partial refunds are ignored", () => {
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

test("API errors surface as StripeApiError", async () => {
  const fakeFetch = (async () => new Response(JSON.stringify({ error: { message: "No such payment_intent", code: "resource_missing" } }), { status: 404 })) as unknown as typeof fetch;
  await assert.rejects(provider(fakeFetch).getPaymentStatus("pi_x"), /No such payment_intent/);
});
