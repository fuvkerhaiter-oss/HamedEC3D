import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductDetail } from "@/features/catalog/ProductDetail";
import { getCatalog } from "@/lib/catalog/source";

export const revalidate = 60;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const p = (await getCatalog()).products.find((x) => x.slug === slug);
  return p ? { title: p.name, description: p.description.slice(0, 160), openGraph: p.imageUrl ? { images: [p.imageUrl] } : undefined } : { title: "Product" };
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
      <ProductDetail product={product} categoryName={cat?.name} />
      <p className="mt-12 text-sm text-ink-soft">Find it on the shelves too: <Link href="/store" className="font-medium text-brand underline">walk the 3D store →</Link></p>
    </div>
  );
}
