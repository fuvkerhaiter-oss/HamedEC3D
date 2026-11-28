import assert from "node:assert/strict";
import { test } from "node:test";
import { marketCountries } from "../../src/lib/markets";
import { parseRateTiers, parseZoneCountries, quoteShipping, shippingCoverage, type ShippingMethodConfig, type ShippingZoneConfig } from "../../src/lib/shipping/quote";

const method = (over: Partial<ShippingMethodConfig> = {}): ShippingMethodConfig => ({
  id: "m1", name: "Standard", carrier: null, rateType: "fixed", currency: "EUR", fixedAmount: 590, freeOverAmount: null,
  minDays: null, maxDays: null, isActive: true, rates: [], ...over,
});
const zone = (over: Partial<ShippingZoneConfig> = {}): ShippingZoneConfig => ({ id: "z1", name: "Italy", countries: ["IT"], isActive: true, methods: [method()], ...over });

test("no zones → nothing is shippable, with the reason", () => {
  const c = shippingCoverage([], marketCountries());
  assert.equal(c.length, 28);
  assert.ok(c.every((x) => !x.shippable && x.problem?.includes("no active shipping zone")));
});

test("a zone priced in the wrong currency is reported (the production failure mode)", () => {
  const zones = [zone({ name: "USA", countries: ["US"], methods: [method({ currency: "EUR" })] })];
  const [us] = shippingCoverage(zones, [{ country: "US", currency: "USD" }]);
  assert.equal(us!.shippable, false);
  assert.match(us!.problem!, /EUR only; customers here pay in USD/);
  assert.deepEqual(quoteShipping(zones, { country: "US", currency: "USD", subtotal: 1000, weightGrams: 0 }), []);
});

test("inactive zone / method, and a method with no price, are not shippable; a real zone is", () => {
  assert.equal(shippingCoverage([zone({ isActive: false })], [{ country: "IT", currency: "EUR" }])[0]!.shippable, false);
  assert.equal(shippingCoverage([zone({ methods: [method({ isActive: false })] })], [{ country: "IT", currency: "EUR" }])[0]!.shippable, false);
  assert.equal(shippingCoverage([zone({ methods: [method({ rateType: "weight", rates: [] })] })], [{ country: "IT", currency: "EUR" }])[0]!.shippable, false);
  const c = shippingCoverage([zone({ countries: ["IT", "FR"] })], marketCountries());
  assert.deepEqual(c.filter((x) => x.shippable).map((x) => x.country).sort(), ["FR", "IT"]);
});

test("admin tier text: weight tiers in whole grams are accepted (regression: every weight tier was refused)", () => {
  assert.deepEqual(parseRateTiers("0-2000: 6.90\n2000-: 9.5", "weight", "EUR"), [
    { minValue: 0, maxValue: 2000, amount: 690 },
    { minValue: 2000, maxValue: null, amount: 950 },
  ]);
  assert.throws(() => parseRateTiers("0-1.5: 6.90", "weight", "EUR"), /whole grams/);
});

test("admin tier text: order-value tiers are exact money, bad lines are refused", () => {
  assert.deepEqual(parseRateTiers(" 0-49.99: 7.99 \r\n\n50-: 0", "order_value", "USD"), [
    { minValue: 0, maxValue: 4999, amount: 799 },
    { minValue: 5000, maxValue: null, amount: 0 },
  ]);
  assert.throws(() => parseRateTiers("0-49.999: 7.99", "order_value", "EUR"), /2 decimals/);
  assert.throws(() => parseRateTiers("cheap: 1", "weight", "EUR"), /must look like/);
  assert.throws(() => parseRateTiers("0-100: -1", "weight", "EUR"), /must look like/);
});

test("zone countries: market codes kept, unknown codes reported instead of silently dropped", () => {
  const allowed = marketCountries().map((c) => c.country);
  assert.deepEqual(parseZoneCountries("it, fr;DE  it", allowed), { countries: ["IT", "FR", "DE"], unknown: [] });
  assert.deepEqual(parseZoneCountries("IT UK EL", allowed), { countries: ["IT"], unknown: ["UK", "EL"] });
});
