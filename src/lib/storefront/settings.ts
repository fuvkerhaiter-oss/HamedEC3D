/**
 * Storefront-facing settings and content managed in the admin (store_settings, cms_pages).
 * Without a database every value falls back to the built-in defaults, so the storefront never breaks.
 */
import { cache } from "react";
import { cachedPublic, STOREFRONT_TAG } from "../cache/public-data";
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

async function loadStorefrontSettings(): Promise<StorefrontSettings> {
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

/** Deduplicated per request (metadata + page both ask); the page itself is ISR. */
export const getPublishedPage = cache(async (slug: string): Promise<PublishedPage | null> => {
  if (!isDbConfigured() || !/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  const [row] = await getSql()<{ slug: string; title: string; published_body: string; published_at: Date | null }[]>`
    select slug, title, published_body, published_at from public.cms_pages
     where slug = ${slug} and status = 'published' and published_body is not null`;
  return row ? { slug: row.slug, title: row.title, body: row.published_body, publishedAt: row.published_at?.toISOString() ?? null } : null;
});

async function loadPublishedPages(): Promise<{ slug: string; title: string; updatedAt: string | null }[]> {
  if (!isDbConfigured()) return [];
  try {
    // updatedAt as text: the shared cache stores JSON (a Date would come back as a string anyway).
    return await getSql()<{ slug: string; title: string; updatedAt: string | null }[]>`
      select slug, title, to_char(published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "updatedAt" from public.cms_pages where status = 'published' and published_body is not null order by title`;
  } catch {
    return [];
  }
}

// Public, identical for every visitor and read by the site layout on every page: shared server cache,
// expired immediately by the admin content/settings/page actions (expirePublicData(STOREFRONT_TAG)).
export const getStorefrontSettings = cache(cachedPublic("storefront-settings-v1", STOREFRONT_TAG, loadStorefrontSettings));
export const listPublishedPages = cache(cachedPublic("published-pages-v1", STOREFRONT_TAG, loadPublishedPages));
