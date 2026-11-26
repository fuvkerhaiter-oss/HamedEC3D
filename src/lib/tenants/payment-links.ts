/**
 * Tenants get paid through their OWN payment links (we never touch the money). This recognises the common
 * providers so the dashboard can show "Stripe Payment Link ✓" and give the right how-to, and rejects anything
 * that isn't a plain https link (no javascript:, data:, credentials in the URL, IP hosts or our own site).
 * Pure (unit tested).
 */

export interface PaymentLinkProvider {
  id: string;
  name: string;
  /** Hostnames (exact or as a parent domain). */
  hosts: string[];
  /** Short how-to shown in the dashboard. */
  howTo: string;
  /** Where the tenant creates such a link. */
  createUrl: string;
}

export const PAYMENT_LINK_PROVIDERS: PaymentLinkProvider[] = [
  {
    id: "stripe",
    name: "Stripe Payment Link",
    hosts: ["buy.stripe.com", "checkout.stripe.com", "donate.stripe.com"],
    howTo: "Stripe Dashboard → Payment Links → New. Pick the product and price, then copy the link (buy.stripe.com/…).",
    createUrl: "https://dashboard.stripe.com/payment-links",
  },
  {
    id: "paypal",
    name: "PayPal",
    hosts: ["paypal.me", "paypal.com", "www.paypal.com"],
    howTo: "PayPal → Pay & Get Paid → Create payment link (or your paypal.me link). Copy the link.",
    createUrl: "https://www.paypal.com/ncp/links",
  },
  {
    id: "shopify",
    name: "Shopify",
    hosts: ["myshopify.com", "shop.app"],
    howTo: "Shopify admin → Products → pick a product → More actions → Create checkout link. Copy the link.",
    createUrl: "https://admin.shopify.com",
  },
  {
    id: "square",
    name: "Square",
    hosts: ["square.link", "checkout.square.site", "square.site"],
    howTo: "Square Dashboard → Online → Checkout links → Create link. Copy the link.",
    createUrl: "https://squareup.com/dashboard/online-checkout",
  },
  {
    id: "lemonsqueezy",
    name: "Lemon Squeezy",
    hosts: ["lemonsqueezy.com"],
    howTo: "Lemon Squeezy → Products → Share → copy the checkout link.",
    createUrl: "https://app.lemonsqueezy.com/products",
  },
  {
    id: "gumroad",
    name: "Gumroad",
    hosts: ["gumroad.com"],
    howTo: "Gumroad → Products → your product → Share → copy the link.",
    createUrl: "https://app.gumroad.com/products",
  },
  {
    id: "etsy",
    name: "Etsy",
    hosts: ["etsy.com", "www.etsy.com"],
    howTo: "Open the listing on Etsy and copy its address.",
    createUrl: "https://www.etsy.com/your/shops/me/tools/listings",
  },
  {
    id: "kofi",
    name: "Ko-fi",
    hosts: ["ko-fi.com"],
    howTo: "Ko-fi → Shop → your item → copy its link.",
    createUrl: "https://ko-fi.com/manage/shop",
  },
];

export type PaymentLinkCheck =
  | { ok: true; url: string; host: string; provider: PaymentLinkProvider | null }
  | { ok: false; error: string };

const hostMatches = (host: string, h: string) => host === h || host.endsWith(`.${h}`);

/** Validate + normalise a tenant payment link. `ownHosts`: our own site's hosts (a link back to us is refused). */
export function checkPaymentLink(raw: string, ownHosts: readonly string[] = []): PaymentLinkCheck {
  const value = raw.trim();
  if (!value) return { ok: false, error: "Paste your payment link." };
  if (value.length > 600) return { ok: false, error: "That link is too long (600 characters max)." };
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`);
  } catch {
    return { ok: false, error: "That doesn't look like a link. It should start with https://" };
  }
  if (u.protocol !== "https:") return { ok: false, error: "Only secure links (https://) are accepted." };
  if (u.username || u.password) return { ok: false, error: "Links with a username or password inside aren't accepted." };
  const host = u.hostname.toLowerCase();
  if (!host.includes(".") || /^[\d.]+$/.test(host) || host.startsWith("[") || host === "localhost" || host.endsWith(".local")) {
    return { ok: false, error: "Use the public link from your payment provider." };
  }
  if (ownHosts.some((h) => hostMatches(host, h.toLowerCase()))) return { ok: false, error: "That's a link to this site. Paste the link from your payment provider." };
  const provider = PAYMENT_LINK_PROVIDERS.find((p) => p.hosts.some((h) => hostMatches(host, h))) ?? null;
  u.hash = "";
  return { ok: true, url: u.toString(), host, provider };
}

/** Provider for an already-stored link (display only). */
export function providerOf(url: string | null): PaymentLinkProvider | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return PAYMENT_LINK_PROVIDERS.find((p) => p.hosts.some((h) => hostMatches(host, h))) ?? null;
  } catch {
    return null;
  }
}

/** "buy.stripe.com" → shown on the Buy button ("Pay on buy.stripe.com"). */
export function linkHost(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
