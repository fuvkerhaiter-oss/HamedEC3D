/** Shop renter dashboards on a real Postgres: claim by email, own products only, store visibility, clicks, fee. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { createDevPaymentSimulator } from "../../src/lib/payments/dev-simulator";
import { pgWebhookStore } from "../../src/lib/payments/pg-store";
import { handlePaymentWebhook } from "../../src/lib/payments/webhook";
import { getLease, startRentalCheckout } from "../../src/lib/rentals/service";
import type { RentalBooking } from "../../src/lib/rentals/schema";
import {
  buyTarget,
  createProduct,
  deleteProduct,
  ensureTenant,
  getOwnProduct,
  loadStorefronts,
  setMonthlyFee,
  setProductHidden,
  setStorefrontOpen,
  setSuspended,
  tenantStats,
  TenantError,
  loadSignFonts,
  updateProduct,
  updateProfile,
} from "../../src/lib/tenants/service";
import { ProfileInput } from "../../src/lib/tenants/schema";
import type { Tx } from "../../src/lib/db/client";
import { startTestDb, type TestDb } from "./helpers";

let t: TestDb;
before(async () => {
  t = await startTestDb("tenants");
});
after(() => t.close());

const sim = createDevPaymentSimulator({ secret: "integration-test-secret-123", baseUrl: "http://localhost", env: "test" });
const opts = { provider: sim, siteUrl: "http://localhost" };
const booking = (o: Partial<RentalBooking>): RentalBooking => ({
  shopId: "shop-2", plan: "monthly", currency: "EUR", brandName: "Doggo", contactName: "Test Tenant", email: "doggo@test.local",
  category: "Pets", description: "Handmade dog toys and treats.", country: "IT", acceptTerms: true,
  phone: undefined, website: undefined, companyName: undefined, vatId: undefined, ...o,
});

async function pay(leaseId: string, amount: number) {
  const [l] = await t.sql<{ provider_session_id: string }[]>`select provider_session_id from public.shop_leases where id = ${leaseId}`;
  const hook = sim.buildWebhook({ type: "payment.succeeded", orderId: `lease_${leaseId}`, providerPaymentId: `sim_pi_${leaseId}`, amount: { amount, currency: "EUR" }, providerSessionId: l!.provider_session_id });
  return t.sql.begin((tx) => handlePaymentWebhook(sim, hook.rawBody, hook.headers, pgWebhookStore(tx as unknown as Tx, { isTest: true })));
}

const product = { title: "Rope toy", description: null, price: 1990, currency: "EUR" as const, paymentUrl: "https://buy.stripe.com/test_1", publish: true };

test("a lease booked signed-out is claimed by verified email; the tenant's shop shows only when paid + opened", async () => {
  const userId = randomUUID();
  assert.equal(await ensureTenant(t.sql, userId, "nobody@test.local"), null, "no lease, no tenant");

  const r = await startRentalCheckout(t.sql, { kind: "new", booking: booking({}) }, opts);
  const got = await ensureTenant(t.sql, userId, "DOGGO@test.local");
  assert.ok(got);
  assert.equal(got.tenant.brand_name, "Doggo");
  assert.equal((await getLease(t.sql, r.leaseId))!.user_id, userId);

  const p = await createProduct(t.sql, got.tenant.id, product);
  assert.deepEqual(await loadStorefronts(t.sql), {}, "not paid, not open");
  await pay(r.leaseId, 2000);
  assert.deepEqual(await loadStorefronts(t.sql), {}, "paid but not opened");
  await setStorefrontOpen(t.sql, got.tenant.id, true);
  const sf = (await loadStorefronts(t.sql))["shop-2"];
  assert.ok(sf);
  assert.equal(sf.products[0]!.buyHost, "buy.stripe.com");

  // Buy click → the tenant's link, counted.
  assert.equal(await buyTarget(t.sql, p.id), "https://buy.stripe.com/test_1");
  assert.equal((await tenantStats(t.sql, got.tenant.id)).clicks30, 1);

  // Admin moderation hides it; suspension hides the whole shop and its links.
  await setProductHidden(t.sql, p.id, true, "Not allowed");
  assert.equal((await loadStorefronts(t.sql))["shop-2"]!.products.length, 0);
  assert.equal(await buyTarget(t.sql, p.id), null);
  await setProductHidden(t.sql, p.id, false, null);
  await setSuspended(t.sql, got.tenant.id, true, "Check");
  assert.deepEqual(await loadStorefronts(t.sql), {});
  await setSuspended(t.sql, got.tenant.id, false, null);

  // Another tenant can't read or change this tenant's product.
  const other = randomUUID();
  await startRentalCheckout(t.sql, { kind: "new", booking: booking({ shopId: "shop-3", email: "cat@test.local", brandName: "Catto" }) }, opts);
  const o = (await ensureTenant(t.sql, other, "cat@test.local"))!;
  assert.equal(await getOwnProduct(t.sql, o.tenant.id, p.id), null);
  await assert.rejects(updateProduct(t.sql, o.tenant.id, p.id, product), TenantError);
  await assert.rejects(deleteProduct(t.sql, o.tenant.id, p.id), TenantError);
  assert.ok(await getOwnProduct(t.sql, got.tenant.id, p.id));

  // The monthly fee is added to the next rent payment (× months) and recorded on the lease.
  await setMonthlyFee(t.sql, got.tenant.id, 500);
  const renew = await startRentalCheckout(t.sql, { kind: "renew", leaseId: r.leaseId, plan: "quarterly", currency: "EUR" }, opts);
  const l = (await getLease(t.sql, renew.leaseId))!;
  assert.equal(l.fee_amount, 1500);
  assert.equal(l.user_id, userId, "renewal stays on the tenant's account");
  assert.ok(l.amount >= 1500 && l.regular_amount >= l.amount);
});

test("sign font: the brand form saves the chosen typeface and the 3D store reads it", async () => {
  const userId = randomUUID();
  const r = await startRentalCheckout(t.sql, { kind: "new", booking: booking({ shopId: "shop-4", email: "font@test.local", brandName: "Fonty" }) }, opts);
  await pay(r.leaseId, 2000);
  const got = (await ensureTenant(t.sql, userId, "font@test.local"))!;
  assert.equal(got.tenant.sign_font, "bricolage", "house style by default");
  // Exactly what the seller form posts (hidden fields as empty strings), through the same validation.
  const form = {
    brandName: "Fonty", signName: "Fonty", tagline: "", about: "", accentColor: "#ff5b2e", signFont: "bangers",
    website: "", instagram: "", tiktok: "", contactEmail: "", contactPhone: "", defaultPaymentUrl: "",
  };
  const parsed = ProfileInput([]).safeParse(form);
  assert.ok(parsed.success, JSON.stringify(!parsed.success && parsed.error.issues));
  await updateProfile(t.sql, got.tenant, parsed.data);
  const [row] = await t.sql<{ sign_font: string }[]>`select sign_font from public.tenant_accounts where id = ${got.tenant.id}`;
  assert.equal(row!.sign_font, "bangers");
  assert.equal((await loadSignFonts(t.sql))["shop-4"], "bangers");
  assert.ok(!ProfileInput([]).safeParse({ ...form, signFont: "comic-sans" }).success, "unknown fonts are refused");
});
