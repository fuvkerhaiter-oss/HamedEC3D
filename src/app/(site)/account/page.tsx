import type { Metadata } from "next";
import Link from "next/link";
import { getAuthUser, getCustomerProfile } from "@/lib/supabase/server";
import { listCustomerOrders } from "@/lib/checkout/order-history";
import { listCustomerAddresses } from "@/lib/account/addresses";
import { getSql, isDbConfigured } from "@/lib/db/client";
import { STATUS_LABEL } from "@/lib/checkout/order-view";
import { MARKETS } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import { OrderHistoryRequestForm } from "@/features/support/SupportForms";
import { AccountAuthEntry } from "@/features/auth/AccountAuthEntry";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Account Overview",
  robots: { index: false },
};

export default async function AccountPage() {
  const user = await getAuthUser();

  if (!user) {
    return (
      <main className="mx-auto w-full max-w-4xl px-5 py-12">
        <div className="text-center">
          <span className="inline-block rounded-full bg-amber/20 px-3.5 py-1 text-xs font-bold uppercase tracking-wider text-ink">
            Shopping Identity
          </span>
          <h1 className="mt-3 font-display text-4xl sm:text-5xl font-extrabold tracking-tight">
            Who are you today?
          </h1>
          <p className="mx-auto mt-3 max-w-md text-base text-ink-soft">
            Explore with zero commitment as a guest, or sign in to save your trolley, addresses, and order history across devices.
          </p>
        </div>

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          {/* Sign In / Create Account Card */}
          <div className="rounded-3xl bg-white p-7 shadow-card ring-2 ring-amber/50 flex flex-col justify-between">
            <div>
              <span className="text-3xl">🛒✨</span>
              <h2 className="mt-3 font-display text-2xl font-bold">Sign In or Create Account</h2>
              <p className="mt-2 text-sm text-ink-soft leading-relaxed">
                Unlock your VIP shopping pass. One tiny verification code, zero passwords to forget, or one-click with Google.
              </p>
            </div>
            <div className="mt-6">
              <AccountAuthEntry />
            </div>
          </div>

          {/* Guest Order Lookup Card */}
          <div className="rounded-3xl bg-white/70 p-7 shadow-card flex flex-col justify-between">
            <div>
              <span className="text-3xl">📦🔍</span>
              <h2 className="mt-3 font-display text-2xl font-bold">Looking for guest orders?</h2>
              <p className="mt-2 text-sm text-ink-soft leading-relaxed">
                Placed an order as a guest? Enter the email you ordered with. We will email you a private, secure link to all your orders.
              </p>
            </div>
            <div className="mt-6">
              <OrderHistoryRequestForm />
            </div>
          </div>
        </div>

        <div className="mt-10 text-center">
          <p className="text-sm text-ink-soft">
            Just passing through?{" "}
            <Link href="/catalog" className="font-semibold text-ink underline decoration-amber decoration-2 underline-offset-4 hover:text-amber">
              Browse the catalog as a guest
            </Link>{" "}
            or{" "}
            <Link href="/store" className="font-semibold text-ink underline decoration-amber decoration-2 underline-offset-4 hover:text-amber">
              walk the 3D supermarket
            </Link>.
          </p>
        </div>
      </main>
    );
  }

  // Authenticated customer
  const [profile, orders, addresses] = await Promise.all([
    getCustomerProfile(user.id),
    user.email && isDbConfigured() ? listCustomerOrders(getSql(), user.email) : Promise.resolve([]),
    isDbConfigured() ? listCustomerAddresses(user.id) : Promise.resolve([]),
  ]);

  const displayName = profile?.fullName || user.user_metadata?.full_name || user.email?.split("@")[0] || "Shopper";
  const defaultAddress = addresses.find((a) => a.isDefault) || addresses[0];
  const recentOrders = orders.slice(0, 3);

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-12">
      {/* Top Welcome Header */}
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-8 border-b border-line">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-block rounded-full bg-amber px-3 py-0.5 text-xs font-bold uppercase tracking-wider text-ink">
              VIP Customer
            </span>
            <span className="text-xs text-ink-soft font-mono">Trolley Pilot Tier 1</span>
          </div>
          <h1 className="mt-2 font-display text-4xl font-extrabold text-ink tracking-tight">
            Welcome back, {displayName}!
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            Logged in as <b className="text-ink font-mono">{user.email}</b>. Your cart and orders are safe with us.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/catalog"
            className="rounded-full border border-line bg-white px-5 py-2.5 text-sm font-semibold transition hover:bg-sand"
          >
            Start Shopping
          </Link>
          <form action="/auth/signout" method="POST">
            <button
              type="submit"
              className="rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-cream transition hover:bg-ink/80"
            >
              Sign Out
            </button>
          </form>
        </div>
      </header>

      {/* Navigation Tabs */}
      <nav className="mt-6 flex gap-2 border-b border-line pb-3 overflow-x-auto text-sm font-medium">
        <Link href="/account" className="rounded-full bg-ink px-4 py-1.5 text-white">
          Overview
        </Link>
        <Link href="/account/orders" className="rounded-full px-4 py-1.5 text-ink-soft transition hover:bg-sand hover:text-ink">
          Orders ({orders.length})
        </Link>
        <Link href="/account/addresses" className="rounded-full px-4 py-1.5 text-ink-soft transition hover:bg-sand hover:text-ink">
          Saved Addresses ({addresses.length})
        </Link>
        <Link href="/account/security" className="rounded-full px-4 py-1.5 text-ink-soft transition hover:bg-sand hover:text-ink">
          Security & Privacy
        </Link>
      </nav>

      {/* Main Grid */}
      <div className="mt-8 grid gap-8 lg:grid-cols-[1.5fr_1fr]">
        {/* Recent Orders */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-2xl font-bold text-ink">Recent Orders</h2>
            {orders.length > 0 && (
              <Link href="/account/orders" className="text-sm font-semibold text-ink underline decoration-amber decoration-2 underline-offset-4 hover:text-amber">
                View all ({orders.length}) →
              </Link>
            )}
          </div>

          {orders.length === 0 ? (
            <div className="rounded-3xl bg-white/70 p-8 text-center shadow-card">
              <span className="text-4xl">🛒</span>
              <p className="mt-3 font-display text-lg font-bold">No orders yet</p>
              <p className="mt-1 text-sm text-ink-soft">
                Your trolley is eager to make some questionable but excellent decisions.
              </p>
              <Link
                href="/store"
                className="mt-5 inline-block rounded-full bg-amber px-6 py-2.5 font-bold text-ink shadow-[0_3px_0_var(--color-ink)] transition hover:-translate-y-0.5"
              >
                Enter the 3D Supermarket
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {recentOrders.map((o) => (
                <Link
                  key={o.id}
                  href={`/order?id=${o.id}&t=${o.token}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-5 shadow-card ring-1 ring-line transition hover:-translate-y-0.5 hover:ring-amber"
                >
                  <div>
                    <span className="font-display text-lg font-bold">Order #{o.orderNumber}</span>
                    <span className="block text-xs text-ink-soft font-mono mt-0.5">
                      {new Date(o.createdAt).toLocaleDateString(o.total.currency === "USD" ? MARKETS.US.locale : MARKETS.EU.locale)} · {o.itemCount} item(s){o.trackingCount ? " · tracking active" : ""}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="block font-medium tabular-nums font-mono">
                      {formatMoney(o.total, o.total.currency === "USD" ? MARKETS.US.locale : MARKETS.EU.locale)}
                    </span>
                    <span className="mt-1 inline-block rounded-full bg-amber/20 px-2.5 py-0.5 text-xs font-semibold text-ink">
                      {STATUS_LABEL[o.status]}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* Sidebar Cards: Address & Profile summary */}
        <div className="space-y-6">
          {/* Default Address */}
          <section className="rounded-3xl bg-white/80 p-6 shadow-card ring-1 ring-line">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl font-bold">Delivery Address</h2>
              <Link href="/account/addresses" className="text-xs font-semibold text-ink underline decoration-amber decoration-2 underline-offset-4">
                Manage
              </Link>
            </div>
            {defaultAddress ? (
              <div className="mt-4 text-sm leading-relaxed text-ink/80">
                <p className="font-semibold text-ink">{defaultAddress.fullName}</p>
                <p>{defaultAddress.line1}</p>
                {defaultAddress.line2 && <p>{defaultAddress.line2}</p>}
                <p>{defaultAddress.postalCode} {defaultAddress.city}{defaultAddress.region ? `, ${defaultAddress.region}` : ""}</p>
                <p className="font-mono text-xs text-ink-soft">{defaultAddress.country}</p>
              </div>
            ) : (
              <div className="mt-4 text-sm text-ink-soft">
                <p>No address saved yet. Add one for 1-click checkout.</p>
                <Link
                  href="/account/addresses"
                  className="mt-3 inline-block rounded-full bg-sand px-4 py-2 text-xs font-semibold text-ink transition hover:bg-amber/30"
                >
                  + Add Address
                </Link>
              </div>
            )}
          </section>

          {/* Quick Account Info */}
          <section className="rounded-3xl bg-white/80 p-6 shadow-card ring-1 ring-line">
            <h2 className="font-display text-xl font-bold">Shopping Identity</h2>
            <dl className="mt-4 space-y-2 text-sm">
              <div>
                <dt className="text-xs text-ink-soft">Email address</dt>
                <dd className="font-mono text-ink font-medium">{user.email}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-soft">Full Name</dt>
                <dd className="text-ink font-medium">{displayName}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-soft">Customer since</dt>
                <dd className="font-mono text-xs text-ink-soft">
                  {new Date(user.created_at).toLocaleDateString()}
                </dd>
              </div>
            </dl>
            <div className="mt-5 pt-4 border-t border-line flex justify-between items-center text-xs">
              <Link href="/account/security" className="text-ink-soft underline hover:text-ink">
                Security settings
              </Link>
              <span className="font-mono text-ink-soft">WEGO SHIIIP</span>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
