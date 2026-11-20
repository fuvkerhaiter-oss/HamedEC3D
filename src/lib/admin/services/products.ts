/**
 * Product management on the SAME tables the catalog and 3D store read (products, product_variants,
 * variant_prices, inventory, product_images, product_3d_assets, supplier_products, product_shelf_placements).
 */
import { csvObjects, toCsv } from "../../csv";
import { inTx, type Db, type Tx } from "../../db/client";
import { fromDecimalString, toDecimalString, type CurrencyCode } from "../../money";
import { logActivity, type Actor } from "../audit";

export class ProductError extends Error {
  override name = "ProductError";
}

export type ProductStatus = "draft" | "published" | "archived";

export interface ProductListFilters {
  q?: string;
  status?: ProductStatus | "deleted";
  categoryId?: string;
  stock?: "low" | "out";
  page?: number;
  pageSize?: number;
}

export interface ProductListRow {
  id: string;
  slug: string;
  name: string;
  status: ProductStatus;
  is_mock: boolean;
  is_featured: boolean;
  category_name: string | null;
  variant_count: number;
  available: number;
  min_price_eur: number | null;
  min_price_usd: number | null;
  image_path: string | null;
  updated_at: Date;
  deleted_at: Date | null;
}

export async function listProducts(db: Db, f: ProductListFilters): Promise<{ rows: ProductListRow[]; total: number }> {
  const pageSize = Math.min(f.pageSize ?? 25, 200);
  const page = Math.max(1, f.page ?? 1);
  const q = f.q?.trim() ?? "";
  const status = f.status ?? null;
  const where = db`
    where (case when ${status}::text = 'deleted' then p.deleted_at is not null else p.deleted_at is null end)
      and (${status}::text is null or ${status}::text = 'deleted' or p.status::text = ${status})
      and (${f.categoryId ?? null}::uuid is null or p.category_id = ${f.categoryId ?? null})
      and (${q} = '' or p.name ilike ${"%" + q + "%"} or p.slug ilike ${"%" + q + "%"}
           or exists (select 1 from public.product_variants v where v.product_id = p.id and (v.sku ilike ${"%" + q + "%"} or v.barcode = ${q})))
      and (${f.stock ?? null}::text is null
           or (${f.stock ?? null} = 'out' and not exists (select 1 from public.product_variants v join public.inventory i on i.variant_id = v.id where v.product_id = p.id and v.is_active and i.quantity - i.reserved > 0))
           or (${f.stock ?? null} = 'low' and exists (select 1 from public.product_variants v join public.inventory i on i.variant_id = v.id
                 where v.product_id = p.id and v.is_active and i.quantity - i.reserved <= coalesce(i.low_stock_threshold, 5))))`;
  const [count] = await db<{ n: number }[]>`select count(*)::int as n from public.products p ${where}`;
  const rows = await db<ProductListRow[]>`
    select p.id, p.slug, p.name, p.status, p.is_mock, p.is_featured, p.updated_at, p.deleted_at, c.name as category_name,
      (select count(*)::int from public.product_variants v where v.product_id = p.id and v.is_active) as variant_count,
      (select coalesce(sum(greatest(i.quantity - i.reserved, 0)), 0)::int from public.product_variants v join public.inventory i on i.variant_id = v.id where v.product_id = p.id and v.is_active) as available,
      (select min(vp.amount) from public.product_variants v join public.variant_prices vp on vp.variant_id = v.id where v.product_id = p.id and v.is_active and vp.currency = 'EUR') as min_price_eur,
      (select min(vp.amount) from public.product_variants v join public.variant_prices vp on vp.variant_id = v.id where v.product_id = p.id and v.is_active and vp.currency = 'USD') as min_price_usd,
      (select im.storage_path from public.product_images im where im.product_id = p.id order by im.sort_order limit 1) as image_path
    from public.products p left join public.categories c on c.id = p.category_id
    ${where}
    order by p.updated_at desc limit ${pageSize} offset ${(page - 1) * pageSize}`;
  return { rows, total: count?.n ?? 0 };
}

export interface VariantDetail {
  id: string;
  sku: string;
  name: string;
  attributes: Record<string, string>;
  is_active: boolean;
  sort_order: number;
  weight_grams: number | null;
  barcode: string | null;
  price_eur: number | null;
  compare_eur: number | null;
  price_usd: number | null;
  compare_usd: number | null;
  quantity: number;
  reserved: number;
  incoming: number;
  low_stock_threshold: number | null;
  supplier_id: string | null;
  supplier_sku: string | null;
  cost_amount: number | null;
  cost_currency: CurrencyCode | null;
  ordered: boolean;
}

