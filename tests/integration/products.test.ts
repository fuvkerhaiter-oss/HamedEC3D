import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { loadCatalogSql } from "../../src/lib/catalog/sql-source";
import { adjustStock, deleteCategory, saveCategory } from "../../src/lib/admin/services/catalog-admin";
import { createOrder } from "../../src/lib/admin/services/orders";
import {
  deleteProducts, exportProductsCsv, importProductsCsv, publishProblems, saveProduct, savePlacement, saveVariant, setProductStatus,
} from "../../src/lib/admin/services/products";
import { buildStoreLayout } from "../../src/features/store3d/layout";
import { SUPERMARKET } from "../../src/features/store3d/env/supermarket";
import { IT_ADDRESS, makeAdmin, setupCommerce, startTestDb, type TestDb } from "./helpers";

let t: TestDb;
let admin: Awaited<ReturnType<typeof makeAdmin>>;
let euMethod: string;
before(async () => {
  t = await startTestDb("products");
  admin = await makeAdmin(t.sql);
  ({ euMethod } = await setupCommerce(t.sql));
});
after(() => t.close());

test("a product created in the admin appears in the storefront catalog only once published", async () => {
  const cat = await saveCategory(t.sql, admin, { name: "Pet Food", description: "", parentId: null, isActive: true });
  const id = await saveProduct(t.sql, admin, { name: "Kibble Deluxe", description: "Test product", categoryId: null, brand: null, tags: ["dog"], seoTitle: null, seoDescription: null, isFeatured: false });
  assert.deepEqual(await publishProblems(t.sql, id), [
    "Choose a category", "Write a description (at least 40 characters)", "Add at least one photo", "Add at least one active variant",
  ]);
  const sampleCat = await saveCategory(t.sql, admin, { name: "Samples", description: "", parentId: null, isActive: true });
  const sample = await saveProduct(t.sql, admin, { name: "Sample Thing", description: "x".repeat(60), categoryId: sampleCat, brand: null, tags: [], seoTitle: null, seoDescription: null, isFeatured: false });
  await t.sql`update public.products set is_mock = true where id = ${sample}`;
  assert.ok((await publishProblems(t.sql, sample, { NODE_ENV: "production" })).includes("Sample products can't be published on the live store"));
  assert.ok(!(await publishProblems(t.sql, sample, { NODE_ENV: "development" })).some((x) => x.startsWith("Sample")));
  await saveProduct(t.sql, admin, { id, name: "Kibble Deluxe", description: "Grain-free dry food for adult dogs, 2 kg resealable bag.", categoryId: cat, brand: "Acme", tags: ["dog"], seoTitle: null, seoDescription: null, isFeatured: false });
  await saveVariant(t.sql, admin, {
    productId: id, sku: "KIB-2KG", name: "2 kg", attributes: { size: "2 kg" }, isActive: true, sortOrder: 1, weightGrams: 2000, barcode: null,
    priceEur: 1999, compareEur: null, priceUsd: 2199, compareUsd: null, lowStockThreshold: 3, initialStock: 10, supplier: null,
  });
  assert.deepEqual(await publishProblems(t.sql, id), ["Add at least one photo"]);
  await t.sql`insert into public.product_images (product_id, storage_path, is_primary) values (${id}, ${id + "/a.webp"}, true)`;
  assert.deepEqual(await publishProblems(t.sql, id), []);
  const before = await loadCatalogSql(t.sql, "");
  assert.ok(!before.products.some((p) => p.slug === "kibble-deluxe"), "drafts are not in the catalog");
  const res = await setProductStatus(t.sql, admin, [id], "published");
  assert.equal(res.changed, 1);
  const cat2 = await loadCatalogSql(t.sql, "");
  const p = cat2.products.find((x) => x.slug === "kibble-deluxe");
  assert.ok(p, "published product is in the catalog");
  assert.equal(p.variants[0]!.stockQuantity, 10);
  assert.deepEqual(p.variants[0]!.prices.map((m) => [m.currency, m.amount]).sort(), [["EUR", 1999], ["USD", 2199]]);
  // Cart pricing reads only the products owning the requested variants (fresh, no categories).
  const scoped = await loadCatalogSql(t.sql, "", [p.variants[0]!.id, p.variants[0]!.id, "not-a-uuid"]);
  assert.deepEqual(scoped.products.map((x) => x.id), [p.id]);
  assert.equal(scoped.categories.length, 0);
  assert.equal(scoped.products[0]!.variants[0]!.stockQuantity, 10);
  assert.deepEqual((await loadCatalogSql(t.sql, "", [])).products, []);
  assert.ok(cat2.categories.some((c) => c.name === "Pet Food"));

  // 3D shelf mapping: pin to a face outside the benchmark aisle → that face is stocked with it.
  await savePlacement(t.sql, admin, id, { faceId: "R3N", priority: 10, hiddenInStore: false });
  const cat3 = await loadCatalogSql(t.sql, "");
  const layout = buildStoreLayout(cat3.categories, cat3.products, SUPERMARKET, ["L1N", "L2S"]);
  assert.ok(layout.stockedFaces.includes("R3N"));
  assert.ok(layout.priceTags.some((tag) => tag.productId === id && tag.faceId === "R3N"));
  await savePlacement(t.sql, admin, id, { faceId: null, priority: 0, hiddenInStore: true });
  const hidden = buildStoreLayout(cat3.categories, (await loadCatalogSql(t.sql, "")).products, SUPERMARKET, ["L1N", "L2S"]);
  assert.ok(!hidden.priceTags.some((tag) => tag.productId === id), "hidden products are not shelved");
  assert.ok(!hidden.unplaced.includes(id));

  // Stock adjustments are logged with before/after/reason/admin.
  await adjustStock(t.sql, admin, p.variants[0]!.id, 2, "Damaged in warehouse");
  const [mv] = await t.sql<{ quantity_before: number; quantity_after: number; reason: string; admin_user_id: string }[]>`
    select * from public.inventory_movements where variant_id = ${p.variants[0]!.id} order by id desc limit 1`;
  assert.deepEqual([mv!.quantity_before, mv!.quantity_after, mv!.reason, mv!.admin_user_id], [10, 2, "Damaged in warehouse", admin.id]);
  const [n] = await t.sql`select title from public.admin_notifications where kind = 'low_stock'`;
  assert.match(String(n!.title), /Low stock/);
  await assert.rejects(deleteCategory(t.sql, admin, cat), /Move the 1 product/);
});

