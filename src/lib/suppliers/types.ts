/**
 * Supplier adapter contract. Each real supplier integration implements only the
 * operations its documented API supports and declares them in `capabilities`.
 * Never add an adapter for a supplier without real API documentation and credentials.
 *
 * Operation names vs. the common supplier interface:
 *   getProduct / getProductVariants → getProduct (variants included)   checkInventory → getAvailability
 *   getProductPrice → getPricing   getShippingOptions   createOrder → submitOrder   getOrderStatus
 *   getTrackingInformation → getTracking   cancelOrder   processRefund → requestRefund
 */
import type { Money } from "../money";

export type SupplierCapability =
  | "productInfo"
  | "availability"
  | "inventorySync"
  | "pricing"
  | "submitOrder"
  | "orderStatus"
  | "tracking"
  | "shippingOptions"
  | "cancelOrder"
  | "refund"
  /** The adapter can PAY the supplier order itself. No real adapter declares this today. */
  | "supplierPayment";

export interface SupplierVariantInfo {
  /** Supplier's id for this variant (e.g. AliExpress sku_attr). */
  supplierVariantId: string;
  attributes: Record<string, string>;
  available: number | null;
  cost: Money | null;
}

export interface SupplierProductInfo {
  supplierSku: string;
  title: string;
  description?: string;
  imageUrls: string[];
  variants?: SupplierVariantInfo[];
}

export interface SupplierShippingOption {
  /** Supplier's logistics service code, used when placing the order. */
  method: string;
  label: string;
  cost: Money | null;
  daysMin: number | null;
  daysMax: number | null;
  tracked: boolean | null;
}

export interface SupplierStock {
  supplierSku: string;
  available: number;
}

export interface SupplierOrderLine {
  supplierSku: string;
  quantity: number;
  /** Supplier product id (AliExpress product_id). Required by API adapters. */
  supplierProductId?: string | null;
  /** Supplier variant id (AliExpress sku_attr). */
  supplierVariantId?: string | null;
  /** Supplier logistics service to use. */
  shippingMethod?: string | null;
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
export type SupplierPaymentState = "pending" | "paid" | "failed" | "unknown";

export interface SupplierTrackingEvent {
  status: "label_created" | "in_transit" | "out_for_delivery" | "delivered" | "exception";
  description: string;
  location?: string;
  occurredAt: string; // ISO 8601
}

export interface SupplierTracking {
  carrier: string;
  trackingNumber: string;
  url?: string;
  events?: SupplierTrackingEvent[];
}

export interface SupplierOrderStatus {
  supplierOrderRef: string;
  state: SupplierOrderState;
  /** Whether the supplier considers the order paid. "unknown" when the API does not say. */
  paymentState?: SupplierPaymentState;
  /** Supplier's raw status code, stored for audit. */
  raw?: string;
  tracking?: SupplierTracking;
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
  getShippingOptions?(
    req: { supplierProductId: string; supplierVariantId?: string | null; quantity: number; countryCode: string },
    signal: AbortSignal,
  ): Promise<SupplierShippingOption[]>;
  submitOrder?(req: SupplierOrderRequest, signal: AbortSignal): Promise<{ supplierOrderRef: string }>;
  getOrderStatus?(supplierOrderRef: string, signal: AbortSignal): Promise<SupplierOrderStatus>;
  getTracking?(supplierOrderRef: string, signal: AbortSignal): Promise<SupplierTracking | null>;
  cancelOrder?(supplierOrderRef: string, signal: AbortSignal): Promise<{ cancelled: boolean; detail?: string }>;
  /** Opens a refund/dispute with the supplier where the API allows it. */
  requestRefund?(supplierOrderRef: string, reason: string, signal: AbortSignal): Promise<{ accepted: boolean; detail?: string }>;
}

export function supports(adapter: SupplierAdapter, cap: SupplierCapability): boolean {
  return adapter.capabilities.has(cap);
}