export async function getProductDetail(db: Db, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [product] = await db<{
    id: string; slug: string; name: string; description: string; category_id: string | null; status: ProductStatus; is_mock: boolean;
    brand: string | null; tags: string[]; seo_title: string | null; seo_description: string | null; is_featured: boolean;
    published_at: Date | null; created_at: Date; updated_at: Date; deleted_at: Date | null;
  }[]>`select * from public.products where id = ${id}`;
  if (!product) return null;
  const [variants, images, assets, placement, orderCount] = await Promise.all([
    db<VariantDetail[]>`
      select v.id, v.sku, v.name, v.attributes, v.is_active, v.sort_order, v.weight_grams, v.barcode,
        pe.amount as price_eur, pe.compare_at_amount as compare_eur, pu.amount as price_usd, pu.compare_at_amount as compare_usd,
        coalesce(i.quantity, 0) as quantity, coalesce(i.reserved, 0) as reserved, coalesce(i.incoming, 0) as incoming, i.low_stock_threshold,
        sp.supplier_id, sp.supplier_sku, sp.cost_amount, sp.cost_currency,
        exists (select 1 from public.order_items oi where oi.variant_id = v.id) as ordered
      from public.product_variants v
      left join public.variant_prices pe on pe.variant_id = v.id and pe.currency = 'EUR'
      left join public.variant_prices pu on pu.variant_id = v.id and pu.currency = 'USD'
      left join public.inventory i on i.variant_id = v.id
      left join public.supplier_products sp on sp.variant_id = v.id and sp.is_primary
      where v.product_id = ${id} order by v.sort_order, v.name`,
    db<{ id: string; storage_path: string; alt: string; sort_order: number }[]>`select * from public.product_images where product_id = ${id} order by sort_order`,
    db<{ id: string; storage_path: string; height_m: string; is_primary: boolean }[]>`select id, storage_path, height_m::text, is_primary from public.product_3d_assets where product_id = ${id}`,
    db<{ face_id: string | null; priority: number; hidden_in_store: boolean }[]>`select face_id, priority, hidden_in_store from public.product_shelf_placements where product_id = ${id}`,
    db<{ n: number }[]>`select count(distinct oi.order_id)::int as n from public.order_items oi join public.product_variants v on v.id = oi.variant_id where v.product_id = ${id}`,
  ]);
  return { product, variants, images, assets, placement: placement[0] ?? null, orderCount: orderCount[0]?.n ?? 0 };
}

export const slugify = (s: string) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

export interface ProductInput {
  id?: string;
  name: string;
  slug?: string;
  description: string;
  categoryId: string | null;
  brand: string | null;
  tags: string[];
  seoTitle: string | null;
  seoDescription: string | null;
  isFeatured: boolean;
}

export async function saveProduct(db: Db, actor: Actor, input: ProductInput): Promise<string> {
  const slug = slugify(input.slug || input.name);
  if (!slug) throw new ProductError("Name or slug must contain letters or digits");
  const vals = {
    name: input.name.trim(), slug, description: input.description, category_id: input.categoryId, brand: input.brand,
    tags: input.tags, seo_title: input.seoTitle, seo_description: input.seoDescription, is_featured: input.isFeatured,
  };
  return inTx(db, async (tx) => {
    if (input.id) {
      const [before] = await tx`select name, slug, description, category_id, brand, tags, seo_title, seo_description, is_featured from public.products where id = ${input.id} and deleted_at is null for update`;
      if (!before) throw new ProductError("Product not found");
      await tx`update public.products set ${tx(vals)} where id = ${input.id}`;
      await logActivity(tx, actor, { action: "product.update", entity: "product", entityId: input.id, summary: `Updated ${vals.name}`, before, after: vals });
      return input.id;
    }
    const [row] = await tx<{ id: string }[]>`insert into public.products ${tx({ ...vals, status: "draft" })} returning id`;
    await logActivity(tx, actor, { action: "product.create", entity: "product", entityId: row!.id, summary: `Created ${vals.name}`, after: vals });
    return row!.id;
  });
}

