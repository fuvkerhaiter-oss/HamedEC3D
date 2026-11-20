import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildStoreLayout, PLACEMENT } from "../../src/features/store3d/layout";
import type { EnvLayout } from "../../src/features/store3d/env/types";
import { MOCK_CATEGORIES, MOCK_PRODUCTS } from "../../src/lib/catalog/mock-catalog";

const ENV = JSON.parse(readFileSync(new URL("../../src/features/store3d/env/supermarket.layout.json", import.meta.url), "utf8")) as EnvLayout;
const BENCH = ["L1N", "L2S"];
const bench = buildStoreLayout(MOCK_CATEGORIES, MOCK_PRODUCTS, ENV, BENCH);
const all = buildStoreLayout(MOCK_CATEGORIES, MOCK_PRODUCTS, ENV, "all");

const faceById = new Map(ENV.faces.map((f) => [f.id, f]));

test("environment layout has the measured runs, faces and checkout", () => {
  assert.equal(ENV.runs.length, 6);
  assert.equal(ENV.faces.length, 12);
  assert.ok(ENV.checkout);
  for (const f of ENV.faces) assert.deepEqual(f.boards, [0.46, 0.94, 1.41, 1.89]);
});

test("benchmark aisle stocks every product with stock, and only the two benchmark faces", () => {
  assert.deepEqual(bench.stockedFaces, BENCH);
  assert.deepEqual(bench.unplaced, []);
  const inStock = MOCK_PRODUCTS.filter((p) => p.variants.some((v) => v.stockQuantity > 0));
  for (const p of inStock) assert.ok((bench.items[p.id]?.length ?? 0) > 0, `${p.slug} on shelf`);
});

test("sold-out products get a price tag but no units (no fake stock)", () => {
  const soldOut = MOCK_PRODUCTS.find((p) => p.variants.every((v) => v.stockQuantity === 0))!;
  assert.equal(bench.items[soldOut.id], undefined);
  assert.ok(bench.priceTags.some((t) => t.productId === soldOut.id));
});

test("every unit sits on a board, within its bay, between shelf lip and divider, under the next board", () => {
  for (const [, list] of Object.entries(all.items)) {
    for (const it of list) {
      const [x, y, z] = it.position;
      const [w, h, d] = it.scale;
      const face = ENV.faces.find((f) => {
        const lo = Math.min(f.frontEdge, f.backEdge), hi = Math.max(f.frontEdge, f.backEdge);
        return z - d / 2 >= lo - 1e-6 && z + d / 2 <= hi + 1e-6 && f.bays.some(([a, b]) => x - w / 2 >= a - 1e-6 && x + w / 2 <= b + 1e-6);
      });
      assert.ok(face, `unit at ${x.toFixed(2)},${z.toFixed(2)} inside a face`);
      const bottom = y - h / 2;
      const board = face!.boards.find((b) => Math.abs(bottom - b) < 0.01);
      assert.ok(board !== undefined, `rests on a board (bottom ${bottom.toFixed(3)})`);
      assert.ok(h <= PLACEMENT.shelfClearance && y + h / 2 < board! + face!.clearance, "fits under the next board");
    }
  }
});

test("price tags are on the shelf lip of their face", () => {
  for (const t of all.priceTags) {
    const f = faceById.get(t.faceId)!;
    assert.ok(Math.abs(t.position[2] - f.frontEdge) < 0.02);
  }
});

test("benchmark aisle gets signs at both ends, inside the store", () => {
  assert.equal(bench.signs.length, 2);
  const [a, b] = bench.signs;
  assert.ok(a!.position[2] > -2.632 && a!.position[2] < 0.093, "sign hangs over the aisle");
  assert.ok(a!.position[0] < b!.position[0]);
});

test("stocking all faces covers all 12 faces and keeps every unit inside the store", () => {
  assert.equal(all.stockedFaces.length, 12);
  const { min, max } = ENV.interior;
  for (const list of Object.values(all.items)) for (const it of list) {
    assert.ok(it.position[0] > min[0] && it.position[0] < max[0] && it.position[2] > min[2] && it.position[2] < max[2]);
  }
});

test("empty catalog produces an empty but valid layout", () => {
  const l = buildStoreLayout([], [], ENV, "all");
  assert.deepEqual(l.items, {});
  assert.equal(l.priceTags.length, 0);
});
