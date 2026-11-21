import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Page not found", robots: { index: false } };

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <h1 className="font-display text-4xl leading-tight">
        <span className="eyebrow mb-3 block text-brand">404</span>
        We couldn&apos;t find that page
      </h1>
      <p className="text-ink-soft">The link may be old, or the product is no longer sold.</p>
      <div className="mt-2 flex flex-wrap justify-center gap-3">
        <Link href="/catalog" className="rounded-full bg-ink px-6 py-3 font-semibold text-cream transition hover:bg-brand">Browse the catalog</Link>
        <Link href="/" className="rounded-full border border-ink px-6 py-3 font-semibold transition hover:bg-ink hover:text-cream">Back to home</Link>
      </div>
    </main>
  );
}
