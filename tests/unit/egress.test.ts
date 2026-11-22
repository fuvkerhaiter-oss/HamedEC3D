import assert from "node:assert/strict";
import { test } from "node:test";
import { canOptimize, resizedImageUrl } from "../../src/lib/catalog/image";
import { cachedPublic, expirePublicData } from "../../src/lib/cache/public-data";
import nextConfig from "../../next.config";

const SB = "https://abc.supabase.co/storage/v1/object/public";

test("only this project's public product buckets go through the image optimizer", () => {
  assert.ok(canOptimize(`${SB}/products/a/b.webp`));
  assert.ok(canOptimize(`${SB}/product-images/x.jpg`));
  assert.ok(!canOptimize(`${SB}/private-docs/invoice.pdf`));
  assert.ok(!canOptimize("https://abc.supabase.co/storage/v1/object/sign/products/a.webp?token=x"), "signed URLs are never proxied");
  assert.ok(!canOptimize("/api/media/a/b.webp"));
});

test("3D shelf textures use a cached resized copy, not the original", () => {
  const u = `${SB}/products/a/b.webp`;
  assert.equal(resizedImageUrl(u, 640), `/_next/image?url=${encodeURIComponent(u)}&w=640&q=75`);
  assert.equal(resizedImageUrl("/api/media/a/b.webp", 256), "/api/media/a/b.webp");
  const sizes = [...(nextConfig.images?.deviceSizes ?? []), ...(nextConfig.images?.imageSizes ?? [])];
  for (const w of [256, 640]) assert.ok(sizes.includes(w), `optimizer accepts w=${w}`);
});

test("public data cache calls through outside Next and expiring is a safe no-op", async () => {
  let n = 0;
  const get = cachedPublic("t", "public:test", async () => ++n);
  assert.equal(await get(), 1);
  assert.equal(await get(), 2, "no cache outside a Next server");
  assert.doesNotThrow(() => expirePublicData("public:test"));
});

test("static 3D/audio files get long browser caching; token pages stay no-store", async () => {
  const rules = (await nextConfig.headers!()) as { source: string; headers: { key: string; value: string }[] }[];
  const cc = (src: string) => rules.find((r) => r.source === src)?.headers.find((h) => h.key === "Cache-Control")?.value;
  assert.match(cc("/models/:path*")!, /max-age=604800/);
  assert.match(cc("/audio/:path*")!, /max-age=604800/);
  assert.equal(cc("/order"), "private, no-store");
  assert.equal(cc("/account/:path*"), "private, no-store");
});
