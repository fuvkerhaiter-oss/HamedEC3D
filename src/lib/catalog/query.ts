/**
 * Server-side catalog search, filtering, sorting and facets for the /catalog page.
 * Pure functions over the loaded catalog (getCatalog()); state lives in URL query params.
 * Prices are integer minor units in the market's currency (never floats).
 */
import { fromDecimalString, type Money } from "../money";
import { MARKETS, type MarketId } from "../markets";
import { priceIn, type Category, type Product } from "./types";

export const SORTS = ["relevance", "price-asc", "price-desc", "name-asc", "name-desc"] as const;
export type SortId = (typeof SORTS)[number];
export const SORT_LABELS: Record<SortId, string> = {
  relevance: "Relevance",
  "price-asc": "Price: low to high",
  "price-desc": "Price: high to low",
  "name-asc": "Name: A to Z",
  "name-desc": "Name: Z to A",
};

export interface CatalogQuery {
  q: string;
  category: string | null; // category slug
  market: MarketId;
  /** Decimal strings in market currency major units, exactly as typed ("5", "12.50"). */
  min: string | null;
  max: string | null;
  inStock: boolean;
  /** Selected option values as "key:value". */
  options: string[];
  sort: SortId;
}

type Params = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
const all = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []).map((s) => s.trim()).filter(Boolean);
const DECIMAL = /^\d{1,9}(\.\d{1,2})?$/;

export function parseCatalogQuery(params: Params): CatalogQuery {
  const market = first(params.market).toUpperCase();
  const sort = first(params.sort) as SortId;
  const min = first(params.min);
  const max = first(params.max);
  return {
    q: first(params.q).slice(0, 100),
    category: first(params.category) || null,
    market: market === "US" ? "US" : "EU",
    min: DECIMAL.test(min) ? min : null,
    max: DECIMAL.test(max) ? max : null,
    inStock: first(params.stock) === "in",
    options: [...new Set(all(params.opt).filter((o) => o.includes(":")))].slice(0, 20),
    sort: SORTS.includes(sort) ? sort : "relevance",
  };
}

/** Serialise a query (with optional overrides) back into a /catalog URL. Defaults are omitted. */
export function catalogHref(query: CatalogQuery, patch: Partial<CatalogQuery> = {}): string {
  const s = { ...query, ...patch };
  const p = new URLSearchParams();
  if (s.q) p.set("q", s.q);
  if (s.category) p.set("category", s.category);
  if (s.min) p.set("min", s.min);
  if (s.max) p.set("max", s.max);
  if (s.inStock) p.set("stock", "in");
  for (const o of s.options) p.append("opt", o);
  if (s.sort !== "relevance") p.set("sort", s.sort);
  // Market only matters when prices are compared; keep URLs clean otherwise.
  if (s.min || s.max || s.sort.startsWith("price")) p.set("market", s.market);
  const qs = p.toString();
  return qs ? `/catalog?${qs}` : "/catalog";
}

