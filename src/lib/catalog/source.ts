/**
 * Server-side catalog loader. Source, in order of preference:
 *  1. DATABASE_URL (direct Postgres — the same tables the admin dashboard edits),
 *  2. Supabase REST (public RLS, publishable key),
 *  3. the labelled mock catalog (no backend configured).
 */
import { createClient } from "@supabase/supabase-js";
import { createCatalogReader, MOCK_CATEGORIES, MOCK_PRODUCTS } from "./mock-catalog";
import { mapProductRow, PRODUCT_SELECT, type ProductRow } from "./source-map";
import { loadCatalogSql } from "./sql-source";
import { getSql, isDbConfigured } from "../db/client";
import type { CatalogReader, Category, Product } from "./types";
import { logFallback } from "../log";

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

export async function getCatalog(): Promise<CatalogData> {
  if (isDbConfigured()) {
    try {
      const data = await loadCatalogSql(getSql(), process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
      return { ...data, source: "database" };
    } catch (err) {
      // Production must surface DB failures. In development (local DB not running) keep the storefront usable.
      if (process.env.NODE_ENV === "production") throw err;
      logFallback("catalog", err);
      return { categories: MOCK_CATEGORIES, products: MOCK_PRODUCTS, source: "mock" };
    }
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

/** Fresh reader for server-side pricing (always re-reads prices and stock). */
export async function getCatalogReader(): Promise<CatalogReader> {
  return createCatalogReader((await getCatalog()).products);
}
