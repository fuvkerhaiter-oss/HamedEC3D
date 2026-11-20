import Link from "next/link";
import { DateRangeForm } from "@/features/admin/DateRangeForm";
import { BarChart, Card, EmptyState, fmtDate, fmtMoney, HBars, PageHeader, Stat, StatusBadge, Table, TestBadge } from "@/features/admin/ui";
import { resolveRange } from "@/lib/admin/date-range";
import { requirePage } from "@/lib/admin/guard";
import { dailySeries, ordersByStatus, overviewKpis, recentOrders, topProducts } from "@/lib/admin/services/finance";
import { lowStockDefault } from "@/lib/admin/services/settings";
import { getSql } from "@/lib/db/client";

export const metadata = { title: "Overview" };

const money = (byCur: Record<string, number>) => {
  const entries = Object.entries(byCur).filter(([, v]) => v);
  return entries.length ? entries.map(([c, v]) => fmtMoney(v, c)).join(" · ") : fmtMoney(0, "EUR");
};

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ range?: string; from?: string; to?: string }> }) {
  const session = await requirePage("dashboard.view");
  const sp = await searchParams;
  const range = resolveRange(sp);
  const sql = getSql();
  const [k, series, statuses, top, recent] = await Promise.all([
    overviewKpis(sql, range, await lowStockDefault(sql)),
    dailySeries(sql, range),
    ordersByStatus(sql, range),
    topProducts(sql, range, 6),
    session.permissions.has("orders.view") ? recentOrders(sql) : Promise.resolve([]),
  ]);
  const currencies = [...new Set(["EUR", ...Object.keys(k.revenueByCurrency)])];

  return (
    <>
      <PageHeader
        eyebrow={range.label}
        title={`Hello${session.user.fullName ? `, ${session.user.fullName.split(" ")[0]}` : ""}`}
        description="Live numbers from the store database. Revenue counts paid orders only (TEST orders excluded); EUR and USD are kept separate (no silent conversion)."
        actions={<DateRangeForm range={range.preset} from={sp.from} to={sp.to} />}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Revenue" value={money(k.revenueByCurrency)} hint={`${k.paidOrders} paid order${k.paidOrders === 1 ? "" : "s"}`} />
        <Stat label="Avg. order" value={money(k.avgOrderByCurrency)} hint={`${k.unitsSold} units sold`} />
        <Stat label="Orders" value={k.allOrders} hint={`${k.pendingPayment} awaiting payment`} href="/admin/orders" />
        <Stat label="New customers" value={k.newCustomers} hint="First paid order in period" href="/admin/customers" />
        <Stat label="To fulfill" value={k.toFulfill} tone={k.toFulfill ? "warn" : "default"} hint="Paid → not yet shipped" href="/admin/orders?status=paid" />
        <Stat label="Supplier issues" value={k.failedSupplierOrders} tone={k.failedSupplierOrders ? "bad" : "default"} hint="Failed / manual action" href="/admin/suppliers" />
        <Stat label="Low / out of stock" value={`${k.lowStock} / ${k.outOfStock}`} tone={k.outOfStock ? "bad" : k.lowStock ? "warn" : "default"} hint="Published variants" href="/admin/inventory?filter=low" />
        <Stat label="Refunds" value={money(k.refundsByCurrency)} hint={`${k.publishedProducts} live · ${k.draftProducts} draft products`} />
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {currencies.map((c) => (
            <Card key={c} title={`Daily revenue (${c})`}>
              <BarChart label={`Daily revenue ${c}`} data={series.map((d) => ({ key: d.day, value: d.revenue[c] ?? 0 }))} format={(n) => fmtMoney(n, c)} />
            </Card>
          ))}
        </div>
        <div className="space-y-4">
          <Card title="Orders by status">
            {statuses.length ? <HBars rows={statuses.map((s) => ({ label: s.status.replace(/_/g, " "), value: s.n }))} /> : <p className="text-sm text-ink-soft">No orders in this period.</p>}
          </Card>
          <Card title="Top products (units)">
            {top.length ? <HBars rows={top.map((t) => ({ label: `${t.product_name} (${t.currency})`, value: t.units }))} /> : <p className="text-sm text-ink-soft">No sales in this period.</p>}
          </Card>
        </div>
      </div>

      {session.permissions.has("orders.view") && (
        <div className="mt-6">
          <Card title="Recent orders" actions={<Link href="/admin/orders" className="text-sm font-medium text-brand">All orders →</Link>} pad={false}>
            {recent.length === 0 ? (
              <div className="p-5"><EmptyState title="No orders yet">Orders appear here as soon as checkout creates them. Nothing is simulated.</EmptyState></div>
            ) : (
              <Table head={["Order", "Customer", "Status", "Total", "Placed"]}>
                {recent.map((o) => (
                  <tr key={o.id}>
                    <td><Link className="font-medium hover:underline" href={`/admin/orders/${o.id}`}>#{o.order_number}</Link> {o.is_test && <TestBadge />}</td>
                    <td className="text-ink-soft">{o.email}</td>
                    <td><StatusBadge status={o.status} /></td>
                    <td className="font-mono">{fmtMoney(o.total, o.currency)}</td>
                    <td className="text-ink-soft">{fmtDate(o.created_at)}</td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
