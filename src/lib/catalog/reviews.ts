/**
 * Approved customer reviews for a product page (Admin → Reviews moderates them). Public data: shared server
 * cache, refreshed with the catalog. Returns nothing (never an invented rating) without a database or reviews.
 */
import { cache } from "react";
import { CATALOG_TAG, cachedPublic } from "../cache/public-data";
import { getSql, isDbConfigured } from "../db/client";
import { logFallback } from "../log";
import type { ReviewSummary } from "../seo/site";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMPTY: ReviewSummary = { count: 0, average: 0, reviews: [] };

async function loadReviews(productId: string): Promise<ReviewSummary> {
  if (!isDbConfigured() || !UUID.test(productId)) return EMPTY;
  try {
    const sql = getSql();
    const [agg] = await sql<{ count: number; average: string | null }[]>`
      select count(*)::int as count, avg(rating)::text as average from public.reviews where product_id = ${productId} and status = 'approved'`;
    if (!agg || agg.count === 0) return EMPTY;
    const rows = await sql<{ author: string; rating: number; title: string; body: string; date: string; verified: boolean }[]>`
      select author_name as author, rating, title, body, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD') as date, is_verified_purchase as verified
        from public.reviews where product_id = ${productId} and status = 'approved' order by created_at desc limit 10`;
    return { count: agg.count, average: Number(agg.average ?? 0), reviews: rows.map((r) => ({ ...r })) };
  } catch (err) {
    logFallback("reviews unavailable", err);
    return EMPTY;
  }
}

export const getProductReviews = cache((productId: string) => cachedPublic(`reviews-v1:${productId}`, CATALOG_TAG, () => loadReviews(productId))());
