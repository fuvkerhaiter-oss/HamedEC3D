/** Customer-facing view of one order (confirmation page, order lookup, emails). No internal fields. */
import type { Db } from "../db/client";
import type { CurrencyCode, Money } from "../money";
import type { OrderStatus } from "../orders/state-machine";

export interface CustomerOrderView {
  id: string;
  orderNumber: number;
  status: OrderStatus;
  email: string;
  createdAt: string;
  taxMode: "inclusive" | "exclusive";
  items: { name: string; variant: string; quantity: number; lineTotal: Money }[];
  subtotal: Money;
  discount: Money;
  shipping: Money;
  tax: Money;
  total: Money;
  shippingMethod: string | null;
  shipTo: { fullName: string; line1: string; line2?: string; city: string; region?: string; postalCode: string; country: string };
  shipments: { carrier: string; trackingNumber: string; trackingUrl: string | null; status: string; events?: { status: string; description: string; location: string | null; at: string }[] }[];
  /** Business-day ESTIMATE shown at checkout (not a guarantee); null when the method had none. */
  deliveryEstimate: { minDays: number; maxDays: number } | null;
  /** Applied tax rate in basis points (snapshot at purchase); null for orders before it was recorded. */
  taxRateBps: number | null;
  refunds: { amount: Money; status: "pending" | "completed"; createdAt: string }[];
}

/** Plain-language status for customers. */
export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending_payment: "Waiting for payment",
  paid: "Paid · being prepared",
  processing: "Being prepared",
  submitted_to_supplier: "Being prepared",
  supplier_accepted: "Being prepared",
  shipped: "Shipped",
  delivered: "Delivered",
  refund_requested: "Refund in progress",
  refunded: "Refunded",
  failed: "Payment failed or needs attention",
  cancelled: "Cancelled",
};

export async function getCustomerOrder(db: Db, orderId: string): Promise<CustomerOrderView | null> {
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return null;
  const [o] = await db<{
    id: string; order_number: string; status: OrderStatus; email: string; created_at: Date; tax_mode: "inclusive" | "exclusive"; currency: CurrencyCode;
    subtotal: number; discount_total: number; shipping_total: number; tax_total: number; total: number; shipping_method_name: string | null;
    shipping_address: CustomerOrderView["shipTo"]; shipping_min_days: number | null; shipping_max_days: number | null; tax_rate_bps: number | null;
  }[]>`select id, order_number, status, email, created_at, tax_mode, currency, subtotal, discount_total, shipping_total, tax_total, total,
             shipping_method_name, shipping_address, shipping_min_days, shipping_max_days, tax_rate_bps from public.orders where id = ${orderId}`;
  if (!o) return null;
  const items = await db<{ product_name: string; variant_name: string; quantity: number; line_total: number }[]>`
    select product_name, variant_name, quantity, line_total from public.order_items where order_id = ${orderId} order by product_name`;
  const ships = await db<{ id: string; carrier: string; tracking_number: string; tracking_url: string | null; status: string }[]>`
    select id, carrier, tracking_number, tracking_url, status from public.shipments where order_id = ${orderId} order by shipped_at nulls last`;
  // Carrier events synced from the supplier (newest first, capped). Only this order's shipments.
  const evs = ships.length ? await db<{ shipment_id: string; status: string; description: string; location: string | null; occurred_at: Date }[]>`
    select shipment_id, status, description, location, occurred_at from public.tracking_events
     where shipment_id = any(${ships.map((s) => s.id)}::uuid[]) order by occurred_at desc limit 60` : [];
  const refunds = await db<{ amount: number; status: string; created_at: Date }[]>`
    select amount, status, created_at from public.refunds where order_id = ${orderId} and status in ('pending','succeeded','manual') order by created_at`;
  const m = (amount: number): Money => ({ amount: Number(amount), currency: o.currency });
  return {
    id: o.id,
    orderNumber: Number(o.order_number),
    status: o.status,
    email: o.email,
    createdAt: new Date(o.created_at).toISOString(),
    taxMode: o.tax_mode,
    items: items.map((i) => ({ name: i.product_name, variant: i.variant_name, quantity: i.quantity, lineTotal: m(i.line_total) })),
    subtotal: m(o.subtotal),
    discount: m(o.discount_total),
    shipping: m(o.shipping_total),
    tax: m(o.tax_total),
    total: m(o.total),
    shippingMethod: o.shipping_method_name,
    shipTo: o.shipping_address,
    shipments: ships.map((s) => ({
      carrier: s.carrier, trackingNumber: s.tracking_number, trackingUrl: s.tracking_url, status: s.status,
      events: evs.filter((e) => e.shipment_id === s.id).map((e) => ({ status: e.status, description: e.description, location: e.location, at: new Date(e.occurred_at).toISOString() })),
    })),
    deliveryEstimate: o.shipping_min_days != null && o.shipping_max_days != null ? { minDays: o.shipping_min_days, maxDays: o.shipping_max_days } : null,
    taxRateBps: o.tax_rate_bps,
    refunds: refunds.map((r) => ({ amount: m(r.amount), status: r.status === "pending" ? "pending" : "completed", createdAt: new Date(r.created_at).toISOString() })),
  };
}
