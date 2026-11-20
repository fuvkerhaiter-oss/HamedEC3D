import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/features/admin/ActionForm";
import { Badge, Card, Field, fmtDate, fmtMoney, Notice, PageHeader, StatusBadge, Table, TestBadge } from "@/features/admin/ui";
import { requirePage } from "@/lib/admin/guard";
import { adminTargets, getOrderDetail } from "@/lib/admin/services/orders";
import { maskEmail, maskName } from "@/lib/admin/services/people";
import { getSql } from "@/lib/db/client";
import { toDecimalString } from "@/lib/money";
import { invoiceAction, noteAction, refundAction, shipmentAction, shipmentStatusAction, supplierOrdersAction, supplierRefAction, transitionAction } from "../actions";

export const metadata = { title: "Order" };

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
        description={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={o.status} />{o.is_test && <TestBadge />}<span>{o.currency} · {o.tax_mode === "inclusive" ? "prices incl. VAT" : "tax added"}</span></span>}
        actions={
          <>
            {d.invoice && <Link className="btn-ghost" href={`/admin/orders/${o.id}/invoice`} target="_blank">Invoice {d.invoice.invoice_number}</Link>}
            <Link className="btn-ghost" href="/admin/orders">← Orders</Link>
          </>
        }
      />
      {o.is_test && <div className="mb-4"><Notice tone="warn">TEST order — created by a test/sandbox flow, not a real customer purchase.</Notice></div>}

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Items" pad={false}>
            <Table head={["Product", "SKU", "Unit", "Qty", "Total"]}>
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
              <dt className="text-ink-soft">Subtotal</dt><dd className="text-right font-mono">{fmtMoney(o.subtotal, o.currency)}</dd>
              {o.discount_total > 0 && <><dt className="text-ink-soft">Discount {o.discount_code && <code>{o.discount_code}</code>}</dt><dd className="text-right font-mono">−{fmtMoney(o.discount_total, o.currency)}</dd></>}
              <dt className="text-ink-soft">Shipping {o.shipping_method_name && `(${o.shipping_method_name})`}</dt><dd className="text-right font-mono">{fmtMoney(o.shipping_total, o.currency)}</dd>
              <dt className="text-ink-soft">{o.tax_mode === "inclusive" ? "VAT included" : "Tax"}</dt><dd className="text-right font-mono">{fmtMoney(o.tax_total, o.currency)}</dd>
              <dt className="font-semibold">Total</dt><dd className="text-right font-mono font-semibold">{fmtMoney(o.total, o.currency)}</dd>
              {o.base_currency && o.base_currency !== o.currency && <><dt className="text-xs text-ink-soft">FX snapshot</dt><dd className="text-right font-mono text-xs text-ink-soft">1 {o.currency} = {o.fx_rate_to_base ?? "not recorded"} {o.base_currency}</dd></>}
            </dl>
          </Card>

          <Card title="Timeline">
            <ol className="relative space-y-4 border-l border-line pl-5">
              <li className="text-sm"><span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full bg-sand ring-2 ring-white" /><p className="font-medium">Order placed</p><p className="text-xs text-ink-soft">{fmtDate(o.created_at)}</p></li>
              {[...d.events.map((e) => ({ t: e.created_at, kind: "event" as const, e })), ...d.notes.map((n) => ({ t: n.created_at, kind: "note" as const, n })), ...d.shipments.filter((s) => s.shipped_at).map((s) => ({ t: s.shipped_at!, kind: "ship" as const, s }))]
                .sort((x, y) => x.t.getTime() - y.t.getTime())
                .map((x, idx) => (
                  <li key={idx} className="text-sm">
                    <span className={`absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full ring-2 ring-white ${x.kind === "event" ? "bg-brand" : x.kind === "note" ? "bg-amber" : "bg-sky-500"}`} />
                    {x.kind === "event" && <><p><StatusBadge status={x.e.to_status} /> <span className="text-xs text-ink-soft">by {x.e.actor_type.replace("_", " ")}{x.e.reason ? ` — ${x.e.reason}` : ""}</span></p>
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
                <textarea name="body" required rows={2} placeholder="Write a note…" className="admin-input" aria-label="Note" />
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="customerVisible" className="h-4 w-4" /> Visible to the customer</label>
              </ActionForm>
            )}
          </Card>

          <Card title="Fulfillment">
            {d.supplierOrders.length === 0 ? (
              <p className="text-sm text-ink-soft">No supplier orders yet.</p>
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
                      <ActionForm action={supplierRefAction} submitLabel="Record supplier reference" className="mt-3">
                        <input type="hidden" name="orderId" value={o.id} /><input type="hidden" name="supplierOrderId" value={so.id} />
                        <p className="text-xs text-ink-soft">Place this order with the supplier, then record their order reference (and the real cost, if known).</p>
                        <div className="grid gap-2 sm:grid-cols-3">
                          <input name="ref" required placeholder="Supplier order ref" className="admin-input font-mono" aria-label="Supplier order reference" />
                          <input name="cost" inputMode="decimal" placeholder="Actual cost (optional)" className="admin-input font-mono" aria-label="Actual cost" />
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
                <button className="btn-primary">{d.supplierOrders.length ? "Re-check supplier split" : "Start fulfillment (split by supplier)"}</button>
              </ActionForm>
            )}

            <h3 className="mt-6 text-sm font-semibold">Shipments</h3>
            {d.shipments.length === 0 ? <p className="mt-1 text-sm text-ink-soft">No shipments recorded. Tracking numbers come from the supplier/carrier — never invented.</p> : (
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
                          {["in_transit", "out_for_delivery", "delivered", "exception"].map((x) => <option key={x} value={x}>{x.replace(/_/g, " ")}</option>)}
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
                <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium">+ Record a shipment</summary>
                <ActionForm action={shipmentAction} submitLabel="Save shipment" className="border-t border-line p-4">
                  <input type="hidden" name="orderId" value={o.id} />
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Carrier"><input name="carrier" required className="admin-input" /></Field>
                    <Field label="Tracking number"><input name="trackingNumber" required className="admin-input font-mono" /></Field>
                    <Field label="Tracking link (https)"><input name="trackingUrl" type="url" className="admin-input" /></Field>
                  </div>
                  <Field label="Notes"><input name="notes" className="admin-input" /></Field>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="markShipped" defaultChecked={o.status === "supplier_accepted"} className="h-4 w-4" /> Mark the order as shipped (only from “supplier accepted”; commits stock)</label>
                </ActionForm>
              </details>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          {can("orders.manage") && (
            <Card title="Status">
              {targets.length === 0 ? <p className="text-sm text-ink-soft">This order is final ({o.status.replace(/_/g, " ")}).</p> : (
                <ActionForm action={transitionAction} submitLabel="Update status" confirm="Change the order status?">
                  <input type="hidden" name="orderId" value={o.id} />
                  <select name="to" className="admin-input" aria-label="New status">
                    {targets.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
                  </select>
                  <input name="reason" placeholder="Reason (shown on the timeline)" className="admin-input" aria-label="Reason" />
                  {o.status === "supplier_accepted" && <p className="text-xs text-ink-soft">To ship, record a shipment with a real tracking number.</p>}
                  {o.status === "pending_payment" && <p className="text-xs text-ink-soft">“Paid” is set only by a verified payment confirmation, never by hand.</p>}
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
            ) : <p className="mt-2 text-xs text-ink-soft">Ships to {o.ship_country}. Full address hidden (needs customers.pii).</p>}
            {o.customer_note && <p className="mt-3 rounded-lg bg-cream p-2 text-sm">“{o.customer_note}”</p>}
            {can("customers.view") && <Link className="mt-3 inline-block text-sm text-brand underline" href={`/admin/customers?q=${encodeURIComponent(o.email)}`}>Customer history</Link>}
          </Card>

          <Card title="Payment">
            {d.payments.length === 0 ? <p className="text-sm text-ink-soft">No payment recorded.</p> : d.payments.map((p) => (
              <div key={p.id} className="text-sm">
                <p className="flex flex-wrap items-center gap-2"><span className="font-medium capitalize">{p.provider}</span><StatusBadge status={p.status} />{p.is_test && <Badge tone="amber">test mode</Badge>}</p>
                <p className="mt-1 font-mono text-xs text-ink-soft">{p.provider_payment_id ?? "—"}</p>
                <p className="mt-1 font-mono">{fmtMoney(p.amount, p.currency)}{p.refunded_amount > 0 && <span className="text-ink-soft"> · refunded {fmtMoney(p.refunded_amount, p.currency)}</span>}</p>
                <p className="text-xs text-ink-soft">Fee: {p.fee_amount === null ? "not reported by provider" : fmtMoney(p.fee_amount, p.currency)}</p>
              </div>
            ))}
            {d.refunds.length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-line pt-3 text-xs">
                {d.refunds.map((r) => <li key={r.id} className="flex flex-wrap gap-2"><StatusBadge status={r.status} /><span className="font-mono">{fmtMoney(r.amount, r.currency)}</span><span className="text-ink-soft">{r.reason}</span>{r.error && <span className="text-red-700">{r.error}</span>}</li>)}
              </ul>
            )}
            {can("orders.refund") && paid && refundable > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-medium text-brand">Refund…</summary>
                <ActionForm action={refundAction} submitLabel="Refund" variant="danger" confirm="Send this refund?" className="mt-2">
                  <input type="hidden" name="orderId" value={o.id} />
                  <Field label={`Amount (${paid.currency}, max ${toDecimalString({ amount: refundable, currency: paid.currency })})`}><input name="amount" inputMode="decimal" defaultValue={toDecimalString({ amount: refundable, currency: paid.currency })} className="admin-input font-mono" /></Field>
                  <Field label="Reason"><input name="reason" required className="admin-input" /></Field>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="manual" className="h-4 w-4" /> Already refunded at the provider (record only)</label>
                  <input name="manualReference" placeholder="Provider refund reference (for manual)" className="admin-input font-mono" aria-label="Provider refund reference" />
                </ActionForm>
              </details>
            )}
          </Card>

          <Card title="Invoice">
            {d.invoice ? <p className="text-sm">Issued <Link className="text-brand underline" href={`/admin/orders/${o.id}/invoice`} target="_blank">{d.invoice.invoice_number}</Link> on {fmtDate(d.invoice.issued_at, false)}.</p> : (
              can("orders.manage") ? (
                <ActionForm action={invoiceAction} inline><input type="hidden" name="orderId" value={o.id} /><button className="btn-ghost">Issue invoice</button></ActionForm>
              ) : <p className="text-sm text-ink-soft">Not issued.</p>
            )}
            <p className="mt-2 text-xs text-ink-soft">Uses the seller details from Settings. Have your accountant confirm the invoice format for your VAT obligations.</p>
          </Card>

          <Card title="Stock reservation">
            {d.reservations.length === 0 ? <p className="text-sm text-ink-soft">None.</p> : (
              <ul className="space-y-1 text-xs">{d.reservations.map((r) => <li key={r.variant_id} className="flex justify-between"><span className="font-mono">{d.items.find((i) => i.variant_id === r.variant_id)?.sku ?? r.variant_id.slice(0, 8)} × {r.quantity}</span><StatusBadge status={r.status === "reserved" ? "pending" : r.status === "committed" ? "shipped" : "cancelled"} /></li>)}</ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
