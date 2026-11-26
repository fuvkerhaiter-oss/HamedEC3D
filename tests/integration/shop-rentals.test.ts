/** Shop rentals on a real Postgres: hold → verified webhook → active, double booking, renewal, expiry, refund. */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createDevPaymentSimulator } from "../../src/lib/payments/dev-simulator";
import { pgWebhookStore } from "../../src/lib/payments/pg-store";
import { handlePaymentWebhook } from "../../src/lib/payments/webhook";
import { cancelLease, getLease, getShopStates, queueRentalReminders, RentalError, startRentalCheckout } from "../../src/lib/rentals/service";
import type { RentalBooking } from "../../src/lib/rentals/schema";
import type { Tx } from "../../src/lib/db/client";
import { startTestDb, type TestDb } from "./helpers";

let t: TestDb;
before(async () => {
  t = await startTestDb("rentals");
});
after(() => t.close());

const sim = createDevPaymentSimulator({ secret: "integration-test-secret-123", baseUrl: "http://localhost", env: "test" });
const opts = { provider: sim, siteUrl: "http://localhost" };
let n = 0;
const booking = (o: Partial<RentalBooking> = {}): RentalBooking => ({
  shopId: "shop-1", plan: "monthly", currency: "USD", brandName: `Brand ${++n}`, contactName: "Test Tenant", email: `t${n}@test.local`,
  category: "Pets", description: "Handmade dog toys and treats.", country: "IT", acceptTerms: true,
  phone: undefined, website: undefined, companyName: undefined, vatId: undefined, ...o,
});

async function pay(leaseId: string, amount: number, currency: "USD" | "EUR" = "USD", type: "payment.succeeded" | "payment.expired" = "payment.succeeded") {
  const [l] = await t.sql<{ provider_session_id: string }[]>`select provider_session_id from public.shop_leases where id = ${leaseId}`;
  const hook = sim.buildWebhook({ type, orderId: `lease_${leaseId}`, providerPaymentId: `sim_pi_${leaseId}`, amount: { amount, currency }, providerSessionId: l!.provider_session_id });
  return t.sql.begin((tx) => handlePaymentWebhook(sim, hook.rawBody, hook.headers, pgWebhookStore(tx as unknown as Tx, { isTest: true })));
}

test("booking holds the shop; the verified webhook activates it, emails the tenant and alerts the team", async () => {
  const r = await startRentalCheckout(t.sql, { kind: "new", booking: booking() }, opts);
  assert.match(r.reference, /^RS-[0-9A-Z]{6}$/);
  assert.equal((await getShopStates(t.sql)).find((s) => s.shopId === "shop-1")!.state, "held");
  await assert.rejects(startRentalCheckout(t.sql, { kind: "new", booking: booking() }, opts), RentalError);

  const res = await pay(r.leaseId, 2000);
  assert.deepEqual(res, { status: "rental", leaseId: r.leaseId, leaseStatus: "active", changed: true });
  const l = (await getLease(t.sql, r.leaseId))!;
  assert.equal(l.status, "active");
  assert.equal(l.amount, 2000);
  assert.ok(l.starts_at && l.ends_at && l.ends_at > l.starts_at);
  const st = (await getShopStates(t.sql)).find((s) => s.shopId === "shop-1")!;
  assert.equal(st.state, "rented");
  assert.equal(st.state === "rented" && st.brand, null); // sign waits for approval
  assert.equal((await t.sql`select 1 from public.email_outbox where dedupe_key = ${`rental-confirmed:${r.leaseId}`}`).length, 1);
  assert.equal((await t.sql`select 1 from public.admin_notifications where kind = 'rental_paid'`).length, 1);
  assert.deepEqual(await pay(r.leaseId, 2000), { status: "rental", leaseId: r.leaseId, leaseStatus: "active", changed: false }); // replay: no double activation
  assert.equal((await getLease(t.sql, r.leaseId))!.ends_at!.getTime(), l.ends_at!.getTime());
});

test("wrong amount → payment review, never active", async () => {
  const r = await startRentalCheckout(t.sql, { kind: "new", booking: booking({ shopId: "shop-2", plan: "yearly", currency: "EUR" }) }, opts);
  assert.equal((await pay(r.leaseId, 100, "EUR")).status, "rental");
  assert.equal((await getLease(t.sql, r.leaseId))!.status, "payment_review");
  await cancelLease(t.sql, r.leaseId, { refund: 100, reason: "test", getProvider: () => sim });
  assert.equal((await getLease(t.sql, r.leaseId))!.refunded_amount, 100);
});

test("expired payment page releases the shop; a renewal starts after the current term", async () => {
  const r = await startRentalCheckout(t.sql, { kind: "new", booking: booking({ shopId: "shop-3" }) }, opts);
  await pay(r.leaseId, 2000, "USD", "payment.expired");
  assert.equal((await getLease(t.sql, r.leaseId))!.status, "expired_unpaid");
  assert.equal((await getShopStates(t.sql)).find((s) => s.shopId === "shop-3")!.state, "available");

  const a = await startRentalCheckout(t.sql, { kind: "new", booking: booking({ shopId: "shop-3", plan: "quarterly" }) }, opts);
  await pay(a.leaseId, 5400);
  const first = (await getLease(t.sql, a.leaseId))!;
  const renew = await startRentalCheckout(t.sql, { kind: "renew", leaseId: a.leaseId, plan: "yearly", currency: "USD" }, opts);
  await pay(renew.leaseId, 15000);
  const second = (await getLease(t.sql, renew.leaseId))!;
  assert.equal(second.status, "active");
  assert.equal(second.starts_at!.getTime(), first.ends_at!.getTime());
  const st = (await getShopStates(t.sql)).find((s) => s.shopId === "shop-3")!;
  assert.equal(st.state === "rented" && st.until.getTime(), second.ends_at!.getTime());

  // Reminder: only for leases ending within 7 days and not extended.
  await t.sql`update public.shop_leases set starts_at = now() - interval '80 days', ends_at = now() + interval '3 days' where id = ${a.leaseId}`;
  assert.equal(await queueRentalReminders(t.sql), 0); // extended → no reminder
});

test("cancel with full refund frees the shop", async () => {
  const r = await startRentalCheckout(t.sql, { kind: "new", booking: booking({ shopId: "shop-4" }) }, opts);
  await pay(r.leaseId, 2000);
  const l = await cancelLease(t.sql, r.leaseId, { refund: 2000, reason: "Brand declined", getProvider: () => sim });
  assert.equal(l.status, "refunded");
  assert.equal((await getShopStates(t.sql)).find((s) => s.shopId === "shop-4")!.state, "available");
  await assert.rejects(cancelLease(t.sql, r.leaseId, { refund: 0, reason: "again" }), RentalError);
});
