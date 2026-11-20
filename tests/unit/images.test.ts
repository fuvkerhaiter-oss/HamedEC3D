import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { ImageValidationError, MAX_EDGE, processProductImage } from "../../src/lib/media/process";
import { matchImageFile } from "../../src/lib/admin/services/images";
import { mapProductRow, publicStorageUrl, type ProductRow } from "../../src/lib/catalog/source-map";
import { canOptimize } from "../../src/lib/catalog/image";
import { mediaStatus } from "../../src/lib/media/storage";

const make = (w: number, h: number, fmt: "png" | "jpeg" | "webp" | "avif") =>
  sharp({ create: { width: w, height: h, channels: 3, background: "#1d6b52" } })[fmt]().toBuffer();

test("images are validated from their bytes and normalized to WebP", async () => {
  for (const fmt of ["png", "jpeg", "webp", "avif"] as const) {
    const out = await processProductImage(await make(400, 300, fmt));
    assert.equal(out.mimeType, "image/webp");
    assert.equal(out.sourceFormat, fmt);
    assert.deepEqual([out.width, out.height], [400, 300]);
    assert.equal((await sharp(out.data).metadata()).format, "webp");
  }
  const big = await processProductImage(await make(5000, 2500, "jpeg"));
  assert.deepEqual([big.width, big.height], [MAX_EDGE, MAX_EDGE / 2], "oversized images are downscaled");
  await assert.rejects(processProductImage(Buffer.from("not an image at all")), ImageValidationError);
  await assert.rejects(processProductImage(await make(50, 50, "png")), /too small/);
  await assert.rejects(processProductImage(await sharp({ create: { width: 200, height: 200, channels: 3, background: "#000" } }).gif().toBuffer()), /Unsupported/);
  await assert.rejects(processProductImage(Buffer.alloc(0)), /empty/);
});

test("bulk file names match product slugs or SKUs, with gallery suffixes", () => {
  const products = [{ id: "p1", slug: "olive-oil", skus: ["MOCK-OLIVE-OIL-1", "MOCK-OLIVE-OIL-2"] }, { id: "p2", slug: "pasta-penne-2", skus: [] }];
  assert.deepEqual(matchImageFile("olive-oil.jpg", products), { productId: "p1", index: null });
  assert.deepEqual(matchImageFile("Olive-Oil-3.WEBP", products), { productId: "p1", index: 3 });
  assert.deepEqual(matchImageFile("mock-olive-oil-2.png", products), { productId: "p1", index: null }, "exact SKU beats suffix parsing");
  assert.deepEqual(matchImageFile("pasta-penne-2.jpg", products), { productId: "p2", index: null }, "slug ending in a number");
  assert.equal(matchImageFile("unknown.jpg", products), null);
});

test("catalog mapping: main image first, then gallery order; storage URL per bucket", () => {
  const row = {
    id: "p", slug: "s", name: "Prod", description: "", status: "published", is_mock: false, category_id: "c", product_variants: [], product_3d_assets: [],
    product_images: [
      { storage_path: "p/b.webp", alt: "", sort_order: 1, bucket: "products", is_primary: false, width: 10, height: 10 },
      { storage_path: "p/a.webp", alt: "front", sort_order: 2, bucket: "products", is_primary: true, width: 800, height: 600 },
      { storage_path: "legacy.jpg", alt: "", sort_order: 0 },
    ],
  } as unknown as ProductRow;
  const p = mapProductRow(row, "https://abc.supabase.co");
  assert.equal(p.imageUrl, "https://abc.supabase.co/storage/v1/object/public/products/p/a.webp");
  assert.deepEqual(p.gallery!.map((g) => g.url.split("/").slice(-2).join("/")), ["p/a.webp", "product-images/legacy.jpg", "p/b.webp"]);
  assert.equal(p.gallery![1]!.alt, "Prod", "alt falls back to the product name");
  assert.equal(publicStorageUrl("", "local", "a/b.webp"), "/api/media/a/b.webp");
  assert.ok(canOptimize(p.imageUrl!));
  assert.ok(!canOptimize("/api/media/a/b.webp"));
});

test("storage driver selection never falls back silently in production", () => {
  assert.equal(mediaStatus({ NODE_ENV: "production" } as NodeJS.ProcessEnv).driver, "none");
  assert.equal(mediaStatus({ NODE_ENV: "development" } as NodeJS.ProcessEnv).driver, "local");
  assert.equal(mediaStatus({ NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_x" } as NodeJS.ProcessEnv).driver, "supabase");
});
