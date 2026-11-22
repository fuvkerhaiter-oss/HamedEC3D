/**
 * Supplier adapter catalogue (display info only — safe to import from client components).
 * `suppliers.adapter_key` selects an implementation; the server-side factory is `adapters.ts`.
 * "manual" suppliers are fulfilled by an admin (place the order with the supplier, then record the reference + tracking).
 */

export interface AdapterInfo {
  key: string;
  label: string;
  available: boolean;
  isMock: boolean;
  /** Can this adapter place orders by API? (Paying the supplier is a separate question — see `paysSupplier`.) */
  placesOrders: boolean;
  /** Can this adapter PAY the supplier automatically? No real adapter can today. */
  paysSupplier: boolean;
  detail: string;
}

export const ADAPTERS: AdapterInfo[] = [
  { key: "manual", label: "Manual fulfillment", available: true, isMock: false, placesOrders: false, paysSupplier: false, detail: "An admin places the order with the supplier and records the reference and tracking." },
  {
    key: "aliexpress", label: "AliExpress (Dropshipping API)", available: true, isMock: false, placesOrders: true, paysSupplier: false,
    detail: "Places orders, checks price/stock, syncs status and tracking through the AliExpress Open Platform DS API. Needs ALIEXPRESS_APP_KEY, ALIEXPRESS_APP_SECRET and ALIEXPRESS_ACCESS_TOKEN. Orders are created UNPAID at AliExpress — pay them in your AliExpress buyer account; the sync then sees them as paid.",
  },
  {
    key: "alibaba", label: "Alibaba.com (Dropshipping console — manual)", available: true, isMock: false, placesOrders: false, paysSupplier: false,
    detail: "No API adapter: Alibaba.com's dropshipping order API needs partner approval and its parameter specs were not available to build against. Place orders in the Alibaba.com Dropshipping Orders console (single or Bulk Create Order), then record the Alibaba order number and tracking here.",
  },
  { key: "mock", label: "Mock supplier (development only)", available: process.env.NODE_ENV !== "production", isMock: true, placesOrders: true, paysSupplier: false, detail: "In-memory test double. Never use for real orders." },
];

export function adapterInfo(key: string): AdapterInfo {
  return ADAPTERS.find((a) => a.key === key) ?? { key, label: key, available: false, isMock: false, placesOrders: false, paysSupplier: false, detail: "No adapter implemented for this key. Requires the supplier's API documentation and credentials." };
}

export const ADAPTER_KEYS = ["manual", "aliexpress", "alibaba", "mock"] as const;
