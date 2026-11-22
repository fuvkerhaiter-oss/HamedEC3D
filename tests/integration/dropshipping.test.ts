/** Automatic fulfillment end-to-end on a real Postgres: payment → job → supplier order → tracking → delivered. MOCK supplier only. */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createOrder, getOrderDetail } from "../../src/lib/admin/services/orders";
import { saveSupplier } from "../../src/lib/admin/services/suppliers";
import { createDevPaymentSimulator } from "../../src/lib/payments/dev-simulator";
import { pgWebhookStore } from "../../src/lib/payments/pg-store";
import { handlePaymentWebhook } from "../../src/lib/payments/webhook";
import { requeueJob } from "../../src/lib/fulfillment/jobs";
import { processDueFulfillmentJobs } from "../../src/lib/fulfillment/worker";
import { syncSupplierOrders } from "../../src/lib/fulfillment/tracking-sync";
import { createMockSupplier } from "../../src/lib/suppliers/mock-supplier";
import { SupplierError, type SupplierAdapter } from "../../src/lib/suppliers/types";
import type { Tx } from "../../src/lib/db/client";
import { IT_ADDRESS, makeAdmin, setupCommerce, startTestDb, variantBySku, type TestDb } from "./helpers";

let t: TestDb;
let admin: Awaited<ReturnType<typeof makeAdmin>>;
let euMethod: string;
const adapters = new Map<string, SupplierAdapter>();
const deps = { getAdapter: (_k: string, id: string) => adapters.get(id) ?? null, retry: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0, timeoutMs: 2000 }, sleep: async () => {} };

before(async () => {
  t = await startTestDb("dropship");
  admin = await makeAdmin(t.sql);
  ({ euMethod } = await setupCommerce(t.sql));
  await t.sql`insert into public.exchange_rates (base_currency, quote_currency, rate) values ('EUR', 'USD', 1.10000000)`;
  await setAutomation({ enabled: true, killSwitch: false });
});
after(() => t.close());

const sim = createDevPaymentSimulator({ secret: "integration-test-secret-123", baseUrl: "http://localhost", env: "test" });
const deliver = (body: { rawBody: string; headers: Headers }) =>
  t.sql.begin((tx) => handlePaymentWebhook(sim, body.rawBody, body.headers, pgWebhookStore(tx as unknown as Tx, { isTest: true })));

async function setAutomation(v: { enabled: boolean; killSwitch: boolean }) {
  await t.sql`update public.store_settings set value = ${t.sql.json(v)} where key = 'fulfillment.automation'`;
}

let n = 0;
async function paidOrder(sku: string, qty = 1, shipTo: typeof IT_ADDRESS = IT_ADDRESS) {
  const v = await variantBySku(t.sql, sku);
  const o = await createOrder(t.sql, { email: `d${++n}@test.local`, lines: [{ variantId: v, quantity: qty }], shipTo, shippingMethodId: euMethod, idempotencyKey: `ds-${n}`, isTest: true });
  const d = await getOrderDetail(t.sql, o.orderId);
  const hook = sim.buildWebhook({ eventId: `evt_ds_${n}`, type: "payment.succeeded", orderId: o.orderId, providerPaymentId: `sim_pi_ds_${n}`, amount: { amount: d!.order.total, currency: "EUR" } });
  assert.deepEqual(await deliver(hook), { status: "processed", orderStatus: "paid" });
  return { orderId: o.orderId, hook };
}

async function apiSupplier(name: string, stock: Record<string, number>, extra: Partial<SupplierAdapter> = {}, failures: SupplierError[] = []) {
  const id = await saveSupplier(t.sql, admin, { name, adapterKey: "mock", fulfillmentMode: "api", isActive: true, contactEmail: null, website: null, notes: "", defaultCurrency: "USD", leadTimeDays: 7 });
  const mock = createMockSupplier({ id, stock, submitFailures: failures });
  adapters.set(id, Object.assign(mock, extra));
  return { id, mock };
}

