/**
 * Shop renters upload their logo or a product photo (signed-in tenant only; their own rows only). The image is
 * re-encoded to WebP (lib/media/process: type sniffing, size limits) and stored in the product media bucket under
 * {tenantId}/{uuid}.webp; the old file is removed when nothing references it any more.
 */
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { ImageValidationError, MAX_UPLOAD_BYTES, processProductImage } from "@/lib/media/process";
import { getMediaStorage, mediaStatus } from "@/lib/media/storage";
import { rateLimited } from "@/lib/rate-limit";
import { getSellerContext } from "@/lib/tenants/access";
import { addAdSlide, getOwnProduct, mediaUrl, newImageKey, removeImageIfUnused, setLogo, setProductImage, TenantError } from "@/lib/tenants/service";
import { getSql } from "@/lib/db/client";

const json = (status: number, body: unknown) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  const ctx = await getSellerContext();
  if (ctx.kind !== "ok") return json(401, { error: "Please sign in to your shop account." });
  if (rateLimited(`seller-upload:${ctx.userId}`, 40, 10 * 60_000)) return json(429, { error: "Too many uploads. Please wait a few minutes." });
  const storage = getMediaStorage();
  if (!storage) return json(503, { error: mediaStatus().detail });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES + 64 * 1024) return json(413, { error: `The file is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` });

  let fd: FormData;
  try {
    fd = await req.formData();
  } catch {
    return json(400, { error: "Invalid upload." });
  }
  const file = fd.get("file");
  const target = String(fd.get("target") ?? "");
  const productId = String(fd.get("productId") ?? "");
  if (!(file instanceof File)) return json(400, { error: "Choose an image." });
  if (target !== "logo" && target !== "product" && target !== "ad") return json(400, { error: "Unknown upload." });

  const sql = getSql();
  const tenant = ctx.tenant;
  if (target === "product" && !(await getOwnProduct(sql, tenant.id, productId))) return json(404, { error: "That product no longer exists." });

  try {
    const img = await processProductImage(Buffer.from(await file.arrayBuffer()));
    const key = newImageKey(tenant.id);
    await storage.put(key, img.data, img.mimeType);
    let old: { bucket: string; path: string } | null = null;
    let slideId: string | undefined;
    try {
      if (target === "logo") {
        old = await setLogo(sql, tenant.id, storage.bucket, key);
      } else if (target === "ad") {
        const slide = await addAdSlide(sql, tenant.id, storage.bucket, key);
        slideId = slide.id;
      } else {
        old = await setProductImage(sql, tenant.id, productId, storage.bucket, key);
      }
    } catch (e) {
      await storage.remove([key]).catch(() => {}); // DB write failed: don't leave the new file behind
      throw e;
    }
    if (old) await removeImageIfUnused(sql, storage, old.bucket, old.path);
    revalidatePath("/store");
    revalidatePath("/seller", "layout");
    return json(200, { url: mediaUrl(storage.bucket, key), id: slideId });
  } catch (e) {
    if (e instanceof ImageValidationError || e instanceof TenantError) return json(422, { error: e.message });
    console.error("[seller upload]", e);
    return json(500, { error: "Upload failed. Nothing was changed." });
  }
}
