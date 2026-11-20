import assert from "node:assert/strict";
import { test } from "node:test";
import { quoteShipping, tierProblem, type ShippingZoneConfig } from "../../src/lib/shipping/quote";
import { splitOrderBySupplier } from "../../src/lib/suppliers/split";
import { validateCoupon, type CouponRecord } from "../../src/lib/coupons/validate";

const zones: ShippingZoneConfig[] = [
  {
    id: "eu", name: "EU", countries: ["IT", "FR"], isActive: true,
    methods: [
      { id: "std", name: "Standard", carrier: null, rateType: "fixed", currency: "EUR", fixedAmount: 490, freeOverAmount: 5000, minDays: 2, maxDays: 5, isActive: true, rates: [] },
      { id: "kg", name: "By weight", carrier: "DHL", rateType: "weight", currency: "EUR", fixedAmount: null, freeOverAmount: null, minDays: 1, maxDays: 2, isActive: true,
        rates: [{ minValue: 0, maxValue: 2000, amount: 690 }, { minValue: 2000, maxValue: 10000, amount: 1290 }] },
      { id: "usd-only", name: "USD", carrier: null, rateType: "fixed", currency: "USD", fixedAmount: 100, freeOverAmount: null, minDays: null, maxDays: null, isActive: true, rates: [] },
      { id: "off", name: "Off", carrier: null, rateType: "fixed", currency: "EUR", fixedAmount: 1, freeOverAmount: null, minDays: null, maxDays: null, isActive: false, rates: [] },
    ],
  },
  { id: "us", name: "US", countries: ["US"], isActive: true, methods: [
    { id: "val", name: "Ground", carrier: null, rateType: "order_value", currency: "USD", fixedAmount: null, freeOverAmount: null, minDays: 3, maxDays: 7, isActive: true,
      rates: [{ minValue: 0, maxValue: 5000, amount: 799 }, { minValue: 5000, maxValue: null, amount: 0 }] },
  ] },
  { id: "dead", name: "Inactive", countries: ["DE"], isActive: false, methods: [] },
];

test("shipping: fixed, weight tiers, free threshold, currency, zones", () => {
  const it = quoteShipping(zones, { country: "it", currency: "EUR", subtotal: 1000, weightGrams: 2500 });
  assert.deepEqual(it.map((o) => [o.methodId, o.amount.amount]), [["std", 490], ["kg", 1290]]);
  const free = quoteShipping(zones, { country: "FR", currency: "EUR", subtotal: 5000, weightGrams: 100 });
  assert.equal(free.find((o) => o.methodId === "std")!.isFree, true);
  assert.equal(quoteShipping(zones, { country: "IT", currency: "EUR", subtotal: 0, weightGrams: 20000 }).some((o) => o.methodId === "kg"), false, "no tier → unavailable");
  assert.deepEqual(quoteShipping(zones, { country: "US", currency: "USD", subtotal: 4999, weightGrams: 0 }).map((o) => o.amount.amount), [799]);
  assert.deepEqual(quoteShipping(zones, { country: "US", currency: "USD", subtotal: 5000, weightGrams: 0 }).map((o) => o.amount.amount), [0]);
  assert.deepEqual(quoteShipping(zones, { country: "DE", currency: "EUR", subtotal: 1, weightGrams: 1 }), [], "inactive zone");
  assert.deepEqual(quoteShipping(zones, { country: "JP", currency: "EUR", subtotal: 1, weightGrams: 1 }), []);
  assert.equal(tierProblem([{ minValue: 0, maxValue: 100, amount: 1 }, { minValue: 50, maxValue: null, amount: 1 }]), "Tiers overlap");
  assert.equal(tierProblem([{ minValue: 0, maxValue: null, amount: 1 }, { minValue: 50, maxValue: 60, amount: 1 }]), "Tiers overlap");
  assert.equal(tierProblem([{ minValue: 0, maxValue: 100, amount: 1 }, { minValue: 100, maxValue: null, amount: 0 }]), null);
});

