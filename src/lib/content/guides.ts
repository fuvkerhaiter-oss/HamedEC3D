/**
 * Buying guides / help articles (route: /guides/[slug]). Code-reviewed content, rendered as plain text blocks
 * (no HTML injection). Add a guide ONLY when it is genuinely useful, original and accurate:
 * - no mass-produced or near-duplicate articles, no keyword-stuffed pages, no invented facts, prices or reviews;
 * - link only to products/categories that really exist (unknown slugs are skipped at render time);
 * - set `updated` whenever the facts change.
 * See SEO_STRATEGY.md → "Content plan" for the queue of guides worth writing once matching products exist.
 */

export type GuideBlock =
  | { type: "p"; text: string }
  | { type: "h2"; text: string }
  | { type: "list"; items: string[] }
  | { type: "steps"; items: { title: string; text: string }[] }
  | { type: "keys"; rows: { keys: string[]; label: string }[] };

export interface Guide {
  slug: string;
  title: string;
  /** Meta description (≤ 155 chars). */
  description: string;
  /** ISO dates. */
  published: string;
  updated: string;
  /** Category slugs / product slugs this guide is about (linked when they exist and are live). */
  categories?: string[];
  products?: string[];
  /** Internal call-to-action links shown under the article. */
  links: { href: string; label: string }[];
  blocks: GuideBlock[];
}

export const GUIDES: Guide[] = [
  {
    slug: "how-to-shop-the-3d-store",
    title: "How to shop in the WEGO SHIIIP 3D store",
    description: "Controls, tips and what to do if your device can't run it: a short guide to the interactive 3D supermarket at WEGO SHIIIP, on computer and phone.",
    published: "2026-11-22",
    updated: "2026-11-22",
    links: [
      { href: "/store", label: "Enter the 3D store" },
      { href: "/catalog", label: "Shop the catalog instead" },
      { href: "/contact", label: "Help & contact" },
    ],
    blocks: [
      { type: "p", text: "WEGO SHIIIP has two ways to shop the same products: the catalog, a classic list you can search and filter, and the 3D store, a supermarket you walk through in your web browser. Prices, stock and your cart are shared between them, so you can switch at any time." },
      { type: "h2", text: "What you need" },
      { type: "list", items: [
        "A recent browser with WebGL 2 (current Chrome, Edge, Firefox or Safari on computers, iPhones and Android phones).",
        "Nothing to install: the store loads in the page.",
        "If WebGL is switched off or not supported on your device, the store tells you so and sends you to the catalog, where every product is available.",
      ] },
      { type: "h2", text: "Controls on a computer" },
      { type: "keys", rows: [
        { keys: ["W", "A", "S", "D"], label: "Walk" },
        { keys: ["Shift"], label: "Run (hold while walking)" },
        { keys: ["Mouse"], label: "Look around (click into the store first)" },
        { keys: ["E"], label: "See the product you are aiming at: photos, price, options, add to trolley" },
        { keys: ["C"], label: "Open your cart" },
        { keys: ["M"], label: "Music on / off" },
        { keys: ["V"], label: "Talk to other shoppers in your room (microphone on / off)" },
        { keys: ["Esc"], label: "Pause and show the controls" },
      ] },
      { type: "h2", text: "Controls on a phone or tablet" },
      { type: "list", items: [
        "Left thumb: walk. Push the stick to the edge to run.",
        "Right thumb: drag to look around.",
        "✋ button: see the product in front of you.",
        "Cart button: review your cart and pay.",
      ] },
      { type: "h2", text: "From shelf to checkout" },
      { type: "steps", items: [
        { title: "Enter", text: "Open the 3D store and click (or tap) into it." },
        { title: "Explore", text: "Walk the aisles. Shelf signs show each department; aim at a product to see its name and price." },
        { title: "Inspect", text: "Press E (or tap ✋) for photos, options and stock, then add it to your trolley." },
        { title: "Pay", text: "Open the cart and check out on our secure payment page. Totals, shipping and taxes are calculated on our server before you pay." },
      ] },
      { type: "h2", text: "Tips" },
      { type: "list", items: [
        "Looking for something specific? The catalog search is faster; the cart is the same.",
        "Prices are shown in euro (VAT included) for the EU and in US dollars (before sales tax) for the USA. Use the market switch at the top of the site.",
        "On older phones, close other apps and tabs before entering: 3D graphics need memory.",
      ] },
    ],
  },
];

export const getGuide = (slug: string) => GUIDES.find((g) => g.slug === slug) ?? null;