/** Lowest variant price in the given market, or null if the product isn't priced there. */
export function fromPrice(product: Product, market: MarketId): Money | null {
  let best: Money | null = null;
  for (const v of product.variants) {
    const p = priceIn(v, MARKETS[market].currency);
    if (p && (!best || p.amount < best.amount)) best = p;
  }
  return best;
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

/** 0 = no match. Every search term must appear in the name, description or category. */
function relevance(product: Product, terms: string[], phrase: string, categoryName: string): number {
  if (terms.length === 0) return 1;
  const name = norm(product.name);
  const desc = norm(product.description);
  const cat = norm(categoryName);
  let score = 0;
  for (const t of terms) {
    if (name.includes(t)) score += name.split(/\W+/).some((w) => w.startsWith(t)) ? 12 : 8;
    else if (cat.includes(t)) score += 4;
    else if (desc.includes(t)) score += 2;
    else return 0;
  }
  if (name.startsWith(phrase)) score += 20;
  else if (name.includes(phrase)) score += 10;
  return score;
}

const optionKeys = (product: Product) => {
  const out = new Set<string>();
  for (const v of product.variants) {
    const attrs = Object.entries(v.attributes ?? {}).filter(([, val]) => val);
    // Variants without structured attributes are still options, by their display name.
    if (attrs.length === 0 && v.name) out.add(`option:${v.name}`);
    for (const [k, val] of attrs) out.add(`${k}:${val}`);
  }
  return out;
};

export interface Facet {
  value: string;
  label: string;
  count: number;
}

export interface CatalogResult {
  products: Product[];
  /** Total products in the catalog before filtering. */
  total: number;
  categories: (Category & { count: number })[];
  /** Option facets grouped by attribute key (e.g. "size"). */
  options: { key: string; values: Facet[] }[];
  inStockCount: number;
  activeCategory: Category | null;
}

export function queryCatalog(data: { categories: Category[]; products: Product[] }, query: CatalogQuery): CatalogResult {
  const currency = MARKETS[query.market].currency;
  const catName = new Map(data.categories.map((c) => [c.id, c.name]));
  const activeCategory = data.categories.find((c) => c.slug === query.category) ?? null;
  const phrase = norm(query.q).replace(/\s+/g, " ");
  const terms = phrase.split(" ").filter(Boolean);

  const parse = (v: string | null) => {
    if (!v) return null;
    try {
      return fromDecimalString(v, currency).amount;
    } catch {
      return null;
    }
  };
  let lo = parse(query.min);
  let hi = parse(query.max);
  if (lo !== null && hi !== null && lo > hi) [lo, hi] = [hi, lo];

  const selected = new Map<string, Set<string>>();
  for (const o of query.options) {
    const i = o.indexOf(":");
    const key = o.slice(0, i);
    selected.set(key, (selected.get(key) ?? new Set()).add(o));
  }

  // Search (+ score) first; facets are counted on the searched set.
  const scored = new Map<string, number>();
  for (const p of data.products) {
    const s = relevance(p, terms, phrase, catName.get(p.categoryId) ?? "");
    if (s > 0) scored.set(p.id, s);
  }
  const searched = data.products.filter((p) => scored.has(p.id));

  const inPrice = (p: Product) =>
    (lo === null && hi === null) ||
    p.variants.some((v) => {
      const m = priceIn(v, currency);
      return !!m && (lo === null || m.amount >= lo) && (hi === null || m.amount <= hi);
    });
  const inStock = (p: Product) => p.variants.some((v) => v.stockQuantity > 0);
  const hasOptions = (p: Product) => {
    if (selected.size === 0) return true;
    const own = optionKeys(p);
    for (const values of selected.values()) if (![...values].some((v) => own.has(v))) return false;
    return true;
  };
  const inCategory = (p: Product) => !activeCategory || p.categoryId === activeCategory.id;
  const priced = (p: Product) => fromPrice(p, query.market) !== null;

  const base = searched.filter((p) => priced(p) && inPrice(p) && (!query.inStock || inStock(p)) && hasOptions(p));
  const categories = data.categories.map((c) => ({ ...c, count: base.filter((p) => p.categoryId === c.id).length }));

  const inCat = searched.filter((p) => priced(p) && inCategory(p));
  const optionCounts = new Map<string, Map<string, number>>();
  for (const p of inCat.filter((p) => inPrice(p) && (!query.inStock || inStock(p)))) {
    for (const o of optionKeys(p)) {
      const key = o.slice(0, o.indexOf(":"));
      const m = optionCounts.get(key) ?? new Map<string, number>();
      m.set(o, (m.get(o) ?? 0) + 1);
      optionCounts.set(key, m);
    }
  }
  const options = [...optionCounts.entries()]
    .map(([key, m]) => ({
      key,
      values: [...m.entries()]
        .map(([value, count]) => ({ value, label: value.slice(key.length + 1), count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, undefined, { numeric: true }))
        .slice(0, 15),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const products = base.filter(inCategory);
  const order = new Map(data.products.map((p, i) => [p.id, i]));
  const price = (p: Product) => fromPrice(p, query.market)?.amount ?? Number.MAX_SAFE_INTEGER;
  const byName = (a: Product, b: Product) => a.name.localeCompare(b.name);
  const sorters: Record<SortId, (a: Product, b: Product) => number> = {
    relevance: (a, b) => scored.get(b.id)! - scored.get(a.id)! || order.get(a.id)! - order.get(b.id)!,
    "price-asc": (a, b) => price(a) - price(b) || byName(a, b),
    "price-desc": (a, b) => price(b) - price(a) || byName(a, b),
    "name-asc": byName,
    "name-desc": (a, b) => byName(b, a),
  };
  products.sort(sorters[query.sort]);

  return {
    products,
    total: data.products.length,
    categories,
    options,
    inStockCount: searched.filter((p) => priced(p) && inCategory(p) && inPrice(p) && hasOptions(p) && inStock(p)).length,
    activeCategory,
  };
}
