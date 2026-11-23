import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeCartLines } from "../../src/lib/cart/merge";
import { MAX_LINE_QUANTITY, MAX_CART_LINES } from "../../src/lib/cart/pricing";

test("cart merge: guest items into empty account cart", () => {
  const guest = [
    { variantId: "var-1", quantity: 2 },
    { variantId: "var-2", quantity: 5 },
  ];
  const result = mergeCartLines(guest, []);

  assert.equal(result.lines.length, 2);
  assert.equal(result.lines[0]?.variantId, "var-1");
  assert.equal(result.lines[0]?.quantity, 2);
  assert.equal(result.lines[1]?.variantId, "var-2");
  assert.equal(result.lines[1]?.quantity, 5);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.mergedCount, 2);
});

test("cart merge: empty guest into existing account cart", () => {
  const account = [
    { variantId: "var-1", quantity: 3 },
  ];
  const result = mergeCartLines([], account);

  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0]?.variantId, "var-1");
  assert.equal(result.lines[0]?.quantity, 3);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.mergedCount, 0);
});

test("cart merge: duplicate variants combine quantities without duplicates", () => {
  const guest = [
    { variantId: "var-1", quantity: 2 },
    { variantId: "var-2", quantity: 3 },
  ];
  const account = [
    { variantId: "var-1", quantity: 4 },
    { variantId: "var-3", quantity: 1 },
  ];
  const result = mergeCartLines(guest, account);

  assert.equal(result.lines.length, 3, "3 distinct variants total");

  const var1 = result.lines.find((l) => l.variantId === "var-1");
  assert.equal(var1?.quantity, 6, "2 + 4 = 6");

  const var2 = result.lines.find((l) => l.variantId === "var-2");
  assert.equal(var2?.quantity, 3);

  const var3 = result.lines.find((l) => l.variantId === "var-3");
  assert.equal(var3?.quantity, 1);

  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0]?.variantId, "var-1");
  assert.equal(result.conflicts[0]?.guestQuantity, 2);
  assert.equal(result.conflicts[0]?.accountQuantity, 4);
  assert.equal(result.conflicts[0]?.finalQuantity, 6);
  assert.equal(result.conflicts[0]?.clamped, false);
});

test("cart merge: clamps combined quantity to MAX_LINE_QUANTITY (99)", () => {
  const guest = [{ variantId: "var-bulk", quantity: 70 }];
  const account = [{ variantId: "var-bulk", quantity: 50 }];
  const result = mergeCartLines(guest, account);

  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0]?.quantity, MAX_LINE_QUANTITY);
  assert.equal(result.conflicts[0]?.clamped, true);
  assert.equal(result.conflicts[0]?.finalQuantity, MAX_LINE_QUANTITY);
});

test("cart merge: caps total unique variants at MAX_CART_LINES (100)", () => {
  const guest = Array.from({ length: 70 }, (_, i) => ({ variantId: `guest-var-${i}`, quantity: 1 }));
  const account = Array.from({ length: 50 }, (_, i) => ({ variantId: `account-var-${i}`, quantity: 1 }));

  const result = mergeCartLines(guest, account);
  assert.equal(result.lines.length, MAX_CART_LINES);
});

test("cart merge: filters out invalid, zero or negative quantities safely", () => {
  const guest = [
    { variantId: "valid-1", quantity: 2 },
    { variantId: "zero", quantity: 0 },
    { variantId: "negative", quantity: -5 },
    { variantId: "", quantity: 3 },
  ];
  const account = [
    { variantId: "valid-2", quantity: 1 },
  ];

  const result = mergeCartLines(guest, account);
  assert.equal(result.lines.length, 2);
  assert.deepEqual(result.lines.map((l) => l.variantId).sort(), ["valid-1", "valid-2"]);
});
