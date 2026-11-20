/** Analytics, profit, payments, exchange rates, expenses — all computed from DB records. */
import type { Db } from "../../db/client";
import { computeProfit, REVENUE_STATUSES, type ProfitOrderInput } from "../../finance/profit";
import { parseRate } from "../../fx";
import type { CurrencyCode } from "../../money";
import { logActivity, type Actor } from "../audit";
import { daysIn, type DateRange } from "../date-range";
import { getSetting } from "./settings";
import { rateToBase } from "./orders";

const PAID = [...REVENUE_STATUSES];

export interface OverviewKpis {
  revenueByCurrency: Record<string, number>;
  paidOrders: number;
  allOrders: number;
  pendingPayment: number;
  avgOrderByCurrency: Record<string, number>;
  unitsSold: number;
  newCustomers: number;
  refundsByCurrency: Record<string, number>;
  toFulfill: number;
  lowStock: number;
  outOfStock: number;
  publishedProducts: number;
  draftProducts: number;
  failedSupplierOrders: number;
}

export async function overviewKpis(db: Db, range: DateRange, lowStockDefault: number): Promise<OverviewKpis> {
  const [orders, units, customers, refunds, open, stock, products, supplierFails] = await Promise.all([
    db<{ currency: string; paid: number; revenue: number; all: number; pending: number }[]>`
      select currency, count(*) filter (where status::text = any(${PAID}))::int as paid,
        coalesce(sum(total) filter (where status::text = any(${PAID})), 0)::bigint as revenue,
        count(*)::int as all, count(*) filter (where status = 'pending_payment')::int as pending
      from public.orders where not is_test and created_at >= ${range.from} and created_at < ${range.to} group by currency`,
    db<{ n: number }[]>`select coalesce(sum(i.quantity), 0)::int as n from public.order_items i join public.orders o on o.id = i.order_id
      where not o.is_test and o.created_at >= ${range.from} and o.created_at < ${range.to} and o.status::text = any(${PAID})`,
    db<{ n: number }[]>`select count(*)::int as n from (select lower(email) e, min(created_at) f from public.orders where not is_test and status::text = any(${PAID}) group by 1) t
      where f >= ${range.from} and f < ${range.to}`,
    db<{ currency: string; amount: number }[]>`select currency, coalesce(sum(amount), 0)::bigint as amount from public.refunds
      where status in ('succeeded','manual') and created_at >= ${range.from} and order_id not in (select id from public.orders where is_test) and created_at < ${range.to} group by currency`,
    db<{ n: number }[]>`select count(*)::int as n from public.orders where status in ('paid','processing','submitted_to_supplier','supplier_accepted')`,
    db<{ low: number; out: number }[]>`
      select count(*) filter (where coalesce(i.quantity,0) - coalesce(i.reserved,0) <= 0)::int as out,
             count(*) filter (where coalesce(i.quantity,0) - coalesce(i.reserved,0) > 0 and coalesce(i.quantity,0) - coalesce(i.reserved,0) <= coalesce(i.low_stock_threshold, ${lowStockDefault}))::int as low
      from public.product_variants v join public.products p on p.id = v.product_id left join public.inventory i on i.variant_id = v.id
      where v.is_active and p.deleted_at is null and p.status = 'published'`,
    db<{ status: string; n: number }[]>`select status::text, count(*)::int as n from public.products where deleted_at is null group by status`,
    db<{ n: number }[]>`select count(*)::int as n from public.supplier_orders where status in ('failed','manual_required')`,
  ]);
  const k: OverviewKpis = {
    revenueByCurrency: {}, paidOrders: 0, allOrders: 0, pendingPayment: 0, avgOrderByCurrency: {}, unitsSold: units[0]?.n ?? 0,
    newCustomers: customers[0]?.n ?? 0, refundsByCurrency: {}, toFulfill: open[0]?.n ?? 0, lowStock: stock[0]?.low ?? 0,
    outOfStock: stock[0]?.out ?? 0, publishedProducts: 0, draftProducts: 0, failedSupplierOrders: supplierFails[0]?.n ?? 0,
  };
  for (const o of orders) {
    k.revenueByCurrency[o.currency] = o.revenue;
    k.paidOrders += o.paid;
    k.allOrders += o.all;
    k.pendingPayment += o.pending;
    if (o.paid) k.avgOrderByCurrency[o.currency] = Math.round(o.revenue / o.paid);
  }
  for (const r of refunds) k.refundsByCurrency[r.currency] = r.amount;
  for (const p of products) {
    if (p.status === "published") k.publishedProducts = p.n;
    if (p.status === "draft") k.draftProducts = p.n;
  }
  return k;
}

