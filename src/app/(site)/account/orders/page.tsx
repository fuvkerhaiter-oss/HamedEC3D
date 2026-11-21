import type { Metadata } from "next";
import Link from "next/link";
import { listCustomerOrders, verifyHistoryToken } from "@/lib/checkout/order-history";
import { STATUS_LABEL } from "@/lib/checkout/order-view";
import { getSql, isDbConfigured } from "@/lib/db/client";
import { MARKETS } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import { OrderHistoryRequestForm } from "@/features/support/SupportForms";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your orders", robots: { index: false } };

/** /account/orders?t=<signed, expiring token from the email> — every order of that email address. */
export default async function AccountOrdersPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  const email = isDbConfigured() ? verifyHistoryToken(t) : null;
  const orders = email ? await listCustomerOrders(getSql(), email) : [];

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10">
      <p className="eyebrow text-ink-soft">Your account</p>
      <h1 className="mt-1 font-display text-4xl">Your orders</h1>
      {!email ? (
        <section className="mt-8 rounded-3xl bg-white/70 p-6 shadow-card">
          <p className="text-ink-soft">
            {t ? "This link has expired or is not valid. Ask for a new one below." : "Enter the email you ordered with. We'll email you a private link to all your orders, their tracking and refund status."}
          </p>
          <div className="mt-5"><OrderHistoryRequestForm /></div>
        </section>
      ) : (
        <>
          <p className="mt-3 text-ink-soft">Orders placed with <b className="text-ink">{email}</b>. This private link expires after a day.</p>
          {orders.length === 0 ? (
            <p className="mt-8 rounded-3xl bg-white/70 p-6 shadow-card">No orders yet. <Link href="/store" className="underline">Visit the store</Link>.</p>
          ) : (
            <ul className="mt-8 space-y-3">
              {orders.map((o) => (
                <li key={o.id}>
                  <Link href={`/order?id=${o.id}&t=${o.token}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/70 p-5 shadow-card transition hover:bg-white">
                    <span>
                      <span className="font-display text-lg">Order #{o.orderNumber}</span>
                      <span className="block text-sm text-ink-soft">
                        {new Date(o.createdAt).toLocaleDateString(o.total.currency === "USD" ? MARKETS.US.locale : MARKETS.EU.locale)} · {o.itemCount} item(s){o.trackingCount ? " · tracking available" : ""}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="block font-medium tabular-nums">{formatMoney(o.total, o.total.currency === "USD" ? MARKETS.US.locale : MARKETS.EU.locale)}</span>
                      <span className="mt-1 inline-block rounded-full bg-sand px-3 py-0.5 text-xs font-medium">{STATUS_LABEL[o.status]}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <p className="mt-8 text-center text-sm text-ink-soft">Questions? <Link href="/contact" className="underline">Contact us</Link>.</p>
    </main>
  );
}
