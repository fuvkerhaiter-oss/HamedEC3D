import type { MetadataRoute } from "next";
import { getCatalog } from "@/lib/catalog/source";
import { listPublishedPages } from "@/lib/storefront/settings";

// Built on request, never at build time: a deploy must not depend on reaching the database
// (and the sitemap should list the products that exist now, not at the last build).
export const dynamic = "force-dynamic";

/** Home, store, catalog, help, every published product (never mock data) and published CMS page. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const [{ products }, pages] = await Promise.all([getCatalog(), listPublishedPages()]);
  return [
    { url: `${site}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${site}/catalog`, changeFrequency: "daily", priority: 0.9 },
    { url: `${site}/store`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${site}/contact`, changeFrequency: "monthly", priority: 0.4 },
    ...products
      .filter((p) => p.status === "published" && !p.isMock)
      .map((p) => ({ url: `${site}/catalog/${p.slug}`, changeFrequency: "daily" as const, priority: 0.7, images: p.imageUrl ? [p.imageUrl] : undefined })),
    ...pages.map((p) => ({ url: `${site}/pages/${p.slug}`, changeFrequency: "monthly" as const, priority: 0.3 })),
  ];
}
