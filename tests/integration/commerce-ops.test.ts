/**
 * Phase 2 against a real PostgreSQL: order snapshots (tax, billing, delivery estimate), duplicate prevention,
 * the complete manual dropshipping flow, customer emails (once each), financial reporting, customer data isolation.
 * Payments use the labelled DEV SIMULATOR (signed webhooks through the real verification path).
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { addShipment, adminTransition, createOrder, getOrderDetail, refundOrder, updateShipmentStatus } from "../../src/lib/admin/services/orders";
import { createSupplierOrders, recordSupplierSubmission, saveSupplier } from "../../src/lib/admin/services/suppliers";
import { orderFinancials, orderStatusCounts } from "../../src/lib/admin/services/finance";
import { listCustomerOrders, requestHistoryLink } from "../../src/lib/checkout/order-history";
import { getCustomerOrder } from "../../src/lib/checkout/order-view";
import { queueOrderStatusEmail } from "../../src/lib/email/outbox";
import { createDevPaymentSimulator } from "../../src/lib/payments/dev-simulator";
import { pgWebhookStore } from "../../src/lib/payments/pg-store";
import { handlePaymentWebhook } from "../../src/lib/payments/webhook";
import { money, type CurrencyCode } from "../../src/lib/money";
import type { Tx } from "../../src/lib/db/client";
import { IT_ADDRESS, makeAdmin, setupCommerce, startTestDb, variantBySku, type TestDb } from "./helpers";

let t: TestDb;
let admin: Awaited<ReturnType<typeof makeAdmin>>;
let methods: { euMethod: string; usMethod: string };
let chips: string;
before(async () => {
  t = await startTestDb("commerce");
  admin = await makeAdmin(t.sql);
  methods = await setupCommerce(t.sql);
  await t.sql`update public.shipping_methods set min_days = 3, max_days = 6 where id = ${methods.euMethod}`;
  await t.sql`insert into public.tax_rates (country, region, mode, basis_points, note) values ('US', 'NY', 'exclusive', 888, 'TEST NY rate')`;
  chips = await variantBySku(t.sql, "MOCK-SEA-SALT-CHIPS-1");
  const sup = await saveSupplier(t.sql, admin, { name: "Supplier (test)", adapterKey: "manual", fulfillmentMode: "manual", isActive: true, contactEmail: null, website: null, notes: "", defaultCurrency: "EUR", leadTimeDays: 3 });
  await t.sql`insert into public.supplier_products (supplier_id, variant_id, supplier_sku, cost_amount, cost_currency) values (${sup}, ${chips}, 'S-CHIPS', 100, 'EUR')`;
});
after(() => t.close());

const sim = createDevPaymentSimulator({ secret: "integration-test-secret-789", baseUrl: "http://localhost", env: "test" });
const deliver = (e: Parameters<typeof sim.buildWebhook>[0]) => {
  const h = sim.buildWebhook(e);
  return t.sql.begin((tx) => handlePaymentWebhook(sim, h.rawBody, h.headers, pgWebhookStore(tx as unknown as Tx, { isTest: true })));
};
let n = 0;
const US_ADDRESS = { fullName: "Ann Buyer", line1: "1 State St", city: "Albany", region: "NY", postalCode: "12207", country: "US" };
async function order(email: string, opts: { us?: boolean; qty?: number; billTo?: typeof IT_ADDRESS } = {}) {
  const key = `co-${++n}-xxxxxxxxxxxx`;
  const o = await createOrder(t.sql, {
    email, lines: [{ variantId: chips, quantity: opts.qty ?? 1 }], shipTo: opts.us ? US_ADDRESS : IT_ADDRESS, billTo: opts.billTo,
    shippingMethodId: opts.us ? methods.usMethod : methods.euMethod, idempotencyKey: key, isTest: false,
  });
  return { ...o, key };
}
async function pay(orderId: string) {
  const d = (await getOrderDetail(t.sql, orderId))!;
  const pi = `sim_pi_${d.order.order_number}`;
  await deliver({ type: "payment.succeeded", orderId, providerPaymentId: pi, amount: money(Number(d.order.total), d.order.currency as CurrencyCode) });
  return pi;
}
const emails = (orderId: string) => t.sql<{ template: string }[]>`select template from public.email_outbox where related_order_id = ${orderId} order by created_at`.then((r) => r.map((x) => x.template));

test("orders snapshot tax rate + jurisdiction, billing address and the delivery ESTIMATE; currency per market", async () => {
  const eu = await order("snap@test.local", { billTo: { ...IT_ADDRESS, fullName: "Billing Person", city: "Roma" } });
  const [o] = await t.sql`select currency, tax_rate_bps, tax_country, tax_region, billing_address, shipping_min_days, shipping_max_days from public.orders where id = ${eu.orderId}`;
  assert.deepEqual({ ...o, billing_address: (o!.billing_address as { city: string }).city }, {
    currency: "EUR", tax_rate_bps: 2200, tax_country: "IT", tax_region: null, billing_address: "Roma", shipping_min_days: 3, shipping_max_days: 6,
  });
  const us = await order("snap-us@test.local", { us: true });
  const [u] = await t.sql<{ currency: string; tax_rate_bps: number; tax_region: string; tax_total: number; subtotal: number; shipping_total: number; total: number }[]>`
    select currency, tax_rate_bps, tax_region, tax_total, subtotal, shipping_total, total from public.orders where id = ${us.orderId}`;
  assert.deepEqual([u!.currency, u!.tax_rate_bps, u!.tax_region], ["USD", 888, "NY"], "state rate wins over the US-wide rate");
  assert.ok(Number(u!.tax_total) > 0);
  assert.equal(Number(u!.total), Number(u!.subtotal) + Number(u!.shipping_total) + Number(u!.tax_total), "US sales tax is added on top");
  const view = (await getCustomerOrder(t.sql, eu.orderId))!;
  assert.deepEqual([view.deliveryEstimate, view.taxRateBps], [{ minDays: 3, maxDays: 6 }, 2200]);
});

test("duplicate submissions return the same order; prices always come from the database", async () => {
  const a = await order("dup@test.local");
  const again = await createOrder(t.sql, { email: "dup@test.local", lines: [{ variantId: chips, quantity: 1 }], shipTo: IT_ADDRESS, shippingMethodId: methods.euMethod, idempotencyKey: a.key });
  assert.deepEqual([again.orderId, again.created], [a.orderId, false]);
  assert.equal((await t.sql`select count(*)::int as n from public.orders where email = 'dup@test.local'`)[0]!.n, 1);
  const [{ amount }] = (await t.sql<{ amount: number }[]>`select vp.amount from public.variant_prices vp where vp.variant_id = ${chips} and vp.currency = 'EUR'`) as unknown as [{ amount: number }];
  const [item] = await t.sql<{ unit_price: number }[]>`select unit_price from public.order_items where order_id = ${a.orderId}`;
  assert.equal(Number(item!.unit_price), Number(amount));
});

test("manual dropshipping: paid → supplier → cost/ref → accepted → tracking → shipped → delivered, audited and emailed once each", async () => {
  const o = await order("flow@test.local", { qty: 2 });
  await pay(o.orderId);
  await createSupplierOrders(t.sql, admin, o.orderId);
  const [so] = await t.sql<{ id: string }[]>`select id from public.supplier_orders where order_id = ${o.orderId}`;
  await recordSupplierSubmission(t.sql, admin, so!.id, "SUP-REF-77", { amount: 230, currency: "EUR" });
  await adminTransition(t.sql, admin, o.orderId, "supplier_accepted", "Supplier confirmed");
  await addShipment(t.sql, admin, o.orderId, { carrier: "DHL", trackingNumber: "TRK777", trackingUrl: "https://track.example/TRK777", markShipped: true });
  const [sh] = await t.sql<{ id: string }[]>`select id from public.shipments where order_id = ${o.orderId}`;
  await updateShipmentStatus(t.sql, admin, sh!.id, "out_for_delivery");
  assert.equal((await getOrderDetail(t.sql, o.orderId))!.order.status, "shipped");
  await updateShipmentStatus(t.sql, admin, sh!.id, "delivered");
  const d = (await getOrderDetail(t.sql, o.orderId))!;
  assert.deepEqual(d.events.map((e) => e.to_status), ["paid", "processing", "submitted_to_supplier", "supplier_accepted", "shipped", "delivered"]);
  assert.equal(d.supplierOrders[0]!.supplier_order_ref, "SUP-REF-77");
  assert.equal(Number(d.supplierOrders[0]!.cost_total), 230);
  const actions = (await t.sql<{ action: string }[]>`select action from public.admin_activity_log where entity_id = ${o.orderId}`).map((r) => r.action);
  for (const a of ["order.split", "supplier_order.submitted", "order.transition", "order.shipment", "shipment.status"]) assert.ok(actions.includes(a), `audit ${a}`);
  assert.deepEqual(await emails(o.orderId), ["order_confirmed", "order_shipped", "order_delivered"]);
  // A repeated status-change email is suppressed (dedupe key).
  await queueOrderStatusEmail(t.sql, o.orderId, "shipped", "delivered");
  assert.deepEqual(await emails(o.orderId), ["order_confirmed", "order_shipped", "order_delivered"]);
  const view = (await getCustomerOrder(t.sql, o.orderId))!;
  assert.deepEqual(view.shipments.map((s) => [s.trackingNumber, s.status]), [["TRK777", "delivered"]]);
});

test("payment failure emails the customer once; abandoned checkout does not email", async () => {
  const f = await order("fail@test.local");
  const ev = { eventId: `evt_fail_${f.orderNumber}`, type: "payment.failed" as const, orderId: f.orderId, providerPaymentId: `sim_pi_f${f.orderNumber}`, amount: money(0, "EUR") };
  await deliver(ev);
  await deliver(ev);
  assert.deepEqual(await emails(f.orderId), ["payment_failed"]);
  const a = await order("abandon@test.local");
  await adminTransition(t.sql, admin, a.orderId, "cancelled", "expired");
  assert.deepEqual(await emails(a.orderId), []);
});

test("partial refund emails the amount; refund status visible to the customer", async () => {
  const o = await order("refund@test.local", { qty: 3 });
  await pay(o.orderId);
  await refundOrder(t.sql, admin, o.orderId, { amount: 100, reason: "one bag damaged", manual: true, manualReference: "re_manual_1" });
  assert.deepEqual(await emails(o.orderId), ["order_confirmed", "refund_partial"]);
  const view = (await getCustomerOrder(t.sql, o.orderId))!;
  assert.deepEqual(view.refunds.map((r) => [r.amount.amount, r.status]), [[100, "completed"]]);
  assert.equal(view.status, "paid", "partial refund keeps the order going");
});

test("financial report: counts by status and per-order money from recorded data only", async () => {
  const o = await order("fin@test.local", { qty: 2 });
  const pi = await pay(o.orderId);
  await t.sql`update public.payments set fee_amount = 55 where provider_payment_id = ${pi}`; // as recorded from a balance transaction
  await createSupplierOrders(t.sql, admin, o.orderId);
  const range = { from: new Date(Date.now() - 3_600_000), to: new Date(Date.now() + 3_600_000), label: "test", preset: "custom" } as never;
  const row = (await orderFinancials(t.sql, range)).find((r) => r.id === o.orderId)!;
  assert.equal(row.fee, 55);
  assert.deepEqual([row.supplierCost, row.costFinal], [200, false], "mapping cost = estimate until the real cost is recorded");
  assert.equal(row.netRevenue, row.total - row.tax);
  assert.equal(row.estimatedProfit, row.netRevenue - 200 - 55);
  const [so] = await t.sql<{ id: string }[]>`select id from public.supplier_orders where order_id = ${o.orderId}`;
  await recordSupplierSubmission(t.sql, admin, so!.id, "REF-F", { amount: 210, currency: "EUR" });
  const row2 = (await orderFinancials(t.sql, range)).find((r) => r.id === o.orderId)!;
  assert.deepEqual([row2.supplierCost, row2.costFinal], [210, true]);
  const c = await orderStatusCounts(t.sql, range);
  assert.ok(c.paid >= 3 && c.cancelled >= 1 && c.failed >= 1 && c.pending >= 1, JSON.stringify(c));
  assert.equal(c.total, (await t.sql`select count(*)::int as n from public.orders where not is_test`)[0]!.n);
});

test("customer isolation: history lists only that email's orders; link requests don't reveal unknown addresses", async () => {
  const mine = await order("Alice.Shopper@test.local");
  await pay(mine.orderId);
  const theirs = await order("bob.shopper@test.local");
  await pay(theirs.orderId);
  const list = await listCustomerOrders(t.sql, "alice.shopper@TEST.local");
  assert.deepEqual(list.map((o) => o.id), [mine.orderId]);
  assert.equal(await requestHistoryLink(t.sql, "nobody@test.local", "http://localhost"), "no_orders");
  assert.equal(await requestHistoryLink(t.sql, "alice.shopper@test.local", "http://localhost"), "not_configured", "recorded, not claimed as sent (no email provider in tests)");
  assert.equal(await requestHistoryLink(t.sql, "alice.shopper@test.local", "http://localhost"), "throttled", "one link email per hour");
  const [m] = await t.sql<{ to_address: string; body_text: string }[]>`select to_address, body_text from public.email_outbox where template = 'order_history_link'`;
  assert.equal(m!.to_address, "alice.shopper@test.local", "the link only ever goes to the address itself");
  assert.match(m!.body_text, /\/account\/orders\?t=/);
});
