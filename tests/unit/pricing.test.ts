import { test } from "node:test";
import assert from "node:assert/strict";
import { priceCart } from "../../src/lib/cart/pricing";
import { createMockCatalog } from "../../src/lib/catalog/mock-catalog";
import { money } from "../../src/lib/money";

const catalog = createMockCatalog();
const USD = { currency: "USD" as const };

test("prices come from the catalog, not the client", async () => {
  // Extra fields like a client-sent price are ignored by type and by logic.
  const cart = await priceCart([{ variantId: "prod-olive-oil-v1", quantity: 2, price: 1 } as never], catalog, USD);
  assert.equal(cart.subtotal.amount, 1798);
  assert.equal(cart.total.amount, 1798);
  assert.ok(cart.purchasable);
});

test("merges duplicate lines before stock checks", async () => {
  // orange juice has stock 4
  const cart = await priceCart(
    [
      { variantId: "prod-orange-juice-v1", quantity: 3 },
      { variantId: "prod-orange-juice-v1", quantity: 2 },
    ],
    catalog,
    USD,
  );
  assert.equal(cart.issues[0]?.code, "insufficient_stock");
  assert.equal(cart.purchasable, false);
});

test("flags out of stock, unknown and invalid quantities", async () => {
  const cart = await priceCart(
    [
      { variantId: "prod-cold-brew-v1", quantity: 1 },
      { variantId: "nope", quantity: 1 },
      { variantId: "prod-pasta-penne-v1", quantity: 0 },
      { variantId: "prod-dark-chocolate-v1", quantity: 1.5 },
    ],
    catalog,
    USD,
  );
  assert.deepEqual(cart.issues.map((i) => i.code).sort(), ["invalid_quantity", "invalid_quantity", "not_found", "out_of_stock"]);
  assert.equal(cart.lines.length, 0);
  assert.equal(cart.purchasable, false);
});

test("applies discount, shipping and tax in integer math", async () => {
  const cart = await priceCart([{ variantId: "prod-laundry-liquid-v1", quantity: 1 }], catalog, {
    currency: "USD",
    discount: { code: "TEN", kind: "percent", basisPoints: 1000 },
    shipping: { methodId: "std", label: "Standard", amount: money(499, "USD") },
    taxBasisPoints: 700,
  });
  // 1099 - 110 = 989; tax 7% = 69.23 -> 69; total = 989 + 499 + 69
  assert.equal(cart.discount.amount, 110);
  assert.equal(cart.tax.amount, 69);
  assert.equal(cart.total.amount, 1557);
});

test("fixed discount never exceeds subtotal; minSubtotal enforced", async () => {
  const big = await priceCart([{ variantId: "prod-pasta-penne-v1", quantity: 1 }], catalog, {
    currency: "USD",
    discount: { code: "BIG", kind: "fixed", amount: money(10000, "USD") },
  });
  assert.equal(big.total.amount, 0);
  const min = await priceCart([{ variantId: "prod-pasta-penne-v1", quantity: 1 }], catalog, {
    currency: "USD",
    discount: { code: "MIN", kind: "fixed", amount: money(100, "USD"), minSubtotal: money(5000, "USD") },
  });
  assert.equal(min.discount.amount, 0);
});

test("no shipping charged on an empty cart", async () => {
  const cart = await priceCart([], catalog, { currency: "USD", shipping: { methodId: "s", label: "s", amount: money(499, "USD") } });
  assert.equal(cart.total.amount, 0);
  assert.equal(cart.purchasable, false);
});

test("EU inclusive mode reports contained VAT without adding it", async () => {
  const cart = await priceCart([{ variantId: "prod-laundry-liquid-v1", quantity: 1 }], catalog, {
    currency: "EUR",
    taxMode: "inclusive",
    taxBasisPoints: 2200,
    shipping: { methodId: "std", label: "Standard", amount: money(500, "EUR") },
  });
  // gross = 1099 + 500 = 1599; VAT = 1599 * 22/122 = 288.34 -> 288
  assert.equal(cart.total.amount, 1599);
  assert.equal(cart.tax.amount, 288);
  assert.equal(cart.taxMode, "inclusive");
});

test("currency without a price is rejected", async () => {
  const cart = await priceCart([{ variantId: "prod-pasta-penne-v1", quantity: 1 }], catalog, { currency: "GBP" });
  assert.equal(cart.issues[0]?.code, "currency_mismatch");
});
