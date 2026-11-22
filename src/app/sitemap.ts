import type { MetadataRoute } from "next";
import { getCatalog } from "@/lib/catalog/source";
import { GUIDES } from "@/lib/content/guides";
import { listPublishedPages } from "@/lib/storefront/settings";
import { absoluteUrl, categoryPath, isIndexable, productPath, siteUrl } from "@/lib/seo/site";

// Built on request, never at build time: a deploy must not depend on reaching the database
// (and the sitemap should list the products that exist now, not at the last build).
export const dynamic = "force-dynamic";

/**
 * Only canonical, indexable URLs: home, store, catalog, help, categories that hold at least one real product,
 * every published real product (never mock data), guides and published CMS pages. No filter/search URLs.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = siteUrl();
  const [{ products, categories }, pages] = await Promise.all([getCatalog(), listPublishedPages()]);
  const live = products.filter(isIndexable);
  const latest = (list: { updatedAt?: string | null }[]) => list.map((p) => p.updatedAt).filter((d): d is string => !!d).sort().at(-1);
  const catalogUpdated = latest(live);

  return [
    { url: `${site}/`, changeFrequency: "weekly", priority: 1, ...(catalogUpdated ? { lastModified: catalogUpdated } : {}) },
    { url: `${site}/catalog`, changeFrequency: "daily", priority: 0.9, ...(catalogUpdated ? { lastModified: catalogUpdated } : {}) },
    { url: `${site}/store`, changeFrequency: "weekly", priority: 0.8 },
    ...categories
      .map((c) => ({ c, items: live.filter((p) => p.categoryId === c.id) }))
      .filter(({ items }) => items.length > 0)
      .map(({ c, items }) => ({ url: `${site}${categoryPath(c.slug)}`, changeFrequency: "daily" as const, priority: 0.8, ...(latest(items) ? { lastModified: latest(items) } : {}) })),
    ...live.map((p) => ({
      url: `${site}${productPath(p.slug)}`,
      changeFrequency: "daily" as const,
      priority: 0.7,
      ...(p.updatedAt ? { lastModified: p.updatedAt } : {}),
      ...(p.gallery?.length || p.imageUrl ? { images: (p.gallery?.length ? p.gallery.map((g) => g.url) : [p.imageUrl as string]).slice(0, 10).map((u) => absoluteUrl(u, site)) } : {}),
    })),
    ...(GUIDES.length ? [{ url: `${site}/guides`, changeFrequency: "weekly" as const, priority: 0.5 }] : []),
    ...GUIDES.map((g) => ({ url: `${site}/guides/${g.slug}`, changeFrequency: "monthly" as const, priority: 0.5, lastModified: g.updated })),
    { url: `${site}/contact`, changeFrequency: "monthly", priority: 0.4 },
    ...pages.map((p) => ({ url: `${site}/pages/${p.slug}`, changeFrequency: "monthly" as const, priority: 0.3, ...(p.updatedAt ? { lastModified: p.updatedAt } : {}) })),
  ];
}