test("ordered products are soft-deleted (order history kept); others hard-deleted", async () => {
  const [penne] = await t.sql<{ id: string; product_id: string }[]>`select id, product_id from public.product_variants where sku = 'MOCK-PASTA-PENNE-1'`;
  const o = await createOrder(t.sql, { email: "h@test.local", lines: [{ variantId: penne!.id, quantity: 1 }], shipTo: IT_ADDRESS, shippingMethodId: euMethod, idempotencyKey: "del-1", isTest: true });
  await assert.rejects(deleteProducts(t.sql, admin, [penne!.product_id]), /reserved/);
  await t.sql`select public.settle_order_inventory(${o.orderId}, 'release', null)`;
  const r = await deleteProducts(t.sql, admin, [penne!.product_id]);
  assert.deepEqual(r, { soft: 1, hard: 0 });
  const [row] = await t.sql`select deleted_at from public.products where id = ${penne!.product_id}`;
  assert.ok(row!.deleted_at);
  const [item] = await t.sql`select product_name from public.order_items where order_id = ${o.orderId}`;
  assert.equal(item!.product_name, "Durum Wheat Penne", "order snapshot intact");
  assert.ok(!(await loadCatalogSql(t.sql, "")).products.some((p) => p.id === penne!.product_id));

  const draft = await saveProduct(t.sql, admin, { name: "Throwaway", description: "", categoryId: null, brand: null, tags: [], seoTitle: null, seoDescription: null, isFeatured: false });
  assert.deepEqual(await deleteProducts(t.sql, admin, [draft]), { soft: 0, hard: 1 });
});

test("CSV import validates everything first and writes nothing on error", async () => {
  const bad = "product_slug,product_name,category_slug,variant_sku,price_eur,stock\nnew-a,New A,pantry,NEW-A-1,3.50,5\nnew-b,New B,nope,NEW-B-1,abc,-1\n";
  const r1 = await importProductsCsv(t.sql, admin, bad, false);
  assert.ok(r1.errors.length >= 2);
  const [{ n }] = (await t.sql<{ n: number }[]>`select count(*)::int as n from public.products where slug in ('new-a','new-b')`) as unknown as [{ n: number }];
  assert.equal(n, 0);

  const good = "product_slug,product_name,category_slug,status,variant_sku,variant_name,price_eur,price_usd,stock\nnew-a,New A,pantry,published,NEW-A-1,1 pc,3.50,3.99,5\n";
  const dry = await importProductsCsv(t.sql, admin, good, true);
  assert.deepEqual([dry.created, dry.errors.length], [1, 0]);
  assert.equal((await t.sql`select 1 from public.products where slug = 'new-a'`).length, 0, "dry run writes nothing");
  const real = await importProductsCsv(t.sql, admin, good, false);
  assert.equal(real.created, 1);
  // A CSV has no photo or description: asked for "published", kept as draft and reported (never silently).
  assert.equal(real.keptDraft.length, 1);
  assert.equal(real.keptDraft[0]!.slug, "new-a");
  assert.ok(real.keptDraft[0]!.problems.includes("Add at least one photo"));
  const [p] = await t.sql`select status from public.products where slug = 'new-a'`;
  assert.equal(p!.status, "draft");
  const csv = await exportProductsCsv(t.sql);
  assert.match(csv, /new-a,New A,pantry,draft,,,,NEW-A-1,1 pc,3\.50,3\.99,5/);
});
