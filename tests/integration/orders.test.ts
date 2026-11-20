import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { addShipment, adminTransition, createOrder, getOrderDetail, refundOrder, transitionOrderInDb } from "../../src/lib/admin/services/orders";
import { IT_ADDRESS, makeAdmin, setupCommerce, startTestDb, variantBySku, type TestDb } from "./helpers";

let t: TestDb;
let methods: { euMethod: string; usMethod: string };
before(async () => {
  t = await startTestDb("orders");
  methods = await setupCommerce(t.sql);
});
after(() => t.close());

const inv = async (sku: string) => {
  const [r] = await t.sql<{ quantity: number; reserved: number }[]>`select i.quantity, i.reserved from public.inventory i join public.product_variants v on v.id = i.variant_id where v.sku = ${sku}`;
  return r!;
};

test("order totals are computed server-side and stock is reserved", async () => {
  const v = await variantBySku(t.sql, "MOCK-PASTA-PENNE-1"); // €2.49, 120 in stock
  const res = await createOrder(t.sql, { email: "a@test.local", lines: [{ variantId: v, quantity: 2 }], shipTo: IT_ADDRESS, shippingMethodId: methods.euMethod, idempotencyKey: "k-1", isTest: true });
  const d = await getOrderDetail(t.sql, res.orderId);
  assert.equal(d!.order.subtotal, 498);
  assert.equal(d!.order.shipping_total, 490);
  assert.equal(d!.order.total, 988); // EUR inclusive: tax included, not added
  assert.equal(d!.order.tax_total, Math.floor((2 * 988 * 2200 + 12200) / (2 * 12200)));
  assert.deepEqual(await inv("MOCK-PASTA-PENNE-1"), { quantity: 120, reserved: 2 });
  // Idempotent on the checkout key.
  const again = await createOrder(t.sql, { email: "a@test.local", lines: [{ variantId: v, quantity: 2 }], shipTo: IT_ADDRESS, shippingMethodId: methods.euMethod, idempotencyKey: "k-1", isTest: true });
  assert.equal(again.orderId, res.orderId);
  assert.equal(again.created, false);
  assert.deepEqual(await inv("MOCK-PASTA-PENNE-1"), { quantity: 120, reserved: 2 });
});

test("concurrent buyers cannot oversell the last units", async () => {
  const v = await variantBySku(t.sql, "MOCK-ORANGE-JUICE-1"); // 4 in stock
  const attempts = await Promise.allSettled(
    [1, 2, 3, 4].map((i) =>
      createOrder(t.sql, { email: `c${i}@test.local`, lines: [{ variantId: v, quantity: 2 }], shipTo: IT_ADDRESS, shippingMethodId: methods.euMethod, idempotencyKey: `race-${i}`, isTest: true }),
    ),
  );
  const ok = attempts.filter((a) => a.status === "fulfilled");
  assert.equal(ok.length, 2, "exactly two orders of 2 fit into 4 units");
  assert.deepEqual(await inv("MOCK-ORANGE-JUICE-1"), { quantity: 4, reserved: 4 });
  const [{ n }] = (await t.sql<{ n: number }[]>`select count(*)::int as n from public.orders where checkout_idempotency_key like 'race-%'`) as unknown as [{ n: number }];
  assert.equal(n, 2, "failed attempts left no partial orders");
});

