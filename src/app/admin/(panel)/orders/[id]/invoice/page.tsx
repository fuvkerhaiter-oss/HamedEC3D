import { notFound } from "next/navigation";
import { fmtDate, fmtMoney } from "@/features/admin/ui";
import { requirePage } from "@/lib/admin/guard";
import { getOrderDetail } from "@/lib/admin/services/orders";
import { getSql } from "@/lib/db/client";

export const metadata = { title: "Invoice" };

/** Printable invoice from the immutable order snapshot + the seller snapshot taken when it was issued. */
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePage("orders.view");
  const { id } = await params;
  const sql = getSql();
  const d = await getOrderDetail(sql, id);
  if (!d || !d.invoice) notFound();
  const [inv] = await sql<{ seller_snapshot: Record<string, string> }[]>`select seller_snapshot from public.invoices where order_id = ${id}`;
  const s = inv!.seller_snapshot;
  const o = d.order;
  const a = o.shipping_address;
  return (
    <article className="mx-auto max-w-3xl rounded-2xl bg-white p-8 text-sm print:rounded-none print:p-0">
      <header className="flex flex-wrap justify-between gap-6 border-b border-line pb-6">
        <div>
          <p className="font-display text-2xl">{s.legalName}</p>
          <p className="whitespace-pre-line text-ink-soft">{s.address}</p>
          {s.vatNumber && <p className="text-ink-soft">VAT {s.vatNumber}</p>}
          {s.email && <p className="text-ink-soft">{s.email}</p>}
        </div>
        <div className="text-right">
          <p className="eyebrow text-ink-soft">Invoice</p>
          <p className="font-mono text-lg">{d.invoice.invoice_number}</p>
          <p className="text-ink-soft">Issued {fmtDate(d.invoice.issued_at, false)}</p>
          <p className="text-ink-soft">Order #{o.order_number} · {fmtDate(o.created_at, false)}</p>
        </div>
      </header>
      <section className="py-6">
        <p className="eyebrow text-ink-soft">Bill / ship to</p>
        <p className="mt-1">{a.fullName}<br />{a.line1}{a.line2 ? `, ${a.line2}` : ""}<br />{a.postalCode} {a.city}{a.region ? ` (${a.region})` : ""}<br />{a.country}</p>
      </section>
      <table className="w-full border-collapse">
        <thead><tr className="border-b border-line text-left text-xs text-ink-soft"><th className="py-2">Item</th><th>SKU</th><th className="text-right">Unit</th><th className="text-right">Qty</th><th className="text-right">Total</th></tr></thead>
        <tbody>
          {d.items.map((i) => (
            <tr key={i.id} className="border-b border-line/60"><td className="py-2">{i.product_name} · {i.variant_name}</td><td className="font-mono text-xs">{i.sku}</td><td className="text-right font-mono">{fmtMoney(i.unit_price, o.currency)}</td><td className="text-right font-mono">{i.quantity}</td><td className="text-right font-mono">{fmtMoney(i.line_total, o.currency)}</td></tr>
          ))}
        </tbody>
      </table>
      <dl className="ml-auto mt-4 grid max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1">
        <dt>Subtotal</dt><dd className="text-right font-mono">{fmtMoney(o.subtotal, o.currency)}</dd>
        {o.discount_total > 0 && <><dt>Discount</dt><dd className="text-right font-mono">−{fmtMoney(o.discount_total, o.currency)}</dd></>}
        <dt>Shipping</dt><dd className="text-right font-mono">{fmtMoney(o.shipping_total, o.currency)}</dd>
        <dt>{o.tax_mode === "inclusive" ? "of which VAT" : "Tax"}</dt><dd className="text-right font-mono">{fmtMoney(o.tax_total, o.currency)}</dd>
        <dt className="font-semibold">Total</dt><dd className="text-right font-mono font-semibold">{fmtMoney(o.total, o.currency)}</dd>
      </dl>
      <p className="mt-10 text-xs text-ink-soft print:hidden">Use your browser&apos;s Print → Save as PDF. Amounts are the order&apos;s stored snapshot and never change.</p>
    </article>
  );
}