export interface VariantInput {
  id?: string;
  productId: string;
  sku: string;
  name: string;
  attributes: Record<string, string>;
  isActive: boolean;
  sortOrder: number;
  weightGrams: number | null;
  barcode: string | null;
  priceEur: number | null;
  compareEur: number | null;
  priceUsd: number | null;
  compareUsd: number | null;
  lowStockThreshold: number | null;
  initialStock?: number; // only for new variants (logged as a movement)
  supplier: { supplierId: string; supplierSku: string; costAmount: number; costCurrency: CurrencyCode } | null;
}

async function upsertPrice(tx: Tx, variantId: string, currency: CurrencyCode, amount: number | null, compare: number | null) {
  if (amount === null) {
    await tx`delete from public.variant_prices where variant_id = ${variantId} and currency = ${currency}`;
    return;
  }
  if (compare !== null && compare <= amount) throw new ProductError(`Compare-at price (${currency}) must be higher than the price`);
  await tx`insert into public.variant_prices (variant_id, currency, amount, compare_at_amount) values (${variantId}, ${currency}, ${amount}, ${compare})
           on conflict (variant_id, currency) do update set amount = excluded.amount, compare_at_amount = excluded.compare_at_amount`;
}

export async function saveVariant(db: Db, actor: Actor, v: VariantInput): Promise<string> {
  return inTx(db, async (tx) => {
    const vals = {
      product_id: v.productId, sku: v.sku.trim(), name: v.name.trim(), attributes: tx.json(v.attributes), is_active: v.isActive,
      sort_order: v.sortOrder, weight_grams: v.weightGrams, barcode: v.barcode,
    };
    let id = v.id;
    let before: unknown = null;
    if (id) {
      [before] = await tx`select sku, name, is_active, weight_grams, barcode from public.product_variants where id = ${id} and product_id = ${v.productId} for update`;
      if (!before) throw new ProductError("Variant not found");
      await tx`update public.product_variants set ${tx(vals)} where id = ${id}`;
    } else {
      id = (await tx<{ id: string }[]>`insert into public.product_variants ${tx(vals)} returning id`)[0]!.id;
      await tx`insert into public.inventory (variant_id, quantity) values (${id}, 0) on conflict do nothing`;
      if (v.initialStock && v.initialStock > 0) {
        await tx`select public.admin_adjust_inventory(${id}, ${v.initialStock}, ${"Initial stock"}, ${actor.id}, 'adjustment')`;
      }
    }
    await upsertPrice(tx, id, "EUR", v.priceEur, v.compareEur);
    await upsertPrice(tx, id, "USD", v.priceUsd, v.compareUsd);
    await tx`update public.inventory set low_stock_threshold = ${v.lowStockThreshold} where variant_id = ${id}`;
    if (v.supplier) {
      await tx`update public.supplier_products set is_primary = false where variant_id = ${id} and supplier_id <> ${v.supplier.supplierId}`;
      await tx`insert into public.supplier_products (supplier_id, variant_id, supplier_sku, cost_amount, cost_currency, is_primary)
               values (${v.supplier.supplierId}, ${id}, ${v.supplier.supplierSku}, ${v.supplier.costAmount}, ${v.supplier.costCurrency}, true)
               on conflict (supplier_id, supplier_sku) do update set variant_id = excluded.variant_id, cost_amount = excluded.cost_amount,
                 cost_currency = excluded.cost_currency, is_primary = true`;
    }
    await tx`update public.products set updated_at = now() where id = ${v.productId}`;
    await logActivity(tx, actor, {
      action: v.id ? "variant.update" : "variant.create", entity: "product", entityId: v.productId,
      summary: `${v.id ? "Updated" : "Added"} variant ${v.sku}`, before, after: { ...v, attributes: v.attributes },
    });
    return id;
  });
}

/** Ordered variants are deactivated (order history keeps them); never-ordered ones are deleted. */
export async function removeVariant(db: Db, actor: Actor, productId: string, variantId: string): Promise<"deleted" | "deactivated"> {
  return inTx(db, async (tx) => {
    const [v] = await tx<{ sku: string; ordered: boolean; reserved: number }[]>`
      select v.sku, exists (select 1 from public.order_items oi where oi.variant_id = v.id) as ordered, coalesce(i.reserved, 0) as reserved
        from public.product_variants v left join public.inventory i on i.variant_id = v.id where v.id = ${variantId} and v.product_id = ${productId}`;
    if (!v) throw new ProductError("Variant not found");
    if (v.reserved > 0) throw new ProductError("Units of this variant are reserved by open orders");
    const result = v.ordered ? "deactivated" : "deleted";
    if (v.ordered) await tx`update public.product_variants set is_active = false where id = ${variantId}`;
    else await tx`delete from public.product_variants where id = ${variantId}`;
    await logActivity(tx, actor, { action: `variant.${result}`, entity: "product", entityId: productId, summary: `Variant ${v.sku} ${result}` });
    return result;
  });
}

