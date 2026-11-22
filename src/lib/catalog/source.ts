/**
 * Server-side catalog loader. Source, in order of preference:
 *  1. DATABASE_URL (direct Postgres — the same tables the admin dashboard edits),
 *  2. Supabase REST (public RLS, publishable key),
 *  3. the labelled mock catalog (no backend configured).
 */
import { cache } from "react";
import { createClient } from "@supabase/supabase-js";
import { CATALOG_TAG, cachedPublic } from "../cache/public-data";
import { createCatalogReader, MOCK_CATEGORIES, MOCK_PRODUCTS } from "./mock-catalog";
import { mapProductRow, PRODUCT_SELECT, type ProductRow } from "./source-map";
import { loadCatalogSql } from "./sql-source";
import { getSql, isDbConfigured } from "../db/client";
import type { CatalogReader, Category, Product } from "./types";
import { isDbUnreachable, logFallback } from "../log";

export interface CatalogData {
  categories: Category[];
  products: Product[];
  source: "database" | "supabase" | "mock";
}

export { DEFAULT_PLACEHOLDER_HEIGHT_M } from "./source-map";

function supabaseConfig(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url, key } : null;
}

/** Uncached read from the configured backend (throws on backend errors). */
async function loadCatalog(variantIds?: readonly string[]): Promise<CatalogData> {
  if (isDbConfigured()) {
    return { ...(await loadCatalogSql(getSql(), process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", variantIds)), source: "database" };
  }
  const cfg = supabaseConfig();
  if (!cfg) return { categories: MOCK_CATEGORIES, products: MOCK_PRODUCTS, source: "mock" };

  const sb = createClient(cfg.url, cfg.key, { auth: { persistSession: false, autoRefreshToken: false } });
  const [cats, prods] = await Promise.all([
    sb.from("categories").select("id,slug,name,sort_order").eq("is_active", true).order("sort_order"),
    sb.from("products").select(PRODUCT_SELECT).eq("status", "published").is("deleted_at", null).order("name"),
  ]);
  const hint = (msg: string) =>
    /schema cache|does not exist/i.test(msg)
      ? `${msg}. The Supabase project at NEXT_PUBLIC_SUPABASE_URL has no catalog schema: apply supabase/migrations to it (supabase db push), or point the env vars at the migrated project.`
      : msg;
  if (cats.error) throw new Error(`Failed to load categories: ${hint(cats.error.message)}`);
  if (prods.error) throw new Error(`Failed to load products: ${hint(prods.error.message)}`);

  const categories: Category[] = ((cats.data ?? []) as { id: unknown; slug: unknown; name: unknown }[]).map((c) => ({ id: String(c.id), slug: String(c.slug), name: String(c.name) }));
  const products = ((prods.data ?? []) as unknown as ProductRow[]).map((r) => mapProductRow(r, cfg.url));
  return { categories, products, source: "supabase" };
}

// The published catalog is public data: one backend read per PUBLIC_DATA_TTL_S (or per admin edit), shared by
// every visitor, instead of one per page view / metadata call / sitemap hit.
const loadCatalogCached = cachedPublic("catalog-v1", CATALOG_TAG, () => loadCatalog());

/** Public storefront catalog (display only). Deduplicated per request (React cache) and cached across requests. */
export const getCatalog = cache(async (): Promise<CatalogData> => {
  try {
    return await loadCatalogCached();
  } catch (err) {
    if (!isDbConfigured()) throw err;
    // `next build` must not depend on reaching the database: pages prerendered now are built without
    // products and fill in on their first revalidation. Never mock data in a production build.
    if (process.env.NEXT_PHASE === "phase-production-build" && isDbUnreachable(err)) {
      console.warn("[catalog] database not reachable during build — prerendering without products; pages refresh on revalidation.");
      return { categories: [], products: [], source: "database" };
    }
    // Production must surface DB failures. In development (local DB not running) keep the storefront usable.
    if (process.env.NODE_ENV === "production") throw err;
    logFallback("catalog", err);
    return { categories: MOCK_CATEGORIES, products: MOCK_PRODUCTS, source: "mock" };
  }
});

/**
 * Fresh reader for server-side pricing: always re-reads prices and stock (never cached). With variant ids, only
 * the products owning those variants are read — cart pricing sends a few ids, no need to pull the whole catalog.
 */
export async function getCatalogReader(variantIds?: readonly string[]): Promise<CatalogReader> {
  try {
    return createCatalogReader((await loadCatalog(variantIds)).products);
  } catch (err) {
    if (!isDbConfigured() || process.env.NODE_ENV === "production") throw err;
    logFallback("catalog", err);
    return createCatalogReader(MOCK_PRODUCTS);
  }
}
