"use client";

import Link from "next/link";

/** A shop-dashboard page failed to load. The digest matches the server-log line; details are never shown. */
export default function SellerPageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-[60dvh] items-center justify-center px-5 py-12">
      <div role="alert" className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-card ring-1 ring-line">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-light">Shop dashboard</p>
        <h1 className="mt-1 font-display text-3xl font-extrabold tracking-tight">This page didn&apos;t load</h1>
        <p className="mt-3 text-sm text-ink-soft">Nothing was changed. Your shop and products are safe. Please try again in a moment.</p>
        {error.digest && <p className="mt-3 text-xs text-ink-soft">Reference: <span className="font-mono">{error.digest}</span></p>}
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button type="button" onClick={reset} className="btn-dark px-6 py-3">Try again</button>
          <Link href="/seller" className="btn-outline px-6 py-3">Dashboard</Link>
        </div>
      </div>
    </main>
  );
}
