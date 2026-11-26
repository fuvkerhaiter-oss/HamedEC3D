import type { Metadata } from "next";
import Link from "next/link";
import { RenewForm } from "@/features/rentals/RenewForm";
import { SHOP_UNITS } from "@/features/store3d/env/shops";
import { fmtDay, fmtPrice, shopWhere } from "@/features/rentals/format";
import { verifyLeaseToken } from "@/lib/checkout/order-link";
import { getSql, isDbConfigured } from "@/lib/db/client";
import { quoteAll, rentalPlan } from "@/lib/rentals/pricing";
import { getLease, shopLabel, type LeaseRow } from "@/lib/rentals/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your shop rental", robots: { index: false, follow: false } };

const STATUS: Record<LeaseRow["status"], { label: string; tone: string }> = {
  pending_payment: { label: "Waiting for payment", tone: "bg-amber/30 text-ink" },
  active: { label: "Active", tone: "bg-emerald-100 text-emerald-800" },
  payment_review: { label: "Payment received · being checked", tone: "bg-amber/30 text-ink" },
  expired_unpaid: { label: "Not paid · released", tone: "bg-sand text-ink-soft" },
  cancelled: { label: "Cancelled", tone: "bg-sand text-ink-soft" },
  refunded: { label: "Refunded", tone: "bg-sand text-ink-soft" },
};

export default async function LeasePage({ searchParams }: { searchParams: Promise<{ id?: string; t?: string; paid?: string }> }) {
  const { id = "", t, paid } = await searchParams;
  const lease = isDbConfigured() && verifyLeaseToken(id, t) ? await getLease(getSql(), id) : null;

  if (!lease) {
    return (
      <main className="mx-auto max-w-xl px-5 py-24 text-center">
        <h1 className="font-display text-4xl">Rental not found</h1>
        <p className="mt-3 text-ink-soft">This link is not valid. Open the link in your booking confirmation email, or <Link href="/contact" className="underline">contact us</Link>.</p>
      </main>
    );
  }

  const now = new Date();
  const shop = shopLabel(lease.shop_id);
  const st = STATUS[lease.status];
  const running = lease.status === "active" && !!lease.ends_at && lease.ends_at > now;
  const upcoming = running && !!lease.starts_at && lease.starts_at > now;
  const waiting = lease.status === "pending_payment" && !!paid;
  const daysLeft = running && lease.ends_at ? Math.max(0, Math.ceil((lease.ends_at.getTime() - Math.max(now.getTime(), lease.starts_at?.getTime() ?? 0)) / 86_400_000)) : 0;

  return (
    <main className="w-full">
      {waiting && <meta httpEquiv="refresh" content="4" />}
      <section className="bg-brand-deep text-white">
        <div className="mx-auto max-w-4xl px-5 py-14">
          {paid && running && (
            <p className="mb-6 inline-flex items-center gap-2 rounded-full bg-amber px-4 py-1.5 text-sm font-bold text-ink">✓ Payment confirmed. Thank you!</p>
          )}
          {waiting && <p role="status" className="mb-6 inline-flex rounded-full bg-white/15 px-4 py-1.5 text-sm">Confirming your payment… this page refreshes by itself.</p>}
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber">Booking {lease.reference}</p>
          <h1 className="mt-3 font-display text-5xl leading-none sm:text-6xl">{shop} · {lease.brand_name}</h1>
          <p className="mt-4 text-white/75">
            {running
              ? upcoming
                ? `Starts on ${fmtDay(lease.starts_at)} and runs until ${fmtDay(lease.ends_at)}.`
                : `Your shop is yours until ${fmtDay(lease.ends_at)} · ${daysLeft} day${daysLeft === 1 ? "" : "s"} left.`
              : lease.status === "payment_review"
                ? "We received your payment and are checking your booking. We'll email you shortly."
                : lease.status === "pending_payment"
                  ? "This booking is waiting for payment."
                  : "This booking is no longer active."}
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-4xl px-5 py-12">
        <section className="grid gap-6 md:grid-cols-2">
          <div className="rounded-3xl bg-white p-7 ring-1 ring-line">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-2xl">Your rental</h2>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${st.tone}`}>{st.label}</span>
            </div>
            <dl className="mt-5 space-y-3 text-sm">
              {[
                ["Shop", (() => { const u = SHOP_UNITS.find((x) => x.id === lease.shop_id); return u ? `${shop} · ${shopWhere(u)}` : shop; })()],
                ["Plan", `${rentalPlan(lease.plan).name} · ${lease.months} month${lease.months > 1 ? "s" : ""}`],
                ["Paid", `${fmtPrice(lease.amount, lease.currency)}${lease.promo_name ? ` · ${lease.promo_name}` : ""}`],
                ["From", fmtDay(lease.starts_at)],
                ["Until", fmtDay(lease.ends_at)],
                ...(lease.refunded_amount > 0 ? [["Refunded", fmtPrice(lease.refunded_amount, lease.currency)]] : []),
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 border-t border-line pt-3 first:border-0 first:pt-0">
                  <dt className="text-ink-soft">{k}</dt>
                  <dd className="text-right font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="rounded-3xl bg-white p-7 ring-1 ring-line">
            <h2 className="font-display text-2xl">Your shop sign</h2>
            <div className="mt-5 rounded-2xl bg-ink px-5 py-6 text-center">
              <p className="font-display text-3xl font-extrabold tracking-wide text-amber">{lease.display_approved && lease.display_name ? lease.display_name.toUpperCase() : "OPENING SOON"}</p>
              <p className="mt-1 text-[11px] uppercase tracking-[0.3em] text-white/70">{shop}</p>
            </div>
            <p className="mt-4 text-sm text-ink-soft">
              {lease.display_approved
                ? "Your brand name is live on your shop's sign in the 3D store."
                : "We check every brand before it goes on the sign, usually within 2 business days. Reply to your confirmation email with your logo, colours and products."}
            </p>
            <Link href="/store" className="mt-4 inline-block text-sm font-semibold underline">Visit the 3D store →</Link>
          </div>
        </section>

        {running && (
          <section className="mt-16">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="font-display text-4xl">Extend your rental</h2>
              <p className="mt-2 text-ink-soft">The new term starts on {fmtDay(lease.ends_at)}, right after your current one, so you lose no days.</p>
            </div>
            <div className="mt-8">
              <RenewForm leaseId={lease.id} token={t!} currency={lease.currency} quotes={quoteAll(lease.currency, now)} />
            </div>
          </section>
        )}

        <p className="mt-14 text-center text-sm text-ink-soft">
          Questions about your shop? <Link href="/contact" className="font-semibold underline">Contact us</Link> with booking {lease.reference}.
        </p>
      </div>
    </main>
  );
}