export interface DailyPoint {
  day: string;
  orders: number;
  revenue: Record<string, number>;
}

export async function dailySeries(db: Db, range: DateRange): Promise<DailyPoint[]> {
  const rows = await db<{ day: string; currency: string; orders: number; revenue: number }[]>`
    select to_char(date_trunc('day', created_at at time zone 'UTC'), 'YYYY-MM-DD') as day, currency, count(*)::int as orders, coalesce(sum(total), 0)::bigint as revenue
      from public.orders where not is_test and created_at >= ${range.from} and created_at < ${range.to} and status::text = any(${PAID}) group by 1, 2`;
  const map = new Map<string, DailyPoint>(daysIn(range).map((d) => [d, { day: d, orders: 0, revenue: {} }]));
  for (const r of rows) {
    const p = map.get(r.day);
    if (!p) continue;
    p.orders += r.orders;
    p.revenue[r.currency] = (p.revenue[r.currency] ?? 0) + r.revenue;
  }
  return [...map.values()];
}

export async function ordersByStatus(db: Db, range: DateRange) {
  return db<{ status: string; n: number }[]>`select status::text, count(*)::int as n from public.orders where not is_test and created_at >= ${range.from} and created_at < ${range.to} group by 1 order by 2 desc`;
}

export async function topProducts(db: Db, range: DateRange, limit = 8) {
  return db<{ product_name: string; units: number; revenue: number; currency: string }[]>`
    select i.product_name, sum(i.quantity)::int as units, sum(i.line_total)::bigint as revenue, o.currency
      from public.order_items i join public.orders o on o.id = i.order_id
     where not o.is_test and o.created_at >= ${range.from} and o.created_at < ${range.to} and o.status::text = any(${PAID})
     group by i.product_name, o.currency order by units desc limit ${limit}`;
}

export async function salesByCountry(db: Db, range: DateRange) {
  return db<{ country: string; orders: number; currency: string; revenue: number }[]>`
    select ship_country::text as country, count(*)::int as orders, currency, sum(total)::bigint as revenue from public.orders
     where not is_test and created_at >= ${range.from} and created_at < ${range.to} and status::text = any(${PAID}) group by 1, 3 order by 2 desc limit 20`;
}

export async function recentOrders(db: Db, limit = 6) {
  return db<{ id: string; order_number: number; email: string; status: string; currency: CurrencyCode; total: number; created_at: Date; is_test: boolean }[]>`
    select id, order_number, email, status, currency, total, created_at, is_test from public.orders order by created_at desc limit ${limit}`;
}

// ───────────────────────── Profit ─────────────────────────

export async function profitReport(db: Db, range: DateRange) {
  const base = ((await getSetting(db, "store.base_currency")) as CurrencyCode | null) ?? "EUR";
  const orders = await db<{
    id: string; status: string; currency: CurrencyCode; total: number; tax_total: number; fx: string | null;
    final_amount: number | null; final_currency: CurrencyCode | null; final_complete: boolean;
    est_amount: number | null; est_currency: CurrencyCode | null; refunded: number; fee: number | null;
  }[]>`
    select o.id, o.status::text, o.currency, o.total, o.tax_total, o.fx_rate_to_base::text as fx,
      so.amount as final_amount, so.currency as final_currency, coalesce(so.complete, false) as final_complete,
      est.amount as est_amount, est.currency as est_currency,
      coalesce((select sum(r.amount) from public.refunds r where r.order_id = o.id and r.status in ('succeeded','manual')), 0)::bigint as refunded,
      (select sum(p.fee_amount) from public.payments p where p.order_id = o.id and p.fee_amount is not null)::bigint as fee
    from public.orders o
    left join lateral (
      select sum(cost_total)::bigint as amount, min(cost_currency) as currency,
        bool_and(cost_total is not null) and count(distinct cost_currency) = 1 as complete
      from public.supplier_orders where order_id = o.id and status = 'submitted') so on true
    left join lateral (
      select sum(sp.cost_amount * oi.quantity)::bigint as amount, min(sp.cost_currency) as currency
      from public.order_items oi join public.supplier_products sp on sp.variant_id = oi.variant_id and sp.is_primary
      where oi.order_id = o.id having count(distinct sp.cost_currency) = 1) est on true
    where not o.is_test and o.created_at >= ${range.from} and o.created_at < ${range.to}`;
  const expenses = await db<{ amount: number; currency: CurrencyCode }[]>`
    select amount, currency from public.expenses where incurred_on >= ${range.from} and incurred_on < ${range.to}`;
  const rates: Partial<Record<CurrencyCode, string>> = {};
  for (const c of ["EUR", "USD"] as CurrencyCode[]) {
    const r = await rateToBase(db, c, base);
    if (r) rates[c] = r;
  }
  const input: ProfitOrderInput[] = orders.map((o) => ({
    id: o.id, status: o.status, currency: o.currency, total: o.total, taxTotal: o.tax_total, fxRateToBase: o.fx,
    supplierCostFinal: o.final_complete && o.final_amount !== null && o.final_currency ? { amount: o.final_amount, currency: o.final_currency } : null,
    supplierCostEstimated: o.est_amount !== null && o.est_currency ? { amount: o.est_amount, currency: o.est_currency } : null,
    refunded: o.refunded, fee: o.fee,
  }));
  return computeProfit(input, expenses, base, rates);
}