/** Problems that block publishing (shown in the UI). */
export async function publishProblems(db: Db, productId: string): Promise<string[]> {
  const [p] = await db<{ name: string; category_id: string | null; active: number; priced: number }[]>`
    select p.name, p.category_id,
      (select count(*)::int from public.product_variants v where v.product_id = p.id and v.is_active) as active,
      (select count(*)::int from public.product_variants v where v.product_id = p.id and v.is_active
         and exists (select 1 from public.variant_prices vp where vp.variant_id = v.id)) as priced
    from public.products p where p.id = ${productId}`;
  if (!p) return ["Product not found"];
  const out: string[] = [];
  if (!p.category_id) out.push("Choose a category");
  if (p.active === 0) out.push("Add at least one active variant");
  else if (p.priced < p.active) out.push("Every active variant needs a price in at least one currency");
  return out;
}

export async function setProductStatus(db: Db, actor: Actor, ids: string[], status: ProductStatus): Promise<{ changed: number; skipped: string[] }> {
  const skipped: string[] = [];
  let changed = 0;
  await inTx(db, async (tx) => {
    for (const id of ids) {
      if (status === "published") {
        const problems = await publishProblems(tx, id);
        if (problems.length) {
          skipped.push(`${id}: ${problems.join(", ")}`);
          continue;
        }
      }
      const [row] = await tx<{ name: string; status: string }[]>`
        update public.products p set status = ${status},
          published_at = case when ${status} = 'published' then coalesce(p.published_at, now()) else p.published_at end,
          archived_at = case when ${status} = 'archived' then now() else null end
        from (select status as old_status from public.products where id = ${id}) old
        where p.id = ${id} and p.deleted_at is null returning p.name, old.old_status as status`;
      if (!row) continue;
      changed++;
      await logActivity(tx, actor, { action: "product.status", entity: "product", entityId: id, summary: `${row.name}: ${row.status} → ${status}`, before: { status: row.status }, after: { status } });
    }
  });
  return { changed, skipped };
}

/** Soft delete (kept for order history, hidden everywhere) when ordered; hard delete otherwise. */
export async function deleteProducts(db: Db, actor: Actor, ids: string[]): Promise<{ soft: number; hard: number }> {
  let soft = 0, hard = 0;
  await inTx(db, async (tx) => {
    for (const id of ids) {
      const [p] = await tx<{ name: string; ordered: boolean; reserved: number }[]>`
        select p.name,
          exists (select 1 from public.order_items oi join public.product_variants v on v.id = oi.variant_id where v.product_id = p.id) as ordered,
          (select coalesce(sum(i.reserved), 0)::int from public.product_variants v join public.inventory i on i.variant_id = v.id where v.product_id = p.id) as reserved
        from public.products p where p.id = ${id} and p.deleted_at is null for update`;
      if (!p) continue;
      if (p.reserved > 0) throw new ProductError(`${p.name} has stock reserved by open orders`);
      if (p.ordered) {
        await tx`update public.products set deleted_at = now(), status = 'archived', archived_at = now() where id = ${id}`;
        soft++;
      } else {
        await tx`delete from public.products where id = ${id}`;
        hard++;
      }
      await logActivity(tx, actor, { action: p.ordered ? "product.soft_delete" : "product.delete", entity: "product", entityId: id, summary: `Deleted ${p.name}${p.ordered ? " (kept for order history)" : ""}` });
    }
  });
  return { soft, hard };
}

export async function restoreProduct(db: Db, actor: Actor, id: string) {
  await db`update public.products set deleted_at = null, status = 'draft' where id = ${id}`;
  await logActivity(db, actor, { action: "product.restore", entity: "product", entityId: id, summary: "Restored product as draft" });
}

