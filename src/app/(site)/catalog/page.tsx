import type { Metadata } from "next";
import Link from "next/link";
import { ActiveFilterChips, CatalogSearchBar, countActiveFilters, FilterPanel } from "@/components/catalog/CatalogFilters";
import { FilterDrawer, MarketParamSync, SortSelect } from "@/components/catalog/CatalogControls";
import { ProductCard } from "@/components/ProductCard";
import { getCatalog } from "@/lib/catalog/source";
import { catalogHref, parseCatalogQuery, queryCatalog } from "@/lib/catalog/query";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const params = await searchParams;
  const query = parseCatalogQuery(params);
  const narrowed = Object.keys(params).some((k) => k !== "market"); // any search / filter / sort
  // Only the plain /catalog is indexed. Search, filter and sort variants are noindex (followed) and point
  // their canonical at the clean page: /category/<slug> when only a category is chosen, else /catalog.
  const onlyCategory = query.category && Object.keys(params).every((k) => k === "category" || k === "market");
  const canonical = onlyCategory ? `/category/${query.category}` : "/catalog";
  return {
    title: query.q ? `“${query.q}” · Search` : "Shop All Products Online",
    description: "Browse every WEGO SHIIIP product: search, filter by price and stock, and order online with delivery across the EU and the USA. Prices in EUR and USD.",
    alternates: { canonical },
    ...(narrowed ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function CatalogPage({ searchParams }: { searchParams: SearchParams }) {
  const query = parseCatalogQuery(await searchParams);
  const catalog = await getCatalog();
  const result = queryCatalog(catalog, query);
  const { products, activeCategory } = result;
  const slugOf = new Map(catalog.categories.map((c) => [c.id, c.slug]));
  const nameOf = new Map(catalog.categories.map((c) => [c.id, c.name]));
  const activeCount = countActiveFilters(query);
  const anyNarrowing = activeCount > 0 || !!query.q;

  const heading = query.q ? `Results for “${query.q}”` : activeCategory ? activeCategory.name : "All products";

  return (
    <div className="pb-20">
      <MarketParamSync query={query} />

      <div className="bg-brand text-white">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-5 sm:py-8">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
            <nav aria-label="Breadcrumb" className="text-xs text-white/65">
              <ol className="flex items-center gap-1.5">
                <li><Link href="/" className="hover:text-white hover:underline">Home</Link></li>
                <li aria-hidden>/</li>
                <li>{activeCategory ? <Link href="/catalog" className="hover:text-white hover:underline">Catalog</Link> : <span aria-current="page">Catalog</span>}</li>
                {activeCategory && (
                  <>
                    <li aria-hidden>/</li>
                    <li aria-current="page" className="font-medium text-white">{activeCategory.name}</li>
                  </>
                )}
              </ol>
            </nav>
            <Link href="/store" className="group inline-flex items-center gap-1.5 text-xs font-semibold text-amber hover:underline">
              Prefer to browse the shelves? Walk the 3D store
              <span aria-hidden className="transition group-hover:translate-x-0.5">→</span>
            </Link>
          </div>
          <div className="mt-4">
            <CatalogSearchBar query={query} categories={catalog.categories} />
          </div>
          {/* Crawlable department links (the filter panel uses query-string URLs that are not indexed). */}
          {catalog.categories.length > 0 && (
            <nav aria-label="Departments" className="mt-3">
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold">
                {catalog.categories.filter((c) => catalog.products.some((p) => p.categoryId === c.id)).map((c) => (
                  <li key={c.id}><Link href={`/category/${c.slug}`} className="text-white/80 hover:text-white hover:underline">{c.name}</Link></li>
                ))}
              </ul>
            </nav>
          )}
          {catalog.source === "mock" && (
            <p className="mt-3 text-xs text-white/70">
              <span className="font-semibold text-white">Sample catalog:</span> these are development sample products, not real listings.
            </p>
          )}
        </div>
      </div>

      <div className="mx-auto grid max-w-6xl gap-8 px-4 pt-6 sm:px-5 lg:grid-cols-[15rem_1fr]">
        <aside aria-label="Filters" className="hidden lg:block">
          <div className="sticky top-24 max-h-[calc(100dvh-7rem)] overflow-y-auto pr-2">
            <h2 className="sr-only">Filters</h2>
            <FilterPanel query={query} result={result} activeCount={activeCount} />
          </div>
        </aside>

        <section aria-labelledby="catalog-heading" className="min-w-0">
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
            <div className="min-w-0">
              <h1 id="catalog-heading" className="truncate font-display text-2xl leading-tight sm:text-3xl">{heading}</h1>
              <p className="mt-1 text-sm text-ink-soft" aria-live="polite">
                {products.length === 0
                  ? "No results"
                  : anyNarrowing
                    ? `${products.length} of ${result.total} product${result.total === 1 ? "" : "s"}`
                    : `${products.length} product${products.length === 1 ? "" : "s"}`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <FilterDrawer activeCount={activeCount} resultCount={products.length}>
                <FilterPanel query={query} result={result} activeCount={activeCount} />
              </FilterDrawer>
              <SortSelect query={query} />
            </div>
          </div>

          <div className="mt-4">
            <ActiveFilterChips query={query} activeCategory={activeCategory} />
          </div>

          {products.length === 0 ? (
            <div className="mt-8 rounded-2xl border border-dashed border-ink/20 bg-white px-6 py-16 text-center">
              <p className="font-display text-2xl">Nothing matches that yet</p>
              <p className="mx-auto mt-2 max-w-sm text-sm text-ink-soft">
                {query.q ? <>We couldn&apos;t find products for “{query.q}”. Check the spelling or try a broader word.</> : "Try removing a filter or widening the price range."}
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                {anyNarrowing && (
                  <Link href={catalogHref(query, { q: "", category: null, min: null, max: null, inStock: false, options: [] })} className="btn-dark px-5 py-2.5 text-sm">
                    Clear search and filters
                  </Link>
                )}
                <Link href="/store" className="btn-outline px-5 py-2.5 text-sm">
                  Walk the 3D store
                </Link>
              </div>
            </div>
          ) : (
            <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4" aria-label="Products">
              {products.map((p, i) => (
                <li key={p.id} className="flex">
                  <div className="flex w-full flex-col [&>article]:flex-1">
                    <ProductCard product={p} categorySlug={slugOf.get(p.categoryId)} categoryName={nameOf.get(p.categoryId)} priority={i < 4} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
