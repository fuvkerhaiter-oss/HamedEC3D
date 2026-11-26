import Link from "next/link";
import { ActionForm } from "@/features/admin/ActionForm";
import { Badge, Card, EmptyState, fmtDate, fmtMoney, Notice, PageHeader, Stat, TestBadge } from "@/features/admin/ui";
import { fmtPrice } from "@/features/rentals/format";
import { SHOP_UNITS } from "@/features/store3d/env/shops";
import { requirePage } from "@/lib/admin/guard";
import { getSql } from "@/lib/db/client";
import { toDecimalString } from "@/lib/money";
import type { LeaseStatus } from "@/lib/rentals/availability";
import { LAUNCH_PROMO, promoActive, quoteAll, rentalPlan } from "@/lib/rentals/pricing";
import { toPublicShops } from "@/lib/rentals/public";
import { getShopStates, listLeases, rentalStats, shopLabel, type LeaseRow } from "@/lib/rentals/service";
import { leaseActivateAction, leaseCancelAction, leaseDisplayAction, leaseMoveAction, leaseNoteAction } from "./actions";

export const metadata = { title: "Shop rentals" };
export const dynamic = "force-dynamic";

const STATUS: Record<LeaseStatus, { label: string; tone: "green" | "amber" | "gray" | "red" | "blue" }> = {
  pending_payment: { label: "Waiting for payment", tone: "amber" },
  active: { label: "Paid", tone: "green" },
  payment_review: { label: "Needs you: paid, not active", tone: "red" },
  expired_unpaid: { label: "Not paid", tone: "gray" },
  cancelled: { label: "Cancelled", tone: "gray" },
  refunded: { label: "Refunded", tone: "gray" },
};

const FILTERS: { id: string; label: string }[] = [
  { id: "", label: "Recent" },
  { id: "current", label: "Renting now" },
  { id: "payment_review", label: "Needs you" },
  { id: "pending_payment", label: "Waiting for payment" },
  { id: "cancelled", label: "Cancelled" },
  { id: "refunded", label: "Refunded" },
  { id: "all", label: "All" },
];

function leasePhase(l: LeaseRow, now: Date): string | null {
  if (l.status !== "active" || !l.starts_at || !l.ends_at) return null;
  if (l.ends_at <= now) return "Ended";
  if (l.starts_at > now) return `Starts ${fmtDate(l.starts_at, false)}`;
  const days = Math.ceil((l.ends_at.getTime() - now.getTime()) / 86_400_000);
  return `${days} day${days === 1 ? "" : "s"} left`;
}

