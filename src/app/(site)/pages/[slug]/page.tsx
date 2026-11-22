import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublishedPage } from "@/lib/storefront/settings";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { metaDescription } from "@/lib/seo/site";
import { parseCmsBody } from "@/lib/storefront/cms-body";

export const revalidate = 60;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const page = await getPublishedPage((await params).slug);
  if (!page) return { title: "Page" };
  // First real paragraph (not a heading) as the description.
  const first = parseCmsBody(page.body).find((b) => b.kind === "p" && !b.text.startsWith("TEMPLATE"));
  const firstText = first && first.kind === "p" ? first.text : page.title;
  return { title: page.title, description: metaDescription(firstText), alternates: { canonical: `/pages/${page.slug}` } };
}

/** Published CMS page (Admin → Website Content). Plain text: blank lines = paragraphs, "# " = heading. Rendered as text (no HTML injection). */
export default async function CmsPage({ params }: { params: Promise<{ slug: string }> }) {
  const page = await getPublishedPage((await params).slug);
  if (!page) notFound();
  return (
    <article className="mx-auto max-w-3xl px-5 py-14">
      <Breadcrumbs items={[{ name: "Home", path: "/" }, { name: page.title, path: `/pages/${page.slug}` }]} className="mb-6" />
      <p className="eyebrow text-brand">WEGO SHIIIP</p>
      <h1 className="mt-3 font-display text-5xl leading-none">{page.title}</h1>
      <div className="mt-8 space-y-4 leading-relaxed text-ink-soft">
        {parseCmsBody(page.body).map((b, i) =>
          b.kind === "h2" ? <h2 key={i} className="pt-4 font-display text-2xl text-ink">{b.text}</h2>
          : b.kind === "h3" ? <h3 key={i} className="pt-2 font-semibold text-ink">{b.text}</h3>
          : b.kind === "list" ? <ul key={i} className="list-disc space-y-1.5 pl-5">{b.items.map((t, j) => <li key={j}>{t}</li>)}</ul>
          : <p key={i} className="whitespace-pre-line">{b.text}</p>,
        )}
      </div>
      {page.publishedAt && <p className="mt-10 font-mono text-xs text-ink-soft">Last updated {page.publishedAt.slice(0, 10)}</p>}
    </article>
  );
}
