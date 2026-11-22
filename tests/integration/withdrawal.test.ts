/** Online withdrawal (EU art. 11a) on a real Postgres: statement stored, acknowledgement queued, fulfillment held. */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { addShipment, adminTransition, createOrder, getOrderDetail, updateShipmentStatus } from "../../src/lib/admin/services/orders";
import { createDevPaymentSimulator } from "../../src/lib/payments/dev-simulator";
import { pgWebhookStore } from "../../src/lib/payments/pg-store";
import { handlePaymentWebhook } from "../../src/lib/payments/webhook";
import { processDueFulfillmentJobs } from "../../src/lib/fulfillment/worker";
import { loadWithdrawalContext, setWithdrawalStatus, submitWithdrawal, WithdrawalError } from "../../src/lib/orders/withdrawal";
import type { Tx } from "../../src/lib/db/client";
import { IT_ADDRESS, makeAdmin, setupCommerce, startTestDb, variantBySku, type TestDb } from "./helpers";

let t: TestDb;
let admin: Awaited<ReturnType<typeof makeAdmin>>;
let euMethod: string;

before(async () => {
  t = await startTestDb("withdrawal");
  admin = await makeAdmin(t.sql);
  ({ euMethod } = await setupCommerce(t.sql));
  await t.sql`update public.store_settings set value = ${t.sql.json({ enabled: true, killSwitch: false })} where key = 'fulfillment.automation'`;
});
after(() => t.close());

const sim = createDevPaymentSimulator({ secret: "integration-test-secret-123", baseUrl: "http://localhost", env: "test" });
let n = 0;
async function paidOrder(lines: { sku: string; qty: number }[]) {
  const o = await createOrder(t.sql, {
    email: `w${++n}@test.local`, lines: await Promise.all(lines.map(async (l) => ({ variantId: await variantBySku(t.sql, l.sku), quantity: l.qty }))),
    shipTo: IT_ADDRESS, shippingMethodId: euMethod, idempotencyKey: `wd-${n}`, isTest: true,
  });
  const d = await getOrderDetail(t.sql, o.orderId);
  const hook = sim.buildWebhook({ eventId: `evt_wd_${n}`, type: "payment.succeeded", orderId: o.orderId, providerPaymentId: `sim_pi_wd_${n}`, amount: { amount: d!.order.total, currency: "EUR" } });
  const r = await t.sql.begin((tx) => handlePaymentWebhook(sim, hook.rawBody, hook.headers, pgWebhookStore(tx as unknown as Tx, { isTest: true })));
  assert.equal(r.status, "processed");
  return o.orderId;
}

test("whole-order withdrawal: stored with items, acknowledgement queued to both emails, job held, team alerted", async () => {
  const orderId = await paidOrder([{ sku: "MOCK-OLIVE-OIL-1", qty: 2 }]);
  const ctx = (await loadWithdrawalContext(t.sql, orderId))!;
  assert.equal(ctx.block, null);
  const r = await submitWithdrawal(t.sql, { orderId, fullName: "Test Buyer", confirmationEmail: "other@test.local", reason: null, items: ctx.items.map((i) => ({ orderItemId: i.id, quantity: i.quantity })) });
  assert.equal(r.wholeOrder, true);

  const [w] = await t.sql`select * from public.withdrawal_requests where id = ${r.requestId}`;
  assert.equal(w!.status, "received");
  const mails = await t.sql<{ to_address: string; template: string; body_text: string }[]>`select to_address, template, body_text from public.email_outbox where related_order_id = ${orderId} and template = 'withdrawal_received' order by to_address`;
  assert.deepEqual(mails.map((m) => m.to_address), ["other@test.local", `w${n}@test.local`]);
  assert.match(mails[0]!.body_text, /Received on: /);

  const [job] = await t.sql<{ status: string; stage: string }[]>`select status, stage from public.fulfillment_jobs where order_id = ${orderId}`;
  assert.deepEqual({ ...job }, { status: "manual_review", stage: "customer_withdrawal" });
  assert.equal((await t.sql`select 1 from public.admin_notifications where kind = 'withdrawal_received' and link = ${`/admin/orders/${orderId}`}`).length, 1);

  assert.equal((await loadWithdrawalContext(t.sql, orderId))!.block, "nothing_left");
  await assert.rejects(submitWithdrawal(t.sql, { orderId, fullName: "Test Buyer", confirmationEmail: "x@test.local", reason: null, items: ctx.items.map((i) => ({ orderItemId: i.id, quantity: 1 })) }), WithdrawalError);
});

