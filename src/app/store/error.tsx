"use client";

import Link from "next/link";

/** Shown when the store can't load the catalog (e.g. database unreachable). Details stay in server logs. */
export default function StoreError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-ink px-6 text-center text-cream">
      <p className="eyebrow text-amber">Store temporarily unavailable</p>
      <h1 className="font-display text-4xl">We couldn&apos;t open the shelves</h1>
      <p className="max-w-md text-cream/70">The product catalog didn&apos;t load. Please try again in a moment.</p>
      <div className="flex flex-wrap justify-center gap-3">
        <button type="button" onClick={reset} className="rounded-full bg-amber px-6 py-3 font-semibold text-ink">
          Try again
        </button>
        <Link href="/" className="rounded-full border border-cream/30 px-6 py-3 font-semibold">
          Back to home
        </Link>
      </div>
    </main>
  );
}
