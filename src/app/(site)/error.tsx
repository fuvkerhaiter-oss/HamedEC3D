"use client";

import Link from "next/link";

/** Any storefront page that fails to render (e.g. database briefly unreachable). Details stay in server logs. */
export default function SiteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-[60dvh] max-w-xl flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <p className="eyebrow text-brand">Something went wrong</p>
      <h1 className="font-display text-4xl leading-tight">This page didn&apos;t load</h1>
      <p className="text-ink-soft">Your cart is safe. Please try again in a moment.</p>
      <div className="mt-2 flex flex-wrap justify-center gap-3">
        <button type="button" onClick={reset} className="rounded-full bg-ink px-6 py-3 font-semibold text-cream transition hover:bg-brand">
          Try again
        </button>
        <Link href="/catalog" className="rounded-full border border-ink px-6 py-3 font-semibold transition hover:bg-ink hover:text-cream">
          Browse the catalog
        </Link>
      </div>
    </main>
  );
}
