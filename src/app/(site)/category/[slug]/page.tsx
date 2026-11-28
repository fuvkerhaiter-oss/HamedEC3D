import type { Metadata } from "next";
import { TrackView } from "@/features/analytics/TrackView";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { JsonLd } from "@/components/JsonLd";
import { ProductCard } from "@/components/ProductCard";
import { getCatalog, type CatalogData } from "@/lib/catalog/source";
import { DEFAULT_OG_IMAGE, categoryPath, isIndexable, itemListLd, metaDescription, siteUrl } from "@/lib/seo/site";

// Same caching as the product pages: rendered on first visit, refreshed at most every 60 s and after admin edits.
export const revalidate = 60;
export function generateStaticParams(): { slug: string }[] {
  return [];
}

function load(catalog: CatalogData, slug: string) {
  const category = catalog.categories.find((c) => c.slug === slug);
  if (!category) return null;
  const products = catalog.products.filter((p) => p.categoryId === category.id && p.status === "published");
  return { category, products, indexable: products.filter(isIndexable) };
}

/** Real, factual fallback when no intro has been written in Admin → Categories. */
function fallbackIntro(name: string, products: { name: string }[]): string {
  const sample = products.slice(0, 3).map((p) => p.name).join(", ");
  return `Shop ${name.toLowerCase()} online at WEGO SHIIIP${sample ? `: ${sample}${products.length > 3 ? " and more" : ""}` : ""}. Prices in EUR and USD, delivered across the EU and the USA — or find them on the shelves of our 3D store.`;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const data = load(await getCatalog(), (await params).slug);
  if (!data) return { title: "Category" };
  const { category, products, indexable } = data;
  const description = metaDescription(category.description?.trim() || fallbackIntro(category.name, products));
  return {
    title: `${category.name} · Shop Online`,
    description,
    alternates: { canonical: categoryPath(category.slug) },
    openGraph: { title: `${category.name} · WEGO SHIIIP`, description, url: categoryPath(category.slug), images: [DEFAULT_OG_IMAGE] },
    // An empty (or sample-only) category is not a page worth indexing.
    ...(indexable.length === 0 ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const catalog = await getCatalog();
  const data = load(catalog, (await params).slug);
  if (!data) notFound();
  const { category, products, indexable } = data;
  const intro = category.description?.trim();
  const others = catalog.categories.filter((c) => c.id !== category.id && catalog.products.some((p) => p.categoryId === c.id));

  return (
    <div className="pb-20">
      <TrackView event="category_view" props={{ category: category.slug }} />
      {indexable.length > 0 && <JsonLd data={itemListLd(siteUrl(), category.name, indexable)} />}
      <div className="bg-brand text-white">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-5 sm:py-10">
          <Breadcrumbs tone="dark" items={[{ name: "Home", path: "/" }, { name: "Catalog", path: "/catalog" }, { name: category.name, path: categoryPath(category.slug) }]} />
          <h1 className="mt-4 font-display text-4xl leading-tight sm:text-5xl">{category.name}</h1>
          <div className="mt-3 max-w-2xl space-y-3 leading-relaxed text-white/80">
            {(intro || fallbackIntro(category.name, products)).split(/\r?\n\s*\r?\n/).map((para, i) => <p key={i}>{para}</p>)}
          </div>
          {catalog.source === "mock" && <p className="mt-3 text-xs text-white/70"><span className="font-semibold text-white">Sample catalog:</span> these are development sample products, not real listings.</p>}
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 pt-8 sm:px-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <p className="text-sm text-ink-soft">{products.length} product{products.length === 1 ? "" : "s"}</p>
          <div className="flex flex-wrap gap-2 text-sm">
            <Link href={`/catalog?category=${category.slug}`} className="btn-outline px-4 py-2">Filter & sort</Link>
            <Link href="/store" className="btn-dark px-4 py-2">See them in the 3D store</Link>
          </div>
        </div>
        {products.length === 0 ? (
          <p className="mt-8 rounded-2xl border border-dashed border-ink/20 bg-white px-6 py-16 text-center text-ink-soft">No products in this category right now. <Link href="/catalog" className="font-medium text-brand underline">Browse the full catalog</Link>.</p>
        ) : (
          <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4" aria-label={`${category.name} products`}>
            {products.map((p, i) => (
              <li key={p.id} className="flex">
                <div className="flex w-full flex-col [&>article]:flex-1">
                  <ProductCard product={p} categoryName={category.name} priority={i < 4} />
                </div>
              </li>
            ))}
          </ul>
        )}

        {others.length > 0 && (
          <nav aria-labelledby="other-cats" className="mt-16 border-t border-line pt-8">
            <h2 id="other-cats" className="font-display text-2xl">More departments</h2>
            <ul className="mt-4 flex flex-wrap gap-2">
              {others.map((c) => (
                <li key={c.id}><Link href={categoryPath(c.slug)} className="inline-block rounded-full border border-line bg-white px-4 py-2 text-sm font-medium transition hover:border-ink">{c.name}</Link></li>
              ))}
            </ul>
          </nav>
        )}
      </div>
    </div>
  );
}
