import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/features/admin/ActionForm";
import { Badge, Card, Field, fmtDate, fmtMoney, Notice, PageHeader, StatusBadge, statusLabel, Table, TestBadge } from "@/features/admin/ui";
import { requirePage } from "@/lib/admin/guard";
import { adminTargets, getOrderDetail } from "@/lib/admin/services/orders";
import { maskEmail, maskName } from "@/lib/admin/services/people";
import { getSql } from "@/lib/db/client";
import { toDecimalString } from "@/lib/money";
import { invoiceAction, noteAction, refundAction, shipmentAction, shipmentStatusAction, supplierOrdersAction, supplierRefAction, transitionAction } from "../actions";

export const metadata = { title: "Order" };

const ACTOR_LABEL: Record<string, string> = { system: "the shop (automatic)", admin: "an admin", customer: "the customer", payment_webhook: "the payment company", supplier_sync: "the supplier" };

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePage("orders.view");
  const { id } = await params;
  const d = await getOrderDetail(getSql(), id);
  if (!d) notFound();
  const { order: o } = d;
  const can = (p: Parameters<typeof session.permissions.has>[0]) => session.permissions.has(p);
  const pii = can("customers.pii");
  const targets = adminTargets(o.status);
  const a = o.shipping_address;
  const paid = d.payments.find((p) => p.status === "succeeded" || p.status === "partially_refunded");
  const refundable = paid ? paid.amount - paid.refunded_amount - d.refunds.filter((r) => r.status === "pending").reduce((s, r) => s + r.amount, 0) : 0;
  const canShip = ["paid", "processing", "submitted_to_supplier", "supplier_accepted", "shipped"].includes(o.status);

  return (
    <>
      <PageHeader
        eyebrow={fmtDate(o.created_at)}
        title={`Order #${o.order_number}`}
        description={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={o.status} />{o.is_test && <TestBadge />}<span>Paid in {o.currency} · {o.tax_mode === "inclusive" ? "prices include VAT" : "tax added on top"}</span></span>}
        actions={
          <>
            {d.invoice && <Link className="btn-ghost" href={`/admin/orders/${o.id}/invoice`} target="_blank">Invoice {d.invoice.invoice_number}</Link>}
            <Link className="btn-ghost" href="/admin/orders">← Back to orders</Link>
          </>
        }
      />
      {o.is_test && <div className="mb-4"><Notice tone="warn">This is a practice (TEST) order, not a real customer.</Notice></div>}
      <NextStep status={o.status} hasSupplierOrders={d.supplierOrders.length > 0} />

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="What the customer bought" pad={false}>
            <Table head={["Product", "Code (SKU)", "Price each", "Quantity", "Total"]}>
              {d.items.map((i) => (
                <tr key={i.id}>
                  <td><span className="font-medium">{i.product_name}</span> <span className="text-ink-soft">· {i.variant_name}</span></td>
                  <td className="font-mono text-xs">{i.sku}</td>
                  <td className="font-mono">{fmtMoney(i.unit_price, o.currency)}</td>
                  <td className="font-mono">{i.quantity}</td>
                  <td className="font-mono">{fmtMoney(i.line_total, o.currency)}</td>
                </tr>
              ))}
            </Table>
            <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 border-t border-line px-5 py-4 text-sm">
              <dt className="text-ink-soft">Items</dt><dd className="text-right font-mono">{fmtMoney(o.subtotal, o.currency)}</dd>
              {o.discount_total > 0 && <><dt className="text-ink-soft">Discount {o.discount_code && <code>{o.discount_code}</code>}</dt><dd className="text-right font-mono">−{fmtMoney(o.discount_total, o.currency)}</dd></>}
              <dt className="text-ink-soft">Shipping {o.shipping_method_name && `(${o.shipping_method_name})`}</dt><dd className="text-right font-mono">{fmtMoney(o.shipping_total, o.currency)}</dd>
              <dt className="text-ink-soft">{o.tax_mode === "inclusive" ? "VAT included" : "Tax"}</dt><dd className="text-right font-mono">{fmtMoney(o.tax_total, o.currency)}</dd>
              <dt className="font-semibold">Total</dt><dd className="text-right font-mono font-semibold">{fmtMoney(o.total, o.currency)}</dd>
              {o.base_currency && o.base_currency !== o.currency && <><dt className="text-xs text-ink-soft">Exchange rate that day</dt><dd className="text-right font-mono text-xs text-ink-soft">1 {o.currency} = {o.fx_rate_to_base ?? "not recorded"} {o.base_currency}</dd></>}
            </dl>
          </Card>

          <Card title="History and notes">
            <ol className="relative space-y-4 border-l border-line pl-5">
              <li className="text-sm"><span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full bg-sand ring-2 ring-white" /><p className="font-medium">Order placed</p><p className="text-xs text-ink-soft">{fmtDate(o.created_at)}</p></li>
              {[...d.events.map((e) => ({ t: e.created_at, kind: "event" as const, e })), ...d.notes.map((n) => ({ t: n.created_at, kind: "note" as const, n })), ...d.shipments.filter((s) => s.shipped_at).map((s) => ({ t: s.shipped_at!, kind: "ship" as const, s }))]
                .sort((x, y) => x.t.getTime() - y.t.getTime())
                .map((x, idx) => (
                  <li key={idx} className="text-sm">
                    <span className={`absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full ring-2 ring-white ${x.kind === "event" ? "bg-brand" : x.kind === "note" ? "bg-amber" : "bg-sky-500"}`} />
                    {x.kind === "event" && <><p><StatusBadge status={x.e.to_status} /> <span className="text-xs text-ink-soft">by {ACTOR_LABEL[x.e.actor_type] ?? x.e.actor_type.replace("_", " ")}{x.e.reason ? ` — ${x.e.reason}` : ""}</span></p>
                      {Object.keys(x.e.evidence ?? {}).length > 0 && <p className="mt-0.5 font-mono text-[11px] text-ink-soft">{Object.entries(x.e.evidence).map(([k, v]) => `${k}: ${String(v)}`).join(" · ")}</p>}</>}
                    {x.kind === "note" && <><p className="whitespace-pre-wrap">{x.n.body}</p><p className="text-xs text-ink-soft">{x.n.is_customer_visible ? "Customer-visible note" : "Internal note"} · {x.n.admin_email ?? "admin"}</p></>}
                    {x.kind === "ship" && <p>Shipped with {x.s.carrier} · <span className="font-mono">{x.s.tracking_number}</span></p>}
                    <p className="text-xs text-ink-soft">{fmtDate(x.t)}</p>
                  </li>
                ))}
            </ol>
            {can("orders.manage") && (
              <ActionForm action={noteAction} submitLabel="Add note" resetOnSuccess className="mt-5 border-t border-line pt-4">
                <input type="hidden" name="orderId" value={o.id} />
                <textarea name="body" required rows={2} placeholder="Write a note (only your team sees it unless you tick the box)…" className="admin-input" aria-label="Note" />
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="customerVisible" className="h-4 w-4" /> Visible to the customer</label>
              </ActionForm>
            )}
          </Card>

          <Card title="Sending the order">
            {d.supplierOrders.length === 0 ? (
              <p className="text-sm text-ink-soft">Not sent to a supplier yet.</p>
            ) : (
              <ul className="space-y-3">
                {d.supplierOrders.map((so) => (
                  <li key={so.id} className="rounded-xl border border-line p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{so.supplier_name}</span><StatusBadge status={so.status} /><Badge>{so.fulfillment_mode}</Badge>
                      {so.supplier_order_ref && <span className="font-mono text-xs">ref {so.supplier_order_ref}</span>}
                      <span className="ml-auto font-mono text-xs">{so.cost_total !== null ? `cost ${fmtMoney(so.cost_total, so.cost_currency)}` : "cost unknown"}</span>
                    </div>
                    {so.last_error && <p className="mt-1 text-xs text-amber-800">{so.last_error}</p>}
                    {so.status !== "submitted" && can("suppliers.manage") && (
                      <ActionForm action={supplierRefAction} submitLabel="Save supplier's order number" className="mt-3">
                        <input type="hidden" name="orderId" value={o.id} /><input type="hidden" name="supplierOrderId" value={so.id} />
                        <p className="text-xs text-ink-soft">Order these items from the supplier (on their website or by email). Then type the order number they gave you here, and what you paid if you know it.</p>
                        <div className="grid gap-2 sm:grid-cols-3">
                          <input name="ref" required placeholder="Supplier's order number" className="admin-input font-mono" aria-label="Supplier order reference" />
                          <input name="cost" inputMode="decimal" placeholder="What you paid (optional)" className="admin-input font-mono" aria-label="Actual cost" />
                          <select name="costCurrency" className="admin-input" aria-label="Cost currency"><option>EUR</option><option>USD</option></select>
                        </div>
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {can("suppliers.manage") && ["paid", "processing", "failed"].includes(o.status) && (
              <ActionForm action={supplierOrdersAction} inline className="mt-4">
                <input type="hidden" name="orderId" value={o.id} />
                <button className="btn-primary">{d.supplierOrders.length ? "Check suppliers again" : "Send to supplier(s)"}</button>
              </ActionForm>
            )}

            <h3 className="mt-6 text-sm font-semibold">Parcels and tracking</h3>
            {d.shipments.length === 0 ? <p className="mt-1 text-sm text-ink-soft">No parcel yet. When the supplier ships, they give you a tracking number — add it below.</p> : (
              <ul className="mt-2 space-y-2">
                {d.shipments.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-3 text-sm">
                    <span className="font-medium">{s.carrier}</span>
                    {s.tracking_url ? <a href={s.tracking_url} target="_blank" rel="noreferrer noopener" className="font-mono text-brand underline">{s.tracking_number}</a> : <span className="font-mono">{s.tracking_number}</span>}
                    <StatusBadge status={s.status} />
                    {can("orders.manage") && (
                      <ActionForm action={shipmentStatusAction} inline className="ml-auto" hideMessage>
                        <input type="hidden" name="orderId" value={o.id} /><input type="hidden" name="shipmentId" value={s.id} />
                        <select name="status" defaultValue={s.status} className="admin-input !w-auto !py-1 text-xs" aria-label="Shipment status">
                          {["in_transit", "out_for_delivery", "delivered", "exception"].map((x) => <option key={x} value={x}>{statusLabel(x)}</option>)}
                        </select>
                        <button className="btn-ghost !py-1 text-xs">Update</button>
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {can("orders.manage") && canShip && (
              <details className="mt-3 rounded-xl border border-dashed border-line">
                <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium">+ Add tracking number</summary>
                <ActionForm action={shipmentAction} submitLabel="Save shipment" className="border-t border-line p-4">
                  <input type="hidden" name="orderId" value={o.id} />
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Delivery company"><input name="carrier" required placeholder="e.g. DHL, UPS, Poste" className="admin-input" /></Field>
                    <Field label="Tracking number"><input name="trackingNumber" required className="admin-input font-mono" /></Field>
                    <Field label="Tracking link (optional)"><input name="trackingUrl" type="url" className="admin-input" /></Field>
                  </div>
                  <Field label="Notes"><input name="notes" className="admin-input" /></Field>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="markShipped" defaultChecked={o.status === "supplier_accepted"} className="h-4 w-4" /> Also mark the order as “Shipped” (possible once the supplier has confirmed)</label>
                </ActionForm>
              </details>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          {can("orders.manage") && (
            <Card title="Change the step">
              {targets.length === 0 ? <p className="text-sm text-ink-soft">This order is finished (“{statusLabel(o.status)}”). Nothing more to change.</p> : (
                <ActionForm action={transitionAction} submitLabel="Save" confirm="Move this order to the new step?">
                  <input type="hidden" name="orderId" value={o.id} />
                  <select name="to" className="admin-input" aria-label="New status">
                    {targets.map((t) => <option key={t} value={t}>{statusLabel(t)}</option>)}
                  </select>
                  <input name="reason" placeholder="Why? (optional, shown in the history)" className="admin-input" aria-label="Reason" />
                  {o.status === "supplier_accepted" && <p className="text-xs text-ink-soft">To mark it as shipped, add the tracking number in “Sending the order”.</p>}
                  {o.status === "pending_payment" && <p className="text-xs text-ink-soft">“Paid” is set automatically when the payment company confirms it.</p>}
                </ActionForm>
              )}
            </Card>
          )}

          <Card title="Customer">
            <p className="text-sm font-medium">{pii ? a.fullName : maskName(a.fullName ?? "")}</p>
            <p className="text-sm text-ink-soft">{pii ? o.email : maskEmail(o.email)}</p>
            {pii ? (
              <address className="mt-2 text-sm not-italic text-ink-soft">
                {a.line1}{a.line2 ? `, ${a.line2}` : ""}<br />{a.postalCode} {a.city}{a.region ? ` (${a.region})` : ""}<br />{a.country}{a.phone ? <><br />{a.phone}</> : null}
              </address>
            ) : <p className="mt-2 text-xs text-ink-soft">Ships to {o.ship_country}. Your account is not allowed to see the full address.</p>}
            {o.customer_note && <p className="mt-3 rounded-lg bg-cream p-2 text-sm">“{o.customer_note}”</p>}
            {can("customers.view") && <Link className="mt-3 inline-block text-sm text-brand underline" href={`/admin/customers?q=${encodeURIComponent(o.email)}`}>All orders from this customer</Link>}
          </Card>

          <Card title="Payment">
            {d.payments.length === 0 ? <p className="text-sm text-ink-soft">No payment recorded.</p> : d.payments.map((p) => (
              <div key={p.id} className="text-sm">
                <p className="flex flex-wrap items-center gap-2"><span className="font-medium capitalize">{p.provider}</span><StatusBadge status={p.status} />{p.is_test && <Badge tone="amber">test mode</Badge>}</p>
                <p className="mt-1 font-mono text-xs text-ink-soft" title="Payment (PaymentIntent) id">{p.provider_payment_id ?? "—"}</p>
                {p.provider_session_id && <p className="font-mono text-xs text-ink-soft" title="Checkout session id">{p.provider_session_id}</p>}
                <p className="mt-1 font-mono">{fmtMoney(p.amount, p.currency)}{p.refunded_amount > 0 && <span className="text-ink-soft"> · refunded {fmtMoney(p.refunded_amount, p.currency)}</span>}</p>
                <p className="text-xs text-ink-soft">Payment fee: {p.fee_amount === null ? "unknown" : fmtMoney(p.fee_amount, p.currency)}</p>
              </div>
            ))}
            {d.failedAttempts.length > 0 && (
              <div className="mt-3 border-t border-line pt-3 text-xs">
                <p className="font-medium">Declined card attempts ({d.failedAttempts.length})</p>
                <ul className="mt-1 space-y-0.5 text-ink-soft">{d.failedAttempts.map((a) => <li key={a.id}>{a.received_at.toLocaleString("en-GB")} · {a.message ?? "Payment failed"}</li>)}</ul>
              </div>
            )}
            {d.refunds.length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-line pt-3 text-xs">
                {d.refunds.map((r) => <li key={r.id} className="flex flex-wrap gap-2"><StatusBadge status={r.status} /><span className="font-mono">{fmtMoney(r.amount, r.currency)}</span><span className="text-ink-soft">{r.reason}</span>{r.error && <span className="text-red-700">{r.error}</span>}</li>)}
              </ul>
            )}
            {can("orders.refund") && paid && refundable > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-medium text-brand">Give money back (refund)…</summary>
                <ActionForm action={refundAction} submitLabel="Refund" variant="danger" confirm="Give this money back to the customer? This cannot be undone." className="mt-2">
                  <input type="hidden" name="orderId" value={o.id} />
                  <input type="hidden" name="requestId" value={randomUUID()} />{/* one refund per rendered form: a double submit is rejected */}
                  <Field label={`Amount (${paid.currency}, max ${toDecimalString({ amount: refundable, currency: paid.currency })})`}><input name="amount" inputMode="decimal" defaultValue={toDecimalString({ amount: refundable, currency: paid.currency })} className="admin-input font-mono" /></Field>
                  <Field label="Reason"><input name="reason" required placeholder="e.g. item arrived broken" className="admin-input" /></Field>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="manual" className="h-4 w-4" /> I already refunded it myself in Stripe (just write it down here)</label>
                  <input name="manualReference" placeholder="Refund number from Stripe (only if you ticked the box)" className="admin-input font-mono" aria-label="Provider refund reference" />
                </ActionForm>
              </details>
            )}
          </Card>

          <Card title="Invoice">
            {d.invoice ? <p className="text-sm">Issued <Link className="text-brand underline" href={`/admin/orders/${o.id}/invoice`} target="_blank">{d.invoice.invoice_number}</Link> on {fmtDate(d.invoice.issued_at, false)}.</p> : (
              can("orders.manage") ? (
                <ActionForm action={invoiceAction} inline><input type="hidden" name="orderId" value={o.id} /><button className="btn-ghost">Create invoice</button></ActionForm>
              ) : <p className="text-sm text-ink-soft">Not issued.</p>
            )}
            <p className="mt-2 text-xs text-ink-soft">Uses your company details from Shop settings. Ask your accountant to check the invoice once.</p>
          </Card>

          <Card title="Stock kept aside for this order">
            {d.reservations.length === 0 ? <p className="text-sm text-ink-soft">Nothing kept aside.</p> : (
              <ul className="space-y-1 text-xs">{d.reservations.map((r) => <li key={r.variant_id} className="flex justify-between"><span className="font-mono">{d.items.find((i) => i.variant_id === r.variant_id)?.sku ?? r.variant_id.slice(0, 8)} × {r.quantity}</span><StatusBadge status={r.status === "reserved" ? "pending" : r.status === "committed" ? "shipped" : "cancelled"} /></li>)}</ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

/** Plain-language "what do I do now?" box, driven by the order's current step. */
function NextStep({ status, hasSupplierOrders }: { status: string; hasSupplierOrders: boolean }) {
  const steps: Record<string, { tone: "warn" | "info" | "ok"; title: string; text: string }> = {
    pending_payment: { tone: "info", title: "Nothing to do yet", text: "The customer has not paid. If they don't pay within 25 hours, the order cancels itself." },
    paid: hasSupplierOrders
      ? { tone: "warn", title: "Next: order the items from your supplier", text: "In “Sending the order” below, order the items from each supplier, then type the supplier's order number and press Save." }
      : { tone: "warn", title: "Next: send this order to your supplier", text: "The customer paid. Press “Send to supplier(s)” in the “Sending the order” box below." },
    processing: { tone: "warn", title: "Next: order the items from your supplier", text: "In “Sending the order” below, type the supplier's order number once you have ordered from them." },
    submitted_to_supplier: { tone: "info", title: "Waiting for the supplier", text: "The supplier has the order. When they confirm, change the step to “Supplier confirmed”." },
    supplier_accepted: { tone: "warn", title: "Next: add the tracking number", text: "When the supplier ships, click “+ Add tracking number” below and enter it." },
    shipped: { tone: "info", title: "On the way", text: "When the customer receives it, change the step to “Delivered” (or update the parcel status below)." },
    delivered: { tone: "ok", title: "Finished", text: "The customer has the order. Nothing more to do." },
    cancelled: { tone: "ok", title: "Cancelled", text: "This order was cancelled. Nothing more to do." },
    refunded: { tone: "ok", title: "Refunded", text: "The money was given back. Nothing more to do." },
    refund_requested: { tone: "warn", title: "Next: decide on the refund", text: "Use “Give money back (refund)” in the Payment box on the right." },
    failed: { tone: "info", title: "Payment failed", text: "The customer's payment did not go through. Nothing was charged." },
  };
  const s = steps[status];
  if (!s) return null;
  return <div className="mb-5"><Notice tone={s.tone} title={s.title}>{s.text}</Notice></div>;
}