async function map(supplierId: string, sku: string, supplierSku: string, cost: number, opts: { primary?: boolean; priority?: number } = {}) {
  const v = await variantBySku(t.sql, sku);
  await t.sql`insert into public.supplier_products (supplier_id, variant_id, supplier_sku, cost_amount, cost_currency, is_primary, priority)
              values (${supplierId}, ${v}, ${supplierSku}, ${cost}, 'USD', ${opts.primary ?? true}, ${opts.priority ?? 0})`;
}

const job = async (orderId: string) => (await t.sql<{ status: string; stage: string | null; review_reason: string | null; attempts: number }[]>`select * from public.fulfillment_jobs where order_id = ${orderId}`)[0];
const sos = (orderId: string) => t.sql<{ id: string; status: string; supplier_order_ref: string | null; supplier_payment_status: string; supplier_id: string }[]>`select * from public.supplier_orders where order_id = ${orderId}`;
const status = async (orderId: string) => (await getOrderDetail(t.sql, orderId))!.order.status;
const dueNow = (orderId: string) => t.sql`update public.supplier_orders set next_sync_at = now() - interval '1 minute' where order_id = ${orderId}`;

test("paid order → one job → supplier order → payment detected → shipped → delivered (duplicate webhook is harmless)", async () => {
  const { id: sup, mock } = await apiSupplier("Mock API supplier", { "AE-OIL": 50 });
  await map(sup, "MOCK-OLIVE-OIL-1", "AE-OIL", 100);
  const { orderId, hook } = await paidOrder("MOCK-OLIVE-OIL-1", 2);
  assert.deepEqual(await deliver(hook), { status: "duplicate" });
  assert.equal((await t.sql`select 1 from public.fulfillment_jobs where order_id = ${orderId}`).length, 1, "exactly one job");

  const r = await processDueFulfillmentJobs(t.sql, deps);
  assert.deepEqual(r.results, [{ orderId, outcome: "succeeded" }]);
  assert.equal((await processDueFulfillmentJobs(t.sql, deps)).processed, 0, "nothing left to run");
  const [so] = await sos(orderId);
  assert.equal(so!.status, "submitted");
  assert.equal(so!.supplier_payment_status, "pending", "placing ≠ paying");
  assert.equal(mock.submittedOrders.size, 1);
  assert.equal(await status(orderId), "submitted_to_supplier");
  assert.equal((await job(orderId))!.stage, "awaiting_supplier_payment");

  // Supplier reports paid + shipped with tracking.
  mock.advance(so!.supplier_order_ref!, { supplierOrderRef: so!.supplier_order_ref!, state: "shipped", paymentState: "paid", tracking: { carrier: "Cainiao", trackingNumber: "LP000111", events: [{ status: "in_transit", description: "Departed sorting center", occurredAt: "2026-11-20T10:00:00Z" }] } });
  await dueNow(orderId);
  assert.deepEqual(await syncSupplierOrders(t.sql, deps), { synced: 1, errors: 0 });
  assert.equal(await status(orderId), "shipped");
  const [ship] = await t.sql<{ id: string; tracking_number: string; status: string }[]>`select * from public.shipments where order_id = ${orderId}`;
  assert.equal(ship!.tracking_number, "LP000111");
  assert.equal((await t.sql`select 1 from public.tracking_events where shipment_id = ${ship!.id}`).length, 1);
  assert.equal((await sos(orderId))[0]!.supplier_payment_status, "paid");
  assert.equal((await t.sql`select 1 from public.email_outbox where related_order_id = ${orderId} and template = 'order_shipped'`).length, 1, "customer gets one shipped email");

  // Re-sync is idempotent; then delivered.
  await dueNow(orderId);
  await syncSupplierOrders(t.sql, deps);
  assert.equal((await t.sql`select 1 from public.shipments where order_id = ${orderId}`).length, 1);
  mock.advance(so!.supplier_order_ref!, { supplierOrderRef: so!.supplier_order_ref!, state: "delivered", paymentState: "paid", tracking: { carrier: "Cainiao", trackingNumber: "LP000111", events: [{ status: "delivered", description: "Delivered", occurredAt: "2026-11-25T10:00:00Z" }] } });
  await dueNow(orderId);
  await syncSupplierOrders(t.sql, deps);
  assert.equal(await status(orderId), "delivered");
  const logs = await t.sql<{ event: string }[]>`select event from public.automation_logs where order_id = ${orderId} order by id`;
  assert.ok(logs.some((l) => l.event === "job.queued") && logs.some((l) => l.event === "submit.result"), "every step is logged");
});

