import { ActionForm } from "@/features/admin/ActionForm";
import { DateRangeForm } from "@/features/admin/DateRangeForm";
import { BarChart, Card, Field, fmtDate, fmtMoney, HBars, Notice, PageHeader, Stat, Table, CsvLink } from "@/features/admin/ui";
import { resolveRange } from "@/lib/admin/date-range";
import { requirePage } from "@/lib/admin/guard";
import { dailySeries, listExpenses, profitReport, salesByCountry, topProducts } from "@/lib/admin/services/finance";
import { getSql } from "@/lib/db/client";
import { addExpenseAction, deleteExpenseAction } from "../ops-actions";

export const metadata = { title: "Analytics & Reports" };

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ range?: string; from?: string; to?: string }> }) {
  const session = await requirePage("analytics.view");
  const sp = await searchParams;
  const range = resolveRange(sp);
  const sql = getSql();
  const finance = session.permissions.has("finance.view");
  const [series, top, countries, profit, expenses] = await Promise.all([
    dailySeries(sql, range), topProducts(sql, range, 10), salesByCountry(sql, range),
    finance ? profitReport(sql, range) : Promise.resolve(null), finance ? listExpenses(sql, range) : Promise.resolve([]),
  ]);
  const qs = new URLSearchParams(Object.entries({ range: range.preset, from: sp.from, to: sp.to }).filter((e): e is [string, string] => !!e[1])).toString();
  const b = profit?.baseCurrency ?? "EUR";

  return (
    <>
      <PageHeader eyebrow={range.label} title="Analytics & Reports" description="Everything is computed from stored orders, refunds, supplier costs and expenses." actions={<DateRangeForm range={range.preset} from={sp.from} to={sp.to} />} />

      {profit && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={`Net revenue (${b})`} value={fmtMoney(profit.revenue, b)} hint={`excl. ${fmtMoney(profit.tax, b)} tax · ${profit.orders} orders`} />
            <Stat label="Cost of goods" value={fmtMoney(profit.costOfGoods, b)} hint={`${profit.missingCost} order(s) without cost data`} tone={profit.missingCost ? "warn" : "default"} />
            <Stat label="Gross profit" value={fmtMoney(profit.grossProfit, b)} hint={`after refunds ${fmtMoney(profit.refunds, b)} and fees ${fmtMoney(profit.fees, b)}`} tone={profit.grossProfit < 0 ? "bad" : "default"} />
            <Stat label="Net profit" value={fmtMoney(profit.netProfit, b)} hint={`after ${fmtMoney(profit.expenses, b)} expenses`} tone={profit.netProfit < 0 ? "bad" : "default"} />
          </div>
          <div className="mt-3">
            <Notice tone={profit.estimatedOrders || profit.missingRate ? "warn" : "ok"}>
              {profit.estimatedOrders > 0 ? `${profit.estimatedOrders} of ${profit.orders} order(s) are ESTIMATED (supplier cost from the mapping and/or provider fee not reported yet, or not delivered). ` : "All figures are final. "}
              {profit.missingRate && "Some amounts were excluded because no exchange rate to the base currency is recorded (Payments → Exchange rates). "}
              Unknown payment fees count as 0 — they are never invented.
            </Notice>
          </div>
        </>
      )}

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        {(["EUR", "USD"] as const).map((c) => (
          <Card key={c} title={`Daily revenue (${c})`}>
            <BarChart label={`Daily revenue ${c}`} data={series.map((d) => ({ key: d.day, value: d.revenue[c] ?? 0 }))} format={(n) => fmtMoney(n, c)} />
          </Card>
        ))}
        <Card title="Paid orders per day">
          <BarChart label="Paid orders per day" data={series.map((d) => ({ key: d.day, value: d.orders }))} format={(n) => String(n)} />
        </Card>
        <Card title="Sales by destination">
          {countries.length ? <HBars rows={countries.map((r) => ({ label: `${r.country} (${r.currency})`, value: r.orders }))} format={(n) => `${n} orders`} /> : <p className="text-sm text-ink-soft">No paid orders in this period.</p>}
        </Card>
      </div>

      <Card title="Best sellers" className="mt-6" pad={false}>
        {top.length === 0 ? <p className="p-5 text-sm text-ink-soft">No sales in this period.</p> : (
          <Table head={["Product", "Units", "Revenue"]}>{top.map((t) => <tr key={t.product_name + t.currency}><td>{t.product_name}</td><td className="font-mono">{t.units}</td><td className="font-mono">{fmtMoney(t.revenue, t.currency)}</td></tr>)}</Table>
        )}
      </Card>

      <Card title="Reports (CSV)" className="mt-6">
        <div className="flex flex-wrap gap-2">
          <CsvLink className="btn-ghost" href={`/api/admin/export/sales?${qs}`}>Daily sales</CsvLink>
          <CsvLink className="btn-ghost" href={`/api/admin/export/top-products?${qs}`}>Product performance</CsvLink>
          <CsvLink className="btn-ghost" href={`/api/admin/export/countries?${qs}`}>Sales by country</CsvLink>
          {session.permissions.has("orders.export") && <CsvLink className="btn-ghost" href={`/api/admin/export/orders?${qs}`}>Orders</CsvLink>}
          <CsvLink className="btn-ghost" href="/api/admin/export/inventory">Inventory</CsvLink>
        </div>
      </Card>

      {finance && (
        <Card title="Business expenses" className="mt-6">
          {expenses.length > 0 && (
            <ul className="mb-4 divide-y divide-line text-sm">
              {expenses.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="text-xs text-ink-soft">{fmtDate(e.incurred_on, false)}</span><span className="font-medium">{e.category.replace("_", " ")}</span><span>{e.description}</span>
                  <span className="ml-auto font-mono">{fmtMoney(e.amount, e.currency)}</span>
                  {session.permissions.has("finance.manage") && <ActionForm action={deleteExpenseAction} inline hideMessage confirm="Delete this expense?"><input type="hidden" name="id" value={e.id} /><button className="btn-danger !px-2 !py-0.5 text-xs">✕</button></ActionForm>}
                </li>
              ))}
            </ul>
          )}
          {session.permissions.has("finance.manage") && (
            <ActionForm action={addExpenseAction} submitLabel="Record expense" resetOnSuccess>
              <div className="grid gap-3 sm:grid-cols-5">
                <Field label="Category"><select name="category" className="admin-input">{["advertising", "software", "shipping_supplies", "fees", "salaries", "other"].map((c) => <option key={c} value={c}>{c.replace("_", " ")}</option>)}</select></Field>
                <Field label="Description"><input name="description" required className="admin-input" /></Field>
                <Field label="Amount"><input name="amount" inputMode="decimal" required className="admin-input font-mono" /></Field>
                <Field label="Currency"><select name="currency" className="admin-input"><option>EUR</option><option>USD</option></select></Field>
                <Field label="Date"><input name="incurredOn" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} className="admin-input" /></Field>
              </div>
            </ActionForm>
          )}
        </Card>
      )}
    </>
  );
}
