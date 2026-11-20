/**
 * Supplier adapter registry. `suppliers.adapter_key` selects an implementation. Only adapters built
 * against real, documented supplier APIs belong here; there are none yet. "manual" suppliers are fulfilled
 * by an admin (place the order with the supplier, then record the supplier reference + tracking).
 */
import { createMockSupplier } from "./mock-supplier";
import type { SupplierAdapter } from "./types";

export interface AdapterInfo {
  key: string;
  label: string;
  available: boolean;
  isMock: boolean;
  detail: string;
}

export const ADAPTERS: AdapterInfo[] = [
  { key: "manual", label: "Manual fulfillment", available: true, isMock: false, detail: "An admin places the order with the supplier and records the reference and tracking." },
  { key: "mock", label: "Mock supplier (development only)", available: process.env.NODE_ENV !== "production", isMock: true, detail: "In-memory test double. Never use for real orders." },
];

export function adapterInfo(key: string): AdapterInfo {
  return ADAPTERS.find((a) => a.key === key) ?? { key, label: key, available: false, isMock: false, detail: "No adapter implemented for this key. Requires the supplier's API documentation and credentials." };
}

/** Returns an adapter for API suppliers; null means manual fulfillment. Throws for unknown keys. */
export function getSupplierAdapter(key: string, supplierId: string): SupplierAdapter | null {
  if (key === "manual") return null;
  if (key === "mock" && process.env.NODE_ENV !== "production") return createMockSupplier({ id: supplierId });
  throw new Error(`No supplier adapter "${key}" is implemented`);
}
