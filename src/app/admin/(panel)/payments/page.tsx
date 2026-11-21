import Link from "next/link";
import { ActionForm } from "@/features/admin/ActionForm";
import { Badge, Card, Field, fmtDate, fmtMoney, Notice, PageHeader, StatusBadge, Table } from "@/features/admin/ui";
import { requirePage } from "@/lib/admin/guard";
import { listPayments, listRates, listRefunds, recentWebhookEvents } from "@/lib/admin/services/finance";
import { getSetting } from "@/lib/admin/services/settings";
import { getSql } from "@/lib/db/client";
import { paymentProviderStatuses } from "@/lib/payments/registry";
import { addRateAction } from "../ops-actions";

export const metadata = { title: "Payments" };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const session = await requirePage("payments.view");
  const sp = await searchParams;
  const sql = getSql();
  const [payments, refunds, events, rates, base] = await Promise.all([listPayments(sql, { status: sp.status }), listRefunds(sql), recentWebhookEvents(sql), listRates(sql), getSetting(sql, "store.base_currency")]);
  const providers = paymentProviderStatuses();
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://your-domain";
  return (
    <>
      <PageHeader title="Payments" description="Money customers paid and refunds you gave back. Orders become “Paid” only when the payment company confirms it." />
      <div className="grid gap-3 md:grid-cols-2">
        {providers.map((p) => (
          <div key={p.id} className="rounded-2xl border border-line bg-white p-4">
            <p className="flex items-center gap-2 font-medium">{p.name} <Badge tone={p.configured ? (p.mode === "live" ? "green" : "amber") : "gray"}>{p.configured ? p.mode : "not configured"}</Badge></p>
            <p className="mt-1 text-sm text-ink-soft">{p.detail}</p>
            {p.id === "stripe" && <p className="mt-2 font-mono text-[11px] text-ink-soft">Webhook endpoint: {site}/api/webhooks/stripe</p>}
          </div>
        ))}
      </div>
      {!providers.some((p) => p.configured) && <div className="mt-4"><Notice tone="warn" title="No payment provider configured">Checkout payments and refunds are unavailable until Stripe test keys are added and a sandbox payment is verified end-to-end.</Notice></div>}

      <Card title="Transactions" className="mt-6" pad={false} actions={<nav className="flex gap-1 text-xs">{["", "pending", "succeeded", "failed", "partially_refunded", "refunded"].map((s) => <Link key={s} href={s ? `?status=${s}` : "?"} className={`rounded-full px-2.5 py-1 ${(sp.status ?? "") === s ? "bg-ink text-cream" : "text-ink-soft hover:bg-sand/60"}`}>{s ? s.replace("_", " ") : "all"}</Link>)}</nav>}>
        {payments.length === 0 ? <p className="p-5 text-sm text-ink-soft">No payments recorded yet.</p> : (
          <Table head={["Order", "Provider", "Payment id", "Status", "Amount", "Refunded", "Fee", "Date"]}>
            {payments.map((p) => (
              <tr key={p.id}>
                <td><Link className="font-medium hover:underline" href={`/admin/orders/${p.order_id}`}>#{p.order_number}</Link></td>
                <td className="capitalize">{p.provider} {p.is_test && <Badge tone="amber">test</Badge>}</td>
                <td className="font-mono text-[11px]">{p.provider_payment_id ?? "—"}</td>
                <td><StatusBadge status={p.status} /></td>
                <td className="font-mono">{fmtMoney(p.amount, p.currency)}</td>
                <td className="font-mono">{p.refunded_amount ? fmtMoney(p.refunded_amount, p.currency) : "—"}</td>
                <td className="font-mono text-xs">{p.fee_amount === null ? "n/a" : fmtMoney(p.fee_amount, p.currency)}</td>
                <td className="text-xs text-ink-soft">{fmtDate(p.created_at)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <Card title="Refunds" pad={false}>
          {refunds.length === 0 ? <p className="p-5 text-sm text-ink-soft">No refunds.</p> : (
            <Table head={["Order", "Amount", "Status", "Reason", "By", "Date"]}>
              {refunds.map((r) => (
                <tr key={r.id}><td><Link className="hover:underline" href={`/admin/orders/${r.order_id}`}>#{r.order_number}</Link></td><td className="font-mono">{fmtMoney(r.amount, r.currency)}</td><td><StatusBadge status={r.status} />{r.error && <span className="block text-[11px] text-red-700">{r.error}</span>}</td><td className="text-xs">{r.reason}</td><td className="text-xs text-ink-soft">{r.admin_email ?? "—"}</td><td className="text-xs text-ink-soft">{fmtDate(r.created_at)}</td></tr>
              ))}
            </Table>
          )}
        </Card>
        <Card title="Webhook deliveries (deduplicated)" pad={false}>
          {events.length === 0 ? <p className="p-5 text-sm text-ink-soft">No webhook events received yet.</p> : (
            <Table head={["Provider", "Event", "Type", "Order", "Received"]}>
              {events.map((e) => (
                <tr key={e.id}><td>{e.provider}</td><td className="font-mono text-[11px]">{e.provider_event_id}</td><td className="text-xs">{e.event_type}</td><td>{e.order_id ? <Link className="text-brand underline" href={`/admin/orders/${e.order_id}`}>view</Link> : "—"}</td><td className="text-xs text-ink-soft">{fmtDate(e.received_at)}</td></tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      {session.permissions.has("finance.view") && (
        <Card title={`Exchange rates (base currency ${String(base ?? "EUR")})`} className="mt-6">
          <p className="mb-3 text-sm text-ink-soft">Used for reporting in the base currency. Each order stores the rate at purchase time; adding a new rate never rewrites past orders. Rates are entered manually (no live FX feed is connected).</p>
          {rates.length > 0 && (
            <ul className="mb-4 space-y-1 font-mono text-xs">{rates.slice(0, 8).map((r) => <li key={r.id}>{fmtDate(r.effective_at)} · 1 {r.base_currency} = {r.rate} {r.quote_currency} <span className="text-ink-soft">({r.source}{r.created_by_email ? `, ${r.created_by_email}` : ""})</span></li>)}</ul>
          )}
          {session.permissions.has("finance.manage") && (
            <ActionForm action={addRateAction} submitLabel="Add rate" resetOnSuccess>
              <div className="grid gap-3 sm:grid-cols-4">
                <Field label="1 ×"><select name="base" className="admin-input"><option>EUR</option><option>USD</option></select></Field>
                <Field label="="><input name="rate" required placeholder="1.08250000" className="admin-input font-mono" /></Field>
                <Field label="Currency"><select name="quote" defaultValue="USD" className="admin-input"><option>EUR</option><option>USD</option></select></Field>
                <Field label="Effective"><input name="effectiveAt" type="datetime-local" className="admin-input" /></Field>
              </div>
            </ActionForm>
          )}
        </Card>
      )}
    </>
  );
}
