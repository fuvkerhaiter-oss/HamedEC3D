import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductDetail } from "@/features/catalog/ProductDetail";
import { getCatalog } from "@/lib/catalog/source";
import type { Product } from "@/lib/catalog/types";
import { toDecimalString } from "@/lib/money";

export const revalidate = 60;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const p = (await getCatalog()).products.find((x) => x.slug === slug);
  return p
    ? { title: p.name, description: p.description.slice(0, 160), alternates: { canonical: `/catalog/${p.slug}` }, openGraph: { type: "website", title: p.name, description: p.description.slice(0, 160), images: p.imageUrl ? [p.imageUrl] : undefined }, robots: p.isMock ? { index: false } : undefined }
    : { title: "Product" };
}

/** Product page — same catalog data (and images) as the catalog grid and the 3D store. */
export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { products, categories } = await getCatalog();
  const product = products.find((p) => p.slug === slug);
  if (!product) notFound();
  const cat = categories.find((c) => c.id === product.categoryId);
  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <nav aria-label="Breadcrumb" className="mb-6 font-mono text-xs text-ink-soft">
        <Link href="/catalog" className="hover:text-ink">Catalog</Link>
        {cat && <> / <Link href={`/catalog?category=${cat.slug}`} className="hover:text-ink">{cat.name}</Link></>}
      </nav>
      {!product.isMock && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: productJsonLd(product, (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "")) }} />}
      <ProductDetail product={product} categoryName={cat?.name} />
      <p className="mt-12 text-sm text-ink-soft">Find it on the shelves too: <Link href="/store" className="font-medium text-brand underline">walk the 3D store →</Link></p>
    </div>
  );
}

/** schema.org Product data so search engines (Google Shopping, rich results) show price and stock. */
function productJsonLd(p: Product, site: string) {
  const offers = p.variants.flatMap((v) =>
    v.prices.map((m) => ({
      "@type": "Offer",
      sku: v.sku,
      price: toDecimalString(m),
      priceCurrency: m.currency,
      availability: v.stockQuantity > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      url: `${site}/catalog/${p.slug}`,
      itemCondition: "https://schema.org/NewCondition",
    })),
  );
  const json = { "@context": "https://schema.org", "@type": "Product", name: p.name, description: p.description, image: p.gallery?.map((g) => g.url) ?? (p.imageUrl ? [p.imageUrl] : undefined), sku: p.variants[0]?.sku, brand: { "@type": "Brand", name: "Mega Market" }, offers };
  // Escape "<" so product text can never close the script tag.
  return JSON.stringify(json).replace(/</g, "\u003c");
}