test("cancelling releases the reservation exactly once; shipping commits stock", async () => {
  const admin = await makeAdmin(t.sql, "SUPER_ADMIN", "orders-admin@test.local");
  const v = await variantBySku(t.sql, "MOCK-DARK-CHOCOLATE-1"); // 55
  const a = await createOrder(t.sql, { email: "x@test.local", lines: [{ variantId: v, quantity: 5 }], shipTo: IT_ADDRESS, shippingMethodId: methods.euMethod, idempotencyKey: "rel-1", isTest: true });
  assert.deepEqual(await inv("MOCK-DARK-CHOCOLATE-1"), { quantity: 55, reserved: 5 });
  await adminTransition(t.sql, admin, a.orderId, "cancelled", "Customer asked");
  assert.deepEqual(await inv("MOCK-DARK-CHOCOLATE-1"), { quantity: 55, reserved: 0 });
  await assert.rejects(adminTransition(t.sql, admin, a.orderId, "processing", "nope"), /cannot move/);

  const b = await createOrder(t.sql, { email: "y@test.local", lines: [{ variantId: v, quantity: 3 }], shipTo: IT_ADDRESS, shippingMethodId: methods.euMethod, idempotencyKey: "rel-2", isTest: true });
  await assert.rejects(adminTransition(t.sql, admin, b.orderId, "paid", "manual"), /verified payment/, "admins cannot mark orders paid");
  await transitionOrderInDb(t.sql, b.orderId, "paid", { type: "payment_webhook", id: "test" }, { evidence: { verifiedPaymentId: "pi_test" } });
  await adminTransition(t.sql, admin, b.orderId, "processing", "");
  await transitionOrderInDb(t.sql, b.orderId, "submitted_to_supplier", { type: "admin", id: admin.id }, { evidence: { supplierOrderRef: "SUP-1" } });
  await adminTransition(t.sql, admin, b.orderId, "supplier_accepted", "");
  await assert.rejects(adminTransition(t.sql, admin, b.orderId, "shipped", ""), /tracking/, "shipping needs real tracking evidence");
  await addShipment(t.sql, admin, b.orderId, { carrier: "TestCarrier", trackingNumber: "TRK123", markShipped: true });
  assert.deepEqual(await inv("MOCK-DARK-CHOCOLATE-1"), { quantity: 52, reserved: 0 });
  const d = await getOrderDetail(t.sql, b.orderId);
  assert.equal(d!.order.status, "shipped");
  assert.deepEqual(d!.events.map((e) => e.to_status), ["paid", "processing", "submitted_to_supplier", "supplier_accepted", "shipped"]);
  const moves = await t.sql`select kind from public.inventory_movements m join public.product_variants v on v.id = m.variant_id where v.sku = 'MOCK-DARK-CHOCOLATE-1' order by m.id`;
  assert.deepEqual(moves.map((m) => m.kind), ["reservation", "release", "reservation", "commit"]);
});

test("refunds never simulate a provider", async () => {
  const admin = await makeAdmin(t.sql, "ADMIN", "refund-admin@test.local");
  const v = await variantBySku(t.sql, "MOCK-SEA-SALT-CHIPS-1");
  const o = await createOrder(t.sql, { email: "r@test.local", lines: [{ variantId: v, quantity: 1 }], shipTo: IT_ADDRESS, shippingMethodId: methods.euMethod, idempotencyKey: "ref-1", isTest: true });
  await assert.rejects(refundOrder(t.sql, admin, o.orderId, { amount: 100, reason: "x", manual: false }), /no successful payment/);
  await t.sql`insert into public.payments (order_id, provider, provider_payment_id, status, amount, currency) values (${o.orderId}, 'stripe', 'pi_x', 'succeeded', 769, 'EUR')`;
  await transitionOrderInDb(t.sql, o.orderId, "paid", { type: "payment_webhook", id: "stripe" }, { evidence: { verifiedPaymentId: "pi_x" } });
  // Stripe isn't configured in tests → refund must fail loudly, not pretend.
  await assert.rejects(refundOrder(t.sql, admin, o.orderId, { amount: 769, reason: "Damaged", manual: false }), /not configured/);
  const [r] = await t.sql`select status from public.refunds where order_id = ${o.orderId}`;
  assert.equal(r!.status, "failed");
  // Recording a manual refund (done at the provider dashboard) completes the order.
  await refundOrder(t.sql, admin, o.orderId, { amount: 769, reason: "Refunded in Stripe dashboard", manual: true, manualReference: "re_123" });
  const d = await getOrderDetail(t.sql, o.orderId);
  assert.equal(d!.order.status, "refunded");
  assert.equal(d!.payments[0]!.status, "refunded");
  await assert.rejects(refundOrder(t.sql, admin, o.orderId, { amount: 1, reason: "again", manual: true }), /no successful payment|At most/);
});

test("order amounts stay immutable", async () => {
  await assert.rejects(t.sql`update public.orders set total = 1, subtotal = 1`, /immutable/);
});
