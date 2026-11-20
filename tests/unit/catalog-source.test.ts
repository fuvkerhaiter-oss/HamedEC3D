import { test } from "node:test";
import assert from "node:assert/strict";
import { mapProductRow, publicStorageUrl, DEFAULT_PLACEHOLDER_HEIGHT_M, type ProductRow } from "../../src/lib/catalog/source-map";

const URL = "https://abc.supabase.co";

const row: ProductRow = {
  id: "p1",
  slug: "olive-oil",
  name: "Olive Oil",
  description: "d",
  status: "published",
  is_mock: true,
  category_id: "c1",
  product_variants: [
    { id: "v2", sku: "B", name: "1 L", attributes: null, is_active: true, sort_order: 2, variant_prices: [{ currency: "EUR", amount: 1499 }], inventory: { quantity: 10, reserved: 3 } },
    { id: "v1", sku: "A", name: "500 ml", attributes: { size: "500 ml" }, is_active: true, sort_order: 1, variant_prices: [{ currency: "EUR", amount: "899" }, { currency: "USD", amount: 999 }, { currency: "XXX", amount: 1 }], inventory: [{ quantity: 2, reserved: 5 }] },
    { id: "v3", sku: "C", name: "off", attributes: null, is_active: false, sort_order: 0, variant_prices: [], inventory: null },
  ],
  product_3d_assets: [{ storage_path: "oil/bottle.glb", height_m: "0.280", is_primary: true }],
  product_images: [
    { storage_path: "b.jpg", alt: "", sort_order: 2 },
    { storage_path: "my photo.jpg", alt: "", sort_order: 1 },
  ],
};

test("maps rows to domain products", () => {
  const p = mapProductRow(row, URL);
  assert.deepEqual(p.variants.map((v) => v.id), ["v1", "v2"], "active only, sorted");
  assert.equal(p.variants[0]!.prices.length, 2, "unsupported currency dropped");
  assert.equal(p.variants[0]!.prices[0]!.amount, 899, "string amounts parsed");
  assert.equal(p.variants[0]!.stockQuantity, 0, "never negative");
  assert.equal(p.variants[1]!.stockQuantity, 7, "quantity - reserved");
  assert.equal(p.asset.heightMeters, 0.28);
  assert.equal(p.asset.glbUrl, `${URL}/storage/v1/object/public/product-models/oil/bottle.glb`);
  assert.equal(p.imageUrl, `${URL}/storage/v1/object/public/product-images/my%20photo.jpg`);
});

test("no 3D asset → placeholder height and null GLB", () => {
  const p = mapProductRow({ ...row, product_3d_assets: [], product_images: [] }, URL);
  assert.equal(p.asset.glbUrl, null);
  assert.equal(p.asset.heightMeters, DEFAULT_PLACEHOLDER_HEIGHT_M);
  assert.equal(p.imageUrl, null);
});

test("storage url trims trailing slash", () => {
  assert.equal(publicStorageUrl(`${URL}/`, "b", "x.png"), `${URL}/storage/v1/object/public/b/x.png`);
});
