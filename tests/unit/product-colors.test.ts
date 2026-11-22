import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildStoreLayout, type StoreLayout } from "../../src/features/store3d/layout";
import type { EnvLayout } from "../../src/features/store3d/env/types";
import { assignProductColors, paletteColor, PRODUCT_PALETTE } from "../../src/lib/catalog/colors";
import { MOCK_CATEGORIES, MOCK_PRODUCTS } from "../../src/lib/catalog/mock-catalog";
import type { Product } from "../../src/lib/catalog/types";

const ENV = JSON.parse(readFileSync(new URL("../../src/features/store3d/env/supermarket.layout.json", import.meta.url), "utf8")) as EnvLayout;
const faceById = new Map(ENV.faces.map((f) => [f.id, f]));

/** Neighbouring blocks rebuilt from the price tags (one per block): same face, adjacent bay span or board. */
function neighbourPairs(layout: StoreLayout): [string, string][] {
  const pairs: [string, string][] = [];
  const byFace = new Map<string, StoreLayout["priceTags"]>();
  for (const t of layout.priceTags) byFace.set(t.faceId, [...(byFace.get(t.faceId) ?? []), t]);
  for (const [faceId, tags] of byFace) {
    const face = faceById.get(faceId)!;
    const alongX = Math.abs(face.normal[2]) > 0.5;
    const cells = tags.map((t) => ({ id: t.productId, a: alongX ? t.position[0] : t.position[2], y: t.position[1] }));
    const as = [...new Set(cells.map((c) => c.a.toFixed(3)))].map(Number).sort((p, q) => p - q);
    const ys = [...new Set(cells.map((c) => c.y.toFixed(3)))].map(Number).sort((p, q) => p - q);
    const at = new Map(cells.map((c) => [`${as.indexOf(+c.a.toFixed(3))},${ys.indexOf(+c.y.toFixed(3))}`, c.id]));
    for (let i = 0; i < as.length; i++) {
      for (let j = 0; j < ys.length; j++) {
        const id = at.get(`${i},${j}`)!;
        for (const n of [at.get(`${i + 1},${j}`), at.get(`${i},${j + 1}`)]) if (n && n !== id) pairs.push([id, n]);
      }
    }
  }
  return pairs;
}

function checkNeighboursDiffer(layout: StoreLayout, label: string) {
  const pairs = neighbourPairs(layout);
  assert.ok(pairs.length > 0, `${label}: has neighbouring different products`);
  for (const [a, b] of pairs) {
    assert.ok(layout.colors[a] && layout.colors[b], `${label}: both coloured`);
    assert.notEqual(layout.colors[a], layout.colors[b], `${label}: neighbours ${a} / ${b} differ`);
  }
}

test("neighbouring different products on a shelf face never share a colour (real layout)", () => {
  checkNeighboursDiffer(buildStoreLayout(MOCK_CATEGORIES, MOCK_PRODUCTS, ENV, ["L1N", "L2S"]), "bench");
  checkNeighboursDiffer(buildStoreLayout(MOCK_CATEGORIES, MOCK_PRODUCTS, ENV, "all"), "all");
});

test("still holds with a crowded single category (many products split across bays)", () => {
  const base = MOCK_PRODUCTS.find((p) => p.variants.some((v) => v.stockQuantity > 0))!;
  const many: Product[] = Array.from({ length: 60 }, (_, i) => ({ ...base, id: `${base.id}-x${i}`, slug: `${base.slug}-x${i}` }));
  checkNeighboursDiffer(buildStoreLayout(MOCK_CATEGORIES, many, ENV, ["L1N"]), "crowded");
});

test("every shelved product gets a colour and it is deterministic", () => {
  const a = buildStoreLayout(MOCK_CATEGORIES, MOCK_PRODUCTS, ENV, "all");
  const b = buildStoreLayout(MOCK_CATEGORIES, MOCK_PRODUCTS, ENV, "all");
  assert.deepEqual(a.colors, b.colors);
  for (const t of a.priceTags) assert.match(a.colors[t.productId]!, /^#[0-9a-f]{6}$/);
});

test("assignProductColors stays distinct past the palette size", () => {
  const ids = Array.from({ length: PRODUCT_PALETTE.length + 3 }, (_, i) => `p${i}`);
  const all = new Set(ids);
  const neighbours = new Map(ids.map((id) => [id, new Set([...all].filter((x) => x !== id))]));
  const colors = assignProductColors(ids, neighbours);
  assert.equal(new Set(Object.values(colors)).size, ids.length);
  for (let i = 0; i < 40; i++) assert.match(paletteColor(i), /^#[0-9a-f]{6}$/);
});
