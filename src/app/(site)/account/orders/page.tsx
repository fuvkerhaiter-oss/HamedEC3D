import type { Metadata } from "next";
import Link from "next/link";
import { getAuthUser } from "@/lib/supabase/server";
import { listCustomerOrders, verifyHistoryToken } from "@/lib/checkout/order-history";
import { STATUS_LABEL } from "@/lib/checkout/order-view";
import { getSql, isDbConfigured } from "@/lib/db/client";
import { MARKETS } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import { OrderHistoryRequestForm } from "@/features/support/SupportForms";
import { AccountAuthEntry } from "@/features/auth/AccountAuthEntry";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your orders", robots: { index: false } };

/**
 * /account/orders
 * Supports both:
 * 1. Logged-in Supabase session (instant full order history)
 * 2. Token-based email magic link (?t=...) for guests without an account.
 */
export default async function AccountOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const { t } = await searchParams;
  const authUser = await getAuthUser();

  // If logged in, use their verified email; otherwise verify the URL token
  const email = authUser?.email ?? (isDbConfigured() ? verifyHistoryToken(t) : null);
  const orders = email && isDbConfigured() ? await listCustomerOrders(getSql(), email) : [];

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-10">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <p className="eyebrow text-ink-soft">Your account</p>
          <h1 className="mt-1 font-display text-4xl font-extrabold text-ink">Your orders</h1>
        </div>
        {authUser && (
          <Link
            href="/account"
            className="text-sm font-semibold text-ink underline decoration-amber decoration-2 underline-offset-4 hover:text-amber"
          >
            ← Back to Account Overview
          </Link>
        )}
      </div>

      {authUser && (
        <nav className="mt-6 flex gap-2 border-b border-line pb-3 overflow-x-auto text-sm font-medium">
          <Link href="/account" className="rounded-full px-4 py-1.5 text-ink-soft transition hover:bg-sand hover:text-ink">
            Overview
          </Link>
          <Link href="/account/orders" className="rounded-full bg-ink px-4 py-1.5 text-white">
            Orders ({orders.length})
          </Link>
          <Link href="/account/addresses" className="rounded-full px-4 py-1.5 text-ink-soft transition hover:bg-sand hover:text-ink">
            Saved Addresses
          </Link>
          <Link href="/account/security" className="rounded-full px-4 py-1.5 text-ink-soft transition hover:bg-sand hover:text-ink">
            Security & Privacy
          </Link>
        </nav>
      )}

      {!email ? (
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          {/* Sign In option */}
          <section className="rounded-3xl bg-white p-6 shadow-card ring-2 ring-amber/50 flex flex-col justify-between">
            <div>
              <span className="text-3xl">🔑</span>
              <h2 className="mt-2 font-display text-xl font-bold">Have an account?</h2>
              <p className="mt-1 text-sm text-ink-soft">
                Sign in to view your complete order history, track shipments, and request returns instantly.
              </p>
            </div>
            <div className="mt-5">
              <AccountAuthEntry />
            </div>
          </section>

          {/* Guest email lookup */}
          <section className="rounded-3xl bg-white/70 p-6 shadow-card flex flex-col justify-between">
            <div>
              <span className="text-3xl">✉️</span>
              <h2 className="mt-2 font-display text-xl font-bold">Ordered as guest?</h2>
              <p className="mt-1 text-sm text-ink-soft">
                {t
                  ? "This link has expired or is not valid. Request a fresh one below."
                  : "Enter the email you ordered with. We will email you a private link to all your orders, tracking and refund status."}
              </p>
            </div>
            <div className="mt-5">
              <OrderHistoryRequestForm />
            </div>
          </section>
        </div>
      ) : (
        <>
          <p className="mt-4 text-sm text-ink-soft">
            Orders placed with <b className="text-ink font-mono">{email}</b>
            {!authUser && " · This guest link is valid for 24 hours."}
          </p>

          {orders.length === 0 ? (
            <div className="mt-8 rounded-3xl bg-white/70 p-10 text-center shadow-card">
              <span className="text-4xl">📦</span>
              <p className="mt-3 font-display text-xl font-bold">No orders found</p>
              <p className="mt-1 text-sm text-ink-soft">
                No purchases yet for this address. Hungry for snacks or gadgets?
              </p>
              <div className="mt-6 flex justify-center gap-3">
                <Link href="/catalog" className="rounded-full bg-ink px-6 py-2.5 font-medium text-cream">
                  Browse Catalog
                </Link>
                <Link href="/store" className="rounded-full border border-ink px-6 py-2.5 font-medium hover:bg-sand">
                  Enter 3D Store
                </Link>
              </div>
            </div>
          ) : (
            <ul className="mt-6 space-y-3">
              {orders.map((o) => (
                <li key={o.id}>
                  <Link
                    href={`/order?id=${o.id}&t=${o.token}`}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/90 p-5 shadow-card ring-1 ring-line transition hover:-translate-y-0.5 hover:ring-amber hover:bg-white"
                  >
                    <span>
                      <span className="font-display text-lg font-bold">Order #{o.orderNumber}</span>
                      <span className="block text-xs font-mono text-ink-soft mt-0.5">
                        {new Date(o.createdAt).toLocaleDateString(o.total.currency === "USD" ? MARKETS.US.locale : MARKETS.EU.locale)} · {o.itemCount} item(s)
                        {o.trackingCount ? " · 🚚 Tracking available" : ""}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="block font-medium font-mono tabular-nums text-base">
                        {formatMoney(o.total, o.total.currency === "USD" ? MARKETS.US.locale : MARKETS.EU.locale)}
                      </span>
                      <span className="mt-1 inline-block rounded-full bg-amber/20 px-3 py-0.5 text-xs font-semibold text-ink">
                        {STATUS_LABEL[o.status]}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <p className="mt-10 text-center text-xs text-ink-soft">
        Questions about an order? <Link href="/contact" className="underline hover:text-ink">Contact customer support</Link>.
      </p>
    </main>
  );
}
