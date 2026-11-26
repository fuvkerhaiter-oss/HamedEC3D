import Link from "next/link";
import { Badge, Card, EmptyState, fmtDate, fmtMoney, PageHeader, Stat, Table } from "@/features/admin/ui";
import { requirePage } from "@/lib/admin/guard";
import { getSql } from "@/lib/db/client";
import { shopLabel } from "@/lib/rentals/service";
import { listTenants, mediaUrl } from "@/lib/tenants/service";

export const metadata = { title: "Shop tenants" };
export const dynamic = "force-dynamic";

export default async function TenantsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requirePage("orders.view");
  const { q = "" } = await searchParams;
  const tenants = await listTenants(getSql(), q);
  const now = new Date();
  const live = tenants.filter((t) => t.shop_id && t.lease_until && t.lease_until > now);
  const open = live.filter((t) => t.storefront_open && !t.suspended);
  const fees = new Map<string, number>();
  for (const t of live) if (t.monthly_fee > 0 && t.currency) fees.set(t.currency, (fees.get(t.currency) ?? 0) + t.monthly_fee);
  const views = tenants.reduce((s, t) => s + t.views30, 0);
  const clicks = tenants.reduce((s, t) => s + t.clicks30, 0);
  const attention = tenants.filter((t) => t.sign_pending || t.suspended).length;

  return (
    <>
      <PageHeader
        title="Shop tenants"
        description={<>Brands renting a shop manage it themselves from their <b>shop dashboard</b> (<code>/seller</code>, signed in with the email they rented with): brand, sign name, products, payment links and rent. Shoppers pay tenants directly on the tenant&apos;s own payment links; you charge the rent plus an optional monthly fee per tenant.</>}
        actions={<Link href="/admin/rentals" className="btn-ghost">Shop rentals →</Link>}
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Tenants renting now" value={`${live.length}`} hint={`${open.length} open to shoppers`} />
        <Stat label="Monthly fees (renting now)" value={fees.size ? [...fees].map(([c, a]) => fmtMoney(a, c)).join(" · ") : "—"} hint="Added to their rent at each renewal" />
        <Stat label="Product views · 30 days" value={views} hint={`${clicks} Buy clicks to tenants' payment pages`} />
        <Stat label="Need you" value={attention} tone={attention ? "warn" : "default"} hint="Sign names to approve, paused shops" href="/admin/rentals?status=current" />
      </div>

      <Card className="mt-6" title="All tenants" actions={
        <form className="flex gap-2">
          <input name="q" defaultValue={q} placeholder="Brand or email" className="admin-input w-56" aria-label="Search tenants" />
          <button className="btn-ghost">Search</button>
        </form>
      } pad={false}>
        {tenants.length === 0 ? (
          <div className="p-5">
            <EmptyState title={q ? "No tenant matches" : "No tenants yet"}>A tenant account is created the first time a renter signs in to their shop dashboard.</EmptyState>
          </div>
        ) : (
          <Table head={["Brand", "Shop", "Status", "Products", "Views / clicks · 30 d", "Monthly fee", ""]}>
            {tenants.map((t) => {
              const logo = mediaUrl(t.logo_bucket, t.logo_path);
              const renting = !!t.lease_until && t.lease_until > now;
              return (
                <tr key={t.id}>
                  <td>
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg ring-1 ring-line" style={{ background: t.accent_color }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {logo ? <img src={logo} alt="" className="h-full w-full object-cover" /> : <b className="text-xs text-ink">{t.brand_name.slice(0, 2).toUpperCase()}</b>}
                      </span>
                      <div className="min-w-0">
                        <Link href={`/admin/rentals/tenants/${t.id}`} className="font-semibold hover:underline">{t.brand_name}</Link>
                        <p className="truncate text-xs text-ink-soft">{t.email ?? t.contact_email ?? "—"}</p>
                      </div>
                    </div>
                  </td>
                  <td>{t.shop_id ? <>{shopLabel(t.shop_id)}<span className="block text-xs text-ink-soft">{renting ? `until ${fmtDate(t.lease_until, false)}` : "not running"}</span></> : "—"}</td>
                  <td className="space-x-1">
                    {t.suspended ? <Badge tone="red">Paused</Badge> : renting && t.storefront_open ? <Badge tone="green">Open</Badge> : <Badge>Closed</Badge>}
                    {t.sign_pending && <Badge tone="amber">Sign to approve</Badge>}
                  </td>
                  <td className="tabular-nums">{t.published} on show{t.products > t.published ? <span className="text-xs text-ink-soft"> · {t.products} total</span> : null}{t.hidden ? <span className="block text-xs text-red-700">{t.hidden} hidden by you</span> : null}</td>
                  <td className="tabular-nums">{t.views30} / {t.clicks30}</td>
                  <td>{t.monthly_fee ? fmtMoney(t.monthly_fee, t.currency ?? "EUR") : <span className="text-ink-soft">none</span>}</td>
                  <td className="text-right"><Link href={`/admin/rentals/tenants/${t.id}`} className="btn-ghost">Open</Link></td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </>
  );
}
