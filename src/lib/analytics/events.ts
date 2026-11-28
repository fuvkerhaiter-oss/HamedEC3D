/**
 * Conversion funnel events (names are the contract with the analytics dashboard: don't rename casually).
 * Questions they answer: does the 3D store help, where do visitors drop off, which products attract, which sources
 * convert. Props never contain personal data (no email, name, address, order id or free text).
 */
export const FUNNEL_EVENTS = [
  "catalog_view", // /catalog
  "category_view", // /category/[slug]
  "search", // catalog search (result-count bucket only, never the query text)
  "product_view", // product page
  "store3d_enter", // clicked "enter" in the 3D store
  "store3d_product", // opened a product in the 3D store
  "add_to_cart",
  "cart_view", // cart drawer opened
  "checkout_start", // checkout page with items
  "shipping_select", // chose a delivery method
  "payment_start", // payment page requested (redirect to Stripe)
  "purchase", // order page after a confirmed payment
] as const;
export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];

/** Where a shopper discovered products this session: "3d" once they entered the 3D store, else "catalog". */
export type DiscoveryPath = "3d" | "catalog";

const PROP_KEYS = ["path", "device", "product", "category", "source", "method", "results"] as const;
export type EventProps = Partial<Record<(typeof PROP_KEYS)[number], string>>;

const SAFE_VALUE = /^[\w .:/-]{1,60}$/;

/** Search results as a coarse bucket ("0" matters most: what shoppers look for and don't find). */
export function searchResultsBucket(n: number): "0" | "1-5" | "6+" {
  return n <= 0 ? "0" : n <= 5 ? "1-5" : "6+";
}

/** Drops anything that isn't a short plain token (defence against accidentally sending personal data). */
export function cleanProps(props: Record<string, unknown>): EventProps {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(props)) {
    if (!(PROP_KEYS as readonly string[]).includes(k)) continue;
    if (typeof v !== "string" || !SAFE_VALUE.test(v) || v.includes("@")) continue;
    out[k] = v;
  }
  return out;
}

/** Page URL for analytics: origin + path only (order/account links carry signed tokens in the query). */
export function analyticsUrl(href: string): string {
  try {
    const u = new URL(href);
    const path = u.pathname.replace(/^\/(order|account|seller|admin)(\/.*)?$/, "/$1");
    return `${u.origin}${path}`;
  } catch {
    return "";
  }
}

export function deviceClass(width: number, touch: boolean): "mobile" | "tablet" | "desktop" {
  if (width < 768) return "mobile";
  if (width < 1100 && touch) return "tablet";
  return "desktop";
}
