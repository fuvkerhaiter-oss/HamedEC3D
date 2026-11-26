/**
 * Product images: one shared table (`product_images`) read by the catalog, product pages, the 3D store and the cart.
 * Safety rules:
 *  - upload first, then write the DB row; if the DB write fails the new object is removed (no orphan, old image intact);
 *  - replacing writes a NEW object key (no CDN/browser cache conflicts) and deletes the old object only after commit;
 *  - an object is deleted only when no product_images row references it any more (never another product's image);
 *  - orphan cleanup removes only objects older than a grace period that nothing references.
 */
import { randomUUID } from "node:crypto";
import { inTx, type Db } from "../../db/client";
import { publicStorageUrl } from "../../catalog/source-map";
import { OBJECT_KEY, type MediaStorage } from "../../media/storage";
import type { ProcessedImage } from "../../media/process";
import { logActivity, type Actor } from "../audit";

export class ImageError extends Error {
  override name = "ImageError";
}

export interface ImageRow {
  id: string;
  product_id: string;
  storage_path: string;
  bucket: string;
  alt: string;
  sort_order: number;
  is_primary: boolean;
  width: number | null;
  height: number | null;
  bytes: number | null;
  mime_type: string | null;
  created_at: Date;
}

export interface ImageView extends Omit<ImageRow, "created_at"> {
  url: string;
  created_at: string;
}

const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

export function toView(r: ImageRow, supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""): ImageView {
  return { ...r, url: publicStorageUrl(supabaseUrl, r.bucket, r.storage_path), created_at: r.created_at.toISOString() };
}

export async function listImages(db: Db, productId: string): Promise<ImageRow[]> {
  if (!isUuid(productId)) return [];
  return db<ImageRow[]>`select * from public.product_images where product_id = ${productId} order by is_primary desc, sort_order, created_at`;
}

/** Deletes the object if nothing references it (any product). Only touches objects of the active storage. */
async function deleteIfUnreferenced(db: Db, storage: MediaStorage, bucket: string, key: string): Promise<boolean> {
  if (bucket !== storage.bucket || !OBJECT_KEY.test(key)) return false; // legacy/external images are never deleted here
  const [{ n }] = (await db<{ n: number }[]>`select count(*)::int as n from public.product_images where bucket = ${bucket} and storage_path = ${key}`) as unknown as [{ n: number }];
  if (n > 0) return false;
  try {
    await storage.remove([key]);
    return true;
  } catch (e) {
    console.error("[images] could not delete storage object (will be caught by orphan cleanup)", key, e);
    return false;
  }
}

export interface UploadOptions {
  alt?: string;
  makePrimary?: boolean;
  /** Replace this image (keeps its position/main flag), otherwise appended to the gallery. */
  replaceImageId?: string | null;
}

export async function saveUploadedImage(
  db: Db, storage: MediaStorage, actor: Actor, productId: string, img: ProcessedImage, opts: UploadOptions = {},
): Promise<ImageRow> {
  if (!isUuid(productId)) throw new ImageError("Unknown product");
  const [product] = await db<{ name: string }[]>`select name from public.products where id = ${productId}`;
  if (!product) throw new ImageError("Product not found");
  const key = `${productId}/${randomUUID()}.webp`;
  await storage.put(key, img.data, img.mimeType);

  let replaced: { bucket: string; storage_path: string } | null = null;
  let row: ImageRow;
  try {
    row = await inTx(db, async (tx) => {
      await tx`select id from public.products where id = ${productId} for update`; // serialize image changes per product
      if (opts.replaceImageId) {
        const [old] = await tx<ImageRow[]>`select * from public.product_images where id = ${opts.replaceImageId} and product_id = ${productId}`;
        if (!old) throw new ImageError("The image to replace no longer exists");
        replaced = { bucket: old.bucket, storage_path: old.storage_path };
        const [r] = await tx<ImageRow[]>`
          update public.product_images set storage_path = ${key}, bucket = ${storage.bucket}, width = ${img.width}, height = ${img.height},
            bytes = ${img.bytes}, mime_type = ${img.mimeType}, alt = ${opts.alt ?? old.alt}, created_at = now(), created_by = ${actor.id}
          where id = ${old.id} returning *`;
        if (opts.makePrimary && !old.is_primary) await setPrimaryTx(tx, productId, old.id);
        return r!;
      }
      const [{ next, count }] = (await tx<{ next: number; count: number }[]>`
        select coalesce(max(sort_order), 0)::int + 1 as next, count(*)::int as count from public.product_images where product_id = ${productId}`) as unknown as [{ next: number; count: number }];
      const primary = count === 0 || !!opts.makePrimary;
      if (primary) await tx`update public.product_images set is_primary = false where product_id = ${productId} and is_primary`;
      const [r] = await tx<ImageRow[]>`
        insert into public.product_images (product_id, storage_path, bucket, alt, sort_order, is_primary, width, height, bytes, mime_type, created_by)
        values (${productId}, ${key}, ${storage.bucket}, ${opts.alt ?? ""}, ${next}, ${primary}, ${img.width}, ${img.height}, ${img.bytes}, ${img.mimeType}, ${actor.id})
        returning *`;
      return r!;
    });
  } catch (e) {
    await storage.remove([key]).catch(() => {}); // DB failed: drop the new object, existing images untouched
    throw e;
  }
  await db`update public.products set updated_at = now() where id = ${productId}`;
  if (replaced) await deleteIfUnreferenced(db, storage, (replaced as { bucket: string }).bucket, (replaced as { storage_path: string }).storage_path);
  await logActivity(db, actor, {
    action: opts.replaceImageId ? "product.image.replace" : "product.image.upload", entity: "product", entityId: productId,
    summary: `${opts.replaceImageId ? "Replaced" : "Uploaded"} image for ${product.name} (${img.width}×${img.height}, ${Math.round(img.bytes / 1024)} KB)${row.is_primary ? " — main image" : ""}`,
    before: replaced, after: { key, bucket: storage.bucket, width: img.width, height: img.height },
  });
  return row;
}

