import { test } from "node:test";
import assert from "node:assert/strict";
import { createDevPaymentSimulator, assertSimulatorAllowed, SIMULATOR_SIGNATURE_HEADER } from "../../src/lib/payments/dev-simulator";
import { handlePaymentWebhook, type PaymentWebhookStore } from "../../src/lib/payments/webhook";
import { WebhookVerificationError } from "../../src/lib/payments/types";
import { money, type Money } from "../../src/lib/money";
import type { OrderAuditEntry, OrderStatus } from "../../src/lib/orders/state-machine";

const SECRET = "test-secret-0123456789";
const sim = () => createDevPaymentSimulator({ secret: SECRET, baseUrl: "http://localhost:3000", env: "test" });

function memoryStore(status: OrderStatus, total: Money) {
  const events = new Set<string>();
  const order = { id: "ord_1", status, total };
  const audits: OrderAuditEntry[] = [];
  const store: PaymentWebhookStore = {
    async recordEventOnce(p, e) {
      const key = `${p}:${e.eventId}`;
      if (events.has(key)) return false;
      events.add(key);
      return true;
    },
    async findOrderIdByProviderPayment(_p, payId) {
      return payId === "pay_1" ? order.id : null;
    },
    async getOrder(id) {
      return id === order.id ? { ...order } : null;
    },
    async applyTransition(_id, audit) {
      order.status = audit.toStatus;
      audits.push(audit);
    },
    async flagForReview() {},
    async recordUnmatchedPayment() {},
    async recordPaymentFinancials() {},
    async applyRefundUpdate() {
      return "unknown" as const;
    },
  };
  return { store, order, audits };
}

const succeeded = { type: "payment.succeeded" as const, orderId: "ord_1", providerPaymentId: "pay_1", amount: money(1999, "USD") };

test("simulator refuses to run in production", () => {
  assert.throws(() => assertSimulatorAllowed("production"));
  assert.throws(() => createDevPaymentSimulator({ secret: SECRET, baseUrl: "http://x", env: "production" }));
});

test("successful payment marks order paid with audit trail", async () => {
  const p = sim();
  const { store, order, audits } = memoryStore("pending_payment", money(1999, "USD"));
  const { rawBody, headers } = p.buildWebhook(succeeded);
  const res = await handlePaymentWebhook(p, rawBody, headers, store);
  assert.deepEqual(res, { status: "processed", orderStatus: "paid" });
  assert.equal(order.status, "paid");
  assert.equal(audits[0]?.evidence.verifiedPaymentId, "pay_1");
});

test("duplicate webhook delivery is ignored", async () => {
  const p = sim();
  const { store, audits } = memoryStore("pending_payment", money(1999, "USD"));
  const { rawBody, headers } = p.buildWebhook({ ...succeeded, eventId: "evt_same" });
  await handlePaymentWebhook(p, rawBody, headers, store);
  const second = await handlePaymentWebhook(p, rawBody, headers, store);
  assert.equal(second.status, "duplicate");
  assert.equal(audits.length, 1);
});

test("invalid or tampered signature is rejected", async () => {
  const p = sim();
  const { store } = memoryStore("pending_payment", money(1999, "USD"));
  const { rawBody, headers } = p.buildWebhook(succeeded);
  const tampered = rawBody.replace("1999", "1");
  await assert.rejects(handlePaymentWebhook(p, tampered, headers, store), WebhookVerificationError);
  await assert.rejects(handlePaymentWebhook(p, rawBody, new Headers(), store), WebhookVerificationError);
  const bad = new Headers({ [SIMULATOR_SIGNATURE_HEADER]: `t=${Math.floor(Date.now() / 1000)},v1=${"0".repeat(64)}` });
  await assert.rejects(handlePaymentWebhook(p, rawBody, bad, store), WebhookVerificationError);
});

test("stale signature timestamp is rejected", async () => {
  let t = 1_000_000;
  const p = createDevPaymentSimulator({ secret: SECRET, baseUrl: "http://x", env: "test", now: () => t });
  const { store } = memoryStore("pending_payment", money(1999, "USD"));
  const { rawBody, headers } = p.buildWebhook(succeeded);
  t += 3600;
  await assert.rejects(handlePaymentWebhook(p, rawBody, headers, store), WebhookVerificationError);
});

test("amount mismatch does not mark order paid", async () => {
  const p = sim();
  const { store, order } = memoryStore("pending_payment", money(5000, "USD"));
  const { rawBody, headers } = p.buildWebhook(succeeded);
  const res = await handlePaymentWebhook(p, rawBody, headers, store);
  assert.equal(res.status, "ignored");
  assert.equal(order.status, "pending_payment");
});

test("failed payment and refund flow", async () => {
  const p = sim();
  const failed = memoryStore("pending_payment", money(1999, "USD"));
  const f = p.buildWebhook({ ...succeeded, type: "payment.failed" });
  assert.equal((await handlePaymentWebhook(p, f.rawBody, f.headers, failed.store)).status, "processed");
  assert.equal(failed.order.status, "failed");

  const refund = memoryStore("refund_requested", money(1999, "USD"));
  const r = p.buildWebhook({ ...succeeded, type: "refund.succeeded" });
  await handlePaymentWebhook(p, r.rawBody, r.headers, refund.store);
  assert.equal(refund.order.status, "refunded");
});
