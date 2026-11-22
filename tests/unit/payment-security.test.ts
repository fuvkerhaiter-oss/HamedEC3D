/** Phase 1 security: fulfillment eligibility rule, refund arithmetic, Stripe record mapping, webhook re-verification. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateFulfillmentEligibility, type EligibilityInput } from "../../src/lib/orders/fulfillment-eligibility";
import { refundableAmount } from "../../src/lib/admin/services/orders";
import { mapPaymentIntent, mapStripeEvent } from "../../src/lib/payments/stripe";
import { createDevPaymentSimulator } from "../../src/lib/payments/dev-simulator";
import { handlePaymentWebhook, type PaymentWebhookStore } from "../../src/lib/payments/webhook";
import type { BalanceFigures, PaymentProvider, VerifiedPayment } from "../../src/lib/payments/types";
import { money, type Money } from "../../src/lib/money";
import type { OrderStatus } from "../../src/lib/orders/state-machine";

// ───────── Fulfillment eligibility ─────────
const pay = (over: Partial<EligibilityInput["payments"][number]> = {}) => ({
  id: "p1", provider: "stripe", providerPaymentId: "pi_1", status: "succeeded", amount: 1000, refundedAmount: 0, currency: "EUR" as const, ...over,
});
const input = (over: Partial<EligibilityInput> = {}): EligibilityInput => ({
  order: { status: "paid", total: 1000, currency: "EUR" }, payments: [pay()], paidByVerifiedWebhook: true, pendingRefundAmount: 0, ...over,
});

test("eligibility: a verified, fully paid order is eligible", () => {
  assert.equal(evaluateFulfillmentEligibility(input()).ok, true);
  assert.equal(evaluateFulfillmentEligibility(input({ payments: [pay({ status: "partially_refunded", refundedAmount: 200 })] })).ok, true, "partial refund keeps it fulfillable");
});

test("eligibility: unpaid, pending, failed, cancelled and invalid payments are rejected", () => {
  const cases: [string, EligibilityInput][] = [
    ["unpaid order", input({ order: { status: "pending_payment", total: 1000, currency: "EUR" }, payments: [pay({ status: "pending", providerPaymentId: null })], paidByVerifiedWebhook: false })],
    ["pending payment", input({ payments: [pay({ status: "pending" })] })],
    ["failed payment (order failed at payment)", input({ order: { status: "failed", total: 1000, currency: "EUR" }, payments: [pay({ status: "failed" })], paidByVerifiedWebhook: false })],
    ["cancelled order", input({ order: { status: "cancelled", total: 1000, currency: "EUR" } })],
    ["refunded order", input({ order: { status: "refunded", total: 1000, currency: "EUR" } })],
    ["refund requested", input({ order: { status: "refund_requested", total: 1000, currency: "EUR" } })],
    ["no webhook confirmation", input({ paidByVerifiedWebhook: false })],
    ["amount mismatch", input({ payments: [pay({ amount: 999 })] })],
    ["currency mismatch", input({ payments: [pay({ currency: "USD" })] })],
    ["no provider payment id", input({ payments: [pay({ providerPaymentId: null })] })],
    ["fully refunded payment", input({ payments: [pay({ status: "refunded", refundedAmount: 1000 })] })],
    ["full refund pending", input({ pendingRefundAmount: 1000 })],
    ["no payment", input({ payments: [] })],
  ];
  for (const [label, i] of cases) assert.equal(evaluateFulfillmentEligibility(i).ok, false, label);
});

test("eligibility: supplier-failed order with verified payment can be retried", () => {
  assert.equal(evaluateFulfillmentEligibility(input({ order: { status: "failed", total: 1000, currency: "EUR" } })).ok, true);
});

// ───────── Refund arithmetic ─────────
test("refundable amount counts settled and pending refunds, never negative", () => {
  assert.equal(refundableAmount(1000, 0, 0), 1000);
  assert.equal(refundableAmount(1000, 300, 300), 700, "partial refund");
  assert.equal(refundableAmount(1000, 300, 800), 200, "pending refund reserves its amount");
  assert.equal(refundableAmount(1000, 1000, 1000), 0);
  assert.equal(refundableAmount(1000, 1000, 0), 0, "refund recorded only on the payment (outside the admin)");
});

// ───────── Stripe records ─────────
const pi = (over: Record<string, unknown> = {}) => ({
  id: "pi_1", status: "succeeded", amount_received: 1599, currency: "eur", livemode: false,
  latest_charge: { id: "ch_1", amount_refunded: 0, balance_transaction: { id: "txn_1", amount: 1599, fee: 75, net: 1524, currency: "eur" } },
  ...over,
});

test("PaymentIntent maps to actual gross / fee / net from the balance transaction", () => {
  const v = mapPaymentIntent(pi());
  assert.equal(v.status, "succeeded");
  assert.deepEqual(v.amountReceived, money(1599, "EUR"));
  assert.deepEqual(v.balance, { transactionId: "txn_1", gross: 1599, fee: 75, net: 1524, currency: "EUR" });
  assert.equal(mapPaymentIntent(pi({ latest_charge: "ch_1" })).balance, null, "unexpanded → unknown, never estimated");
  assert.equal(mapPaymentIntent(pi({ latest_charge: { id: "ch_1", balance_transaction: null } })).balance, null);
});

test("PaymentIntent statuses: processing → pending, canceled, failed attempt", () => {
  assert.equal(mapPaymentIntent(pi({ status: "processing" })).status, "pending");
  assert.equal(mapPaymentIntent(pi({ status: "requires_action" })).status, "pending");
  assert.equal(mapPaymentIntent(pi({ status: "canceled" })).status, "canceled");
  assert.equal(mapPaymentIntent(pi({ status: "requires_payment_method", last_payment_error: { code: "card_declined" } })).status, "failed");
});

test("refund events map per refund with status and local id", () => {
  const ev = mapStripeEvent({
    id: "evt_r", type: "refund.updated", created: 1, data: { object: { id: "re_1", status: "succeeded", amount: 500, currency: "eur", payment_intent: "pi_1", metadata: { local_refund_id: "loc", order_id: "ord" } } },
  });
  assert.equal(ev?.type, "refund.updated");
  assert.deepEqual(ev?.refund, { providerRefundId: "re_1", status: "succeeded", localRefundId: "loc" });
  assert.deepEqual(ev?.amount, money(500, "EUR"));
  const failed = mapStripeEvent({ id: "evt_f", type: "refund.failed", created: 1, data: { object: { id: "re_2", status: "failed", amount: 1, currency: "usd", payment_intent: "pi_1" } } });
  assert.equal(failed?.refund?.status, "failed");
});

// ───────── Webhook: independent provider verification ─────────
const SECRET = "unit-test-secret-0123456789";
function verifyingProvider(lookup: () => Promise<VerifiedPayment>): PaymentProvider & ReturnType<typeof createDevPaymentSimulator> {
  const sim = createDevPaymentSimulator({ secret: SECRET, baseUrl: "http://localhost", env: "test" });
  return Object.assign(sim, { retrievePayment: lookup });
}
const verified = (over: Partial<VerifiedPayment> = {}): VerifiedPayment => ({
  status: "succeeded", amountReceived: money(1999, "USD"), amountRefunded: 0, livemode: false,
  balance: { transactionId: "txn_9", gross: 1999, fee: 88, net: 1911, currency: "USD" }, ...over,
});

function store(status: OrderStatus, total: Money) {
  const order = { id: "ord_1", status, total };
  const log = { flags: [] as string[], unmatched: 0, financials: [] as BalanceFigures[], events: new Set<string>() };
  const s: PaymentWebhookStore = {
    async recordEventOnce(_p, e) {
      if (log.events.has(e.eventId)) return false;
      log.events.add(e.eventId);
      return true;
    },
    async getOrder(id) { return id === order.id ? { ...order } : null; },
    async findOrderIdByProviderPayment() { return null; },
    async applyTransition(_id, audit) { order.status = audit.toStatus; },
    async flagForReview(_o, reason) { log.flags.push(reason); },
    async recordUnmatchedPayment() { log.unmatched++; },
    async recordPaymentFinancials(_p, _id, b) { log.financials.push(b); },
    async applyRefundUpdate() { return "unknown"; },
    async isCurrentSession() { return true; },
  };
  return { s, order, log };
}
const paidEvent = { type: "payment.succeeded" as const, orderId: "ord_1", providerPaymentId: "pi_9", amount: money(1999, "USD") };

test("webhook: successful payment is re-verified with the provider and records actual fees", async () => {
  const p = verifyingProvider(async () => verified());
  const { s, order, log } = store("pending_payment", money(1999, "USD"));
  const h = p.buildWebhook(paidEvent);
  assert.deepEqual(await handlePaymentWebhook(p, h.rawBody, h.headers, s), { status: "processed", orderStatus: "paid" });
  assert.equal(order.status, "paid");
  assert.deepEqual(log.financials, [verified().balance]);
  assert.deepEqual(await handlePaymentWebhook(p, h.rawBody, h.headers, s), { status: "duplicate" }, "repeated delivery");
  assert.equal(log.financials.length, 1, "no duplicate financial record");
});

test("webhook: pending payment at the provider is not marked paid (delivery fails → retried)", async () => {
  const p = verifyingProvider(async () => verified({ status: "pending" }));
  const { s, order } = store("pending_payment", money(1999, "USD"));
  const h = p.buildWebhook(paidEvent);
  await assert.rejects(handlePaymentWebhook(p, h.rawBody, h.headers, s), /not settled/);
  assert.equal(order.status, "pending_payment");
});

test("webhook: canceled/failed payment at the provider is rejected and flagged", async () => {
  for (const status of ["canceled", "failed"] as const) {
    const p = verifyingProvider(async () => verified({ status }));
    const { s, order, log } = store("pending_payment", money(1999, "USD"));
    const h = p.buildWebhook(paidEvent);
    assert.equal((await handlePaymentWebhook(p, h.rawBody, h.headers, s)).status, "ignored");
    assert.equal(order.status, "pending_payment", status);
    assert.equal(log.flags.length, 1);
  }
});

test("webhook: provider amount mismatch (invalid verification) is rejected and flagged", async () => {
  const p = verifyingProvider(async () => verified({ amountReceived: money(1, "USD") }));
  const { s, order, log } = store("pending_payment", money(1999, "USD"));
  const h = p.buildWebhook(paidEvent);
  assert.equal((await handlePaymentWebhook(p, h.rawBody, h.headers, s)).status, "ignored");
  assert.equal(order.status, "pending_payment");
  assert.match(log.flags[0]!, /received/);
});

test("webhook: provider lookup failure propagates (no paid order, provider retries)", async () => {
  const p = verifyingProvider(async () => { throw new Error("network down"); });
  const { s, order } = store("pending_payment", money(1999, "USD"));
  const h = p.buildWebhook(paidEvent);
  await assert.rejects(handlePaymentWebhook(p, h.rawBody, h.headers, s), /network down/);
  assert.equal(order.status, "pending_payment");
});

test("webhook: payment for a cancelled order is kept for refund and flagged, order not revived", async () => {
  const p = verifyingProvider(async () => verified());
  const { s, order, log } = store("cancelled", money(1999, "USD"));
  const h = p.buildWebhook(paidEvent);
  assert.equal((await handlePaymentWebhook(p, h.rawBody, h.headers, s)).status, "ignored");
  assert.equal(order.status, "cancelled");
  assert.equal(log.unmatched, 1);
  assert.match(log.flags[0]!, /cancelled/);
});

test("webhook: invalid signature is rejected before any processing", async () => {
  const p = verifyingProvider(async () => { throw new Error("must not be called"); });
  const { s, log } = store("pending_payment", money(1999, "USD"));
  const h = p.buildWebhook(paidEvent);
  h.headers.set("x-sim-signature", `t=${Math.floor(Date.now() / 1000)},v1=${"0".repeat(64)}`);
  await assert.rejects(handlePaymentWebhook(p, h.rawBody, h.headers, s), /Invalid signature/);
  assert.equal(log.events.size, 0);
});
