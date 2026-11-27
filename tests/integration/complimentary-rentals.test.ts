/** Complimentary (free) shop rentals given by a super admin, on a real Postgres: no payment, same shop lock rules. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { createDevPaymentSimulator } from "../../src/lib/payments/dev-simulator";
import {
  cancelLease, COMPLIMENTARY_PROVIDER, getLease, getShopStates, grantComplimentaryLease, RentalError, startRentalCheckout, type ComplimentaryGrant,
} from "../../src/lib/rentals/service";
import { addMonths } from "../../src/lib/rentals/pricing";
import { ensureTenant, currentLease } from "../../src/lib/tenants/service";
import { startTestDb, type TestDb } from "./helpers";

let t: TestDb;
before(async () => {
  t = await startTestDb("comp-rentals");
});
after(() => t.close());

const sim = createDevPaymentSimulator({ secret: "integration-test-secret-123", baseUrl: "http://localhost", env: "test" });
const grant = (o: Partial<ComplimentaryGrant> = {}): ComplimentaryGrant => ({
  shopId: "shop-1", email: "Owner@Test.local", months: 1, currency: "USD", brandName: "Owner Test Brand", contactName: "Owner", country: "US", note: "owner test", ...o,
});
const state = async (shopId: string) => (await getShopStates(t.sql)).find((s) => s.shopId === shopId)!.state;

test("a free rental is active at once, amount 0, no payment provider session, and emails the renter", async () => {
  const now = new Date();
  const l = await grantComplimentaryLease(t.sql, grant(), { grantedBy: "Super Admin", now });
  assert.equal(l.status, "active");
  assert.equal(l.amount, 0);
  assert.equal(l.fee_amount, 0);
  assert.equal(l.provider, COMPLIMENTARY_PROVIDER);
  assert.equal(l.provider_session_id, null);
  assert.equal(l.provider_payment_id, null);
  assert.equal(l.paid_at, null);
  assert.equal(l.email, "owner@test.local");
  assert.equal(l.starts_at!.getTime(), now.getTime());
  assert.equal(l.ends_at!.getTime(), addMonths(now, 1).getTime());
  assert.match(l.admin_note!, /Complimentary rental given by Super Admin/);
  assert.equal(await state("shop-1"), "rented");
  const [mail] = await t.sql<{ body_text: string }[]>`select body_text from public.email_outbox where dedupe_key = ${`rental-confirmed:${l.id}`}`;
  assert.match(mail!.body_text, /Free \(complimentary rental\)/);

  // Revenue stays honest: a free lease adds nothing.
  const [rev] = await t.sql<{ n: number }[]>`select coalesce(sum(amount), 0)::int as n from public.shop_leases where paid_at is not null`;
  assert.equal(rev!.n, 0);
});

test("the renter's verified email claims it: /seller sees a tenant with a running lease", async () => {
  const userId = randomUUID();
  const got = await ensureTenant(t.sql, userId, "owner@test.local");
  assert.ok(got, "tenant created from the free lease");
  assert.equal(got.tenant.brand_name, "Owner Test Brand");
  assert.equal(currentLease(got.leases)?.shop_id, "shop-1");
});

test("same shop lock rules as a paid booking: no free rental on a rented or held shop", async () => {
  await assert.rejects(grantComplimentaryLease(t.sql, grant(), { grantedBy: "x" }), RentalError); // shop-1 rented above
  await startRentalCheckout(t.sql, { kind: "new", booking: {
    shopId: "shop-2", plan: "monthly", currency: "USD", brandName: "Payer", contactName: "Payer", email: "payer@test.local",
    category: "Pets", description: "Handmade dog toys and treats.", country: "IT", acceptTerms: true,
    phone: undefined, website: undefined, companyName: undefined, vatId: undefined,
  } }, { provider: sim, siteUrl: "http://localhost" });
  await assert.rejects(grantComplimentaryLease(t.sql, grant({ shopId: "shop-2" }), { grantedBy: "x" }), /paying/);
});

test("concurrent grants of one shop: only one wins (advisory lock)", async () => {
  const res = await Promise.allSettled([1, 2, 3].map(() => grantComplimentaryLease(t.sql, grant({ shopId: "shop-3" }), { grantedBy: "x" })));
  assert.equal(res.filter((r) => r.status === "fulfilled").length, 1);
});

test("months are bounded and cancelling a free rental frees the shop (cancelled, not refunded)", async () => {
  await assert.rejects(grantComplimentaryLease(t.sql, grant({ shopId: "shop-4", months: 0 }), { grantedBy: "x" }), RentalError);
  await assert.rejects(grantComplimentaryLease(t.sql, grant({ shopId: "shop-4", months: 13 }), { grantedBy: "x" }), RentalError);
  const l = await grantComplimentaryLease(t.sql, grant({ shopId: "shop-4", months: 12 }), { grantedBy: "x" });
  assert.equal(l.plan, "yearly");
  const c = await cancelLease(t.sql, l.id, { refund: 0, reason: "test over" });
  assert.equal(c.status, "cancelled");
  assert.equal(await state("shop-4"), "available");
  await assert.rejects(cancelLease(t.sql, (await grantComplimentaryLease(t.sql, grant({ shopId: "shop-4" }), { grantedBy: "x" })).id, { refund: 100, reason: "x" }), /no payment to refund/);
  assert.ok(await getLease(t.sql, l.id));
});

test("the database still refuses a zero amount for any lease that isn't complimentary", async () => {
  await assert.rejects(
    t.sql`insert into public.shop_leases (reference, shop_id, plan, months, currency, amount, regular_amount, status, brand_name, contact_name, email,
            category, description, country, terms_accepted_at, hold_expires_at, provider)
          values ('RS-ZZZZZZ', 'shop-1', 'monthly', 1, 'USD', 0, 0, 'pending_payment', 'Free?', 'Nope', 'n@test.local', 'Other',
            'Trying to sneak a zero amount in.', 'US', now(), now(), 'stripe')`,
    /shop_leases_amount_check/,
  );
});
