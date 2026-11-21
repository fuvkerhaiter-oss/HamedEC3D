import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { getOrderDetail, priceOrder } from "../../src/lib/admin/services/orders";
import { orderToken, verifyOrderToken } from "../../src/lib/checkout/order-link";
import { getCustomerOrder } from "../../src/lib/checkout/order-view";
import { expireStalePendingOrders, startCheckout } from "../../src/lib/checkout/service";
import { createDevPaymentSimulator } from "../../src/lib/payments/dev-simulator";
import { pgWebhookStore } from "../../src/lib/payments/pg-store";
import { handlePaymentWebhook } from "../../src/lib/payments/webhook";
import type { Tx } from "../../src/lib/db/client";
import { IT_ADDRESS, setupCommerce, startTestDb, variantBySku, type TestDb } from "./helpers";

let t: TestDb;
let euMethod: string;
before(async () => {
  t = await startTestDb("checkout");
  ({ euMethod } = await setupCommerce(t.sql));
});
after(() => t.close());

const sim = createDevPaymentSimulator({ secret: "integration-test-secret-123", baseUrl: "http://localhost", env: "test" });
const deliver = (body: { rawBody: string; headers: Headers }) =>
  t.sql.begin((tx) => handlePaymentWebhook(sim, body.rawBody, body.headers, pgWebhookStore(tx as unknown as Tx, { isTest: true })));

test("checkout preview matches the order that is created", async () => {
  const v = await variantBySku(t.sql, "MOCK-PASTA-PENNE-1");
  const preview = await priceOrder(t.sql, { lines: [{ variantId: v, quantity: 3 }], shipTo: IT_ADDRESS, email: "" });
  assert.equal(preview.option.methodId, euMethod, "cheapest method is preselected");
  const r = await startCheckout(t.sql, { email: "Buyer@Test.local", lines: [{ variantId: v, quantity: 3 }], shipTo: IT_ADDRESS, shippingMethodId: euMethod, idempotencyKey: "co-preview-1" }, { provider: sim, siteUrl: "http://shop.test" });
  const d = await getOrderDetail(t.sql, r.orderId);
  assert.equal(d!.order.total, preview.priced.total.amount);
  assert.equal(d!.order.email, "buyer@test.local");
});

test("checkout → payment session → verified webhook → paid; resubmits never duplicate", async () => {
  const v = await variantBySku(t.sql, "MOCK-DARK-CHOCOLATE-1");
  const input = { email: "pay@test.local", lines: [{ variantId: v, quantity: 2 }], shipTo: IT_ADDRESS, shippingMethodId: euMethod, idempotencyKey: "co-flow-1" };
  const r1 = await startCheckout(t.sql, input, { provider: sim, siteUrl: "http://shop.test" });
  assert.match(r1.redirectUrl, /\/dev\/payment-simulator\?session=sim_sess_/);
  const r2 = await startCheckout(t.sql, input, { provider: sim, siteUrl: "http://shop.test" });
  assert.equal(r2.orderId, r1.orderId, "same checkout key → same order");
  const pays = await t.sql`select status, is_test from public.payments where order_id = ${r1.orderId}`;
  assert.equal(pays.length, 1, "one pending payment row per order");
  assert.equal(pays[0]!.is_test, true);

  const d = await getOrderDetail(t.sql, r1.orderId);
  await deliver(sim.buildWebhook({ type: "payment.succeeded", orderId: r1.orderId, providerPaymentId: "sim_pi_flow", amount: { amount: d!.order.total, currency: "EUR" } }));
  const view = await getCustomerOrder(t.sql, r1.orderId);
  assert.equal(view!.status, "paid");
  assert.equal(view!.items[0]!.quantity, 2);

  // After payment, submitting again just leads to the order page (no new payment session).
  const r3 = await startCheckout(t.sql, input, { provider: sim, siteUrl: "http://shop.test" });
  assert.match(r3.redirectUrl, new RegExp(`^http://shop.test/order\\?id=${r1.orderId}&t=`));
});

test("unpaid checkouts expire and release stock", async () => {
  const v = await variantBySku(t.sql, "MOCK-SEA-SALT-CHIPS-1");
  const r = await startCheckout(t.sql, { email: "late@test.local", lines: [{ variantId: v, quantity: 1 }], shipTo: IT_ADDRESS, shippingMethodId: euMethod, idempotencyKey: "co-expire-1" }, { provider: sim, siteUrl: "http://shop.test" });
  await t.sql`update public.orders set created_at = now() - interval '26 hours' where id = ${r.orderId}`;
  assert.ok((await expireStalePendingOrders(t.sql)) >= 1);
  assert.equal((await getOrderDetail(t.sql, r.orderId))!.order.status, "cancelled");
  const res = await t.sql`select status from public.inventory_reservations where order_id = ${r.orderId}`;
  assert.equal(res[0]!.status, "released");
});

test("paying queues a confirmation email in the same transaction; the outbox sends it once", async () => {
  process.env.RESEND_API_KEY = "re_test_dummy";
  process.env.EMAIL_FROM = "WEGO SHIIIP <orders@test.local>";
  const realFetch = globalThis.fetch;
  const sent: { to: string[]; subject: string; html?: string }[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ id: `msg_${sent.length}` }), { status: 200 });
  }) as typeof fetch;
  try {
    const v = await variantBySku(t.sql, "MOCK-PASTA-PENNE-1");
    const r = await startCheckout(t.sql, { email: "mail@test.local", lines: [{ variantId: v, quantity: 1 }], shipTo: IT_ADDRESS, shippingMethodId: euMethod, idempotencyKey: "co-mail-1" }, { provider: sim, siteUrl: "http://shop.test" });
    const d = await getOrderDetail(t.sql, r.orderId);
    await deliver(sim.buildWebhook({ type: "payment.succeeded", orderId: r.orderId, providerPaymentId: "sim_pi_mail", amount: { amount: d!.order.total, currency: "EUR" } }));
    const queued = await t.sql`select template, status from public.email_outbox where related_order_id = ${r.orderId}`;
    assert.deepEqual(queued.map((q) => [q.template, q.status]), [["order_confirmed", "queued"]]);

    const { flushEmailOutbox } = await import("../../src/lib/email/outbox");
    assert.deepEqual(await flushEmailOutbox(t.sql), { sent: 1, failed: 0 });
    assert.deepEqual(await flushEmailOutbox(t.sql), { sent: 0, failed: 0 }, "never sent twice");
    assert.equal(sent[0]!.to[0], "mail@test.local");
    assert.match(sent[0]!.subject, /^Order #\d+ confirmed/);
    assert.match(sent[0]!.html!, /order\?id=/);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
  }
});

test("order links are signed", () => {
  const id = "3f1c1d1e-0000-4000-8000-000000000001";
  assert.equal(verifyOrderToken(id, orderToken(id)), true);
  assert.equal(verifyOrderToken(id, "x".repeat(32)), false);
  assert.equal(verifyOrderToken("3f1c1d1e-0000-4000-8000-000000000002", orderToken(id)), false);
  assert.throws(() => orderToken(id, { NODE_ENV: "production" } as NodeJS.ProcessEnv), /ORDER_LINK_SECRET/);
});
