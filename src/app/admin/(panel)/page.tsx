import Link from "next/link";
import { DateRangeForm } from "@/features/admin/DateRangeForm";
import { Icon, type IconName } from "@/features/admin/icons";
import { BarChart, Card, EmptyState, fmtDate, fmtMoney, HBars, Notice, PageHeader, Stat, StatusBadge, statusLabel, Table, TestBadge } from "@/features/admin/ui";
import { daysIn, resolveRange } from "@/lib/admin/date-range";
import { requirePage } from "@/lib/admin/guard";
import type { Permission } from "@/lib/admin/permissions";
import { dailySeries, ordersByStatus, overviewKpis, recentOrders, topProducts, type DailyPoint, type OverviewKpis } from "@/lib/admin/services/finance";
import { unreadCount } from "@/lib/admin/services/notifications";
import { lowStockDefault } from "@/lib/admin/services/settings";
import { getSql } from "@/lib/db/client";
import { logError } from "@/lib/log";

export const metadata = { title: "Home" };

type RecentOrder = Awaited<ReturnType<typeof recentOrders>>[number];
type StatusCount = Awaited<ReturnType<typeof ordersByStatus>>[number];
type TopProduct = Awaited<ReturnType<typeof topProducts>>[number];

const EMPTY_KPIS: OverviewKpis = {
  revenueByCurrency: {}, paidOrders: 0, allOrders: 0, pendingPayment: 0, avgOrderByCurrency: {}, unitsSold: 0,
  newCustomers: 0, refundsByCurrency: {}, toFulfill: 0, lowStock: 0, outOfStock: 0, publishedProducts: 0,
  draftProducts: 0, failedSupplierOrders: 0,
};

/**
 * One slow/failing query must never blank the whole dashboard. Failures are logged with the section
 * name (so the server log identifies the culprit) and that card falls back to empty numbers.
 */
async function load<T>(section: string, work: Promise<T>, fallback: T, failed: string[]): Promise<T> {
  try {
    return await work;
  } catch (err) {
    logError(`admin home: ${section}`, err);
    failed.push(section);
    return fallback;
  }
}

const money = (byCur: Record<string, number>) => {
  const entries = Object.entries(byCur).filter(([, v]) => v);
  return entries.length ? entries.map(([c, v]) => fmtMoney(v, c)).join(" · ") : fmtMoney(0, "EUR");
};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

interface Todo {
  tone: "urgent" | "todo" | "info";
  text: string;
  detail: string;
  href: string;
  button: string;
}

