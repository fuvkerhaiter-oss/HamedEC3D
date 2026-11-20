/**
 * MOCK supplier for development and tests. isMock = true; never selectable for live orders.
 * Supports failure injection to exercise retry, timeout and manual-fallback paths.
 */
import { money } from "../money";
import { SupplierError, type SupplierAdapter, type SupplierCapability, type SupplierOrderStatus } from "./types";

export interface MockSupplierOptions {
  id?: string;
  capabilities?: SupplierCapability[];
  stock?: Record<string, number>;
  /** Errors thrown by submitOrder, in order, before succeeding. */
  submitFailures?: SupplierError[];
  /** Milliseconds submitOrder waits (to simulate slowness/timeouts). */
  submitDelayMs?: number;
}

const ALL: SupplierCapability[] = ["productInfo", "availability", "inventorySync", "pricing", "submitOrder", "orderStatus", "tracking"];

export function createMockSupplier(opts: MockSupplierOptions = {}): SupplierAdapter & {
  submittedOrders: Map<string, string>;
  advance(ref: string, status: SupplierOrderStatus): void;
} {
  const failures = [...(opts.submitFailures ?? [])];
  const stock = { ...(opts.stock ?? {}) };
  const submittedOrders = new Map<string, string>(); // idempotencyKey -> ref
  const statuses = new Map<string, SupplierOrderStatus>();
  let seq = 0;

  return {
    id: opts.id ?? "mock-supplier",
    displayName: "Mock Supplier (development)",
    isMock: true,
    capabilities: new Set(opts.capabilities ?? ALL),
    submittedOrders,
    advance(ref, status) {
      statuses.set(ref, status);
    },
    async getAvailability(skus) {
      return skus.map((supplierSku) => ({ supplierSku, available: stock[supplierSku] ?? 0 }));
    },
    async getPricing(skus) {
      return skus.map((supplierSku) => ({ supplierSku, cost: money(100, "USD") }));
    },
    async getProduct(supplierSku) {
      return { supplierSku, title: `Mock item ${supplierSku}`, imageUrls: [] };
    },
    async submitOrder(req, signal) {
      if (opts.submitDelayMs) {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, opts.submitDelayMs);
          signal.addEventListener("abort", () => {
            clearTimeout(t);
            reject(new SupplierError("aborted", "timeout"));
          });
        });
      }
      const failure = failures.shift();
      if (failure) throw failure;
      // Honour idempotency like a well-behaved supplier API.
      const existing = submittedOrders.get(req.idempotencyKey);
      if (existing) return { supplierOrderRef: existing };
      const ref = `MOCK-${++seq}`;
      submittedOrders.set(req.idempotencyKey, ref);
      statuses.set(ref, { supplierOrderRef: ref, state: "accepted" });
      return { supplierOrderRef: ref };
    },
    async getOrderStatus(ref) {
      const s = statuses.get(ref);
      if (!s) throw new SupplierError(`Unknown order ${ref}`, "invalid_request");
      return s;
    },
  };
}