test("supplier split: primary mapping wins, unassigned lines reported, cost totals", () => {
  const r = splitOrderBySupplier(
    [
      { orderItemId: "i1", variantId: "v1", sku: "A", quantity: 2 },
      { orderItemId: "i2", variantId: "v2", sku: "B", quantity: 1 },
      { orderItemId: "i3", variantId: "v3", sku: "C", quantity: 1 },
      { orderItemId: "i4", variantId: null, sku: "D", quantity: 1 },
    ],
    [
      { variantId: "v1", supplierId: "s1", supplierSku: "S1-A", costAmount: 100, costCurrency: "EUR", isPrimary: false },
      { variantId: "v1", supplierId: "s2", supplierSku: "S2-A", costAmount: 90, costCurrency: "EUR", isPrimary: true },
      { variantId: "v2", supplierId: "s1", supplierSku: "S1-B", costAmount: 300, costCurrency: "EUR", isPrimary: true },
      { variantId: "v3", supplierId: "s1", supplierSku: "S1-C", costAmount: 50, costCurrency: "USD", isPrimary: true },
    ],
  );
  assert.deepEqual(r.groups.map((g) => [g.supplierId, g.lines.map((l) => l.supplierSku)]), [["s1", ["S1-B", "S1-C"]], ["s2", ["S2-A"]]]);
  assert.equal(r.groups[1]!.costTotal!.amount, 180);
  assert.equal(r.groups[0]!.costTotal, null, "mixed currencies → no single total");
  assert.deepEqual(r.unassigned.map((l) => l.orderItemId), ["i4"]);
});

const base: CouponRecord = {
  id: "c", code: "save10", kind: "percent", basisPoints: 1000, amount: null, currency: null, minSubtotal: null, startsAt: null, endsAt: null,
  maxRedemptions: null, redemptionCount: 0, perCustomerLimit: null, customerRedemptions: 0, isActive: true, appliesTo: "all", targetIds: [],
};
const ctx = { currency: "EUR" as const, now: new Date("2026-06-01"), lines: [{ productId: "p1", categoryId: "k1", lineTotal: 2000 }, { productId: "p2", categoryId: "k2", lineTotal: 1000 }] };

test("coupons: validity windows, limits, currency, targeting", () => {
  const ok = validateCoupon(base, ctx);
  assert.ok(ok.ok && ok.discount.kind === "percent" && ok.discount.code === "SAVE10");
  assert.equal(validateCoupon(null, ctx).ok, false);
  assert.equal(validateCoupon({ ...base, isActive: false }, ctx).ok, false);
  assert.equal(validateCoupon({ ...base, endsAt: new Date("2026-05-01") }, ctx).ok, false);
  assert.equal(validateCoupon({ ...base, startsAt: new Date("2026-07-01") }, ctx).ok, false);
  assert.equal(validateCoupon({ ...base, maxRedemptions: 5, redemptionCount: 5 }, ctx).ok, false);
  assert.equal(validateCoupon({ ...base, perCustomerLimit: 1, customerRedemptions: 1 }, ctx).ok, false);
  assert.equal(validateCoupon({ ...base, minSubtotal: 3001 }, ctx).ok, false);
  assert.equal(validateCoupon({ ...base, kind: "fixed", basisPoints: null, amount: 500, currency: "USD" }, ctx).ok, false);
  const cat = validateCoupon({ ...base, appliesTo: "category", targetIds: ["k2"] }, ctx);
  assert.ok(cat.ok && cat.discount.kind === "fixed" && cat.discount.amount.amount === 100, "10% of the k2 line only");
  const fixed = validateCoupon({ ...base, kind: "fixed", basisPoints: null, amount: 5000, currency: "EUR", appliesTo: "product", targetIds: ["p2"] }, ctx);
  assert.ok(fixed.ok && fixed.discount.kind === "fixed" && fixed.discount.amount.amount === 1000, "capped at eligible subtotal");
  assert.equal(validateCoupon({ ...base, appliesTo: "product", targetIds: ["zzz"] }, ctx).ok, false);
});
