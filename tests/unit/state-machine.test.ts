import { test } from "node:test";
import assert from "node:assert/strict";
import { InvalidTransitionError, ORDER_STATUSES, ORDER_TRANSITIONS, transitionOrder, isTerminal } from "../../src/lib/orders/state-machine";

const system = { type: "system" as const };

test("every status has a transition entry and targets are valid", () => {
  for (const s of ORDER_STATUSES) {
    for (const t of ORDER_TRANSITIONS[s]) assert.ok(ORDER_STATUSES.includes(t));
  }
  assert.ok(isTerminal("refunded") && isTerminal("cancelled"));
});

test("rejects invalid transitions", () => {
  assert.throws(() => transitionOrder({ from: "pending_payment", to: "shipped", actor: system }), InvalidTransitionError);
  assert.throws(() => transitionOrder({ from: "refunded", to: "paid", actor: system }), InvalidTransitionError);
});

test("paid requires verified payment evidence", () => {
  assert.throws(() => transitionOrder({ from: "pending_payment", to: "paid", actor: system }), InvalidTransitionError);
  const audit = transitionOrder({ from: "pending_payment", to: "paid", actor: system, evidence: { verifiedPaymentId: "pay_1" } });
  assert.equal(audit.toStatus, "paid");
  assert.equal(audit.fromStatus, "pending_payment");
});

test("shipped requires confirmed tracking", () => {
  assert.throws(() => transitionOrder({ from: "supplier_accepted", to: "shipped", actor: system }), InvalidTransitionError);
  assert.throws(
    () => transitionOrder({ from: "supplier_accepted", to: "shipped", actor: system, evidence: { trackingNumber: "1Z" } }),
    InvalidTransitionError,
  );
  const ok = transitionOrder({ from: "supplier_accepted", to: "shipped", actor: system, evidence: { trackingNumber: "1Z", carrier: "UPS" } });
  assert.equal(ok.toStatus, "shipped");
});

test("customers cannot mark orders paid or cancel after payment", () => {
  const customer = { type: "customer" as const, id: "u1" };
  assert.throws(
    () => transitionOrder({ from: "pending_payment", to: "paid", actor: customer, evidence: { verifiedPaymentId: "x" } }),
    InvalidTransitionError,
  );
  assert.equal(transitionOrder({ from: "pending_payment", to: "cancelled", actor: customer }).toStatus, "cancelled");
  assert.equal(transitionOrder({ from: "delivered", to: "refund_requested", actor: customer }).toStatus, "refund_requested");
});
