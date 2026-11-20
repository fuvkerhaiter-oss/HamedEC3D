"use server";
import { z } from "zod";
import { adminAction, UserError } from "@/lib/admin/guard";
import { ids, optStr, str, uuid } from "@/lib/admin/form";
import { refreshProductPages } from "@/lib/admin/upload";
import { cleanupOrphans, deleteImages, ImageError, matchProductsForFiles, reorderImages, setPrimaryImage, updateAlt } from "@/lib/admin/services/images";
import { getMediaStorage, mediaStatus } from "@/lib/media/storage";
import type { Db } from "@/lib/db/client";

async function friendly<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ImageError) throw new UserError(e.message);
    throw e;
  }
}

async function slugOf(sql: Db, productId: string) {
  const [p] = await sql<{ slug: string }[]>`select slug from public.products where id = ${productId}`;
  return p?.slug ?? null;
}

export const setPrimaryImageAction = adminAction("products.edit", z.object({ productId: uuid, imageId: uuid }), async (i, { sql, actor }) => {
  await friendly(() => setPrimaryImage(sql, actor, i.productId, i.imageId));
  refreshProductPages(await slugOf(sql, i.productId));
  return { ok: true, message: "Main image updated." };
});

export const reorderImagesAction = adminAction("products.edit", z.object({ productId: uuid, order: str(10000) }), async (i, { sql, actor }) => {
  const order = i.order.split(",").filter(Boolean);
  if (!order.every((x) => /^[0-9a-f-]{36}$/.test(x))) throw new UserError("Invalid order");
  await friendly(() => reorderImages(sql, actor, i.productId, order));
  refreshProductPages(await slugOf(sql, i.productId));
  return { ok: true, message: "Gallery order saved." };
});

export const deleteImageAction = adminAction("products.edit", z.object({ productId: uuid, imageIds: ids, all: z.string().optional() }), async (i, { sql, actor }) => {
  if (!i.all && !i.imageIds.length) throw new UserError("Nothing selected");
  const n = await friendly(() => deleteImages(sql, getMediaStorage(), actor, i.productId, i.all === "true" ? "all" : i.imageIds));
  refreshProductPages(await slugOf(sql, i.productId));
  return { ok: true, message: `${n} image(s) deleted.` };
});

export const altImageAction = adminAction("products.edit", z.object({ productId: uuid, imageId: uuid, alt: optStr(200) }), async (i, { sql, actor }) => {
  await friendly(() => updateAlt(sql, actor, i.productId, i.imageId, i.alt ?? ""));
  refreshProductPages(await slugOf(sql, i.productId));
  return { ok: true, message: "Alt text saved." };
});

/** Bulk: remove every image of the selected products. */
export const bulkDeleteImagesAction = adminAction("products.edit", z.object({ ids }), async (i, { sql, actor }) => {
  if (!i.ids.length) throw new UserError("Select at least one product");
  const storage = getMediaStorage();
  let n = 0;
  for (const id of i.ids) n += await deleteImages(sql, storage, actor, id, "all");
  refreshProductPages();
  return { ok: true, message: `${n} image(s) removed from ${i.ids.length} product(s).` };
});

/** Preview which product each file name maps to before a bulk upload. */
export const matchFilesAction = adminAction("products.edit", z.object({ names: str(20000) }), async (i, { sql }) => {
  const names = i.names.split("\n").map((n) => n.trim()).filter(Boolean).slice(0, 200);
  return { ok: true, data: await matchProductsForFiles(sql, names) };
});

export const cleanupStorageAction = adminAction("products.edit", z.object({}), async (_i, { sql, actor }) => {
  const storage = getMediaStorage();
  if (!storage) throw new UserError(mediaStatus().detail);
  const r = await cleanupOrphans(sql, storage, actor);
  return { ok: true, message: `Checked ${r.scanned} file(s); removed ${r.deleted.length} unreferenced file(s) older than an hour.` };
});