test("kill switch: job waits, nothing is sent", async () => {
  const { id: sup, mock } = await apiSupplier("Kill switch supplier", { "AE-PENNE": 50 });
  await map(sup, "MOCK-PASTA-PENNE-1", "AE-PENNE", 100);
  const { orderId } = await paidOrder("MOCK-PASTA-PENNE-1", 4);
  await setAutomation({ enabled: true, killSwitch: true });
  try {
    await processDueFulfillmentJobs(t.sql, deps);
    const j = await job(orderId);
    assert.equal(j!.status, "queued");
    assert.equal(j!.attempts, 0, "a deferred run does not use up attempts");
    assert.equal(mock.submittedOrders.size, 0);
    assert.equal((await sos(orderId)).length, 0);
  } finally {
    await setAutomation({ enabled: true, killSwitch: false });
  }
  await t.sql`update public.fulfillment_jobs set next_run_at = now() where order_id = ${orderId}`;
  await processDueFulfillmentJobs(t.sql, deps);
  assert.equal((await job(orderId))!.status, "succeeded", (await job(orderId))!.review_reason ?? "");
});

test("supplier price increase above the limit → exception queue, no purchase", async () => {
  const { id: sup, mock } = await apiSupplier("Pricey supplier", { "AE-PASSATA": 50 }, {
    getPricing: async (skus: string[]) => skus.map((supplierSku) => ({ supplierSku, cost: { amount: 130, currency: "USD" as const } })),
  });
  await map(sup, "MOCK-TOMATO-PASSATA-1", "AE-PASSATA", 100);
  const { orderId } = await paidOrder("MOCK-TOMATO-PASSATA-1", 3);
  await processDueFulfillmentJobs(t.sql, deps);
  const j = await job(orderId);
  assert.equal(j!.status, "manual_review");
  assert.match(j!.review_reason!, /price rose 30\.0%/);
  assert.equal(mock.submittedOrders.size, 0);
  assert.equal((await sos(orderId)).length, 0);
  assert.equal((await t.sql`select 1 from public.admin_notifications where kind = 'fulfillment_review'`).length >= 1, true);
});

test("primary out of stock → backup supplier by priority", async () => {
  const { id: a, mock: ma } = await apiSupplier("Primary (empty)", { "P-WATER": 0 });
  const { id: b, mock: mb } = await apiSupplier("Backup", { "B-WATER": 99 });
  await map(a, "MOCK-SPARKLING-WATER-2", "P-WATER", 100, { primary: true });
  await map(b, "MOCK-SPARKLING-WATER-2", "B-WATER", 105, { primary: false, priority: 1 });
  const { orderId } = await paidOrder("MOCK-SPARKLING-WATER-2", 2);
  await processDueFulfillmentJobs(t.sql, deps);
  assert.equal((await job(orderId))!.status, "succeeded");
  assert.equal(ma.submittedOrders.size, 0);
  assert.equal(mb.submittedOrders.size, 1);
  assert.deepEqual((await sos(orderId)).map((s) => s.supplier_id), [b]);
});

