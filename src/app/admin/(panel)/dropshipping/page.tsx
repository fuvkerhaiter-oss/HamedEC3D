import Link from "next/link";
import { ActionForm } from "@/features/admin/ActionForm";
import { Badge, Card, Field, fmtDate, fmtMoney, Notice, PageHeader, Stat, StatusBadge, Table } from "@/features/admin/ui";
import { requirePage } from "@/lib/admin/guard";
import { resolveRange } from "@/lib/admin/date-range";
import { automationState, exceptionQueue, ordersWithoutJob, pipelineCounts, recentAutomationLogs, supplierHealth, supplierPaymentsPending } from "@/lib/admin/services/dropshipping";
import { profitReport } from "@/lib/admin/services/finance";
import { getSql } from "@/lib/db/client";
import { toDecimalString } from "@/lib/money";
import { handledManuallyAction, killSwitchAction, retryJobAction, runWorkerAction, saveRulesAction, setAutomationAction } from "./actions";

export const metadata = { title: "Dropshipping" };
export const dynamic = "force-dynamic";

const pct = (bps: number) => (bps / 100).toString();

export default async function DropshippingPage() {
  const session = await requirePage("suppliers.view");
  const sql = getSql();
  const canManage = session.permissions.has("suppliers.manage");
  const showMoney = session.permissions.has("finance.view");
  const [{ sw, rules }, counts, queue, unpaid, logs, suppliers, noJob, profit] = await Promise.all([
    automationState(sql), pipelineCounts(sql), exceptionQueue(sql), supplierPaymentsPending(sql), recentAutomationLogs(sql), supplierHealth(sql), ordersWithoutJob(sql),
    showMoney ? profitReport(sql, resolveRange({ range: "30d" })) : Promise.resolve(null),
  ]);
  const anyApi = suppliers.some((s) => s.fulfillment_mode === "api" && s.connection.status === "connected" && !s.is_mock);

  return (
    <>
      <PageHeader
        title="Dropshipping"
        description="Paid orders are checked and sent to suppliers automatically. Anything unsafe (price jump, no stock, bad address, low margin, supplier timeout) stops here for you to decide."
        actions={canManage ? <ActionForm action={runWorkerAction} submitLabel="Run worker now" variant="ghost" inline /> : undefined}
      />

      {sw.killSwitch && <div className="mb-4"><Notice tone="bad" title="Kill switch engaged">Nothing is being sent to any supplier. Paid orders wait in the queue and are not lost.</Notice></div>}
      {!sw.enabled && !sw.killSwitch && <div className="mb-4"><Notice tone="warn" title="Automatic purchasing is off">Paid orders go straight to the review queue below. Turn it on only after a supplier is connected and a sandbox/test order went through.</Notice></div>}
      {!anyApi && <div className="mb-4"><Notice tone="info" title="No live supplier API connected">Without a connected API supplier every order is fulfilled by hand (the queue tells you what to place). Supplier payment is never automatic: AliExpress DS orders are created unpaid and must be paid in your AliExpress account.</Notice></div>}

      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="Paid orders (all time)" value={counts.paid_orders} />
        <Stat label="Waiting for a supplier order" value={counts.awaiting_fulfilment} tone={counts.awaiting_fulfilment ? "warn" : "default"} />
        <Stat label="Needs your decision" value={counts.review + counts.dead} tone={counts.review + counts.dead ? "bad" : "default"} hint={`${counts.dead} failed after retries`} />
        <Stat label="Supplier orders unpaid" value={counts.supplier_unpaid} tone={counts.supplier_unpaid ? "warn" : "default"} hint="Pay them in your supplier account" />
        <Stat label="With supplier" value={counts.with_supplier} />
        <Stat label="In transit" value={counts.in_transit} />
        <Stat label="Delivered" value={counts.delivered} />
        <Stat label="Failed / refunds" value={`${counts.failed} / ${counts.refunds}`} />
      </div>

      {profit && (
        <Card title={`Profit — last 30 days (${profit.baseCurrency}, excludes test orders)`} className="mt-6">
          <div className="grid gap-3 text-sm sm:grid-cols-4">
            <div>Revenue (net of tax)<div className="font-mono text-lg">{fmtMoney(profit.revenue, profit.baseCurrency)}</div></div>
            <div>Supplier costs (goods + shipping)<div className="font-mono text-lg">{fmtMoney(profit.costOfGoods, profit.baseCurrency)}</div></div>
            <div>Payment fees<div className="font-mono text-lg">{fmtMoney(profit.fees, profit.baseCurrency)}</div></div>
            <div>Refunds<div className="font-mono text-lg">{fmtMoney(profit.refunds, profit.baseCurrency)}</div></div>
            <div>Other expenses<div className="font-mono text-lg">{fmtMoney(profit.expenses, profit.baseCurrency)}</div></div>
            <div>Net profit<div className={`font-mono text-lg ${profit.netProfit < 0 ? "text-red-700" : ""}`}>{fmtMoney(profit.netProfit, profit.baseCurrency)}</div></div>
            <div className="sm:col-span-2 text-xs text-ink-soft">
              {profit.estimatedOrders ? `${profit.estimatedOrders} order(s) use estimated supplier costs. ` : ""}
              {profit.missingCost ? `${profit.missingCost} order(s) have no supplier cost yet. ` : ""}
              {profit.missingRate ? "An exchange rate is missing — some amounts are excluded. " : ""}
              Profit is an accounting estimate, not cash you can withdraw. <Link className="text-brand" href="/admin/analytics">Full report →</Link>
            </div>
          </div>
        </Card>
      )}

      <Card title={`Exception queue (${queue.length})`} className="mt-6" pad={false}>
        {queue.length === 0 ? <p className="p-5 text-sm text-ink-soft">Nothing needs you right now.</p> : (
          <Table head={["Order", "Job", "Why it stopped", "Attempts", "Updated", ""]}>
            {queue.map((q) => (
              <tr key={q.order_id}>
                <td><Link className="font-medium hover:underline" href={`/admin/orders/${q.order_id}`}>#{q.order_number}</Link> {q.is_test && <Badge>test</Badge>}<span className="block text-xs text-ink-soft">{fmtMoney(q.total, q.currency)} · <StatusBadge status={q.order_status} /></span></td>
                <td><Badge tone={q.status === "failed" ? "red" : q.status === "queued" ? "blue" : "amber"}>{q.status.replace("_", " ")}</Badge><span className="block font-mono text-[11px] text-ink-soft">{q.stage ?? ""}</span></td>
                <td className="max-w-md text-xs">{q.review_reason ?? q.last_error ?? ""}</td>
                <td className="font-mono text-xs">{q.attempts}/{q.max_attempts}</td>
                <td className="text-xs text-ink-soft">{fmtDate(q.updated_at)}</td>
                <td className="space-y-1">
                  {canManage && q.status !== "queued" && <ActionForm action={retryJobAction} inline hideMessage><input type="hidden" name="orderId" value={q.order_id} /><button className="btn-ghost !px-2 !py-0.5 text-xs">Retry automatically</button></ActionForm>}
                  {canManage && <ActionForm action={handledManuallyAction} inline hideMessage confirm="Mark this order as handled by hand? The automation will not touch it again."><input type="hidden" name="orderId" value={q.order_id} /><button className="btn-ghost !px-2 !py-0.5 text-xs">I&apos;ll handle it</button></ActionForm>}
                </td>
              </tr>
            ))}
          </Table>
        )}
        {canManage && noJob.length > 0 && (
          <div className="border-t border-line p-4 text-sm">
            {noJob.length} paid order(s) have no automatic job (paid before automation existed):{" "}
            {noJob.map((o) => (
              <ActionForm key={o.id} action={retryJobAction} inline hideMessage><input type="hidden" name="orderId" value={o.id} /><button className="text-brand underline">#{o.order_number}</button></ActionForm>
            ))}
          </div>
        )}
      </Card>

      <Card title={`Supplier orders waiting for YOUR payment (${unpaid.length})`} className="mt-6" pad={false}>
        {unpaid.length === 0 ? <p className="p-5 text-sm text-ink-soft">None.</p> : (
          <Table head={["Order", "Supplier", "Supplier order", "Cost", "Status at supplier", "Created"]}>
            {unpaid.map((u) => (
              <tr key={u.supplier_order_ref}>
                <td><Link className="hover:underline" href={`/admin/orders/${u.order_id}`}>#{u.order_number}</Link></td>
                <td>{u.supplier_name}</td>
                <td className="font-mono text-xs">{u.supplier_order_ref}</td>
                <td className="font-mono text-xs">{u.cost_total !== null ? fmtMoney(u.cost_total, u.cost_currency) : "—"}</td>
                <td className="font-mono text-xs">{u.supplier_status_raw ?? "not synced yet"}</td>
                <td className="text-xs text-ink-soft">{fmtDate(u.created_at)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <Card title="Automation controls">
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-3">
              <span>Automatic purchasing: <Badge tone={sw.enabled ? "green" : "gray"}>{sw.enabled ? "ON" : "OFF"}</Badge></span>
              {canManage && <ActionForm action={setAutomationAction} inline confirm={sw.enabled ? undefined : "Turn on automatic supplier purchasing? Only do this after a successful test order with a connected supplier."}><input type="hidden" name="enabled" value={sw.enabled ? "false" : "true"} /><button className="btn-ghost !py-1 text-xs">{sw.enabled ? "Turn off" : "Turn on"}</button></ActionForm>}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span>Emergency kill switch: <Badge tone={sw.killSwitch ? "red" : "green"}>{sw.killSwitch ? "ENGAGED" : "off"}</Badge></span>
              {canManage && <ActionForm action={killSwitchAction} inline confirm={sw.killSwitch ? "Release the kill switch? Waiting orders will be sent to suppliers." : undefined}><input type="hidden" name="engage" value={sw.killSwitch ? "false" : "true"} /><button className={sw.killSwitch ? "btn-ghost !py-1 text-xs" : "btn-danger !py-1 text-xs"}>{sw.killSwitch ? "Release" : "STOP all supplier purchases"}</button></ActionForm>}
            </div>
          </div>
        </Card>

        <Card title="Purchasing rules">
          {canManage ? (
            <ActionForm action={saveRulesAction} submitLabel="Save rules">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Max supplier price increase (%)" hint="Above this, the order stops for review."><input name="maxPriceIncrease" defaultValue={pct(rules.maxPriceIncreaseBps)} className="admin-input font-mono" /></Field>
                <Field label="Minimum margin (%)" hint="After supplier cost, supplier shipping and payment fee."><input name="minMargin" defaultValue={pct(rules.minMarginBps)} className="admin-input font-mono" /></Field>
                <Field label="Max one supplier purchase"><input name="maxPurchase" defaultValue={toDecimalString({ amount: rules.maxPurchaseAmount, currency: rules.maxPurchaseCurrency })} className="admin-input font-mono" /></Field>
                <Field label="…in currency"><select name="maxPurchaseCurrency" defaultValue={rules.maxPurchaseCurrency} className="admin-input"><option>USD</option><option>EUR</option></select></Field>
                <Field label="Allowed destination countries" hint="ISO codes, e.g. US, IT, FR. Empty = all you ship to."><input name="allowedCountries" defaultValue={rules.allowedCountries.join(", ")} className="admin-input font-mono" /></Field>
                <Field label="Allowed supplier shipping methods" hint="e.g. CAINIAO_STANDARD. Empty = any mapped method."><input name="allowedShippingMethods" defaultValue={rules.allowedShippingMethods.join(", ")} className="admin-input font-mono" /></Field>
                <Field label="Automatic attempts per order"><input name="maxAttempts" inputMode="numeric" defaultValue={rules.maxAttempts} className="admin-input font-mono" /></Field>
                <Field label="Payment fee estimate (%)" hint="Used until the real fee is known."><input name="estimatedFee" defaultValue={pct(rules.estimatedFeeBps)} className="admin-input font-mono" /></Field>
              </div>
              <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" name="useBackupSuppliers" defaultChecked={rules.useBackupSuppliers} className="h-4 w-4" /> Use backup suppliers (by priority) when the first choice fails a check</label>
            </ActionForm>
          ) : <p className="text-sm text-ink-soft">You can view but not change the rules.</p>}
        </Card>
      </div>

      <Card title="Suppliers" className="mt-6" pad={false}>
        <Table head={["Supplier", "Integration", "Connection", "Places orders", "Pays supplier", "Mapped / auto", "Orders / problems", "Avg order cost", "Ships to"]}>
          {suppliers.map((s) => (
            <tr key={s.id}>
              <td><Link className="font-medium hover:underline" href={`/admin/suppliers/${s.id}`}>{s.name}</Link> {s.is_mock && <Badge tone="ink">mock</Badge>} {!s.is_active && <Badge>inactive</Badge>}</td>
              <td className="text-xs">{s.info.label}</td>
              <td><Badge tone={s.connection.status === "connected" ? "green" : s.connection.status === "not_applicable" ? "gray" : "amber"}>{s.connection.status.replace("_", " ")}</Badge><span className="block max-w-56 text-[11px] text-ink-soft">{s.connection.detail}</span></td>
              <td className="text-xs">{s.fulfillment_mode === "api" && s.info.placesOrders ? "yes (API)" : "no — manual"}</td>
              <td className="text-xs">{s.info.paysSupplier ? "yes" : "no — you pay"}</td>
              <td className="font-mono text-xs">{s.mapped} / {s.auto}</td>
              <td className="font-mono text-xs">{s.orders} / <span className={s.failed ? "text-red-700" : ""}>{s.failed}</span></td>
              <td className="font-mono text-xs">{s.avg_cost !== null ? fmtMoney(Number(s.avg_cost), s.cost_currency) : "—"}</td>
              <td className="text-xs">{s.supported_countries.length ? s.supported_countries.join(", ") : "any"}</td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="Automation log (latest)" className="mt-6" pad={false}>
        {logs.length === 0 ? <p className="p-5 text-sm text-ink-soft">No automated actions yet.</p> : (
          <Table head={["When", "Order", "Event", "Details"]}>
            {logs.map((l) => (
              <tr key={l.id}>
                <td className="whitespace-nowrap text-xs text-ink-soft">{fmtDate(l.created_at)}</td>
                <td className="text-xs">{l.order_id ? <Link className="hover:underline" href={`/admin/orders/${l.order_id}`}>#{l.order_number}</Link> : "—"}</td>
                <td><span className={`font-mono text-[11px] ${l.level === "error" ? "text-red-700" : l.level === "warn" ? "text-amber-700" : ""}`}>{l.event}</span></td>
                <td className="max-w-xl text-xs">{l.message}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
