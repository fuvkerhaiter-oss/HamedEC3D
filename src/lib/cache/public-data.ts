/**
 * Shared server cache for PUBLIC storefront data only (published catalog, storefront texts). Never use it for
 * carts, orders, customers, payments, admin data or anything that depends on who is asking.
 *
 * - Cross-request: Next's data cache (`unstable_cache`), tagged, refreshed at most every PUBLIC_DATA_TTL_S.
 * - Admin edits expire the tag immediately (`expirePublicData`), so changes show on the next request.
 * - Prices/stock for checkout and cart totals are NEVER read from here (see getCatalogReaderFor).
 */
import { revalidateTag, unstable_cache } from "next/cache";

export const CATALOG_TAG = "public:catalog";
export const STOREFRONT_TAG = "public:storefront";
/** Upper bound for how stale displayed stock can be after a customer order (admin edits expire at once). */
export const PUBLIC_DATA_TTL_S = 60;

/** Outside a Next.js server (unit/integration tests, scripts) there is no data cache: call through. */
function noNextCache(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith("Invariant: incrementalCache missing");
}

export function cachedPublic<T>(key: string, tag: string, load: () => Promise<T>): () => Promise<T> {
  const cached = unstable_cache(load, [key], { revalidate: PUBLIC_DATA_TTL_S, tags: [tag] });
  return async () => {
    try {
      return await cached();
    } catch (err) {
      if (noNextCache(err)) return load();
      throw err; // load errors are never cached
    }
  };
}

/** Expire public data now (server actions and route handlers). Safe to call outside Next (no-op). */
export function expirePublicData(...tags: string[]): void {
  for (const tag of tags) {
    try {
      revalidateTag(tag, { expire: 0 });
    } catch (err) {
      if (!(err instanceof Error && err.message.includes("static generation store missing"))) throw err;
    }
  }
}
