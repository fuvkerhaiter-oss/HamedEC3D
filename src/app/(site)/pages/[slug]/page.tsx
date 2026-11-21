import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublishedPage } from "@/lib/storefront/settings";

export const revalidate = 60;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const page = await getPublishedPage((await params).slug);
  return { title: page?.title ?? "Page" };
}

/** Published CMS page (Admin → Website Content). Plain text: blank lines = paragraphs, "# " = heading. Rendered as text (no HTML injection). */
export default async function CmsPage({ params }: { params: Promise<{ slug: string }> }) {
  const page = await getPublishedPage((await params).slug);
  if (!page) notFound();
  const blocks = page.body.split(/\r?\n\s*\r?\n/).map((b) => b.trim()).filter(Boolean);
  return (
    <article className="mx-auto max-w-3xl px-5 py-14">
      <p className="eyebrow text-brand">WEGO SHIIIP</p>
      <h1 className="mt-3 font-display text-5xl leading-none">{page.title}</h1>
      <div className="mt-8 space-y-4 leading-relaxed text-ink-soft">
        {blocks.map((b, i) =>
          b.startsWith("#") ? (
            <h2 key={i} className="pt-4 font-display text-2xl text-ink">{b.replace(/^#+\s*/, "")}</h2>
          ) : (
            <p key={i} className="whitespace-pre-line">{b}</p>
          ),
        )}
      </div>
      {page.publishedAt && <p className="mt-10 font-mono text-xs text-ink-soft">Last updated {page.publishedAt.slice(0, 10)}</p>}
    </article>
  );
}
