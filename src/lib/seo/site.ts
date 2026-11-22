/**
 * Site-wide SEO constants and pure helpers (no network, no React): canonical origin, meta descriptions and
 * schema.org JSON-LD builders. Unit tested in tests/unit/seo.test.ts.
 *
 * Rules: only real data (catalog, approved reviews, admin texts). Never invent prices, stock, brands, ratings
 * or business credentials. Mock products are never described to search engines.
 */
import type { Category, Product } from "../catalog/types";
import { toDecimalString } from "../money";

export const SITE_NAME = "WEGO SHIIIP";
export const SITE_TAGLINE = "Happy Family, Happy Animals";
/** Public production origin (www is canonical; the apex domain does not serve the app). Used for URLs that must
 *  point at production from any environment, e.g. the Stripe webhook endpoint shown in the admin. */
export const PRODUCTION_ORIGIN = "https://www.wegoshiiip.com";
/** Stable public URL (schema.org Organization logo must not change with every build hash). */
export const LOGO_PATH = "/brand/wego-shiiip-logo.png";
/** Site-wide share image (app/opengraph-image.jpg). Pages that set their own openGraph must repeat it, since
 *  Next replaces (not merges) the openGraph object. */
export const DEFAULT_OG_IMAGE = { url: "/opengraph-image.jpg", width: 1200, height: 630, alt: "WEGO SHIIIP logo in front of an aisle of the interactive 3D supermarket" };

/**
 * Canonical origin, no trailing slash. NEXT_PUBLIC_SITE_URL wins (set it to the final https domain);
 * on Vercel the production domain is the fallback, so canonicals never point at localhost in production.
 */
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  return "http://localhost:3000";
}

/** Absolute URL for a path or an already-absolute URL. */
export function absoluteUrl(pathOrUrl: string, site = siteUrl()): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${site}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

/** Plain-text meta description: whitespace collapsed, cut at a word boundary (≈155 chars shown by Google). */
export function metaDescription(text: string, max = 155): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–—-]+$/, "")}…`;
}

export const productPath = (slug: string) => `/catalog/${slug}`;
export const categoryPath = (slug: string) => `/category/${slug}`;

/** Search-result title for a product: admin "Google title" if set, else the name (+ category for context). */
export function productTitle(p: Product, categoryName?: string): string {
  if (p.seoTitle) return p.seoTitle;
  return categoryName ? `${p.name} · ${categoryName}` : p.name;
}

/** Search-result description: admin text, else the real product description, else a factual fallback. */
export function productDescription(p: Product, categoryName?: string): string {
  if (p.seoDescription) return metaDescription(p.seoDescription);
  if (p.description.trim()) return metaDescription(p.description);
  return metaDescription(`Buy ${p.name}${categoryName ? ` (${categoryName})` : ""} online at ${SITE_NAME}. Prices in EUR and USD, delivered across the EU and the USA.`);
}

/** Products that may be shown to search engines (published, real). */
export const isIndexable = (p: Product) => p.status === "published" && !p.isMock;

// ───────────────────────── JSON-LD ─────────────────────────

type Json = Record<string, unknown>;

/** Serialize for a <script type="application/ld+json">: "<" escaped so text can never close the tag. */
export function serializeJsonLd(data: Json | Json[]): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export const orgId = (site: string) => `${site}/#organization`;
export const websiteId = (site: string) => `${site}/#website`;

export function organizationLd(site: string, sameAs: string[] = []): Json {
  return {
    "@context": "https://schema.org",
    "@type": "OnlineStore",
    "@id": orgId(site),
    name: SITE_NAME,
    slogan: SITE_TAGLINE,
    url: `${site}/`,
    logo: absoluteUrl(LOGO_PATH, site),
    address: { "@type": "PostalAddress", addressCountry: "IT" },
    contactPoint: { "@type": "ContactPoint", contactType: "customer support", url: `${site}/contact`, availableLanguage: ["English"] },
    ...(sameAs.length ? { sameAs } : {}),
  };
}

export function websiteLd(site: string): Json {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": websiteId(site),
    name: SITE_NAME,
    alternateName: ["Wego Shiiip", "WEGO SHIIIP."],
    url: `${site}/`,
    inLanguage: "en",
    publisher: { "@id": orgId(site) },
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${site}/catalog?q={search_term_string}` },
      "query-input": "required name=search_term_string",
    },
  };
}

export function breadcrumbLd(site: string, items: { name: string; path: string }[]): Json {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: absoluteUrl(it.path, site) })),
  };
}

export interface ReviewSummary {
  count: number;
  average: number;
  reviews: { author: string; rating: number; title: string; body: string; date: string; verified: boolean }[];
}

export function productLd(site: string, p: Product, opts: { category?: Category; reviews?: ReviewSummary } = {}): Json {
  const url = absoluteUrl(productPath(p.slug), site);
  const images = (p.gallery?.length ? p.gallery.map((g) => g.url) : p.imageUrl ? [p.imageUrl] : []).map((u) => absoluteUrl(u, site));
  const offers = p.variants.flatMap((v) =>
    v.prices.map((m) => ({
      "@type": "Offer",
      sku: v.sku,
      name: p.variants.length > 1 ? `${p.name} — ${v.name}` : undefined,
      price: toDecimalString(m),
      priceCurrency: m.currency,
      availability: v.stockQuantity > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      itemCondition: "https://schema.org/NewCondition",
      url,
      // Self-contained (Google does not resolve @id references across pages).
      seller: { "@type": "Organization", "@id": orgId(site), name: SITE_NAME, url: `${site}/` },
    })),
  );
  const r = opts.reviews;
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": `${url}#product`,
    name: p.name,
    url,
    ...(p.description.trim() ? { description: p.description.trim() } : {}),
    ...(images.length ? { image: images } : {}),
    ...(p.variants[0]?.sku ? { sku: p.variants[0].sku } : {}),
    ...(p.brand ? { brand: { "@type": "Brand", name: p.brand } } : {}),
    ...(opts.category ? { category: opts.category.name } : {}),
    ...(offers.length ? { offers } : {}),
    // Only real, approved reviews (never a default or invented rating).
    ...(r && r.count > 0
      ? {
          aggregateRating: { "@type": "AggregateRating", ratingValue: Number(r.average.toFixed(2)), reviewCount: r.count, bestRating: 5, worstRating: 1 },
          review: r.reviews.slice(0, 10).map((x) => ({
            "@type": "Review",
            author: { "@type": "Person", name: x.author },
            datePublished: x.date.slice(0, 10),
            reviewRating: { "@type": "Rating", ratingValue: x.rating, bestRating: 5, worstRating: 1 },
            ...(x.title ? { name: x.title } : {}),
            ...(x.body ? { reviewBody: x.body } : {}),
          })),
        }
      : {}),
  };
}

export function itemListLd(site: string, name: string, products: Product[]): Json {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name,
    numberOfItems: products.length,
    itemListElement: products.map((p, i) => ({ "@type": "ListItem", position: i + 1, url: absoluteUrl(productPath(p.slug), site), name: p.name })),
  };
}

export function articleLd(site: string, a: { path: string; title: string; description: string; published: string; updated: string; image?: string }): Json {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: a.title,
    description: a.description,
    mainEntityOfPage: absoluteUrl(a.path, site),
    datePublished: a.published,
    dateModified: a.updated,
    inLanguage: "en",
    author: { "@id": orgId(site) },
    publisher: { "@id": orgId(site) },
    ...(a.image ? { image: absoluteUrl(a.image, site) } : {}),
  };
}
