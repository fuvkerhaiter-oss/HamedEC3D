import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { verifyOrderToken } from "@/lib/checkout/order-link";
import { getCustomerOrder, STATUS_LABEL } from "@/lib/checkout/order-view";
import { getSql, isDbConfigured } from "@/lib/db/client";
import { MARKETS } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import { OrderAutoRefresh } from "@/features/checkout/OrderAutoRefresh";
import { getEmailProvider } from "@/lib/email/provider";
import { loadWithdrawalContext } from "@/lib/orders/withdrawal";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your order", robots: { index: false } };

/** Guest-accessible order page: /order?id=<uuid>&t=<signed token> (link from checkout and emails). */
export default async function OrderPage({ searchParams }: { searchParams: Promise<{ id?: string; t?: string; paid?: string }> }) {
  const { id = "", t, paid } = await searchParams;
  if (!isDbConfigured() || !verifyOrderToken(id, t)) notFound();
  const o = await getCustomerOrder(getSql(), id);
  if (!o) notFound();
  const wd = await loadWithdrawalContext(getSql(), id);

  const locale = o.total.currency === "USD" ? MARKETS.US.locale : MARKETS.EU.locale;
  const fmt = (m: typeof o.total) => formatMoney(m, locale);
  const waiting = o.status === "pending_payment";
  const success = !waiting && !["failed", "cancelled"].includes(o.status);

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10">
      <OrderAutoRefresh active={waiting && paid === "1"} clearCart={success || (waiting && paid === "1")} />
      <p className="eyebrow text-ink-soft">Order #{o.orderNumber}</p>
      <h1 className="mt-1 font-display text-4xl">
        {success ? "Thank you for your order!" : waiting ? (paid === "1" ? "Confirming your payment…" : "Waiting for payment") : STATUS_LABEL[o.status]}
      </h1>
      <p className="mt-3 text-ink-soft">
        {success && (getEmailProvider()
          ? <>We&apos;ve emailed a confirmation to <b className="text-ink">{o.email}</b>. Keep this page&apos;s link to follow your order.</>
          : <>Bookmark this page to follow your order. Updates will go to <b className="text-ink">{o.email}</b>.</>)}
        {waiting && paid === "1" && "This usually takes a few seconds. This page updates by itself."}
        {waiting && paid !== "1" && <>This order hasn&apos;t been paid yet. <Link href="/checkout" className="underline">Return to checkout</Link>.</>}
        {o.status === "failed" && "The payment didn't go through and you have not been charged. Please try again or contact us."}
        {o.status === "cancelled" && "This order was cancelled. If you were charged, the refund is on its way."}
      </p>

      <section className="mt-8 rounded-3xl bg-white/70 p-6 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-xl">Status</h2>
          <span className="rounded-full bg-sand px-3 py-1 text-sm font-medium">{STATUS_LABEL[o.status]}</span>
        </div>
        {o.shipments.length > 0 && (
          <ul className="mt-4 space-y-2 text-sm">
            {o.shipments.map((s) => (
              <li key={s.trackingNumber}>
                {s.carrier} · {s.trackingUrl ? <a href={s.trackingUrl} target="_blank" rel="noopener noreferrer" className="underline">{s.trackingNumber}</a> : s.trackingNumber}
                <span className="text-ink-soft"> ({s.status.replaceAll("_", " ")})</span>
                {s.events && s.events.length > 0 && (
                  <ol className="mt-2 space-y-1 border-l border-line pl-3 text-xs text-ink-soft">
                    {s.events.slice(0, 10).map((e, i) => (
                      <li key={i}><time dateTime={e.at}>{new Date(e.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</time> · {e.description}{e.location ? ` — ${e.location}` : ""}</li>
                    ))}
                  </ol>
                )}
              </li>
            ))}
          </ul>
        )}
        {o.deliveryEstimate && !["delivered", "cancelled", "refunded", "failed", "pending_payment"].includes(o.status) && (
          <p className="mt-3 text-sm text-ink-soft">Estimated delivery: {o.deliveryEstimate.minDays}–{o.deliveryEstimate.maxDays} business days after dispatch. This is an estimate, not a guaranteed date.</p>
        )}
        {o.refunds.length > 0 && (
          <ul className="mt-4 space-y-1 border-t border-line pt-3 text-sm">
            {o.refunds.map((r, n) => (
              <li key={n}>Refund {fmt(r.amount)} · <span className="text-ink-soft">{r.status === "pending" ? "in progress" : "completed — it can take 5–10 business days to reach your account"}</span></li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6 rounded-3xl bg-white/70 p-6 shadow-card">
        <h2 className="font-display text-xl">Items</h2>
        <ul className="mt-3 divide-y divide-line text-sm">
          {o.items.map((i, n) => (
            <li key={n} className="flex justify-between gap-3 py-2">
              <span>{i.quantity} × {i.name}{i.variant && i.variant !== "Default" ? ` · ${i.variant}` : ""}</span>
              <span className="tabular-nums">{fmt(i.lineTotal)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-4 space-y-1.5 border-t border-line pt-4 text-sm">
          <div className="flex justify-between"><dt>Subtotal</dt><dd>{fmt(o.subtotal)}</dd></div>
          {o.discount.amount > 0 && <div className="flex justify-between"><dt>Discount</dt><dd>−{fmt(o.discount)}</dd></div>}
          <div className="flex justify-between"><dt>Shipping{o.shippingMethod ? ` (${o.shippingMethod})` : ""}</dt><dd>{o.shipping.amount === 0 ? "Free" : fmt(o.shipping)}</dd></div>
          <div className="flex justify-between text-ink-soft"><dt>{o.taxMode === "inclusive" ? "Incl. VAT" : "Sales tax"}{o.taxRateBps != null ? ` (${(o.taxRateBps / 100).toLocaleString(locale)} %)` : ""}</dt><dd>{fmt(o.tax)}</dd></div>
          <div className="flex justify-between pt-2 text-base font-semibold"><dt>Total</dt><dd>{fmt(o.total)}</dd></div>
        </dl>
      </section>

      <section className="mt-6 rounded-3xl bg-white/70 p-6 text-sm shadow-card">
        <h2 className="font-display text-xl">Delivery to</h2>
        <address className="mt-3 not-italic leading-relaxed">
          {o.shipTo.fullName}<br />{o.shipTo.line1}{o.shipTo.line2 ? <><br />{o.shipTo.line2}</> : null}<br />
          {o.shipTo.postalCode} {o.shipTo.city}{o.shipTo.region ? `, ${o.shipTo.region}` : ""}<br />{o.shipTo.country}
        </address>
      </section>

      {wd && (wd.requests.length > 0 || !wd.block) && (
        <section className="mt-6 rounded-3xl bg-white/70 p-6 text-sm shadow-card">
          <h2 className="font-display text-xl">Changed your mind?</h2>
          {wd.requests.length > 0 && (
            <p className="mt-2">We received your withdrawal on {new Date(wd.requests[0]!.submittedAt).toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" })}{wd.requests[0]!.status === "received" ? " and will email you the next steps." : "."}</p>
          )}
          {!wd.block && (
            <>
              <p className="mt-2 text-ink-soft">EU orders can be withdrawn within 14 days of delivery, without giving a reason{wd.window.deadline ? ` (until ${wd.window.deadline.toLocaleDateString("en-GB", { dateStyle: "long" })})` : ""}.</p>
              <Link href={`/withdraw?id=${o.id}&t=${encodeURIComponent(t ?? "")}`} className="mt-4 inline-block rounded-full bg-ink px-5 py-2.5 font-semibold text-cream">Withdraw from contract</Link>
            </>
          )}
        </section>
      )}

      <p className="mt-8 text-center text-sm text-ink-soft">
        Questions? <Link href="/contact" className="underline">Contact us</Link> with your order number #{o.orderNumber}.
      </p>
    </main>
  );
}
