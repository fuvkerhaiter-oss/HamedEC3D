import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { allShopStates, canActivate, leaseStart, shopState, type LeaseLite } from "../../src/lib/rentals/availability";
import { addMonths, discountPercent, LAUNCH_PROMO, quotePlan } from "../../src/lib/rentals/pricing";
import { ComplimentaryGrantInput, RentalBookingBody } from "../../src/lib/rentals/schema";
import { complimentaryPlan } from "../../src/lib/rentals/service";
import { leaseIdFromEvent } from "../../src/lib/rentals/webhook";
import { leaseToken, verifyLeaseToken, orderToken } from "../../src/lib/checkout/order-link";

const D = (s: string) => new Date(s);
const NOW = D("2026-12-01T12:00:00Z");
const lease = (o: Partial<LeaseLite>): LeaseLite => ({
  id: "a", shopId: "shop-1", status: "active", startsAt: D("2026-11-01T00:00:00Z"), endsAt: D("2027-01-01T00:00:00Z"),
  holdExpiresAt: D("2026-11-01T00:30:00Z"), displayName: "Acme", displayApproved: true, ...o,
});

describe("rental pricing", () => {
  it("launch prices: $20 / $54 / $150 with honest, rounded-down discounts", () => {
    const m = quotePlan("monthly", "USD", NOW), q = quotePlan("quarterly", "USD", NOW), y = quotePlan("yearly", "EUR", NOW);
    assert.deepEqual([m.amount, q.amount, y.amount], [2000, 5400, 15000]);
    assert.deepEqual([m.regularAmount, q.regularAmount, y.regularAmount], [2900, 7900, 29000]);
    assert.deepEqual([m.discountPercent, q.discountPercent, y.discountPercent], [31, 31, 48]);
    assert.equal(y.perMonth, 1250);
    assert.equal(y.savingVsMonthly, 37); // 150 vs 12 × 20
    assert.equal(discountPercent(300, 200), 33); // 33.3 → 33, never rounded up
  });

  it("after the launch offer ends the regular price is charged and no discount is shown", () => {
    const after = new Date(Date.parse(LAUNCH_PROMO.endsAt) + 1000);
    const y = quotePlan("yearly", "USD", after);
    assert.partialDeepStrictEqual(y, { amount: 29000, promo: false, discountPercent: 0, promoEndsAt: null });
  });

  it("adds calendar months, clamping to the month end", () => {
    assert.equal(addMonths(D("2027-01-31T10:00:00Z"), 1).toISOString(), "2027-02-28T10:00:00.000Z");
    assert.equal(addMonths(D("2026-12-15T00:00:00Z"), 12).toISOString(), "2027-12-15T00:00:00.000Z");
    assert.equal(addMonths(D("2026-11-30T00:00:00Z"), 3).toISOString(), "2027-02-28T00:00:00.000Z");
  });
});

describe("rental availability", () => {
  it("rented / held / available, brand only once approved", () => {
    assert.partialDeepStrictEqual(shopState("shop-1", [lease({})], NOW), { state: "rented", brand: "Acme" });
    assert.partialDeepStrictEqual(shopState("shop-1", [lease({ displayApproved: false })], NOW), { state: "rented", brand: null });
    assert.equal(shopState("shop-1", [lease({ status: "pending_payment", startsAt: null, endsAt: null, holdExpiresAt: D("2026-12-01T12:20:00Z") })], NOW).state, "held");
    assert.equal(shopState("shop-1", [lease({ status: "pending_payment", startsAt: null, endsAt: null, holdExpiresAt: D("2026-12-01T11:00:00Z") })], NOW).state, "available");
    assert.equal(shopState("shop-1", [lease({ endsAt: D("2026-12-01T11:59:00Z") })], NOW).state, "available");
    assert.equal(allShopStates([], NOW).every((s) => s.state === "available"), true);
  });

  it("paid-ahead renewals extend 'until' and a renewal starts after the current term", () => {
    const cur = lease({});
    const next = lease({ id: "b", startsAt: D("2027-01-01T00:00:00Z"), endsAt: D("2027-04-01T00:00:00Z") });
    const st = shopState("shop-1", [cur, next], NOW);
    assert.equal(st.state === "rented" && st.until.toISOString(), "2027-04-01T00:00:00.000Z");
    assert.equal(leaseStart("shop-1", [cur, next], NOW, true).toISOString(), "2027-04-01T00:00:00.000Z");
    assert.equal(leaseStart("shop-1", [cur], NOW, false), NOW);
  });

  it("a new tenant can't be activated over a paid tenant", () => {
    const mine = lease({ id: "new", status: "pending_payment", startsAt: null, endsAt: null });
    assert.equal(canActivate(mine, [lease({}), mine], NOW, false), false);
    assert.equal(canActivate(mine, [mine], NOW, false), true);
    assert.equal(canActivate(mine, [lease({})], NOW, true), true);
  });
});

describe("rental booking + links", () => {
  const valid = {
    shopId: "shop-2", plan: "yearly", currency: "EUR", brandName: "Corgi Co", contactName: "Ana Test", email: "ANA@example.com",
    category: "Pets", description: "Handmade toys and treats for happy dogs.", country: "it", acceptTerms: true, amount: 1,
  };
  it("validates and strips client prices", () => {
    const r = RentalBookingBody.safeParse(valid);
    assert.equal(r.success, true);
    assert.partialDeepStrictEqual(r.success && r.data, { email: "ana@example.com", country: "IT" });
    assert.equal(r.success && "amount" in r.data, false);
    assert.equal(RentalBookingBody.safeParse({ ...valid, shopId: "shop-99" }).success, false);
    assert.equal(RentalBookingBody.safeParse({ ...valid, acceptTerms: false }).success, false);
    assert.equal(RentalBookingBody.safeParse({ ...valid, website: "javascript:alert(1)" }).success, false);
  });

  it("lease tokens are separate from order tokens", () => {
    const id = "6f1d1c3e-2b7a-4c55-9a1e-0c9b8d7e6f50";
    assert.equal(verifyLeaseToken(id, leaseToken(id)), true);
    assert.equal(verifyLeaseToken(id, orderToken(id)), false);
    assert.equal(leaseIdFromEvent({ orderId: `lease_${id}` }), id);
    assert.equal(leaseIdFromEvent({ orderId: id }), null);
  });
});

describe("complimentary (free) rentals", () => {
  const base = { shopId: "shop-1", email: " Owner@Example.COM ", months: "1", currency: "USD", brandName: "Brand", contactName: "Owner", country: "us" };
  it("form input: email lowercased, months coerced, a sent amount is stripped (always free)", () => {
    const r = ComplimentaryGrantInput.parse({ ...base, amount: "2000", note: "" });
    assert.equal(r.email, "owner@example.com");
    assert.equal(r.months, 1);
    assert.equal(r.country, "US");
    assert.equal(r.note, null);
    assert.equal("amount" in r, false);
  });
  it("rejects unknown shops and months outside 1–12", () => {
    for (const bad of [{ shopId: "shop-99" }, { months: "0" }, { months: "13" }, { months: "1.5" }, { email: "nope" }]) {
      assert.equal(ComplimentaryGrantInput.safeParse({ ...base, ...bad }).success, false, JSON.stringify(bad));
    }
  });
  it("stores the nearest plan by length", () => {
    assert.deepEqual([1, 2, 3, 11, 12].map(complimentaryPlan), ["monthly", "monthly", "quarterly", "quarterly", "yearly"]);
  });
});