async function setPrimaryTx(tx: Db, productId: string, imageId: string) {
  await tx`update public.product_images set is_primary = false where product_id = ${productId} and is_primary`;
  const r = await tx`update public.product_images set is_primary = true where id = ${imageId} and product_id = ${productId} returning id`;
  if (!r.length) throw new ImageError("Image not found");
}

export async function setPrimaryImage(db: Db, actor: Actor, productId: string, imageId: string) {
  await inTx(db, async (tx) => {
    await tx`select id from public.products where id = ${productId} for update`;
    await setPrimaryTx(tx, productId, imageId);
    await tx`update public.products set updated_at = now() where id = ${productId}`;
    await logActivity(tx, actor, { action: "product.image.primary", entity: "product", entityId: productId, summary: "Changed the main image", after: { imageId } });
  });
}

/** New gallery order; must contain exactly the product's image ids. */
export async function reorderImages(db: Db, actor: Actor, productId: string, orderedIds: string[]) {
  await inTx(db, async (tx) => {
    await tx`select id from public.products where id = ${productId} for update`;
    const current = await tx<{ id: string }[]>`select id from public.product_images where product_id = ${productId}`;
    const set = new Set(current.map((c) => c.id));
    if (orderedIds.length !== set.size || !orderedIds.every((id) => set.has(id)) || new Set(orderedIds).size !== orderedIds.length) {
      throw new ImageError("The image list changed meanwhile — reload and try again");
    }
    for (let i = 0; i < orderedIds.length; i++) await tx`update public.product_images set sort_order = ${i + 1} where id = ${orderedIds[i]!}`;
    await tx`update public.products set updated_at = now() where id = ${productId}`;
    await logActivity(tx, actor, { action: "product.image.reorder", entity: "product", entityId: productId, summary: "Reordered the gallery", after: orderedIds });
  });
}

export async function updateAlt(db: Db, actor: Actor, productId: string, imageId: string, alt: string) {
  const r = await db`update public.product_images set alt = ${alt} where id = ${imageId} and product_id = ${productId} returning id`;
  if (!r.length) throw new ImageError("Image not found");
  await logActivity(db, actor, { action: "product.image.alt", entity: "product", entityId: productId, summary: "Updated image alt text", after: { alt } });
}

/** Deletes images (DB first, then unreferenced objects). Promotes the next image to main when needed. */
export async function deleteImages(db: Db, storage: MediaStorage | null, actor: Actor, productId: string, imageIds: string[] | "all") {
  const removed = await inTx(db, async (tx) => {
    await tx`select id from public.products where id = ${productId} for update`;
    const rows = imageIds === "all"
      ? await tx<ImageRow[]>`delete from public.product_images where product_id = ${productId} returning *`
      : await tx<ImageRow[]>`delete from public.product_images where product_id = ${productId} and id = any(${imageIds}::uuid[]) returning *`;
    if (rows.some((r) => r.is_primary)) {
      await tx`update public.product_images set is_primary = true where id = (
                 select id from public.product_images where product_id = ${productId} order by sort_order, created_at limit 1)`;
    }
    await tx`update public.products set updated_at = now() where id = ${productId}`;
    await logActivity(tx, actor, { action: "product.image.delete", entity: "product", entityId: productId, summary: `Deleted ${rows.length} image(s)`, before: rows.map((r) => ({ bucket: r.bucket, key: r.storage_path })) });
    return rows;
  });
  if (storage) for (const r of removed) await deleteIfUnreferenced(db, storage, r.bucket, r.storage_path);
  return removed.length;
}

