/**
 * Storefront-facing settings and content managed in the admin (store_settings, cms_pages).
 * Without a database every value falls back to the built-in defaults, so the storefront never breaks.
 */
import { getSql, isDbConfigured } from "../db/client";
import { logFallback } from "../log";

export interface HomeContent {
  heroEyebrow: string;
  heroTitle: string;
  heroSubtitle: string;
  announcement: string;
}

export interface StorefrontSettings {
  stockAllFaces: boolean | undefined;
  home: HomeContent;
}

const EMPTY_HOME: HomeContent = { heroEyebrow: "", heroTitle: "", heroSubtitle: "", announcement: "" };

const str = (v: unknown, max = 400) => (typeof v === "string" ? v.slice(0, max) : "");

export async function getStorefrontSettings(): Promise<StorefrontSettings> {
  if (!isDbConfigured()) return { stockAllFaces: undefined, home: EMPTY_HOME };
  try {
    const rows = await getSql()<{ key: string; value: unknown }[]>`
      select key, value from public.store_settings where key in ('store.stock_all_faces', 'storefront.home')`;
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const home = (map.get("storefront.home") ?? {}) as Record<string, unknown>;
    const stock = map.get("store.stock_all_faces");
    return {
      stockAllFaces: typeof stock === "boolean" ? stock : undefined,
      home: {
        heroEyebrow: str(home.heroEyebrow, 80),
        heroTitle: str(home.heroTitle, 120),
        heroSubtitle: str(home.heroSubtitle, 400),
        announcement: str(home.announcement, 200),
      },
    };
  } catch (err) {
    logFallback("storefront settings unavailable", err);
    return { stockAllFaces: undefined, home: EMPTY_HOME };
  }
}

export interface PublishedPage {
  slug: string;
  title: string;
  body: string;
  publishedAt: string | null;
}

export async function getPublishedPage(slug: string): Promise<PublishedPage | null> {
  if (!isDbConfigured() || !/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  const [row] = await getSql()<{ slug: string; title: string; published_body: string; published_at: Date | null }[]>`
    select slug, title, published_body, published_at from public.cms_pages
     where slug = ${slug} and status = 'published' and published_body is not null`;
  return row ? { slug: row.slug, title: row.title, body: row.published_body, publishedAt: row.published_at?.toISOString() ?? null } : null;
}

export async function listPublishedPages(): Promise<{ slug: string; title: string }[]> {
  if (!isDbConfigured()) return [];
  try {
    return await getSql()<{ slug: string; title: string }[]>`
      select slug, title from public.cms_pages where status = 'published' and published_body is not null order by title`;
  } catch {
    return [];
  }
}
