import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import brandLogo from "@/assets/hero/wego-shiiip-logo.webp";
import { AccountAuthEntry } from "@/features/auth/AccountAuthEntry";
import { SellerNav } from "@/features/seller/SellerNav";
import { shopLabel } from "@/lib/rentals/service";
import { getSellerContext } from "@/lib/tenants/access";
import { currentLease } from "@/lib/tenants/service";

export const metadata: Metadata = {
  title: { default: "Shop dashboard", template: "%s · Shop dashboard · WEGO SHIIIP" },
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

function Gate({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-cream px-5 py-12">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-card ring-1 ring-line">
        <Link href="/" className="inline-block" aria-label="WEGO SHIIIP home">
          <Image src={brandLogo} alt="" className="mx-auto h-14 w-auto" priority />
        </Link>
        <p className="mt-4 text-xs font-bold uppercase tracking-[0.16em] text-brand-light">Shop dashboard</p>
        <h1 className="mt-1 font-display text-3xl font-extrabold tracking-tight">{title}</h1>
        <div className="mt-4 text-sm text-ink-soft">{children}</div>
      </div>
    </main>
  );
}

export default async function SellerLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getSellerContext();
  if (ctx.kind === "signed-out") {
    return (
      <Gate title="Sign in to your shop">
        <p className="mb-6">Use the same email you rented your shop with. We&apos;ll send you a one-time code: no password needed.</p>
        <AccountAuthEntry next="/seller" />
      </Gate>
    );
  }
  if (ctx.kind === "no-db") {
    return (
      <Gate title="Dashboard unavailable">
        <p>The shop dashboard needs the database, which isn&apos;t configured on this server.</p>
      </Gate>
    );
  }
  if (ctx.kind === "no-shop") {
    return (
      <Gate title="No shop on this account yet">
        <p>
          You&apos;re signed in{ctx.email ? <> as <b className="text-ink">{ctx.email}</b></> : null}, but we couldn&apos;t find a shop rental for this email.
        </p>
        <p className="mt-2">Rented with a different email? Sign out and sign in with that one.</p>
        <div className="mt-6 flex flex-col gap-2">
          <Link href="/rent-a-shop" className="btn-yellow py-3">Rent a shop</Link>
          <form action="/auth/signout" method="post">
            <button type="submit" className="w-full rounded-full py-3 text-sm font-semibold ring-1 ring-line hover:bg-sand">Sign out</button>
          </form>
        </div>
      </Gate>
    );
  }
  const lease = currentLease(ctx.leases);
  const open = !!lease && ctx.tenant.storefront_open && !ctx.tenant.suspended;
  return (
    <div className="flex min-h-dvh flex-col bg-cream lg:flex-row">
      <SellerNav brand={ctx.tenant.brand_name} shopLabel={lease ? shopLabel(lease.shop_id) : null} open={open} />
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 sm:py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