// ───────────────────────── Payments ─────────────────────────

export async function listPayments(db: Db, f: { status?: string; page?: number }) {
  const page = Math.max(1, f.page ?? 1);
  return db<{ id: string; order_id: string; order_number: number; provider: string; provider_payment_id: string | null; status: string; amount: number; currency: CurrencyCode; refunded_amount: number; fee_amount: number | null; is_test: boolean; created_at: Date }[]>`
    select p.*, o.order_number from public.payments p join public.orders o on o.id = p.order_id
     where (${f.status ?? null}::text is null or p.status::text = ${f.status ?? null})
     order by p.created_at desc limit 50 offset ${(page - 1) * 50}`;
}

export async function listRefunds(db: Db) {
  return db<{ id: string; order_id: string; order_number: number; amount: number; currency: CurrencyCode; reason: string; status: string; provider: string | null; provider_refund_id: string | null; error: string | null; admin_email: string | null; created_at: Date }[]>`
    select r.*, o.order_number, u.email as admin_email from public.refunds r join public.orders o on o.id = r.order_id
      left join public.admin_users u on u.id = r.admin_user_id order by r.created_at desc limit 100`;
}

export async function recentWebhookEvents(db: Db) {
  return db<{ id: number; provider: string; provider_event_id: string; event_type: string; order_id: string | null; received_at: Date }[]>`
    select id, provider, provider_event_id, event_type, order_id, received_at from public.payment_events order by received_at desc limit 25`;
}

// ───────────────────────── Exchange rates & expenses ─────────────────────────

export async function listRates(db: Db) {
  return db<{ id: string; base_currency: CurrencyCode; quote_currency: CurrencyCode; rate: string; source: string; effective_at: Date; created_by_email: string | null }[]>`
    select r.id, r.base_currency, r.quote_currency, r.rate::text, r.source, r.effective_at, u.email as created_by_email
      from public.exchange_rates r left join public.admin_users u on u.id = r.created_by order by r.effective_at desc limit 50`;
}

/** Rates are append-only history: a new rate applies to future orders; past orders keep their snapshot. */
export async function addRate(db: Db, actor: Actor, r: { base: CurrencyCode; quote: CurrencyCode; rate: string; effectiveAt: Date }) {
  if (r.base === r.quote) throw new Error("Choose two different currencies");
  parseRate(r.rate);
  await db`insert into public.exchange_rates (base_currency, quote_currency, rate, source, effective_at, created_by)
           values (${r.base}, ${r.quote}, ${r.rate}, 'manual', ${r.effectiveAt}, ${actor.id})`;
  await logActivity(db, actor, { action: "fx.add", entity: "exchange_rate", summary: `1 ${r.base} = ${r.rate} ${r.quote}`, after: r });
}

export async function listExpenses(db: Db, range: DateRange) {
  return db<{ id: string; category: string; description: string; amount: number; currency: CurrencyCode; incurred_on: Date; created_at: Date }[]>`
    select * from public.expenses where incurred_on >= ${range.from} and incurred_on < ${range.to} order by incurred_on desc`;
}

export async function addExpense(db: Db, actor: Actor, e: { category: string; description: string; amount: number; currency: CurrencyCode; incurredOn: string }) {
  const [row] = await db<{ id: string }[]>`insert into public.expenses (category, description, amount, currency, incurred_on, created_by)
    values (${e.category}, ${e.description}, ${e.amount}, ${e.currency}, ${e.incurredOn}, ${actor.id}) returning id`;
  await logActivity(db, actor, { action: "expense.add", entity: "expense", entityId: row!.id, summary: `${e.category}: ${e.description}`, after: e });
}

export async function deleteExpense(db: Db, actor: Actor, id: string) {
  const [before] = await db`delete from public.expenses where id = ${id} returning *`;
  await logActivity(db, actor, { action: "expense.delete", entity: "expense", entityId: id, summary: "Deleted expense", before });
}
