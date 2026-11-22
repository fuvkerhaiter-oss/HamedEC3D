import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { GUIDES } from "@/lib/content/guides";

export const metadata: Metadata = {
  title: "Guides",
  description: "Practical WEGO SHIIIP guides: how to shop the interactive 3D store, and buying guides for the products we sell.",
  alternates: { canonical: "/guides" },
};

/** Guides index. 404 while there are no guides (no empty pages for search engines). */
export default function GuidesPage() {
  if (GUIDES.length === 0) notFound();
  const list = [...GUIDES].sort((a, b) => b.updated.localeCompare(a.updated));
  return (
    <div className="mx-auto max-w-4xl px-5 py-12">
      <Breadcrumbs items={[{ name: "Home", path: "/" }, { name: "Guides", path: "/guides" }]} />
      <h1 className="mt-6 font-display text-4xl leading-tight sm:text-5xl">Guides</h1>
      <p className="mt-4 max-w-2xl text-lg leading-relaxed text-ink-soft">Short, practical help for shopping at WEGO SHIIIP: how the 3D store works, and buying guides for the products we stock.</p>
      <ul className="mt-10 grid gap-4 sm:grid-cols-2">
        {list.map((g) => (
          <li key={g.slug} className="rounded-2xl border border-line bg-white p-6 transition hover:-translate-y-0.5 hover:shadow-md">
            <h2 className="font-display text-2xl leading-tight"><Link href={`/guides/${g.slug}`} className="hover:underline hover:decoration-amber hover:decoration-2 hover:underline-offset-4">{g.title}</Link></h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">{g.description}</p>
            <p className="mt-4 font-mono text-xs text-ink-soft">Updated <time dateTime={g.updated}>{g.updated}</time></p>
          </li>
        ))}
      </ul>
    </div>
  );
}
