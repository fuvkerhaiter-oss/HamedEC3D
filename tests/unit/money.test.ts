import { test } from "node:test";
import assert from "node:assert/strict";
import { add, formatMoney, fromDecimalString, money, multiply, percentOf, toDecimalString, MoneyError } from "../../src/lib/money";

test("rejects non-integer amounts", () => {
  assert.throws(() => money(10.5, "USD"), MoneyError);
});

test("rejects mixed currencies", () => {
  assert.throws(() => add(money(1, "USD"), money(1, "EUR")), MoneyError);
});

test("0.1 + 0.2 problem does not exist", () => {
  assert.equal(add(money(10, "USD"), money(20, "USD")).amount, 30);
});

test("decimal string round-trips, including 3-decimal TND and 0-decimal JPY", () => {
  assert.equal(toDecimalString(money(12345, "USD")), "123.45");
  assert.equal(toDecimalString(money(5, "USD")), "0.05");
  assert.equal(toDecimalString(money(-5, "USD")), "-0.05");
  assert.equal(toDecimalString(money(1500, "TND")), "1.500");
  assert.equal(toDecimalString(money(1500, "JPY")), "1500");
  assert.equal(fromDecimalString("19.99", "USD").amount, 1999);
  assert.equal(fromDecimalString("2.5", "TND").amount, 2500);
  assert.throws(() => fromDecimalString("1.999", "USD"), MoneyError);
  assert.throws(() => fromDecimalString("abc", "USD"), MoneyError);
});

test("percentOf rounds half up with integer math", () => {
  assert.equal(percentOf(money(999, "USD"), 1000).amount, 100); // 99.9 -> 100
  assert.equal(percentOf(money(1005, "USD"), 1000).amount, 101); // 100.5 -> 101
  assert.equal(percentOf(money(1004, "USD"), 1000).amount, 100);
});

test("multiply requires integer quantity", () => {
  assert.equal(multiply(money(250, "USD"), 3).amount, 750);
  assert.throws(() => multiply(money(250, "USD"), 1.5), MoneyError);
});

test("formats via exact decimal", () => {
  assert.equal(formatMoney(money(123456, "USD")), "$1,234.56");
});
