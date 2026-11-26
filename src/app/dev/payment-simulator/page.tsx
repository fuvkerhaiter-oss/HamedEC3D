import { notFound } from "next/navigation";
import { getSql } from "@/lib/db/client";
import { formatMoney, type CurrencyCode } from "@/lib/money";
import { getPaymentProvider } from "@/lib/payments/registry";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payment simulator (development)", robots: { index: false } };

/** DEVELOPMENT ONLY stand-in for the Stripe payment page. Not a real payment. */
export default async function PaymentSimulator({ searchParams }: { searchParams: Promise<{ order?: string; session?: string }> }) {
  if (process.env.NODE_ENV === "production" || !getPaymentProvider("dev-simulator")) notFound();
  const { order = "", session = "" } = await searchParams;
  const leaseId = order.startsWith("lease_") ? order.slice(6) : null;
  const [o] = leaseId && /^[0-9a-f-]{36}$/i.test(leaseId)
    ? await getSql()<{ order_number: string; total: number; currency: CurrencyCode }[]>`select 'rental ' || reference as order_number, amount as total, currency from public.shop_leases where id = ${leaseId}`
    : /^[0-9a-f-]{36}$/i.test(order)
      ? await getSql()<{ order_number: string; total: number; currency: CurrencyCode }[]>`select order_number, total, currency from public.orders where id = ${order}`
      : [];
  if (!o) notFound();
  return (
    <main className="flex min-h-dvh items-center justify-center bg-ink p-6 text-cream">
      <div className="w-full max-w-sm rounded-3xl bg-cream p-8 text-center text-ink">
        <p className="rounded-full bg-amber px-3 py-1 text-xs font-semibold uppercase tracking-wider">Development simulator · not a real payment</p>
        <h1 className="mt-5 font-display text-2xl">{leaseId ? `Shop ${o.order_number}` : `Order #${o.order_number}`}</h1>
        <p className="mt-2 font-display text-4xl">{formatMoney({ amount: Number(o.total), currency: o.currency })}</p>
        <form action="/api/dev/payment-simulator" method="post" className="mt-6 space-y-3">
          <input type="hidden" name="order" value={order} />
          <input type="hidden" name="session" value={session} />
          <button name="outcome" value="pay" className="w-full rounded-full bg-ink py-3 font-semibold text-cream">Simulate successful payment</button>
          <button name="outcome" value="fail" className="w-full rounded-full border border-ink py-3 font-semibold">Simulate failed payment</button>
        </form>
        <a href={leaseId ? "/rent-a-shop?cancelled=1" : "/checkout?cancelled=1"} className="mt-4 inline-block text-sm underline">Cancel and return to checkout</a>
      </div>
    </main>
  );
}
