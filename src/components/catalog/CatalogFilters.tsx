/** Server-rendered filter sidebar, search bar and active-filter chips for /catalog (plain links/forms). */
import Link from "next/link";
import type { ReactNode } from "react";
import { catalogHref, type CatalogQuery, type CatalogResult } from "@/lib/catalog/query";
import type { Category } from "@/lib/catalog/types";
import { MARKETS } from "@/lib/markets";
import { formatMoney, fromDecimalString } from "@/lib/money";
import { PriceRangeForm } from "./CatalogControls";

export function CatalogSearchBar({ query, categories }: { query: CatalogQuery; categories: Category[] }) {
  return (
    <form action="/catalog" method="get" role="search" aria-label="Search the catalog" className="flex h-12 w-full overflow-hidden rounded-xl bg-white shadow-card ring-1 ring-line transition focus-within:ring-2 focus-within:ring-brand sm:h-14">
      <label className="sr-only" htmlFor="catalog-search-category">Search in category</label>
      <select
        id="catalog-search-category"
        name="category"
        defaultValue={query.category ?? ""}
        className="w-[7.75rem] shrink-0 cursor-pointer border-r border-line bg-sand/60 px-2.5 text-xs font-medium text-ink outline-none hover:bg-sand min-[420px]:w-auto min-[420px]:max-w-[11rem] sm:px-4 sm:text-sm"
      >
        <option value="">All categories</option>
        {categories.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
      </select>
      <label className="sr-only" htmlFor="catalog-search-q">Search products</label>
      <input
        id="catalog-search-q"
        name="q"
        type="search"
        defaultValue={query.q}
        maxLength={100}
        placeholder="Search products"
        autoComplete="off"
        enterKeyHint="search"
        className="min-w-0 flex-1 bg-transparent px-3 text-[15px] text-ink outline-none placeholder:text-ink-soft/60 sm:px-4 sm:text-base"
      />
      <button type="submit" className="flex shrink-0 items-center gap-2 bg-ink px-4 font-semibold text-cream transition hover:bg-brand sm:px-6" aria-label="Search">
        <svg aria-hidden viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="8.5" cy="8.5" r="5.5" />
          <path d="M13 13l4 4" />
        </svg>
        <span className="hidden sm:inline">Search</span>
      </button>
    </form>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-line py-5 first:pt-0 last:border-b-0">
      <h3 className="mb-3 text-sm font-bold text-ink">{title}</h3>
      {children}
    </section>
  );
}

function CheckLink({ href, checked, label, count }: { href: string; checked: boolean; label: string; count: number }) {
  return (
    <Link
      href={href}
      scroll={false}
      className={`group flex items-center gap-2.5 rounded-md py-1.5 text-sm transition ${count === 0 && !checked ? "text-ink-soft/50" : "text-ink-soft hover:text-ink"}`}
    >
      <span aria-hidden className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${checked ? "border-brand bg-brand text-cream" : "border-ink-soft/40 bg-white group-hover:border-ink"}`}>
        {checked && (
          <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2.5 6.2l2.3 2.3 4.7-5" />
          </svg>
        )}
      </span>
      <span className={`flex-1 ${checked ? "font-semibold text-ink" : ""}`}>
        {label}
        {checked && <span className="sr-only"> (selected, select to remove)</span>}
      </span>
      <span className="font-mono text-[11px] text-ink-soft/70">{count}</span>
    </Link>
  );
}

const optionTitle = (key: string) => key.charAt(0).toUpperCase() + key.slice(1).replace(/[_-]/g, " ");

export function FilterPanel({ query, result, activeCount }: { query: CatalogQuery; result: CatalogResult; activeCount: number }) {
  const toggle = (o: string) => (query.options.includes(o) ? query.options.filter((x) => x !== o) : [...query.options, o]);
  const catTotal = result.categories.reduce((n, c) => n + c.count, 0);
  return (
    <div>
      {activeCount > 0 && (
        <div className="mb-4 flex items-center justify-between">
          <p className="text-xs text-ink-soft">{activeCount} filter{activeCount === 1 ? "" : "s"} applied</p>
          <Link href={catalogHref(query, { category: null, min: null, max: null, inStock: false, options: [] })} scroll={false} className="text-xs font-semibold text-brand underline-offset-2 hover:underline">
            Clear filters
          </Link>
        </div>
      )}
      <Section title="Category">
        <ul className="space-y-0.5 text-sm">
          {[{ slug: null as string | null, name: "All categories", count: catTotal, id: "all" }, ...result.categories].map((c) => {
            const on = (query.category ?? null) === c.slug;
            return (
              <li key={c.id}>
                <Link
                  href={catalogHref(query, { category: c.slug, options: [] })}
                  scroll={false}
                  aria-current={on ? "page" : undefined}
                  className={`flex items-center justify-between rounded-md px-2 py-1.5 transition ${on ? "bg-ink font-semibold text-cream" : c.count === 0 ? "text-ink-soft/50 hover:bg-sand" : "text-ink-soft hover:bg-sand hover:text-ink"}`}
                >
                  <span>{c.name}</span>
                  <span className={`font-mono text-[11px] ${on ? "text-cream/70" : "text-ink-soft/70"}`}>{c.count}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </Section>
      <Section title="Price">
        <PriceRangeForm query={query} />
      </Section>
      <Section title="Availability">
        <CheckLink href={catalogHref(query, { inStock: !query.inStock })} checked={query.inStock} label="In stock only" count={result.inStockCount} />
      </Section>
      {result.options.map((group) => (
        <Section key={group.key} title={optionTitle(group.key)}>
          <ul>
            {group.values.map((v) => (
              <li key={v.value}>
                <CheckLink href={catalogHref(query, { options: toggle(v.value) })} checked={query.options.includes(v.value)} label={v.label} count={v.count} />
              </li>
            ))}
          </ul>
        </Section>
      ))}
    </div>
  );
}

export function countActiveFilters(query: CatalogQuery): number {
  return (query.category ? 1 : 0) + (query.min || query.max ? 1 : 0) + (query.inStock ? 1 : 0) + query.options.length;
}

export function ActiveFilterChips({ query, activeCategory }: { query: CatalogQuery; activeCategory: Category | null }) {
  const market = MARKETS[query.market];
  const fmt = (v: string) => {
    try {
      return formatMoney(fromDecimalString(v, market.currency), market.locale);
    } catch {
      return v;
    }
  };
  const chips: { label: string; href: string }[] = [];
  if (query.q) chips.push({ label: `“${query.q}”`, href: catalogHref(query, { q: "" }) });
  if (activeCategory) chips.push({ label: activeCategory.name, href: catalogHref(query, { category: null, options: [] }) });
  if (query.min || query.max) {
    const label = query.min && query.max ? `${fmt(query.min)} – ${fmt(query.max)}` : query.min ? `From ${fmt(query.min)}` : `Up to ${fmt(query.max!)}`;
    chips.push({ label, href: catalogHref(query, { min: null, max: null }) });
  }
  if (query.inStock) chips.push({ label: "In stock", href: catalogHref(query, { inStock: false }) });
  for (const o of query.options) {
    const i = o.indexOf(":");
    chips.push({ label: `${optionTitle(o.slice(0, i))}: ${o.slice(i + 1)}`, href: catalogHref(query, { options: query.options.filter((x) => x !== o) }) });
  }
  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Active filters">
      {chips.map((c) => (
        <Link
          key={c.href + c.label}
          href={c.href}
          scroll={false}
          aria-label={`Remove filter: ${c.label}`}
          className="group inline-flex items-center gap-1.5 rounded-full bg-white py-1 pl-3 pr-2 text-xs font-medium text-ink ring-1 ring-line transition hover:ring-ink/40"
        >
          {c.label}
          <svg aria-hidden viewBox="0 0 12 12" className="h-3.5 w-3.5 rounded-full p-0.5 text-ink-soft transition group-hover:bg-ink group-hover:text-cream" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M3 3l6 6M9 3L3 9" />
          </svg>
        </Link>
      ))}
      <Link href={catalogHref(query, { q: "", category: null, min: null, max: null, inStock: false, options: [] })} scroll={false} className="ml-1 text-xs font-semibold text-brand underline-offset-2 hover:underline">
        Clear all
      </Link>
    </div>
  );
}