export async function bulkSetCategory(db: Db, actor: Actor, ids: string[], categoryId: string | null) {
  await db`update public.products set category_id = ${categoryId} where id = any(${ids}::uuid[]) and deleted_at is null`;
  await logActivity(db, actor, { action: "product.bulk_category", entity: "product", summary: `Moved ${ids.length} products to another category`, after: { ids, categoryId } });
}

export async function savePlacement(db: Db, actor: Actor, productId: string, p: { faceId: string | null; priority: number; hiddenInStore: boolean }) {
  await db`
    insert into public.product_shelf_placements (product_id, face_id, priority, hidden_in_store, updated_at)
    values (${productId}, ${p.faceId}, ${p.priority}, ${p.hiddenInStore}, now())
    on conflict (product_id) do update set face_id = excluded.face_id, priority = excluded.priority, hidden_in_store = excluded.hidden_in_store, updated_at = now()`;
  await logActivity(db, actor, { action: "product.placement", entity: "product", entityId: productId, summary: `3D shelf: ${p.hiddenInStore ? "hidden" : p.faceId ?? "automatic"}`, after: p });
}

// ───────────────────────── CSV import / export ─────────────────────────

export const PRODUCT_CSV_HEADERS = [
  "product_slug", "product_name", "category_slug", "status", "description", "brand", "tags",
  "variant_sku", "variant_name", "price_eur", "price_usd", "stock", "weight_grams", "barcode",
] as const;

export async function exportProductsCsv(db: Db): Promise<string> {
  const rows = await db<Record<string, string | number | null>[]>`
    select p.slug as product_slug, p.name as product_name, c.slug as category_slug, p.status::text as status, p.description, p.brand,
      array_to_string(p.tags, ';') as tags, v.sku as variant_sku, v.name as variant_name,
      pe.amount as price_eur, pu.amount as price_usd, coalesce(i.quantity, 0) as stock, v.weight_grams, v.barcode
    from public.products p
    join public.product_variants v on v.product_id = p.id
    left join public.categories c on c.id = p.category_id
    left join public.variant_prices pe on pe.variant_id = v.id and pe.currency = 'EUR'
    left join public.variant_prices pu on pu.variant_id = v.id and pu.currency = 'USD'
    left join public.inventory i on i.variant_id = v.id
    where p.deleted_at is null order by p.slug, v.sort_order`;
  return toCsv(PRODUCT_CSV_HEADERS, rows.map((r) => PRODUCT_CSV_HEADERS.map((h) => {
    const v = r[h];
    if ((h === "price_eur" || h === "price_usd") && typeof v === "number") return toDecimalString({ amount: v, currency: h === "price_eur" ? "EUR" : "USD" });
    return v;
  })));
}

export interface ImportReport {
  created: number;
  updated: number;
  errors: { row: number; message: string }[];
  dryRun: boolean;
}

/**
 * Upsert by product_slug + variant_sku. Validates every row first; with any error nothing is written
 * (all-or-nothing). Stock changes are logged as inventory movements ("CSV import"). Imported products stay draft
 * unless the status column says otherwise and the product passes publish checks.
 */
