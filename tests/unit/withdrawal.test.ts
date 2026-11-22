import assert from "node:assert/strict";
import { test } from "node:test";
import { planWithdrawal, withdrawalAckEmail, withdrawalWindow, WithdrawalError } from "../../src/lib/orders/withdrawal";

const delivered = new Date("2026-03-02T15:00:00Z");
const day = 86_400_000;

test("window: open before delivery, EU only, closed for unpaid/cancelled", () => {
  assert.deepEqual(withdrawalWindow({ currency: "EUR", status: "paid", deliveredAt: null }), { open: true, deadline: null });
  assert.equal(withdrawalWindow({ currency: "EUR", status: "shipped", deliveredAt: delivered }).open, true, "partly delivered order stays open");
  assert.equal(withdrawalWindow({ currency: "USD", status: "delivered", deliveredAt: delivered }).block, "not_eu");
  assert.equal(withdrawalWindow({ currency: "EUR", status: "pending_payment", deliveredAt: null }).block, "not_paid");
  for (const s of ["cancelled", "refunded", "refund_requested"] as const) assert.equal(withdrawalWindow({ currency: "EUR", status: s, deliveredAt: null }).block, "closed");
});

test("window: 14 full days after the delivery day, never shorter", () => {
  const w = (now: Date) => withdrawalWindow({ currency: "EUR", status: "delivered", deliveredAt: delivered }, now);
  // Delivered 2 March → period ends at the end of 16 March; grace covers every European time zone.
  assert.equal(w(new Date("2026-03-16T23:30:00Z")).open, true);
  assert.equal(w(new Date("2026-03-17T11:00:00Z")).open, true, "grace hours");
  const late = w(new Date("2026-03-17T12:00:00Z"));
  assert.equal(late.open, false);
  assert.equal(late.block, "expired");
  assert.ok(late.deadline!.getTime() - delivered.getTime() > 14 * day);
});

const items = [
  { id: "a", name: "Olive oil", variant: "1 L", quantity: 2, withdrawn: 0 },
  { id: "b", name: "Chocolate", variant: "Default", quantity: 1, withdrawn: 0 },
];

test("plan: whole order vs part, merges duplicates, ignores zeros", () => {
  assert.deepEqual(planWithdrawal(items, [{ orderItemId: "a", quantity: 2 }, { orderItemId: "b", quantity: 1 }]).wholeOrder, true);
  const part = planWithdrawal(items, [{ orderItemId: "a", quantity: 1 }, { orderItemId: "a", quantity: 1 }, { orderItemId: "b", quantity: 0 }]);
  assert.deepEqual(part, { lines: [{ orderItemId: "a", quantity: 2 }], wholeOrder: false });
});

test("plan: refuses too many, foreign items, nothing selected, already withdrawn", () => {
  assert.throws(() => planWithdrawal(items, [{ orderItemId: "a", quantity: 3 }]), WithdrawalError);
  assert.throws(() => planWithdrawal(items, [{ orderItemId: "zzz", quantity: 1 }]), WithdrawalError);
  assert.throws(() => planWithdrawal(items, [{ orderItemId: "a", quantity: 0 }]), /at least one/);
  const after = [{ ...items[0]!, withdrawn: 2 }, items[1]!];
  assert.throws(() => planWithdrawal(after, [{ orderItemId: "a", quantity: 1 }]), /already withdrawn/);
  assert.equal(planWithdrawal(after, [{ orderItemId: "b", quantity: 1 }]).wholeOrder, false, "rest of an order is not 'the whole order'");
});

test("acknowledgement email states content, date/time and the 'not the sender address' warning", () => {
  const m = withdrawalAckEmail({ orderNumber: 100042, fullName: "Anna Rossi", submittedAt: new Date("2026-03-05T09:30:00Z"), items: [{ name: "Olive oil", variant: "1 L", quantity: 1 }], wholeOrder: false, orderLink: "https://x/order", returnsLink: "https://x/pages/returns" });
  assert.match(m.subject, /#100042/);
  assert.match(m.text, /Received on: 5 March 2026 at 10:30 \(Italian time\)/);
  assert.match(m.text, /1 × Olive oil \(1 L\)/);
  assert.match(m.text, /Do not send anything to the sender address/);
});
