/** Shared handling for admin image uploads (route handlers). */
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { clientIp, requireApi } from "./guard";
import { ImageError, saveUploadedImage, toView } from "./services/images";
import { getMediaStorage, mediaStatus } from "../media/storage";
import { ImageValidationError, MAX_UPLOAD_BYTES, processProductImage } from "../media/process";

/** Rejects cross-site POSTs (the session cookie is SameSite=Strict too). */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function refreshProductPages(slug?: string | null) {
  revalidatePath("/catalog");
  revalidatePath("/store");
  revalidatePath("/");
  revalidatePath("/admin/products");
  revalidatePath("/admin/products/images");
  if (slug) revalidatePath(`/catalog/${slug}`);
}

export const json = (status: number, body: unknown) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Auth + origin + storage checks, file extraction, processing and saving. */
export async function handleImageUpload(req: Request, resolveProduct: (fd: FormData, file: File) => Promise<{ productId: string; slug: string } | { error: string }>) {
  if (!sameOrigin(req)) return json(403, { error: "Cross-site request refused" });
  const auth = await requireApi("products.edit");
  if (auth instanceof Response) return auth;
  const storage = getMediaStorage();
  if (!storage) return json(503, { error: mediaStatus().detail });
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_UPLOAD_BYTES + 64 * 1024) return json(413, { error: `File is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB` });

  let fd: FormData;
  try {
    fd = await req.formData();
  } catch {
    return json(400, { error: "Invalid upload" });
  }
  const file = fd.get("file");
  if (!(file instanceof File)) return json(400, { error: "No file" });
  const target = await resolveProduct(fd, file);
  if ("error" in target) return json(404, { error: target.error });
  try {
    const img = await processProductImage(Buffer.from(await file.arrayBuffer()));
    const alt = String(fd.get("alt") ?? "").slice(0, 200);
    const replaceId = String(fd.get("replaceId") ?? "") || null;
    const row = await saveUploadedImage(auth.sql, storage, { id: auth.session.user.id, email: auth.session.user.email, ip: await clientIp() }, target.productId, img, {
      alt, makePrimary: fd.get("primary") === "true", replaceImageId: replaceId && /^[0-9a-f-]{36}$/.test(replaceId) ? replaceId : null,
    });
    refreshProductPages(target.slug);
    return json(200, { image: toView(row), productId: target.productId, storage: storage.driver });
  } catch (e) {
    if (e instanceof ImageValidationError || e instanceof ImageError) return json(422, { error: e.message });
    console.error("[image upload]", e);
    return json(500, { error: "Upload failed. The product's existing images were not changed." });
  }
}
