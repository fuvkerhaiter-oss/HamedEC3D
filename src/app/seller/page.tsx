import Link from "next/link";
import { fmtDay } from "@/features/rentals/format";
import { OpenToggle } from "@/features/seller/forms";
import { Callout, Panel, PageTitle, Pill, SignPreview, StatCard } from "@/features/seller/ui";
import { SHOP_UNITS } from "@/features/store3d/env/shops";
import { shopWhere } from "@/features/rentals/format";
import { getSql } from "@/lib/db/client";
import { shopLabel } from "@/lib/rentals/service";
import { requireSeller } from "@/lib/tenants/access";
import { currentLease, listProducts, MAX_PRODUCTS, openBlocker, paidUntil, tenantStats } from "@/lib/tenants/service";

export const metadata = { title: "Overview" };

export default async function SellerOverview() {
  const ctx = await requireSeller();
  if (!ctx) return null;
  const { tenant, leases } = ctx;
  const sql = getSql();
  const [stats, products] = await Promise.all([tenantStats(sql, tenant.id), listProducts(sql, tenant.id)]);
  const now = new Date();
  const lease = currentLease(leases, now);
  const upcoming = !lease ? leases.find((l) => l.status === "active" && l.starts_at && l.starts_at > now) : null;
  const pendingPay = leases.find((l) => l.status === "pending_payment");
  const until = lease ? paidUntil(leases, lease.shop_id) : null;
  const daysLeft = until ? Math.ceil((until.getTime() - now.getTime()) / 86_400_000) : null;
  const unit = lease ? SHOP_UNITS.find((u) => u.id === lease.shop_id) : null;
  const signName = lease?.display_name ?? tenant.brand_name;
  const signApproved = !!lease?.display_approved;
  const isOpen = !!lease && tenant.storefront_open && !tenant.suspended;
  const missingLinks = products.filter((p) => p.status === "published" && !p.payment_url).length;
  const noPhoto = products.filter((p) => p.status === "published" && !p.image_path).length;

  const steps = [
    { done: !!tenant.tagline && !!tenant.logo_path, label: "Add your logo and tagline", href: "/seller/shop" },
    { done: signApproved, label: signName && !signApproved ? "Sign name waiting for approval" : "Choose the name on your sign", href: "/seller/shop" },
    { done: stats.published > 0, label: "Put your first product on the shelves", href: "/seller/products/new" },
    { done: products.length > 0 && missingLinks === 0 && (products.some((p) => p.payment_url) || !!tenant.default_payment_url), label: "Add your payment links", href: "/seller/payments" },
    { done: isOpen, label: "Open your shop to shoppers", href: "#open" },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <>
      <PageTitle
        eyebrow={lease ? `${shopLabel(lease.shop_id)}${unit ? ` · ${shopWhere(unit)}` : ""}` : "Your shop"}
        title={`Hi, ${tenant.brand_name}`}
        description="Run your shop in the 3D store from here: your brand, your products, how you get paid and your rent."
        actions={
          <>
            <Link href="/seller/products/new" className="btn-primary px-5 py-2.5">+ Add product</Link>
            <a href="/store" target="_blank" rel="noopener" className="btn-ghost px-5 py-2.5">Open the 3D store ↗</a>
          </>
        }
      />

      {tenant.suspended && (
        <div className="mb-5">
          <Callout tone="bad" title="Your shop is paused by our team">
            {tenant.suspended_reason ?? "Shoppers can't see your products right now."} Reply to any email from us or use the contact page to sort it out.
          </Callout>
        </div>
      )}
      {!lease && (
        <div className="mb-5">
          <Callout tone="warn" title={upcoming ? "Your rental hasn't started yet" : pendingPay ? "Waiting for your rent payment" : "You don't have a running rental"}>
            {upcoming?.starts_at ? `It starts on ${fmtDay(upcoming.starts_at)}. You can set everything up now.` : pendingPay ? "Once the payment goes through, your shop is yours." : "You can still edit your brand and products. "}
            {!upcoming && !pendingPay && (
              <Link href="/rent-a-shop" className="font-semibold underline">Rent a shop</Link>
            )}
          </Callout>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Shop status" value={isOpen ? "Open" : "Closed"} tone={isOpen ? "good" : "warn"} hint={isOpen ? "Shoppers can walk in" : "Only you can see your setup"} />
        <StatCard label="On the shelves" value={`${stats.published} / ${MAX_PRODUCTS}`} hint={stats.drafts ? `${stats.drafts} draft${stats.drafts === 1 ? "" : "s"}` : "Published products"} href="/seller/products" />
        <StatCard label="Product views · 30 days" value={stats.views30} hint="Shoppers who opened a product" />
        <StatCard label="Buy clicks · 30 days" value={stats.clicks30} hint="Sent to your payment page" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Panel title="Get your shop ready" description={`${doneCount} of ${steps.length} done`}>
            <div className="mb-4 h-2 overflow-hidden rounded-full bg-sand">
              <div className="h-full rounded-full bg-brand-light transition-all" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
            </div>
            <ol className="space-y-2">
              {steps.map((s, i) => (
                <li key={i}>
                  <Link href={s.href} className="flex items-center gap-3 rounded-xl px-3 py-2.5 ring-1 ring-line transition hover:bg-sand/60">
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${s.done ? "bg-brand-light text-white" : "bg-sand text-ink-soft"}`}>{s.done ? "✓" : i + 1}</span>
                    <span className={`text-sm ${s.done ? "text-ink-soft line-through" : "font-semibold"}`}>{s.label}</span>
                    <span className="ml-auto text-ink-soft" aria-hidden>→</span>
                  </Link>
                </li>
              ))}
            </ol>
          </Panel>

          <Panel title="Views and Buy clicks" description="Last 30 days, all products">
            <Spark daily={stats.daily} />
            {stats.top.length > 0 && (
              <table className="mt-5 w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-ink-soft">
                    <th className="pb-2 font-semibold">Top products</th>
                    <th className="pb-2 text-right font-semibold">Views</th>
                    <th className="pb-2 text-right font-semibold">Buy clicks</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.top.map((p) => (
                    <tr key={p.id} className="border-t border-line">
                      <td className="py-2"><Link href={`/seller/products/${p.id}`} className="hover:underline">{p.title}</Link></td>
                      <td className="py-2 text-right tabular-nums">{p.views}</td>
                      <td className="py-2 text-right tabular-nums">{p.clicks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Your shop">
            <div id="open" className="space-y-4">
              <SignPreview name={signName} accent={tenant.accent_color} fontId={tenant.sign_font} pending={!signApproved} />
              <OpenToggle open={tenant.storefront_open && !tenant.suspended} blocker={openBlocker(!!lease, tenant.suspended, stats.published)} />
              {(missingLinks > 0 || noPhoto > 0) && (
                <ul className="space-y-1 text-xs text-ink-soft">
                  {missingLinks > 0 && !tenant.default_payment_url && <li>• {missingLinks} product{missingLinks === 1 ? " has" : "s have"} no payment link: <Link className="underline" href="/seller/payments">add one</Link></li>}
                  {noPhoto > 0 && <li>• {noPhoto} product{noPhoto === 1 ? " has" : "s have"} no photo yet</li>}
                </ul>
              )}
            </div>
          </Panel>
          <Panel title="Rent">
            {lease && until ? (
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-ink-soft">Paid until</span>
                  <b>{fmtDay(until)}</b>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-ink-soft">Days left</span>
                  <Pill tone={daysLeft !== null && daysLeft <= 7 ? "amber" : "green"}>{daysLeft} days</Pill>
                </div>
                <Link href="/seller/billing" className="btn-ghost mt-2 w-full">Extend my rental</Link>
              </div>
            ) : (
              <p className="text-sm text-ink-soft">No running rental. <Link href="/seller/billing" className="underline">See billing</Link></p>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

/** Tiny dual bar chart (views light, clicks dark), no library. */
function Spark({ daily }: { daily: { day: string; views: number; clicks: number }[] }) {
  const max = Math.max(1, ...daily.map((d) => d.views));
  const total = daily.reduce((s, d) => s + d.views + d.clicks, 0);
  if (!total) return <p className="rounded-xl bg-sand/60 px-4 py-6 text-center text-sm text-ink-soft">No visits yet. Open your shop and share it: “Find us in the WEGO SHIIIP 3D store”.</p>;
  return (
    <div>
      <div className="flex h-32 items-end gap-[3px]" role="img" aria-label="Daily views and buy clicks, last 30 days">
        {daily.map((d) => (
          <div key={d.day} className="relative flex-1" title={`${d.day}: ${d.views} views, ${d.clicks} buy clicks`}>
            <div className="w-full rounded-t bg-amber/50" style={{ height: `${(d.views / max) * 128}px` }} />
            <div className="absolute bottom-0 w-full rounded-t bg-brand" style={{ height: `${(d.clicks / max) * 128}px` }} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-ink-soft">
        <span>{daily[0]?.day.slice(5)}</span>
        <span className="flex gap-3">
          <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-amber/60" />Views</span>
          <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-brand" />Buy clicks</span>
        </span>
        <span>{daily.at(-1)?.day.slice(5)}</span>
      </div>
    </div>
  );
}