export default async function HomePage({ searchParams }: { searchParams: Promise<{ range?: string; from?: string; to?: string }> }) {
  const session = await requirePage("dashboard.view");
  const can = (p: Permission) => session.permissions.has(p);
  const sp = await searchParams;
  const range = resolveRange(sp);
  const sql = getSql();
  const failed: string[] = [];
  const emptySeries: DailyPoint[] = daysIn(range).map((day) => ({ day, orders: 0, revenue: {} }));
  // Start the setting read in parallel too; overviewKpis only needs it once it arrives.
  const lowStock = lowStockDefault(sql);
  const [k, series, statuses, top, recent, unread] = await Promise.all([
    load("summary", lowStock.then((n) => overviewKpis(sql, range, n)), EMPTY_KPIS, failed),
    load("daily chart", dailySeries(sql, range), emptySeries, failed),
    load("orders by step", ordersByStatus(sql, range), [] as StatusCount[], failed),
    load("best sellers", topProducts(sql, range, 6), [] as TopProduct[], failed),
    can("orders.view") ? load("latest orders", recentOrders(sql), [] as RecentOrder[], failed) : Promise.resolve([] as RecentOrder[]),
    can("notifications.view") ? load("alerts", unreadCount(sql, session.user.id), 0, failed) : Promise.resolve(0),
  ]);
  const currencies = [...new Set(["EUR", ...Object.keys(k.revenueByCurrency)])];

  const todos: Todo[] = [];
  if (k.toFulfill && can("orders.view"))
    todos.push({ tone: "urgent", text: `${plural(k.toFulfill, "order is", "orders are")} paid and waiting to be sent`, detail: "The customers paid. Send these orders to your supplier.", href: "/admin/orders?status=paid", button: "Send orders" });
  if (k.failedSupplierOrders && can("suppliers.view"))
    todos.push({ tone: "urgent", text: `${plural(k.failedSupplierOrders, "supplier order needs", "supplier orders need")} your help`, detail: "A supplier order failed or must be placed by hand.", href: "/admin/suppliers", button: "Fix it" });
  if (k.outOfStock && can("inventory.view"))
    todos.push({ tone: "urgent", text: `${plural(k.outOfStock, "item is", "items are")} sold out`, detail: "Customers can't buy these. Add stock or hide them.", href: "/admin/inventory?filter=out", button: "Add stock" });
  if (k.lowStock && can("inventory.view"))
    todos.push({ tone: "todo", text: `${plural(k.lowStock, "item is", "items are")} running low`, detail: "Order more soon so they don't sell out.", href: "/admin/inventory?filter=low", button: "See items" });
  if (unread)
    todos.push({ tone: "todo", text: `${plural(unread, "new alert", "new alerts")}`, detail: "Things that happened in your shop.", href: "/admin/notifications", button: "Read alerts" });
  if (k.draftProducts && can("products.view"))
    todos.push({ tone: "info", text: `${plural(k.draftProducts, "product is a draft", "products are drafts")}`, detail: "Customers can't see drafts until you publish them.", href: "/admin/products?status=draft", button: "Review drafts" });
  if (k.pendingPayment && can("orders.view"))
    todos.push({ tone: "info", text: `${plural(k.pendingPayment, "order is", "orders are")} waiting for the customer to pay`, detail: "Nothing to do — they cancel themselves after 25 hours if unpaid.", href: "/admin/orders?status=pending_payment", button: "Look" });

  const quick: { href: string; label: string; icon: IconName; show: boolean }[] = [
    { href: "/admin/products/new", label: "Add a product", icon: "plus", show: can("products.edit") },
    { href: "/admin/orders", label: "See all orders", icon: "orders", show: can("orders.view") },
    { href: "/admin/inventory", label: "Change stock", icon: "stock", show: can("inventory.view") },
    { href: "/admin/products/images", label: "Upload photos", icon: "photo", show: can("products.view") },
    { href: "/admin/discounts", label: "Make a discount code", icon: "tag", show: can("discounts.manage") },
    { href: "/admin/analytics", label: "See reports", icon: "chart", show: can("analytics.view") },
  ];

  const toneCls = { urgent: "border-l-red-500", todo: "border-l-amber", info: "border-l-sky-400" };
  const toneIcon: Record<Todo["tone"], IconName> = { urgent: "alert", todo: "bell", info: "info" };

  return (
    <>
      <PageHeader
        title={`Hello${session.user.fullName ? `, ${session.user.fullName.split(" ")[0]}` : ""}`}
        description="Here is what needs your attention, and how your shop is doing."
      />

      {failed.length > 0 && (
        <div className="mb-6">
          <Notice tone="warn" title="Some numbers didn't load">
            The rest of the page is shown. Refresh to try again.
          </Notice>
        </div>
      )}

      <section aria-labelledby="todo-h" className="rounded-2xl border border-line bg-white">
        <header className="flex items-center justify-between gap-2 border-b border-line px-5 py-3">
          <h2 id="todo-h" className="text-lg font-semibold">To do now</h2>
          {todos.length > 0 && <span className="text-sm text-ink-soft">{plural(todos.length, "thing", "things")}</span>}
        </header>
        {todos.length === 0 ? (
          <div className="flex items-center gap-3 px-5 py-6 text-emerald-800">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-emerald-100"><Icon name="check" /></span>
            <div><p className="font-semibold">All done!</p><p className="text-sm text-ink-soft">Nothing needs your attention right now.</p></div>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {todos.map((t) => (
              <li key={t.text} className={`flex flex-wrap items-center gap-3 border-l-4 px-5 py-3.5 ${toneCls[t.tone]}`}>
                <Icon name={toneIcon[t.tone]} className={`h-5 w-5 ${t.tone === "urgent" ? "text-red-600" : t.tone === "todo" ? "text-amber-700" : "text-sky-600"}`} />
                <div className="min-w-[13rem] flex-1">
                  <p className="font-medium">{t.text}</p>
                  <p className="text-sm text-ink-soft">{t.detail}</p>
                </div>
                <Link href={t.href} className={t.tone === "info" ? "btn-ghost" : "btn-primary"}>{t.button} →</Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <h2 className="mt-8 text-lg font-semibold">Quick actions</h2>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {quick.filter((q) => q.show).map((q) => (
          <Link key={q.href} href={q.href} className="flex flex-col items-center gap-2 rounded-2xl border border-line bg-white px-3 py-4 text-center text-sm font-medium transition hover:border-ink/30 hover:bg-sand/30">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-amber/30 text-ink"><Icon name={q.icon} /></span>
            {q.label}
          </Link>
        ))}
      </div>

      <div className="mt-8 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">How your shop is doing</h2>
          <p className="text-sm text-ink-soft">{range.label}. Only real, paid orders are counted (practice “TEST” orders are left out).</p>
        </div>
        <DateRangeForm range={range.preset} from={sp.from} to={sp.to} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Money earned" value={money(k.revenueByCurrency)} hint={`From ${plural(k.paidOrders, "paid order", "paid orders")}`} />
        <Stat label="Orders" value={k.allOrders} hint={`${k.unitsSold} items sold`} href="/admin/orders" />
        <Stat label="Average order" value={money(k.avgOrderByCurrency)} hint="What a customer spends on average" />
        <Stat label="New customers" value={k.newCustomers} hint="Bought for the first time" href="/admin/customers" />
        <Stat label="Waiting to be sent" value={k.toFulfill} tone={k.toFulfill ? "warn" : "default"} hint="Paid, not shipped yet" href="/admin/orders?status=paid" />
        <Stat label="Running low / sold out" value={`${k.lowStock} / ${k.outOfStock}`} tone={k.outOfStock ? "bad" : k.lowStock ? "warn" : "default"} hint="Items in your shop" href="/admin/inventory?filter=low" />
        <Stat label="Products in shop" value={k.publishedProducts} hint={`${k.draftProducts} hidden drafts`} href="/admin/products" />
        <Stat label="Money refunded" value={money(k.refundsByCurrency)} hint="Given back to customers" />
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {currencies.map((c) => (
            <Card key={c} title={`Money earned per day (${c === "EUR" ? "euro" : c === "USD" ? "US dollar" : c})`}>
              <BarChart label={`Money earned per day ${c}`} data={series.map((d) => ({ key: d.day, value: d.revenue[c] ?? 0 }))} format={(n) => fmtMoney(n, c)} />
            </Card>
          ))}
        </div>
        <div className="space-y-4">
          <Card title="Orders by step">
            {statuses.length ? <HBars rows={statuses.map((s) => ({ label: statusLabel(s.status), value: s.n }))} /> : <p className="text-sm text-ink-soft">No orders in this period.</p>}
          </Card>
          <Card title="Best sellers (items sold)">
            {top.length ? <HBars rows={top.map((t) => ({ label: t.product_name, value: t.units }))} /> : <p className="text-sm text-ink-soft">No sales in this period.</p>}
          </Card>
        </div>
      </div>

      {can("orders.view") && (
        <div className="mt-6">
          <Card title="Latest orders" actions={<Link href="/admin/orders" className="text-sm font-medium text-brand">See all orders →</Link>} pad={false}>
            {recent.length === 0 ? (
              <div className="p-5"><EmptyState title="No orders yet">When a customer buys something, the order shows up here.</EmptyState></div>
            ) : (
              <Table head={["Order", "Customer", "Step", "Total", "Date"]}>
                {recent.map((o) => (
                  <tr key={o.id}>
                    <td><Link className="font-medium text-brand hover:underline" href={`/admin/orders/${o.id}`}>#{o.order_number}</Link> {o.is_test && <TestBadge />}</td>
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
