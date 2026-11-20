import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, utimesSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import sharp from "sharp";
import { loadCatalogSql } from "../../src/lib/catalog/sql-source";
import { cleanupOrphans, deleteImages, listImages, reorderImages, saveUploadedImage, setPrimaryImage } from "../../src/lib/admin/services/images";
import { processProductImage } from "../../src/lib/media/process";
import { getMediaStorage, type MediaStorage } from "../../src/lib/media/storage";
import { makeAdmin, startTestDb, type TestDb } from "./helpers";

let t: TestDb;
let admin: Awaited<ReturnType<typeof makeAdmin>>;
let storage: MediaStorage;
let mediaDir: string;
let oliveId: string;
let pastaId: string;

const img = async (color: string, w = 600, h = 400) =>
  processProductImage(await sharp({ create: { width: w, height: h, channels: 3, background: color } }).jpeg().toBuffer());
const files = () => readdirSync(mediaDir, { recursive: true }).filter((f) => String(f).endsWith(".webp")).length;

before(async () => {
  t = await startTestDb("images");
  admin = await makeAdmin(t.sql, "PRODUCT_MANAGER", "pm-images@test.local");
  mediaDir = mkdtempSync(path.join(os.tmpdir(), "mm-media-"));
  storage = getMediaStorage({ NODE_ENV: "test", LOCAL_MEDIA_DIR: mediaDir } as NodeJS.ProcessEnv)!;
  const ids = await t.sql<{ id: string; slug: string }[]>`select id, slug from public.products where slug in ('olive-oil', 'pasta-penne')`;
  oliveId = ids.find((r) => r.slug === "olive-oil")!.id;
  pastaId = ids.find((r) => r.slug === "pasta-penne")!.id;
});
after(async () => {
  await t.close();
  rmSync(mediaDir, { recursive: true, force: true });
});

const catalogProduct = async (id: string) => (await loadCatalogSql(t.sql, "")).products.find((p) => p.id === id)!;

test("upload → main image, gallery, set main, reorder — the catalog (and so the 3D store) follows", async () => {
  const a = await saveUploadedImage(t.sql, storage, admin, oliveId, await img("#ff0000"), { alt: "front" });
  assert.equal(a.is_primary, true, "first image becomes the main image");
  assert.match(a.storage_path, new RegExp(`^${oliveId}/[0-9a-f-]{36}\\.webp$`));
  assert.equal(a.bucket, "local");
  const b = await saveUploadedImage(t.sql, storage, admin, oliveId, await img("#00ff00"));
  const c = await saveUploadedImage(t.sql, storage, admin, oliveId, await img("#0000ff"), { makePrimary: true });
  assert.equal(files(), 3);
  let p = await catalogProduct(oliveId);
  assert.equal(p.imageUrl, `/api/media/${c.storage_path}`, "uploaded with makePrimary → main image everywhere");
  assert.equal(p.gallery!.length, 3);

  await setPrimaryImage(t.sql, admin, oliveId, b.id);
  await reorderImages(t.sql, admin, oliveId, [c.id, b.id, a.id]);
  p = await catalogProduct(oliveId);
  assert.equal(p.imageUrl, `/api/media/${b.storage_path}`);
  assert.deepEqual(p.gallery!.map((g) => g.url), [b, c, a].map((x) => `/api/media/${x.storage_path}`), "main first, then admin order");
  await assert.rejects(reorderImages(t.sql, admin, oliveId, [c.id, b.id]), /changed meanwhile/);
  const [{ n }] = (await t.sql<{ n: number }[]>`select count(*)::int as n from public.product_images where product_id = ${oliveId} and is_primary`) as unknown as [{ n: number }];
  assert.equal(n, 1, "exactly one main image");
});

test("replace writes a new object and removes the old one; a failed write leaves everything intact", async () => {
  const [main] = await listImages(t.sql, oliveId);
  const before = files();
  const replaced = await saveUploadedImage(t.sql, storage, admin, oliveId, await img("#ffff00"), { replaceImageId: main!.id });
  assert.equal(replaced.id, main!.id, "same image slot (position + main flag kept)");
  assert.notEqual(replaced.storage_path, main!.storage_path, "new unique key → no CDN cache conflicts");
  assert.equal(replaced.is_primary, true);
  assert.equal(files(), before, "old file deleted, new file added");

  await assert.rejects(saveUploadedImage(t.sql, storage, admin, oliveId, await img("#000000"), { replaceImageId: "00000000-0000-0000-0000-000000000000" }), /no longer exists/);
  assert.equal(files(), before, "the uploaded object was removed after the DB step failed");
  assert.equal((await listImages(t.sql, oliveId)).length, 3, "existing images untouched");
});

test("deleting never removes a file another product still uses; main image is promoted", async () => {
  const imgs = await listImages(t.sql, oliveId);
  const shared = imgs.find((i) => !i.is_primary)!;
  // Another product references the same object (e.g. copied by an admin script).
  await t.sql`insert into public.product_images (product_id, storage_path, bucket, sort_order, is_primary) values (${pastaId}, ${shared.storage_path}, 'local', 1, true)`;
  const before = files();
  await deleteImages(t.sql, storage, admin, oliveId, [shared.id]);
  assert.equal(files(), before, "file kept: pasta still uses it");
  assert.equal((await catalogProduct(pastaId)).imageUrl, `/api/media/${shared.storage_path}`);

  const main = (await listImages(t.sql, oliveId)).find((i) => i.is_primary)!;
  await deleteImages(t.sql, storage, admin, oliveId, [main.id]);
  const rest = await listImages(t.sql, oliveId);
  assert.equal(rest.length, 1);
  assert.equal(rest[0]!.is_primary, true, "next image promoted to main");
  assert.equal(files(), before - 1);
});

test("orphan cleanup removes only old, unreferenced files", async () => {
  const stray = await img("#123456");
  await storage.put(`${oliveId}/11111111-1111-4111-8111-111111111111.webp`, stray.data, stray.mimeType);
  await storage.put(`${oliveId}/22222222-2222-4222-8222-222222222222.webp`, stray.data, stray.mimeType);
  const old = new Date(Date.now() - 3 * 3600_000);
  utimesSync(path.join(mediaDir, oliveId, "11111111-1111-4111-8111-111111111111.webp"), old, old);
  const before = files();
  const r = await cleanupOrphans(t.sql, storage, admin);
  assert.deepEqual(r.deleted, [`${oliveId}/11111111-1111-4111-8111-111111111111.webp`], "fresh file (maybe an in-flight upload) kept");
  assert.equal(files(), before - 1);
  for (const im of [...(await listImages(t.sql, oliveId)), ...(await listImages(t.sql, pastaId))]) {
    assert.ok(readdirSync(path.join(mediaDir, im.storage_path.split("/")[0]!)).includes(im.storage_path.split("/")[1]!), "referenced files survive");
  }
});

test("every image change is in the activity log", async () => {
  const rows = await t.sql<{ action: string }[]>`select distinct action from public.admin_activity_log where entity = 'product' and action like 'product.image%'`;
  assert.deepEqual(rows.map((r) => r.action).sort(), ["product.image.delete", "product.image.primary", "product.image.reorder", "product.image.replace", "product.image.upload"]);
});
