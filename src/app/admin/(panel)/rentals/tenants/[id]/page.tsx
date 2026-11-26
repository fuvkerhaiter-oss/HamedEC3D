import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/features/admin/ActionForm";
import { Badge, BarChart, Card, fmtDate, fmtMoney, Field, inputCls, Notice, PageHeader, Stat, Table } from "@/features/admin/ui";
import { requirePage } from "@/lib/admin/guard";
import { getSql } from "@/lib/db/client";
import { toDecimalString } from "@/lib/money";
import { rentalPlan } from "@/lib/rentals/pricing";
import { shopLabel } from "@/lib/rentals/service";
import { linkHost } from "@/lib/tenants/payment-links";
import { currentLease, getTenant, listProducts, mediaUrl, paidUntil, tenantLeases, tenantStats } from "@/lib/tenants/service";
import { DoorStyleEditor } from "@/features/rentals/DoorStyleEditor";
import { doorStyleFrom } from "@/lib/rentals/door-style";
import { tenantDoorAction, tenantFeeAction, tenantNoteAction, tenantProductHideAction, tenantSuspendAction } from "../actions";

export const metadata = { title: "Shop tenant" };
export const dynamic = "force-dynamic";

export default async function TenantPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePage("orders.view");
  const canManage = session.permissions.has("orders.manage");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const sql = getSql();
  const t = await getTenant(sql, id);
  if (!t) notFound();
  const [leases, products, stats] = await Promise.all([tenantLeases(sql, t.user_id), listProducts(sql, t.id), tenantStats(sql, t.id)]);
  const lease = currentLease(leases);
  const until = lease ? paidUntil(leases, lease.shop_id) : null;
  const currency = lease?.currency ?? leases[0]?.currency ?? "EUR";
  const logo = mediaUrl(t.logo_bucket, t.logo_path);
  const paid = leases.filter((l) => l.status === "active" || l.status === "refunded");
  const feesPaid = paid.reduce((s, l) => s + l.fee_amount, 0);
  const rentPaid = paid.reduce((s, l) => s + l.amount - l.refunded_amount, 0);
  const signPending = leases.some((l) => l.status === "active" && l.ends_at && l.ends_at > new Date() && l.display_name && !l.display_approved);

  return (
    <>
      <PageHeader
        eyebrow="Shop tenant"
        title={t.brand_name}
        description={t.tagline ?? undefined}
        actions={<Link href="/admin/rentals/tenants" className="btn-ghost">← All tenants</Link>}
      />
      {t.suspended && <Notice tone="bad" title="Shop paused">{t.suspended_reason}</Notice>}
      {signPending && (
        <div className="mt-3">
          <Notice tone="warn" title="Sign name waiting for approval">
            They asked for a new name on their 3D sign. Approve it in <Link href={`/admin/rentals?q=${encodeURIComponent(leases[0]?.email ?? "")}`} className="underline">Shop rentals</Link>.
          </Notice>
        </div>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Shop" value={lease ? shopLabel(lease.shop_id) : "—"} hint={until ? `Paid until ${fmtDate(until, false)}` : "No running rental"} />
        <Stat label="Status" value={t.suspended ? "Paused" : lease && t.storefront_open ? "Open" : "Closed"} tone={t.suspended ? "bad" : "default"} hint={`${stats.published} products on show · ${stats.drafts} drafts`} />
        <Stat label="Views / Buy clicks · 30 days" value={`${stats.views30} / ${stats.clicks30}`} hint="Buy = sent to their payment page" />
        <Stat label="Paid to you (all time)" value={fmtMoney(rentPaid, currency)} hint={feesPaid ? `incl. ${fmtMoney(feesPaid, currency)} fees` : "Rent, minus refunds"} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card title={`Products (${products.length})`} pad={false}>
            {products.length === 0 ? (
              <p className="p-5 text-sm text-ink-soft">No products yet.</p>
            ) : (
              <Table head={["Product", "Price", "Status", "Pays on", "Views / clicks", ""]}>
                {products.map((p) => {
                  const img = mediaUrl(p.image_bucket, p.image_path);
                  return (
                    <tr key={p.id}>
                      <td>
                        <div className="flex items-center gap-3">
                          <span className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-sand ring-1 ring-line">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {img && <img src={img} alt="" className="h-full w-full object-cover" />}
                          </span>
                          <div className="min-w-0">
                            <p className="font-semibold">{p.title}</p>
                            {p.description && <p className="line-clamp-1 max-w-xs text-xs text-ink-soft">{p.description}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="tabular-nums">{fmtMoney(p.price, p.currency)}</td>
                      <td>{p.hidden_by_admin ? <Badge tone="red">Hidden by you</Badge> : p.status === "published" ? <Badge tone="green">On show</Badge> : <Badge>Draft</Badge>}</td>
                      <td className="text-xs">
                        {(() => {
                          const url = p.payment_url ?? t.default_payment_url;
                          return url ? <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="underline">{linkHost(url)} ↗</a> : <span className="text-ink-soft">no link</span>;
                        })()}
                      </td>
                      <td className="tabular-nums">{p.views} / {p.buy_clicks}</td>
                      <td>
                        {canManage &&
                          (p.hidden_by_admin ? (
                            <ActionForm action={tenantProductHideAction} submitLabel="Show again" variant="ghost" inline>
                              <input type="hidden" name="id" value={p.id} />
                              <input type="hidden" name="tenantId" value={t.id} />
                            </ActionForm>
                          ) : (
                            <ActionForm action={tenantProductHideAction} submitLabel="Hide" variant="danger" inline>
                              <input type="hidden" name="id" value={p.id} />
                              <input type="hidden" name="tenantId" value={t.id} />
                              <input type="hidden" name="hidden" value="true" />
                              <input name="reason" placeholder="Reason (they see it)" className={`${inputCls} w-40`} maxLength={300} required />
                            </ActionForm>
                          ))}
                      </td>
                    </tr>
                  );
                })}
              </Table>
            )}
          </Card>

          <Card title="Traffic · last 30 days">
            <BarChart data={stats.daily.map((d) => ({ key: d.day.slice(5), value: d.views }))} format={(n) => `${n} views`} label="Product views per day" />
          </Card>

          <Card title="Rent payments" pad={false}>
            <Table head={["Reference", "Shop · plan", "Period", "Amount", "Fee", "Status"]}>
              {leases.map((l) => (
                <tr key={l.id}>
                  <td className="font-mono text-xs"><Link href={`/admin/rentals?q=${l.reference}&status=all`} className="hover:underline">{l.reference}</Link></td>
                  <td>{shopLabel(l.shop_id)} · {rentalPlan(l.plan).name}</td>
                  <td className="text-xs">{l.starts_at ? `${fmtDate(l.starts_at, false)} → ${fmtDate(l.ends_at, false)}` : "—"}</td>
                  <td className="tabular-nums">{fmtMoney(l.amount, l.currency)}</td>
                  <td className="tabular-nums">{l.fee_amount ? fmtMoney(l.fee_amount, l.currency) : "—"}</td>
                  <td><Badge tone={l.status === "active" ? "green" : l.status === "pending_payment" || l.status === "payment_review" ? "amber" : "gray"}>{l.status.replace(/_/g, " ")}</Badge></td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Brand">
            <div className="flex items-center gap-3">
              <span className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl ring-1 ring-line" style={{ background: t.accent_color }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {logo ? <img src={logo} alt="" className="h-full w-full object-cover" /> : <b>{t.brand_name.slice(0, 2).toUpperCase()}</b>}
              </span>
              <div className="text-sm">
                <p className="font-semibold">{t.brand_name}</p>
                <p className="text-ink-soft">Sign: {lease?.display_name ?? "—"} {lease && (lease.display_approved ? <Badge tone="green">approved</Badge> : <Badge tone="amber">to approve</Badge>)}</p>
              </div>
            </div>
            <dl className="mt-4 grid grid-cols-[110px_1fr] gap-y-1.5 text-sm">
              <dt className="text-ink-soft">Account email</dt><dd className="break-all">{leases[0]?.email ?? "—"}</dd>
              <dt className="text-ink-soft">Contact</dt><dd className="break-all">{[t.contact_email, t.contact_phone].filter(Boolean).join(" · ") || "—"}</dd>
              <dt className="text-ink-soft">Website</dt><dd className="break-all">{t.website ? <a href={t.website} target="_blank" rel="noopener noreferrer nofollow" className="underline">{t.website}</a> : "—"}</dd>
              <dt className="text-ink-soft">Instagram</dt><dd>{t.instagram ? `@${t.instagram}` : "—"}</dd>
              <dt className="text-ink-soft">Default link</dt><dd className="break-all">{t.default_payment_url ? linkHost(t.default_payment_url) : "—"}</dd>
              <dt className="text-ink-soft">Company</dt><dd>{[leases[0]?.company_name, leases[0]?.vat_id].filter(Boolean).join(" · ") || "—"}</dd>
              <dt className="text-ink-soft">Since</dt><dd>{fmtDate(t.created_at, false)}</dd>
            </dl>
            {t.about && <p className="mt-3 whitespace-pre-line rounded-xl bg-sand/60 p-3 text-sm">{t.about}</p>}
          </Card>

          {canManage && (
            <Card title="Shop door & lighting">
              <p className="mb-3 text-sm text-ink-soft">The tenant can change this too (Brand &amp; shop). Shown on their shop door in the 3D store while their rental runs.</p>
              <DoorStyleEditor action={tenantDoorAction} initial={doorStyleFrom(t)} fields={{ id: t.id }} stacked />
            </Card>
          )}

          {canManage && (
            <Card title="Monthly fee">
              <p className="mb-3 text-sm text-ink-soft">A fixed amount per month on top of rent, added to their next rent payment (× the months they book). It doesn&apos;t change a period that&apos;s already paid.</p>
              <ActionForm action={tenantFeeAction} submitLabel="Save fee">
                <input type="hidden" name="id" value={t.id} />
                <input type="hidden" name="currency" value={currency} />
                <Field label={`Fee per month (${currency})`} hint="0 or empty = no fee">
                  <input name="fee" className={inputCls} inputMode="decimal" defaultValue={t.monthly_fee ? toDecimalString({ amount: t.monthly_fee, currency }) : ""} placeholder="0.00" />
                </Field>
              </ActionForm>
            </Card>
          )}

          {canManage && (
            <Card title={t.suspended ? "Reopen the shop" : "Pause the shop"}>
              {t.suspended ? (
                <ActionForm action={tenantSuspendAction} submitLabel="Reopen shop" variant="ghost">
                  <input type="hidden" name="id" value={t.id} />
                </ActionForm>
              ) : (
                <ActionForm action={tenantSuspendAction} submitLabel="Pause shop" variant="danger" confirm="Hide this tenant's shop and products from shoppers?">
                  <input type="hidden" name="id" value={t.id} />
                  <input type="hidden" name="suspended" value="true" />
                  <Field label="Reason" hint="The tenant sees this in their dashboard.">
                    <input name="reason" className={inputCls} maxLength={300} required />
                  </Field>
                </ActionForm>
              )}
            </Card>
          )}

          <Card title="Internal note">
            {canManage ? (
              <ActionForm action={tenantNoteAction} submitLabel="Save note" variant="ghost">
                <input type="hidden" name="id" value={t.id} />
                <textarea name="note" className={inputCls} defaultValue={t.admin_note ?? ""} maxLength={2000} placeholder="Only your team sees this" />
              </ActionForm>
            ) : (
              <p className="text-sm">{t.admin_note ?? "—"}</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
