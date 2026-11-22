import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { verifyOrderToken } from "@/lib/checkout/order-link";
import { getSql, isDbConfigured } from "@/lib/db/client";
import { blockMessage, loadWithdrawalContext, WITHDRAWAL_DAYS } from "@/lib/orders/withdrawal";
import { OrderLookupForm } from "@/features/support/SupportForms";
import { WithdrawalForm } from "@/features/support/WithdrawalForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Withdraw from contract",
  description: `Change your mind about an order delivered in the EU? Withdraw online within ${WITHDRAWAL_DAYS} days of delivery, no reason needed.`,
  alternates: { canonical: "/withdraw" },
};

const STATUS_TEXT = { received: "Received — we'll email you the next steps", completed: "Completed", rejected: "Not accepted" } as const;

/**
 * EU online withdrawal function ("withdraw from contract here"). Without a signed order link it asks for the
 * order email + number; with one it shows the statement form and the "Confirm withdrawal" button.
 */
export default async function WithdrawPage({ searchParams }: { searchParams: Promise<{ id?: string; t?: string }> }) {
  const { id = "", t } = await searchParams;
  const authorised = isDbConfigured() && verifyOrderToken(id, t);
  const ctx = authorised ? await loadWithdrawalContext(getSql(), id) : null;

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-12">
      <Breadcrumbs items={[{ name: "Home", path: "/" }, { name: "Withdraw from contract", path: "/withdraw" }]} className="mb-6" />
      <p className="eyebrow text-brand">Your right to change your mind</p>
      <h1 className="mt-2 font-display text-5xl leading-none">Withdraw from contract</h1>
      <p className="mt-4 leading-relaxed text-ink-soft">
        If your order was delivered in the European Union, you can withdraw from it within {WITHDRAWAL_DAYS} days of receiving it
        (of the last parcel, if it came in several), without giving any reason. You can also withdraw before it arrives.
        Items that are damaged, faulty or wrong are always covered: <Link href="/contact" className="underline">contact us</Link> about those at any time.
      </p>

      {!ctx ? (
        <section className="mt-8 rounded-3xl border-t-4 border-amber bg-white p-7 ring-1 ring-line">
          {id && <p role="alert" className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">This link is not valid or has expired. Find your order below.</p>}
          <h2 className="font-display text-2xl">Find your order</h2>
          <p className="mt-1 text-sm text-ink-soft">Enter the email you ordered with and your order number (in your confirmation email).</p>
          <div className="mt-5"><OrderLookupForm target="withdraw" submitLabel="Continue" /></div>
        </section>
      ) : (
        <>
          {ctx.requests.length > 0 && (
            <section className="mt-8 rounded-3xl bg-white/70 p-6 text-sm shadow-card">
              <h2 className="font-display text-xl">Your withdrawals for order #{ctx.orderNumber}</h2>
              <ul className="mt-3 space-y-3">
                {ctx.requests.map((r) => (
                  <li key={r.id} className="border-t border-line pt-3 first:border-0 first:pt-0">
                    <p><b>{new Date(r.submittedAt).toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" })}</b> · {STATUS_TEXT[r.status]}</p>
                    <p className="text-ink-soft">{r.items.map((i) => `${i.quantity} × ${i.name}`).join(", ")}</p>
                    {r.status === "rejected" && r.adminNote && <p className="mt-1">{r.adminNote}</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="mt-8 rounded-3xl border-t-4 border-amber bg-white p-7 ring-1 ring-line">
            <h2 className="font-display text-2xl">Order #{ctx.orderNumber}</h2>
            {ctx.window.deadline && !ctx.block && (
              <p className="mt-1 text-sm text-ink-soft">You can withdraw online until {ctx.window.deadline.toLocaleDateString("en-GB", { dateStyle: "long" })}.</p>
            )}
            <div className="mt-5">
              {ctx.block ? (
                <p className="rounded-2xl bg-sand/60 p-4 text-sm leading-relaxed">
                  {blockMessage(ctx.block)}{" "}
                  {ctx.block === "not_eu" && <Link href="/pages/returns" className="underline">Returns policy</Link>}
                </p>
              ) : (
                <WithdrawalForm
                  orderId={ctx.orderId} token={t!} orderNumber={ctx.orderNumber} fullName={ctx.fullName} email={ctx.email}
                  items={ctx.items.filter((i) => i.quantity > i.withdrawn).map((i) => ({ id: i.id, name: i.name, variant: i.variant, left: i.quantity - i.withdrawn }))}
                />
              )}
            </div>
          </section>
        </>
      )}

      <p className="mt-8 text-sm text-ink-soft">
        Prefer email or post? You can also send us a clear statement (for example the model form in our{" "}
        <Link href="/pages/returns" className="underline">Returns &amp; Refunds policy</Link>) using the details on our{" "}
        <Link href="/contact" className="underline">contact page</Link>.
      </p>
    </main>
  );
}
