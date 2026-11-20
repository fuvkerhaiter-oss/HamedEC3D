/**
 * Submits a paid order to its supplier exactly once.
 * Duplicate protection: an idempotency key (orderId:supplierId) is reserved in the
 * store BEFORE calling the supplier; a second caller sees the existing record and stops.
 * The store implementation must back `reserve` with a UNIQUE constraint (supplier_orders.idempotency_key).
 */
import { callSupplier, DEFAULT_RETRY, type RetryPolicy } from "./call";
import { SupplierError, supports, type SupplierAdapter, type SupplierOrderRequest } from "./types";

export type SupplierOrderRecordStatus = "submitting" | "submitted" | "failed" | "manual_required";

export interface SupplierOrderRecord {
  idempotencyKey: string;
  orderId: string;
  supplierId: string;
  status: SupplierOrderRecordStatus;
  supplierOrderRef: string | null;
  attempts: number;
  lastError: string | null;
}

export interface FulfillmentStore {
  /** Atomically insert a 'submitting' record. Returns the existing record if the key already exists. */
  reserve(record: SupplierOrderRecord): Promise<{ created: boolean; record: SupplierOrderRecord }>;
  update(idempotencyKey: string, patch: Partial<SupplierOrderRecord>): Promise<SupplierOrderRecord>;
}

export type SubmitOutcome =
  | { kind: "submitted"; supplierOrderRef: string; duplicate: boolean }
  | { kind: "in_progress" }
  | { kind: "manual_required"; reason: string }
  | { kind: "failed"; error: string; retryable: boolean };

export const supplierIdempotencyKey = (orderId: string, supplierId: string) => `${orderId}:${supplierId}`;

export async function submitToSupplier(
  adapter: SupplierAdapter,
  req: Omit<SupplierOrderRequest, "idempotencyKey">,
  store: FulfillmentStore,
  policy: RetryPolicy = DEFAULT_RETRY,
  sleep?: (ms: number) => Promise<void>,
): Promise<SubmitOutcome> {
  const idempotencyKey = supplierIdempotencyKey(req.orderId, adapter.id);
  const { created, record } = await store.reserve({
    idempotencyKey,
    orderId: req.orderId,
    supplierId: adapter.id,
    status: "submitting",
    supplierOrderRef: null,
    attempts: 0,
    lastError: null,
  });

  if (!created) {
    if (record.status === "submitted" && record.supplierOrderRef) {
      return { kind: "submitted", supplierOrderRef: record.supplierOrderRef, duplicate: true };
    }
    if (record.status === "submitting") return { kind: "in_progress" };
    if (record.status === "manual_required") return { kind: "manual_required", reason: record.lastError ?? "Manual processing" };
    // status === "failed": only an explicit retry (reconciliation/admin) may resubmit; see retryFailedSubmission.
    return { kind: "failed", error: record.lastError ?? "Previous submission failed", retryable: true };
  }

  return attemptSubmission(adapter, { ...req, idempotencyKey }, store, record.attempts, policy, sleep);
}

/** Explicit resubmission of a failed record (admin action or reconciliation job). */
export async function retryFailedSubmission(
  adapter: SupplierAdapter,
  req: Omit<SupplierOrderRequest, "idempotencyKey">,
  store: FulfillmentStore,
  previous: SupplierOrderRecord,
  policy: RetryPolicy = DEFAULT_RETRY,
  sleep?: (ms: number) => Promise<void>,
): Promise<SubmitOutcome> {
  if (previous.status !== "failed") throw new Error(`Only failed submissions can be retried (was ${previous.status})`);
  await store.update(previous.idempotencyKey, { status: "submitting" });
  return attemptSubmission(adapter, { ...req, idempotencyKey: previous.idempotencyKey }, store, previous.attempts, policy, sleep);
}

async function attemptSubmission(
  adapter: SupplierAdapter,
  req: SupplierOrderRequest,
  store: FulfillmentStore,
  priorAttempts: number,
  policy: RetryPolicy,
  sleep?: (ms: number) => Promise<void>,
): Promise<SubmitOutcome> {
  if (!supports(adapter, "submitOrder") || !adapter.submitOrder) {
    const reason = `${adapter.displayName} does not support automated order submission`;
    await store.update(req.idempotencyKey, { status: "manual_required", lastError: reason });
    return { kind: "manual_required", reason };
  }

  let attempts = priorAttempts;
  const submit = adapter.submitOrder.bind(adapter);
  try {
    const { supplierOrderRef } = await callSupplier(
      (signal) => {
        attempts++;
        return submit(req, signal);
      },
      policy,
      sleep,
    );
    await store.update(req.idempotencyKey, { status: "submitted", supplierOrderRef, attempts, lastError: null });
    return { kind: "submitted", supplierOrderRef, duplicate: false };
  } catch (err) {
    const e = err instanceof SupplierError ? err : new SupplierError(String(err), "unknown");
    // A timeout may mean the supplier DID receive the order. Mark for reconciliation instead of blind resubmission.
    const status = e.kind === "timeout" ? "manual_required" : "failed";
    const lastError = e.kind === "timeout" ? `Timeout — verify with supplier before resubmitting: ${e.message}` : e.message;
    await store.update(req.idempotencyKey, { status, attempts, lastError });
    return status === "manual_required"
      ? { kind: "manual_required", reason: lastError }
      : { kind: "failed", error: lastError, retryable: e.retryable };
  }
}

/** In-memory store for tests and local development. */
export function createMemoryFulfillmentStore(): FulfillmentStore & { records: Map<string, SupplierOrderRecord> } {
  const records = new Map<string, SupplierOrderRecord>();
  return {
    records,
    async reserve(record) {
      const existing = records.get(record.idempotencyKey);
      if (existing) return { created: false, record: { ...existing } };
      records.set(record.idempotencyKey, { ...record });
      return { created: true, record: { ...record } };
    },
    async update(key, patch) {
      const existing = records.get(key);
      if (!existing) throw new Error(`No supplier order record ${key}`);
      const next = { ...existing, ...patch };
      records.set(key, next);
      return { ...next };
    },
  };
}