test("invalid address, automation off, unmapped product → manual review", async () => {
  const { id: sup } = await apiSupplier("Address supplier", { "AE-CHIPS": 50 });
  await map(sup, "MOCK-SEA-SALT-CHIPS-1", "AE-CHIPS", 50);
  const bad = await paidOrder("MOCK-SEA-SALT-CHIPS-1", 2, { ...IT_ADDRESS, line1: "x1" });
  await processDueFulfillmentJobs(t.sql, deps);
  assert.match((await job(bad.orderId))!.review_reason!, /street address/);

  const unmapped = await paidOrder("MOCK-PAPER-TOWELS-1");
  await processDueFulfillmentJobs(t.sql, deps);
  assert.match((await job(unmapped.orderId))!.review_reason!, /no supplier mapped/);

  await setAutomation({ enabled: false, killSwitch: false });
  try {
    const off = await paidOrder("MOCK-SEA-SALT-CHIPS-1", 2);
    await processDueFulfillmentJobs(t.sql, deps);
    assert.match((await job(off.orderId))!.review_reason!, /turned off/);
    assert.equal((await sos(off.orderId)).length, 0);
  } finally {
    await setAutomation({ enabled: true, killSwitch: false });
  }
});

test("supplier timeout → never resubmitted automatically; retryable outage → retried once, one supplier order", async () => {
  const { id: s1, mock: m1 } = await apiSupplier("Timeout supplier", { "AE-CHOC": 50 }, {}, [new SupplierError("slow", "timeout")]);
  await map(s1, "MOCK-DARK-CHOCOLATE-1", "AE-CHOC", 100);
  const a = await paidOrder("MOCK-DARK-CHOCOLATE-1", 3);
  await processDueFulfillmentJobs(t.sql, deps);
  assert.equal((await job(a.orderId))!.status, "manual_review");
  assert.equal((await sos(a.orderId))[0]?.status, "manual_required", (await job(a.orderId))!.review_reason ?? "");
  assert.ok(await requeueJob(t.sql, a.orderId));
  await processDueFulfillmentJobs(t.sql, deps);
  assert.match((await job(a.orderId))!.review_reason!, /confirm with the supplier/);
  assert.equal(m1.submittedOrders.size, 0, "a timed-out order is never blindly resubmitted");

  const { id: s2, mock: m2 } = await apiSupplier("Flaky supplier", { "AE-SOAP": 50 }, {}, [1, 2, 3].map(() => new SupplierError("down", "unavailable")));
  await map(s2, "MOCK-LAUNDRY-LIQUID-1", "AE-SOAP", 300);
  const b = await paidOrder("MOCK-LAUNDRY-LIQUID-1");
  await processDueFulfillmentJobs(t.sql, deps);
  assert.equal((await job(b.orderId))!.status, "queued", "retry scheduled with backoff");
  await t.sql`update public.fulfillment_jobs set next_run_at = now() where order_id = ${b.orderId}`;
  await processDueFulfillmentJobs(t.sql, deps);
  assert.equal((await job(b.orderId))!.status, "succeeded");
  assert.equal((await sos(b.orderId)).length, 1);
  assert.equal(m2.submittedOrders.size, 1);
});

test("supplier cancels → order failed, admin alerted", async () => {
  const { id: sup, mock } = await apiSupplier("Cancelling supplier", { "AE-OIL2": 50 });
  await map(sup, "MOCK-OLIVE-OIL-2", "AE-OIL2", 200);
  const { orderId } = await paidOrder("MOCK-OLIVE-OIL-2");
  await processDueFulfillmentJobs(t.sql, deps);
  const [so] = await sos(orderId);
  mock.advance(so!.supplier_order_ref!, { supplierOrderRef: so!.supplier_order_ref!, state: "cancelled", paymentState: "unknown", raw: "SELLER_CANCEL" });
  await dueNow(orderId);
  await syncSupplierOrders(t.sql, deps);
  assert.equal(await status(orderId), "failed");
  assert.equal((await sos(orderId))[0]!.status, "failed");
  assert.equal((await t.sql`select 1 from public.admin_notifications where kind = 'supplier_failed'`).length, 1);
});
