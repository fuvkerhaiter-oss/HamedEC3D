import { UserRound, PackageSearch, ShoppingCart } from "lucide-react";
import { IconTile } from "@/components/IconTile";
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

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ auth_error?: string }>;
}) {
  const [{ auth_error: authError }, user] = await Promise.all([searchParams, getAuthUser()]);

  if (!user) {
    return (
      <main className="mx-auto w-full max-w-4xl px-5 py-12">
        {authError && (
          <div
            role="alert"
            className="mx-auto mb-8 max-w-2xl rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-left text-sm text-red-800"
          >
            <p className="font-bold">We couldn&apos;t finish signing you in</p>
            <p className="mt-1 break-words">{authError}</p>
            <p className="mt-2 text-xs text-red-700/80">
              Please try again below. If it keeps happening, contact support with this message.
            </p>
          </div>
        )}
        <div className="text-center">
          <p className="eyebrow text-brand">Account</p>
          <h1 className="mt-3 font-display text-4xl sm:text-5xl">Your account</h1>
          <p className="mx-auto mt-3 max-w-md text-base text-ink-soft">
            Sign in to see your orders, saved addresses and rented shop on any device. You can always shop as a guest.
          </p>
        </div>

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          {/* Sign In / Create Account Card */}
          <div className="flex flex-col justify-between rounded-2xl bg-white p-7 ring-1 ring-line">
            <div>
              <IconTile icon={UserRound} />
              <h2 className="mt-4 font-display text-xl">Sign in or create an account</h2>
              <p className="mt-2 text-sm text-ink-soft leading-relaxed">
                No password to remember: we email you a one-time code, or you can continue with Google.
              </p>
            </div>
            <div className="mt-6">
              <AccountAuthEntry />
            </div>
          </div>

          {/* Guest Order Lookup Card */}
          <div className="flex flex-col justify-between rounded-2xl bg-white p-7 ring-1 ring-line">
            <div>
              <IconTile icon={PackageSearch} />
              <h2 className="mt-4 font-display text-xl">Find a guest order</h2>
              <p className="mt-2 text-sm text-ink-soft leading-relaxed">
                Enter the email you used at checkout and we&apos;ll send you a private link to your orders.
              </p>
            </div>
            <div className="mt-6">
              <OrderHistoryRequestForm />
            </div>
          </div>
        </div>

        <div className="mt-10 text-center">
          <p className="text-sm text-ink-soft">
            Just browsing?{" "}
            <Link href="/catalog" className="font-semibold text-ink underline underline-offset-4 hover:text-brand">
              Browse the catalog
            </Link>{" "}
            or{" "}
            <Link href="/store" className="font-semibold text-ink underline underline-offset-4 hover:text-brand">
              visit the 3D store
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
          <p className="eyebrow text-brand">Account</p>
          <h1 className="mt-2 font-display text-3xl text-ink sm:text-4xl">
            Welcome back, {displayName}
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            Signed in as <span className="font-medium text-ink">{user.email}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/catalog"
            className="rounded-full border border-line bg-white px-5 py-2.5 text-sm font-semibold transition hover:bg-sand"
          >
            Continue shopping
          </Link>
          <form action="/auth/signout" method="POST">
            <button
              type="submit"
              className="rounded-full px-4 py-2.5 text-sm font-semibold text-ink-soft transition hover:bg-sand hover:text-ink"
            >
              Sign out
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
          Addresses ({addresses.length})
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
            <h2 className="font-display text-xl text-ink">Recent orders</h2>
            {orders.length > 0 && (
              <Link href="/account/orders" className="text-sm font-semibold text-ink underline underline-offset-4 hover:text-brand">
                View all ({orders.length})
              </Link>
            )}
          </div>

          {orders.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line bg-white p-10 text-center">
              <IconTile icon={ShoppingCart} size="lg" />
              <p className="mt-4 font-display text-lg">No orders yet</p>
              <p className="mt-1 text-sm text-ink-soft">
                When you place an order, it will appear here with its status and tracking.
              </p>
              <Link href="/store" className="btn-yellow mt-5 px-5 py-2.5 text-sm">
                Visit the 3D store
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {recentOrders.map((o) => (
                <Link
                  key={o.id}
                  href={`/order?id=${o.id}&t=${o.token}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-5 ring-1 ring-line transition hover:ring-ink/25"
                >
                  <div>
                    <span className="font-semibold">Order #{o.orderNumber}</span>
                    <span className="block text-xs text-ink-soft mt-0.5">
                      {new Date(o.createdAt).toLocaleDateString(o.total.currency === "USD" ? MARKETS.US.locale : MARKETS.EU.locale)} · {o.itemCount} item(s){o.trackingCount ? " · tracking active" : ""}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="block font-semibold tabular-nums">
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
          <section className="rounded-2xl bg-white p-6 ring-1 ring-line">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Delivery address</h2>
              <Link href="/account/addresses" className="text-xs font-semibold text-ink underline underline-offset-4 hover:text-brand">
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
                <p>No address saved yet. Save one to check out faster.</p>
                <Link
                  href="/account/addresses"
                  className="mt-3 inline-block rounded-full bg-sand px-4 py-2 text-xs font-semibold text-ink transition hover:bg-line"
                >
                  Add an address
                </Link>
              </div>
            )}
          </section>

          {/* Quick Account Info */}
          <section className="rounded-2xl bg-white p-6 ring-1 ring-line">
            <h2 className="font-semibold">Profile</h2>
            <dl className="mt-4 space-y-2 text-sm">
              <div>
                <dt className="text-xs text-ink-soft">Email address</dt>
                <dd className="text-ink font-medium break-all">{user.email}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-soft">Name</dt>
                <dd className="text-ink font-medium">{displayName}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-soft">Customer since</dt>
                <dd className="text-ink font-medium">
                  {new Date(user.created_at).toLocaleDateString()}
                </dd>
              </div>
            </dl>
            <div className="mt-5 pt-4 border-t border-line flex justify-between items-center text-xs">
              <Link href="/account/security" className="text-ink-soft underline hover:text-ink">
                Security settings
              </Link>
                          </div>
          </section>
        </div>
      </div>
    </main>
  );
}