test("worker never buys while a withdrawal is open (job re-queued by hand)", async () => {
  const orderId = await paidOrder([{ sku: "MOCK-OLIVE-OIL-1", qty: 1 }]);
  const ctx = (await loadWithdrawalContext(t.sql, orderId))!;
  await submitWithdrawal(t.sql, { orderId, fullName: "Test Buyer", confirmationEmail: "a@test.local", reason: "Changed my mind", items: [{ orderItemId: ctx.items[0]!.id, quantity: 1 }] });
  await t.sql`update public.fulfillment_jobs set status = 'queued', next_run_at = now() - interval '1 minute' where order_id = ${orderId}`;
  await processDueFulfillmentJobs(t.sql, { retry: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0, timeoutMs: 2000 }, sleep: async () => {} });
  const [job] = await t.sql<{ status: string; stage: string }[]>`select status, stage from public.fulfillment_jobs where order_id = ${orderId}`;
  assert.deepEqual({ ...job }, { status: "manual_review", stage: "customer_withdrawal" });
  assert.equal((await t.sql`select 1 from public.supplier_orders where order_id = ${orderId}`).length, 0, "nothing sent to a supplier");
});

test("partial withdrawal, then the rest; rejecting needs a note and frees the items again", async () => {
  const orderId = await paidOrder([{ sku: "MOCK-OLIVE-OIL-1", qty: 2 }]);
  const item = (await loadWithdrawalContext(t.sql, orderId))!.items[0]!;
  const first = await submitWithdrawal(t.sql, { orderId, fullName: "B", confirmationEmail: "b@test.local", reason: null, items: [{ orderItemId: item.id, quantity: 1 }] });
  assert.equal(first.wholeOrder, false);
  assert.equal((await loadWithdrawalContext(t.sql, orderId))!.items[0]!.withdrawn, 1);

  await assert.rejects(setWithdrawalStatus(t.sql, admin, first.requestId, "rejected", null), /reason/);
  await setWithdrawalStatus(t.sql, admin, first.requestId, "rejected", "Submitted by mistake, confirmed by phone");
  assert.equal((await loadWithdrawalContext(t.sql, orderId))!.items[0]!.withdrawn, 0, "rejected statement no longer counts");
  assert.equal((await t.sql`select 1 from public.admin_activity_log where action = 'withdrawal.status' and entity_id = ${orderId}`).length, 1);

  const second = await submitWithdrawal(t.sql, { orderId, fullName: "B", confirmationEmail: "b@test.local", reason: null, items: [{ orderItemId: item.id, quantity: 2 }] });
  assert.equal(second.wholeOrder, true);
});

test("expired period and unpaid orders are refused", async () => {
  const orderId = await paidOrder([{ sku: "MOCK-OLIVE-OIL-1", qty: 1 }]);
  // Walk the real path to "delivered" (paid → processing → submitted → accepted → shipped → delivered).
  for (const to of ["processing", "submitted_to_supplier", "supplier_accepted"] as const) await adminTransition(t.sql, admin, orderId, to, "test", { supplierOrderRef: "SUP-W1" });
  await addShipment(t.sql, admin, orderId, { carrier: "TestCarrier", trackingNumber: "TRKW1", markShipped: true });
  const [sh] = await t.sql<{ id: string }[]>`select id from public.shipments where order_id = ${orderId}`;
  await updateShipmentStatus(t.sql, admin, sh!.id, "delivered");
  const ctxNow = (await loadWithdrawalContext(t.sql, orderId))!;
  assert.equal(ctxNow.status, "delivered");
  assert.equal(ctxNow.block, null, "open right after delivery");
  assert.ok(ctxNow.window.deadline, "deadline known once delivered");
  const later = new Date(Date.now() + 20 * 86_400_000);
  assert.equal((await loadWithdrawalContext(t.sql, orderId, later))!.block, "expired");
  await assert.rejects(submitWithdrawal(t.sql, { orderId, fullName: "C", confirmationEmail: "c@test.local", reason: null, items: [{ orderItemId: ctxNow.items[0]!.id, quantity: 1 }] }, later), /ended/);
  const unpaid = await createOrder(t.sql, { email: "u@test.local", lines: [{ variantId: await variantBySku(t.sql, "MOCK-OLIVE-OIL-1"), quantity: 1 }], shipTo: IT_ADDRESS, shippingMethodId: euMethod, idempotencyKey: "wd-unpaid", isTest: true });
  assert.equal((await loadWithdrawalContext(t.sql, unpaid.orderId))!.block, "not_paid");
});
