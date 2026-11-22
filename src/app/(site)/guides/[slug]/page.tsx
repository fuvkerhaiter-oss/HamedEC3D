import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { JsonLd } from "@/components/JsonLd";
import { ProductCard } from "@/components/ProductCard";
import { getCatalog } from "@/lib/catalog/source";
import { GUIDES, getGuide, type GuideBlock } from "@/lib/content/guides";
import { DEFAULT_OG_IMAGE, articleLd, categoryPath, isIndexable, siteUrl } from "@/lib/seo/site";

export const revalidate = 3600;
export const dynamicParams = false;
export function generateStaticParams() {
  return GUIDES.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const g = getGuide((await params).slug);
  if (!g) return { title: "Guide" };
  return {
    title: g.title,
    description: g.description,
    alternates: { canonical: `/guides/${g.slug}` },
    openGraph: { type: "article", title: g.title, description: g.description, publishedTime: g.published, modifiedTime: g.updated, images: [DEFAULT_OG_IMAGE] },
  };
}

function Block({ b }: { b: GuideBlock }) {
  switch (b.type) {
    case "h2":
      return <h2 className="pt-6 font-display text-2xl text-ink">{b.text}</h2>;
    case "p":
      return <p>{b.text}</p>;
    case "list":
      return <ul className="list-disc space-y-2 pl-5">{b.items.map((t) => <li key={t}>{t}</li>)}</ul>;
    case "steps":
      return (
        <ol className="grid gap-4 sm:grid-cols-2">
          {b.items.map((s, i) => (
            <li key={s.title} className="rounded-2xl bg-sand/70 p-5">
              <span className="font-display text-3xl leading-none text-brand">{i + 1}</span>
              <h3 className="mt-3 font-display text-xl text-ink">{s.title}</h3>
              <p className="mt-1 text-sm">{s.text}</p>
            </li>
          ))}
        </ol>
      );
    case "keys":
      return (
        <table className="w-full text-left text-sm">
          <thead className="sr-only"><tr><th scope="col">Key</th><th scope="col">Action</th></tr></thead>
          <tbody className="divide-y divide-line">
            {b.rows.map((r) => (
              <tr key={r.label}>
                <td className="whitespace-nowrap py-2.5 pr-4">{r.keys.map((k) => <kbd key={k} className="mr-1 inline-block min-w-8 rounded-md border border-ink/20 border-b-[3px] bg-white px-2 py-0.5 text-center font-mono text-xs text-ink">{k}</kbd>)}</td>
                <td className="py-2.5">{r.label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
  }
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const g = getGuide((await params).slug);
  if (!g) notFound();
  const { products, categories } = await getCatalog();
  // Only link what really exists and is live.
  const related = products.filter((p) => isIndexable(p) && (g.products?.includes(p.slug) || (g.categories ?? []).includes(categories.find((c) => c.id === p.categoryId)?.slug ?? ""))).slice(0, 4);
  const relatedCats = categories.filter((c) => g.categories?.includes(c.slug));
  return (
    <article className="mx-auto max-w-3xl px-5 py-12">
      <JsonLd data={articleLd(siteUrl(), { path: `/guides/${g.slug}`, title: g.title, description: g.description, published: g.published, updated: g.updated })} />
      <Breadcrumbs items={[{ name: "Home", path: "/" }, { name: "Guides", path: "/guides" }, { name: g.title, path: `/guides/${g.slug}` }]} />
      <h1 className="mt-6 font-display text-4xl leading-tight sm:text-5xl">{g.title}</h1>
      <p className="mt-3 font-mono text-xs text-ink-soft">Updated <time dateTime={g.updated}>{g.updated}</time> · WEGO SHIIIP team</p>
      <div className="mt-8 space-y-4 leading-relaxed text-ink-soft">
        {g.blocks.map((b, i) => <Block key={i} b={b} />)}
      </div>
      {relatedCats.length > 0 && (
        <p className="mt-10 text-sm">Shop: {relatedCats.map((c, i) => <span key={c.id}>{i > 0 && " · "}<Link href={categoryPath(c.slug)} className="font-medium text-brand underline">{c.name}</Link></span>)}</p>
      )}
      {related.length > 0 && (
        <section aria-labelledby="guide-products" className="mt-10">
          <h2 id="guide-products" className="font-display text-2xl">Products in this guide</h2>
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">{related.map((p) => <li key={p.id} className="flex"><ProductCard product={p} /></li>)}</ul>
        </section>
      )}
      <div className="mt-12 flex flex-wrap gap-3">
        {g.links.map((l, i) => <Link key={l.href} href={l.href} className={`${i === 0 ? "btn-dark" : "btn-outline"} px-6 py-3`}>{l.label}</Link>)}
      </div>
    </article>
  );
}
