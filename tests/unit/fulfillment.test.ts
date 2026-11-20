import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryFulfillmentStore, retryFailedSubmission, submitToSupplier } from "../../src/lib/suppliers/fulfillment";
import { createMockSupplier } from "../../src/lib/suppliers/mock-supplier";
import { SupplierError } from "../../src/lib/suppliers/types";
import type { RetryPolicy } from "../../src/lib/suppliers/call";

const fast: RetryPolicy = { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1, timeoutMs: 50 };
const noSleep = async () => {};
const req = {
  orderId: "ord_1",
  lines: [{ supplierSku: "SKU1", quantity: 1 }],
  shipTo: { fullName: "A B", line1: "1 St", city: "Tunis", postalCode: "1000", countryCode: "TN" },
};

test("submits once and returns duplicate on repeated calls (webhook delivered twice)", async () => {
  const supplier = createMockSupplier();
  const store = createMemoryFulfillmentStore();
  const [a, b] = await Promise.all([submitToSupplier(supplier, req, store, fast, noSleep), submitToSupplier(supplier, req, store, fast, noSleep)]);
  const kinds = [a.kind, b.kind].sort();
  assert.deepEqual(kinds, ["in_progress", "submitted"]);
  const c = await submitToSupplier(supplier, req, store, fast, noSleep);
  assert.equal(c.kind, "submitted");
  assert.equal(c.kind === "submitted" && c.duplicate, true);
  assert.equal(supplier.submittedOrders.size, 1);
});

test("retries retryable errors then succeeds", async () => {
  const supplier = createMockSupplier({ submitFailures: [new SupplierError("503", "unavailable"), new SupplierError("429", "rate_limited")] });
  const store = createMemoryFulfillmentStore();
  const out = await submitToSupplier(supplier, req, store, fast, noSleep);
  assert.equal(out.kind, "submitted");
  assert.equal(store.records.get("ord_1:mock-supplier")?.attempts, 3);
});

test("does not retry non-retryable errors; explicit retry works", async () => {
  const supplier = createMockSupplier({ submitFailures: [new SupplierError("bad address", "invalid_request")] });
  const store = createMemoryFulfillmentStore();
  const out = await submitToSupplier(supplier, req, store, fast, noSleep);
  assert.equal(out.kind, "failed");
  assert.equal(supplier.submittedOrders.size, 0);
  // A second automatic call must not resubmit.
  assert.equal((await submitToSupplier(supplier, req, store, fast, noSleep)).kind, "failed");
  assert.equal(supplier.submittedOrders.size, 0);
  const rec = store.records.get("ord_1:mock-supplier")!;
  const retried = await retryFailedSubmission(supplier, req, store, rec, fast, noSleep);
  assert.equal(retried.kind, "submitted");
});

test("timeout goes to manual reconciliation, never blind resubmission", async () => {
  const supplier = createMockSupplier({ submitDelayMs: 500 });
  const store = createMemoryFulfillmentStore();
  const out = await submitToSupplier(supplier, req, store, { ...fast, maxAttempts: 1 }, noSleep);
  assert.equal(out.kind, "manual_required");
  assert.equal(store.records.get("ord_1:mock-supplier")?.status, "manual_required");
});

test("supplier without submitOrder capability falls back to manual processing", async () => {
  const supplier = createMockSupplier({ capabilities: ["availability"] });
  const store = createMemoryFulfillmentStore();
  const out = await submitToSupplier(supplier, req, store, fast, noSleep);
  assert.equal(out.kind, "manual_required");
  assert.equal(supplier.submittedOrders.size, 0);
});