/** Removes storage objects no product_images row references, older than `graceMinutes` (in-flight uploads are safe). */
export async function cleanupOrphans(db: Db, storage: MediaStorage, actor: Actor, graceMinutes = 60): Promise<{ scanned: number; deleted: string[] }> {
  const objects = await storage.list("");
  // Shop renters' product photos and logos (lib/tenants) live in the same bucket: they count as referenced too.
  const referenced = new Set(
    (
      await db<{ storage_path: string }[]>`
        select storage_path from public.product_images where bucket = ${storage.bucket}
        union all select image_path from public.tenant_products where image_bucket = ${storage.bucket} and image_path is not null
        union all select logo_path from public.tenant_accounts where logo_bucket = ${storage.bucket} and logo_path is not null`
    ).map((r) => r.storage_path),
  );
  const cutoff = Date.now() - graceMinutes * 60_000;
  const orphans = objects.filter((o) => !referenced.has(o.key) && OBJECT_KEY.test(o.key) && (o.createdAt?.getTime() ?? 0) < cutoff).map((o) => o.key);
  if (orphans.length) await storage.remove(orphans);
  await logActivity(db, actor, { action: "media.cleanup", entity: "product", summary: `Storage cleanup: ${orphans.length} orphaned file(s) removed of ${objects.length}` });
  return { scanned: objects.length, deleted: orphans };
}

// ───────────────────────── Image manager list + bulk matching ─────────────────────────

export interface ImageManagerRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  category_name: string | null;
  image_count: number;
  primary_id: string | null;
  primary_path: string | null;
  primary_bucket: string | null;
  skus: string[];
}

export async function listForImageManager(db: Db, f: { q?: string; categoryId?: string; filter?: "missing" | "multiple"; page?: number; pageSize?: number }) {
  const q = f.q?.trim() ?? "";
  const pageSize = Math.min(f.pageSize ?? 48, 200);
  const page = Math.max(1, f.page ?? 1);
  const where = db`
    where p.deleted_at is null
      and (${f.categoryId ?? null}::uuid is null or p.category_id = ${f.categoryId ?? null})
      and (${q} = '' or p.name ilike ${"%" + q + "%"} or p.slug ilike ${"%" + q + "%"}
           or exists (select 1 from public.product_variants v where v.product_id = p.id and v.sku ilike ${"%" + q + "%"}))
      and (${f.filter ?? null}::text is null
           or (${f.filter ?? null} = 'missing' and not exists (select 1 from public.product_images im where im.product_id = p.id))
           or (${f.filter ?? null} = 'multiple' and (select count(*) from public.product_images im where im.product_id = p.id) > 1))`;
  const [count] = await db<{ n: number }[]>`select count(*)::int as n from public.products p ${where}`;
  const rows = await db<ImageManagerRow[]>`
    select p.id, p.name, p.slug, p.status::text, c.name as category_name,
      (select count(*)::int from public.product_images im where im.product_id = p.id) as image_count,
      pi.id as primary_id, pi.storage_path as primary_path, pi.bucket as primary_bucket,
      coalesce((select array_agg(v.sku order by v.sort_order) from public.product_variants v where v.product_id = p.id), '{}') as skus
    from public.products p
    left join public.categories c on c.id = p.category_id
    left join lateral (select id, storage_path, bucket from public.product_images im where im.product_id = p.id order by is_primary desc, sort_order limit 1) pi on true
    ${where}
    order by (select count(*) from public.product_images im where im.product_id = p.id) = 0 desc, p.name
    limit ${pageSize} offset ${(page - 1) * pageSize}`;
  const [totals] = await db<{ products: number; missing: number }[]>`
    select count(*)::int as products, count(*) filter (where not exists (select 1 from public.product_images im where im.product_id = p.id))::int as missing
      from public.products p where p.deleted_at is null`;
  return { rows, total: count?.n ?? 0, totals: totals ?? { products: 0, missing: 0 } };
}

/**
 * Bulk upload matching: a file name (without extension and an optional trailing "-2"/"_3" gallery index)
 * must equal a product slug or a variant SKU (case-insensitive). Pure (unit tested).
 */
export function matchImageFile(fileName: string, products: { id: string; slug: string; skus: string[] }[]): { productId: string; index: number | null } | null {
  const stem = fileName.replace(/\.[a-z0-9]+$/i, "").trim().toLowerCase();
  const m = /^(.*?)(?:[-_ ](\d{1,2}))?$/.exec(stem);
  const candidates = [stem, m?.[1] ?? stem];
  for (const c of candidates) {
    const hit = products.find((p) => p.slug.toLowerCase() === c || p.skus.some((s) => s.toLowerCase() === c));
    if (hit) return { productId: hit.id, index: c === stem ? null : Number(m?.[2]) };
  }
  return null;
}

export async function matchProductsForFiles(db: Db, fileNames: string[]) {
  const products = await db<{ id: string; slug: string; name: string; skus: string[] }[]>`
    select p.id, p.slug, p.name, coalesce((select array_agg(v.sku) from public.product_variants v where v.product_id = p.id), '{}') as skus
      from public.products p where p.deleted_at is null`;
  return fileNames.map((name) => {
    const hit = matchImageFile(name, products);
    const p = hit ? products.find((x) => x.id === hit.productId)! : null;
    return { fileName: name, productId: p?.id ?? null, productName: p?.name ?? null, index: hit?.index ?? null };
  });
}
