import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createOrder, getOrderDetail } from "../../src/lib/admin/services/orders";
import { createSupplierOrders, recordSupplierSubmission, saveSupplier } from "../../src/lib/admin/services/suppliers";
import { createDevPaymentSimulator } from "../../src/lib/payments/dev-simulator";
import { pgWebhookStore } from "../../src/lib/payments/pg-store";
import { handlePaymentWebhook } from "../../src/lib/payments/webhook";
import type { Tx } from "../../src/lib/db/client";
import { IT_ADDRESS, makeAdmin, setupCommerce, startTestDb, variantBySku, type TestDb } from "./helpers";

let t: TestDb;
let admin: Awaited<ReturnType<typeof makeAdmin>>;
let euMethod: string;
before(async () => {
  t = await startTestDb("fulfil");
  admin = await makeAdmin(t.sql);
  ({ euMethod } = await setupCommerce(t.sql));
});
after(() => t.close());

const sim = createDevPaymentSimulator({ secret: "integration-test-secret-123", baseUrl: "http://localhost", env: "test" });
const deliver = (body: { rawBody: string; headers: Headers }) =>
  t.sql.begin((tx) => handlePaymentWebhook(sim, body.rawBody, body.headers, pgWebhookStore(tx as unknown as Tx, { isTest: true })));

test("payment webhooks are idempotent and verified", async () => {
  const v = await variantBySku(t.sql, "MOCK-OLIVE-OIL-1");
  const o = await createOrder(t.sql, { email: "w@test.local", lines: [{ variantId: v, quantity: 1 }], shipTo: IT_ADDRESS, shippingMethodId: euMethod, idempotencyKey: "wh-1", isTest: true });
  const d0 = await getOrderDetail(t.sql, o.orderId);
  const hook = sim.buildWebhook({ eventId: "evt_1", type: "payment.succeeded", orderId: o.orderId, providerPaymentId: "sim_pi_1", amount: { amount: d0!.order.total, currency: "EUR" } });
  assert.deepEqual(await deliver(hook), { status: "processed", orderStatus: "paid" });
  assert.deepEqual(await deliver(hook), { status: "duplicate" }, "replayed delivery is ignored");
  const d = await getOrderDetail(t.sql, o.orderId);
  assert.equal(d!.order.status, "paid");
  assert.equal(d!.events.length, 1, "exactly one status event");
  assert.equal(d!.payments.length, 1);
  assert.equal(d!.payments[0]!.status, "succeeded");

  // Wrong amount is not accepted as payment.
  const o2 = await createOrder(t.sql, { email: "w2@test.local", lines: [{ variantId: v, quantity: 1 }], shipTo: IT_ADDRESS, shippingMethodId: euMethod, idempotencyKey: "wh-2", isTest: true });
  const r = await deliver(sim.buildWebhook({ eventId: "evt_2", type: "payment.succeeded", orderId: o2.orderId, providerPaymentId: "sim_pi_2", amount: { amount: 1, currency: "EUR" } }));
  assert.equal(r.status, "ignored");
  assert.equal((await getOrderDetail(t.sql, o2.orderId))!.order.status, "pending_payment");

  // Failed payment releases the reservation.
  await deliver(sim.buildWebhook({ eventId: "evt_3", type: "payment.failed", orderId: o2.orderId, providerPaymentId: "sim_pi_2", amount: { amount: 0, currency: "EUR" } }));
  const res = await t.sql`select status from public.inventory_reservations where order_id = ${o2.orderId}`;
  assert.equal(res[0]!.status, "released");

  // Tampered signature is rejected.
  const forged = sim.buildWebhook({ eventId: "evt_4", type: "payment.succeeded", orderId: o2.orderId, providerPaymentId: "x", amount: { amount: 1, currency: "EUR" } });
  forged.headers.set("x-sim-signature", "t=1,v1=deadbeef");
  await assert.rejects(deliver(forged));
});

test("a paid order is split into one supplier order per supplier, idempotently", async () => {
  const supA = await saveSupplier(t.sql, admin, { name: "Supplier A (test)", adapterKey: "manual", fulfillmentMode: "manual", isActive: true, contactEmail: null, website: null, notes: "", defaultCurrency: "EUR", leadTimeDays: 3 });
  const supB = await saveSupplier(t.sql, admin, { name: "Supplier B (test)", adapterKey: "manual", fulfillmentMode: "manual", isActive: true, contactEmail: null, website: null, notes: "", defaultCurrency: "EUR", leadTimeDays: 5 });
  const chips = await variantBySku(t.sql, "MOCK-SEA-SALT-CHIPS-1");
  const soap = await variantBySku(t.sql, "MOCK-LAUNDRY-LIQUID-1");
  const towels = await variantBySku(t.sql, "MOCK-PAPER-TOWELS-1");
  await t.sql`insert into public.supplier_products (supplier_id, variant_id, supplier_sku, cost_amount, cost_currency) values
    (${supA}, ${chips}, 'A-CHIPS', 120, 'EUR'), (${supB}, ${soap}, 'B-SOAP', 500, 'EUR')`;
  const o = await createOrder(t.sql, {
    email: "s@test.local", lines: [{ variantId: chips, quantity: 2 }, { variantId: soap, quantity: 1 }, { variantId: towels, quantity: 1 }],
    shipTo: IT_ADDRESS, shippingMethodId: euMethod, idempotencyKey: "split-1", isTest: true,
  });
  const d0 = await getOrderDetail(t.sql, o.orderId);
  await deliver(sim.buildWebhook({ eventId: "evt_split", type: "payment.succeeded", orderId: o.orderId, providerPaymentId: "sim_pi_s", amount: { amount: d0!.order.total, currency: "EUR" } }));

  const r1 = await createSupplierOrders(t.sql, admin, o.orderId);
  assert.equal(r1.results.length, 2);
  assert.equal(r1.unassigned, 1, "paper towels have no supplier mapping");
  await createSupplierOrders(t.sql, admin, o.orderId); // re-run: no duplicates
  const sos = await t.sql<{ id: string; supplier_id: string; cost_total: number; status: string }[]>`select * from public.supplier_orders where order_id = ${o.orderId} order by cost_total`;
  assert.equal(sos.length, 2);
  assert.deepEqual(sos.map((s) => [s.cost_total, s.status]), [[240, "manual_required"], [500, "manual_required"]]);
  assert.equal((await getOrderDetail(t.sql, o.orderId))!.order.status, "processing");

  await recordSupplierSubmission(t.sql, admin, sos[0]!.id, "A-REF-1", null);
  assert.equal((await getOrderDetail(t.sql, o.orderId))!.order.status, "processing", "waits for every supplier");
  await recordSupplierSubmission(t.sql, admin, sos[1]!.id, "B-REF-9", { amount: 520, currency: "EUR" });
  const d = await getOrderDetail(t.sql, o.orderId);
  assert.equal(d!.order.status, "submitted_to_supplier");
  assert.match(String(d!.events.at(-1)!.evidence.supplierOrderRef), /A-REF-1/);
  const [notif] = await t.sql`select title from public.admin_notifications where kind = 'unmapped_items'`;
  assert.match(String(notif!.title), /no supplier/);
});
