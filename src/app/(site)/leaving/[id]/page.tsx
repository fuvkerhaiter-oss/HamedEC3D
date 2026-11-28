import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSql, isDbConfigured } from "@/lib/db/client";
import { leaveInfo } from "@/lib/tenants/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "You are leaving WEGO SHIIIP", robots: { index: false, follow: false } };

/**
 * Exit notice before a shop renter's own payment page: shoppers see who sells the product and which site they are
 * going to. WEGO SHIIIP does not take part in that sale (no payment, delivery or returns through us).
 */
export default async function LeavingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const info = isDbConfigured() ? await leaveInfo(getSql(), id) : null;
  if (!info) notFound();
  return (
    <main className="mx-auto w-full max-w-xl px-5 py-16">
      <p className="eyebrow text-ink-soft">Leaving WEGO SHIIIP</p>
      <h1 className="mt-2 font-display text-3xl leading-tight sm:text-4xl">You are going to {info.brand}&apos;s own page</h1>
      <div className="mt-6 space-y-3 rounded-3xl bg-white/70 p-6 text-sm leading-relaxed shadow-card">
        <p>
          <b>{info.title}</b> is sold by <b>{info.brand}</b>, an independent brand renting a shop in our 3D store.
        </p>
        <p>
          You will pay {info.brand} directly on <b className="font-mono">{info.host}</b>
          {info.recognised ? <> ({info.recognised})</> : null}. They are the seller: they handle payment, delivery, returns and support.
          WEGO SHIIIP is not part of that sale and does not receive your payment details.
        </p>
        {!info.recognised && (
          <p className="rounded-xl bg-amber/15 px-3 py-2 text-ink">
            This seller uses their own website rather than a payment provider we recognise. Check the address before you pay.
          </p>
        )}
        <p className="text-ink-soft">
          Something wrong with this seller? <Link className="underline" href="/contact">Report it to us</Link> and mention this product.
        </p>
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <a href={`/api/shop-products/${id}/buy`} rel="noopener noreferrer nofollow" className="btn-yellow px-6 py-3">
          Continue to {info.host} ↗
        </a>
        <Link href="/store" className="btn-ghost px-6 py-3">Back to the store</Link>
      </div>
    </main>
  );
}
