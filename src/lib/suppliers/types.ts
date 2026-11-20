/**
 * Supplier adapter contract. Each real supplier integration implements only the
 * operations its documented API supports and declares them in `capabilities`.
 * Never add an adapter for a supplier without real API documentation and credentials.
 */
import type { Money } from "../money";

export type SupplierCapability =
  | "productInfo"
  | "availability"
  | "inventorySync"
  | "pricing"
  | "submitOrder"
  | "orderStatus"
  | "tracking";

export interface SupplierProductInfo {
  supplierSku: string;
  title: string;
  description?: string;
  imageUrls: string[];
}

export interface SupplierStock {
  supplierSku: string;
  available: number;
}

export interface SupplierOrderLine {
  supplierSku: string;
  quantity: number;
}

export interface ShippingAddress {
  fullName: string;
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postalCode: string;
  countryCode: string; // ISO 3166-1 alpha-2
  phone?: string;
}

export interface SupplierOrderRequest {
  /** Our stable idempotency key; adapters must forward it if the supplier API supports one. */
  idempotencyKey: string;
  orderId: string;
  lines: SupplierOrderLine[];
  shipTo: ShippingAddress;
}

export type SupplierOrderState = "accepted" | "processing" | "shipped" | "delivered" | "rejected" | "cancelled" | "unknown";

export interface SupplierOrderStatus {
  supplierOrderRef: string;
  state: SupplierOrderState;
  tracking?: { carrier: string; trackingNumber: string; url?: string };
}

/** Error classification decides whether a call is retried. */
export class SupplierError extends Error {
  override name = "SupplierError";
  constructor(
    message: string,
    readonly kind: "timeout" | "rate_limited" | "unavailable" | "rejected" | "auth" | "invalid_request" | "unknown",
  ) {
    super(message);
  }
  get retryable(): boolean {
    return this.kind === "timeout" || this.kind === "rate_limited" || this.kind === "unavailable";
  }
}

export interface SupplierAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: ReadonlySet<SupplierCapability>;
  /** True only for mock/sandbox adapters. Shown in admin so mocks are never mistaken for real integrations. */
  readonly isMock: boolean;

  getProduct?(supplierSku: string, signal: AbortSignal): Promise<SupplierProductInfo>;
  getAvailability?(supplierSkus: string[], signal: AbortSignal): Promise<SupplierStock[]>;
  getPricing?(supplierSkus: string[], signal: AbortSignal): Promise<{ supplierSku: string; cost: Money }[]>;
  submitOrder?(req: SupplierOrderRequest, signal: AbortSignal): Promise<{ supplierOrderRef: string }>;
  getOrderStatus?(supplierOrderRef: string, signal: AbortSignal): Promise<SupplierOrderStatus>;
}

export function supports(adapter: SupplierAdapter, cap: SupplierCapability): boolean {
  return adapter.capabilities.has(cap);
}
