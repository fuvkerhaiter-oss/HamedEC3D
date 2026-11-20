import assert from "node:assert/strict";
import { test } from "node:test";
import { canManageAdmin, effectivePermissions, roleDefaults } from "../../src/lib/admin/permissions";
import { passwordProblem, hashPassword, verifyPassword } from "../../src/lib/admin/password";
import { daysIn, previousRange, resolveRange } from "../../src/lib/admin/date-range";
import { maskEmail, maskName } from "../../src/lib/admin/services/people";
import { csvObjects, parseCsv, toCsv } from "../../src/lib/csv";
import { convertMinor, invertRate, parseRate } from "../../src/lib/fx";
import { computeProfit, marginBps } from "../../src/lib/finance/profit";

test("RBAC: role defaults, overrides, super admin invariants", () => {
  assert.ok(effectivePermissions("SUPER_ADMIN", [], ["orders.view"]).has("orders.view"), "super admin can't be revoked");
  assert.ok(!effectivePermissions("ADMIN").has("admins.manage"));
  assert.ok(!effectivePermissions("SUPPORT").has("orders.refund"));
  assert.ok(effectivePermissions("ORDER_MANAGER").has("orders.refund"));
  assert.ok(!effectivePermissions("PRODUCT_MANAGER").has("orders.view"));
  assert.ok(effectivePermissions("SUPPORT", ["inventory.adjust"]).has("inventory.adjust"));
  assert.ok(!effectivePermissions("SUPPORT", ["not.a.permission"]).has("not.a.permission" as never));
  assert.ok(!effectivePermissions("ADMIN", ["admins.manage"]).has("admins.manage"));
  assert.ok(roleDefaults("PRODUCT_MANAGER").includes("store.manage"));
  const sup = { id: "1", role: "SUPER_ADMIN" as const };
  assert.ok(canManageAdmin(sup, { id: "2", role: "ADMIN" }, { role: "SUPPORT" }));
  assert.ok(!canManageAdmin(sup, sup, { role: "ADMIN" }));
  assert.ok(!canManageAdmin(sup, sup, { deactivate: true }));
  assert.ok(!canManageAdmin({ id: "3", role: "ADMIN" }, { id: "2", role: "SUPPORT" }));
});

test("passwords: policy and scrypt round-trip", async () => {
  assert.ok(passwordProblem("short1"));
  assert.ok(passwordProblem("onlyletterslong"));
  assert.equal(passwordProblem("letters-and-123"), null);
  const h = await hashPassword("letters-and-123");
  assert.ok(await verifyPassword("letters-and-123", h));
  assert.ok(!(await verifyPassword("letters-and-124", h)));
  assert.ok(!(await verifyPassword("x", "garbage")));
});

test("date ranges", () => {
  const now = new Date("2026-11-20T15:00:00Z");
  const r = resolveRange({ range: "7d" }, now);
  assert.equal(r.from.toISOString(), "2026-11-14T00:00:00.000Z");
  assert.equal(r.to.toISOString(), "2026-11-21T00:00:00.000Z");
  assert.equal(daysIn(r).length, 7);
  const c = resolveRange({ range: "custom", from: "2026-01-01", to: "2026-01-31" }, now);
  assert.equal(daysIn(c).length, 31);
  assert.equal(resolveRange({ range: "custom", from: "2026-02-01", to: "2026-01-01" }, now).preset, "30d", "invalid custom falls back");
  assert.equal(resolveRange({ range: "ytd" }, now).from.toISOString(), "2026-01-01T00:00:00.000Z");
  assert.equal(previousRange(r).to.getTime(), r.from.getTime());
});

test("privacy masking", () => {
  assert.equal(maskEmail("jane.doe@example.com"), "j•••e@example.com");
  assert.equal(maskName("Jane Mary Doe"), "Jane M. D.");
});

test("CSV: round trip, quoting, formula injection guard", () => {
  const csv = toCsv(["a", "b"], [["x,y", 'say "hi"'], ["=SUM(A1)", 5]]);
  assert.match(csv, /"x,y","say ""hi"""/);
  assert.match(csv, /'=SUM\(A1\),5/);
  assert.deepEqual(parseCsv('a,b\r\n"1,2","q""q"\n'), [["a", "b"], ["1,2", 'q"q']]);
  assert.deepEqual(csvObjects("﻿Name, SKU\nX,Y\n"), [{ name: "X", sku: "Y" }]);
  assert.throws(() => parseCsv('"open'));
});

test("FX: exact decimal rates, integer minor units", () => {
  assert.equal(parseRate("1.08"), 108_000_000n);
  assert.throws(() => parseRate("0"));
  assert.throws(() => parseRate("-1"));
  assert.throws(() => parseRate("1.123456789"));
  assert.equal(convertMinor(10000, "EUR", "USD", "1.0825"), 10825);
  assert.equal(convertMinor(1, "EUR", "USD", "1.5"), 2, "half rounds away from zero");
  assert.equal(convertMinor(1000, "USD", "JPY", "150"), 1500, "exponent difference");
  assert.equal(convertMinor(500, "EUR", "EUR", "9"), 500);
  assert.equal(invertRate("2"), "0.50000000");
});

test("profit: revenue net of tax, estimated vs final, expenses, fx snapshot", () => {
  const s = computeProfit(
    [
      { id: "1", status: "delivered", currency: "EUR", total: 12200, taxTotal: 2200, fxRateToBase: "1", supplierCostFinal: { amount: 4000, currency: "EUR" }, supplierCostEstimated: null, refunded: 0, fee: 300 },
      { id: "2", status: "paid", currency: "USD", total: 10800, taxTotal: 800, fxRateToBase: "0.9", supplierCostFinal: null, supplierCostEstimated: { amount: 5000, currency: "USD" }, refunded: 1000, fee: null },
      { id: "3", status: "cancelled", currency: "EUR", total: 9999, taxTotal: 0, fxRateToBase: null, supplierCostFinal: null, supplierCostEstimated: null, refunded: 0, fee: null },
    ],
    [{ amount: 1000, currency: "EUR" }],
    "EUR",
    {},
  );
  assert.equal(s.orders, 2);
  assert.equal(s.revenue, 10000 + 9000);
  assert.equal(s.refunds, 900);
  assert.equal(s.costOfGoods, 4000 + 4500);
  assert.equal(s.fees, 300);
  assert.equal(s.grossProfit, 19000 - 900 - 8500 - 300);
  assert.equal(s.netProfit, s.grossProfit - 1000);
  assert.equal(s.estimatedOrders, 1);
  assert.equal(marginBps(1000, 600), 4000);
  assert.equal(marginBps(0, 1), null);
});
