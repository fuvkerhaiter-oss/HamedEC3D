import Link from "next/link";
import { fmtDay, fmtPrice } from "@/features/rentals/format";
import { RenewForm } from "@/features/rentals/RenewForm";
import { Callout, PageTitle, Panel, Pill } from "@/features/seller/ui";
import { leaseToken } from "@/lib/checkout/order-link";
import { quoteAll, rentalPlan } from "@/lib/rentals/pricing";
import { isComplimentary, shopLabel, type LeaseRow } from "@/lib/rentals/service";
import { requireSeller } from "@/lib/tenants/access";
import { currentLease, paidUntil } from "@/lib/tenants/service";

export const metadata = { title: "Rent & billing" };

const STATUS: Record<LeaseRow["status"], { label: string; tone: "green" | "amber" | "gray" | "red" }> = {
  active: { label: "Paid", tone: "green" },
  pending_payment: { label: "Waiting for payment", tone: "amber" },
  payment_review: { label: "Being checked", tone: "amber" },
  expired_unpaid: { label: "Not paid", tone: "gray" },
  cancelled: { label: "Cancelled", tone: "gray" },
  refunded: { label: "Refunded", tone: "red" },
};

export default async function SellerBillingPage() {
  const ctx = await requireSeller();
  if (!ctx) return null;
  const { tenant, leases } = ctx;
  const now = new Date();
  const lease = currentLease(leases, now);
  const until = lease ? paidUntil(leases, lease.shop_id, now) : null;
  const shown = leases.filter((l) => l.status !== "expired_unpaid" || l.created_at > new Date(now.getTime() - 30 * 86_400_000));
  return (
    <>
      <PageTitle title="Rent & billing" description="Your rental periods and payments. Rent is paid in advance; extending continues right after your last paid day." />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Panel title="Payments" pad={false}>
          {shown.length === 0 ? (
            <p className="p-5 text-sm text-ink-soft">No payments yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-ink-soft">
                    <th className="px-5 py-3 font-semibold">Reference</th>
                    <th className="px-3 py-3 font-semibold">Shop · plan</th>
                    <th className="px-3 py-3 font-semibold">Period</th>
                    <th className="px-3 py-3 text-right font-semibold">Amount</th>
                    <th className="px-5 py-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((l) => (
                    <tr key={l.id} className="border-t border-line">
                      <td className="px-5 py-3 font-mono text-xs">{l.reference}</td>
                      <td className="px-3 py-3">{shopLabel(l.shop_id)} · {rentalPlan(l.plan).name}</td>
                      <td className="px-3 py-3 text-ink-soft">{l.starts_at ? `${fmtDay(l.starts_at)} → ${fmtDay(l.ends_at)}` : "—"}</td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {isComplimentary(l) ? "Free" : fmtPrice(l.amount, l.currency)}
                        {l.fee_amount > 0 && <span className="block text-[11px] text-ink-soft">incl. {fmtPrice(l.fee_amount, l.currency)} platform fee</span>}
                        {l.refunded_amount > 0 && <span className="block text-[11px] text-red-700">−{fmtPrice(l.refunded_amount, l.currency)} refunded</span>}
                      </td>
                      <td className="px-5 py-3"><Pill tone={STATUS[l.status].tone}>{STATUS[l.status].label}</Pill></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <div className="space-y-6">
          <Panel title="Extend your rental">
            {lease && until ? (
              <>
                <p className="mb-4 text-sm text-ink-soft">
                  {shopLabel(lease.shop_id)} is yours until <b className="text-ink">{fmtDay(until)}</b>. A new period starts the day after.
                </p>
                {tenant.monthly_fee > 0 && (
                  <div className="mb-4">
                    <Callout tone="info">A platform fee of <b>{fmtPrice(tenant.monthly_fee, lease.currency)}</b> per month is added to the rent at checkout.</Callout>
                  </div>
                )}
                <RenewForm leaseId={lease.id} token={leaseToken(lease.id)} currency={lease.currency} quotes={quoteAll(lease.currency, now)} />
              </>
            ) : (
              <>
                <p className="text-sm text-ink-soft">You don&apos;t have a running rental to extend.</p>
                <Link href="/rent-a-shop" className="btn-yellow mt-4 w-full py-3">Rent a shop</Link>
              </>
            )}
          </Panel>
          <Callout title="Invoices">Each payment&apos;s receipt comes from Stripe by email. Need an invoice with your company and VAT details? Contact us with your reference.</Callout>
        </div>
      </div>
    </>
  );
}
