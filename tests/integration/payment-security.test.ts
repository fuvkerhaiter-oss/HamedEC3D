/**
 * Phase 1 security against a real PostgreSQL: payment-gated fulfillment, refund correctness and concurrency,
 * webhook rollback, Stripe financial records. The "stripe" provider here is a TEST DOUBLE (signed with the
 * simulator's HMAC, Stripe-like lookups/refunds) — it exercises our server-side enforcement, not Stripe itself.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { adminTransition, createOrder, getOrderDetail, refundOrder } from "../../src/lib/admin/services/orders";
import { createSupplierOrders, recordSupplierSubmission, saveSupplier } from "../../src/lib/admin/services/suppliers";
import { effectivePermissions } from "../../src/lib/admin/permissions";
import { createDevPaymentSimulator } from "../../src/lib/payments/dev-simulator";
import { StripeApiError } from "../../src/lib/payments/stripe";
import { pgWebhookStore } from "../../src/lib/payments/pg-store";
import { handlePaymentWebhook } from "../../src/lib/payments/webhook";
import type { PaymentEvent, PaymentProvider, ProviderRefundStatus, VerifiedPayment } from "../../src/lib/payments/types";
import { money } from "../../src/lib/money";
import type { Tx } from "../../src/lib/db/client";
import { IT_ADDRESS, makeAdmin, setupCommerce, startTestDb, variantBySku, type TestDb } from "./helpers";

let t: TestDb;
let admin: Awaited<ReturnType<typeof makeAdmin>>;
let euMethod: string;
let supplierId: string;
let mappedVariant: string;
before(async () => {
  t = await startTestDb("paysec");
  admin = await makeAdmin(t.sql);
  ({ euMethod } = await setupCommerce(t.sql));
  supplierId = await saveSupplier(t.sql, admin, { name: "Supplier (test)", adapterKey: "manual", fulfillmentMode: "manual", isActive: true, contactEmail: null, website: null, notes: "", defaultCurrency: "EUR", leadTimeDays: 3 });
  mappedVariant = await variantBySku(t.sql, "MOCK-SEA-SALT-CHIPS-1");
  await t.sql`insert into public.supplier_products (supplier_id, variant_id, supplier_sku, cost_amount, cost_currency) values (${supplierId}, ${mappedVariant}, 'S-CHIPS', 100, 'EUR')`;
});
after(() => t.close());

// ── Stripe-like TEST DOUBLE ──
type RefundMode = ProviderRefundStatus | "network" | "reject";
const remote = new Map<string, VerifiedPayment>();
const fake = {
  refundMode: "succeeded" as RefundMode,
  lookupFails: false,
  refunds: 0,
};
const sim = createDevPaymentSimulator({ secret: "integration-test-secret-456", baseUrl: "http://localhost", env: "test" });
const stripeDouble: PaymentProvider & typeof sim = Object.assign(sim, {
  id: "stripe",
  async retrievePayment(id: string) {
    if (fake.lookupFails) throw new Error("Stripe unreachable (test)");
    const v = remote.get(id);
    if (!v) throw new StripeApiError("No such payment_intent", 404);
    return v;
  },
  async refund(): Promise<{ refundId: string; status: ProviderRefundStatus }> {
    fake.refunds++;
    if (fake.refundMode === "network") throw new Error("socket hang up");
    if (fake.refundMode === "reject") throw new StripeApiError("Charge already refunded", 400);
    return { refundId: `re_test_${fake.refunds}`, status: fake.refundMode };
  },
});
const deps = { getProvider: (id: string) => (id === "stripe" ? stripeDouble : null) };

const deliver = (e: Omit<PaymentEvent, "occurredAt" | "eventId"> & { eventId?: string }) => {
  const h = stripeDouble.buildWebhook(e);
  return t.sql.begin((tx) => handlePaymentWebhook(stripeDouble, h.rawBody, h.headers, pgWebhookStore(tx as unknown as Tx, { isTest: true })));
};

let n = 0;
async function newOrder(qty = 1) {
  const o = await createOrder(t.sql, { email: `p${++n}@test.local`, lines: [{ variantId: mappedVariant, quantity: qty }], shipTo: IT_ADDRESS, shippingMethodId: euMethod, idempotencyKey: `ps-${n}`, isTest: true });
  const total = (await getOrderDetail(t.sql, o.orderId))!.order.total;
  return { ...o, total: Number(total) };
}
async function paidOrder(qty = 1, balance: VerifiedPayment["balance"] = null) {
  const o = await newOrder(qty);
  const pi = `pi_${o.orderNumber}`;
  remote.set(pi, { status: "succeeded", amountReceived: money(o.total, "EUR"), amountRefunded: 0, livemode: false, balance });
  assert.deepEqual(await deliver({ type: "payment.succeeded", orderId: o.orderId, providerPaymentId: pi, amount: money(o.total, "EUR") }), { status: "processed", orderStatus: "paid" });
  return { ...o, pi };
}
const status = async (id: string) => (await getOrderDetail(t.sql, id))!.order.status;

// ───────────────────────── FULFILLMENT ─────────────────────────

test("fulfillment: a verified paid order is eligible and moves to processing", async () => {
  const o = await paidOrder();
  const r = await createSupplierOrders(t.sql, admin, o.orderId, deps);
  assert.equal(r.results.length, 1);
  assert.equal(await status(o.orderId), "processing");
});

test("fulfillment: unpaid, failed-payment and cancelled orders are rejected (UI, admin transition and DB)", async () => {
  const unpaid = await newOrder();
  await assert.rejects(createSupplierOrders(t.sql, admin, unpaid.orderId, deps), /paid orders/);

  // Payment FAILED → order 'failed'. Previously this order could be pushed failed → processing → supplier.
  const failed = await newOrder();
  await deliver({ type: "payment.failed", orderId: failed.orderId, providerPaymentId: `pi_f${failed.orderNumber}`, amount: money(failed.total, "EUR") });
  assert.equal(await status(failed.orderId), "failed");
  await assert.rejects(createSupplierOrders(t.sql, admin, failed.orderId, deps), /Fulfillment refused/);
  await assert.rejects(adminTransition(t.sql, admin, failed.orderId, "processing", "force it"), /Fulfillment refused/);
  await assert.rejects(t.sql`update public.orders set status = 'processing' where id = ${failed.orderId}`, /no verified successful payment/, "DB trigger backstop");
  await assert.rejects(t.sql`insert into public.supplier_orders (order_id, supplier_id, idempotency_key) values (${failed.orderId}, ${supplierId}, ${"x:" + failed.orderId})`, /Supplier fulfillment refused/);
  assert.equal((await t.sql`select count(*)::int as n from public.supplier_orders where order_id = ${failed.orderId}`)[0]!.n, 0);

  const cancelled = await newOrder();
  await adminTransition(t.sql, admin, cancelled.orderId, "cancelled", "test");
  await assert.rejects(createSupplierOrders(t.sql, admin, cancelled.orderId, deps), /paid orders/);
});

test("fulfillment: payment re-verified with the provider immediately before fulfillment", async () => {
  // Provider now says pending / canceled / different amount → refused even though the DB says paid.
  for (const patch of [{ status: "pending" as const }, { status: "canceled" as const }, { amountReceived: money(1, "EUR") }]) {
    const o = await paidOrder();
    remote.set(o.pi, { ...remote.get(o.pi)!, ...patch });
    await assert.rejects(createSupplierOrders(t.sql, admin, o.orderId, deps), /Fulfillment refused/, JSON.stringify(patch));
    assert.equal(await status(o.orderId), "paid", "nothing changed");
  }
  // Provider unreachable or not configured → fail closed.
  const o = await paidOrder();
  fake.lookupFails = true;
  await assert.rejects(createSupplierOrders(t.sql, admin, o.orderId, deps), /Could not re-verify/);
  fake.lookupFails = false;
  await assert.rejects(createSupplierOrders(t.sql, admin, o.orderId, { getProvider: () => null }), /provider not configured/);

  // Refunded at the provider after the supplier order was created → recording the supplier submission is refused.
  await createSupplierOrders(t.sql, admin, o.orderId, deps);
  const [so] = await t.sql<{ id: string }[]>`select id from public.supplier_orders where order_id = ${o.orderId}`;
  remote.set(o.pi, { ...remote.get(o.pi)!, amountRefunded: o.total });
  await assert.rejects(recordSupplierSubmission(t.sql, admin, so!.id, "REF-1", null, deps), /fully refunded/);
  remote.set(o.pi, { ...remote.get(o.pi)!, amountRefunded: 0 });
  await recordSupplierSubmission(t.sql, admin, so!.id, "REF-1", null, deps);
  assert.equal(await status(o.orderId), "submitted_to_supplier");
});

test("fulfillment: concurrent attempts create exactly one supplier order and one transition", async () => {
  const o = await paidOrder();
  const results = await Promise.allSettled([1, 2, 3, 4].map(() => createSupplierOrders(t.sql, admin, o.orderId, deps)));
  assert.ok(results.every((r) => r.status === "fulfilled"), JSON.stringify(results.filter((r) => r.status === "rejected")));
  const [{ sos, ev }] = (await t.sql<{ sos: number; ev: number }[]>`
    select (select count(*)::int from public.supplier_orders where order_id = ${o.orderId}) as sos,
           (select count(*)::int from public.order_status_events where order_id = ${o.orderId} and to_status = 'processing') as ev`) as unknown as [{ sos: number; ev: number }];
  assert.equal(sos, 1);
  assert.equal(ev, 1);
});

// ───────────────────────── REFUNDS ─────────────────────────

const refund = (orderId: string, amount: number, extra: { requestId?: string; manual?: boolean; manualReference?: string } = {}) =>
  refundOrder(t.sql, admin, orderId, { amount, reason: "test", manual: extra.manual ?? false, manualReference: extra.manualReference, requestId: extra.requestId }, deps);
const payment = async (orderId: string) => (await getOrderDetail(t.sql, orderId))!.payments[0]!;

test("refunds: partial, multiple partial, then full; never more than remaining", async () => {
  fake.refundMode = "succeeded";
  const o = await paidOrder(3);
  await refund(o.orderId, 100);
  assert.equal(await status(o.orderId), "paid", "partial refund does not block fulfillment");
  assert.deepEqual([(await payment(o.orderId)).status, Number((await payment(o.orderId)).refunded_amount)], ["partially_refunded", 100]);
  await createSupplierOrders(t.sql, admin, o.orderId, deps); // still fulfillable after a partial refund
  await refund(o.orderId, 200);
  await assert.rejects(refund(o.orderId, o.total - 300 + 1), /At most/, "exceeding the remaining balance");
  await refund(o.orderId, o.total - 300);
  assert.equal(await status(o.orderId), "refunded");
  assert.deepEqual([(await payment(o.orderId)).status, Number((await payment(o.orderId)).refunded_amount)], ["refunded", o.total]);
  await assert.rejects(refund(o.orderId, 1), /no successful payment/);
});

test("refunds: full refund of a paid order completes it and releases stock", async () => {
  fake.refundMode = "succeeded";
  const o = await paidOrder();
  await refund(o.orderId, o.total);
  const d = (await getOrderDetail(t.sql, o.orderId))!;
  assert.equal(d.order.status, "refunded");
  assert.equal(d.reservations[0]!.status, "released");
});

test("refunds: duplicate submissions and concurrent refunds cannot over-refund", async () => {
  fake.refundMode = "succeeded";
  const o = await paidOrder(3);
  await refund(o.orderId, 50, { requestId: "form-1" });
  await assert.rejects(refund(o.orderId, 50, { requestId: "form-1" }), /already submitted/, "double click");
  const before = fake.refunds;
  const big = Math.floor((o.total - 50) * 0.6);
  const r = await Promise.allSettled([refund(o.orderId, big), refund(o.orderId, big)]);
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
  assert.match(String((r.find((x) => x.status === "rejected") as PromiseRejectedResult).reason), /At most/);
  assert.equal(fake.refunds - before, 1, "only one provider refund call");
  assert.equal(Number((await payment(o.orderId)).refunded_amount), 50 + big);
});

test("refunds: pending → webhook succeeded (idempotent), failed → amount released", async () => {
  const o = await paidOrder(2);
  fake.refundMode = "pending";
  const res = await refund(o.orderId, o.total);
  assert.equal(res.status, "pending");
  assert.equal(await status(o.orderId), "refund_requested", "full pending refund blocks fulfillment");
  await assert.rejects(createSupplierOrders(t.sql, admin, o.orderId, deps));
  const [row] = await t.sql<{ provider_refund_id: string }[]>`select provider_refund_id from public.refunds where id = ${res.refundId}`;
  const ev = { eventId: `evt_ref_${o.orderNumber}`, type: "refund.updated" as const, orderId: o.orderId, providerPaymentId: o.pi, amount: money(o.total, "EUR"),
    refund: { providerRefundId: row!.provider_refund_id, status: "succeeded" as const, localRefundId: res.refundId } };
  assert.deepEqual(await deliver(ev), { status: "refund", outcome: "finalized" });
  assert.deepEqual(await deliver(ev), { status: "duplicate" }, "repeated delivery");
  assert.deepEqual(await deliver({ ...ev, eventId: `${ev.eventId}_b` }), { status: "refund", outcome: "already_settled" }, "second event for same refund");
  assert.equal(await status(o.orderId), "refunded");
  assert.equal(Number((await payment(o.orderId)).refunded_amount), o.total, "counted once");

  // A pending partial refund that later FAILS releases its reserved amount.
  const p = await paidOrder(2);
  const pend = await refund(p.orderId, 100);
  await assert.rejects(refund(p.orderId, p.total), /At most/, "pending refund reserves its amount");
  const [pr] = await t.sql<{ provider_refund_id: string }[]>`select provider_refund_id from public.refunds where id = ${pend.refundId}`;
  assert.deepEqual(await deliver({ eventId: `evt_rf_${p.orderNumber}`, type: "refund.updated", orderId: p.orderId, providerPaymentId: p.pi, amount: money(100, "EUR"),
    refund: { providerRefundId: pr!.provider_refund_id, status: "failed", localRefundId: pend.refundId } }), { status: "refund", outcome: "failed" });
  assert.equal(await status(p.orderId), "paid");
  fake.refundMode = "succeeded";
  await refund(p.orderId, p.total); // full amount refundable again
  assert.equal(await status(p.orderId), "refunded");
});

test("refunds: provider rejection fails; unknown outcome stays pending (no double refund)", async () => {
  const o = await paidOrder(2);
  fake.refundMode = "reject";
  await assert.rejects(refund(o.orderId, o.total), /rejected/);
  assert.equal(await status(o.orderId), "paid", "rejected refund leaves the order as it was");
  fake.refundMode = "network";
  await assert.rejects(refund(o.orderId, 100), /No confirmation/);
  const rows = await t.sql<{ status: string }[]>`select status from public.refunds where order_id = ${o.orderId} order by created_at`;
  assert.deepEqual(rows.map((r) => r.status), ["failed", "pending"]);
  await assert.rejects(refund(o.orderId, o.total), /At most/, "unconfirmed amount stays reserved");
  fake.refundMode = "succeeded";
});

test("refunds: refund made outside the admin is flagged, not silently applied", async () => {
  const o = await paidOrder();
  const r = await deliver({ type: "refund.updated", orderId: o.orderId, providerPaymentId: o.pi, amount: money(10, "EUR"), refund: { providerRefundId: "re_dashboard", status: "succeeded" } });
  assert.deepEqual(r, { status: "refund", outcome: "unknown" });
  assert.equal(Number((await payment(o.orderId)).refunded_amount), 0);
  assert.equal((await t.sql`select 1 from public.admin_notifications where dedupe_key = 'refund-unknown:re_dashboard'`).length, 1);
});

// ───────────────────────── WEBHOOKS + FINANCIALS ─────────────────────────

test("webhook: failed processing rolls back (no paid order, event retried) and fees come from the balance transaction", async () => {
  const o = await newOrder();
  const pi = `pi_${o.orderNumber}`;
  remote.set(pi, { status: "succeeded", amountReceived: money(o.total, "EUR"), amountRefunded: 0, livemode: false, balance: { transactionId: `txn_${o.orderNumber}`, gross: o.total, fee: 41, net: o.total - 41, currency: "EUR" } });
  const ev = { eventId: `evt_retry_${o.orderNumber}`, type: "payment.succeeded" as const, orderId: o.orderId, providerPaymentId: pi, amount: money(o.total, "EUR") };
  fake.lookupFails = true;
  await assert.rejects(deliver(ev));
  fake.lookupFails = false;
  assert.equal(await status(o.orderId), "pending_payment");
  assert.equal((await t.sql`select 1 from public.payment_events where provider_event_id = ${ev.eventId}`).length, 0, "dedupe record rolled back");
  assert.deepEqual(await deliver(ev), { status: "processed", orderStatus: "paid" }, "retry succeeds");
  assert.deepEqual(await deliver(ev), { status: "duplicate" });
  const [p] = await t.sql<{ fee_amount: number; gross_amount: number; net_amount: number; settlement_currency: string; balance_transaction_id: string }[]>`
    select fee_amount, gross_amount, net_amount, settlement_currency, balance_transaction_id from public.payments where provider_payment_id = ${pi}`;
  assert.deepEqual({ ...p }, { fee_amount: 41, gross_amount: o.total, net_amount: o.total - 41, settlement_currency: "EUR", balance_transaction_id: `txn_${o.orderNumber}` });
  assert.equal((await t.sql`select count(*)::int as n from public.payments where order_id = ${o.orderId}`)[0]!.n, 1, "no duplicate payment record");
});

test("webhook: settlement in another currency keeps actual figures but no converted fee", async () => {
  const o = await paidOrder(1, { transactionId: "txn_usd", gross: 900, fee: 30, net: 870, currency: "USD" });
  const [p] = await t.sql<{ fee_amount: number | null; settlement_currency: string; gross_amount: number }[]>`select fee_amount, settlement_currency, gross_amount from public.payments where provider_payment_id = ${o.pi}`;
  assert.deepEqual({ ...p }, { fee_amount: null, settlement_currency: "USD", gross_amount: 900 });
});

test("webhook: payment amount different from order total is not accepted", async () => {
  const o = await newOrder();
  const pi = `pi_m${o.orderNumber}`;
  remote.set(pi, { status: "succeeded", amountReceived: money(1, "EUR"), amountRefunded: 0, livemode: false, balance: null });
  const r = await deliver({ type: "payment.succeeded", orderId: o.orderId, providerPaymentId: pi, amount: money(1, "EUR") });
  assert.equal(r.status, "ignored");
  assert.equal(await status(o.orderId), "pending_payment");
});

// ───────────────────────── AUTHORIZATION ─────────────────────────

test("authorization: only roles with the permission may fulfil, refund or change orders", () => {
  const support = effectivePermissions("SUPPORT");
  for (const p of ["suppliers.manage", "orders.refund", "orders.manage"] as const) assert.equal(support.has(p), false, `SUPPORT must not have ${p}`);
  const pm = effectivePermissions("PRODUCT_MANAGER");
  assert.equal(pm.has("orders.refund"), false);
  assert.equal(pm.has("suppliers.manage"), false);
  assert.equal(effectivePermissions("ORDER_MANAGER", [], ["orders.refund"]).has("orders.refund"), false, "revoked permission");
});
