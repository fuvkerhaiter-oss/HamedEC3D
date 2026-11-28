import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs, type Crumb } from "@/components/Breadcrumbs";
import { JsonLd } from "@/components/JsonLd";
import { ProductCard } from "@/components/ProductCard";
import { ProductDetail } from "@/features/catalog/ProductDetail";
import { getProductReviews } from "@/lib/catalog/reviews";
import { getCatalog } from "@/lib/catalog/source";
import type { Product } from "@/lib/catalog/types";
import { formatMoney, type Money } from "@/lib/money";
import { DEFAULT_OG_IMAGE, categoryPath, productDescription, productLd, productPath, productTitle, siteUrl } from "@/lib/seo/site";

export const revalidate = 60;
// None at build time (the build must not depend on the database): each product page is rendered on its first
// visit, then served from the cache and refreshed at most every 60 s (and right after admin edits).
export function generateStaticParams(): { slug: string }[] {
  return [];
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const { products, categories } = await getCatalog();
  const p = products.find((x) => x.slug === slug);
  if (!p) return { title: "Product" };
  const cat = categories.find((c) => c.id === p.categoryId);
  const title = productTitle(p, cat?.name);
  const description = productDescription(p, cat?.name);
  const image = p.gallery?.[0] ?? (p.imageUrl ? { url: p.imageUrl, alt: p.name, width: null, height: null } : null);
  return {
    title,
    description,
    alternates: { canonical: productPath(p.slug) },
    openGraph: {
      type: "website",
      title,
      description,
      url: productPath(p.slug),
      images: image ? [{ url: image.url, alt: image.alt || p.name, ...(image.width && image.height ? { width: image.width, height: image.height } : {}) }] : [DEFAULT_OG_IMAGE],
    },
    robots: p.isMock ? { index: false, follow: true } : undefined,
  };
}

const price = (prices: Money[], currency: Money["currency"], locale: string) => {
  const m = prices.find((x) => x.currency === currency);
  return m ? formatMoney(m, locale) : "—";
};

/** Server-rendered facts (crawlable, readable without JavaScript or WebGL): options, SKU, both markets' prices, stock. */
function Specifications({ product }: { product: Product }) {
  const attrKeys = [...new Set(product.variants.flatMap((v) => Object.keys(v.attributes)))];
  return (
    <section aria-labelledby="specs" className="mt-14">
      <h2 id="specs" className="font-display text-2xl">Product details</h2>
      <div tabIndex={0} role="region" aria-label="Product details table" className="mt-4 overflow-x-auto rounded-2xl border border-line bg-white focus-visible:outline-2 focus-visible:outline-brand">
        <table className="w-full min-w-[34rem] text-left text-sm">
          <thead className="bg-sand/60 text-xs uppercase tracking-wide text-ink-soft">
            <tr>
              <th scope="col" className="px-4 py-3">Option</th>
              {attrKeys.map((k) => <th key={k} scope="col" className="px-4 py-3">{k}</th>)}
              <th scope="col" className="px-4 py-3">SKU</th>
              <th scope="col" className="px-4 py-3">EU price (VAT incl.)</th>
              <th scope="col" className="px-4 py-3">US price (before tax)</th>
              <th scope="col" className="px-4 py-3">Availability</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {product.variants.map((v) => (
              <tr key={v.id}>
                <th scope="row" className="px-4 py-3 font-medium">{v.name}</th>
                {attrKeys.map((k) => <td key={k} className="px-4 py-3">{v.attributes[k] ?? "—"}</td>)}
                <td className="px-4 py-3 font-mono text-xs">{v.sku}</td>
                <td className="px-4 py-3 tabular-nums">{price(v.prices, "EUR", "en-IE")}</td>
                <td className="px-4 py-3 tabular-nums">{price(v.prices, "USD", "en-US")}</td>
                <td className="px-4 py-3">{v.stockQuantity > 0 ? "In stock" : "Out of stock"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-ink-soft">
        Shipping costs and delivery times for your address are shown at checkout before you pay. See our{" "}
        <Link href="/pages/shipping" className="underline">shipping</Link> and <Link href="/pages/returns" className="underline">returns</Link> policies.
      </p>
    </section>
  );
}

const stars = (n: number) => "★★★★★".slice(0, Math.round(n)) + "☆☆☆☆☆".slice(0, 5 - Math.round(n));

/** Product page — same catalog data (and images) as the catalog grid and the 3D store. */
export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { products, categories } = await getCatalog();
  const product = products.find((p) => p.slug === slug);
  if (!product) notFound();
  const cat = categories.find((c) => c.id === product.categoryId);
  const reviews = product.isMock ? null : await getProductReviews(product.id);
  const related = products.filter((p) => p.id !== product.id && p.categoryId === product.categoryId && p.status === "published").slice(0, 4);
  const site = siteUrl();
  const crumbs: Crumb[] = [
    { name: "Home", path: "/" },
    { name: "Catalog", path: "/catalog" },
    ...(cat ? [{ name: cat.name, path: categoryPath(cat.slug) }] : []),
    { name: product.name, path: productPath(product.slug) },
  ];
  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <Breadcrumbs items={crumbs} className="mb-6" />
      {!product.isMock && <JsonLd data={productLd(site, product, { category: cat, reviews: reviews ?? undefined })} />}
      <ProductDetail product={product} categoryName={cat?.name} />

      <Specifications product={product} />

      {reviews && reviews.count > 0 && (
        <section aria-labelledby="reviews" className="mt-14">
          <h2 id="reviews" className="font-display text-2xl">Customer reviews</h2>
          <p className="mt-2 text-sm text-ink-soft"><span aria-hidden className="text-amber">{stars(reviews.average)}</span> {reviews.average.toFixed(1)} out of 5 · {reviews.count} review{reviews.count === 1 ? "" : "s"}</p>
          <ul className="mt-5 grid gap-4 sm:grid-cols-2">
            {reviews.reviews.map((r, i) => (
              <li key={i} className="rounded-2xl border border-line bg-white p-5">
                <p className="text-sm"><span aria-label={`${r.rating} out of 5`} className="text-amber">{stars(r.rating)}</span>{r.title && <span className="ml-2 font-semibold">{r.title}</span>}</p>
                {r.body && <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-soft">{r.body}</p>}
                <p className="mt-3 font-mono text-xs text-ink-soft">{r.author} · <time dateTime={r.date}>{r.date}</time>{r.verified && " · Verified purchase"}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {related.length > 0 && (
        <section aria-labelledby="related" className="mt-14">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 id="related" className="font-display text-2xl">More {cat ? cat.name.toLowerCase() : "products"}</h2>
            {cat && <Link href={categoryPath(cat.slug)} className="text-sm font-semibold text-brand underline">All {cat.name}</Link>}
          </div>
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
            {related.map((p) => (
              <li key={p.id} className="flex"><div className="flex w-full flex-col [&>article]:flex-1"><ProductCard product={p} categoryName={cat?.name} /></div></li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-12 text-sm text-ink-soft">Find it on the shelves too: <Link href="/store" className="font-medium text-brand underline">walk the 3D store →</Link></p>
    </div>
  );
}
