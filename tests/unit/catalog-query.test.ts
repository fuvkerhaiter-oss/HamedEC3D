import { test } from "node:test";
import assert from "node:assert/strict";
import { MOCK_CATEGORIES, MOCK_PRODUCTS } from "../../src/lib/catalog/mock-catalog";
import { catalogHref, fromPrice, parseCatalogQuery, queryCatalog } from "../../src/lib/catalog/query";

const data = { categories: MOCK_CATEGORIES, products: MOCK_PRODUCTS };
const run = (params: Record<string, string | string[]>) => queryCatalog(data, parseCatalogQuery(params));
const slugs = (params: Record<string, string | string[]>) => run(params).products.map((p) => p.slug);

test("parse: defaults and rejects junk", () => {
  const q = parseCatalogQuery({ sort: "hack", min: "1e9", max: "-3", market: "xx", opt: ["nocolon", "size:1 L", "size:1 L"] });
  assert.equal(q.sort, "relevance");
  assert.equal(q.min, null);
  assert.equal(q.max, null);
  assert.equal(q.market, "EU");
  assert.deepEqual(q.options, ["size:1 L"]);
});

test("no params returns the whole catalog in catalog order", () => {
  const r = run({});
  assert.equal(r.products.length, MOCK_PRODUCTS.length);
  assert.equal(r.products[0]!.slug, MOCK_PRODUCTS[0]!.slug);
});

test("search matches name/description/category, all terms required, name matches rank first", () => {
  assert.deepEqual(slugs({ q: "chocolate" }), ["dark-chocolate"]);
  assert.deepEqual(slugs({ q: "OLIVE oil" }), ["olive-oil"]);
  assert.deepEqual(slugs({ q: "olive banana" }), []);
  assert.ok(slugs({ q: "drinks" }).includes("cold-brew")); // via category name
});

test("category filter + category counts reflect the other filters", () => {
  const r = run({ category: "drinks", stock: "in" });
  assert.deepEqual(r.products.map((p) => p.slug).sort(), ["orange-juice", "sparkling-water"]);
  assert.equal(r.categories.find((c) => c.slug === "drinks")!.count, 2);
  assert.equal(r.activeCategory?.slug, "drinks");
});

test("price range uses integer minor units in the market currency (inclusive, any variant)", () => {
  // Olive oil variants: 8.99 and 14.99 -> matches 14..15 through its 1 L variant.
  assert.deepEqual(slugs({ min: "14", max: "15" }), ["olive-oil"]);
  assert.deepEqual(slugs({ min: "2.49", max: "2.49" }), ["pasta-penne"]);
  // Swapped bounds are tolerated.
  assert.deepEqual(slugs({ min: "15", max: "14" }), ["olive-oil"]);
});

test("option filter: OR within a key", () => {
  assert.deepEqual(slugs({ opt: ["size:1 L", "size:100 g"] }).sort(), ["dark-chocolate", "olive-oil", "orange-juice"]);
  const sizes = run({}).options.find((o) => o.key === "size")!;
  assert.ok(sizes.values.some((v) => v.label === "1.5 L" && v.count === 2));
});

test("sorting by price and name", () => {
  const asc = run({ sort: "price-asc" }).products;
  for (let i = 1; i < asc.length; i++) assert.ok(fromPrice(asc[i - 1]!, "EU")!.amount <= fromPrice(asc[i]!, "EU")!.amount);
  assert.equal(run({ sort: "price-desc" }).products[0]!.slug, "laundry-liquid");
  assert.equal(run({ sort: "name-asc" }).products[0]!.name, "70% Dark Chocolate");
});

test("catalogHref omits defaults and only adds market for price state", () => {
  const q = parseCatalogQuery({});
  assert.equal(catalogHref(q), "/catalog");
  assert.equal(catalogHref(q, { q: "oil", category: "pantry" }), "/catalog?q=oil&category=pantry");
  assert.equal(catalogHref(q, { sort: "price-asc", market: "US" }), "/catalog?sort=price-asc&market=US");
  assert.equal(catalogHref(q, { options: ["size:1 L"] }), "/catalog?opt=size%3A1+L");
});
