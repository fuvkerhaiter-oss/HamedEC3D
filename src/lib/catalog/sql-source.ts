/**
 * Catalog loader over a direct Postgres connection (DATABASE_URL). Produces the same row shape as the
 * PostgREST select so `mapProductRow` is shared. Reads exactly the tables the admin edits.
 */
import type { Db } from "../db/client";
import { mapProductRow, type ProductRow } from "./source-map";
import type { Category, Product } from "./types";

/** With `variantIds`, only products owning one of those variants are returned (cart pricing). */
export async function loadCatalogSql(db: Db, supabaseUrl: string, variantIds?: readonly string[]): Promise<{ categories: Category[]; products: Product[] }> {
  const only = variantIds ? [...new Set(variantIds)].slice(0, 500) : null;
  if (only && only.length === 0) return { categories: [], products: [] };
  // Pricing reads (variant filter) do not need the category list.
  const cats = only ? [] : await db<{ id: string; slug: string; name: string; description: string }[]>`
    select id, slug, name, description from public.categories where is_active order by sort_order, name`;
  const rows = await db<{ row: ProductRow }[]>`
    select json_build_object(
      'id', p.id, 'slug', p.slug, 'name', p.name, 'description', p.description, 'status', p.status,
      'is_mock', p.is_mock, 'category_id', p.category_id,
      'brand', p.brand, 'seo_title', p.seo_title, 'seo_description', p.seo_description, 'updated_at', p.updated_at,
      'product_variants', coalesce((
        select json_agg(json_build_object(
          'id', v.id, 'sku', v.sku, 'name', v.name, 'attributes', v.attributes, 'is_active', v.is_active, 'sort_order', v.sort_order,
          'variant_prices', coalesce((select json_agg(json_build_object('currency', vp.currency, 'amount', vp.amount))
                                        from public.variant_prices vp where vp.variant_id = v.id), '[]'::json),
          'inventory', (select json_build_object('quantity', i.quantity, 'reserved', i.reserved) from public.inventory i where i.variant_id = v.id)))
        from public.product_variants v where v.product_id = p.id), '[]'::json),
      'product_3d_assets', coalesce((select json_agg(json_build_object('storage_path', a.storage_path, 'height_m', a.height_m, 'is_primary', a.is_primary))
                                      from public.product_3d_assets a where a.product_id = p.id), '[]'::json),
      'product_images', coalesce((select json_agg(json_build_object('storage_path', im.storage_path, 'alt', im.alt, 'sort_order', im.sort_order,
                                     'bucket', im.bucket, 'is_primary', im.is_primary, 'width', im.width, 'height', im.height))
                                   from public.product_images im where im.product_id = p.id), '[]'::json),
      'product_shelf_placements', (select json_build_object('face_id', sp.face_id, 'priority', sp.priority, 'hidden_in_store', sp.hidden_in_store)
                                     from public.product_shelf_placements sp where sp.product_id = p.id)
    ) as row
    from public.products p
    left join public.categories c on c.id = p.category_id
    where p.status = 'published' and p.deleted_at is null and (c.id is null or c.is_active)
      ${only ? db`and exists (select 1 from public.product_variants fv where fv.product_id = p.id and fv.id::text = any(${only}))` : db``}
    order by p.name`;
  return {
    categories: cats.map((c) => ({ id: c.id, slug: c.slug, name: c.name, description: c.description ?? "" })),
    products: rows.map((r) => mapProductRow(r.row, supabaseUrl)),
  };
}
