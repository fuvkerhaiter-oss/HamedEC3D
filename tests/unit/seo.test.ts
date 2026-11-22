// eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON-LD objects are inspected loosely
type AnyJson = any;
import { test } from "node:test";
import assert from "node:assert/strict";
import { money } from "../../src/lib/money";
import type { Product } from "../../src/lib/catalog/types";
import { GUIDES } from "../../src/lib/content/guides";
import {
  absoluteUrl, breadcrumbLd, metaDescription, organizationLd, productDescription, productLd, productTitle, serializeJsonLd, siteUrl, websiteLd,
} from "../../src/lib/seo/site";

const SITE = "https://shop.example";

const product = (over: Partial<Product> = {}): Product => ({
  id: "p1", slug: "olive-oil", name: "Olive Oil", description: "Cold pressed.", categoryId: "c1", status: "published",
  imageUrl: "https://abc.supabase.co/storage/v1/object/public/products/p1/a.webp",
  gallery: [{ url: "https://abc.supabase.co/storage/v1/object/public/products/p1/a.webp", alt: "Bottle", width: 800, height: 800 }, { url: "/api/media/p1/b.webp", alt: "", width: null, height: null }],
  asset: { glbUrl: null, heightMeters: 0.25 }, isMock: false,
  variants: [
    { id: "v1", productId: "p1", sku: "OIL-500", name: "500 ml", prices: [money(899, "EUR"), money(999, "USD")], stockQuantity: 3, attributes: {} },
    { id: "v2", productId: "p1", sku: "OIL-1L", name: "1 L", prices: [money(1499, "EUR")], stockQuantity: 0, attributes: {} },
  ],
  ...over,
});

test("serializeJsonLd escapes < so text cannot close the script tag", () => {
  const out = serializeJsonLd({ name: "</script><script>alert(1)</script>" });
  assert.ok(!out.includes("<"));
  assert.deepEqual(JSON.parse(out), { name: "</script><script>alert(1)</script>" });
});

test("metaDescription collapses whitespace and cuts at a word boundary", () => {
  assert.equal(metaDescription("  a  b\n c "), "a b c");
  const long = "word ".repeat(60);
  const d = metaDescription(long, 155);
  assert.ok(d.length <= 155 && d.endsWith("…") && !d.includes("  "));
});

test("siteUrl prefers NEXT_PUBLIC_SITE_URL, then the Vercel production domain", () => {
  const saved = { a: process.env.NEXT_PUBLIC_SITE_URL, b: process.env.VERCEL_PROJECT_PRODUCTION_URL };
  try {
    process.env.NEXT_PUBLIC_SITE_URL = "https://wego.example/";
    assert.equal(siteUrl(), "https://wego.example");
    delete process.env.NEXT_PUBLIC_SITE_URL;
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "wego.vercel.app";
    assert.equal(siteUrl(), "https://wego.vercel.app");
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    assert.equal(siteUrl(), "http://localhost:3000");
  } finally {
    if (saved.a === undefined) delete process.env.NEXT_PUBLIC_SITE_URL; else process.env.NEXT_PUBLIC_SITE_URL = saved.a;
    if (saved.b === undefined) delete process.env.VERCEL_PROJECT_PRODUCTION_URL; else process.env.VERCEL_PROJECT_PRODUCTION_URL = saved.b;
  }
});

test("absoluteUrl keeps absolute URLs and prefixes paths", () => {
  assert.equal(absoluteUrl("/catalog", SITE), `${SITE}/catalog`);
  assert.equal(absoluteUrl("https://x.test/a.png", SITE), "https://x.test/a.png");
});

test("product title/description use admin SEO fields, else real data", () => {
  assert.equal(productTitle(product(), "Pantry"), "Olive Oil · Pantry");
  assert.equal(productTitle(product({ seoTitle: "Best Oil" })), "Best Oil");
  assert.equal(productDescription(product()), "Cold pressed.");
  assert.equal(productDescription(product({ seoDescription: "Custom." })), "Custom.");
  assert.match(productDescription(product({ description: "" }), "Pantry"), /^Buy Olive Oil \(Pantry\) online/);
});

test("productLd: one offer per variant × currency with real stock, absolute images, no invented brand or rating", () => {
  const ld = productLd(SITE, product()) as Record<string, unknown> & { offers: Record<string, unknown>[]; image: string[] };
  assert.equal(ld["@type"], "Product");
  assert.equal(ld.offers.length, 3);
  assert.deepEqual(ld.offers.map((o) => [o.sku, o.price, o.priceCurrency, o.availability]), [
    ["OIL-500", "8.99", "EUR", "https://schema.org/InStock"],
    ["OIL-500", "9.99", "USD", "https://schema.org/InStock"],
    ["OIL-1L", "14.99", "EUR", "https://schema.org/OutOfStock"],
  ]);
  assert.deepEqual(ld.image, ["https://abc.supabase.co/storage/v1/object/public/products/p1/a.webp", `${SITE}/api/media/p1/b.webp`]);
  assert.equal(ld.brand, undefined);
  assert.equal(ld.aggregateRating, undefined);
  assert.equal(ld.url, `${SITE}/catalog/olive-oil`);
});

test("productLd: brand and rating only from real data", () => {
  const ld = productLd(SITE, product({ brand: "Frantoio" }), {
    reviews: { count: 2, average: 4.5, reviews: [{ author: "Ana", rating: 5, title: "Great", body: "Lovely", date: "2026-11-01", verified: true }] },
  }) as Record<string, AnyJson>;
  assert.deepEqual(ld.brand, { "@type": "Brand", name: "Frantoio" });
  assert.equal(ld.aggregateRating.reviewCount, 2);
  assert.equal(ld.aggregateRating.ratingValue, 4.5);
  assert.equal(ld.review[0].reviewRating.ratingValue, 5);
});

test("breadcrumb, organization and website JSON-LD", () => {
  const bc = breadcrumbLd(SITE, [{ name: "Home", path: "/" }, { name: "Pantry", path: "/category/pantry" }]) as Record<string, AnyJson>;
  assert.deepEqual(bc.itemListElement.map((i: AnyJson) => [i.position, i.item]), [[1, `${SITE}/`], [2, `${SITE}/category/pantry`]]);
  const org = organizationLd(SITE) as Record<string, AnyJson>;
  assert.equal(org.logo, `${SITE}/brand/wego-shiiip-logo.png`);
  assert.equal(org.sameAs, undefined);
  const ws = websiteLd(SITE) as Record<string, AnyJson>;
  assert.equal(ws.potentialAction.target.urlTemplate, `${SITE}/catalog?q={search_term_string}`);
});

test("guides: unique slugs, dated, descriptions fit a search snippet", () => {
  const slugs = new Set(GUIDES.map((g) => g.slug));
  assert.equal(slugs.size, GUIDES.length);
  for (const g of GUIDES) {
    assert.match(g.slug, /^[a-z0-9-]+$/);
    assert.ok(g.description.length <= 160, g.slug);
    assert.ok(g.updated >= g.published, g.slug);
  }
});