export async function importProductsCsv(db: Db, actor: Actor, text: string, dryRun: boolean): Promise<ImportReport> {
  const rows = csvObjects(text);
  const report: ImportReport = { created: 0, updated: 0, errors: [], dryRun };
  if (rows.length === 0) {
    report.errors.push({ row: 0, message: "No data rows" });
    return report;
  }
  if (rows.length > 5000) {
    report.errors.push({ row: 0, message: "At most 5000 rows per import" });
    return report;
  }
  const cats = new Map((await db<{ id: string; slug: string }[]>`select id, slug from public.categories`).map((c) => [c.slug, c.id]));
  const parsed = rows.map((r, i) => {
    const row = i + 2;
    const err = (message: string) => report.errors.push({ row, message });
    const slug = slugify(r.product_slug || r.product_name || "");
    if (!slug) err("product_slug or product_name is required");
    if (!r.variant_sku) err("variant_sku is required");
    const status = (r.status || "draft") as ProductStatus;
    if (!["draft", "published", "archived"].includes(status)) err(`status must be draft, published or archived`);
    const money = (v: string | undefined, c: CurrencyCode) => {
      if (!v) return null;
      try {
        const m = fromDecimalString(v, c);
        if (m.amount < 0) throw new Error();
        return m.amount;
      } catch {
        err(`Invalid ${c} price "${v}"`);
        return null;
      }
    };
    const int = (v: string | undefined, label: string) => {
      if (!v) return null;
      if (!/^\d+$/.test(v)) {
        err(`${label} must be a whole number ≥ 0`);
        return null;
      }
      return Number(v);
    };
    const categoryId = r.category_slug ? cats.get(r.category_slug) ?? null : null;
    if (r.category_slug && !categoryId) err(`Unknown category_slug "${r.category_slug}"`);
    return {
      slug, name: r.product_name || slug, categoryId, status, description: r.description ?? "", brand: r.brand || null,
      tags: (r.tags ?? "").split(";").map((t) => t.trim()).filter(Boolean),
      sku: r.variant_sku ?? "", variantName: r.variant_name || "Default",
      priceEur: money(r.price_eur, "EUR"), priceUsd: money(r.price_usd, "USD"),
      stock: int(r.stock, "stock"), weight: int(r.weight_grams, "weight_grams"), barcode: r.barcode || null,
    };
  });
  const skus = new Set<string>();
  parsed.forEach((p, i) => {
    if (skus.has(p.sku)) report.errors.push({ row: i + 2, message: `Duplicate variant_sku ${p.sku} in file` });
    skus.add(p.sku);
  });
  if (report.errors.length) return report;

  const run = async (tx: Tx) => {
    const touched = new Map<string, ProductStatus>();
    for (const p of parsed) {
      let [prod] = await tx<{ id: string }[]>`select id from public.products where slug = ${p.slug} and deleted_at is null`;
      if (!prod) {
        [prod] = await tx<{ id: string }[]>`insert into public.products (slug, name, description, category_id, brand, tags, status)
          values (${p.slug}, ${p.name}, ${p.description}, ${p.categoryId}, ${p.brand}, ${p.tags}, 'draft') returning id`;
        report.created++;
      } else {
        await tx`update public.products set name = ${p.name}, description = ${p.description}, category_id = coalesce(${p.categoryId}, category_id),
                   brand = ${p.brand}, tags = ${p.tags} where id = ${prod.id}`;
        report.updated++;
      }
      touched.set(prod!.id, p.status);
      let [variant] = await tx<{ id: string; product_id: string }[]>`select id, product_id from public.product_variants where sku = ${p.sku}`;
      if (variant && variant.product_id !== prod!.id) throw new ProductError(`SKU ${p.sku} belongs to another product`);
      if (!variant) {
        [variant] = await tx<{ id: string; product_id: string }[]>`insert into public.product_variants (product_id, sku, name, weight_grams, barcode)
          values (${prod!.id}, ${p.sku}, ${p.variantName}, ${p.weight}, ${p.barcode}) returning id, product_id`;
        await tx`insert into public.inventory (variant_id, quantity) values (${variant!.id}, 0) on conflict do nothing`;
      } else {
        await tx`update public.product_variants set name = ${p.variantName}, weight_grams = ${p.weight}, barcode = ${p.barcode} where id = ${variant.id}`;
      }
      if (p.priceEur !== null) await upsertPrice(tx, variant!.id, "EUR", p.priceEur, null);
      if (p.priceUsd !== null) await upsertPrice(tx, variant!.id, "USD", p.priceUsd, null);
      if (p.stock !== null) {
        const [inv] = await tx<{ quantity: number }[]>`select quantity from public.inventory where variant_id = ${variant!.id}`;
        if (inv?.quantity !== p.stock) await tx`select public.admin_adjust_inventory(${variant!.id}, ${p.stock}, ${"CSV import"}, ${actor.id}, 'import')`;
      }
    }
    for (const [id, status] of touched) {
      if (status === "published" && (await publishProblems(tx, id)).length) continue;
      await tx`update public.products set status = ${status}, published_at = case when ${status} = 'published' then coalesce(published_at, now()) else published_at end where id = ${id}`;
    }
    await logActivity(tx, actor, { action: "product.import", entity: "product", summary: `CSV import: ${report.created} created, ${report.updated} updated rows` });
    if (dryRun) throw new DryRunRollback();
  };
  try {
    await inTx(db, run);
  } catch (e) {
    if (!(e instanceof DryRunRollback)) {
      if (e instanceof ProductError) report.errors.push({ row: 0, message: e.message });
      else throw e;
    }
  }
  return report;
}

class DryRunRollback extends Error {}