export default async function RentalsPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  await requirePage("orders.view");
  const { status = "", q = "" } = await searchParams;
  const sql = getSql();
  const valid = FILTERS.some((f) => f.id === status) ? status : "";
  const [leases, stats, states] = await Promise.all([
    listLeases(sql, { status: (valid || undefined) as never, q }),
    rentalStats(sql),
    getShopStates(sql),
  ]);
  const shops = toPublicShops(states);
  const now = new Date();
  const usd = quoteAll("USD", now);

  return (
    <>
      <PageHeader
        title="Shop rentals"
        actions={<Link href="/admin/rentals/tenants" className="btn-ghost">Shop tenants: products, traffic, fees →</Link>}
        description={<>Brands rent the shop units in the 3D store from the public <Link href="/rent-a-shop" className="underline" target="_blank">Rent a shop</Link> page. A booking becomes paid only when Stripe confirms the payment. Approve the brand name to show it on the shop&apos;s 3D sign.</>}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Shops rented now" value={`${stats.rented} / ${stats.total}`} />
        <Stat label="Rental income (paid, minus refunds)" value={stats.revenue.length ? stats.revenue.map((r) => fmtMoney(r.amount, r.currency)).join(" · ") : "—"} hint="Test payments not counted" />
        <Stat label="Ending in 14 days (not extended)" value={stats.expiringSoon} tone={stats.expiringSoon ? "warn" : "default"} hint="Tenants get a reminder 7 days before" href="/admin/rentals?status=current" />
        <Stat label="Need you" value={stats.toReview + stats.awaitingApproval} tone={stats.toReview ? "bad" : stats.awaitingApproval ? "warn" : "default"} hint={`${stats.toReview} payment review · ${stats.awaitingApproval} sign to approve`} href="/admin/rentals?status=payment_review" />
      </div>

      <Card title="Shops" className="mt-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {shops.map((s) => (
            <div key={s.id} className="rounded-xl bg-sand/50 p-4 ring-1 ring-line">
              <div className="flex items-center justify-between">
                <b>{s.label}</b>
                <Badge tone={s.state === "available" ? "green" : s.state === "held" ? "amber" : "ink"}>{s.state === "available" ? "Free" : s.state === "held" ? "Someone is paying" : "Rented"}</Badge>
              </div>
              <p className="mt-1 text-xs text-ink-soft">{s.where} · {s.widthM} × {s.depthM} m</p>
              {s.state !== "available" && <p className="mt-2 text-xs">{s.state === "rented" ? `${s.brand ?? "Sign not approved yet"} · until ${fmtDate(s.until, false)}` : `Held until ${fmtDate(s.until)}`}</p>}
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-ink-soft">
          Prices (in <code>src/lib/rentals/pricing.ts</code>): {usd.map((x) => `${rentalPlan(x.plan).name} ${fmtPrice(x.amount, "USD")}${x.promo ? ` (regular ${fmtPrice(x.regularAmount, "USD")}, −${x.discountPercent}%)` : ""}`).join(" · ")}. Same numbers in EUR.
          {promoActive(now) ? ` ${LAUNCH_PROMO.name} ends ${fmtDate(LAUNCH_PROMO.endsAt, false)}; after that the regular prices are charged automatically.` : " The launch offer has ended: regular prices apply."}
        </p>
      </Card>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <Link key={f.id} href={`/admin/rentals${f.id ? `?status=${f.id}` : ""}`} className={`rounded-full px-3 py-1.5 text-sm ${valid === f.id ? "bg-ink text-cream" : "bg-white ring-1 ring-line"}`}>
            {f.label}
          </Link>
        ))}
        <form className="ml-auto flex gap-2" action="/admin/rentals">
          {valid && <input type="hidden" name="status" value={valid} />}
          <input name="q" defaultValue={q} placeholder="Brand, email or RS-…" className="admin-input w-56" aria-label="Search rentals" />
          <button className="btn-ghost">Search</button>
        </form>
      </div>

      <div className="mt-4 space-y-3">
        {leases.length === 0 && <Card><EmptyState title="No rentals here yet">When a brand books a shop it appears here.</EmptyState></Card>}
        {leases.map((l) => {
          const st = STATUS[l.status];
          const phase = leasePhase(l, now);
          const canCancel = ["active", "payment_review", "pending_payment"].includes(l.status);
          const refundable = l.paid_at ? l.amount - l.refunded_amount : 0;
          return (
            <details key={l.id} className="rounded-2xl bg-white ring-1 ring-line" open={l.status === "payment_review"}>
              <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 px-5 py-4">
                <span className="font-mono text-xs text-ink-soft">{l.reference}</span>
                <b>{shopLabel(l.shop_id)}</b>
                <span className="font-medium">{l.brand_name}</span>
                <Badge tone={st.tone}>{st.label}</Badge>
                {phase && <Badge tone={phase === "Ended" ? "gray" : "blue"}>{phase}</Badge>}
                {l.status === "active" && !l.display_approved && <Badge tone="amber">Sign not approved</Badge>}
                {l.renews_lease_id && <Badge>Extension</Badge>}
                {l.is_test && <TestBadge />}
                <span className="ml-auto text-sm">{fmtMoney(l.amount, l.currency)} · {rentalPlan(l.plan).name}</span>
              </summary>
              <div className="grid gap-6 border-t border-line px-5 py-5 lg:grid-cols-[1.2fr_1fr]">
                <div className="space-y-4 text-sm">
                  <dl className="grid grid-cols-[130px_1fr] gap-x-4 gap-y-1.5">
                    <dt className="text-ink-soft">Contact</dt><dd>{l.contact_name} · <a href={`mailto:${l.email}`} className="underline">{l.email}</a>{l.phone ? ` · ${l.phone}` : ""}</dd>
                    <dt className="text-ink-soft">Business</dt><dd>{[l.company_name, l.vat_id && `VAT ${l.vat_id}`, l.country].filter(Boolean).join(" · ")}</dd>
                    <dt className="text-ink-soft">Category</dt><dd>{l.category}</dd>
                    {l.website && <><dt className="text-ink-soft">Website</dt><dd><a href={l.website} target="_blank" rel="noreferrer noopener" className="break-all underline">{l.website}</a></dd></>}
                    <dt className="text-ink-soft">Plan</dt><dd>{rentalPlan(l.plan).name} ({l.months} mo) · {fmtMoney(l.amount, l.currency)}{l.promo_name ? ` · ${l.promo_name}, regular ${fmtMoney(l.regular_amount, l.currency)}` : ""}</dd>
                    <dt className="text-ink-soft">Dates</dt><dd>{l.starts_at ? `${fmtDate(l.starts_at, false)} → ${fmtDate(l.ends_at, false)}` : "Not started"}</dd>
                    <dt className="text-ink-soft">Booked</dt><dd>{fmtDate(l.created_at)}{l.paid_at ? ` · paid ${fmtDate(l.paid_at)}` : ""}</dd>
                    {l.provider_payment_id && <><dt className="text-ink-soft">Payment</dt><dd className="font-mono text-xs">{l.provider} · {l.provider_payment_id}</dd></>}
                    {l.refunded_amount > 0 && <><dt className="text-ink-soft">Refunded</dt><dd>{fmtMoney(l.refunded_amount, l.currency)}</dd></>}
                    {l.cancel_reason && <><dt className="text-ink-soft">Reason</dt><dd>{l.cancel_reason}</dd></>}
                  </dl>
                  <div className="rounded-xl bg-sand/50 p-3"><p className="text-xs font-semibold text-ink-soft">What they sell</p><p className="mt-1 whitespace-pre-line">{l.description}</p></div>
                  <ActionForm action={leaseNoteAction} submitLabel="Save note" variant="ghost">
                    <input type="hidden" name="id" value={l.id} />
                    <textarea name="note" defaultValue={l.admin_note ?? ""} rows={2} maxLength={2000} className="admin-input" placeholder="Internal note (branding sent, invoice number…)" aria-label="Internal note" />
                  </ActionForm>
                </div>

                <div className="space-y-5">
                  {l.status === "payment_review" && (
                    <Notice tone="bad" title="Paid, but not active">
                      The tenant paid but the shop was taken (or the amount differed). Move them to a free shop and activate, or cancel with a full refund.
                      <div className="mt-3 flex flex-wrap gap-3">
                        <ActionForm action={leaseMoveAction} submitLabel="Move" variant="ghost" inline>
                          <input type="hidden" name="id" value={l.id} />
                          <select name="shopId" className="admin-input w-auto" aria-label="Move to shop" defaultValue="">
                            <option value="" disabled>Move to…</option>
                            {SHOP_UNITS.filter((u) => shops.find((s) => s.id === u.id)?.state === "available").map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
                          </select>
                        </ActionForm>
                        <ActionForm action={leaseActivateAction} submitLabel="Activate now" inline>
                          <input type="hidden" name="id" value={l.id} />
                        </ActionForm>
                      </div>
                    </Notice>
                  )}

                  {(l.status === "active" || l.status === "pending_payment") && (
                    <div>
                      <p className="text-sm font-semibold">3D shop sign</p>
                      <ActionForm action={leaseDisplayAction} submitLabel="Save sign" className="mt-2">
                        <input type="hidden" name="id" value={l.id} />
                        <input name="displayName" defaultValue={l.display_name ?? l.brand_name.slice(0, 40)} maxLength={40} className="admin-input" aria-label="Name on the sign" />
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" name="approved" defaultChecked={l.display_approved} /> Show this name on the shop&apos;s sign in the 3D store
                        </label>
                      </ActionForm>
                    </div>
                  )}

                  {canCancel && (
                    <div className="rounded-xl p-4 ring-1 ring-red-200">
                      <p className="text-sm font-semibold text-red-800">Cancel rental</p>
                      <p className="mt-1 text-xs text-ink-soft">Ends the rental now and frees the shop. Optionally refund (sent to {l.provider ?? "the provider"} first; if it fails nothing changes).</p>
                      <ActionForm action={leaseCancelAction} submitLabel="Cancel rental" variant="danger" className="mt-3" confirm={`Cancel ${l.reference} for ${l.brand_name}? The shop is freed at once.`}>
                        <input type="hidden" name="id" value={l.id} />
                        {refundable > 0 && (
                          <label className="block text-sm">Refund ({l.currency}, max {toDecimalString({ amount: refundable, currency: l.currency })})
                            <input name="refund" inputMode="decimal" defaultValue={l.status === "payment_review" ? toDecimalString({ amount: refundable, currency: l.currency }) : ""} placeholder="0 = no refund" className="admin-input mt-1" />
                          </label>
                        )}
                        {refundable === 0 && <input type="hidden" name="refund" value="" />}
                        <input name="reason" required maxLength={500} className="admin-input" placeholder="Reason (kept in the history)" aria-label="Reason" />
                      </ActionForm>
                    </div>
                  )}
                </div>
              </div>
            </details>
          );
        })}
      </div>
    </>
  );
}
